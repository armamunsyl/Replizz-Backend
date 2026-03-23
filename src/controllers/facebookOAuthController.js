import axios from "axios";
import admin from "../config/firebaseAdmin.js";
import Page from "../models/Page.js";

const GRAPH_API = "https://graph.facebook.com/v19.0";

/**
 * STEP 1 — Redirect user to Facebook OAuth dialog
 * Route: GET /api/facebook/login?token=FIREBASE_ID_TOKEN
 */
const facebookLogin = async (req, res) => {
    const token = req.query.token;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔵 STEP 1: Facebook OAuth Login initiated");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (!token) {
        console.log("❌ No Firebase token provided in query params");
        return res.status(401).json({ success: false, message: "Firebase token is required" });
    }

    // Verify the Firebase token is valid before redirecting
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        console.log("✅ Firebase token verified for UID:", decoded.uid);
    } catch (err) {
        console.error("❌ Firebase token verify FAILED:", err.message);
        return res.status(401).json({ success: false, message: "Invalid Firebase token" });
    }

    // Build the OAuth redirect URL
    const scopes = [
        "pages_show_list",
        "pages_manage_metadata",
        "pages_messaging",
    ];

    console.log("📋 OAuth scopes:", scopes.join(", "));
    console.log("📋 Redirect URI:", process.env.FACEBOOK_REDIRECT_URI);
    console.log("📋 App ID:", process.env.FACEBOOK_APP_ID);

    const params = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID,
        redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
        scope: scopes.join(","),
        response_type: "code",
        state: token,
        auth_type: "rerequest",
    });

    const url = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    console.log("🔗 Redirecting to Facebook OAuth dialog...");
    res.redirect(url);
};

/**
 * STEP 2-9 — Facebook OAuth Callback
 * Route: GET /api/facebook/callback?code=XXX&state=FIREBASE_TOKEN
 * 
 * Flow:
 *   1. Receive code + state from Facebook
 *   2. Exchange code → user access token  
 *   3. Call /me/accounts with user access token
 *   4. For each page: extract id, name, access_token, picture
 *   5. Upsert each page into MongoDB
 *   6. Subscribe webhooks
 *   7. Redirect to frontend
 */
