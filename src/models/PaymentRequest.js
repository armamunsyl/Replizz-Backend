import mongoose from "mongoose";

const paymentRequestSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        // Workspace that owns this payment request (authoritative account reference)
        workspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            index: true,
            default: null,
        },
        planType: {
            type: String,
            enum: ["standard", "pro", "custom"],
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        // Sender's bKash number used for payment
        senderBkashNumber: {
            type: String,
            required: true,
            trim: true,
        },
        // bKash transaction ID — globally unique to prevent duplicate submissions
        transactionId: {
            type: String,
            required: true,
            trim: true,
            unique: true,
        },
        // Optional screenshot URL (Cloudinary or other)
        screenshotUrl: {
            type: String,
            default: "",
        },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
            index: true,
        },
        // Admin/moderator who reviewed
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        reviewNote: {
            type: String,
            default: "",
        },
        reviewedAt: {
            type: Date,
            default: null,
        },
        // When plan period starts/ends (set on approval)
        billingPeriodStart: {
            type: Date,
            default: null,
        },
        billingPeriodEnd: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

const PaymentRequest = mongoose.model("PaymentRequest", paymentRequestSchema);
export default PaymentRequest;
