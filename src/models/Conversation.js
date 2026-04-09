import mongoose from "mongoose";

/**
 * Conversation — thread state between a Facebook user (PSID) and a Page.
 *
 * Stores conversation-level state only.
 * Full scalable message history lives in ConversationMessage collection.
 *
 * The embedded `messages` array is kept for backward compatibility with
 * existing dashboard inbox reads ($slice: -50). New writes go to BOTH.
 */
const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ["user", "assistant", "admin"],
        required: true,
    },
    content: {
        type: String,
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
});

const conversationSchema = new mongoose.Schema({
    // Workspace that owns this conversation
    workspaceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Workspace",
        index: true,
        default: null,
    },
    pageId: {
        type: String,
        required: true,
        index: true,
    },
    senderId: {
        type: String,
        required: true,
        index: true,
    },
    profile: {
        name: { type: String, default: null },
        profilePic: { type: String, default: null },
    },
    // Backward-compat embedded history (capped at 50 by webhook)
    messages: {
        type: [messageSchema],
        default: [],
    },
    lastMessageAt: {
        type: Date,
        default: Date.now,
    },
    // Rolling context summary — primary AI memory source
    contextStory: {
        type: String,
        default: "",
    },
    messageCount: {
        type: Number,
        default: 0,
    },
    aiEnabled: {
        type: Boolean,
        default: true,
    },
    humanActive: {
        type: Boolean,
        default: false,
    },
    lastHumanReplyAt: {
        type: Date,
        default: null,
    },
    lastAiReplyAt: {
        type: Date,
        default: null,
    },
    lastImageContext: {
        type: String,
        default: null,
    },
    lastImageTimestamp: {
        type: Date,
        default: null,
    },
    lastReactionTime: {
        type: Date,
        default: null,
    },
});

conversationSchema.index({ pageId: 1, senderId: 1 }, { unique: true });
conversationSchema.index({ workspaceId: 1, lastMessageAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);
export default Conversation;
