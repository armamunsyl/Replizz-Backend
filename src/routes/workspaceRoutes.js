import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { attachWorkspace, requireWorkspace, requireWorkspaceRole } from "../middlewares/workspaceMiddleware.js";
import {
    getMyWorkspace,
    updateWorkspace,
    getMembers,
    addMember,
    removeMember,
    getUsage,
} from "../controllers/workspaceController.js";

const router = express.Router();

// All workspace routes require authentication + workspace context
router.use(protect, attachWorkspace);

router.get("/me", getMyWorkspace);
router.patch("/me", requireWorkspace, requireWorkspaceRole("owner", "admin"), updateWorkspace);
router.get("/usage", getUsage);

// Member management — owner/admin only
router.get("/members", requireWorkspace, getMembers);
router.post("/members", requireWorkspace, requireWorkspaceRole("owner", "admin"), addMember);
router.delete("/members/:memberId", requireWorkspace, requireWorkspaceRole("owner", "admin"), removeMember);

export default router;
