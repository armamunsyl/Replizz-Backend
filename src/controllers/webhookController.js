import axios from "axios";
import Page from "../models/Page.js";
import Conversation from "../models/Conversation.js";
import MessageLog from "../models/MessageLog.js";
import PageInstruction from "../models/PageInstruction.js";
import { sendMessage, markSeen, showTyping, addReaction } from "../services/facebookService.js";
import { generateAIReply, analyzeImage, updateContextStory, classifyImageIntent, generateImageReply } from "../../utils/openai.js";
import { buildDynamicPrompt, buildMemoryContext } from "../../utils/promptBuilder.js";
import { detectEmotion, getReactionForEmotion } from "../../utils/emotionDetector.js";

// Helper to fetch Facebook user profile (name and profile picture) using PSID
const fetchUserProfile = async (psid, pageAccessToken) => {
    try {
        const response = await axios.get(`https://graph.facebook.com/v19.0/${psid}`, {
            params: {
                fields: "first_name,last_name,profile_pic",
                access_token: pageAccessToken,
            },
        });
        const data = response.data;
        const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || "Unknown User";
        const profilePic = data.profile_pic || null;
        console.log(`✅ Successfully fetched profile for PSID ${psid}: ${name}`);
        return { name, profilePic };
    } catch (err) {
        console.error(`❌ Failed to fetch profile for PSID ${psid}:`, err.response?.data?.error?.message || err.message);
        return { name: "Unknown User", profilePic: null };
    }
};

