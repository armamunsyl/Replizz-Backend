import MessageLog from "../models/MessageLog.js";
import Page from "../models/Page.js";
import Conversation from "../models/Conversation.js";
import ConversationMessage from "../models/ConversationMessage.js";
import { sendMessage } from "../services/facebookService.js";
import { updateContextStory } from "../../utils/openai.js";

// GET /api/messages/:pageId — legacy message logs for a page
const getMessageLogs = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const workspaceId = req.workspace?._id;

        // Verify page belongs to workspace
        const page = await Page.findOne({ pageId, workspaceId, isActive: true }).lean();
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const logs = await MessageLog.find({ pageId }).sort({ createdAt: -1 });
        res.json({ success: true, data: logs });
    } catch (error) {
        next(error);
    }
};

// POST /api/messages/send — send a manual admin reply from the dashboard
const sendManualMessage = async (req, res, next) => {
    try {
        const { pageId, senderId, text } = req.body;

        if (!pageId || !senderId || !text?.trim()) {
            return res.status(400).json({ success: false, message: "pageId, senderId and text are required" });
        }

        const workspaceId = req.workspace?._id;

        // Verify page belongs to workspace
        const page = await Page.findOne({ pageId, workspaceId, isActive: true });
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        // Send via Facebook Graph API
        await sendMessage(page.pageAccessToken, senderId, text.trim());

        // Update conversation state
        const conversation = await Conversation.findOneAndUpdate(
            { pageId, senderId },
            {
                humanActive: true,
                lastHumanReplyAt: Date.now(),
                lastMessageAt: Date.now(),
                $inc: { messageCount: 1 },
                // Keep embedded messages for backward compat (capped)
                $push: {
                    messages: {
                        $each: [{ role: "admin", content: text.trim() }],
                        $slice: -50,
                    },
                },
                ...(workspaceId && { $setOnInsert: { workspaceId } }),
            },
            { new: true, upsert: true }
        );

        // Write to ConversationMessage — canonical scalable store
        await ConversationMessage.create({
            conversationId: conversation._id,
            workspaceId: workspaceId || conversation.workspaceId || null,
            pageId,
            senderId,
            role: "admin",
            content: text.trim(),
        });

        // Update context story (non-blocking)
        updateContextStory(conversation.contextStory, "admin", text.trim())
            .then((updatedStory) =>
                Conversation.findOneAndUpdate(
                    { pageId, senderId },
                    { $set: { contextStory: updatedStory } }
                )
            )
            .catch((err) => console.log("Context story update error (manual send):", err.message));

        res.json({
            success: true,
            data: { role: "admin", content: text.trim(), createdAt: new Date() },
        });
    } catch (error) {
        next(error);
    }
};

export { getMessageLogs, sendManualMessage };
