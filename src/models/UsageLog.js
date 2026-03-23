import mongoose from "mongoose";

const usageLogSchema = new mongoose.Schema(
    {
        pageId: {
            type: String,
            required: true,
            index: true,
        },
        tokensIn: {
            type: Number,
            required: true,
        },
        tokensOut: {
            type: Number,
            required: true,
        },
        totalCost: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

const UsageLog = mongoose.model("UsageLog", usageLogSchema);
export default UsageLog;
