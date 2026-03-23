import PageInstruction from "../models/PageInstruction.js";
import Page from "../models/Page.js";

// GET /api/instructions/:pageId — get all instructions for a page
const getInstructions = async (req, res, next) => {
    try {
        const { pageId } = req.params;

        const page = await Page.findOne({ pageId, userId: req.user.uid });
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const doc = await PageInstruction.findOne({ pageId, userId: req.user.uid });
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

        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: "Instruction text is required" });
        }

        const page = await Page.findOne({ pageId, userId: req.user.uid });
        if (!page) {
            return res.status(404).json({ success: false, message: "Page not found" });
        }

        const doc = await PageInstruction.findOneAndUpdate(
            { pageId, userId: req.user.uid },
            {
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

        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, message: "Instruction text is required" });
        }

        const doc = await PageInstruction.findOneAndUpdate(
            { pageId, userId: req.user.uid, "instructions._id": instructionId },
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

        const doc = await PageInstruction.findOne({ pageId, userId: req.user.uid });
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

        const doc = await PageInstruction.findOneAndUpdate(
            { pageId, userId: req.user.uid },
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
