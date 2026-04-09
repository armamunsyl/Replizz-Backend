// REMOVED: Prompt API — replaced by final AI configuration architecture.
//
// Prompt was a legacy per-page AI config store that competed with:
//   - Page.customInstructions (inline quick override)
//   - PageInstruction collection (structured instruction list)
//
// Final AI configuration sources (authoritative):
//   - Page fields: language, tone, replyStyle, customInstructions
//   - PageInstruction collection: ordered, toggle-able instruction rules
//   - Product collection: product knowledge base
//
// Migration:
//   - Use PATCH /api/pages/:pageId/settings for page-level AI settings
//   - Use POST /api/instructions/:pageId for structured instruction rules

const REMOVED_MSG =
    "This endpoint has been removed. Use PATCH /api/pages/:pageId/settings for AI settings " +
    "and /api/instructions/:pageId for instruction rules.";

const getPrompt = (_req, res) => {
    res.status(410).json({ success: false, message: REMOVED_MSG });
};

const upsertPrompt = (_req, res) => {
    res.status(410).json({ success: false, message: REMOVED_MSG });
};

export { getPrompt, upsertPrompt };
