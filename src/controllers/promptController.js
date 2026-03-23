import Prompt from "../models/Prompt.js";

// @desc    Get prompt for a page
// @route   GET /api/prompts/:pageId
// @access  Private
const getPrompt = async (req, res, next) => {
    try {
        const prompt = await Prompt.findOne({
            pageId: req.params.pageId,
            userId: req.user.uid,
        });

        if (!prompt) {
            return res.json({
                success: true,
                data: {
                    pageId: req.params.pageId,
                    template:
                        "You are a helpful customer support assistant. Reply politely and concisely to the following message.",
                    tone: "professional",
                    fallbackMessage:
                        "Thank you for your message! Our team will get back to you shortly.",
                },
            });
        }

        res.json({ success: true, data: prompt });
    } catch (error) {
        next(error);
    }
};

// @desc    Create or update prompt for a page
// @route   PUT /api/prompts/:pageId
// @access  Private
const upsertPrompt = async (req, res, next) => {
    try {
        const { template, tone, fallbackMessage } = req.body;

        const prompt = await Prompt.findOneAndUpdate(
            { pageId: req.params.pageId, userId: req.user.uid },
            { template, tone, fallbackMessage },
            { new: true, upsert: true }
        );

        res.json({ success: true, data: prompt });
    } catch (error) {
        next(error);
    }
};

export { getPrompt, upsertPrompt };
