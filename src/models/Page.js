import mongoose from "mongoose";

/**
 * Page (ConnectedPage) — a Facebook Page connected to Replizz.
 *
 * Architecture rules enforced here:
 *   - One Facebook page can only be ACTIVELY connected to ONE workspace at a time.
 *     Enforced via the unique partial index on { pageId, isActive: true }.
 *   - The workspaceId is the authoritative owner reference.
 *   - userId (Firebase UID string) is kept for backward compatibility with
 *     the OAuth flow and existing controller queries.
 */
const pageSchema = new mongoose.Schema(
    {
        // ── Ownership ────────────────────────────────────────────────────────
        // Workspace that owns this page connection
        workspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            index: true,
            default: null,
        },
        // Firebase UID of the user who connected this page (backward compat)
        userId: {
            type: String,
            required: true,
            index: true,
        },
        // ── Facebook Page Identity ───────────────────────────────────────────
        pageId: {
            type: String,
            required: true,
        },
        pageName: {
            type: String,
            required: true,
        },
        pagePicture: {
            type: String,
            default: "",
        },
        pageAccessToken: {
            type: String,
            required: true,
        },
        connectedAt: {
            type: Date,
            default: Date.now,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        // ── AI / Automation Settings ─────────────────────────────────────────
        aiEnabled: {
            type: Boolean,
            default: true,
        },
        automationEnabled: {
            type: Boolean,
            default: true,
        },
        language: {
            type: String,
            default: "English",
        },
        tone: {
            type: String,
            default: "Professional",
        },
        replyStyle: {
            type: String,
            default: "Short and helpful",
        },
        // Inline custom instructions (quick override).
        // Full instruction list lives in PageInstruction collection.
        customInstructions: {
            type: String,
            default: "",
        },
        // ── Page-Level Analytics ─────────────────────────────────────────────
        totalMessages: {
            type: Number,
            default: 0,
        },
        totalAIReplies: {
            type: Number,
            default: 0,
        },
        monthlyUsageCount: {
            type: Number,
            default: 0,
        },
        totalTokensUsed: {
            type: Number,
            default: 0,
        },
        // ── Legacy page-level plan (deprecated — plan lives on Workspace now) ─
        planType: {
            type: String,
            enum: ["free", "pro"],
            default: "free",
        },
        monthlyLimit: {
            type: Number,
            default: 100,
        },
    },
    { timestamps: true }
);

// Per-user ownership — prevents duplicate records for the same owner + page
pageSchema.index({ userId: 1, pageId: 1 }, { unique: true });

// Global active-page uniqueness:
// Only ONE workspace can actively hold a given Facebook page at a time.
// Partial index fires only when isActive === true, so disconnected pages
// (isActive: false) are not subject to the constraint and can be re-archived.
pageSchema.index(
    { pageId: 1 },
    {
        unique: true,
        partialFilterExpression: { isActive: true },
        name: "unique_active_pageId",
    }
);

const Page = mongoose.model("Page", pageSchema);
export default Page;
