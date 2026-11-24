# Persistence ownership (WA-009)

One authoritative store per domain. Configuration can never silently switch ownership.

| Domain | Authoritative store | Optional mirror |
| --- | --- | --- |
| Chats, messages, drafts | SQLite via `MemoryStore` | none |
| Send ledger (`send_intents`, `send_attempts`, `send_intent_events`) | SQLite via `MemoryStore` | none — Postgres cutover rejected until S01 migration lands |
| Inbound job ledger, follow-ups, capabilities | SQLite | none |
| Learning memory (`workbook.md`, `notebook.md`) | Local SQLite-mirrored files (`DualMemoryManager`) | Postgres `learning_state`, explicitly enabled |

## Rules

1. `DATASTORE=postgres` (full runtime cutover) throws at startup; the only supported
   runtime datastore is SQLite (`resolveRuntimeDatastore`).
2. The Postgres learning mirror activates only when `DATABASE_URL` is present AND
   `LEARNING_REMOTE_MIRROR` is not `0`/`false`/`off` (`resolveLearningMirror`).
   `DATABASE_TRANSACTION_URL` alone never activates it.
3. The mirror is never authoritative: local revisions are monotonic, remote writes are
   serialized, a stale remote never overwrites newer local state, and failures are
   observable via `DualMemoryManager.getPersistenceHealth()` and the agent's
   `learningMirror` status (`enabled`, `reason`, `degraded?`).
4. A mirror construction failure degrades loudly (warn + `learningMirror.degraded`);
   startup continues on the authoritative SQLite store.
5. Cutover path: when the S01 async migration lands, ownership moves per domain with a
   documented migration + rollback, never by environment side effect.
