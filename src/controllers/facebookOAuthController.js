import axios from "axios";
import admin from "../config/firebaseAdmin.js";
import Page from "../models/Page.js";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import WorkspaceMember from "../models/WorkspaceMember.js";
import PageClaim from "../models/PageClaim.js";

const GRAPH_API = "https://graph.facebook.com/v19.0";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get or create a Workspace for a User.
 * Also ensures an owner WorkspaceMember record exists.
 */
const getOrCreateWorkspace = async (dbUser) => {
    if (dbUser.currentWorkspaceId) {
        const ws = await Workspace.findById(dbUser.currentWorkspaceId);
        if (ws) return ws;
    }

    const existing = await Workspace.findOne({ ownerUserId: dbUser._id });
    if (existing) {
        if (!dbUser.currentWorkspaceId) {
            await User.findByIdAndUpdate(dbUser._id, { currentWorkspaceId: existing._id });
        }
        return existing;
    }

    const workspace = await Workspace.create({
        ownerUserId: dbUser._id,
        name: dbUser.name ? `${dbUser.name}'s Workspace` : "My Workspace",
        planCode: "free",
        planStatus: "active",
        replyLimit: 100,
        usedReplies: 0,
    });

    await WorkspaceMember.create({
        workspaceId: workspace._id,
        userId: dbUser._id,
        role: "owner",
    });

    await User.findByIdAndUpdate(dbUser._id, { currentWorkspaceId: workspace._id });
    console.log(`✅ Workspace created for ${dbUser.email}: ${workspace._id}`);
    return workspace;
};

/**
 * Check if a Facebook page is already actively connected to a different workspace.
 * Returns the conflicting workspace name, or null if available.
 */
const checkPageAvailability = async (facebookPageId, currentWorkspaceId) => {
    const existing = await Page.findOne({ pageId: facebookPageId, isActive: true });
    if (!existing) return null;
    if (existing.workspaceId && String(existing.workspaceId) === String(currentWorkspaceId)) return null;
    return "another workspace";
};

