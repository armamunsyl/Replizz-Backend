import express from "express";
import {
    getInstructions,
    addInstruction,
    updateInstruction,
    toggleInstruction,
    deleteInstruction,
} from "../controllers/instructionController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/:pageId", getInstructions);
router.post("/:pageId", addInstruction);
router.put("/:pageId/:instructionId", updateInstruction);
router.patch("/:pageId/:instructionId/toggle", toggleInstruction);
router.delete("/:pageId/:instructionId", deleteInstruction);

export default router;
