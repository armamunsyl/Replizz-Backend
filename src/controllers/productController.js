import Product from "../models/Product.js";
import Page from "../models/Page.js";

// GET /api/products/:pageId
const getProducts = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const page = await Page.findOne({ pageId, userId: req.user.uid });
        if (!page) return res.status(404).json({ success: false, message: "Page not found" });

        const products = await Product.find({ pageId, userId: req.user.uid }).sort({ createdAt: -1 });
        res.json({ success: true, data: products });
    } catch (error) {
        next(error);
    }
};

// POST /api/products/:pageId
const createProduct = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const { name, description, price, discount, availability, customInstruction, additionalComment, imageBase64 } = req.body;

        if (!name || !price) {
            return res.status(400).json({ success: false, message: "Product name and price are required" });
        }

        const page = await Page.findOne({ pageId, userId: req.user.uid });
        if (!page) return res.status(404).json({ success: false, message: "Page not found" });

        const product = await Product.create({
            pageId,
            userId: req.user.uid,
            name,
            description: description || "",
            price,
            discount: discount || "0",
            availability: availability || "available",
            customInstruction: customInstruction || "",
            additionalComment: additionalComment || "",
            imageBase64: imageBase64 || "",
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
        const updates = req.body;

        const product = await Product.findOneAndUpdate(
            { _id: productId, pageId, userId: req.user.uid },
            { $set: updates },
            { new: true }
        );

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
        const product = await Product.findOneAndDelete({ _id: productId, pageId, userId: req.user.uid });
        if (!product) return res.status(404).json({ success: false, message: "Product not found" });
        res.json({ success: true, message: "Product deleted" });
    } catch (error) {
        next(error);
    }
};

export { getProducts, createProduct, updateProduct, deleteProduct };
