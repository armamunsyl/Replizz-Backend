import mongoose from "mongoose";

const messageLogSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true,
    },
    pageId: {
        type: String,
        required: true,
        index: true,
    },
    senderId: {
        type: String,
    },
    messageText: {
        type: String,
    },
    aiReply: {
        type: String,
    },
    inputTokens: {
        type: Number,
        default: 0,
    },
    outputTokens: {
        type: Number,
        default: 0,
    },
    totalTokens: {
        type: Number,
        default: 0,
    },
    estimatedCost: {
        type: Number,
        default: 0,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

const MessageLog = mongoose.model("MessageLog", messageLogSchema);
export default MessageLog;
