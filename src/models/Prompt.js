import mongoose from "mongoose";

const promptSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        pageId: {
            type: String,
            required: true,
        },
        template: {
            type: String,
            default:
                "You are a helpful customer support assistant. Reply politely and concisely to the following message.",
        },
        tone: {
            type: String,
            default: "professional",
        },
        fallbackMessage: {
            type: String,
            default:
                "Thank you for your message! Our team will get back to you shortly.",
        },
    },
    {
        timestamps: true,
    }
);

promptSchema.index({ userId: 1, pageId: 1 }, { unique: true });

const Prompt = mongoose.model("Prompt", promptSchema);
export default Prompt;
