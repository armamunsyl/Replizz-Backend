import MessageLog from "../models/MessageLog.js";
import Page from "../models/Page.js";
import Conversation from "../models/Conversation.js";
import { sendMessage } from "../services/facebookService.js";
import { updateContextStory } from "../../utils/openai.js";

const getMessageLogs = async (req, res, next) => {
    try {
        const { pageId } = req.params;

        const logs = await MessageLog.find({
            pageId,
            userId: req.user.uid,
        }).sort({ createdAt: -1 });

        res.json({ success: true, data: logs });
    } catch (error) {
        next(error);
    }
};

// POST /api/messages/send — send a manual reply from the dashboard
const sendManualMessage = async (req, res, next) => {
    try {
        const { pageId, senderId, text } = req.body;

        if (!pageId || !senderId || !text?.trim()) {
            return res.status(400).json({ success: false, message: "pageId, senderId and text are required" });
        }

        // Verify page belongs to this user
        const page = await Page.findOne({ pageId, userId: req.user.uid });
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        // Send via Facebook Graph API
        await sendMessage(page.pageAccessToken, senderId, text.trim());

        // Save admin message to conversation + set humanActive
        const conversation = await Conversation.findOneAndUpdate(
            { pageId, senderId },
            {
                humanActive: true,
                lastHumanReplyAt: Date.now(),
                $push: {
                    messages: {
                        $each: [{ role: "admin", content: text.trim() }],
                        $slice: -50,
                    },
                },
                $inc: { messageCount: 1 },
                lastMessageAt: Date.now(),
            },
            { new: true, upsert: true }
        );

        // Update context story
        try {
            const updatedStory = await updateContextStory(conversation.contextStory, "admin", text.trim());
            await Conversation.findOneAndUpdate(
                { pageId, senderId },
                { $set: { contextStory: updatedStory } }
            );
        } catch (storyErr) {
            console.log("Context story update error (manual send):", storyErr.message);
        }

        const savedMsg = conversation.messages[conversation.messages.length - 1];
        res.json({ success: true, data: savedMsg });
    } catch (error) {
        next(error);
    }
};

export { getMessageLogs, sendManualMessage };
