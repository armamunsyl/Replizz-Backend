import mongoose from "mongoose";

/**
 * Workspace — the billing/account unit for a Replizz business.
 *
 * One user can own one workspace (auto-created on first page connect).
 * The workspace is the single source of truth for plan, quota, and billing state.
 * Multiple users can be members of the same workspace via WorkspaceMember.
 */
const workspaceSchema = new mongoose.Schema(
    {
        // MongoDB User._id of the workspace owner
        ownerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        // Human-readable workspace name (usually the page/business name)
        name: {
            type: String,
            default: "My Workspace",
            trim: true,
        },
        // ── Plan / Billing ─────────────────────────────────────────────────
        planCode: {
            type: String,
            enum: ["free", "standard", "pro", "custom"],
            default: "free",
        },
        planStatus: {
            type: String,
            enum: ["active", "expired", "suspended", "trial"],
            default: "active",
        },
        // Total replies allowed per billing period
        replyLimit: {
            type: Number,
            default: 100,
        },
        // Replies consumed in current billing period
        usedReplies: {
            type: Number,
            default: 0,
        },
        billingPeriodStart: {
            type: Date,
            default: null,
        },
        billingPeriodEnd: {
            type: Date,
            default: null,
        },
        // ── Trial / Suspension ─────────────────────────────────────────────
        isTrial: {
            type: Boolean,
            default: false,
        },
        trialExpiresAt: {
            type: Date,
            default: null,
        },
        isSuspended: {
            type: Boolean,
            default: false,
        },
        suspensionReason: {
            type: String,
            default: "",
        },
    },
    { timestamps: true }
);

// Each user can own at most one workspace (enforced at app layer, not DB)
workspaceSchema.index({ ownerUserId: 1 });

const Workspace = mongoose.model("Workspace", workspaceSchema);
export default Workspace;
