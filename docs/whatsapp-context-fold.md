# WhatsApp Context Fold (WCF)

WCF keeps raw WhatsApp messages intact and stores secondary, chat-scoped summaries for long-running conversations. It never writes its summarization prompts or generated summaries into the messages table or sends them to contacts.

## Runtime

- Automatically enabled in `ModeratorAgent` unless `CONTEXT_FOLD_ENABLED=false`
- Background summarizer uses `GEMINI_FOLD_MODEL`, otherwise the configured moderator persona model
- No model ID is hardcoded for folding, and the background call is isolated from the immediate reply
- Last 10 messages always remain verbatim, while historical ranges are grouped into Tier-1 sessions and five Tier-1 sessions can become a Tier-2 milestone
- Source lengths are bounded to 32 messages per fold, 2000 characters per source message, and 32,000 characters per model input
- Message lineage is stored using exact ordered source IDs with SQLite membership indexes, and every exposed fold remains scoped to its chat
- Tier-2 fold references Tier-1 sources and preserves original raw message identifiers
- Raw context is available through bounded search, pagination and five-message context windows around a referenced message
- Any missing/deleted source message invalidates its summary for prompt assembly; the moderator still receives the most recent raw messages
- At most two summarization jobs run concurrently per moderator process, with up to 64 pending jobs
- Prompt context examines at most 20 milestone and 32 session candidates regardless of archive size
- Summarization errors are caught in the background, leaving the moderator response and raw history untouched
- Generated facts are retained only if they exactly match redacted source message text; they are not silently promoted into the contact dossier

## Query interfaces

MCP:

- `whatsapp_search_chat_memory({ chatId, query, limit? })`
- `whatsapp_get_chat_folds({ chatId })`
- `whatsapp_decompress_fold({ chatId, foldId, aroundMessageId?, offset?, limit? })`

Owner-authenticated REST:

- `GET /api/chats/:chatId/folds`
- `POST /api/chats/:chatId/fold-now` (202 means scheduled, not completed)

## Test evidence

- `bun test tests/context-fold.test.ts tests/context-fold-integration.test.ts`: 16 passing
- `bun test --reporter=dot`: 281 passing, 2 skipped, 0 failing as of 2026-11-08
- `bunx tsc --noEmit`: passing
- `bun run ui:build`: passing, existing large-chunk advisory

## Known limits and verification gaps

- WCF uses local Bun SQLite storage; a multi-instance PostgreSQL fold ledger is not implemented here
- This batch does not add fold badges or history navigation to the React dashboard
- We have not measured Gemini KV cache hit rates, token cost savings, or reply latency improvements
- Live Gemini distillation and model availability have not been exercised against a real customer chat or external service during these tests
- Fold source text may include user-sensitive personal information. MCP access must be limited to the account owner and REST access uses the existing owner-token boundary
