import express from "express";
import {
    getFacebookAuthURL,
    handleFacebookCallback,
    connectPage,
    getMyPages,
    disconnectPage,
    updatePageSettings,
    updatePageAISettings,
    toggleAutomation,
} from "../controllers/pageController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { attachWorkspace } from "../middlewares/workspaceMiddleware.js";

const router = express.Router();

// All page routes require authentication + workspace context
router.use(protect, attachWorkspace);

router.get("/auth/facebook", getFacebookAuthURL);
router.get("/auth/facebook/callback", handleFacebookCallback);
router.post("/connect", connectPage);
router.get("/", getMyPages);
router.delete("/:pageId", disconnectPage);
router.patch("/:pageId/settings", updatePageSettings);
router.patch("/:pageId/ai-settings", updatePageAISettings);
router.patch("/:pageId/automation", toggleAutomation);

export default router;
