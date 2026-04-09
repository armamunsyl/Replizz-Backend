import PaymentRequest from "../models/PaymentRequest.js";
import PaymentSettings from "../models/PaymentSettings.js";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";

// Plan limits mapping
const PLAN_LIMITS = {
    standard: 2000,
    pro: 10000,
    custom: 0, // set manually by admin
};

const PLAN_AMOUNTS = {
    standard: 299,
    pro: 499,
};

// ─── GET /api/payments/analytics ─── (admin/moderator)
export const getPaymentAnalytics = async (req, res, next) => {
    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [statusCounts, totalRevenue, monthRevenue, recent] = await Promise.all([
            // Count by status
            PaymentRequest.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            // Total approved revenue
            PaymentRequest.aggregate([
                { $match: { status: "approved" } },
                { $group: { _id: null, total: { $sum: "$amount" } } },
            ]),
            // This month approved revenue
            PaymentRequest.aggregate([
                { $match: { status: "approved", reviewedAt: { $gte: monthStart } } },
                { $group: { _id: null, total: { $sum: "$amount" } } },
            ]),
            // 10 most recent requests
            PaymentRequest.find()
                .sort({ createdAt: -1 })
                .limit(10)
                .populate("userId", "name email")
                .lean(),
        ]);

        const counts = { pending: 0, approved: 0, rejected: 0 };
        statusCounts.forEach(s => { if (counts[s._id] !== undefined) counts[s._id] = s.count; });

        res.json({
            success: true,
            data: {
                totalRevenue: totalRevenue[0]?.total || 0,
                monthRevenue: monthRevenue[0]?.total || 0,
                approvedCount: counts.approved,
                pendingCount: counts.pending,
                rejectedCount: counts.rejected,
                recent,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ─── GET /api/payments/settings ─── (public — user reads bKash number to pay)
export const getPaymentSettings = async (req, res, next) => {
    try {
        const settings = await PaymentSettings.findOne({ key: "global" }).lean();
        res.json({ success: true, data: { bkashNumber: settings?.bkashNumber || "" } });
    } catch (error) {
        next(error);
    }
};

// ─── PUT /api/payments/settings ─── (admin only)
export const updatePaymentSettings = async (req, res, next) => {
    try {
        const { bkashNumber } = req.body;
        if (!bkashNumber || typeof bkashNumber !== "string" || bkashNumber.trim().length < 11) {
            return res.status(400).json({ success: false, message: "Valid bKash number required (min 11 digits)" });
        }

        const settings = await PaymentSettings.findOneAndUpdate(
            { key: "global" },
            { bkashNumber: bkashNumber.trim(), updatedBy: req.dbUser._id },
            { new: true, upsert: true }
        );

        res.json({ success: true, data: settings });
    } catch (error) {
        next(error);
    }
};

// ─── POST /api/payments/submit ─── (authenticated user)
export const submitPaymentRequest = async (req, res, next) => {
    try {
        const { planType, senderBkashNumber, transactionId, screenshotUrl } = req.body;

        if (!["standard", "pro"].includes(planType)) {
            return res.status(400).json({ success: false, message: "Invalid plan type. Choose standard or pro." });
        }
        if (!senderBkashNumber || !transactionId) {
            return res.status(400).json({ success: false, message: "senderBkashNumber and transactionId are required." });
        }

        // Check for duplicate transaction ID
        const existing = await PaymentRequest.findOne({ transactionId: transactionId.trim() });
        if (existing) {
            return res.status(400).json({ success: false, message: "This transaction ID has already been submitted." });
        }

        // Check if user has a pending request
        const pendingExists = await PaymentRequest.findOne({ userId: req.dbUser._id, status: "pending" });
        if (pendingExists) {
            return res.status(400).json({ success: false, message: "You already have a pending payment request. Please wait for review." });
        }

        const amount = PLAN_AMOUNTS[planType];
        const request = await PaymentRequest.create({
            userId: req.dbUser._id,
            workspaceId: req.dbUser.currentWorkspaceId || null,
            planType,
            amount,
            senderBkashNumber: senderBkashNumber.trim(),
            transactionId: transactionId.trim(),
            screenshotUrl: screenshotUrl?.trim() || "",
        });

        res.status(201).json({ success: true, data: request });
    } catch (error) {
        next(error);
    }
};

// ─── GET /api/payments/my ─── (authenticated user — billing history)
export const getMyPayments = async (req, res, next) => {
    try {
        const payments = await PaymentRequest.find({ userId: req.dbUser._id })
            .sort({ createdAt: -1 })
            .lean();
        res.json({ success: true, data: payments });
    } catch (error) {
        next(error);
    }
};

// ─── GET /api/payments/all ─── (admin/moderator — review panel)
export const getAllPayments = async (req, res, next) => {
    try {
        const { status } = req.query;
        const filter = {};
        if (status && ["pending", "approved", "rejected"].includes(status)) {
            filter.status = status;
        }

        const payments = await PaymentRequest.find(filter)
            .populate("userId", "name email planType")
            .populate("reviewedBy", "name email")
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, data: payments });
    } catch (error) {
        next(error);
    }
};

// ─── PUT /api/payments/:id/approve ─── (admin/moderator)
export const approvePayment = async (req, res, next) => {
    try {
        const { reviewNote, customMessageLimit } = req.body;

        const request = await PaymentRequest.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ success: false, message: "Payment request not found." });
        }
        if (request.status !== "pending") {
            return res.status(400).json({ success: false, message: "This request has already been reviewed." });
        }

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        // Determine message limit
        let messageLimit = PLAN_LIMITS[request.planType];
        if (request.planType === "custom" && customMessageLimit) {
            messageLimit = parseInt(customMessageLimit, 10) || 0;
        }

        // Update the payment request
        request.status = "approved";
        request.reviewedBy = req.dbUser._id;
        request.reviewNote = reviewNote || "";
        request.reviewedAt = now;
        request.billingPeriodStart = now;
        request.billingPeriodEnd = periodEnd;
        await request.save();

        // Activate workspace plan — Workspace is the sole billing source of truth.
        // Resolve workspaceId from payment request (preferred) or user record.
        const workspaceId = request.workspaceId ||
            (await User.findById(request.userId).select("currentWorkspaceId").lean())?.currentWorkspaceId;

        if (workspaceId) {
            await Workspace.findByIdAndUpdate(workspaceId, {
                planCode: request.planType,
                planStatus: "active",
                replyLimit: messageLimit,
                usedReplies: 0,
                billingPeriodStart: now,
                billingPeriodEnd: periodEnd,
                isSuspended: false,
            });
        }

        res.json({ success: true, message: "Payment approved and plan activated." });
    } catch (error) {
        next(error);
    }
};

// ─── PUT /api/payments/:id/reject ─── (admin/moderator)
export const rejectPayment = async (req, res, next) => {
    try {
        const { reviewNote } = req.body;

        const request = await PaymentRequest.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ success: false, message: "Payment request not found." });
        }
        if (request.status !== "pending") {
            return res.status(400).json({ success: false, message: "This request has already been reviewed." });
        }

        request.status = "rejected";
        request.reviewedBy = req.dbUser._id;
        request.reviewNote = reviewNote || "";
        request.reviewedAt = new Date();
        await request.save();

        res.json({ success: true, message: "Payment request rejected." });
    } catch (error) {
        next(error);
    }
};
