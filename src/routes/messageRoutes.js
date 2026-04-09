import express from "express";
import { getMessageLogs, sendManualMessage } from "../controllers/messageController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { attachWorkspace } from "../middlewares/workspaceMiddleware.js";

const router = express.Router();

router.use(protect, attachWorkspace);

router.get("/:pageId", getMessageLogs);
router.post("/send", sendManualMessage);

export default router;
