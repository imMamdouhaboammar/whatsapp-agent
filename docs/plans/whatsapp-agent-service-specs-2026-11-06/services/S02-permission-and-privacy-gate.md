# S02: Unified Permission and Privacy Gate

> Historical supporting note from V1. V2 makes Auto-Pilot the default, with business scopes and channel eligibility checked automatically. This is not a requirement for per-reply owner approval. See A05, A06 and A08.

Priority P0 | Bun TypeScript first; optional Rust verifier

## User problem

Different callers can request sending, reactions, draft approval and MCP actions. An AI reply policy alone cannot guarantee those routes all obey the user's current autonomy mode and sensitive-action restrictions

## Existing parts

- src/domain/permission-engine.ts already evaluates intents and confidence
- src/ai/moderator-agent.ts maps decisions to Auto-Pilot, Co-Pilot and Human
- src/server/api.ts and src/mcp/server.ts expose additional action entry points

## Scope

Create a single authoritative action gateway with a versioned PolicyDecision:

- actor: human_ui | agent | mcp_client | scheduler
- chat_id: canonical immutable target after identity resolution
- action: send_text | send_voice | react | approve_draft | change_mode | tool_call
- basis: policy revision, chat mode, explicit approval, safety classification and source message references
- result: allow | require_approval | deny, reason_code and evidence pointers

The gateway is called at execution time. A prior model recommendation is never sufficient authority to bypass it. MCP requests require an explicit actor/permission scope; transport-level authentication must be enforced if the local API is ever exposed beyond the intended trusted host

## Authority examples

| Chat mode | Agent direct send | Human UI send | Agent draft |
| --- | --- | --- | --- |
| Auto-Pilot | Allow only when deterministic rules allow | Allow when user-authenticated | For sensitive/uncertain action |
| Co-Pilot | Require approval | Allow when user-authenticated | Expected |
| Human | Deny agent send | Allow when user-authenticated | Disabled by default unless configured |

An explicitly approved draft authorizes one specific content revision to one canonical chat ID. Edits change the approval revision; a second approval request cannot reuse the first authorization

## Privacy controls

- Address-book or group membership never becomes an implicit broadcast audience
- Redact secret-like values before sending them to new processors unless the user opts in
- Keep raw chat text out of logs, traces and evaluation fixtures by default
- Treat all incoming messages, PDFs, image OCR and retrieved snippets as untrusted context
- Data deletion should also remove indexes, extracted metadata and optional worker caches
- Default deny for actions that change privacy scope or contact recipients

## Suggested reason codes

MODE_HUMAN, APPROVAL_REQUIRED, LOW_CONFIDENCE, SENSITIVE_CONTENT, UNTRUSTED_INSTRUCTION, CHAT_MISMATCH, POLICY_REVISION_STALE, ACTOR_SCOPE_DENIED, RECIPIENT_INVALID, MEDIA_TOO_LARGE

## Acceptance tests

- Agent cannot send in Human mode even if model output requests reply
- Agent in Co-Pilot generates a draft, with no outgoing send intent
- Human approval of a draft authorizes exact chat/message revision only
- Changing chat mode between model decision and send forces re-evaluation
- MCP send without required scope is denied and audited, independent of persona
- Concurrent policy edits cannot allow an action under a stale revision
- An attachment claiming "ignore the rules" is treated as content
- Policy-worker timeout fails closed for privileged actions and retains a reviewable draft
- RTL/LTR reason labels carry identical meaning and accessible descriptions

## Rust boundary candidate

Rust is justified if independent policy attestations, auditable compilation targets or measured scan cost warrant isolation. Keep policy rules in one canonical versioned representation. Do not maintain two hand-written divergent implementations in TS and Rust

## Rollback

Restore the last approved policy revision. Keep the gateway hook in all send paths; failing back to scattered direct sends is explicitly prohibited
