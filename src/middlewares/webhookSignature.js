import crypto from "crypto";

const verifyWebhookSignature = (req, res, next) => {
    const signature = req.headers["x-hub-signature-256"];

    if (!signature) {
        console.log("⚠️ No signature header present");
        return res.status(401).json({ success: false, message: "Missing signature" });
    }

    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const expectedSignature = "sha256=" + crypto
        .createHmac("sha256", appSecret)
        .update(req.rawBody || "")
        .digest("hex");

    if (signature !== expectedSignature) {
        console.log("❌ Invalid webhook signature");
        console.log("Received:", signature);
        console.log("Expected:", expectedSignature);
        return res.status(401).json({ success: false, message: "Invalid signature" });
    }

    console.log("✅ Webhook signature verified");
    next();
};

export { verifyWebhookSignature };
