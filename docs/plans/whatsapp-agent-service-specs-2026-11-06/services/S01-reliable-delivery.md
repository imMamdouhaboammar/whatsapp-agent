# S01: Reliable Delivery and Receipt Ledger

Priority P0 | Proposed implementation: Bun + SQLite; optional Go coordinator

## User problem

An Auto-Pilot response, a human message and an approved draft all use the WhatsApp adapter. A repeated click, reconnect or ambiguous crash must not silently create repeated messages or a false "sent" state

## Existing parts to reuse

- src/domain/rate-limiter.ts for presentation-friendly pacing
- src/domain/db.ts and src/domain/memory-store.ts for durable state
- src/transport/whatsapp-socket.ts as the sole send/receipt adapter
- Current message_status SSE and monotonic receipt persistence

## Scope

1. One SendIntent service in Bun used by Auto-Pilot, human UI, MCP and draft approval
2. Persistent send_intents and send_attempts with an append-only audit of state transitions
3. Idempotency key from source action, identity and policy revision
4. Explicit separation of local send intent, Baileys acceptance and WhatsApp delivery/read
5. Configurable bounded retry for known pre-send failures, plus backoff with jitter
6. A clear "needs reconciliation" UI state for uncertain sends
7. Optional Go process that schedules/leases jobs, while Bun executes WhatsApp send calls

## Proposed data model

send_intents: id, source_kind, source_id, source_revision, chat_id, action_kind, payload_hash, payload_ref, policy_revision, state, created_at, updated_at, expires_at, native_message_id nullable

send_attempts: attempt_id, intent_id, lease_owner, attempt_started_at, network_call_started_at nullable, finished_at nullable, outcome, failure_code nullable, trace_id

Unique key: (source_kind, source_id, source_revision, action_kind). A conflicting payload_hash for the same action identity returns a conflict and requires an explicit new revision. For a split response, include deterministic part index/total in source_id. This deduplicates local intent insertion; do not claim it can prevent WhatsApp from processing two distinct network attempts

Atomic draft approval: UPDATE draft WHERE id = draft_id AND status = pending; exactly one caller wins. Persist approved draft and matching intent in the same Bun SQLite transaction

## Send protocol

1. Validate canonical chat ID, actor scope, policy, content and current mode
2. Create or retrieve existing intent transactionally
3. Lease queued intent for one dispatcher only
4. Persist ATTEMPTING before calling Baileys
5. On native send result: commit ACCEPTED and native_message_id; publish SSE
6. On receipt: resolve exact message ID; monotonically advance delivered/read
7. On known pre-network failure: queue a bounded retry
8. On crash or timeout after ATTEMPTING: mark UNCERTAIN, preserve content and require evidence or human action before resending

## Out-of-scope claims

- Exactly-once delivery to WhatsApp or recipient
- Remote delivery acknowledgement from a successful local send call
- Automatically replaying uncertain sends after a disconnect
- Reliable group-read aggregate inferred from one participant

## UI behavior

- Message state: queued, sending, sent to WhatsApp, delivered, read, needs review
- In the "needs review" action, show native message ID when known, last attempt time, and a user-confirmed retry option
- Retry is a new explicit user action with an audit link back to original intent
- In RTL and LTR, status icon position follows locale and meaning never relies only on color

## Acceptance tests

- Repeated same UI mutation ID creates one intent
- Two parallel approval requests: one success, one already-processed response; only one send intent
- Sending when SQLite intent insertion fails calls Baileys zero times
- Crash after writing ATTEMPTING but before network result marks UNCERTAIN and does not auto-resend
- Known offline failure before the network call retries within configured cap, with bounded jitter
- Out-of-order receipts never regress a read status to delivered/sent
- Partial multi-bubble success does not repeat parts confirmed accepted
- MCP and UI send paths share the same action gate and event stream
- A live linked WhatsApp account must verify receipt semantics separately from mocks

## Extraction trigger for Go

Only if traces demonstrate repeated scheduling contention, worker isolation need or queue backlog after the durable Bun design. A Go coordinator would claim/lease through Bun-owned RPC and use context timeouts. Its crash must never grant a second active sender. Do not introduce a second database of message truth

## Rollback

Disable new intake to S01; drain or manually review queued/uncertain intents before switching send flow back. Keep audit rows and receipt correlation intact. No destructive schema down-migration
