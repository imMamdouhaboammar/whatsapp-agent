# Failure Lesson: Linear In-Memory Eviction Complexity & Worker Isolation

## Context
Auditing memory footprint (Idle RSS $< 180\text{ MB}$, Peak RSS $< 350\text{ MB}$, zero unbounded memory growth) and worker isolation in `src/observability/diagnostics-core.ts`, `src/transport/whatsapp-socket.ts`, and `src/agent/media-service.ts` for lean 24/7 self-hosted operation on 1–2 GB RAM VPS instances.

## What happened
1. **$O(N)$ Linear Eviction in Diagnostics**: In `DiagnosticsCore.startTrace()`, when the trace buffer reached its capacity (`maxTraces = 500`), the engine iterated through every key-value pair in `this.traces` using `for (const [id, trace] of this.traces)` to find the trace with the minimum `startTime`. Under high message frequency, this linear traversal added algorithmic overhead to every new turn trace.
2. **Unbounded Transport Maps**: In `WhatsAppSocket`, `rawMessages` (inbound message de-duplication) and `transportJids` (LID-to-phone mappings) were plain in-memory `Map` instances without size limits or TTL expiration, risking progressive memory leakage over weeks of continuous operation.
3. **Unbounded Heavy Worker Spawning**: `MediaService.extractDocument()` invoked `workers/media-python/document_worker.py` via `spawn()` without an async concurrency cap or input file size ceiling. Concurrent incoming large PDF attachments could spawn multiple Python runtime instances, buffer multi-megabyte payloads in RAM simultaneously, and trigger Linux kernel Out-Of-Memory (OOM) killer terminations.

## Observable symptom
Under synthetic burst testing, idle memory remained stable initially, but unbounded concurrent PDF conversions spiked memory consumption past 400 MB, and diagnostic trace creations exhibited variable processing times during buffer rotations.

## Impact
- Risk of catastrophic process termination by system OOM killers on low-spec hardware (1–2 GB RAM).
- Gradual memory bloat over months of continuous uptime due to unpruned transport Maps.
- Unnecessary CPU cycle consumption on trace buffer pruning.

## Incorrect assumption
1. Assuming JavaScript `Map` requires manual array traversal to find the oldest entry for FIFO eviction, ignoring JavaScript's guaranteed insertion-order iteration.
2. Assuming external document conversions would remain low-frequency without needing an explicit concurrency semaphore.

## Root cause
**Confirmed**.
1. `DiagnosticsCore` did not take advantage of `Map.keys().next().value` for constant-time $O(1)$ oldest-entry eviction.
2. `WhatsAppSocket` lacked encapsulated mutation helpers that proactively enforce capacity ceilings.
3. `MediaService` lacked an async concurrency limiter and maximum byte-size check on document buffers before spawning external worker processes.

## Why the architecture allowed it
The system originally prioritized features and correctness over strict hardware resource bounding, leaving background workers unmetered.

## Fix
1. **$O(1)$ Constant-Time LRU Eviction in `DiagnosticsCore`**:
   Replaced linear scanning with insertion-order eviction and refreshed entry positioning on updates:
   ```ts
   if (this.traces.size >= this.maxTraces) {
     const oldestId = this.traces.keys().next().value;
     if (oldestId) this.traces.delete(oldestId);
   }
   ```
2. **Bounded Transport Maps in `WhatsAppSocket`**:
   Created private helper methods `setRawMessage` (max 500 entries) and `setTransportJid` (max 1,000 entries) enforcing immediate FIFO pruning whenever capacity is reached:
   ```ts
   private setRawMessage(key: string, msg: proto.IWebMessageInfo) {
     if (this.rawMessages.size >= 500) {
       const oldest = this.rawMessages.keys().next().value;
       if (oldest) this.rawMessages.delete(oldest);
     }
     this.rawMessages.set(key, msg);
   }
   ```
3. **Async Semaphore & 20 MB Ceiling in `MediaService`**:
   Implemented a concurrency queue (`maxConcurrent = 2`), strict 30-second execution timeouts, and an immediate fail-closed file size check before reading buffers:
   ```ts
   if (fileSize > 20 * 1024 * 1024) {
     throw new Error(`Document exceeds maximum safe memory processing limit of 20 MB (actual: ${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
   }
   ```

## Verification
```bash
# 1. Run performance benchmark script measuring 100 inbound turns and peak RSS
bun run scripts/perf-benchmark.ts
# Result: Peak RSS 145.14 MB (< 350 MB budget), Memory growth: -10.17 MB (Zero leak)

# 2. Run media service and document extraction regression tests
bun test tests/document-extraction.test.ts

# 3. Verify entire monorepo test suite passes cleanly
bun test
```

## Prevention rule
- **Rule**: "All in-memory caching structures (`Map`, `Set`, arrays) in long-running services must declare explicit upper capacity bounds with $O(1)$ FIFO/LRU eviction (`keys().next().value`). External heavy workers (Python document extractors, audio transcribers, image processors) must be gated by concurrency semaphores ($\le 2$ on low-spec profiles), execution timeouts, and strict input byte ceilings ($\le 20\text{ MB}$) to prevent Out-Of-Memory host crashes."
- **Enforcement Level**: Mandated in `AGENTS.md` and enforced via `scripts/perf-benchmark.ts` and `src/agent/media-service.ts`.

## Reusable lesson
Every in-memory cache without a capacity limit is an eventual Out-Of-Memory crash. Never store items in plain Maps without bounded eviction, and never invoke heavy child processes without a concurrency semaphore and byte-size pre-check.

## Related code
- `src/observability/diagnostics-core.ts`
- `src/transport/whatsapp-socket.ts`
- `src/agent/media-service.ts`

## Related tests
- `scripts/perf-benchmark.ts`
- `tests/document-extraction.test.ts`
- `tests/burst-accumulator.test.ts`

## Status
Resolved
