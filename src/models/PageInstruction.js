import mongoose from "mongoose";

/**
 * PageInstruction — ordered list of active AI instructions for a page.
 *
 * This is the authoritative source for page-specific AI behaviour rules.
 * The webhook reads active instructions from here and injects them into
 * the system prompt.
 *
 * One document per page (upserted by pageId). The instructions array contains
 * individually toggle-able instruction items.
 *
 * Ownership: workspaceId is the authoritative owner reference.
 * userId is kept for backward compatibility but is no longer used in
 * active business logic.
 */
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
    { timestamps: true }
);

const pageInstructionSchema = new mongoose.Schema(
    {
        // Workspace owner — authoritative ownership reference
        workspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            index: true,
            default: null,
        },
        pageId: {
            type: String,
            required: true,
        },
        // Deprecated: Firebase UID of original creator.
        // No longer used for lookups. Kept for migration audit trail only.
        userId: {
            type: String,
            default: null,
        },
        instructions: {
            type: [instructionItemSchema],
            default: [],
        },
    },
    { timestamps: true }
);

// One instruction document per page — enforced at app level via upsert { pageId }
pageInstructionSchema.index({ pageId: 1 }, { unique: true });
pageInstructionSchema.index({ workspaceId: 1 });

const PageInstruction = mongoose.model("PageInstruction", pageInstructionSchema);
export default PageInstruction;
