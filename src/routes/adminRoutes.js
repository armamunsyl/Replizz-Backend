import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { attachDbUser, requireAdmin, requireModerator } from "../middlewares/adminMiddleware.js";
import {
    getAllUsers,
    updateUserRole,
    deleteUser,
    getAnalytics,
    getReports,
    getAllPages,
    updatePagePlan,
    updateUserPlan,
} from "../controllers/adminController.js";
import { getAllWorkspaces, adminUpdateWorkspacePlan } from "../controllers/workspaceController.js";

const router = express.Router();

// All admin routes require authentication + DB user lookup
router.use(protect, attachDbUser);

// Admin-only routes
router.get("/users", requireAdmin, getAllUsers);
router.put("/users/:id/role", requireAdmin, updateUserRole);
router.delete("/users/:id", requireAdmin, deleteUser);
// Legacy plan endpoints return 410 — kept for graceful API deprecation messaging
router.put("/users/:id/plan", requireAdmin, updateUserPlan);
router.put("/pages/:pageId/plan", requireAdmin, updatePagePlan);

// Moderator+ routes
router.get("/analytics", requireModerator, getAnalytics);
router.get("/reports", requireModerator, getReports);
router.get("/pages", requireModerator, getAllPages);

// Workspace admin routes
router.get("/workspaces", requireAdmin, getAllWorkspaces);
router.put("/workspaces/:id/plan", requireAdmin, adminUpdateWorkspacePlan);

export default router;
