# FL-051: Reflection Memory Isolation & Serialized Turn/Send Fencing

## Context
Multi-contact WhatsApp AI copilot and autonomous reflection engine (`src/agent/conversation-coordinator.ts`, `src/agent/turn-coordinator.ts`, `src/ai/reflection-engine.ts`, `src/domain/learning-memory.ts`, `src/domain/send-ledger.ts`) handling concurrent inbound bursts and background reflection persistence (PR #100 / WA-003, WA-008).

## What happened
1. **Cross-Contact Reflection Leakage Risk (WA-003)**: Reflection memory updates were not strictly isolated by trusted contact identity, creating risk of per-contact observations or profile notes bleeding across contacts or untrusted senders.
2. **Unserialized Turn & Send Concurrency (WA-008)**: Inbound message bursts and outbound send intents could interleave across turns without durable per-conversation serialization or send fencing, risking out-of-order replies, duplicate sends, or lost inbound jobs across restarts.

## Observable symptom
- Concurrent inbound messages for the same chat could race during turn planning and reply dispatch.
- Reflection outputs lacked strict trusted-contact scoping and durable serialized persistence guarantees.

## Impact
- High-severity privacy and correctness risk: cross-contact memory contamination and duplicate/out-of-order WhatsApp replies under bursty traffic or process restarts.

## Incorrect assumption
1. Assuming in-memory async sequencing alone guarantees turn order and send exclusivity without durable ledger state.
2. Assuming reflection memory isolation is preserved without explicit trusted-contact scoping at the persistence and reflection-engine boundary.

## Root cause
- **Confirmed**:
  1. Missing per-conversation `ExecutionQueue` and durable `InboundJobLedger` (`src/agent/execution-queue.ts`, `src/domain/inbound-job-ledger.ts`) to serialize inbound bursts and survive restarts.
  2. `SendLedger` and `SendIntentService` lacked explicit fencing against concurrent batch/turn sends.
  3. `ReflectionEngine` and `LearningMemory` needed strict trusted-contact isolation boundaries before committing learned state.

## Why the architecture allowed it
The original turn pipeline processed inbound webhooks and reflection runs as independent async tasks without a durable job ledger or per-conversation execution lock.

## Fix
1. **Trusted-Contact Reflection Isolation**: Enforced contact-scoped isolation in `src/ai/reflection-engine.ts` and `src/domain/learning-memory.ts`.
2. **Serialized Execution & Durable Ledgers**: Added `src/agent/execution-queue.ts` and `src/domain/inbound-job-ledger.ts`, updated `src/agent/conversation-coordinator.ts`, `src/agent/turn-coordinator.ts`, `src/domain/burst-accumulator.ts`, `src/domain/send-intent-service.ts`, and `src/domain/send-ledger.ts` to fence concurrent sends and serialize conversation execution durably.

## Verification
Verified by dedicated regression suites:
- `bun test tests/reflection-isolation.test.ts`
- `bun test tests/conversation-execution-integrity.test.ts`
- `bun test tests/send-fencing-batch.test.ts`
- `bun test tests/inbound-jobs.test.ts`
- `bun test tests/burst-drain.test.ts`

## Prevention rule
All conversation turns, inbound burst drains, and outbound sends MUST serialize through per-conversation `ExecutionQueue` + durable `InboundJobLedger` / `SendLedger` fencing, and reflection persistence MUST scope strictly by trusted contact identity.

## Reusable lesson
Any stateful conversational agent handling asynchronous webhooks and background learning must separate per-tenant/per-contact memory namespaces and back in-memory queues with durable job/send ledgers.

## Related code
- `src/agent/execution-queue.ts`
- `src/domain/inbound-job-ledger.ts`
- `src/domain/send-ledger.ts`
- `src/domain/send-intent-service.ts`
- `src/ai/reflection-engine.ts`
- `src/domain/learning-memory.ts`

## Related tests
- `tests/reflection-isolation.test.ts`
- `tests/conversation-execution-integrity.test.ts`
- `tests/send-fencing-batch.test.ts`
- `tests/inbound-jobs.test.ts`
- `tests/burst-drain.test.ts`

## Status
Resolved
