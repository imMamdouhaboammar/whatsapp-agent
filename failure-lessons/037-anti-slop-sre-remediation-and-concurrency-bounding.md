# FL-037: Anti-Slop SRE Remediation, Unbounded Concurrency Bounding, and Error Telemetry

## Context & Incident Trigger
During a codebase-wide forensic audit against `/anti-slop-engineering` and Google SRE invariants, several critical anti-patterns were uncovered:
1. **Silent Exception Swallowing (OPS-01 / SRE-10)**: 10+ instances of bare `catch {}` blocks across transport drivers (`whatsapp-socket.ts`), reaction dispatch (`index.ts`), and client polling loops (`App.tsx`).
2. **Unbounded Concurrency (SRE-09 / CON-09)**: `Promise.all` over user-controlled line arrays (`lines.map(...)`) up to 5,000 items in `brand-knowledge.ts`, triggering socket exhaustion and Vertex/Gemini HTTP 429 quota errors.
3. **Memory Leaks in Ephemeral State (CON-04 / OPS-11)**: `HumanRateLimiter` accumulated promises and timestamp arrays indefinitely for cold chat sessions.
4. **Deterministic Reconnection Waves (SRE-08)**: Exponential backoff in Baileys driver lacked full jitter, risking synchronized retry storms.
5. **Hardcoded Internal Secrets/Projects (SEC-01)**: Hardcoded Google Cloud Project ID fallback in `gemini-client.ts`.
6. **Bilingual Title Stacking (REV-19 / UI-15)**: Translations stacked English in parentheses inside Arabic labels (`(Funnel Engine)`).
7. **Modal Dismissal Duplication (DRY / SRE-03)**: Duplicate `Escape` key and click-outside listeners across modals.
8. **Deep Cyclomatic Nesting (KISS / SRE-01)**: PPTX/XLSX text extraction in Python workers nested up to 6 levels deep.

## Root Cause Analysis
- **Silent Catch Blocks**: Implemented as quick band-aids to avoid crashing the event loop, masking genuine SQLite failures and malformed customer payload bugs.
- **Unbounded `Promise.all`**: Assumed embedding API would scale linearly with document lines without a concurrency limiter or chunking strategy.
- **Unpruned Maps**: Cached chat session state with in-place filtering on access, leaving zero-entry keys permanently retained in memory.
- **Nesting in Parser**: Office OpenXML unpackers nested zip archive reads, XML ElementTree parsing, and cell iterators in a single monolithic function.

## Surgical Remediation & Invariants Enforced
1. **Error Telemetry Invariant**: Replace all silent `catch {}` blocks with structured domain logging (`console.warn` / `logger.error`) containing correlation metadata.
2. **Batch Concurrency Invariant**: Wrap bulk I/O and embedding generations in bounded chunk batches (`batchSize = 10`) with `for...of` outer iterations.
3. **Queue Cleanup Invariant**: Chain `.finally()` onto serialized promises to evict `sendQueues.delete(chatId)` once terminal.
4. **Full Jitter Invariant**: Incorporate uniform random jitter (`Math.random()`) into exponential reconnection backoffs to break synchronization.
5. **Direct Payload Invariant**: Ban bilingual title stacking in UI copy; provide single canonical strings per locale.
6. **Modal Hook Invariant**: Consolidate `Escape` key handling and ref tracking into a shared `useModalDismiss` hook.
7. **Flat Parser Invariant**: Decompose XML/XLSX readers into dedicated helper functions (`_extract_docx`, `_extract_pptx`, `_extract_xlsx`) with early returns.

## Verification Proof
- `bun test`: 406 passed, 0 failed, 1 skipped (13.68s)
- `cd ui && bun test:ui`: 14 passed, 0 failed (4.28s)
- `cd ui && bun run build`: Vite & TypeScript clean build (0 errors)
- `workers/media-python/.venv/bin/pytest`: 5 passed, 0 failed
- `sre_guard.py`: 0 blockers, `KISS_FUNCTION_BLOAT` and `SCALE_TOIL_ERROR_SWALLOW` resolved
- `get-fable`: `mutationGeneration=0; verifiedGeneration=0; phase=complete`
