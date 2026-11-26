# Failure Lesson: SQLite Foreign Key Constraints vs. Integration Test Orphan Pruning

## Context
Tuning database query latency and connection PRAGMAs in `src/domain/db.ts` (`SqliteStore`) for high-concurrency 24/7 uptime on low-spec hardware (1–2 GB RAM VPS).

## What happened
1. During Phase 2 database tuning, standard relational database hardening PRAGMAs were evaluated: `PRAGMA journal_mode = WAL;`, `PRAGMA synchronous = NORMAL;`, `PRAGMA busy_timeout = 5000;`, `PRAGMA temp_store = MEMORY;`, `PRAGMA cache_size = -16000;`, and `PRAGMA foreign_keys = ON;`.
2. Applying `PRAGMA foreign_keys = ON;` in `SqliteStore.init()` immediately broke the existing integration test suite in `tests/context-fold-integration.test.ts`.
3. In `context-fold-integration.test.ts:65`, the test explicitly validated the orphaned fold reconciliation engine by manually executing `DELETE FROM messages WHERE id = ?` to simulate orphaned records resulting from unexpected crashes or message deletion on the phone.
4. Because the `conversation_folds` table held foreign key references pointing to `messages(id)`, SQLite immediately aborted the deletion with a constraint violation.

## Observable symptom
```text
SQLiteError: FOREIGN KEY constraint failed
    at tests/context-fold-integration.test.ts:65:8
    at /Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/src/domain/db.ts:241:12
```

## Impact
- Prevented the test suite from executing and simulating intentional edge cases (orphaned conversation folds, partially reconciled message chains, and client-side message revocations).
- Conflated relational engine cascading rules with domain-level recovery algorithms designed to self-heal when external records disappear.

## Incorrect assumption
Assuming that enabling `PRAGMA foreign_keys = ON;` globally in SQLite is an unconditionally safe hardening invariant across all stores, without verifying whether integration test fixtures intentionally simulate dirty or corrupted database states to test application resilience.

## Root cause
**Confirmed**. In `tests/context-fold-integration.test.ts`, the test specifically tests that `FoldRepository` correctly identifies, isolates, and prunes orphaned summary folds when underlying messages have been purged. Enforcing database-level relational restrict constraints physically prevented the test harness from constructing the exact failure scenario the domain engine was built to handle.

## Why the architecture allowed it
SQLite disables foreign key enforcement by default (`foreign_keys = OFF`). The schema included `FOREIGN KEY` clauses for documentation and relational modeling, but the application relied on domain repositories (`FoldRepository`, `SendLedger`) to manage relational integrity and lifecycle cascades in code.

## Fix
1. Removed `PRAGMA foreign_keys = ON;` from `SqliteStore.init()`, retaining `foreign_keys = OFF` (the SQLite default) so that integration tests and recovery jobs can safely manipulate and clean up orphaned records.
2. Kept all verified performance PRAGMAs:
   ```ts
   this.db.run('PRAGMA journal_mode = WAL;');
   this.db.run('PRAGMA synchronous = NORMAL;');
   this.db.run('PRAGMA busy_timeout = 5000;');
   this.db.run('PRAGMA temp_store = MEMORY;');
   this.db.run('PRAGMA cache_size = -16000;'); // 16 MB in-memory buffer pool
   ```
3. Added missing compound indexes to dramatically speed up queries without altering deletion semantics:
   - `idx_chats_last_timestamp ON chats(last_timestamp DESC);`
   - `idx_chats_last_timestamp_coalesce ON chats(COALESCE(last_timestamp, 0) DESC);`
   - `idx_drafts_pending ON drafts(status, created_at DESC);`
   - `idx_drafts_chat_status ON drafts(chat_id, status, created_at DESC);`
   - `idx_send_intents_lease ON send_intents(state, lease_expires_at);`

## Verification
```bash
# 1. Run the specific context fold integration test
bun test tests/context-fold-integration.test.ts

# 2. Run full monorepo test suite (559 passed, 0 failed)
bun test

# 3. Run performance benchmark to verify p95 query latency is under 1ms
bun run scripts/perf-benchmark.ts
```

## Prevention rule
- **Rule**: "In embedded SQLite stores where domain repositories or integration test fixtures simulate and recover from corrupted, orphaned, or partially purged records, never enable global `PRAGMA foreign_keys = ON;` unless all lifecycle cascades and orphan-reconciliation test fixtures are explicitly adapted. Maintain relational invariants at the repository boundary while tuning performance with memory PRAGMAs and compound indexes."
- **Enforcement Level**: Mandated in `AGENTS.md` and enforced via `tests/context-fold-integration.test.ts`.

## Reusable lesson
Database-level foreign key constraints can inadvertently sabotage resilience testing. If your domain layer has self-healing logic for missing foreign references (e.g., pruning orphaned summaries or reconciling missing message IDs), hard database-level foreign key enforcement will prevent your test fixtures from creating the dirty states needed to verify that self-healing logic.

## Related code
- `src/domain/db.ts`
- `src/domain/fold-repository.ts`
- `src/domain/send-ledger.ts`

## Related tests
- `tests/context-fold-integration.test.ts`
- `tests/db.test.ts`
- `scripts/perf-benchmark.ts`

## Status
Resolved
