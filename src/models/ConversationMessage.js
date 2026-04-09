import mongoose from "mongoose";

/**
 * ConversationMessage — individual message document in its own collection.
 *
 * Replaces the embedded `messages` array in Conversation documents.
 *
 * Why:
 *   - Embedded arrays grow unbounded and risk hitting MongoDB's 16MB document limit.
 *   - Separate collection allows indexed queries, pagination, and aggregation.
 *   - Enables efficient inbox history loading without pulling full conversation docs.
 *   - Supports per-message token/cost attribution for accurate billing analytics.
 *
 * Backward compat:
 *   - Conversation.messages (the old embedded array) is kept during transition.
 *   - Webhook writes to BOTH collections; clients reading ConversationMessage get
 *     the authoritative scalable history.
 */
const conversationMessageSchema = new mongoose.Schema(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Conversation",
            required: true,
            index: true,
        },
        workspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            required: true,
            index: true,
        },
        // Facebook page ID (string, for fast webhook lookups)
        pageId: {
            type: String,
            required: true,
            index: true,
        },
        // Facebook sender PSID
        senderId: {
            type: String,
            required: true,
            index: true,
        },
        role: {
            type: String,
            enum: ["user", "assistant", "admin"],
            required: true,
        },
        content: {
            type: String,
            required: true,
        },
        // Token usage — only set for assistant messages
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
        // Optional: attachment metadata
        attachmentType: {
            type: String,
            default: null, // 'image' | 'file' | null
        },
    },
    { timestamps: true }
);

// Compound index for conversation history queries (ordered by time)
conversationMessageSchema.index({ conversationId: 1, createdAt: 1 });
// For page-level inbox queries
conversationMessageSchema.index({ pageId: 1, senderId: 1, createdAt: -1 });
// For workspace-level analytics
conversationMessageSchema.index({ workspaceId: 1, createdAt: -1 });

const ConversationMessage = mongoose.model("ConversationMessage", conversationMessageSchema);
export default ConversationMessage;
