import Page from "../models/Page.js";
import axios from "axios";
import {
    getOAuthURL,
    exchangeCodeForToken,
    getUserPages,
} from "../services/facebookService.js";

const GRAPH_API = "https://graph.facebook.com/v19.0";

// ─── Helper ───────────────────────────────────────────────────────────────────
// Resolve the workspace ID for the current request. Returns null if the user
// has no workspace yet (no pages connected).
const getWorkspaceId = (req) => req.workspace?._id || null;

// @desc    Get Facebook OAuth URL
// @route   GET /api/pages/auth/facebook
// @access  Private
const getFacebookAuthURL = (req, res) => {
    const url = getOAuthURL();
    res.json({ success: true, data: { url } });
};

// @desc    Handle Facebook OAuth callback — exchange code for token and return pages
// @route   GET /api/pages/auth/facebook/callback
// @access  Private
const handleFacebookCallback = async (req, res, next) => {
    try {
        const { code } = req.query;

        if (!code) {
            res.status(400);
            throw new Error("Authorization code is required");
        }

        const userAccessToken = await exchangeCodeForToken(code);
        const pages = await getUserPages(userAccessToken);

        res.json({ success: true, data: { pages } });
    } catch (error) {
        next(error);
    }
};

// @desc    Connect (save) a Facebook page — workspace-owned
// @route   POST /api/pages/connect
// @access  Private
const connectPage = async (req, res, next) => {
    try {
        const { pageId, pageName, pageAccessToken, pagePicture } = req.body;

        if (!pageId || !pageName || !pageAccessToken) {
            res.status(400);
            throw new Error("pageId, pageName, and pageAccessToken are required");
        }

        const workspaceId = getWorkspaceId(req);
        if (!workspaceId) {
            return res.status(403).json({ success: false, message: "No active workspace. Use Facebook OAuth to connect pages." });
        }

        // Enforce global uniqueness: one active connection per page
        const conflict = await Page.findOne({ pageId, isActive: true });
        if (conflict && String(conflict.workspaceId) !== String(workspaceId)) {
            return res.status(409).json({ success: false, message: "This page is already connected to another workspace." });
        }

        // Upsert — use workspaceId as the primary ownership key
        // userId is preserved for backward compat with the legacy unique index
        const page = await Page.findOneAndUpdate(
            { workspaceId, pageId },
            {
                workspaceId,
                userId: req.user.uid, // kept for DB index compat only
                pageName,
                pageAccessToken,
                pagePicture: pagePicture || "",
                isActive: true,
            },
            { new: true, upsert: true }
        );

        res.status(201).json({ success: true, data: page });
    } catch (error) {
        next(error);
    }
};

// @desc    List active pages for the current workspace
// @route   GET /api/pages
// @access  Private
const getMyPages = async (req, res, next) => {
    try {
        const workspaceId = getWorkspaceId(req);

        if (!workspaceId) {
            return res.json({ success: true, data: [] });
        }

        const pages = await Page.find({ workspaceId, isActive: true })
            .select("pageId pageName pagePicture aiEnabled automationEnabled connectedAt totalMessages monthlyUsageCount")
            .lean();

        res.json({ success: true, data: pages });
    } catch (error) {
        next(error);
    }
};

// @desc    Disconnect (deactivate) a page from the current workspace
// @route   DELETE /api/pages/:pageId
// @access  Private
const disconnectPage = async (req, res, next) => {
    try {
        const workspaceId = getWorkspaceId(req);
        if (!workspaceId) {
            return res.status(403).json({ success: false, message: "No active workspace." });
        }

        const page = await Page.findOne({ pageId: req.params.pageId, workspaceId });
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        // Unsubscribe webhook (best-effort)
        try {
            await axios.delete(
                `${GRAPH_API}/${page.pageId}/subscribed_apps`,
                { params: { access_token: page.pageAccessToken } }
            );
            await axios.delete(
                `${GRAPH_API}/${page.pageId}/permissions`,
                { params: { access_token: page.pageAccessToken } }
            );
        } catch (fbErr) {
            console.log("Facebook disconnect (non-fatal):", fbErr.response?.data || fbErr.message);
        }

        // Hard delete
        await Page.deleteOne({ pageId: req.params.pageId, workspaceId });

        res.json({ success: true, message: "Page removed successfully" });
    } catch (error) {
        next(error);
    }
};

