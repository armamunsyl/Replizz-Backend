import mongoose from "mongoose";

/**
 * WorkspaceMember — links a User to a Workspace with a role.
 *
 * Solves the multi-admin problem:
 *   - One Facebook page belongs to one active workspace.
 *   - Multiple people who need access to that page join the same workspace
 *     as members instead of each connecting the page under their own account.
 *
 * Roles:
 *   owner     — full control, created automatically with the workspace
 *   admin     — can manage pages, settings, members
 *   moderator — can view inbox and respond manually; limited settings access
 *   viewer    — read-only dashboard access
 */
const workspaceMemberSchema = new mongoose.Schema(
    {
        workspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        role: {
            type: String,
            enum: ["owner", "admin", "moderator", "viewer"],
            default: "admin",
        },
        invitedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        joinedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

// One membership record per user per workspace — no duplicates
workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

const WorkspaceMember = mongoose.model("WorkspaceMember", workspaceMemberSchema);
export default WorkspaceMember;
