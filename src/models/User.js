import mongoose from "mongoose";
import bcrypt from "bcrypt";

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
        },
        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true,
            lowercase: true,
            trim: true,
        },
        passwordHash: {
            type: String,
            required: [true, "Password is required"],
        },
        role: {
            type: String,
            enum: ["User", "Moderator", "Admin"],
            default: "User",
        },
        // Firebase UID — set on first login via /api/auth/me
        firebaseUid: {
            type: String,
            index: true,
            sparse: true,
        },
        // ── Workspace reference ──────────────────────────────────────────────
        // The workspace this user owns (auto-created on first page connection).
        // Users who join as members of another workspace keep their own workspace
        // reference separate from their WorkspaceMember record.
        currentWorkspaceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            default: null,
        },
        // ── Legacy plan fields (kept for backward compatibility) ─────────────
        // These are still updated by the webhook quota path as a fallback.
        // Source of truth is now Workspace.planCode / replyLimit / usedReplies.
        planType: {
            type: String,
            enum: ["free", "standard", "pro", "custom"],
            default: "free",
        },
        messageLimit: {
            type: Number,
            default: 100,
        },
        usedMessages: {
            type: Number,
            default: 0,
        },
        planActivatedAt: {
            type: Date,
            default: null,
        },
        planExpiresAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

userSchema.pre("save", async function () {
    if (!this.isModified("passwordHash")) return;
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.passwordHash);
};

const User = mongoose.model("User", userSchema);
export default User;
