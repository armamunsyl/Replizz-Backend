import OpenAI from "openai";
import axios from "axios";

let openai;

function getClient() {
    if (!openai) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return openai;
}

/**
 * Generate an AI reply using OpenAI Chat Completions.
 * @param {string} userMessage - The incoming user message (for logging)
 * @param {string} systemPrompt - The system instruction (fallback)
 * @param {Array} messages - Full conversation messages array to send to OpenAI
 * @returns {Promise<{reply: string, usage: object}>} The AI response and usage stats
 */
const generateAIReply = async (userMessage, systemPrompt, messages) => {
    const chatMessages = messages && messages.length > 0
        ? messages
        : [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
        ];

    const completion = await getClient().chat.completions.create({
        model: "gpt-4o-mini",
        messages: chatMessages,
        temperature: 0.7,
    });

    return {
        reply: completion.choices[0].message.content,
        usage: completion.usage,
    };
};

/**
 * Analyze an image using OpenAI's vision capability.
 * Downloads the image first (Facebook CDN URLs are not publicly accessible)
 * and sends it as a base64 data URL.
 * @param {string} imageUrl - The URL of the image to analyze
 * @returns {Promise<{reply: string, usage: object}>} The AI description and usage stats
 */
const analyzeImage = async (imageUrl) => {
    // Download image and convert to base64 (Facebook CDN blocks external access)
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const base64Image = Buffer.from(imageResponse.data).toString("base64");
    const mimeType = imageResponse.headers["content-type"] || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const completion = await getClient().chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "system",
                content: "You are an image analysis assistant. Provide detailed internal analysis in plain text only.",
            },
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Analyze this image in detailed internal memory format. Describe environment, objects, product details, materials, colors, visible text, condition, and layout. This is for system memory only. Return plain text paragraph. Do not summarize.",
                    },
                    {
                        type: "image_url",
                        image_url: { url: dataUrl },
                    },
                ],
            },
        ],
        max_tokens: 500,
    });

    return {
        reply: completion.choices[0].message.content,
        usage: completion.usage,
    };
};

/**
 * Update the evolving context story with a new message.
 * The story is never deleted — only refined and extended.
 * @param {string} existingStory - The current context story
 * @param {string} role - The role of the new message ("user", "admin", or "assistant")
 * @param {string} content - The content of the new message
 * @returns {Promise<string>} The updated context story
 */
const updateContextStory = async (existingStory = "", role, content) => {
    const roleLabel = role === "user" ? "Customer" : role === "admin" ? "Moderator" : "AI Assistant";

    const prompt = `Keep the summary under 60 words.
Current summary: ${existingStory || "(none)"}
New message from ${roleLabel}: ${content}

Instruction: Update the summary to include key facts only. Return only the updated summary text.`;

    const completion = await getClient().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "You are a specialized conversation summarizer. Provide a concise rolling summary (max 60 words) of key facts. No labels or preamble." },
            { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 100,
    });

    return completion.choices[0].message.content.trim();
};

/**
 * Classify the intent of an image using conversation context.
 * @param {string} contextStory - The evolving context story
 * @param {string} imageDescription - Plain text description of the image
 * @returns {Promise<string>} One of: PAYMENT_PROOF, PRODUCT_IMAGE, DOCUMENT, OTHER
 */
const classifyImageIntent = async (contextStory = "", imageDescription) => {
    const prompt = `Conversation story:
${contextStory || "(no prior context)"}

Image description:
${imageDescription}

Instruction:
Classify the intent of this image based on the conversation context and image content.
Return EXACTLY one of these labels (nothing else):
- PAYMENT_PROOF
- PRODUCT_IMAGE
- DOCUMENT
- OTHER`;

    const completion = await getClient().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "You are an image intent classifier. Return only the classification label. No explanation, no punctuation, no extra text." },
            { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 20,
    });

    const raw = completion.choices[0].message.content.trim().toUpperCase();
    const valid = ["PAYMENT_PROOF", "PRODUCT_IMAGE", "DOCUMENT", "OTHER"];
    return valid.includes(raw) ? raw : "OTHER";
};

/**
 * Generate a context-aware reply for an image based on its classified intent.
 * @param {string} contextStory - The evolving context story
 * @param {string} imageDescription - Plain text description of the image
 * @param {string} intent - The classified intent (PAYMENT_PROOF, PRODUCT_IMAGE, DOCUMENT, OTHER)
 * @param {object} page - The Page document (for language/tone settings)
 * @returns {Promise<{reply: string, usage: object}>} The AI response and usage stats
 */
const generateImageReply = async (contextStory = "", imageDescription, intent, page = {}) => {
    let instruction;

    switch (intent) {
        case "PAYMENT_PROOF":
            instruction = `User has sent payment proof.
Acknowledge the payment.
Say you are verifying it.
Do NOT ask generic questions about the image.
Be polite and reassuring.`;
            break;
        case "PRODUCT_IMAGE":
            instruction = `User has sent a product image.
Respond helpfully about the product shown.
Use the image details and conversation context to give a relevant reply.
If pricing or availability was discussed, reference that.`;
            break;
        case "DOCUMENT":
            instruction = `User has sent a document.
Acknowledge receipt of the document.
Let them know you are reviewing it.
Be professional.`;
            break;
        default:
            instruction = `User has sent an image but the intent is unclear.
Ask politely what they would like to know about the image.
Keep it short and natural.`;
            break;
    }

    const prompt = `Conversation story:
${contextStory || "(no prior context)"}

Image description:
${imageDescription}

Instruction:
${instruction}`;

    const completion = await getClient().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: `You are managing a Facebook business page.
Language: ${page.language || "English"}
Tone: ${page.tone || "Professional"}
Reply style: ${page.replyStyle || "Short and helpful"}

Respond to the user based on the image they sent and the conversation context. Be concise and natural.`,
            },
            { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 300,
    });

    return {
        reply: completion.choices[0].message.content,
        usage: completion.usage,
    };
};

export { generateAIReply, analyzeImage, updateContextStory, classifyImageIntent, generateImageReply };