// ─── STEP 1 — Redirect to Facebook OAuth ─────────────────────────────────────
const facebookLogin = async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).json({ success: false, message: "Firebase token is required" });

    try {
        await admin.auth().verifyIdToken(token);
    } catch (_) {
        return res.status(401).json({ success: false, message: "Invalid Firebase token" });
    }

    const params = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID,
        redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
        scope: "pages_show_list,pages_manage_metadata,pages_messaging",
        response_type: "code",
        state: token,
        auth_type: "rerequest",
    });
    res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`);
};

// ─── STEP 2 — OAuth Callback ─────────────────────────────────────────────────
const facebookCallback = async (req, res, next) => {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    try {
        const { code, state: firebaseToken } = req.query;

        if (!code) return res.redirect(`${frontendUrl}/pages?error=missing_code`);
        if (!firebaseToken) return res.redirect(`${frontendUrl}/pages?error=missing_token`);

        // Verify Firebase token
        let firebaseUid, userEmail;
        try {
            const decoded = await admin.auth().verifyIdToken(firebaseToken);
            firebaseUid = decoded.uid;
            userEmail = decoded.email;
        } catch (_) {
            return res.redirect(`${frontendUrl}/pages?error=invalid_token`);
        }

        // Look up MongoDB user
        const dbUser = await User.findOne({ email: userEmail });
        if (!dbUser) {
            console.error("❌ No MongoDB user found for email:", userEmail);
            return res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
        }

        // Ensure firebaseUid is stored on user
        if (!dbUser.firebaseUid) {
            await User.findByIdAndUpdate(dbUser._id, { firebaseUid });
        }

        // Get or create workspace
        const workspace = await getOrCreateWorkspace(dbUser);

        // Exchange code for user access token
        let userAccessToken;
        try {
            const tokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
                params: {
                    client_id: process.env.FACEBOOK_APP_ID,
                    client_secret: process.env.FACEBOOK_APP_SECRET,
                    redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
                    code,
                },
            });
            userAccessToken = tokenRes.data.access_token;
            if (!userAccessToken) return res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
        } catch (err) {
            console.error("❌ Token exchange failed:", err.response?.data || err.message);
            return res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
        }

        // Fetch pages from Facebook
        let fbPages;
        try {
            const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
                params: { fields: "id,name,access_token,picture{url}", access_token: userAccessToken },
            });
            fbPages = pagesRes.data.data;
        } catch (err) {
            console.error("❌ /me/accounts failed:", err.response?.data || err.message);
            return res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
        }

        if (!fbPages || fbPages.length === 0) {
            return res.redirect(`${frontendUrl}/pages?error=no_pages`);
        }

        const savedPages = [];
        const failedPages = [];

        for (const fbPage of fbPages) {
            if (!fbPage.access_token) {
                failedPages.push({ pageId: fbPage.id, reason: "no_access_token" });
                continue;
            }

            // Enforce global page uniqueness
            const conflict = await checkPageAvailability(fbPage.id, workspace._id);
            if (conflict) {
                console.log(`⚠️  Page ${fbPage.name} already connected to ${conflict}`);
                failedPages.push({ pageId: fbPage.id, pageName: fbPage.name, reason: "already_connected" });
                continue;
            }

            try {
                // Deactivate any stale active records for this page
                await Page.updateMany(
                    { pageId: fbPage.id, isActive: true, workspaceId: { $ne: workspace._id } },
                    { $set: { isActive: false } }
                );

                const pictureUrl = fbPage.picture?.data?.url || "";
                const page = await Page.findOneAndUpdate(
                    { userId: firebaseUid, pageId: fbPage.id },
                    {
                        workspaceId: workspace._id,
                        pageName: fbPage.name,
                        pageAccessToken: fbPage.access_token,
                        pagePicture: pictureUrl,
                        connectedAt: Date.now(),
                        isActive: true,
                    },
                    { new: true, upsert: true }
                );

                // PageClaim — record free tier usage, prevent future abuse
                const existingClaim = await PageClaim.findOne({ facebookPageId: fbPage.id });
                if (!existingClaim) {
                    // First time this page is ever connected — grant free quota (already on workspace)
                    await PageClaim.create({
                        facebookPageId: fbPage.id,
                        workspaceId: workspace._id,
                        claimedByUserId: dbUser._id,
                        trialUsed: true,
                    });
                    console.log(`📋 PageClaim created: ${fbPage.name} → workspace ${workspace._id}`);
                } else if (String(existingClaim.workspaceId) !== String(workspace._id)) {
                    // This page was previously claimed by a different workspace.
                    // Current workspace does NOT inherit the free quota for this page.
                    console.log(`⚠️  Page ${fbPage.name} previously claimed — no free quota for current workspace`);

                    // If this workspace is on free plan with no other pages, zero out their quota
                    const otherPages = await Page.countDocuments({
                        workspaceId: workspace._id,
                        isActive: true,
                        pageId: { $ne: fbPage.id },
                    });
                    if (workspace.planCode === "free" && otherPages === 0) {
                        await Workspace.findByIdAndUpdate(workspace._id, { replyLimit: 0 });
                        console.log(`🚫 Workspace ${workspace._id} quota zeroed — page trial already used`);
                    }
                }

                // Subscribe webhooks
                try {
                    await axios.post(
                        `${GRAPH_API}/${fbPage.id}/subscribed_apps`,
                        new URLSearchParams({
                            access_token: fbPage.access_token,
                            subscribed_fields: "messages,messaging_postbacks,message_deliveries,message_echoes,message_reads",
                        }).toString(),
                        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
                    );
                } catch (_) { /* non-blocking */ }

                savedPages.push({ pageId: page.pageId, pageName: page.pageName });
                console.log(`✅ Page saved: ${page.pageName} → workspace ${workspace._id}`);

            } catch (dbErr) {
                console.error(`❌ DB save failed for ${fbPage.name}:`, dbErr.message);
                failedPages.push({ pageId: fbPage.id, pageName: fbPage.name, reason: dbErr.message });
            }
        }

        console.log(`🏁 OAuth complete — saved: ${savedPages.length}, failed: ${failedPages.length}`);
        res.redirect(`${frontendUrl}/pages?connected=${savedPages.length}`);

    } catch (error) {
        console.error("❌ Unhandled OAuth error:", error.message);
        res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
    }
};

// ─── Re-subscribe all active pages to webhook ─────────────────────────────────
const resubscribePages = async (req, res) => {
    try {
        const pages = await Page.find({ isActive: true });
        const results = [];
        for (const page of pages) {
            try {
                await axios.post(
                    `${GRAPH_API}/${page.pageId}/subscribed_apps`,
                    new URLSearchParams({
                        access_token: page.pageAccessToken,
                        subscribed_fields: "messages,messaging_postbacks,message_deliveries,message_echoes,message_reads",
                    }).toString(),
                    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
                );
                results.push({ pageId: page.pageId, success: true });
            } catch (_) {
                results.push({ pageId: page.pageId, success: false });
            }
        }
        res.json({ success: true, results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── Debug: check pages and claims ───────────────────────────────────────────
const debugPages = async (req, res) => {
    try {
        const pages = await Page.find({}).select("pageId pageName isActive userId workspaceId connectedAt").lean();
        const claims = await PageClaim.find({}).lean();
        const claimMap = {};
        claims.forEach(c => { claimMap[c.facebookPageId] = c; });
        res.json({ success: true, totalPages: pages.length, pages: pages.map(p => ({ ...p, claim: claimMap[p.pageId] || null })) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ─── Manual sync ──────────────────────────────────────────────────────────────
const manualSync = async (req, res) => {
    try {
        const { pageId, pageName, pageAccessToken, userId } = req.body;
        if (!pageId || !pageName || !pageAccessToken || !userId) {
            return res.status(400).json({ success: false, message: "pageId, pageName, pageAccessToken, userId required" });
        }

        // Token validation
        try {
            const appToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;
            const debug = await axios.get(`${GRAPH_API}/debug_token`, {
                params: { input_token: pageAccessToken, access_token: appToken },
            });
            if (!debug.data?.data?.is_valid) {
                return res.status(400).json({ success: false, message: "Token is invalid" });
            }
        } catch (_) { /* non-blocking */ }

        const dbUser = await User.findOne({ firebaseUid: userId });
        const workspaceId = dbUser?.currentWorkspaceId || null;

        // Global uniqueness check
        const existing = await Page.findOne({ pageId, isActive: true });
        if (existing && String(existing.workspaceId) !== String(workspaceId)) {
            return res.status(409).json({ success: false, message: "This page is actively connected to another workspace" });
        }

        const page = await Page.findOneAndUpdate(
            { userId, pageId },
            { workspaceId, pageName, pageAccessToken, pagePicture: "", connectedAt: Date.now(), isActive: true },
            { new: true, upsert: true }
        );

        try {
            await axios.post(
                `${GRAPH_API}/${pageId}/subscribed_apps`,
                new URLSearchParams({
                    access_token: pageAccessToken,
                    subscribed_fields: "messages,messaging_postbacks,message_deliveries,message_echoes,message_reads",
                }).toString(),
                { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
            );
        } catch (_) { /* non-blocking */ }

        res.json({ success: true, message: `Page "${pageName}" synced!`, data: { pageId: page.pageId, pageName: page.pageName } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

export { facebookLogin, facebookCallback, resubscribePages, debugPages, manualSync };
