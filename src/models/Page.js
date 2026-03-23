import mongoose from "mongoose";

const pageSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            index: true,
        },
        pageId: {
            type: String,
            required: true,
        },
        pageName: {
            type: String,
            required: true,
        },
        pagePicture: {
            type: String,
            default: "",
        },
        pageAccessToken: {
            type: String,
            required: true,
        },
        connectedAt: {
            type: Date,
            default: Date.now,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        aiEnabled: {
            type: Boolean,
            default: true,
        },
        language: {
            type: String,
            default: "English",
        },
        tone: {
            type: String,
            default: "Professional",
        },
        replyStyle: {
            type: String,
            default: "Short and helpful",
        },
        customInstructions: {
            type: String,
            default: "",
        },
        totalMessages: {
            type: Number,
            default: 0,
        },
        totalAIReplies: {
            type: Number,
            default: 0,
        },
        monthlyUsageCount: {
            type: Number,
            default: 0,
        },
        totalTokensUsed: {
            type: Number,
            default: 0,
        },
        planType: {
            type: String,
            enum: ["free", "pro"],
            default: "free",
        },
        monthlyLimit: {
            type: Number,
            default: 100,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index: one user can connect a specific page only once
pageSchema.index({ userId: 1, pageId: 1 }, { unique: true });

const Page = mongoose.model("Page", pageSchema);
console.log("Page collection:", Page.collection.name);
export default Page;
