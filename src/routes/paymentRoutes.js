import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { requireAdmin, requireModerator } from "../middlewares/adminMiddleware.js";
import { attachWorkspace } from "../middlewares/workspaceMiddleware.js";
import {
    getPaymentSettings,
    updatePaymentSettings,
    submitPaymentRequest,
    getMyPayments,
    getAllPayments,
    approvePayment,
    rejectPayment,
    getPaymentAnalytics,
} from "../controllers/paymentController.js";

const router = express.Router();

// Public — read bKash number (so user knows where to send money)
router.get("/settings", getPaymentSettings);

// Authenticated user routes — attachWorkspace provides req.dbUser + req.workspace
router.use(protect, attachWorkspace);
router.post("/submit", submitPaymentRequest);
router.get("/my", getMyPayments);

// Admin/moderator review routes
router.get("/analytics", requireModerator, getPaymentAnalytics);
router.get("/all", requireModerator, getAllPayments);
router.put("/:id/approve", requireModerator, approvePayment);
router.put("/:id/reject", requireModerator, rejectPayment);

// Admin-only settings update
router.put("/settings", requireAdmin, updatePaymentSettings);

export default router;
