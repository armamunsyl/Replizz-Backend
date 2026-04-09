import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import admin from "../config/firebaseAdmin.js";

// Generate JWT token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res, next) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            res.status(400);
            throw new Error("Please fill in all fields");
        }

        // Check if user already exists
        const userExists = await User.findOne({ email });
        if (userExists) {
            res.status(400);
            throw new Error("User already exists");
        }

        // Create user (password is hashed via pre-save hook)
        const user = await User.create({
            name,
            email,
            passwordHash: password,
        });

        res.status(201).json({
            success: true,
            data: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                token: generateToken(user._id),
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            res.status(400);
            throw new Error("Please provide email and password");
        }

        const user = await User.findOne({ email });

        if (user && (await user.matchPassword(password))) {
            res.json({
                success: true,
                data: {
                    _id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    token: generateToken(user._id),
                },
            });
        } else {
            res.status(401);
            throw new Error("Invalid email or password");
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res, next) => {
    try {
        const email = req.user?.email;
        if (!email) {
            return res.json({ success: true, data: req.user });
        }

        let dbUser = await User.findOne({ email }).select("-passwordHash");

        if (!dbUser) {
            // User exists in Firebase but not in MongoDB — auto-create them
            dbUser = await User.create({
                name: req.user.name || email.split('@')[0],
                email: email,
                passwordHash: "firebase_oauth_no_password",
                role: "User",
                firebaseUid: req.user.uid,
            });
        } else if (!dbUser.firebaseUid && req.user.uid) {
            // Backfill firebaseUid for existing users on first login
            dbUser = await User.findOneAndUpdate(
                { email },
                { firebaseUid: req.user.uid },
                { new: true }
            ).select("-passwordHash");
        }

        // Load workspace plan info — Workspace is the billing source of truth
        let workspacePlan = null;
        if (dbUser.currentWorkspaceId) {
            const ws = await Workspace.findById(dbUser.currentWorkspaceId)
                .select("planCode planStatus replyLimit usedReplies billingPeriodEnd isSuspended")
                .lean();
            if (ws) {
                workspacePlan = {
                    planCode: ws.planCode,
                    planStatus: ws.planStatus,
                    replyLimit: ws.replyLimit,
                    usedReplies: ws.usedReplies,
                    remainingReplies: Math.max(0, ws.replyLimit - ws.usedReplies),
                    billingPeriodEnd: ws.billingPeriodEnd,
                    isSuspended: ws.isSuspended,
                };
            }
        }

        res.json({
            success: true,
            data: {
                _id: dbUser._id,
                name: dbUser.name,
                email: dbUser.email,
                role: dbUser.role,
                uid: req.user.uid,
                createdAt: dbUser.createdAt,
                currentWorkspaceId: dbUser.currentWorkspaceId,
                workspacePlan,
            },
        });
    } catch (error) {
        next(error);
    }
};

export { register, login, getMe };
