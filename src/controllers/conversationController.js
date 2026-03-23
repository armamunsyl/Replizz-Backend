import Conversation from "../models/Conversation.js";
import Page from "../models/Page.js";

// GET /api/conversations/:pageId — list conversations for a page
const getConversations = async (req, res, next) => {
    try {
        const { pageId } = req.params;

        // Verify page belongs to user
        const page = await Page.findOne({ pageId, userId: req.user.uid });
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const conversations = await Conversation.find({ pageId })
            .sort({ lastMessageAt: -1 })
            .select("senderId profile messages lastMessageAt humanActive lastHumanReplyAt")
            .lean();

        // Map to include last message preview
        const data = conversations.map((c) => {
            const lastMsg = c.messages?.[c.messages.length - 1];
            return {
                _id: c._id,
                senderId: c.senderId,
                name: c.profile?.name || null,
                profilePic: c.profile?.profilePic || null,
                lastMessage: lastMsg?.content || "",
                lastMessageRole: lastMsg?.role || "",
                lastMessageAt: c.lastMessageAt,
                humanActive: c.humanActive,
                messageCount: c.messages?.length || 0,
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// GET /api/conversations/:pageId/:senderId — get single conversation thread
const getConversationThread = async (req, res, next) => {
    try {
        const { pageId, senderId } = req.params;

        // Verify page belongs to user
        const page = await Page.findOne({ pageId, userId: req.user.uid });
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const conversation = await Conversation.findOne({ pageId, senderId }).lean();
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        res.json({
            success: true,
            data: {
                _id: conversation._id,
                senderId: conversation.senderId,
                profile: conversation.profile,
                name: conversation.profile?.name || null,
                profilePic: conversation.profile?.profilePic || null,
                messages: conversation.messages,
                humanActive: conversation.humanActive,
                lastHumanReplyAt: conversation.lastHumanReplyAt,
                lastMessageAt: conversation.lastMessageAt,
            },
        });
    } catch (error) {
        next(error);
    }
};

// PATCH /api/conversations/:id/human-toggle
const toggleHumanActive = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { humanActive } = req.body;

        if (typeof humanActive !== "boolean") {
            return res.status(400).json({ success: false, message: "humanActive must be a boolean" });
        }

        const conversation = await Conversation.findById(id);

        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        // Verify page belongs to user
        const page = await Page.findOne({ pageId: conversation.pageId, userId: req.user.uid });
        if (!page) {
            return res.status(403).json({ success: false, message: "Unauthorized access to this conversation" });
        }

        conversation.humanActive = humanActive;
        // Optionally update lastHumanReplyAt if toggled to true manually, though typically it reflects actual messages
        await conversation.save();

        res.json({ success: true, data: conversation });
    } catch (error) {
        next(error);
    }
};

export { getConversations, getConversationThread, toggleHumanActive };
