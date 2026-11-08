# PostgreSQL / Supabase migration plan

Date: 2026-11-06
Status: In progress. No production cutover authorized by this document.

## Objective and non-negotiables

Move all persistent data from seven Bun SQLite databases into a private PostgreSQL schema suitable for either directly managed PostgreSQL or a Supabase Postgres connection. Preserve every business record, workflow receipt, contact preference, and inbound/outbound message. The existing SQLite runtime stays the default until the asynchronous PostgreSQL implementation passes its full acceptance suite and a verified live pilot.

- No writes to original SQLite files during import; no deletion of originals.
- Do not start both writers against separate databases. Stop the application during the final snapshot, import and cutover.
- No cross-brand reads or writes. Legacy unscoped conversations require an explicit operator-provided brand identity.
- Do not reinterpret timestamps: legacy numbers are milliseconds since Unix epoch and remain BIGINT.
- Preserve raw JSON string columns initially; parse and enrich only in later tested migrations.
- Preserve action idempotency keys, follow-up state transitions, customer opt-outs and provider receipts exactly.
- The migration refuses a nonempty target and never silently overwrites existing records.
- Failure at any point rolls back the entire PostgreSQL data import; original files remain available for offline restoration.
- Never expose the database connection string in logs, browser state or Git.

## Inventory (verified from constructors)

| SQLite database | PostgreSQL tables | Important semantics |
| --- | --- | --- |
| `fable_whatsapp.db` | chats, messages, contact_dossiers, drafts, contact_memories | Core chat/message API is synchronous; chat IDs and message IDs were not brand-scoped |
| `agent-knowledge.sqlite` | brand_sources, brand_source_versions, knowledge_chunks | Preserve all versions, retirements, chunk IDs and embeddings; SQLite FTS5 is derived and must be rebuilt using PostgreSQL search |
| `agent-actions.sqlite` | agent_workflows, agent_tool_runs | Unique idempotency key within brand, atomic claim, reconciliation state |
| `agent-connectors.sqlite` | brand_sheet_connectors | Brand connector preferences |
| `agent-customer.sqlite` | customer_facts, customer_cases | Confidence, expiry, receipts, customer erasure |
| `agent-followups.sqlite` | engagement_triggers, engagement_optouts | Atomic scheduling/claiming, consent, channel restrictions |
| `agent-quality.sqlite` | agent_evaluations | Brand-scoped assessment records |

Total at the original S0 audit: 16 persisted tables. `knowledge_fts` is a derived SQLite index, not a source table; PostgreSQL uses its own GIN lexical index.

### Post-S01 inventory correction (2026-11-08)

The 16-table S0 inventory was incomplete. `fable_whatsapp.db` also contains **two existing learning tables**, `learning_states` and `learning_reflections`, created by `SqliteStore` and covered by PostgreSQL schema migration `002_learning_memory.sql`, but **not by the offline SQLite importer**. S01 Reliable Delivery introduced **three more durable tables** in the same file: `send_intents`, `send_attempts`, and `send_intent_events`, which are absent from both the PostgreSQL schema and importer. The base checkout therefore contains **at least 21 source tables** across seven identified SQLite files, while the importer handles only the original 16. This is a dated B2 baseline, not a final count: any new B2 SQLite tables/files must be inventoried again.

### Integrated B2 inventory correction (2026-11-08)

The merged WCF code creates three additional tables in `fable_whatsapp.db`: `conversation_folds`, `conversation_fold_messages`, and `conversation_fold_sources`. Together with the five previously omitted S01/learning tables, the combined runtime has **at least 24 source tables in the seven established SQLite files**, while the current importer still covers only the historical 16. S07 introduces four more identity tables (`identity_contacts`, `identity_aliases`, `identity_merges`, `identity_reviews`) when its separate identity database is configured for durable storage, bringing the combined schema inventory to **at least 28 source tables across eight SQLite databases** in that configuration. A08 extends the two previously counted `agent-followups.sqlite` tables and does not create additional tables. With A05 inbound planning enabled for the selected owner brand, one additional `inbound_planner_turns` table is created in `inbound-planner.sqlite`, bringing the combined optional inventory to **at least 29 source tables across nine SQLite databases**. The final operational file inventory must be checked against the actual deployment before any migration.

An integrated regression test proves that WCF tables trigger the same fail-closed import refusal. The historical fingerprint fixture deliberately removes all eight currently omitted main-database tables in a disposable test database only. Live data, if present, is never modified by this compatibility fixture.

The importer now fails closed on unaccounted SQLite tables or additional database files before opening PostgreSQL or issuing an import receipt. The eight known missing main-database import contracts, optional identity tables, and any newly landed B2 data files require schema alignment, a version-aware historical import decision, strict row-count/digest parity, and a rollback rehearsal. The S01 ledger must preserve foreign keys, idempotency, attempts and append-only event history. Historical rows may never be silently invented or omitted.

