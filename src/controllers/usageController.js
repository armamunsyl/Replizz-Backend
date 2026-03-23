import UsageLog from "../models/UsageLog.js";
import Page from "../models/Page.js";

// @desc    Get usage for a specific page
// @route   GET /api/usage/:pageId
// @access  Private
const getUsageByPage = async (req, res, next) => {
    try {
        // Verify ownership
        const page = await Page.findOne({
            pageId: req.params.pageId,
            userId: req.user.uid,
        });

        if (!page) {
            res.status(404);
            throw new Error("Page not found or not owned by user");
        }

        const usage = await UsageLog.aggregate([
            { $match: { pageId: req.params.pageId } },
            {
                $group: {
                    _id: null,
                    totalTokensIn: { $sum: "$tokensIn" },
                    totalTokensOut: { $sum: "$tokensOut" },
                    totalCost: { $sum: "$totalCost" },
                    messageCount: { $sum: 1 },
                },
            },
        ]);

        const recentLogs = await UsageLog.find({ pageId: req.params.pageId })
            .sort({ createdAt: -1 })
            .limit(50);

        res.json({
            success: true,
            data: {
                summary: usage[0] || {
                    totalTokensIn: 0,
                    totalTokensOut: 0,
                    totalCost: 0,
                    messageCount: 0,
                },
                recentLogs,
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get total usage across all user's pages
// @route   GET /api/usage
// @access  Private
const getUsageSummary = async (req, res, next) => {
    try {
        // Get all page IDs for this user
        const pages = await Page.find({ userId: req.user.uid }).select("pageId");
        const pageIds = pages.map((p) => p.pageId);

        const usage = await UsageLog.aggregate([
            { $match: { pageId: { $in: pageIds } } },
            {
                $group: {
                    _id: null,
                    totalTokensIn: { $sum: "$tokensIn" },
                    totalTokensOut: { $sum: "$tokensOut" },
                    totalCost: { $sum: "$totalCost" },
                    messageCount: { $sum: 1 },
                },
            },
        ]);

        res.json({
            success: true,
            data: usage[0] || {
                totalTokensIn: 0,
                totalTokensOut: 0,
                totalCost: 0,
                messageCount: 0,
            },
        });
    } catch (error) {
        next(error);
    }
};

export { getUsageByPage, getUsageSummary };
