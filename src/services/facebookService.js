import axios from "axios";

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

/**
 * Build the Facebook OAuth redirect URL.
 */
const getOAuthURL = () => {
    const params = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID,
        redirect_uri: `${process.env.FRONTEND_URL}/facebook/callback`,
        scope: "pages_show_list,pages_manage_metadata,pages_messaging",
        response_type: "code",
    });
    return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
};

/**
 * Exchange an authorization code for a user access token.
 */
const exchangeCodeForToken = async (code) => {
    const { data } = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
        params: {
            client_id: process.env.FACEBOOK_APP_ID,
            client_secret: process.env.FACEBOOK_APP_SECRET,
            redirect_uri: `${process.env.FRONTEND_URL}/facebook/callback`,
            code,
        },
    });
    return data.access_token;
};

/**
 * Fetch the list of pages the user manages.
 */
const getUserPages = async (userAccessToken) => {
    const { data } = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
        params: {
            fields: "id,name,access_token,picture{url}",
            access_token: userAccessToken,
        },
    });
    // Normalize picture URL into a flat field
    return data.data.map((page) => ({
        ...page,
        pictureUrl: page.picture?.data?.url || "",
    }));
};

/**
 * Send a sender_action to mark the user's message as seen.
 */
const markSeen = async (pageAccessToken, recipientId) => {
    const { data } = await axios.post(
        `${GRAPH_API_BASE}/me/messages`,
        {
            recipient: { id: recipientId },
            sender_action: "mark_seen",
        },
        {
            params: { access_token: pageAccessToken },
        }
    );
    return data;
};

/**
 * Send a sender_action to show typing indicator.
 */
const showTyping = async (pageAccessToken, recipientId) => {
    const { data } = await axios.post(
        `${GRAPH_API_BASE}/me/messages`,
        {
            recipient: { id: recipientId },
            sender_action: "typing_on",
        },
        {
            params: { access_token: pageAccessToken },
        }
    );
    return data;
};

/**
 * Send a message to a user via the Facebook Graph API.
 * @param {string} pageAccessToken
 * @param {string} recipientId
 * @param {string} messageText
 * @param {string} [replyToMessageId] - Optional message ID to reply to (threaded reply)
 */
const sendMessage = async (pageAccessToken, recipientId, messageText, replyToMessageId = null) => {
    const body = {
        recipient: { id: recipientId },
        message: { text: messageText },
    };
    if (replyToMessageId) {
        body.reply_to = { mid: replyToMessageId };
    }

    const { data } = await axios.post(
        `${GRAPH_API_BASE}/me/messages`,
        body,
        {
            params: { access_token: pageAccessToken },
        }
    );
    return data;
};

/**
 * React to a specific message via the Facebook Send API.
 * @param {string} pageAccessToken
 * @param {string} recipientId - The PSID of the message sender
 * @param {string} messageId - The mid of the message to react to
 * @param {string} [reaction="\u2764\uFE0F"] - The reaction emoji
 */
const addReaction = async (pageAccessToken, recipientId, messageId, reaction = "\u2764\uFE0F") => {
    const { data } = await axios.post(
        `${GRAPH_API_BASE}/me/messages`,
        {
            recipient: { id: recipientId },
            sender_action: "react",
            payload: {
                message_id: messageId,
                reaction,
            },
        },
        {
            params: { access_token: pageAccessToken },
        }
    );
    return data;
};

export { getOAuthURL, exchangeCodeForToken, getUserPages, sendMessage, markSeen, showTyping, addReaction };
