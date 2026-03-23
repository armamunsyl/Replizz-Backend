/**
 * Build a dynamic system prompt from page settings.
 * @param {Object} page - The Page document from MongoDB
 * @returns {string} The system prompt string
 */
const buildDynamicPrompt = (page) => {
    return `You are an AI assistant replying to Facebook Messenger customers for a business.

Context:
Language: ${page.language || "English"}
Tone: ${page.tone || "Professional"}
Style: ${page.replyStyle || "Short and helpful"}

Rules:
- Be friendly, concise, and natural.
- Follow moderator instructions strictly; they override all else.
- Remember user info (like names) if shared previously.
- ${page.customInstructions || "Help customers with product and business questions."}`;
};

/**
 * Build a memory context string from the conversation profile.
 * This is prepended to the messages to give the AI awareness of known user info.
 * @param {Object} profile - The conversation profile object
 * @returns {string} Memory context string
 */
const buildMemoryContext = (profile) => {
    const parts = [];
    if (profile?.name) {
        parts.push(`Name = ${profile.name}`);
    }
    if (parts.length === 0) return null;
    return `Known user info: ${parts.join(", ")}`;
};

export { buildDynamicPrompt, buildMemoryContext };
