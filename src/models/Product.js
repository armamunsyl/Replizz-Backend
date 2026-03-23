import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
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
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: "",
        },
        price: {
            type: String,
            required: true,
        },
        discount: {
            type: String,
            default: "0",
        },
        availability: {
            type: String,
            enum: ["available", "stock-out"],
            default: "available",
        },
        customInstruction: {
            type: String,
            default: "",
        },
        additionalComment: {
            type: String,
            default: "",
        },
        imageBase64: {
            type: String,
            default: "",
        },
    },
    {
        timestamps: true,
    }
);

productSchema.index({ pageId: 1, userId: 1 });

const Product = mongoose.model("Product", productSchema);
export default Product;
