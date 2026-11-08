# Implementation status at the 2026-11-08 baseline

This is a source-code inventory for `main` at commit `0e1c19bf97b1e606fa2b55c0fe9a385755911c43`, before the S01/S05/S08 work branches started. It is **not** a release sign-off or evidence of a connected WhatsApp account, successful delivery, live model accuracy, or production database cutover.

**Status definitions**

- **Implemented slice**: corresponding code and automated tests exist; live behavior may still need proof
- **Partial**: a useful subset exists but the published capability's end-to-end contract is incomplete
- **Planned**: the named contract is documented without a corresponding integrated implementation at this baseline

For the desired product contract, read [the capability blueprint](plans/whatsapp-agent-service-specs-2026-11-06/README.md). Its implementation phases and E2E scenarios are acceptance criteria, **not** results from passing tests. The individual service appendices describe future work unless linked to an implementation below.

## Agent capabilities A01–A10

| Capability | Baseline status | Source-code evidence and boundary |
| --- | --- | --- |
| A01 Brand Brain | **Partial** | Versioned text/FAQ/CSV ingestion, retrieval, source-conflict checks and a UI exist in [brand-knowledge](../src/agent/brand-knowledge.ts), [capability routes](../src/agent/capabilities-api.ts), and [BrandBrainPage](../ui/src/components/BrandBrainPage.tsx). Website crawling, broad catalog sync, and source-review workflows are not complete |
| A02 Hybrid retrieval | **Partial** | SQLite FTS5 and optional embedding-provider scoring exist in [brand-knowledge](../src/agent/brand-knowledge.ts). [createCapabilities](../src/agent/capabilities-api.ts) does not supply an embedding provider, so the normal runtime path is lexical search |
| A03 Web Scout | **Implemented slice** | [WebScout](../src/agent/web-scout.ts) requests Google Search grounding, filters source URLs and handles insufficient evidence; [web-scout tests](../tests/web-scout.test.ts) cover the contract. Live provider correctness remains unverified here |
| A04 Multimodal inbox | **Partial** | [document extraction](../src/agent/media-service.ts), [Python worker](../workers/media-python/document_worker.py), and [audio handling](../src/ai/audio-transcriber.ts) exist. The complete image/OCR-to-verified-business-action scenario is not implemented end to end |
| A05 Autonomous planner | **Partial** | [BoundedPlanner](../src/agent/bounded-planner.ts) executes a scoped, journaled tool loop with tests in [bounded-planner](../tests/bounded-planner.test.ts). The live [turn coordinator](../src/agent/turn-coordinator.ts) uses a narrow read-only SKU lookup path and falls back to the moderator; it does not invoke the general BoundedPlanner |
| A06 Business connectors | **Partial** | [Google Sheets inventory](../src/agent/sheets-inventory.ts) and a [registration endpoint](../src/agent/capabilities-api.ts) are available. No full production Shopify, order, CRM, calendar, or ticket connector suite is evidenced |
| A07 Customer 360 | **Partial** | [CustomerContextStore](../src/agent/customer-context.ts) records brand-scoped facts and cases, alongside existing chat memory. The separate [WCF design](plans/2026-11-06-whatsapp-context-fold.md) and historical-conversation retrieval remain proposed |
| A08 Proactive engagement | **Partial** | [FollowUpStore](../src/agent/follow-ups.ts) persists schedules, opt-outs and eligibility checks; [follow-up tests](../tests/follow-ups.test.ts) cover these rules. No live always-on scheduler plus official Meta Cloud API sender is wired into runtime |
| A09 Specialist skills | **Planned** | The [A09 service spec](plans/whatsapp-agent-service-specs-2026-11-06/agentic-services/A09-specialist-skills.md) defines sales, service, booking and quote workflows; no complete provider-backed skill pack is identified |
| A10 Quality loop | **Partial** | [QualityLoop](../src/agent/quality-loop.ts) stores scenario outcomes and aggregates scores and knowledge gaps. This is not the versioned offline reply-evaluation lab, blind/human model review, or an independently validated quality grade |

## Supporting services S01–S08

