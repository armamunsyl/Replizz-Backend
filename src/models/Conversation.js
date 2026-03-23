import mongoose from "mongoose";

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
    messages: {
        type: [messageSchema],
        default: [],
    },
    lastMessageAt: {
        type: Date,
        default: Date.now,
    },
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

const Conversation = mongoose.model("Conversation", conversationSchema);
export default Conversation;
