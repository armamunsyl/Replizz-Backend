import admin from "../config/firebaseAdmin.js";

const protect = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Not authorized, no token" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        console.log("🔥 Firebase UID:", decodedToken.uid);
        res.set("x-debug-uid", decodedToken.uid);
        req.user = decodedToken;
        console.log("User authenticated:", decodedToken.uid);
        next();
    } catch (error) {
        console.log("Auth error:", error.message);
        return res.status(401).json({ success: false, message: "Not authorized, token failed" });
    }
};

export { protect };
