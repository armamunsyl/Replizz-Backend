import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import WorkspaceMember from "../models/WorkspaceMember.js";

/**
 * attachWorkspace — loads the active workspace for the authenticated user.
 *
 * Must run AFTER the Firebase `protect` middleware (req.user set).
 *
 * Attaches to req:
 *   req.dbUser      — MongoDB User document
 *   req.workspace   — Workspace document the user belongs to
 *   req.workspaceRole — the user's role in that workspace
 *
 * Resolution order:
 *   1. Look up User by email from Firebase token
 *   2. If user has currentWorkspaceId → load that workspace
 *   3. Else look up WorkspaceMember record to find their workspace
 *   4. Else workspace is null (user hasn't connected a page yet)
 */
export const attachWorkspace = async (req, res, next) => {
    try {
        const email = req.user?.email;
        if (!email) {
            return res.status(401).json({ success: false, message: "No email in token" });
        }

        const dbUser = await User.findOne({ email }).select("-passwordHash").lean();
        if (!dbUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        req.dbUser = dbUser;

        // Prefer the user's own workspace
        let workspace = null;
        let workspaceRole = null;

        if (dbUser.currentWorkspaceId) {
            workspace = await Workspace.findById(dbUser.currentWorkspaceId).lean();
            if (workspace) {
                workspaceRole = String(workspace.ownerUserId) === String(dbUser._id) ? "owner" : "admin";
            }
        }

        // Fallback: check WorkspaceMember
        if (!workspace) {
            const membership = await WorkspaceMember.findOne({ userId: dbUser._id }).lean();
            if (membership) {
                workspace = await Workspace.findById(membership.workspaceId).lean();
                workspaceRole = membership.role;
            }
        }

        req.workspace = workspace;
        req.workspaceRole = workspaceRole;
        next();
    } catch (err) {
        console.error("attachWorkspace error:", err.message);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * requireWorkspace — ensures req.workspace is set.
 * Use after attachWorkspace for routes that need an active workspace.
 */
export const requireWorkspace = (req, res, next) => {
    if (!req.workspace) {
        return res.status(403).json({
            success: false,
            message: "No active workspace. Connect a Facebook page first.",
        });
    }
    next();
};

/**
 * requireWorkspaceRole — restrict a route to specific workspace roles.
 * @param {...string} roles - allowed roles ('owner', 'admin', 'moderator', 'viewer')
 */
export const requireWorkspaceRole = (...roles) => (req, res, next) => {
    if (!req.workspaceRole || !roles.includes(req.workspaceRole)) {
        return res.status(403).json({
            success: false,
            message: `Workspace role required: ${roles.join(" or ")}`,
        });
    }
    next();
};

/**
 * checkQuota — enforce workspace reply limit before processing.
 * Attaches req.workspace for downstream use. Must run after attachWorkspace.
 */
export const checkQuota = (req, res, next) => {
    const ws = req.workspace;
    if (!ws) return next(); // no workspace → handled by webhook's own fallback

    if (ws.isSuspended) {
        return res.status(403).json({
            success: false,
            message: "Workspace is suspended. Please contact support.",
        });
    }

    if (ws.usedReplies >= ws.replyLimit) {
        return res.status(429).json({
            success: false,
            message: "Monthly reply limit reached. Please upgrade your plan.",
        });
    }

    next();
};
