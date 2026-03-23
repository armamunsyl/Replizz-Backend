import express from "express";
import { getProducts, createProduct, updateProduct, deleteProduct } from "../controllers/productController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/:pageId", getProducts);
router.post("/:pageId", createProduct);
router.put("/:pageId/:productId", updateProduct);
router.delete("/:pageId/:productId", deleteProduct);

export default router;
