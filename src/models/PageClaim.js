import mongoose from "mongoose";

/**
 * PageClaim — permanent record of which workspace first claimed a Facebook Page.
 *
 * Purpose: prevent free-tier abuse.
 *
 * Rules enforced:
 *   - One Facebook page can only claim the free quota ONCE, ever.
 *   - Disconnecting a page does NOT reset its trial eligibility.
 *   - A page reconnected to a NEW account does NOT get a new free quota.
 *   - Only paid plans (approved via payment) can be used by pages that
 *     have already exhausted their free tier.
 *
 * This record is NEVER deleted, even when the page is disconnected.
 */
const pageClaimSchema = new mongoose.Schema(
    {
        // The Facebook Page ID — globally unique identifier
        facebookPageId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        // Workspace that first claimed this page
        workspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            required: true,
        },
        // User who first connected this page
        claimedByUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        // True once free quota has been granted — cannot be reset
        trialUsed: {
            type: Boolean,
            default: true,
        },
        claimedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

const PageClaim = mongoose.model("PageClaim", pageClaimSchema);
export default PageClaim;
