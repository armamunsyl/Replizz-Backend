import mongoose from "mongoose";

// Singleton document — always upsert with key "global"
const paymentSettingsSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            default: "global",
            unique: true,
        },
        bkashNumber: {
            type: String,
            default: "",
            trim: true,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { timestamps: true }
);

const PaymentSettings = mongoose.model("PaymentSettings", paymentSettingsSchema);
export default PaymentSettings;
