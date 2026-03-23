import express from "express";
import { getPageStats } from "../controllers/statsController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/:pageId", getPageStats);

export default router;
