import Product from "../models/Product.js";
import Page from "../models/Page.js";

// ─── Helper ───────────────────────────────────────────────────────────────────
const verifyPageOwnership = async (pageId, workspaceId) => {
    if (!workspaceId) return null;
    return Page.findOne({ pageId, workspaceId, isActive: true }).lean();
};

// GET /api/products/:pageId
const getProducts = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const workspaceId = req.workspace?._id;

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) return res.status(404).json({ success: false, message: "Page not found" });

        const products = await Product.find({ pageId, workspaceId })
            .select("-imageBase64") // never return deprecated blob field
            .sort({ createdAt: -1 });

        res.json({ success: true, data: products });
    } catch (error) {
        next(error);
    }
};

// POST /api/products/:pageId
const createProduct = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const { name, description, price, discount, availability, customInstruction, additionalComment, imageUrl } = req.body;
        const workspaceId = req.workspace?._id;

        if (!name || !price) {
            return res.status(400).json({ success: false, message: "Product name and price are required" });
        }

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) return res.status(404).json({ success: false, message: "Page not found" });

        const product = await Product.create({
            pageId,
            workspaceId,
            name,
            description: description || "",
            price,
            discount: discount || "0",
            availability: availability || "available",
            customInstruction: customInstruction || "",
            additionalComment: additionalComment || "",
            imageUrl: imageUrl || "",
            // imageBase64 intentionally omitted — deprecated, use imageUrl
        });

        res.status(201).json({ success: true, data: product });
    } catch (error) {
        next(error);
    }
};

// PUT /api/products/:pageId/:productId
const updateProduct = async (req, res, next) => {
    try {
        const { pageId, productId } = req.params;
        const workspaceId = req.workspace?._id;

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) return res.status(404).json({ success: false, message: "Page not found" });

        // Strip imageBase64 from updates — deprecated field
        const { imageBase64: _removed, ...safeUpdates } = req.body;

        const product = await Product.findOneAndUpdate(
            { _id: productId, pageId, workspaceId },
            { $set: safeUpdates },
            { new: true }
        ).select("-imageBase64");

        if (!product) return res.status(404).json({ success: false, message: "Product not found" });

        res.json({ success: true, data: product });
    } catch (error) {
        next(error);
    }
};

// DELETE /api/products/:pageId/:productId
const deleteProduct = async (req, res, next) => {
    try {
        const { pageId, productId } = req.params;
        const workspaceId = req.workspace?._id;

        const page = await verifyPageOwnership(pageId, workspaceId);
        if (!page) return res.status(404).json({ success: false, message: "Page not found" });

        const product = await Product.findOneAndDelete({ _id: productId, pageId, workspaceId });
        if (!product) return res.status(404).json({ success: false, message: "Product not found" });

        res.json({ success: true, message: "Product deleted" });
    } catch (error) {
        next(error);
    }
};

export { getProducts, createProduct, updateProduct, deleteProduct };
