import User from "../models/User.js";

/**
 * Attach MongoDB user (with role) to req.dbUser.
 * Must run AFTER the Firebase `protect` middleware.
 */
const attachDbUser = async (req, res, next) => {
    try {
        const firebaseUid = req.user?.uid;
        if (!firebaseUid) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }

        // Look up user by Firebase UID stored in email or by matching uid
        // Since the app registers users in MongoDB separately, we search by email
        // The Firebase decoded token contains the email
        const email = req.user.email;
        if (!email) {
            return res.status(401).json({ success: false, message: "No email in token" });
        }

        const dbUser = await User.findOne({ email }).select("-passwordHash");
        if (!dbUser) {
            return res.status(404).json({ success: false, message: "User not found in database" });
        }

        req.dbUser = dbUser;
        next();
    } catch (error) {
        console.error("attachDbUser error:", error.message);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * Require Admin role. Must run AFTER attachDbUser.
 */
const requireAdmin = (req, res, next) => {
    if (!req.dbUser || req.dbUser.role !== "Admin") {
        return res.status(403).json({ success: false, message: "Admin access required" });
    }
    next();
};

/**
 * Require Moderator or Admin role. Must run AFTER attachDbUser.
 */
const requireModerator = (req, res, next) => {
    if (!req.dbUser || !["Admin", "Moderator"].includes(req.dbUser.role)) {
        return res.status(403).json({ success: false, message: "Moderator or Admin access required" });
    }
    next();
};

export { attachDbUser, requireAdmin, requireModerator };
