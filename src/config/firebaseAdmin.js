import admin from "firebase-admin";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // When running in production (Render), parse the base64 or raw JSON string
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (err) {
        console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT env var:", err);
    }
} else {
    // When running locally, use the JSON file
    try {
        serviceAccount = require("./serviceAccountKey.json");
    } catch (err) {
        console.warn("serviceAccountKey.json not found locally and no FIREBASE_SERVICE_ACCOUNT env var provided.");
    }
}

if (serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
} else {
    console.error("Firebase Admin initialization failed: No credentials found.");
}

export default admin;