const verifyWebhook = (req, res) => {
    const mode = req.query["hub.mode"];
    const challenge = req.query["hub.challenge"];
    const token = req.query["hub.verify_token"];

    if (mode === "subscribe" && token === process.env.FACEBOOK_VERIFY_TOKEN) {
        console.log("✅ Webhook verified");
        return res.status(200).send(challenge);
    }

    console.log("❌ Webhook verification failed");
    return res.sendStatus(403);
};

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
            console.log("==== FULL EVENT TYPE CHECK ====");

            if (event.message) {
                console.log("MESSAGE EVENT DETECTED");
                console.log("is_echo:", event.message.is_echo);
                console.log("sender:", event.sender?.id);
                console.log("recipient:", event.recipient?.id);
                console.log("pageId (entry.id):", pageId);
                console.log("text:", event.message.text || "(no text)");
            }

            if (event.delivery) {
                console.log("DELIVERY EVENT — skipping");
            }

            if (event.read) {
                console.log("READ EVENT — skipping");
            }

            console.log("================================");

            // Skip non-message events
            if (!event.message) continue;

            // Echo detection — distinguish bot reply echoes from admin manual replies
            if (event.message.is_echo === true) {
                const echoAppId = event.message.app_id;
                const ourAppId = process.env.FACEBOOK_APP_ID;
                console.log("🔔 ECHO EVENT DETAILS:");
                console.log("  sender.id:", event.sender?.id);
                console.log("  recipient.id:", event.recipient?.id);
                console.log("  pageId:", pageId);
                console.log("  app_id:", echoAppId || "(none — manual admin reply!)");
                console.log("  our FACEBOOK_APP_ID:", ourAppId);
                console.log("  text:", event.message.text || "(no text)");

                // If echo has app_id matching OUR app, it's our bot's own reply — skip
                if (echoAppId && String(echoAppId) === String(ourAppId)) {
                    console.log("🤖 Echo from OUR bot — ignoring.");
                    continue;
                }

                // Any other echo = admin manual reply (no app_id, or different app)
                console.log("✅ ADMIN MANUAL REPLY CONFIRMED (not from our bot)");

                const echoPageId = String(entry.id);
                const echoUserId = String(event.recipient.id);

                console.log("🔍 DB lookup params:", { pageId: echoPageId, senderId: echoUserId });

                // Debug: show all conversations for this page to find the right senderId
                try {
                    const allConvos = await Conversation.find({ pageId: echoPageId }).select('senderId humanActive lastHumanReplyAt').lean();
                    console.log("📂 All conversations for this page:", JSON.stringify(allConvos, null, 2));
                } catch (dbErr) {
                    console.log("DB debug query error:", dbErr.message);
                }

                try {
                    const adminMessageText = event.message.text || "[attachment]";
                    const updated = await Conversation.findOneAndUpdate(
                        {
                            pageId: echoPageId,
                            senderId: echoUserId,
                        },
                        {
                            humanActive: true,
                            lastHumanReplyAt: Date.now(),
                            $push: {
                                messages: {
                                    $each: [{ role: "admin", content: adminMessageText }],
                                    $slice: -50,
                                },
                            },
                            $inc: { messageCount: 1 },
                        },
                        { new: true }
                    );

                    if (!updated) {
                        console.log("❌ Conversation NOT FOUND for takeover! No doc matches:", { pageId: echoPageId, senderId: echoUserId });
                    } else {
                        console.log("✅ Human takeover activated:", {
                            _id: updated._id,
                            pageId: updated.pageId,
                            senderId: updated.senderId,
                            humanActive: updated.humanActive,
                            lastHumanReplyAt: updated.lastHumanReplyAt,
                        });

                        // Update context story with admin message
                        try {
                            const updatedStory = await updateContextStory(updated.contextStory, "admin", adminMessageText);
                            await Conversation.findOneAndUpdate(
                                { pageId: echoPageId, senderId: echoUserId },
                                { $set: { contextStory: updatedStory } }
                            );
                            console.log("📖 Context story updated with admin message");
                        } catch (storyErr) {
                            console.log("Context story update error (admin):", storyErr.message);
                        }
                    }
                } catch (htErr) {
                    console.log("Human takeover update error:", htErr.message);
                }
                continue;
            }

            if (!event.sender) continue;

            const senderId = String(event.sender.id);
            const messageId = event.message.mid;

            // --- Image attachment detection ---
            const imageAttachment = event.message?.attachments?.find(
                (a) => a.type === "image"
            );

            if (imageAttachment) {
                const imageUrl = imageAttachment.payload?.url;
                if (imageUrl) {
                    await handleImageMessage(senderId, imageUrl, page, pageId, messageId);
                    continue;
                }
            }

            // Text-only guard (existing behavior)
            if (!event.message.text) continue;

            const userText = event.message.text;

            console.log(`[${page.pageName}] Message from ${senderId}: ${userText}`);
            console.log("Types:", { pageIdType: typeof pageId, senderIdType: typeof senderId, pageId, senderId });

            if (!page.aiEnabled) {
                console.log("AI disabled for page:", page.pageName);
                continue;
            }

            if (page.planType === "free" && page.monthlyUsageCount >= page.monthlyLimit) {
                console.log("Monthly limit reached for page:", page.pageId);
                try {
                    await sendMessage(page.pageAccessToken, senderId, "Your monthly AI message limit has been reached. Please upgrade your plan.");
                } catch (limitErr) {
                    console.log("Limit message error:", limitErr.response?.data || limitErr.message);
                }
                continue;
            }

            // Fetch existing conversation and verify if profile fetch is needed
            let existingConvo = null;
            try {
                existingConvo = await Conversation.findOne({ pageId, senderId });
            } catch (err) {
                console.log("Check existing convo error:", err.message);
            }

            try {
                // Fetch profile if this is a new conversation
                let profileUpdates = {};
                if (!existingConvo || !existingConvo.profile?.name || existingConvo.profile.name === "Unknown User" || !existingConvo.profile?.profilePic) {
                    console.log(`👤 Fetching profile for new sender ${senderId} on page ${pageId}`);
                    const profileData = await fetchUserProfile(senderId, page.pageAccessToken);
                    profileUpdates = {
                        "profile.name": profileData.name,
                        "profile.profilePic": profileData.profilePic
                    };
                }

                // 1. Save user message BEFORE calling OpenAI
                const updateDoc = {
                    $push: {
                        messages: {
                            $each: [{ role: "user", content: userText }],
                            $slice: -50,
                        },
                    },
                    $inc: { messageCount: 1 },
                    lastMessageAt: Date.now(),
                };
                if (Object.keys(profileUpdates).length > 0) {
                    updateDoc.$set = profileUpdates;
                }

                const conversation = await Conversation.findOneAndUpdate(
                    { pageId, senderId },
                    updateDoc,
                    { new: true, upsert: true }
                );


                // ==== DEBUG: Verify message storage ====
                console.log("==== DEBUG: MESSAGE STORAGE ====");
                console.log("Conversation ID:", conversation._id);
                console.log("Total messages in DB:", conversation.messages.length);
                console.log("Message count field:", conversation.messageCount);
                console.log("Context story:", conversation.contextStory || "(empty)");
                console.log("Last 5 stored messages:", conversation.messages.slice(-5).map(m => `${m.role}: ${m.content.substring(0, 60)}`));
                console.log("================================");

                // Enforce AI Skip Toggles BEFORE further processing
                if (conversation.humanActive) {
                    console.log(`🚫 Human Active is ON for sender ${senderId}. Skipping AI reply.`);
                    continue;
                }
                if (conversation.aiEnabled === false) {
                    console.log(`🚫 AI is explicitly disabled for sender ${senderId}. Skipping AI reply.`);
                    continue;
                }

                // 2. Memory extraction — detect and store user-provided facts
                const nameMatch = userText.match(/my name is ([\w\s]+)/i);
                if (nameMatch) {
                    const extractedName = nameMatch[1].trim();
                    await Conversation.findOneAndUpdate(
                        { pageId, senderId },
                        { $set: { "profile.name": extractedName } }
                    );
                    conversation.profile = { ...conversation.profile, name: extractedName };
                    console.log(`📝 Extracted user profile:`, { name: extractedName });
                }

                // 2.2 Sync admin messages from Facebook Conversations API
                // (Echo events often don't arrive, so we fetch directly)
                try {
                    const convoRes = await axios.get(
                        `https://graph.facebook.com/v19.0/${pageId}/conversations`,
                        {
                            params: {
                                access_token: page.pageAccessToken,
                                user_id: senderId,
                                fields: "messages{message,from,created_time}",
                            },
                        }
                    );

                    const thread = convoRes.data?.data?.[0];
                    if (thread?.messages?.data?.length > 0) {
                        // Get recent page-sent messages (admin replies)
                        const recentFbMessages = thread.messages.data.slice(0, 10); // newest first
                        const adminMessages = recentFbMessages.filter(m => String(m.from?.id) === pageId && m.message);

                        // Get existing message contents to avoid duplicates
                        const existingContents = new Set(
                            conversation.messages.map(m => m.content)
                        );

                        // Find admin messages not already stored
                        const newAdminMessages = adminMessages.filter(m => !existingContents.has(m.message));

                        if (newAdminMessages.length > 0) {
                            console.log(`📥 Syncing ${newAdminMessages.length} admin messages from Facebook API`);

                            // Push missing admin messages to DB
                            const adminDocs = newAdminMessages.map(m => ({
                                role: "admin",
                                content: m.message,
                                timestamp: new Date(m.created_time),
                            }));

                            await Conversation.findOneAndUpdate(
                                { pageId, senderId },
                                {
                                    $push: {
                                        messages: {
                                            $each: adminDocs,
                                            $slice: -50,
                                        },
                                    },
                                }
                            );

                            // Re-fetch conversation with synced messages
                            const updatedConvo = await Conversation.findOne({ pageId, senderId });
                            conversation.messages = updatedConvo.messages;
                            console.log("✅ Admin messages synced. Total messages now:", conversation.messages.length);
                        }
                    }
                } catch (syncErr) {
                    console.log("⚠️ Admin message sync failed (non-blocking):", syncErr.response?.data?.error?.message || syncErr.message);
                }

                // 2.5 Check for image context — if user is asking about a recently analyzed image
                let hasImageContext = false;

                if (conversation.lastImageContext && conversation.lastImageTimestamp) {
                    const imageAge = Date.now() - new Date(conversation.lastImageTimestamp).getTime();
                    if (imageAge < 5 * 60 * 1000) {
                        hasImageContext = true;
                    } else {
                        // Expired — clear image context
                        await Conversation.findOneAndUpdate(
                            { pageId, senderId },
                            { $set: { lastImageContext: null, lastImageTimestamp: null } }
                        );
                    }
                }

                let response;
                let aiLatency;

                {
                    // Normal text flow
                    // 3. Get last 5 messages for context
                    const sortedMessages = [...conversation.messages]
                        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                    // Take last 5 messages (excluding the current user message we just pushed)
                    const priorMessages = sortedMessages.slice(-6, -1);

                    // Separate admin directives
                    const adminDirectives = priorMessages
                        .filter(m => m.role === "admin")
                        .map(m => m.content);

                    // Filter out admin messages from conversation history for cleaner API payload
                    const conversationMessages = priorMessages
                        .filter(m => m.role !== "admin")
                        .map(m => ({ role: m.role, content: m.content }));

                    // 4. Build system prompt
                    const dynamicPrompt = buildDynamicPrompt(page);

                    // 5. Build messages array
                    const openaiMessages = [
                        { role: "system", content: dynamicPrompt },
                    ];

                    // INSTRUCTIONS & RULES
                    try {
                        const instructionDoc = await PageInstruction.findOne({ pageId });
                        
                        // 1. Core Business Rules (Always Mandated)
                        const coreRules = [
                            "You are replying on behalf of the Facebook page owner.",
                            "Follow page instructions strictly.",
                            "Do not invent business information."
                        ];
                        
                        openaiMessages.push({
                            role: "system",
                            content: `Core Business Rules:\n${coreRules.join("\n")}`,
                        });

                        // 2. Page Specific Instructions (Full & Active)
                        if (instructionDoc) {
                            const activeInstructions = instructionDoc.instructions
                                .filter(i => i.isActive)
                                .map(i => i.text);
                            
                            if (activeInstructions.length > 0) {
                                openaiMessages.push({
                                    role: "system",
                                    content: `Page Instructions:\n${activeInstructions.join("\n")}`,
                                });
                            }
                        }

                        // 3. Conversation Summary (Rolling Context)
                        if (conversation.contextStory) {
                            openaiMessages.push({
                                role: "system",
                                content: `Summary: ${conversation.contextStory}`,
                            });
                        }
                    } catch (instrErr) {
                        console.log("Instruction restoration error:", instrErr.message);
                    }

                    // Inject known user info
                    const memoryContext = buildMemoryContext(conversation.profile);
                    if (memoryContext) {
                        openaiMessages.push({ role: "system", content: memoryContext });
                    }

                    // Inject image analysis summary if fresh
                    if (hasImageContext) {
                        openaiMessages.push({
                            role: "system",
                            content: `Image context: ${conversation.lastImageContext}`,
                        });
                    }

                    // RECENT MESSAGES (Last 5)
                    if (conversationMessages.length > 0) {
                        openaiMessages.push(...conversationMessages);
                    }

                    // ACTIVE MODERATOR DIRECTIVES
                    if (adminDirectives.length > 0) {
                        openaiMessages.push({
                            role: "system",
                            content: `Moderator Instructions: ${adminDirectives.join(" ")}`,
                        });
                    }

                    // CURRENT USER MESSAGE
                    openaiMessages.push({ role: "user", content: userText });

                    const aiStart = Date.now();
                    response = await generateAIReply(userText, dynamicPrompt, openaiMessages);
                    aiLatency = Date.now() - aiStart;
                }

                const aiReply = response.reply;
                const inputTokens = response.usage?.prompt_tokens || 0;
                const outputTokens = response.usage?.completion_tokens || 0;
                const totalTokens = response.usage?.total_tokens || 0;
                const estimatedCost =
                    (inputTokens / 1000) * 0.005 +
                    (outputTokens / 1000) * 0.015;

                console.log(`AI reply (${aiLatency}ms):`, aiReply.substring(0, 100));
                console.log("Tokens:", { inputTokens, outputTokens, totalTokens, estimatedCost });

                await Conversation.findOneAndUpdate(
                    { pageId, senderId },
                    {
                        $push: {
                            messages: {
                                $each: [{ role: "assistant", content: aiReply }],
                                $slice: -50,
                            },
                        },
                        $inc: { messageCount: 1 },
                        $set: { lastAiReplyAt: Date.now() }
                    }
                );


                // Emotion-aware selective reaction
                const emotion = detectEmotion(userText);
                const { shouldReact, emoji } = getReactionForEmotion(emotion);

                if (shouldReact && messageId) {
                    try {
                        await addReaction(page.pageAccessToken, senderId, messageId, emoji);
                    } catch (_) { }
                }

                try {
                    await markSeen(page.pageAccessToken, senderId);
                    console.log("👁️ Marked seen");
                } catch (seenErr) {
                    console.log("Mark seen error:", seenErr.response?.data || seenErr.message);
                }

                // Pause before typing (simulates reading the message)
                await new Promise(resolve => setTimeout(resolve, 2500));
                console.log("⏳ Starting typing indicator");

                try {
                    await showTyping(page.pageAccessToken, senderId);
                    console.log("⌨️ Typing started");
                } catch (typingErr) {
                    console.log("Typing indicator error:", typingErr.response?.data || typingErr.message);
                }

                // Human-like typing delay: scales with length + random variance
                const baseDelay = aiReply.length * 35;
                const randomVariance = Math.floor(Math.random() * 600);
                const typingDelay = Math.min(6000, Math.max(1800, baseDelay + randomVariance));
                console.log(`⏱️ Typing for ${typingDelay}ms (base: ${baseDelay}, variance: ${randomVariance})`);
                await new Promise(resolve => setTimeout(resolve, typingDelay));

                // Pre-send check: Query Facebook Conversations API to detect admin replies
                // This runs right before sending, maximizing window for admin detection
                try {
                    const convoRes = await axios.get(
                        `https://graph.facebook.com/v19.0/${pageId}/conversations`,
                        {
                            params: {
                                access_token: page.pageAccessToken,
                                user_id: senderId,
                                fields: "messages{message,from,created_time}",
                            },
                        }
                    );

                    const thread = convoRes.data?.data?.[0];
                    if (thread?.messages?.data?.length > 0) {
                        const latestMsg = thread.messages.data[0]; // most recent message
                        const latestFrom = String(latestMsg.from?.id);
                        const latestText = latestMsg.message;
                        const latestTime = new Date(latestMsg.created_time).getTime();
                        const timeDiff = Date.now() - latestTime;

                        console.log("📋 Facebook thread latest message:", {
                            from: latestFrom,
                            pageId,
                            isFromPage: latestFrom === pageId,
                            text: latestText?.substring(0, 50),
                            ageMs: timeDiff,
                        });

                        // If latest message is FROM the page, NOT our AI reply, and recent (< 60s)
                        if (latestFrom === pageId && latestText !== aiReply && timeDiff < 60000) {
                            console.log("🚫 Admin already replied! Cancelling AI reply.");

                            // Set human takeover in DB
                            await Conversation.findOneAndUpdate(
                                { pageId, senderId },
                                { humanActive: true, lastHumanReplyAt: Date.now() }
                            );
                            console.log("🧑 Human takeover activated via API check.");
                            continue;
                        }
                    }
                } catch (apiCheckErr) {
                    console.log("⚠️ Facebook conversation check failed (non-blocking):", apiCheckErr.response?.data?.error?.message || apiCheckErr.message);
                    // Non-blocking: if API check fails, proceed with AI reply
                }

                // Also re-check humanActive in DB (in case echo arrived during processing)
                try {
                    const freshConvo = await Conversation.findOne({ pageId, senderId });
                    if (freshConvo?.humanActive) {
                        console.log("🚫 Human takeover detected via echo. Cancelling AI reply.");
                        continue;
                    }
                } catch (_) { }

                const sendStart = Date.now();
                const sendResult = await sendMessage(page.pageAccessToken, senderId, aiReply, messageId);
                const sendLatency = Date.now() - sendStart;
                console.log(`✅ Reply sent after ${2500 + typingDelay + sendLatency}ms (read: 2500ms, typing: ${typingDelay}ms, send: ${sendLatency}ms):`, JSON.stringify(sendResult));

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
                } catch (logErr) {
                    console.log("Message log error:", logErr.message);
                }

                try {
                    page.totalMessages += 1;
                    page.totalAIReplies += 1;
                    page.monthlyUsageCount += 1;
                    await page.save();
                } catch (usageErr) {
                    console.log("Usage update error:", usageErr.message);
                }

                // 6. Unified Context Update (Rolling summary) - Occurs once after reply
                try {
                    const exchange = `User: ${userText}\nAI: ${aiReply}`;
                    const updatedStory = await updateContextStory(conversation.contextStory, "assistant", exchange);
                    await Conversation.findOneAndUpdate(
                        { pageId, senderId },
                        { $set: { contextStory: updatedStory } }
                    );
                    console.log("📖 Rolling summary updated after AI reply");
                } catch (storyErr) {
                    console.log("Rolling summary update error:", storyErr.message);
                }
            } catch (err) {
                console.log("AI/Send error:", err.response?.data || err.message);
                try {
                    // Still show human-like behavior on error
                    try { await markSeen(page.pageAccessToken, senderId); } catch (_) { }
                    await new Promise(resolve => setTimeout(resolve, 2500));
                    try { await showTyping(page.pageAccessToken, senderId); } catch (_) { }
                    const fallbackDelay = 1800 + Math.floor(Math.random() * 600);
                    await new Promise(resolve => setTimeout(resolve, fallbackDelay));
                    await sendMessage(page.pageAccessToken, senderId, "Sorry, please try again later.", messageId);
                } catch (fallbackErr) {
                    console.log("Fallback error:", fallbackErr.response?.data || fallbackErr.message);
                }
            }
        }
    }
};

