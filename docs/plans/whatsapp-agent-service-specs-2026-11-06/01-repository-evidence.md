# Repository baseline and integration evidence

Scope: imMamdouhaboammar/whatsapp-agent, initial inspection at d78986407895a3fe35f5f44423a26e0d48d972b0. V2 additionally reviewed main e6be0b2e787d7219265dd4c21188b0638dea00d5 and its docs/plans/2026-11-06-whatsapp-context-fold.md. This file preserves initial observations

Evidence tags: **Observed** = inspected source or PR; **Inferred** = potential failure mode requiring test; **Proposed** = desired future behavior

## Observed capabilities

| Area | Current owner | Evidence |
| --- | --- | --- |
| WhatsApp Web connection, identities, messages and receipts | WhatsAppSocketClient and Baileys | src/transport/whatsapp-socket.ts |
| App bootstrap and inbound processing | Orchestration, 2-second burst accumulation, send loop | src/index.ts |
| Gemini replies and per-chat autonomy | ModeratorAgent | src/ai/moderator-agent.ts |
| Existing deterministic intent rules | evaluatePermission | src/domain/permission-engine.ts |
| Delayed per-chat sends and throttling | HumanRateLimiter in memory | src/domain/rate-limiter.ts |
| Data storage and message statuses | Bun SQLite and WAL | src/domain/db.ts, src/domain/memory-store.ts |
| Contact dossiers and commitments | Existing extraction and dossier storage | src/ai/moderator-agent.ts |
| Audio transcription and TTS | Existing audio-transcriber and voice-synthesizer | src/ai/ |
| Browser API, drafts and SSE | Hono endpoints and server events | src/server/api.ts, src/server/sse.ts |
| MCP read/write access | Seven documented tools, including send and draft approval | README.md, src/mcp/server.ts |
| RTL/LTR UI, inspector, settings and receipts | Merged PR #2 | https://github.com/imMamdouhaboammar/whatsapp-agent/pull/2 |

## High-value integration seams

### A. Multiple send entry points [Observed]

- Auto-Pilot sends directly from src/index.ts through WhatsAppSocketClient, then records the result in SQLite
- Human UI message endpoint sends via src/server/api.ts, then records it
- Draft approval endpoint sends via src/server/api.ts, then updates draft status
- MCP sending and MCP draft approval call the WhatsApp adapter from src/mcp/server.ts

**Inferred risk:** A process crash, network timeout or repeated approval request can leave local state uncertain after WhatsApp may already have accepted a message. The code inspection does not prove this has happened in real traffic. The reliable outbox design must distinguish known failure from uncertain delivery; claiming exactly-once delivery would be unjustified

### B. Existing message receipts [Observed]

The merged PR #2 already added status mapping through Baileys updates, monotonic persistence and a message_status SSE event. Keep this as the source of truth for any visible delivered/read indicator. S01 extends correlation to send intents; it does not replace the receipt implementation

### C. Privacy and API exposure [Observed]

The Hono API currently uses app.use('*', cors()) in src/server/api.ts and exposes messaging/draft operations. Before changing localhost-only deployment assumptions, verify listener binding, authentication and cross-site protections. This is a review item, not an assertion that a remote exploit exists

### D. Memory [Observed]

The app already persists chat history and dossiers. Adding a separate generic memory database would duplicate facts. The newer WCF proposal adds folding with lineage, while V2 A07 integrates that plan and A02 handles distinct brand knowledge retrieval

### E. Media [Observed]

Incoming voice notes are transcribed and outgoing speech synthesized. S04 focuses on structured extraction from images, documents and selected video/audio cases. Do not reimplement existing TTS/transcription without a measured gap

### F. Follow-ups [Observed]

Commitments can already be extracted into dossiers. The historical S06 draft-only approach is superseded by V2 A08's eligible autonomous follow-ups

## Relevant existing tests

tests/db.test.ts, tests/permission-engine.test.ts, tests/rate-limiter.test.ts, tests/moderator-agent.test.ts, tests/engine-integration.test.ts, tests/mcp-server.test.ts, tests/message-status.test.ts, tests/sse.test.ts

All added suites must preserve their existing assertions. Future tests should cover send ambiguity, approval races, cross-chat data isolation, malformed media, prompt injection and a broken worker connection

## Not established

- Concurrent connected accounts, daily message volume, latency percentiles and memory/cpu profiles
- Whether the application runs exclusively on localhost or is reachable from a LAN/public host
- User consent and retention requirements for archived personal chats/media
- Whether Baileys exposes a reliable remote deduplication key across all send types
- Actual recovery behavior when WhatsApp acknowledges a send but the process exits before SQLite commit
