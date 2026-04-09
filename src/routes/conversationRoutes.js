import express from "express";
import { getConversations, getConversationThread, toggleHumanActive } from "../controllers/conversationController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { attachWorkspace } from "../middlewares/workspaceMiddleware.js";

const router = express.Router();

router.use(protect, attachWorkspace);

router.get("/:pageId", getConversations);
router.get("/:pageId/:senderId", getConversationThread);
router.patch("/:id/human-toggle", toggleHumanActive);

export default router;
