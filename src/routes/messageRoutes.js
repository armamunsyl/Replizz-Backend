import express from "express";
import { getMessageLogs, sendManualMessage } from "../controllers/messageController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/:pageId", getMessageLogs);
router.post("/send", sendManualMessage);

export default router;
