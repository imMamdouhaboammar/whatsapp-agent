# Failure Lesson: N+1 Turn Extraction Latency & Atomic Dossier Persistence

## Context
Optimizing inbound reply hot-path internal latency ($< 80\text{ ms}$ budget) across `src/agent/turn-coordinator.ts`, `src/ai/moderator-agent.ts`, and `src/domain/memory-store.ts` during active WhatsApp customer conversations.

## What happened
1. In `src/ai/moderator-agent.ts:run()`, whenever the AI model extracted customer intelligence (new facts, commitments, or stage transitions) from an incoming WhatsApp message, it processed each extraction through separate sequential store invocations:
   ```ts
   // Sequential individual disk I/O mutations:
   if (result.facts?.length) {
     for (const f of result.facts) this.memoryStore.addFactToDossier(message.chatId, f);
   }
   if (result.commitments?.length) {
     for (const c of result.commitments) this.memoryStore.addCommitmentToDossier(message.chatId, c);
   }
   if (result.stage) {
     this.memoryStore.saveDossier({ ...existing, stage: result.stage });
   }
   ```
2. Each individual call to `addFactToDossier` and `addCommitmentToDossier` executed a synchronous SQLite read (`getDossier`), modified the array in memory, and immediately executed a synchronous SQLite write (`saveDossier`), triggering multiple write-lock cycles and disk fsync flushes per conversational turn.

## Observable symptom
Internal latency profiling showed that SQLite write operations consumed up to 30% of the internal processing time on turns where multiple customer facts or commitments were recognized simultaneously.

## Impact
- Unnecessary write contention on the SQLite database file during rapid burst conversations.
- Increased the risk of `SQLITE_BUSY` lock wait delays when background workers (e.g. `ReflectionWorker` or `SendLedger`) ran concurrent transactions.

## Incorrect assumption
Assuming that fine-grained single-purpose mutator methods (`addFactToDossier`, `addCommitmentToDossier`) are sufficient for conversational extract processing, without providing a batched atomic composite update method.

## Root cause
**Confirmed**. The `MemoryStore` and `SqliteStore` lacked an atomic multi-property update method. Processing extraction arrays sequentially created an internal $O(K)$ database write loop where $K = \text{facts} + \text{commitments} + \text{stage}$, multiplying SQLite transactions by the number of extracted items.

## Why the architecture allowed it
The early prototype prioritized granular CRUD APIs over bulk conversational operations. As the extraction capabilities of the moderator agent grew (extracting 3–5 facts per turn), the latency penalty accumulated.

## Fix
1. Introduced a single consolidated method `updateDossierExtracts` on `SqliteStore` and `MemoryStore`:
   ```ts
   updateDossierExtracts(chatId: string, updates: { facts?: string[]; commitments?: string[]; stage?: ContactStage }) {
     const existing = this.getDossier(chatId) ?? {
       chatId,
       name: chatId.split('@')[0],
       stage: 'lead',
       facts: [],
       commitments: [],
       updatedAt: Date.now()
     };

     let modified = false;
     if (updates.facts?.length) {
       for (const fact of updates.facts) {
         if (typeof fact === 'string' && fact.trim() && !existing.facts.includes(fact.trim())) {
           existing.facts.push(fact.trim());
           modified = true;
         }
       }
     }
     if (updates.commitments?.length) {
       for (const comm of updates.commitments) {
         if (typeof comm === 'string' && comm.trim() && !existing.commitments.includes(comm.trim())) {
           existing.commitments.push(comm.trim());
           modified = true;
         }
       }
     }
     if (updates.stage && existing.stage !== updates.stage) {
       existing.stage = updates.stage;
       modified = true;
     }

     if (modified) {
       existing.updatedAt = Date.now();
       this.saveDossier(existing);
     }
   }
   ```
2. Refactored `src/ai/moderator-agent.ts` to execute a single atomic call instead of separate loops:
   ```ts
   if (result.facts?.length || result.commitments?.length || result.stage) {
     this.memoryStore.updateDossierExtracts(message.chatId, {
       facts: result.facts,
       commitments: result.commitments,
       stage: result.stage
     });
   }
   ```
3. Type-aligned `stage` with the canonical `ContactStage` union to guarantee strict TypeScript verification under `tsc --noEmit`.

## Verification
```bash
# 1. Run moderator agent unit and integration tests
bun test tests/moderator-agent.test.ts

# 2. Benchmark 100 simulated inbound turns to verify p95 latency is ~1ms
bun run scripts/perf-benchmark.ts
```

## Prevention rule
- **Rule**: "When an AI agent turn extracts multiple structured attributes (facts, commitments, entity metadata, stage transitions), never mutate and persist each attribute in separate sequential database operations. Provide an atomic composite update method that aggregates mutations in memory and commits a single database transaction per turn."
- **Enforcement Level**: Mandated in `AGENTS.md` and enforced via `src/domain/memory-store.ts` and `tests/moderator-agent.test.ts`.

## Reusable lesson
Conversational turns produce batches of extractions. If your storage layer only exposes single-item setters, your hot path will suffer from $O(N)$ database roundtrips. Always provide bulk or patch methods at the repository boundary for turn-level extraction persistence.

## Related code
- `src/ai/moderator-agent.ts`
- `src/domain/memory-store.ts`
- `src/domain/db.ts`

## Related tests
- `tests/moderator-agent.test.ts`
- `tests/db.test.ts`
- `scripts/perf-benchmark.ts`

## Status
Resolved
