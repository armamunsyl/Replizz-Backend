import MessageLog from "../models/MessageLog.js";

const getPageStats = async (req, res, next) => {
    try {
        const { pageId } = req.params;

        const result = await MessageLog.aggregate([
            { $match: { pageId, userId: req.user.uid } },
            {
                $group: {
                    _id: null,
                    messagesProcessed: { $sum: 1 },
                    inputTokens: { $sum: "$inputTokens" },
                    outputTokens: { $sum: "$outputTokens" },
                    totalTokens: { $sum: "$totalTokens" },
                    estimatedCost: { $sum: "$estimatedCost" },
                },
            },
        ]);

        const stats = result[0] || {
            messagesProcessed: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCost: 0,
        };

        delete stats._id;

        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

export { getPageStats };