| Service | Baseline status | Source-code evidence and boundary |
| --- | --- | --- |
| S01 Reliable delivery | **Planned** | [Auto replies](../src/index.ts), [manual sends and draft approval](../src/server/api.ts) directly call the WhatsApp socket. The [S01 intent/attempt ledger contract](plans/whatsapp-agent-service-specs-2026-11-06/services/S01-reliable-delivery.md) is not present at this baseline |
| S02 Permission/privacy gate | **Partial** | [permission-engine](../src/domain/permission-engine.ts) and [permission tests](../tests/permission-engine.test.ts) cover deterministic actions. End-to-end tenant/privacy governance requires further verification |
| S03 Memory recall | **Partial** | [existing message memory](../src/domain/memory-store.ts), [learning memory](../src/domain/learning-memory.ts) and Brand Brain retrieval exist; a consolidated evidence-linked long-history recall service is not complete |
| S04 Media intelligence | **Partial** | [document media service](../src/agent/media-service.ts) and [media tests](../tests/document-extraction.test.ts) cover bounded extraction, with gaps in the full cross-modal workflow |
| S05 Reply Evaluation Lab | **Planned** | [QualityLoop](../src/agent/quality-loop.ts) is aggregate recording, not the offline fixture runner, approved-baseline comparison and human review gate described in [S05](plans/whatsapp-agent-service-specs-2026-11-06/services/S05-reply-evaluation-lab.md) |
| S06 Commitments/follow-ups | **Partial** | [FollowUpStore](../src/agent/follow-ups.ts) has persistent triggers and safety checks, but no evidence of autonomous delivery through the production messaging path |
| S07 Identity reconciliation | **Planned** | Contact and message identity exist in [database](../src/domain/db.ts) and [socket](../src/transport/whatsapp-socket.ts), but the [S07 reconciliation contract](plans/whatsapp-agent-service-specs-2026-11-06/services/S07-identity-reconciliation.md) is not implemented |
| S08 Health/diagnostics | **Partial** | [SSE](../src/server/sse.ts) and basic transport/status reporting exist, but the [S08 privacy-preserving trace and diagnostic contract](plans/whatsapp-agent-service-specs-2026-11-06/services/S08-health-diagnostics.md) is not implemented |

## Persistence: schema versus runtime

The repository includes [PostgreSQL schema migrations and SQLite import tooling](../src/persistence/postgres/) for application tables. That proves the migration **path** exists, not that every live writer uses PostgreSQL.

At this baseline:

- [src/index.ts](../src/index.ts) constructs the main `MemoryStore` against SQLite and [src/agent/capabilities-api.ts](../src/agent/capabilities-api.ts) creates separate SQLite capability stores
- A configured `DATABASE_URL` makes [PostgresLearningStore](../src/persistence/postgres/learning-store.ts) available specifically to the learning-memory and reflection path
- The remaining chat, draft, workflow, brand-source, follow-up, and evaluation writers have not been switched to PostgreSQL in the runtime shown here
- Live migration, database cutover, tenant isolation, backup/restore, and real WhatsApp delivery still need an independently verified pilot

See [PostgreSQL migration guide](POSTGRES_MIGRATION.md) for an offline export/import procedure and rollback limits. Do not treat import success as a green light to resume SQLite writers or to assume PostgreSQL is the active store.

## Evidence and release gates

| Test group | Corresponding files/commands | What passing tests can show |
| --- | --- | --- |
| Backend | `bun test`, [tests](../tests/) | Module, API and synthetic integration behavior; most provider flows are mocked |
| UI | `cd ui && bun test:ui`, `cd ui && bun run build` | Component SSR, static build and type-check; not a complete browser accessibility audit |
| Media | `python -m unittest` or project worker test invocation, [worker tests](../workers/media-python/test_worker.py) | Document parser behavior with available dependencies |
| Database | `bun test tests/pg-migration.test.ts` | Migration and importer contract on isolated test data; no production cutover |
| Security | `bun run security:audit` | Advisory scanner result only if invocation succeeds and yields valid output; this audit wrapper needs fail-closed handling at baseline |

Local verification on 2026-11-08 in a clean, separate worktree with Bun 1.4.3: `bun test --reporter=dot` reported **172 passed, 2 skipped, 0 failed** across 43 files; `cd ui && bun test tests` reported **13 passed, 0 failed**; `cd ui && bun run build` passed with a bundle-size warning. A Markdown-link check resolved all 56 local links in the changed documents, and `git diff --check` passed. The skipped backend cases are the configuration-dependent live Supabase connection checks in `tests/supabase-connection.test.ts`, so this run does not establish a live database connection. The `bun test:ui` script wrapper failed in the remote A2M environment because its `node --test` invocation was dispatched through Bun; the direct Bun UI test run above passed without changing the script.

**Pending proof before a product launch:** connected-channel delivery and receipt reconciliation, true mixed-mode and approval concurrency, live connector mutation receipts, provider credential/permission review, verified PostgreSQL runtime cutover, recovery, privacy/retention tests, and Arabic/English realistic customer E2E scenarios

When in-flight feature PRs are merged, update this inventory against the new `main` SHA and attach test/CI evidence. A PR opening alone does not change the status here
