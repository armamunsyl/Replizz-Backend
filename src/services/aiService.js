import axios from "axios";

/**
 * Generate an AI reply using the OpenAI Chat Completion API.
 *
 * @param {string} userMessage - The incoming user message
 * @param {string} promptTemplate - The system prompt template
 * @param {string} tone - The desired tone (e.g. "professional", "friendly")
 * @returns {{ reply: string, tokensIn: number, tokensOut: number }}
 */
const generateReply = async (userMessage, promptTemplate, tone) => {
    const systemPrompt = `${promptTemplate}\n\nTone: ${tone}`;

    const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            max_tokens: 300,
            temperature: 0.7,
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
        }
    );

    const { choices, usage } = response.data;

    return {
        reply: choices[0].message.content.trim(),
        tokensIn: usage.prompt_tokens,
        tokensOut: usage.completion_tokens,
    };
};

export { generateReply };
