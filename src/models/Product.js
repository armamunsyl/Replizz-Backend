import mongoose from "mongoose";

/**
 * Product — items in a page's product knowledge base.
 *
 * Changes from previous version:
 *   - Added workspaceId for workspace-level ownership
 *   - imageUrl replaces imageBase64 (no large blobs in DB)
 *   - imageBase64 kept as deprecated field during migration
 */
const productSchema = new mongoose.Schema(
    {
        // Workspace owner (new architecture)
        workspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            index: true,
            default: null,
        },
        // Facebook page ID (primary lookup key for webhook)
        pageId: {
            type: String,
            required: true,
            index: true,
        },
        // Deprecated: Firebase UID of original creator.
        // No longer used in active business logic. Kept for migration audit only.
        userId: {
            type: String,
            default: null,
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
        // External image URL (preferred — use Cloudinary or similar)
        imageUrl: {
            type: String,
            default: "",
        },
        // Deprecated: base64 image (legacy, do not populate for new products)
        imageBase64: {
            type: String,
            default: "",
        },
    },
    { timestamps: true }
);

productSchema.index({ pageId: 1, workspaceId: 1 });
productSchema.index({ workspaceId: 1 });

const Product = mongoose.model("Product", productSchema);
export default Product;