// @desc    Update page AI settings
// @route   PATCH /api/pages/:pageId/settings
// @access  Private
const updatePageSettings = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const { aiEnabled, language, tone, replyStyle, customInstructions } = req.body;

        const workspaceId = getWorkspaceId(req);
        if (!workspaceId) {
            return res.status(403).json({ success: false, message: "No active workspace." });
        }

        const errors = [];
        if (aiEnabled !== undefined && typeof aiEnabled !== "boolean") errors.push("aiEnabled must be a boolean");
        if (language !== undefined && typeof language !== "string") errors.push("language must be a string");
        if (tone !== undefined && typeof tone !== "string") errors.push("tone must be a string");
        if (replyStyle !== undefined && typeof replyStyle !== "string") errors.push("replyStyle must be a string");
        if (customInstructions !== undefined && typeof customInstructions !== "string") errors.push("customInstructions must be a string");

        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(", ") });
        }

        const updateFields = {};
        if (aiEnabled !== undefined) updateFields.aiEnabled = aiEnabled;
        if (language !== undefined) updateFields.language = language;
        if (tone !== undefined) updateFields.tone = tone;
        if (replyStyle !== undefined) updateFields.replyStyle = replyStyle;
        if (customInstructions !== undefined) updateFields.customInstructions = customInstructions;

        const page = await Page.findOneAndUpdate(
            { pageId, workspaceId },
            { $set: updateFields },
            { new: true }
        ).select("-pageAccessToken");

        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        res.json({ success: true, data: page });
    } catch (error) {
        next(error);
    }
};

// @desc    Update AI settings (alias kept for API compatibility)
// @route   PATCH /api/pages/:pageId/ai-settings
// @access  Private
const updatePageAISettings = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const { customInstructions, language, replyStyle, tone } = req.body;

        const workspaceId = getWorkspaceId(req);
        if (!workspaceId) {
            return res.status(403).json({ success: false, message: "No active workspace." });
        }

        const page = await Page.findOne({ pageId, workspaceId });
        if (!page) {
            res.status(404);
            throw new Error("Page not found or unauthorized");
        }

        if (customInstructions !== undefined) page.customInstructions = String(customInstructions);
        if (language !== undefined) page.language = String(language);
        if (replyStyle !== undefined) page.replyStyle = String(replyStyle);
        if (tone !== undefined) page.tone = String(tone);

        const updatedPage = await page.save();
        res.json({ success: true, data: updatedPage });
    } catch (error) {
        next(error);
    }
};

// @desc    Toggle per-page automation
// @route   PATCH /api/pages/:pageId/automation
// @access  Private
const toggleAutomation = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const { automationEnabled } = req.body;

        if (typeof automationEnabled !== "boolean") {
            return res.status(400).json({ success: false, message: "automationEnabled must be a boolean" });
        }

        const workspaceId = getWorkspaceId(req);
        if (!workspaceId) {
            return res.status(403).json({ success: false, message: "No active workspace." });
        }

        const page = await Page.findOneAndUpdate(
            { pageId, workspaceId },
            { $set: { automationEnabled } },
            { new: true }
        ).select("pageId pageName automationEnabled aiEnabled");

        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        res.json({ success: true, data: page });
    } catch (error) {
        next(error);
    }
};

export {
    getFacebookAuthURL,
    handleFacebookCallback,
    connectPage,
    getMyPages,
    disconnectPage,
    updatePageSettings,
    updatePageAISettings,
    toggleAutomation,
};
