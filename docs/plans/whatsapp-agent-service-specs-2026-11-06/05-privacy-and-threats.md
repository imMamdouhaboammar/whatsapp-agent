# Privacy, misuse and trust boundaries

## Exposure review

The current Hono API uses permissive CORS for local development. Verify actual bind interface, authentication, CSRF defenses and reachable hosts before enabling additional workers, remote control or browser exposure. Local development assumptions are not a substitute for authentication

## Threats and controls

| Threat | Likely boundary | Minimum control |
| --- | --- | --- |
| Prompt injection in chat/PDF/image | Inbound/media -> agent | Context-as-data contract, deterministic action gate, no tool authority from retrieved text |
| Repeated approval or network timeout | UI/MCP -> send adapter | Atomic approval and intent, ambiguous state, manual reconciliation |
| Wrong recipient alias | Identity -> send adapter | Verified canonical contact, target recheck at dispatch |
| Sensitive transcript leaked to worker | Bun -> Python | Per-chat opt-in, minimized payload, short retention, scoped local IPC |
| Worker executes hostile media | Media parser process | Input caps, parser sandbox, non-privileged user, no external network by default |
| Unintended broadcast or spam | Agent/MCP -> WhatsApp | No bulk send action, per-chat limits, human confirmation, adhere to platform rules |
| Local browser cross-origin access | Browser -> Hono API | Specific origins, auth/session or local-bound trust enforcement, CSRF protection on mutations |
| Secret or phone number in diagnostics | Logging/telemetry | Structured redaction, opaque IDs, no raw content spans |
| Old memory after deletion | SQLite -> FTS/worker | Delete propagation, expiration, verification scan |

## Consent model

Separate user account authorization from contact consent and from media processing opt-in. A contact messaging the user does not automatically grant permission for sharing their images/documents with new external services or for automated follow-ups

Default: media worker local processing, no direct cloud upload; if a chosen OCR/model requires cloud processing, require a distinct setting and show the provider and retention implications before enabling

## Retention

Store only necessary metadata for delivery reconciliation; sensitive payloads referenced by opaque IDs. Maintain a user-controlled retention policy for chat content, media-derived text, evaluation fixtures and diagnostics. Deleting a chat requires deletion tests for FTS rows, derived facts and cached media

## Platform constraint

Baileys is an unofficial WhatsApp Web implementation. Its maintainers disclaim any affiliation with WhatsApp and discourage spam, stalkerware and bulk automated messaging. Do not present the transport as an official WhatsApp Business API integration or claim policy compliance without separate review

Source: https://github.com/WhiskeySockets/Baileys

## Review requirements

Threat review before remote exposure or multiple user accounts; privacy review before media cloud processing or real-chat evaluation datasets; explicit user approval before automated action scope expands
