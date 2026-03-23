import mongoose from "mongoose";

const instructionItemSchema = new mongoose.Schema(
    {
        text: {
            type: String,
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

const pageInstructionSchema = new mongoose.Schema(
    {
        pageId: {
            type: String,
            required: true,
            index: true,
        },
        userId: {
            type: String,
            required: true,
        },
        instructions: {
            type: [instructionItemSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

pageInstructionSchema.index({ pageId: 1, userId: 1 }, { unique: true });

const PageInstruction = mongoose.model("PageInstruction", pageInstructionSchema);
export default PageInstruction;