A first asynchronous PostgreSQL `PostgresActionJournal` slice now has an injectable transaction contract and isolated tests, including brand/workflow ownership, terminal-state claim refusal, JSON-safe credential redaction, and receipt reconciliation. New PostgreSQL claim hashes are canonical JSON `v2:` digests; existing unversioned SQLite hashes are accepted for exact legacy payload replay, but reordered legacy object payloads remain order-sensitive and need migration-specific handling before cutover. The app's live `ActionJournal` and every other operational writer still use SQLite. `DATASTORE=postgres` deliberately rejects startup until all operational stores, including the S01 ledger, support one PostgreSQL writer with proven feature parity. A configured `DATABASE_URL` may still serve the separate learning/reflection persistence feature in the current SQLite-default runtime.

## Target design

- Dedicated `wa_agent` schema, outside Supabase's default exposed API schema; backend-only credential. Schema privileges are revoked from PUBLIC.
- Existing SQLite field names remain intact to reduce transformation bugs. IDs are TEXT, millisecond times BIGINT, floating confidence DOUBLE PRECISION, boolean-like legacy values SMALLINT, JSON payloads TEXT. Future schema version can upgrade these types after compatibility tests.
- Previously unscoped core tables gain a required `brand_id` with composite keys and indexes. Legacy importer supplies `--legacy-brand`; no brand is guessed from chat IDs.
- Brand-scoped operational tables preserve their existing primary/unique constraints.
- Knowledge version history remains immutable. Search index is derived from chunk content, not imported from FTS5 rows.
- `wa_agent.schema_migrations` records DDL version. `wa_agent.data_imports` records successful import fingerprints and per-table counts.

## Execution stages

### S0: baseline and contract
- [x] Count the SQLite stores, tables, access paths and synchronous callsites
- [x] Start a clean Git worktree so concurrent UI changes remain untouched
- [x] Capture full baseline Bun suite/build on worktree (151 tests, production UI build, TypeScript check)

### S1: PostgreSQL foundation
- [x] Write versioned SQL schema with private namespace, indexes and constraints
- [x] Add Bun SQL migrator with transaction/advisory lock and schema-version ledger
- [x] Add TDD contract tests for every source table and schema guard
- [x] Provide setup instructions for Supabase and standalone Postgres
- [ ] Validate actual DDL against a reachable PostgreSQL/Supabase instance

### S2: offline import and verification
- [x] Implement read-only SQLite importer; missing optional stores must be reported, not silently synthesized
- [x] Require `--legacy-brand`, explicit `--apply`, explicit source directory and database URL
- [x] Validate SQLite integrity and foreign-key references, source counts and row hashes
- [x] Reject nonempty destination, use one PostgreSQL transaction, verify written counts, roll back on mismatch
- [x] Test with generated SQLite fixtures and simulated PostgreSQL failures
- [ ] On a live PG target: run schema + import + rerun prevention + restore rehearsal

### S3: application runtime
- [ ] Introduce async persistence contracts; remove direct `SqliteStore` exposure in API/MCP
- [ ] Move action journal first; test atomic idempotent concurrent claims
- [ ] Move follow-ups, opt-outs and customer context; test concurrent claims and customer erasure
- [ ] Move knowledge ingest/retrieval; test lexical Arabic search, source authority and conflicts
- [ ] Move connectors and quality loop
- [ ] Move core chat, messages, drafts, dossiers and explicit memory; await every callsite in API, MCP, moderation, transport and CLI
- [ ] Add `DATASTORE=postgres` only after feature-parity acceptance; fail closed on bad connection, no fallback to another active writer

### S4: production pilot and release gates
- [ ] Stop application, make tested SQLite backup/snapshot, import, verify row counts and deterministic row-level hashes
- [ ] Verify each tenant boundary, retention and erasure; verify identity of legacy conversations
- [ ] Test cold start, concurrent messages, restart, webhook reconnect, data import/export, idempotent retries, RTL and dashboard
- [ ] Confirm Postgres backup and restore on a disposable database; do a rollback drill with downtime and old SQLite only
- [ ] Deploy to a limited business pilot; record performance and failure metrics before promoting PostgreSQL to default

## TDD and completion rules

Every behavioral change starts with a failing Bun test, then minimum code and cleanup. Full `bun test`, `bunx tsc --noEmit`, UI build, and PostgreSQL integration tests must pass. Live integration tests require `TEST_DATABASE_URL` and a disposable schema/database. Without a reachable PostgreSQL server, mark S1/S2 code as statically/unit-verified only, and do not claim the cutover is complete.

## Recovery

Original SQLite files are never deleted by the importer. PostgreSQL import transaction is all-or-nothing; failure leaves the target free of imported records. Re-run only after investigating the failed fingerprint and ensuring the target is empty. During pilot, rollback means stop the app and explicitly restore the pre-cutover SQLite deployment and its frozen data; messages written into PostgreSQL after cutover require a separately tested reverse export before lossless rollback is possible.

## Known constraints

The initial importer deliberately does not enable PostgreSQL as the app runtime. Existing synchronous public methods make a premature driver swap unsafe. Supabase first-party WhatsApp ad targeting and product catalog access are outside the database migration and require separate permissioned integrations.
