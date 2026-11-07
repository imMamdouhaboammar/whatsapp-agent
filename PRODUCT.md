# PRODUCT.md

## Product Summary
WhatsApp Agent (PrePilot AI) is an enterprise-grade autonomous and co-pilot conversational cockpit for WhatsApp business operations. Built on Baileys, production Supabase PostgreSQL persistence (with local SQLite developer caching), and Google Gemini API, it provides intelligent multi-turn customer engagement, scatter-gather parallel execution, long-term contact memory, and human-in-the-loop review capabilities with a real-time reactive interface.

## Target Users & Roles
- **Account Owner / Business Operator**: Manages system connectivity, credentials vault, master system prompts, fallback providers, and organizational settings.
- **Support & Sales Co-Pilot**: Reviews and edits incoming AI response drafts, triggers voice messages, inspects customer memory dossiers, and manages active conversation styles.
- **End Customer (WhatsApp Contact)**: Sends text, voice messages, images, and documents over WhatsApp and receives natural, context-grounded, timely responses.

## Jobs To Be Done
- When a customer sends a burst of inquiries or audio messages, the operator wants the system to fuse messages into a single turn and prepare a grounded response draft, so customers receive immediate, accurate assistance without operator fatigue.
- When an inquiry involves sensitive business facts or inventory data, the operator wants to verify verified sources before release, so hallucinations and unapproved promises are eliminated.
- When an operator needs to generate customer stickers or broadcast announcements, they want in-browser tools with strict size and compression limits, so delivery never fails on WhatsApp's network boundary.

## Main Use Cases
- **Autopilot Customer Inquiry Triage**: Automatic classification, context grounding via Brand Brain and Contact Dossier, and automated replies for high-confidence intents.
- **Co-Pilot Draft Approval**: Human-in-the-loop verification where low-confidence decisions or sensitive topics are held as drafts for single-click approval, inline editing, or voice synthesis.
- **Enterprise Contact Memory**: Automatic extraction and manual registration of customer preferences, commitments, and historical context with strict credential rejection.
- **Parallel Dispatch & Scatter-Gather**: Multi-model evaluation and circuit breaker management for multi-tenant integrations.

## Non-Goals
- The product explicitly will not use headless browsers (Chromium/Puppeteer) for WhatsApp Web to eliminate memory leaks and detection vectors; Baileys socket transport is canonical.
- The product will not support arbitrary social network bridges; it is purpose-built for WhatsApp multi-device protocols.
- The product will not persist passwords, API keys, OTPs, or customer credentials in contact memory; credential detection fails closed.

## Data Boundaries & State Behavior
- **Server Authoritative State**: Supabase PostgreSQL is the authoritative production persistence tier (supporting dual IPv4 session and transaction poolers, pgvector embeddings, and pgmq queues), while SQLite WAL provides isolated offline developer caching.
- **Client Cache & Optimistic State**: Local UI state manages drafts, search filtering, and drawer expansion, while Server-Sent Events (SSE) stream live turn events to clients.
- **Credential Storage**: Protected under private authentication with bcrypt hashing, strict rate-limiting, and constant-time string comparison.

## Core User Flows
1. **Device Linkage**: Operator scans QR code or enters 8-digit companion pairing code to establish Baileys socket session.
2. **Inbound Message Flow**: Message arrives -> BurstAccumulator groups turns -> ModeratorAgent extracts context -> generates draft or sends autopilot reply.
3. **Co-Pilot Action Flow**: Operator inspects proposed reply in Moderator Drawer -> reviews reasoning and confidence -> clicks Approve & Send, Edit, or Voice Reply.
4. **Memory Management**: Operator or agent registers customer preference -> security sanitizer verifies zero credentials -> memory stored with timestamp.

## Feature List
- Baileys Multi-Device WebSocket Engine
- Gemini Multi-Model Fallback Chain (argon / flash / pro)
- Dual-Language Arabic (Egyptian / MSA) and English Cockpit
- Contact Dossier & Explicit Memory Sanitizer
- Scatter-Gather Parallel Funnel Engine with Circuit Breaker
- In-Browser WebP Sticker Studio (<= 100 KB ceiling)
- Model Context Protocol (MCP) Server for External Agent Orchestration

## Functional Requirements
- The system must enforce a hard 100 KB ceiling (101,888 bytes) on all generated WebP stickers.
- The system must fail closed on 401/403 authentication errors without switching to fallback models.
- The system must reject any memory containing passwords, API keys, tokens, or security credentials.
- The system must format markdown specifically for WhatsApp syntax (*bold*, _italic_, ~strike~, monospace).
- The system must maintain WCAG 2.2 AA contrast compliance across all UI components.

## Acceptance Criteria (Examples)
- **Given** an unlinked system, **when** opening the pairing modal, **then** an 8-digit pairing code and QR code are displayed with live connection state.
- **Given** an incoming message with confidence score below threshold, **when** the agent evaluates the turn, **then** a draft is created and displayed in the review queue without sending.
- **Given** a customer memory input containing secret keys or passwords, **when** submitted, **then** the request is rejected with a security block message.
- **Given** a mobile viewport of 390x844px, **when** opening the modal or inspector, **then** content scrolls internally without viewport clipping.

## Constraints
- Runtime: Bun is mandatory for all package execution, scripts, and testing.
- Platform: Browserless Node/Bun backend running on macOS / Linux servers.
- Protocol: WhatsApp Baileys companion socket specification.
- API limits: Gemini quota fallback mechanisms with exponential backoff.

## Risk Notes
- WhatsApp companion session disconnects are mitigated by automatic reconnect loops and SSE state synchronization.
- Upstream model latency is mitigated by BurstAccumulator fusion and co-pilot draft fallback.

## AI-Agent Implementation Boundaries
- Inspect existing files before editing.
- Change one feature area at a time.
- Preserve existing behavior and docstrings unless explicitly instructed.
- Never add emojis as icons or sparkle/brain icons in UI code.
- Run full test suites (`bun test` and `bun test:ui`) before claiming completion.
