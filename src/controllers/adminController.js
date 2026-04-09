import User from "../models/User.js";
import Page from "../models/Page.js";
import MessageLog from "../models/MessageLog.js";
import Conversation from "../models/Conversation.js";
import Workspace from "../models/Workspace.js";
import WorkspaceMember from "../models/WorkspaceMember.js";
import admin from "../config/firebaseAdmin.js";

// ─── GET /api/admin/users ───
const getAllUsers = async (_req, res, next) => {
    try {
        const users = await User.find()
            .select("-passwordHash")
            .sort({ createdAt: -1 })
            .lean();

        // 1. Get all Firebase users to map email -> uid
        let listUsersResult;
        try {
            listUsersResult = await admin.auth().listUsers(1000);
        } catch (fbErr) {
            console.error("Firebase listUsers error:", fbErr);
            listUsersResult = { users: [] };
        }

        const emailToUid = {};
        listUsersResult.users.forEach(u => {
            if (u.email) emailToUid[u.email.toLowerCase()] = u.uid;
        });

        // 2. Fetch all pages
        const allPages = await Page.find().select("-pageAccessToken").lean();

        // Group pages by uid
        const pagesByUid = {};
        for (const p of allPages) {
            if (!pagesByUid[p.userId]) pagesByUid[p.userId] = [];
            pagesByUid[p.userId].push(p);
        }

        // 3. Attach pages and calculate plan info
        const enrichedUsers = users.map(user => {
            const uid = emailToUid[(user.email || "").toLowerCase()];
            const userPages = uid ? (pagesByUid[uid] || []) : [];

                return {
                ...user,
                uid: uid || null,
                pages: userPages,
                planType: user.planType || 'free',
                messageLimit: user.messageLimit || 100,
                usedMessages: user.usedMessages || 0,
            };
        });

        res.json({ success: true, data: enrichedUsers });
    } catch (error) {
        next(error);
    }
};

// ─── PUT /api/admin/users/:id/role ───
const updateUserRole = async (req, res, next) => {
    try {
        const { role } = req.body;
        const validRoles = ["User", "Moderator", "Admin"];

        if (!role || !validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role. Must be one of: ${validRoles.join(", ")}`,
            });
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { role },
            { new: true }
        ).select("-passwordHash");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

// ─── DELETE /api/admin/users/:id ───
const deleteUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Prevent self-deletion
        if (user.email === req.dbUser.email) {
            return res.status(400).json({ success: false, message: "Cannot delete yourself" });
        }

        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "User deleted" });
    } catch (error) {
        next(error);
    }
};

// ─── GET /api/admin/analytics ───
const getAnalytics = async (_req, res, next) => {
    try {
        const [
            userCount,
            pageCount,
            activePageCount,
            conversationCount,
            workspaceCount,
            workspacePlanDist,
            memberCount,
            messageStats,
        ] = await Promise.all([
            User.countDocuments(),
            Page.countDocuments(),
            Page.countDocuments({ isActive: true }),
            Conversation.countDocuments(),
            Workspace.countDocuments(),
            Workspace.aggregate([
                { $group: { _id: "$planCode", count: { $sum: 1 } } },
            ]),
            WorkspaceMember.countDocuments(),
            MessageLog.aggregate([
                {
                    $group: {
                        _id: null,
                        totalMessages: { $sum: 1 },
                        totalInputTokens: { $sum: "$inputTokens" },
                        totalOutputTokens: { $sum: "$outputTokens" },
                        totalTokens: { $sum: "$totalTokens" },
                        totalCost: { $sum: "$estimatedCost" },
                    },
                },
            ]),
        ]);

        const stats = messageStats[0] || {
            totalMessages: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            totalCost: 0,
        };
        delete stats._id;

        const planDistribution = { free: 0, standard: 0, pro: 0, custom: 0 };
        workspacePlanDist.forEach(p => {
            if (planDistribution[p._id] !== undefined) planDistribution[p._id] = p.count;
        });

        res.json({
            success: true,
            data: {
                userCount,
                pageCount,
                activePageCount,
                conversationCount,
                workspaceCount,
                memberCount,
                planDistribution,
                ...stats,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ─── GET /api/admin/reports ───
const getReports = async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const logs = await MessageLog.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        res.json({ success: true, data: logs });
    } catch (error) {
        next(error);
    }
};

// ─── GET /api/admin/pages ───
const getAllPages = async (_req, res, next) => {
    try {
        const pages = await Page.find()
            .select("-pageAccessToken")
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, data: pages });
    } catch (error) {
        next(error);
    }
};

// ─── PUT /api/admin/pages/:pageId/plan — REMOVED ───
// Page-level plan ownership is gone. Plans live on Workspace.
// Use PUT /api/admin/workspaces/:id/plan instead.
const updatePagePlan = (_req, res) => {
    res.status(410).json({
        success: false,
        message: "Page-level plans have been removed. Use PUT /api/admin/workspaces/:id/plan to manage workspace plans.",
    });
};

// ─── PUT /api/admin/users/:id/plan — REMOVED ───
// User-level plan ownership is gone. Plans live on Workspace.
// Use PUT /api/admin/workspaces/:id/plan instead.
const updateUserPlan = (_req, res) => {
    res.status(410).json({
        success: false,
        message: "User-level plans have been removed. Use PUT /api/admin/workspaces/:id/plan to manage workspace plans.",
    });
};

export { getAllUsers, updateUserRole, deleteUser, getAnalytics, getReports, getAllPages, updatePagePlan, updateUserPlan };
