# FL-052: Deterministic Process Lifecycle, Channel-Aware Readiness & Container Hardening

## Context
Server lifecycle management (`src/server/lifecycle.ts`), HTTP readiness/SSE endpoints (`src/server/api.ts`, `src/server/sse.ts`), CLI diagnostics (`src/doctor.ts`, `src/cli.ts`), and production Docker packaging (`Dockerfile`, `docker-compose.yml`, `DEPLOYMENT.md`) across WA-006, WA-010, WA-011, WA-019, and WA-021 (PR #119).

## What happened
1. **Masked Teardown Failures & Duplicate Shutdowns (WA-006)**: Concurrent shutdown signals could trigger duplicate teardown runs, and failing teardown hooks did not propagate into a non-zero process exit code.
2. **Datastore-Only Readiness Probe (WA-010)**: The readiness endpoint reported healthy based solely on datastore connectivity even when the serving WhatsApp channel was not ready.
3. **Optimistic Doctor Diagnostics (WA-011)**: `doctor` did not honor write-probe failures, skipped verifying model API keys, and missed validating both patch targets.
4. **Unbounded SSE Subscribers & Pending Writes (WA-019)**: SSE streams lacked subscriber caps, pending-write bounds, and deterministic close semantics under slow clients.
5. **Unpinned Container Runtime (WA-021)**: `Dockerfile` lacked pinned Bun 1.4 base images, `--frozen-lockfile` installs, and verified non-root runtime execution.

## Observable symptom
- Container orchestrators routed traffic before the WhatsApp serving channel was ready, or exited `0` after failed cleanups.
- Slow SSE clients accumulated unbounded pending writes in memory.
- `doctor` reported healthy despite failed write probes or missing model keys.

## Impact
- Silent production degradation, memory exhaustion under slow SSE consumers, non-reproducible container builds, and false-green health checks.

## Incorrect assumption
1. Assuming datastore reachability equals full application readiness.
2. Assuming shutdown signals arrive once and teardown never fails.
3. Assuming SSE clients always drain writes at server speed.

## Root cause
- **Confirmed**:
  1. `src/server/lifecycle.ts` lacked single-flight shutdown coalescing and exit-code propagation on teardown errors.
  2. `src/server/api.ts` checked DB health without checking the active serving channel state.
  3. `src/doctor.ts` ignored write-probe results and skipped model-key verification.
  4. `src/server/sse.ts` maintained unbounded subscriber sets and write queues.
  5. `Dockerfile` used unpinned image tags and mutable installs without non-root runtime verification.

## Why the architecture allowed it
Operational boundaries (lifecycle, health, diagnostics, streaming, container) were built incrementally without explicit failure-propagation contracts or resource bounds.

## Fix
1. **Single-Run Shutdown & Exit Propagation (WA-006)**: Coalesced concurrent shutdowns into one run and propagated teardown failures to the exit code (`src/server/lifecycle.ts`).
2. **Channel-Aware Readiness (WA-010)**: Updated readiness checks in `src/server/api.ts` to reflect serving channel state alongside datastore health.
3. **Strict Doctor Probes (WA-011)**: Updated `src/doctor.ts` and `src/cli.ts` to honor write-probe results and verify model keys and patch targets.
4. **Bounded SSE Streams (WA-019)**: Bounded subscriber counts and pending writes with deterministic stream closure (`src/server/sse.ts`, `src/server/api.ts`).
5. **Hardened Container (WA-021)**: Pinned Bun 1.4 images, enforced `--frozen-lockfile`, and verified non-root runtime (`Dockerfile`, `docker-compose.yml`, `DEPLOYMENT.md`).

## Verification
Verified by dedicated regression suites:
- `bun test tests/process-shutdown-determinism.test.ts`
- `bun test tests/readiness-semantics.test.ts`
- `bun test tests/doctor-integrity.test.ts`
- `bun test tests/sse-bounds.test.ts`

## Prevention rule
Shutdown handlers MUST coalesce concurrent invocations and fail the exit code on teardown errors; `/ready` MUST verify the serving channel; `doctor` MUST fail on write-probe or key errors; SSE streams MUST bound subscribers/pending writes; and Docker builds MUST pin Bun versions with `--frozen-lockfile` and non-root execution.

## Reusable lesson
Production readiness requires every operational boundary—shutdown, health, diagnostics, streaming, and container packaging—to fail closed and bound memory explicitly.

## Related code
- `src/server/lifecycle.ts`
- `src/server/api.ts`
- `src/server/sse.ts`
- `src/doctor.ts`
- `src/cli.ts`
- `Dockerfile`
- `docker-compose.yml`

## Related tests
- `tests/process-shutdown-determinism.test.ts`
- `tests/readiness-semantics.test.ts`
- `tests/doctor-integrity.test.ts`
- `tests/sse-bounds.test.ts`

## Status
Resolved
