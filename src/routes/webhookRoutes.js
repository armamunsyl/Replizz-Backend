import express from "express";
import {
    verifyWebhook,
    handleIncomingMessage,
} from "../controllers/webhookController.js";
import { verifyWebhookSignature } from "../middlewares/webhookSignature.js";

const router = express.Router();

router.get("/", verifyWebhook);
router.post("/", verifyWebhookSignature, handleIncomingMessage);

export default router;