/**
 * Handle an incoming image message using OpenAI vision.
 * @param {string} senderId - The Facebook user ID
 * @param {string} imageUrl - The URL of the image attachment
 * @param {object} page - The Page document from the database
 * @param {string} pageId - The Facebook page ID
 */
const handleImageMessage = async (senderId, imageUrl, page, pageId, messageId) => {
    if (!page.aiEnabled) return;

    if (page.planType === "free" && page.monthlyUsageCount >= page.monthlyLimit) {
        try {
            await sendMessage(page.pageAccessToken, senderId, "Your monthly AI message limit has been reached. Please upgrade your plan.");
        } catch (limitErr) {
            console.log("Limit message error:", limitErr.response?.data || limitErr.message);
        }
        return;
    }

    try {
        const existingConvoImage = await Conversation.findOne({ pageId, senderId });
        let profileUpdatesImage = {};
        if (!existingConvoImage || !existingConvoImage.profile?.name || existingConvoImage.profile.name === "Unknown User" || !existingConvoImage.profile?.profilePic) {
            console.log(`🖼️👤 Fetching profile for new sender ${senderId} on page ${pageId} (Image Message)`);
            const profileData = await fetchUserProfile(senderId, page.pageAccessToken);
            profileUpdatesImage = {
                "profile.name": profileData.name,
                "profile.profilePic": profileData.profilePic
            };
        }

        // 1. Fetch conversation to get contextStory and save user message
        const updateDocImage = {
            $push: {
                messages: {
                    $each: [{ role: "user", content: "[Image]" }],
                    $slice: -50,
                },
            },
            $inc: { messageCount: 1 },
            lastMessageAt: Date.now(),
        };

        let initialSet = { lastImageTimestamp: Date.now() };
        if (Object.keys(profileUpdatesImage).length > 0) {
            initialSet = { ...initialSet, ...profileUpdatesImage };
        }
        updateDocImage.$set = initialSet;

        const conversation = await Conversation.findOneAndUpdate(
            { pageId, senderId },
            updateDocImage,
            { new: true, upsert: true }
        );

        if (conversation.humanActive) {
            console.log(`🖼️🚫 Human Active is ON for sender ${senderId}. Skipping AI image reply.`);
            return;
        }
        if (conversation.aiEnabled === false) {
            console.log(`🖼️🚫 AI is explicitly disabled for sender ${senderId}. Skipping AI image reply.`);
            return;
        }

        // 2. Analyze image — get plain text description
        const response = await analyzeImage(imageUrl);
        const imageDescription = response.reply;
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        const totalTokens = response.usage?.total_tokens || 0;
        const estimatedCost =
            (inputTokens / 1000) * 0.005 + (outputTokens / 1000) * 0.015;

        console.log("🖼️ Image analyzed:", imageDescription.substring(0, 100));

        // Update with image context
        await Conversation.findOneAndUpdate(
            { pageId, senderId },
            { $set: { lastImageContext: imageDescription } }
        );

        const contextStory = conversation.contextStory || "";

        // 3. Classify image intent using contextStory + description
        const intent = await classifyImageIntent(contextStory, imageDescription);
        console.log("🏷️ Image intent classified:", intent);

        // 4. Generate context-aware reply based on intent
        const replyResponse = await generateImageReply(contextStory, imageDescription, intent, page);
        const aiReply = replyResponse.reply;
        const replyInputTokens = replyResponse.usage?.prompt_tokens || 0;
        const replyOutputTokens = replyResponse.usage?.completion_tokens || 0;
        const replyTotalTokens = replyResponse.usage?.total_tokens || 0;
        const replyEstimatedCost =
            (replyInputTokens / 1000) * 0.005 + (replyOutputTokens / 1000) * 0.015;

        console.log(`🖼️ Image reply (${intent}):`, aiReply.substring(0, 100));

        // 5. Save AI reply to conversation
        await Conversation.findOneAndUpdate(
            { pageId, senderId },
            {
                $push: {
                    messages: {
                        $each: [{ role: "assistant", content: aiReply }],
                        $slice: -50,
                    },
                },
                $inc: { messageCount: 1 },
                $set: { lastAiReplyAt: Date.now() }
            }
        );


        // 7. Human-like reply flow
        try { await markSeen(page.pageAccessToken, senderId); } catch (_) { }
        await new Promise((resolve) => setTimeout(resolve, 2500));
        try { await showTyping(page.pageAccessToken, senderId); } catch (_) { }
        const typingDelay = Math.min(5000, Math.max(1800, aiReply.length * 35 + Math.floor(Math.random() * 600)));
        await new Promise((resolve) => setTimeout(resolve, typingDelay));

        await sendMessage(page.pageAccessToken, senderId, aiReply, messageId);

        // 8. Log the message
        try {
            await MessageLog.create({
                userId: page.userId,
                pageId: page.pageId,
                senderId,
                messageText: `[Image: ${intent}]`,
                aiReply,
                inputTokens: inputTokens + replyInputTokens,
                outputTokens: outputTokens + replyOutputTokens,
                totalTokens: totalTokens + replyTotalTokens,
                estimatedCost: estimatedCost + replyEstimatedCost,
            });
        } catch (logErr) {
            console.log("Image message log error:", logErr.message);
        }

        // 9. Update usage counters
        try {
            await page.save();
        } catch (usageErr) {
            console.log("Usage update error:", usageErr.message);
        }

        // 10. Unified Context Update (Rolling summary) - Occurs once after reply
        try {
            const exchange = `User: [Sent an image classified as ${intent}] ${imageDescription.substring(0, 100)}\nAI: ${aiReply}`;
            const updatedStory = await updateContextStory(contextStory, "assistant", exchange);
            await Conversation.findOneAndUpdate(
                { pageId, senderId },
                { $set: { contextStory: updatedStory } }
            );
            console.log("📖 Image rolling summary updated");
        } catch (storyErr) {
            console.log("Image rolling summary update error:", storyErr.message);
        }
    } catch (err) {
        console.log("Image analysis error:", err.response?.data || err.message);
        try {
            try { await markSeen(page.pageAccessToken, senderId); } catch (_) { }
            await new Promise((resolve) => setTimeout(resolve, 2500));
            try { await showTyping(page.pageAccessToken, senderId); } catch (_) { }
            await new Promise((resolve) => setTimeout(resolve, 1800));
            await sendMessage(page.pageAccessToken, senderId, "I couldn't analyze the image. Please try again.", messageId);
        } catch (fallbackErr) {
            console.log("Image fallback error:", fallbackErr.response?.data || fallbackErr.message);
        }
    }
};

export { verifyWebhook, handleIncomingMessage };
