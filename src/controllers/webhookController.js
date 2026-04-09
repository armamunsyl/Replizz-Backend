import axios from "axios";
import Page from "../models/Page.js";
import Workspace from "../models/Workspace.js";
import Conversation from "../models/Conversation.js";
import ConversationMessage from "../models/ConversationMessage.js";
import MessageLog from "../models/MessageLog.js";
import PageInstruction from "../models/PageInstruction.js";
import { sendMessage, markSeen, showTyping, addReaction } from "../services/facebookService.js";
import { generateAIReply, analyzeImage, updateContextStory, classifyImageIntent, generateImageReply } from "../../utils/openai.js";
import { buildDynamicPrompt, buildMemoryContext } from "../../utils/promptBuilder.js";
import { detectEmotion, getReactionForEmotion } from "../../utils/emotionDetector.js";
import { getIO } from "../socket.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetchUserProfile = async (psid, pageAccessToken) => {
    try {
        const res = await axios.get(`https://graph.facebook.com/v19.0/${psid}`, {
            params: { fields: "first_name,last_name,profile_pic", access_token: pageAccessToken },
        });
        const d = res.data;
        return {
            name: [d.first_name, d.last_name].filter(Boolean).join(" ") || "Unknown User",
            profilePic: d.profile_pic || null,
        };
    } catch (_) {
        return { name: "Unknown User", profilePic: null };
    }
};

/**
 * Workspace-level quota check.
 * Returns true if the workspace has capacity, false if exhausted.
 * Falls back gracefully if workspace is not yet set on the page.
 */
const hasQuota = async (page) => {
    if (!page.workspaceId) {
        // Legacy path: no workspace assigned yet, always allow (migration period)
        console.log(`⚠️  Page ${page.pageId} has no workspaceId — skipping quota check`);
        return true;
    }

    const workspace = await Workspace.findById(page.workspaceId);
    if (!workspace) return true; // workspace deleted — allow during cleanup

    if (workspace.isSuspended) {
        console.log(`🚫 Workspace ${workspace._id} is suspended`);
        return false;
    }

    if (workspace.usedReplies >= workspace.replyLimit) {
        console.log(`🚫 Workspace quota reached: ${workspace.usedReplies}/${workspace.replyLimit}`);
        return false;
    }

    return true;
};

/**
 * Increment workspace reply counter after a successful AI reply.
 * Also increments page-level analytics.
 */
const incrementUsage = async (page, tokenData = {}) => {
    const { inputTokens = 0, outputTokens = 0, totalTokens = 0, estimatedCost = 0 } = tokenData;

    // Workspace-level
    if (page.workspaceId) {
        await Workspace.findByIdAndUpdate(page.workspaceId, {
            $inc: { usedReplies: 1 },
        });
    }

    // Page-level analytics (kept for per-page reporting)
    await Page.findByIdAndUpdate(page._id, {
        $inc: {
            totalMessages: 1,
            totalAIReplies: 1,
            monthlyUsageCount: 1,
            totalTokensUsed: totalTokens,
        },
    });
};

/**
 * Write a message to the new ConversationMessage collection (scalable storage).
 * This runs alongside the existing Conversation.messages $push for backward compat.
 */
const writeConversationMessage = async (conversation, page, role, content, tokenData = {}) => {
    try {
        if (!conversation?._id || !page?.workspaceId) return;
        await ConversationMessage.create({
            conversationId: conversation._id,
            workspaceId: page.workspaceId,
            pageId: page.pageId,
            senderId: conversation.senderId,
            role,
            content,
            inputTokens: tokenData.inputTokens || 0,
            outputTokens: tokenData.outputTokens || 0,
            totalTokens: tokenData.totalTokens || 0,
            estimatedCost: tokenData.estimatedCost || 0,
            attachmentType: tokenData.attachmentType || null,
        });
    } catch (err) {
        console.log("ConversationMessage write error (non-blocking):", err.message);
    }
};

