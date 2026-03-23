import express from "express";
import {
    getUsageByPage,
    getUsageSummary,
} from "../controllers/usageController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getUsageSummary);
router.get("/:pageId", getUsageByPage);

export default router;
