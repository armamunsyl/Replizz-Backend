import express from "express";
import { getPrompt, upsertPrompt } from "../controllers/promptController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/:pageId", getPrompt);
router.put("/:pageId", upsertPrompt);

export default router;