const facebookCallback = async (req, res, next) => {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔵 STEP 2: Facebook OAuth Callback received");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    try {
        // ─── STEP 2a: Extract code and state ───
        const { code, state: firebaseToken } = req.query;

        console.log("📋 code received:", code ? `YES (${code.substring(0, 20)}...)` : "❌ NO");
        console.log("📋 state (Firebase token) received:", firebaseToken ? `YES (${firebaseToken.substring(0, 20)}...)` : "❌ NO");

        if (!code) {
            console.log("❌ ABORT: No authorization code from Facebook");
            return res.redirect(`${frontendUrl}/pages?error=missing_code`);
        }
        if (!firebaseToken) {
            console.log("❌ ABORT: No Firebase token in state parameter");
            return res.redirect(`${frontendUrl}/pages?error=missing_token`);
        }

        // ─── STEP 2b: Verify Firebase token → get userId ───
        let userId;
        try {
            const decoded = await admin.auth().verifyIdToken(firebaseToken);
            userId = decoded.uid;
            console.log("✅ Firebase token verified → userId:", userId);
        } catch (err) {
            console.error("❌ ABORT: Firebase token verification FAILED:", err.message);
            return res.redirect(`${frontendUrl}/pages?error=invalid_token`);
        }

        // ─── STEP 3: Exchange code → user access token ───
        console.log("\n🔵 STEP 3: Exchanging code for user access token...");
        console.log("📋 Using redirect_uri:", process.env.FACEBOOK_REDIRECT_URI);

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
            console.log("✅ User access token obtained:", userAccessToken ? `YES (${userAccessToken.substring(0, 30)}...)` : "❌ NO");

            if (!userAccessToken) {
                console.log("❌ ABORT: Token exchange returned empty access_token");
                console.log("   Full response:", JSON.stringify(tokenRes.data));
                return res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
            }
        } catch (tokenErr) {
            console.error("❌ ABORT: Token exchange FAILED:", JSON.stringify(tokenErr.response?.data || tokenErr.message));
            return res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
        }

        // ─── STEP 4: Debug the user access token ───
        console.log("\n🔵 STEP 4: Verifying user access token validity...");
        try {
            const appToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;
            const debugRes = await axios.get(`${GRAPH_API}/debug_token`, {
                params: {
                    input_token: userAccessToken,
                    access_token: appToken,
                },
            });

            const tokenData = debugRes.data?.data;
            console.log("📋 Token debug info:");
            console.log("   Valid:", tokenData?.is_valid);
            console.log("   Type:", tokenData?.type);
            console.log("   App ID:", tokenData?.app_id);
            console.log("   User ID:", tokenData?.user_id);
            console.log("   Scopes:", tokenData?.scopes?.join(", ") || "(none)");
            console.log("   Expires:", tokenData?.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : "never");

            if (!tokenData?.is_valid) {
                console.log("⚠️  WARNING: Token is marked as INVALID by Facebook!");
            }

            // Check for required scopes
            const requiredScopes = ["pages_show_list", "pages_manage_metadata", "pages_messaging"];
            const grantedScopes = tokenData?.scopes || [];
            const missingScopes = requiredScopes.filter(s => !grantedScopes.includes(s));
            if (missingScopes.length > 0) {
                console.log("⚠️  WARNING: Missing scopes:", missingScopes.join(", "));
                console.log("   This means the user may not have granted all permissions!");
            } else {
                console.log("✅ All required scopes are present");
            }
        } catch (debugErr) {
            console.log("⚠️  Token debug failed (non-blocking):", debugErr.response?.data?.error?.message || debugErr.message);
        }

        // ─── STEP 5: Fetch pages via /me/accounts ───
        console.log("\n🔵 STEP 5: Calling /me/accounts to fetch user's pages...");

        let fbPages;
        try {
            const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
                params: {
                    fields: "id,name,access_token,picture{url},tasks",
                    access_token: userAccessToken,
                },
            });

            console.log("━━━ RAW /me/accounts RESPONSE ━━━");
            console.log(JSON.stringify(pagesRes.data, null, 2));
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

            fbPages = pagesRes.data.data;

            console.log(`📋 Total pages returned by Facebook: ${fbPages?.length || 0}`);
            if (fbPages && fbPages.length > 0) {
                fbPages.forEach((p, i) => {
                    console.log(`   [${i + 1}] ${p.name} (ID: ${p.id})`);
                    console.log(`       access_token: ${p.access_token ? "YES" : "❌ MISSING"}`);
                    console.log(`       picture: ${p.picture?.data?.url ? "YES" : "none"}`);
                    console.log(`       tasks: ${p.tasks?.join(", ") || "(none returned)"}`);
                });
            }
        } catch (pagesErr) {
            console.error("❌ ABORT: /me/accounts call FAILED:", JSON.stringify(pagesErr.response?.data || pagesErr.message));
            return res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
        }

        // ─── STEP 6: Validate pages array ───
        console.log("\n🔵 STEP 6: Validating pages response...");

        if (!fbPages || fbPages.length === 0) {
            console.log("❌ No pages returned from Facebook for userId:", userId);
            console.log("   Possible causes:");
            console.log("   1. User is not an Admin of any Facebook Page");
            console.log("   2. User deselected all pages during OAuth consent");
            console.log("   3. Pages are managed by a Business Manager the user can't access");
            return res.redirect(`${frontendUrl}/pages?error=no_pages`);
        }

        console.log(`✅ ${fbPages.length} page(s) found. Proceeding to save...`);

        // ─── STEP 7-8: Save each page to MongoDB ───
        console.log("\n🔵 STEP 7-8: Saving pages to MongoDB...");

        const savedPages = [];
        const failedPages = [];

        for (const fbPage of fbPages) {
            const pictureUrl = fbPage.picture?.data?.url || "";

            console.log(`\n   ─── Processing: ${fbPage.name} (${fbPage.id}) ───`);
            console.log(`   userId: ${userId}`);
            console.log(`   pageId: ${fbPage.id} (type: ${typeof fbPage.id})`);
            console.log(`   pageName: ${fbPage.name}`);
            console.log(`   pageAccessToken: ${fbPage.access_token ? fbPage.access_token.substring(0, 30) + "..." : "❌ MISSING"}`);
            console.log(`   pagePicture: ${pictureUrl || "(none)"}`);

            if (!fbPage.access_token) {
                console.log(`   ❌ SKIPPING: No access_token for page ${fbPage.name}`);
                failedPages.push({ pageId: fbPage.id, pageName: fbPage.name, reason: "no_access_token" });
                continue;
            }

            // ─── DB Save with detailed error handling ───
            try {
                console.log(`   📝 DB SAVE: findOneAndUpdate with upsert...`);
                console.log(`   📝 Filter: { userId: "${userId}", pageId: "${fbPage.id}" }`);

                const page = await Page.findOneAndUpdate(
                    { userId, pageId: fbPage.id },
                    {
                        pageName: fbPage.name,
                        pageAccessToken: fbPage.access_token,
                        pagePicture: pictureUrl,
                        connectedAt: Date.now(),
                        isActive: true,
                    },
                    { new: true, upsert: true }
                );

                console.log(`   ✅ DB SAVE SUCCESS:`);
                console.log(`      _id: ${page._id}`);
                console.log(`      pageId: ${page.pageId}`);
                console.log(`      pageName: ${page.pageName}`);
                console.log(`      isActive: ${page.isActive}`);
                console.log(`      userId: ${page.userId}`);

                savedPages.push({
                    pageId: page.pageId,
                    pageName: page.pageName,
                    pagePicture: page.pagePicture,
                    isActive: page.isActive,
                });
            } catch (dbErr) {
                console.error(`   ❌ DB SAVE FAILED for ${fbPage.name}:`);
                console.error(`      Error name: ${dbErr.name}`);
                console.error(`      Error message: ${dbErr.message}`);
                console.error(`      Error code: ${dbErr.code || "N/A"}`);
                if (dbErr.code === 11000) {
                    console.error(`      ⚠️ DUPLICATE KEY ERROR — unique index conflict!`);
                    console.error(`      keyPattern: ${JSON.stringify(dbErr.keyPattern)}`);
                    console.error(`      keyValue: ${JSON.stringify(dbErr.keyValue)}`);
                }
                failedPages.push({ pageId: fbPage.id, pageName: fbPage.name, reason: dbErr.message });
                // Continue to next page — don't abort the entire flow
            }

            // ─── STEP 9: Subscribe webhooks ───
            try {
                console.log(`   📡 Subscribing ${fbPage.name} to webhooks...`);
                const subRes = await axios.post(
                    `${GRAPH_API}/${fbPage.id}/subscribed_apps`,
                    new URLSearchParams({
                        access_token: fbPage.access_token,
                        subscribed_fields: "messages,messaging_postbacks,message_deliveries,message_echoes,message_reads",
                    }).toString(),
                    {
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    }
                );
                console.log(`   ✅ Webhook subscribe response:`, JSON.stringify(subRes.data));
            } catch (subErr) {
                console.log(`   ⚠️ Webhook subscribe FAILED for ${fbPage.name}:`, JSON.stringify(subErr.response?.data));
                // Non-blocking — page is still saved
            }
        }

        // ─── FINAL SUMMARY ───
        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("🏁 OAUTH CALLBACK COMPLETE");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`   userId: ${userId}`);
        console.log(`   Pages from Facebook: ${fbPages.length}`);
        console.log(`   Pages saved to DB: ${savedPages.length}`);
        console.log(`   Pages failed: ${failedPages.length}`);
        if (failedPages.length > 0) {
            console.log(`   Failed pages:`, JSON.stringify(failedPages));
        }
        savedPages.forEach(p => console.log(`   ✅ ${p.pageName} (${p.pageId})`));
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        // Verify DB state after save
        try {
            const dbPages = await Page.find({ userId, isActive: true }).select("pageId pageName isActive").lean();
            console.log(`   📂 DB verification: ${dbPages.length} active pages for user ${userId}:`);
            dbPages.forEach(p => console.log(`      • ${p.pageName} (${p.pageId})`));
        } catch (verifyErr) {
            console.log("   ⚠️ DB verification query failed:", verifyErr.message);
        }

        res.redirect(`${frontendUrl}/pages?connected=${savedPages.length}`);
    } catch (error) {
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("❌ UNHANDLED ERROR in facebookCallback:");
        console.error("   Message:", error.message);
        console.error("   Stack:", error.stack?.split("\n").slice(0, 5).join("\n"));
        if (error.response?.data) {
            console.error("   API Error:", JSON.stringify(error.response.data));
        }
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        res.redirect(`${frontendUrl}/pages?error=oauth_failed`);
    }
};

