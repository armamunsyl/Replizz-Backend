import User from "../models/User.js";
import Page from "../models/Page.js";
import MessageLog from "../models/MessageLog.js";
import Conversation from "../models/Conversation.js";
import admin from "../config/firebaseAdmin.js";

// ─── GET /api/admin/users ───
const getAllUsers = async (req, res, next) => {
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

            // Determine plan based on highest page plan, or default to free
            const isPro = userPages.some(p => p.planType === 'pro');
            const plan = isPro ? 'pro' : 'free';

            return {
                ...user,
                uid: uid || null,
                pages: userPages,
                planType: plan
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
const getAnalytics = async (req, res, next) => {
    try {
        const [userCount, pageCount, conversationCount, messageStats] = await Promise.all([
            User.countDocuments(),
            Page.countDocuments(),
            Conversation.countDocuments(),
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

        res.json({
            success: true,
            data: {
                userCount,
                pageCount,
                conversationCount,
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
const getAllPages = async (req, res, next) => {
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

// ─── PUT /api/admin/pages/:pageId/plan ───
const updatePagePlan = async (req, res, next) => {
    try {
        const { planType, monthlyLimit } = req.body;
        
        if (!["free", "pro"].includes(planType)) {
            return res.status(400).json({ success: false, message: "Invalid plan type. Must be 'free' or 'pro'" });
        }

        const limitNum = parseInt(monthlyLimit, 10);
        if (isNaN(limitNum) || limitNum < 0) {
            return res.status(400).json({ success: false, message: "Invalid monthly limit" });
        }

        const page = await Page.findOneAndUpdate(
            { pageId: req.params.pageId },
            { 
                planType, 
                monthlyLimit: limitNum 
            },
            { new: true }
        ).select("-pageAccessToken");

        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        res.json({ success: true, data: page });
    } catch (error) {
        next(error);
    }
};

export { getAllUsers, updateUserRole, deleteUser, getAnalytics, getReports, getAllPages, updatePagePlan };
