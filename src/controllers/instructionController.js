import PageInstruction from "../models/PageInstruction.js";
import Page from "../models/Page.js";

// ─── Helper ───────────────────────────────────────────────────────────────────
// Verify a page belongs to the caller's workspace before touching instructions.
const verifyPageOwnership = async (pageId, workspaceId) => {
    if (!workspaceId) return null;
    return Page.findOne({ pageId, workspaceId, isActive: true }).lean();
};

// GET /api/instructions/:pageId — get all instructions for a page
const getInstructions = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const workspaceId = req.workspace?._id;

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        // One instruction document per page (keyed by pageId)
        const doc = await PageInstruction.findOne({ pageId });
        res.json({ success: true, data: doc?.instructions || [] });
    } catch (error) {
        next(error);
    }
};

// POST /api/instructions/:pageId — add a new instruction
const addInstruction = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const { text } = req.body;
        const workspaceId = req.workspace?._id;

        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: "Instruction text is required" });
        }

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const doc = await PageInstruction.findOneAndUpdate(
            { pageId },
            {
                $set: { workspaceId },
                $push: { instructions: { text: text.trim(), isActive: true } },
            },
            { new: true, upsert: true }
        );

        const added = doc.instructions[doc.instructions.length - 1];
        res.status(201).json({ success: true, data: added });
    } catch (error) {
        next(error);
    }
};

// PUT /api/instructions/:pageId/:instructionId — update instruction text
const updateInstruction = async (req, res, next) => {
    try {
        const { pageId, instructionId } = req.params;
        const { text } = req.body;
        const workspaceId = req.workspace?._id;

        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: "Instruction text is required" });
        }

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const doc = await PageInstruction.findOneAndUpdate(
            { pageId, "instructions._id": instructionId },
            {
                $set: {
                    "instructions.$.text": text.trim(),
                    "instructions.$.updatedAt": new Date(),
                },
            },
            { new: true }
        );

        if (!doc) {
            return res.status(404).json({ success: false, message: "Instruction not found" });
        }

        const updated = doc.instructions.id(instructionId);
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

// PATCH /api/instructions/:pageId/:instructionId/toggle — toggle active state
const toggleInstruction = async (req, res, next) => {
    try {
        const { pageId, instructionId } = req.params;
        const workspaceId = req.workspace?._id;

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const doc = await PageInstruction.findOne({ pageId });
        if (!doc) {
            return res.status(404).json({ success: false, message: "Instructions not found" });
        }

        const instruction = doc.instructions.id(instructionId);
        if (!instruction) {
            return res.status(404).json({ success: false, message: "Instruction not found" });
        }

        instruction.isActive = !instruction.isActive;
        await doc.save();

        res.json({ success: true, data: instruction });
    } catch (error) {
        next(error);
    }
};

// DELETE /api/instructions/:pageId/:instructionId — delete an instruction
const deleteInstruction = async (req, res, next) => {
    try {
        const { pageId, instructionId } = req.params;
        const workspaceId = req.workspace?._id;

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const doc = await PageInstruction.findOneAndUpdate(
            { pageId },
            { $pull: { instructions: { _id: instructionId } } },
            { new: true }
        );

        if (!doc) {
            return res.status(404).json({ success: false, message: "Instruction not found" });
        }

        res.json({ success: true, message: "Instruction deleted" });
    } catch (error) {
        next(error);
    }
};

export { getInstructions, addInstruction, updateInstruction, toggleInstruction, deleteInstruction };
