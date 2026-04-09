import Conversation from "../models/Conversation.js";
import ConversationMessage from "../models/ConversationMessage.js";
import Page from "../models/Page.js";

// ─── Helper ───────────────────────────────────────────────────────────────────
// Verify a page belongs to the current workspace.
const verifyPageOwnership = async (pageId, workspaceId) => {
    if (!workspaceId) return null;
    return Page.findOne({ pageId, workspaceId, isActive: true }).lean();
};

// GET /api/conversations/:pageId — list conversations for a page
const getConversations = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const workspaceId = req.workspace?._id;

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const conversations = await Conversation.find({ pageId })
            .sort({ lastMessageAt: -1 })
            .select("senderId profile lastMessageAt humanActive lastHumanReplyAt messageCount")
            .lean();

        // Fetch last message per conversation from ConversationMessage (scalable store).
        // Uses a single aggregation to avoid N+1 queries.
        const convIds = conversations.map((c) => c._id);
        const lastMsgs = await ConversationMessage.aggregate([
            { $match: { conversationId: { $in: convIds } } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: "$conversationId",
                    content: { $first: "$content" },
                    role: { $first: "$role" },
                },
            },
        ]);

        const lastMsgMap = {};
        lastMsgs.forEach((m) => { lastMsgMap[String(m._id)] = m; });

        const data = conversations.map((c) => {
            const last = lastMsgMap[String(c._id)];
            return {
                _id: c._id,
                senderId: c.senderId,
                name: c.profile?.name || null,
                profilePic: c.profile?.profilePic || null,
                lastMessage: last?.content || "",
                lastMessageRole: last?.role || "",
                lastMessageAt: c.lastMessageAt,
                humanActive: c.humanActive,
                messageCount: c.messageCount || 0,
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// GET /api/conversations/:pageId/:senderId — full conversation thread
const getConversationThread = async (req, res, next) => {
    try {
        const { pageId, senderId } = req.params;
        const workspaceId = req.workspace?._id;
        const page_num = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const skip = (page_num - 1) * limit;

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const conversation = await Conversation.findOne({ pageId, senderId })
            .select("-messages") // exclude embedded messages — ConversationMessage is canonical
            .lean();

        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        // Primary: read from ConversationMessage collection (scalable store)
        const [messages, total] = await Promise.all([
            ConversationMessage.find({ conversationId: conversation._id })
                .sort({ createdAt: 1 })
                .skip(skip)
                .limit(limit)
                .select("role content createdAt attachmentType")
                .lean(),
            ConversationMessage.countDocuments({ conversationId: conversation._id }),
        ]);

        res.json({
            success: true,
            data: {
                _id: conversation._id,
                senderId: conversation.senderId,
                profile: conversation.profile,
                name: conversation.profile?.name || null,
                profilePic: conversation.profile?.profilePic || null,
                messages,
                totalMessages: total,
                page: page_num,
                limit,
                humanActive: conversation.humanActive,
                lastHumanReplyAt: conversation.lastHumanReplyAt,
                lastMessageAt: conversation.lastMessageAt,
                contextStory: conversation.contextStory,
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
        const workspaceId = req.workspace?._id;

        if (typeof humanActive !== "boolean") {
            return res.status(400).json({ success: false, message: "humanActive must be a boolean" });
        }

        const conversation = await Conversation.findById(id);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        // Verify page belongs to workspace
        const page = await verifyPageOwnership(conversation.pageId, workspaceId);
        if (!page) {
            return res.status(403).json({ success: false, message: "Unauthorized access to this conversation" });
        }

        conversation.humanActive = humanActive;
        await conversation.save();

        res.json({ success: true, data: { _id: conversation._id, humanActive: conversation.humanActive } });
    } catch (error) {
        next(error);
    }
};

export { getConversations, getConversationThread, toggleHumanActive };