// ─── Webhook Verification ─────────────────────────────────────────────────────

const verifyWebhook = (req, res) => {
    const mode = req.query["hub.mode"];
    const challenge = req.query["hub.challenge"];
    const token = req.query["hub.verify_token"];

    if (mode === "subscribe" && token === process.env.FACEBOOK_VERIFY_TOKEN) {
        console.log("✅ Webhook verified");
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
};

// ─── Main Incoming Message Handler ───────────────────────────────────────────

const handleIncomingMessage = async (req, res) => {
    res.status(200).send("EVENT_RECEIVED");

    if (req.body.object !== "page") return;

    for (const entry of req.body.entry) {
        const pageId = String(entry.id);

        if (!entry.messaging || entry.messaging.length === 0) continue;

        const page = await Page.findOne({ pageId, isActive: true });
        if (!page) {
            console.log("No active page found for:", pageId);
            continue;
        }

        for (const event of entry.messaging) {
            // Skip non-message events
            if (!event.message) continue;

            // ── Echo handling — admin manual replies ──────────────────────
            if (event.message.is_echo === true) {
                const echoAppId = event.message.app_id;
                const ourAppId = process.env.FACEBOOK_APP_ID;

                // Our bot's own echo — ignore
                if (echoAppId && String(echoAppId) === String(ourAppId)) continue;

                // Admin manual reply
                const echoPageId = String(entry.id);
                const echoUserId = String(event.recipient.id);
                const adminText = event.message.text || "[attachment]";

                try {
                    const updated = await Conversation.findOneAndUpdate(
                        { pageId: echoPageId, senderId: echoUserId },
                        {
                            humanActive: true,
                            lastHumanReplyAt: Date.now(),
                            $push: {
                                messages: { $each: [{ role: "admin", content: adminText }], $slice: -50 },
                            },
                            $inc: { messageCount: 1 },
                        },
                        { new: true }
                    );

                    if (updated) {
                        // Dual-write to ConversationMessage
                        await writeConversationMessage(updated, page, "admin", adminText);

                        getIO()?.to(`page:${echoPageId}`).emit("new_message", {
                            pageId: echoPageId,
                            senderId: echoUserId,
                            message: { role: "admin", content: adminText, timestamp: new Date() },
                        });

                        try {
                            const updatedStory = await updateContextStory(updated.contextStory, "admin", adminText);
                            await Conversation.findOneAndUpdate(
                                { pageId: echoPageId, senderId: echoUserId },
                                { $set: { contextStory: updatedStory } }
                            );
                        } catch (_) { }
                    }
                } catch (err) {
                    console.log("Human takeover update error:", err.message);
                }
                continue;
            }

            if (!event.sender) continue;

            const senderId = String(event.sender.id);
            const messageId = event.message.mid;

            // Image attachment
            const imageAttachment = event.message?.attachments?.find(a => a.type === "image");
            if (imageAttachment) {
                const imageUrl = imageAttachment.payload?.url;
                if (imageUrl) {
                    await handleImageMessage(senderId, imageUrl, page, pageId, messageId);
                }
                continue;
            }

            if (!event.message.text) continue;

            const userText = event.message.text;
            console.log(`[${page.pageName}] Message from ${senderId}: ${userText}`);

            if (!page.aiEnabled) continue;
            if (page.automationEnabled === false) continue;

            // ── Workspace quota check ─────────────────────────────────────
            const allowed = await hasQuota(page);
            if (!allowed) {
                try {
                    await sendMessage(page.pageAccessToken, senderId, "Your monthly AI reply limit has been reached. Please upgrade your plan.");
                } catch (_) { }
                continue;
            }

            // ── Fetch / create conversation ───────────────────────────────
            let existingConvo = null;
            try {
                existingConvo = await Conversation.findOne({ pageId, senderId });
            } catch (_) { }

            try {
                let profileUpdates = {};
                if (!existingConvo?.profile?.name || existingConvo.profile.name === "Unknown User" || !existingConvo?.profile?.profilePic) {
                    const profile = await fetchUserProfile(senderId, page.pageAccessToken);
                    profileUpdates = { "profile.name": profile.name, "profile.profilePic": profile.profilePic };
                }

                const updateDoc = {
                    $push: { messages: { $each: [{ role: "user", content: userText }], $slice: -50 } },
                    $inc: { messageCount: 1 },
                    lastMessageAt: Date.now(),
                };
                if (Object.keys(profileUpdates).length > 0) updateDoc.$set = profileUpdates;
                if (page.workspaceId && !existingConvo?.workspaceId) {
                    updateDoc.$set = { ...(updateDoc.$set || {}), workspaceId: page.workspaceId };
                }

                const conversation = await Conversation.findOneAndUpdate(
                    { pageId, senderId },
                    updateDoc,
                    { new: true, upsert: true }
                );

                // Dual-write user message to ConversationMessage
                await writeConversationMessage(conversation, page, "user", userText);

                getIO()?.to(`page:${pageId}`).emit("new_message", {
                    pageId, senderId,
                    message: { role: "user", content: userText, timestamp: new Date() },
                });

                if (conversation.humanActive) continue;
                if (conversation.aiEnabled === false) continue;

                // Memory extraction
                const nameMatch = userText.match(/my name is ([\w\s]+)/i);
                if (nameMatch) {
                    const extractedName = nameMatch[1].trim();
                    await Conversation.findOneAndUpdate({ pageId, senderId }, { $set: { "profile.name": extractedName } });
                    conversation.profile = { ...conversation.profile, name: extractedName };
                }

                // Sync admin messages from Facebook Conversations API
                try {
                    const convoRes = await axios.get(
                        `https://graph.facebook.com/v19.0/${pageId}/conversations`,
                        { params: { access_token: page.pageAccessToken, user_id: senderId, fields: "messages{message,from,created_time}" } }
                    );
                    const thread = convoRes.data?.data?.[0];
                    if (thread?.messages?.data?.length > 0) {
                        const adminMessages = thread.messages.data
                            .slice(0, 10)
                            .filter(m => String(m.from?.id) === pageId && m.message);
                        const existingContents = new Set(conversation.messages.map(m => m.content));
                        const newAdminMessages = adminMessages.filter(m => !existingContents.has(m.message));

                        if (newAdminMessages.length > 0) {
                            const adminDocs = newAdminMessages.map(m => ({
                                role: "admin",
                                content: m.message,
                                timestamp: new Date(m.created_time),
                            }));
                            await Conversation.findOneAndUpdate(
                                { pageId, senderId },
                                { $push: { messages: { $each: adminDocs, $slice: -50 } } }
                            );
                            const refreshed = await Conversation.findOne({ pageId, senderId });
                            conversation.messages = refreshed.messages;
                        }
                    }
                } catch (_) { }

                // Image context expiry
                let hasImageContext = false;
                if (conversation.lastImageContext && conversation.lastImageTimestamp) {
                    const imageAge = Date.now() - new Date(conversation.lastImageTimestamp).getTime();
                    if (imageAge < 5 * 60 * 1000) {
                        hasImageContext = true;
                    } else {
                        await Conversation.findOneAndUpdate(
                            { pageId, senderId },
                            { $set: { lastImageContext: null, lastImageTimestamp: null } }
                        );
                    }
                }

                // ── Build AI messages ─────────────────────────────────────
                const sortedMessages = [...conversation.messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                const priorMessages = sortedMessages.slice(-6, -1);
                const adminDirectives = priorMessages.filter(m => m.role === "admin").map(m => m.content);
                const conversationMessages = priorMessages.filter(m => m.role !== "admin").map(m => ({ role: m.role, content: m.content }));

                const dynamicPrompt = buildDynamicPrompt(page);
                const openaiMessages = [{ role: "system", content: dynamicPrompt }];

                try {
                    const instructionDoc = await PageInstruction.findOne({ pageId });
                    openaiMessages.push({
                        role: "system",
                        content: `Core Business Rules:\nYou are replying on behalf of the Facebook page owner.\nFollow page instructions strictly.\nDo not invent business information.`,
                    });
                    if (instructionDoc) {
                        const active = instructionDoc.instructions.filter(i => i.isActive).map(i => i.text);
                        if (active.length > 0) {
                            openaiMessages.push({ role: "system", content: `Page Instructions:\n${active.join("\n")}` });
                        }
                    }
                    if (conversation.contextStory) {
                        openaiMessages.push({ role: "system", content: `Summary: ${conversation.contextStory}` });
                    }
                } catch (_) { }

                const memCtx = buildMemoryContext(conversation.profile);
                if (memCtx) openaiMessages.push({ role: "system", content: memCtx });
                if (hasImageContext) {
                    openaiMessages.push({ role: "system", content: `Image context: ${conversation.lastImageContext}` });
                }
                if (conversationMessages.length > 0) openaiMessages.push(...conversationMessages);
                if (adminDirectives.length > 0) {
                    openaiMessages.push({ role: "system", content: `Moderator Instructions: ${adminDirectives.join(" ")}` });
                }
                openaiMessages.push({ role: "user", content: userText });

                const aiStart = Date.now();
                const response = await generateAIReply(userText, dynamicPrompt, openaiMessages);
                const aiLatency = Date.now() - aiStart;

                const aiReply = response.reply;
                const inputTokens = response.usage?.prompt_tokens || 0;
                const outputTokens = response.usage?.completion_tokens || 0;
                const totalTokens = response.usage?.total_tokens || 0;
                const estimatedCost = (inputTokens / 1000) * 0.005 + (outputTokens / 1000) * 0.015;

                console.log(`AI reply (${aiLatency}ms):`, aiReply.substring(0, 100));

                // Save AI reply to conversation (backward compat embedded array)
                await Conversation.findOneAndUpdate(
                    { pageId, senderId },
                    {
                        $push: { messages: { $each: [{ role: "assistant", content: aiReply }], $slice: -50 } },
                        $inc: { messageCount: 1 },
                        $set: { lastAiReplyAt: Date.now() },
                    }
                );

                // Dual-write to ConversationMessage (new scalable storage)
                await writeConversationMessage(conversation, page, "assistant", aiReply, { inputTokens, outputTokens, totalTokens, estimatedCost });

                getIO()?.to(`page:${pageId}`).emit("new_message", {
                    pageId, senderId,
                    message: { role: "assistant", content: aiReply, timestamp: new Date() },
                });

                // Emotion reaction
                const emotion = detectEmotion(userText);
                const { shouldReact, emoji } = getReactionForEmotion(emotion);
                if (shouldReact && messageId) {
                    try { await addReaction(page.pageAccessToken, senderId, messageId, emoji); } catch (_) { }
                }

                try { await markSeen(page.pageAccessToken, senderId); } catch (_) { }
                await new Promise(r => setTimeout(r, 2500));
                try { await showTyping(page.pageAccessToken, senderId); } catch (_) { }

                const typingDelay = Math.min(6000, Math.max(1800, aiReply.length * 35 + Math.floor(Math.random() * 600)));
                await new Promise(r => setTimeout(r, typingDelay));

                // Pre-send admin takeover check
                try {
                    const checkRes = await axios.get(
                        `https://graph.facebook.com/v19.0/${pageId}/conversations`,
                        { params: { access_token: page.pageAccessToken, user_id: senderId, fields: "messages{message,from,created_time}" } }
                    );
                    const thread = checkRes.data?.data?.[0];
                    if (thread?.messages?.data?.length > 0) {
                        const latest = thread.messages.data[0];
                        const latestFrom = String(latest.from?.id);
                        const timeDiff = Date.now() - new Date(latest.created_time).getTime();
                        if (latestFrom === pageId && latest.message !== aiReply && timeDiff < 60000) {
                            await Conversation.findOneAndUpdate({ pageId, senderId }, { humanActive: true, lastHumanReplyAt: Date.now() });
                            console.log("🚫 Admin already replied — cancelling AI reply");
                            continue;
                        }
                    }
                } catch (_) { }

                // Final humanActive re-check
                try {
                    const fresh = await Conversation.findOne({ pageId, senderId });
                    if (fresh?.humanActive) { console.log("🚫 Human takeover via echo — cancelling"); continue; }
                } catch (_) { }

                await sendMessage(page.pageAccessToken, senderId, aiReply, messageId);

                // Legacy MessageLog (kept for admin analytics backward compat)
                try {
                    await MessageLog.create({
                        userId: page.userId,
                        pageId: page.pageId,
                        senderId,
                        messageText: userText,
                        aiReply,
                        inputTokens,
                        outputTokens,
                        totalTokens,
                        estimatedCost,
                    });
                } catch (_) { }

                // Increment workspace + page usage counters
                await incrementUsage(page, { inputTokens, outputTokens, totalTokens, estimatedCost });

                // Rolling context summary
                try {
                    const exchange = `User: ${userText}\nAI: ${aiReply}`;
                    const updatedStory = await updateContextStory(conversation.contextStory, "assistant", exchange);
                    await Conversation.findOneAndUpdate({ pageId, senderId }, { $set: { contextStory: updatedStory } });
                } catch (_) { }

            } catch (err) {
                console.log("AI/Send error:", err.response?.data || err.message);
                try {
                    try { await markSeen(page.pageAccessToken, senderId); } catch (_) { }
                    await new Promise(r => setTimeout(r, 2500));
                    try { await showTyping(page.pageAccessToken, senderId); } catch (_) { }
                    await new Promise(r => setTimeout(r, 1800));
                    await sendMessage(page.pageAccessToken, senderId, "Sorry, please try again later.", messageId);
                } catch (_) { }
            }
        }
    }
};

// ─── Image Message Handler ────────────────────────────────────────────────────

const handleImageMessage = async (senderId, imageUrl, page, pageId, messageId) => {
    if (!page.aiEnabled || page.automationEnabled === false) return;

    const allowed = await hasQuota(page);
    if (!allowed) {
        try { await sendMessage(page.pageAccessToken, senderId, "Your monthly AI reply limit has been reached."); } catch (_) { }
        return;
    }

    try {
        const existingConvo = await Conversation.findOne({ pageId, senderId });
        let profileUpdates = {};
        if (!existingConvo?.profile?.name || existingConvo.profile.name === "Unknown User") {
            const profile = await fetchUserProfile(senderId, page.pageAccessToken);
            profileUpdates = { "profile.name": profile.name, "profile.profilePic": profile.profilePic };
        }

        const updateDoc = {
            $push: { messages: { $each: [{ role: "user", content: "[Image]" }], $slice: -50 } },
            $inc: { messageCount: 1 },
            lastMessageAt: Date.now(),
            $set: { lastImageTimestamp: Date.now(), ...(Object.keys(profileUpdates).length ? profileUpdates : {}) },
        };

        const conversation = await Conversation.findOneAndUpdate(
            { pageId, senderId },
            updateDoc,
            { new: true, upsert: true }
        );

        await writeConversationMessage(conversation, page, "user", "[Image]", { attachmentType: "image" });

        getIO()?.to(`page:${pageId}`).emit("new_message", {
            pageId, senderId,
            message: { role: "user", content: "[Image]", timestamp: new Date() },
        });

        if (conversation.humanActive || conversation.aiEnabled === false) return;

        const response = await analyzeImage(imageUrl);
        const imageDescription = response.reply;
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        const totalTokens = response.usage?.total_tokens || 0;
        const estimatedCost = (inputTokens / 1000) * 0.005 + (outputTokens / 1000) * 0.015;

        await Conversation.findOneAndUpdate(
            { pageId, senderId },
            { $set: { lastImageContext: imageDescription } }
        );

        const intent = await classifyImageIntent(conversation.contextStory || "", imageDescription);
        const replyResponse = await generateImageReply(conversation.contextStory || "", imageDescription, intent, page);
        const aiReply = replyResponse.reply;
        const replyInputTokens = replyResponse.usage?.prompt_tokens || 0;
        const replyOutputTokens = replyResponse.usage?.completion_tokens || 0;
        const replyTotalTokens = replyResponse.usage?.total_tokens || 0;
        const replyEstimatedCost = (replyInputTokens / 1000) * 0.005 + (replyOutputTokens / 1000) * 0.015;

        const totalIn = inputTokens + replyInputTokens;
        const totalOut = outputTokens + replyOutputTokens;
        const totalTok = totalTokens + replyTotalTokens;
        const totalCost = estimatedCost + replyEstimatedCost;

        await Conversation.findOneAndUpdate(
            { pageId, senderId },
            {
                $push: { messages: { $each: [{ role: "assistant", content: aiReply }], $slice: -50 } },
                $inc: { messageCount: 1 },
                $set: { lastAiReplyAt: Date.now() },
            }
        );

        await writeConversationMessage(conversation, page, "assistant", aiReply, {
            inputTokens: totalIn,
            outputTokens: totalOut,
            totalTokens: totalTok,
            estimatedCost: totalCost,
            attachmentType: "image",
        });

        getIO()?.to(`page:${pageId}`).emit("new_message", {
            pageId, senderId,
            message: { role: "assistant", content: aiReply, timestamp: new Date() },
        });

        try { await markSeen(page.pageAccessToken, senderId); } catch (_) { }
        await new Promise(r => setTimeout(r, 2500));
        try { await showTyping(page.pageAccessToken, senderId); } catch (_) { }
        const typingDelay = Math.min(5000, Math.max(1800, aiReply.length * 35 + Math.floor(Math.random() * 600)));
        await new Promise(r => setTimeout(r, typingDelay));

        await sendMessage(page.pageAccessToken, senderId, aiReply, messageId);

        try {
            await MessageLog.create({
                userId: page.userId,
                pageId: page.pageId,
                senderId,
                messageText: `[Image: ${intent}]`,
                aiReply,
                inputTokens: totalIn,
                outputTokens: totalOut,
                totalTokens: totalTok,
                estimatedCost: totalCost,
            });
        } catch (_) { }

        await incrementUsage(page, { inputTokens: totalIn, outputTokens: totalOut, totalTokens: totalTok, estimatedCost: totalCost });

        try {
            const exchange = `User: [Sent an image classified as ${intent}] ${imageDescription.substring(0, 100)}\nAI: ${aiReply}`;
            const updatedStory = await updateContextStory(conversation.contextStory || "", "assistant", exchange);
            await Conversation.findOneAndUpdate({ pageId, senderId }, { $set: { contextStory: updatedStory } });
        } catch (_) { }

    } catch (err) {
        console.log("Image analysis error:", err.response?.data || err.message);
        try {
            try { await markSeen(page.pageAccessToken, senderId); } catch (_) { }
            await new Promise(r => setTimeout(r, 2500));
            try { await showTyping(page.pageAccessToken, senderId); } catch (_) { }
            await new Promise(r => setTimeout(r, 1800));
            await sendMessage(page.pageAccessToken, senderId, "I couldn't analyze the image. Please try again.", messageId);
        } catch (_) { }
    }
};

export { verifyWebhook, handleIncomingMessage };
