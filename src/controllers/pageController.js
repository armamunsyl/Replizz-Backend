import Page from "../models/Page.js";
import axios from "axios";
import {
    getOAuthURL,
    exchangeCodeForToken,
    getUserPages,
} from "../services/facebookService.js";

const GRAPH_API = "https://graph.facebook.com/v19.0";

// @desc    Get Facebook OAuth URL
// @route   GET /api/pages/auth/facebook
// @access  Private
const getFacebookAuthURL = (req, res) => {
    const url = getOAuthURL();
    res.json({ success: true, data: { url } });
};

// @desc    Handle Facebook OAuth callback – exchange code for token and return pages
// @route   GET /api/pages/auth/facebook/callback
// @access  Private
const handleFacebookCallback = async (req, res, next) => {
    try {
        const { code } = req.query;

        if (!code) {
            res.status(400);
            throw new Error("Authorization code is required");
        }

        // Exchange code for user access token
        const userAccessToken = await exchangeCodeForToken(code);

        // Fetch pages the user manages
        const pages = await getUserPages(userAccessToken);

        res.json({
            success: true,
            data: { pages },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Connect (save) a Facebook page
// @route   POST /api/pages/connect
// @access  Private
const connectPage = async (req, res, next) => {
    try {
        const { pageId, pageName, pageAccessToken, pagePicture } = req.body;

        if (!pageId || !pageName || !pageAccessToken) {
            res.status(400);
            throw new Error("pageId, pageName, and pageAccessToken are required");
        }

        // Upsert – update if already connected, create if new
        const page = await Page.findOneAndUpdate(
            { userId: req.user.uid, pageId },
            { pageName, pageAccessToken, pagePicture: pagePicture || "", isActive: true },
            { new: true, upsert: true }
        );

        res.status(201).json({ success: true, data: page });
    } catch (error) {
        next(error);
    }
};


const getMyPages = async (req, res, next) => {
    try {
        const filter = { userId: req.user.uid, isActive: true };
        const pages = await Page.find(filter)
            .select("pageId pageName pagePicture planType aiEnabled connectedAt")
            .lean();
        res.json({ success: true, data: pages });
    } catch (error) {
        next(error);
    }
};

// @desc    Disconnect (deactivate) a page
// @route   DELETE /api/pages/:pageId
// @access  Private
const disconnectPage = async (req, res, next) => {
    try {
        const page = await Page.findOne({
            pageId: req.params.pageId,
            userId: req.user.uid,
        });

        if (!page) {
            res.status(404);
            throw new Error("Page not found");
        }

        // Unsubscribe webhook from Facebook (best-effort)
        try {
            await axios.delete(
                `${GRAPH_API}/${page.pageId}/subscribed_apps`,
                { params: { access_token: page.pageAccessToken } }
            );
            console.log(`Unsubscribed webhook from page: ${page.pageName}`);

            // Also revoke permissions to completely remove the app from the page
            await axios.delete(
                `${GRAPH_API}/${page.pageId}/permissions`,
                { params: { access_token: page.pageAccessToken } }
            );
            console.log(`Revoked permissions for page: ${page.pageName}`);
        } catch (fbErr) {
            console.log("Facebook disconnect error (non-fatal):", fbErr.response?.data || fbErr.message);
        }

        // Hard delete from DB
        await Page.deleteOne({ pageId: req.params.pageId, userId: req.user.uid });
        console.log(`Page ${page.pageName} (${page.pageId}) permanently removed for user ${req.user.uid}`);

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

        console.log("Updating settings for page:", pageId);

        // Validate field types
        const errors = [];
        if (aiEnabled !== undefined && typeof aiEnabled !== "boolean") errors.push("aiEnabled must be a boolean");
        if (language !== undefined && typeof language !== "string") errors.push("language must be a string");
        if (tone !== undefined && typeof tone !== "string") errors.push("tone must be a string");
        if (replyStyle !== undefined && typeof replyStyle !== "string") errors.push("replyStyle must be a string");
        if (customInstructions !== undefined && typeof customInstructions !== "string") errors.push("customInstructions must be a string");

        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(", ") });
        }

        // Build update object with only provided fields
        const updateFields = {};
        if (aiEnabled !== undefined) updateFields.aiEnabled = aiEnabled;
        if (language !== undefined) updateFields.language = language;
        if (tone !== undefined) updateFields.tone = tone;
        if (replyStyle !== undefined) updateFields.replyStyle = replyStyle;
        if (customInstructions !== undefined) updateFields.customInstructions = customInstructions;

        console.log("Changed fields:", updateFields);

        const page = await Page.findOneAndUpdate(
            { pageId, userId: req.user.uid },
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

// @desc    Update AI Settings for a specific page
// @route   PATCH /api/pages/:pageId/ai-settings
// @access  Private
const updatePageAISettings = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const { customInstructions, language, replyStyle, tone } = req.body;

        const page = await Page.findOne({ pageId, userId: req.user.uid });

        if (!page) {
            res.status(404);
            throw new Error("Page not found or unauthorized");
        }

        // Only update fields that were provided in the request
        if (customInstructions !== undefined) page.customInstructions = String(customInstructions);
        if (language !== undefined) page.language = String(language);
        if (replyStyle !== undefined) page.replyStyle = String(replyStyle);
        if (tone !== undefined) page.tone = String(tone);

        const updatedPage = await page.save();

        res.json({
            success: true,
            data: updatedPage,
        });
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
};
