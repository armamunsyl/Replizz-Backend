import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./src/config/db.js";
import { notFound, errorHandler } from "./src/middlewares/errorHandler.js";

// Route imports
import authRoutes from "./src/routes/authRoutes.js";
import pageRoutes from "./src/routes/pageRoutes.js";
import promptRoutes from "./src/routes/promptRoutes.js";
import webhookRoutes from "./src/routes/webhookRoutes.js";
import usageRoutes from "./src/routes/usageRoutes.js";
import messageRoutes from "./src/routes/messageRoutes.js";
import statsRoutes from "./src/routes/statsRoutes.js";
import conversationRoutes from "./src/routes/conversationRoutes.js";
import facebookOAuthRoutes from "./src/routes/facebookOAuthRoutes.js";
import instructionRoutes from "./src/routes/instructionRoutes.js";
import productRoutes from "./src/routes/productRoutes.js";
import adminRoutes from "./src/routes/adminRoutes.js";

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Body parser middleware with raw body capture for webhook signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    },
}));
app.use(express.urlencoded({ extended: true }));

// Enable CORS
const allowedOrigins = [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "https://replizz-frontend.vercel.app"
].filter(Boolean);

app.use(
    cors({
        origin: function (origin, callback) {
            // allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);
            
            // allow custom origin, vercel domain, or localhost
            if (
                allowedOrigins.includes(origin) ||
                origin.endsWith('.vercel.app') || 
                origin.startsWith('http://localhost:')
            ) {
                return callback(null, true);
            }
            return callback(new Error('CORS policy violation'), false);
        },
        credentials: true,
    })
);

// Health check
app.get("/api", (req, res) => {
    res.json({ message: "Replizz API is running..." });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/pages", pageRoutes);
app.use("/api/prompts", promptRoutes);
app.use("/api/usage", usageRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/facebook", facebookOAuthRoutes);
app.use("/api/instructions", instructionRoutes);
app.use("/api/products", productRoutes);
app.use("/api/admin", adminRoutes);

// Webhook routes
app.use("/api/webhook", webhookRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(
        `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`
    );
});
