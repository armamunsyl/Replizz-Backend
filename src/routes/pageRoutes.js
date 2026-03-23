import express from "express";
import {
    getFacebookAuthURL,
    handleFacebookCallback,
    connectPage,
    getMyPages,
    disconnectPage,
    updatePageSettings,
    updatePageAISettings,
} from "../controllers/pageController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All page routes are protected
router.use(protect);

router.get("/auth/facebook", getFacebookAuthURL);
router.get("/auth/facebook/callback", handleFacebookCallback);
router.post("/connect", connectPage);
router.get("/", getMyPages);
router.delete("/:pageId", disconnectPage);
router.patch("/:pageId/settings", updatePageSettings);
router.patch("/:pageId/ai-settings", updatePageAISettings);

export default router;
