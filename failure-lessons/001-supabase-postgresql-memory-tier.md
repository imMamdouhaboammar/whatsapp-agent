# FL-001: Supabase PostgreSQL as Production Memory Tier

- **Failure Class:** Architecture / Boundary Drift
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (Database Schema & Typed Persistence Store)
- **Primary Source:** `src/persistence/postgres/learning-store.ts`
- **Quote:** `"بدل SQLite طبعا هيكون Postgresql form supabase"` - User

---

## 1. Problem Description & Symptoms
When implementing the dual memory state (`notebook.md` and `workbook.md`), the initial implementation mirrored state into a local SQLite table in `fable_whatsapp.db`. While appropriate for local single-process development, this violated the SaaS production architecture where state must be centralized, durable, and horizontally accessible in Supabase PostgreSQL across worker pods.

## 2. Root Cause Analysis
- **Implicit Local Bias:** The developer agent default to SQLite WAL because SQLite was present locally for session caches.
- **Ignored Global Constitution:** The rule *"In production Supabase apps, do not add local SQLite fallbacks, fake persistence, or dummy database layers unless the user explicitly asks for a local-only prototype"* was momentarily overlooked during initial prototyping.

## 3. Smart Solution & Architectural Rectification
1. **Created Supabase PostgreSQL Migrations:**
   - Authored `supabase/migrations/20261107000001_learning_memory_engine.sql` and `src/persistence/postgres/migrations/002_learning_memory.sql`.
   - Defined `wa_agent.learning_states`, `wa_agent.learning_reflections`, `wa_agent.learning_feedback_events`, and `wa_agent.thread_learning_status`.
2. **Implemented `PostgresLearningStore`:**
   - Implemented `LearningPersistenceStore` interface using Bun's native `SQL` client.
   - Enforced atomic upserts: `INSERT INTO wa_agent.learning_states ... ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, version = wa_agent.learning_states.version + 1`.
3. **Dual Materialization:**
   - PostgreSQL in Supabase is the single source of truth in production.
   - Local Markdown files (`data/learning/workbook.md` and `data/learning/notebook.md`) act as a local materialized cache for human inspection and offline developer toolchains.

## 4. Verification Proof
- `tests/postgres-learning-store.test.ts` (passes 2/2).
- `tests/reflection-learning.test.ts` (passes 10/10).
- `bun test` passes 174/174 across all 85 test suites.
