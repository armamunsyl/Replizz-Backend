import express from "express";
import { facebookLogin, facebookCallback, resubscribePages, debugPages, manualSync } from "../controllers/facebookOAuthController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/login", facebookLogin);
router.get("/callback", facebookCallback);
router.post("/resubscribe", resubscribePages);
router.get("/debug", debugPages);
router.post("/manual-sync", manualSync);

export default router;