/**
 * Re-subscribe all active pages to updated webhook fields.
 * Call this after updating subscribed_fields to fix existing pages.
 */
const resubscribePages = async (req, res) => {
    try {
        const pages = await Page.find({ isActive: true });
        console.log(`🔄 Re-subscribing ${pages.length} active pages...`);

        const results = [];
        for (const page of pages) {
            try {
                const subRes = await axios.post(
                    `${GRAPH_API}/${page.pageId}/subscribed_apps`,
                    new URLSearchParams({
                        access_token: page.pageAccessToken,
                        subscribed_fields: "messages,messaging_postbacks,message_deliveries,message_echoes,message_reads",
                    }).toString(),
                    {
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    }
                );
                console.log(`✅ Re-subscribed ${page.pageName} (${page.pageId}):`, JSON.stringify(subRes.data));
                results.push({ pageId: page.pageId, pageName: page.pageName, success: true });
            } catch (subErr) {
                console.log(`❌ Re-subscribe failed for ${page.pageName}:`, JSON.stringify(subErr.response?.data));
                results.push({ pageId: page.pageId, pageName: page.pageName, success: false, error: subErr.response?.data });
            }
        }

        res.json({ success: true, results });
    } catch (err) {
        console.log("Re-subscribe error:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Debug endpoint — check all page tokens and DB state.
 * Route: GET /api/facebook/debug
 */
const debugPages = async (req, res) => {
    try {
        const pages = await Page.find({}).select("pageId pageName isActive userId connectedAt").lean();
        const appToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;

        const results = [];
        for (const page of pages) {
            let tokenInfo = {};
            try {
                const fullPage = await Page.findById(page._id);
                const debugRes = await axios.get(`${GRAPH_API}/debug_token`, {
                    params: {
                        input_token: fullPage.pageAccessToken,
                        access_token: appToken,
                    },
                });
                const td = debugRes.data?.data;
                tokenInfo = {
                    valid: td?.is_valid,
                    type: td?.type,
                    scopes: td?.scopes,
                    expires: td?.expires_at ? new Date(td.expires_at * 1000).toISOString() : "never",
                };
            } catch (debugErr) {
                tokenInfo = { valid: false, error: debugErr.response?.data?.error?.message || debugErr.message };
            }

            results.push({
                pageId: page.pageId,
                pageName: page.pageName,
                isActive: page.isActive,
                userId: page.userId,
                connectedAt: page.connectedAt,
                token: tokenInfo,
            });
        }

        res.json({ success: true, totalPages: pages.length, pages: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Manually sync a page that /me/accounts doesn't return
 * (e.g. Business Manager-owned pages).
 *
 * Route: POST /api/facebook/manual-sync
 * Body:  { pageId, pageName, pageAccessToken, userId }
 *
 * The pageAccessToken can be obtained from:
 *   Facebook Developer Console → Messenger → Generate Access Tokens → click "Generate"
 * The pageId and pageName can be seen in the Developer Console next to the page.
 */
const manualSync = async (req, res) => {
    try {
        const { pageId, pageName, pageAccessToken, userId } = req.body;

        if (!pageId || !pageName || !pageAccessToken || !userId) {
            return res.status(400).json({
                success: false,
                message: "All fields required: pageId, pageName, pageAccessToken, userId",
            });
        }

        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("🔵 MANUAL SYNC: Adding page directly");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`   pageId: ${pageId}`);
        console.log(`   pageName: ${pageName}`);
        console.log(`   userId: ${userId}`);

        // Step 1: Validate token via debug_token (uses APP token, not page token)
        console.log("📋 Step 1: Validating token via debug_token...");
        try {
            const appToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;
            const debugRes = await axios.get(`${GRAPH_API}/debug_token`, {
                params: { input_token: pageAccessToken, access_token: appToken },
            });
            const td = debugRes.data?.data;
            console.log(`   Valid: ${td?.is_valid}`);
            console.log(`   Type: ${td?.type}`);
            console.log(`   Scopes: ${td?.scopes?.join(", ") || "(none)"}`);

            if (!td?.is_valid) {
                return res.status(400).json({ success: false, message: "Token is invalid according to Facebook" });
            }
        } catch (debugErr) {
            console.log("⚠️  debug_token failed (continuing anyway):", debugErr.message);
        }

        // Step 2: Save to DB
        console.log("📋 Step 2: Saving to MongoDB...");

        const page = await Page.findOneAndUpdate(
            { userId, pageId },
            {
                pageName,
                pageAccessToken,
                pagePicture: "",
                connectedAt: Date.now(),
                isActive: true,
            },
            { new: true, upsert: true }
        );

        console.log(`✅ DB SAVE SUCCESS: ${page.pageName} (${page.pageId}) → _id: ${page._id}`);

        // Step 3: Subscribe webhooks
        console.log("📋 Step 3: Subscribing webhooks...");
        try {
            const subRes = await axios.post(
                `${GRAPH_API}/${pageId}/subscribed_apps`,
                new URLSearchParams({
                    access_token: pageAccessToken,
                    subscribed_fields: "messages,messaging_postbacks,message_deliveries,message_echoes,message_reads",
                }).toString(),
                { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
            );
            console.log(`✅ Webhook subscribed:`, JSON.stringify(subRes.data));
        } catch (subErr) {
            console.log(`⚠️  Webhook subscribe failed:`, JSON.stringify(subErr.response?.data));
        }

        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`🏁 MANUAL SYNC COMPLETE: ${pageName} (${pageId})`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        res.json({
            success: true,
            message: `Page "${pageName}" successfully synced!`,
            data: { pageId: page.pageId, pageName: page.pageName, isActive: page.isActive },
        });
    } catch (err) {
        console.error("Manual sync error:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

export { facebookLogin, facebookCallback, resubscribePages, debugPages, manualSync };
