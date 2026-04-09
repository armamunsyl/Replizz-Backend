import Workspace from "../models/Workspace.js";
import WorkspaceMember from "../models/WorkspaceMember.js";
import User from "../models/User.js";
import Page from "../models/Page.js";

// ─── GET /api/workspace/me ────────────────────────────────────────────────────
// Returns the current user's workspace with member count and connected page count.
export const getMyWorkspace = async (req, res, next) => {
    try {
        const workspace = req.workspace;
        if (!workspace) {
            return res.json({ success: true, data: null });
        }

        const [memberCount, pageCount] = await Promise.all([
            WorkspaceMember.countDocuments({ workspaceId: workspace._id }),
            Page.countDocuments({ workspaceId: workspace._id, isActive: true }),
        ]);

        res.json({
            success: true,
            data: { ...workspace, memberCount, pageCount },
        });
    } catch (err) {
        next(err);
    }
};

// ─── PATCH /api/workspace/me ──────────────────────────────────────────────────
// Update workspace name.
export const updateWorkspace = async (req, res, next) => {
    try {
        const { name } = req.body;
        if (!name || typeof name !== "string" || !name.trim()) {
            return res.status(400).json({ success: false, message: "Name is required" });
        }

        const workspace = await Workspace.findByIdAndUpdate(
            req.workspace._id,
            { name: name.trim() },
            { new: true }
        );

        res.json({ success: true, data: workspace });
    } catch (err) {
        next(err);
    }
};

// ─── GET /api/workspace/members ───────────────────────────────────────────────
export const getMembers = async (req, res, next) => {
    try {
        const members = await WorkspaceMember.find({ workspaceId: req.workspace._id })
            .populate("userId", "name email role")
            .lean();

        res.json({ success: true, data: members });
    } catch (err) {
        next(err);
    }
};

// ─── POST /api/workspace/members ──────────────────────────────────────────────
// Invite an existing Replizz user to the workspace by email.
export const addMember = async (req, res, next) => {
    try {
        const { email, role = "admin" } = req.body;
        const validRoles = ["admin", "moderator", "viewer"];

        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }
        if (!validRoles.includes(role)) {
            return res.status(400).json({ success: false, message: `Role must be one of: ${validRoles.join(", ")}` });
        }

        const targetUser = await User.findOne({ email: email.toLowerCase() }).select("_id name email");
        if (!targetUser) {
            return res.status(404).json({ success: false, message: "No Replizz account found with that email" });
        }

        // Don't allow adding the workspace owner as a member
        if (String(req.workspace.ownerUserId) === String(targetUser._id)) {
            return res.status(400).json({ success: false, message: "Workspace owner cannot be added as a member" });
        }

        const existing = await WorkspaceMember.findOne({
            workspaceId: req.workspace._id,
            userId: targetUser._id,
        });
        if (existing) {
            return res.status(400).json({ success: false, message: "User is already a member of this workspace" });
        }

        const member = await WorkspaceMember.create({
            workspaceId: req.workspace._id,
            userId: targetUser._id,
            role,
            invitedBy: req.dbUser._id,
        });

        res.status(201).json({
            success: true,
            data: { ...member.toObject(), userId: { _id: targetUser._id, name: targetUser.name, email: targetUser.email } },
        });
    } catch (err) {
        next(err);
    }
};

// ─── DELETE /api/workspace/members/:memberId ──────────────────────────────────
export const removeMember = async (req, res, next) => {
    try {
        const member = await WorkspaceMember.findOne({
            _id: req.params.memberId,
            workspaceId: req.workspace._id,
        });

        if (!member) {
            return res.status(404).json({ success: false, message: "Member not found" });
        }
        if (member.role === "owner") {
            return res.status(400).json({ success: false, message: "Cannot remove the workspace owner" });
        }

        await WorkspaceMember.deleteOne({ _id: member._id });
        res.json({ success: true, message: "Member removed" });
    } catch (err) {
        next(err);
    }
};

// ─── GET /api/workspace/usage ─────────────────────────────────────────────────
export const getUsage = async (req, res, next) => {
    try {
        const ws = req.workspace;
        if (!ws) return res.json({ success: true, data: null });

        const pct = ws.replyLimit > 0 ? Math.min(ws.usedReplies / ws.replyLimit, 1) : 0;

        res.json({
            success: true,
            data: {
                planCode: ws.planCode,
                planStatus: ws.planStatus,
                replyLimit: ws.replyLimit,
                usedReplies: ws.usedReplies,
                remainingReplies: Math.max(0, ws.replyLimit - ws.usedReplies),
                usagePct: Math.round(pct * 100),
                billingPeriodStart: ws.billingPeriodStart,
                billingPeriodEnd: ws.billingPeriodEnd,
                isSuspended: ws.isSuspended,
            },
        });
    } catch (err) {
        next(err);
    }
};

// ─── Admin: GET /api/workspace/all (admin only, via admin routes) ─────────────
export const getAllWorkspaces = async (req, res, next) => {
    try {
        const workspaces = await Workspace.find()
            .populate("ownerUserId", "name email")
            .sort({ createdAt: -1 })
            .lean();

        const wsWithCounts = await Promise.all(
            workspaces.map(async (ws) => {
                const [memberCount, pageCount] = await Promise.all([
                    WorkspaceMember.countDocuments({ workspaceId: ws._id }),
                    Page.countDocuments({ workspaceId: ws._id, isActive: true }),
                ]);
                return { ...ws, memberCount, pageCount };
            })
        );

        res.json({ success: true, data: wsWithCounts });
    } catch (err) {
        next(err);
    }
};

// ─── Admin: PUT /api/admin/workspaces/:id/plan ────────────────────────────────
export const adminUpdateWorkspacePlan = async (req, res, next) => {
    try {
        const { planCode, replyLimit, planStatus } = req.body;
        const validPlans = ["free", "standard", "pro", "custom"];

        if (planCode && !validPlans.includes(planCode)) {
            return res.status(400).json({ success: false, message: "Invalid planCode" });
        }

        const update = {};
        if (planCode) update.planCode = planCode;
        if (planStatus) update.planStatus = planStatus;
        if (replyLimit !== undefined) update.replyLimit = parseInt(replyLimit, 10);

        const workspace = await Workspace.findByIdAndUpdate(req.params.id, update, { new: true })
            .populate("ownerUserId", "name email");

        if (!workspace) {
            return res.status(404).json({ success: false, message: "Workspace not found" });
        }

        res.json({ success: true, data: workspace });
    } catch (err) {
        next(err);
    }
};
