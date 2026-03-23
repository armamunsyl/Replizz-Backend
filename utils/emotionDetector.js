/**
 * Keyword-based emotion detection for message text.
 * Returns "positive", "negative", or "neutral".
 */

const POSITIVE_KEYWORDS = [
    "thank", "thanks", "ধন্যবাদ", "great", "awesome", "love", "amazing",
    "excellent", "wonderful", "fantastic", "perfect", "happy", "glad",
    "appreciate", "helpful", "best", "ভালো", "সুন্দর", "অসাধারণ",
    "good", "nice", "cool", "wow", "superb", "brilliant",
];

const NEGATIVE_KEYWORDS = [
    "problem", "issue", "complain", "complaint", "bad", "worst",
    "terrible", "horrible", "angry", "upset", "disappointed",
    "frustrated", "broken", "fix", "bug", "error", "fail",
    "সমস্যা", "খারাপ", "বাজে",
];

/**
 * Detect emotion from message text using keyword matching.
 * @param {string} text - The message text to analyze
 * @returns {"positive" | "negative" | "neutral"} The detected emotion
 */
const detectEmotion = (text) => {
    if (!text || typeof text !== "string") return "neutral";

    const lower = text.toLowerCase().trim();

    // Skip short neutral messages and questions
    if (lower.length < 4) return "neutral";
    if (lower.endsWith("?") || lower.endsWith("?")) return "neutral";

    if (POSITIVE_KEYWORDS.some((kw) => lower.includes(kw))) return "positive";
    if (NEGATIVE_KEYWORDS.some((kw) => lower.includes(kw))) return "negative";

    return "neutral";
};

/**
 * Determine if a reaction should be sent and which emoji to use.
 * @param {string} emotion - The detected emotion
 * @returns {{ shouldReact: boolean, emoji: string | null }}
 */
const getReactionForEmotion = (emotion) => {
    switch (emotion) {
        case "positive":
            return { shouldReact: true, emoji: "\u2764\uFE0F" }; // ❤️
        case "negative":
            return { shouldReact: true, emoji: "\uD83E\uDD7A" }; // 🥺 (care)
        default:
            return { shouldReact: false, emoji: null };
    }
};

export { detectEmotion, getReactionForEmotion };
