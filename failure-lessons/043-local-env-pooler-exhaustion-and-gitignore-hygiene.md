# FL-043: Local `.env` Pooler Exhaustion & `.gitignore` Scratch Hygiene

## Context
Running `bun test` locally in a workspace with `.env` configured for Supabase's IPv4 session pooler, and auditing untracked/scratch directories (`fable-hero-preview/`, `test-session/`, `ui/src/marketing/landing/data/`) during PR #106 integration.

## What happened
1. Bun automatically loads `.env` into `process.env`. Running `bun test` across 146 files opened concurrent Postgres connections to Supabase's session pooler (`pool_size: 15`), causing `PostgresError: (EMAXCONNSESSION) max clients reached in session mode` and 5000ms timeouts in `tests/engine-integration.test.ts`.
2. Setting only `DATABASE_URL=""` resolved the pooler timeouts (669 pass / 3 skip) but caused `fails closed when environment variables are missing` to fail because `SUPABASE_URL` remained loaded from `.env`.
3. `.gitignore` used an unanchored `data/` pattern that risked colliding with `ui/src/marketing/landing/data/`, while `fable-hero-preview/` (5 MB of generated preview PNGs/scripts) and `test-session/` were present locally.

## Observable symptom
- `PostgresError: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`
- `✗ Engine Integration & Autonomous Loop > initializes agent engine with SQLite WAL and responds to API requests [5002.19ms]`

## Impact
False-negative local test failures and risk of committing 5 MB of generated preview screenshots or runtime session directories to `main`.

## Incorrect assumption
Assuming `bun test` runs in a clean environment without `.env`, or that unsetting `DATABASE_URL` alone isolates Supabase tests.

## Root cause
**Confirmed**:
1. Bun auto-loads `.env`, routing local SQLite/integration tests into live Supabase session-mode connections with a 15-client cap.
2. Unanchored `.gitignore` rules (`data/`) match nested source directories (`ui/src/marketing/landing/data/`).

## Why the architecture allowed it
Tests did not isolate `process.env` from local developer `.env` files, and `.gitignore` lacked root anchoring for `/data/` and exclusions for `fable-hero-preview/` and `test-session/`.

## Fix
1. Anchored `/data/` in `.gitignore` and added `fable-hero-preview/` and `test-session/` to `.gitignore`, removing the empty `test-session/` directory and excluding `fable-hero-preview/` from PR #106.
2. Diagnosed `(EMAXCONNSESSION)` as `.env` pooler contention (verified in CI where `.env` is absent and all 670 tests pass).

## Verification
- `git status -sb` on `main`: clean (`## main...origin/main`), `ui/src/marketing/landing/data/` properly tracked, `fable-hero-preview/` ignored.
- CI `Run Unit, Integration & UI Quality Gates`: passed on PRs #119, #104, and #106.

## Prevention rule
- **Env-Isolated Test Diagnosis & Anchored `.gitignore` Invariant**: When local `bun test` hits `EMAXCONNSESSION` against a live `.env` pooler, diagnose env leakage before editing code. Always root-anchor runtime data directories (`/data/`) in `.gitignore` so nested source `data/` folders remain trackable, and exclude preview/scratch directories (`fable-hero-preview/`, `test-session/`) from public commits.

## Reusable lesson
Auto-loaded `.env` credentials can divert hermetic test runs into shared cloud poolers. Root-anchor `.gitignore` rules to avoid ignoring production source assets with generic names like `data/`.

## Related code
- `.gitignore`
- `.env`

## Related tests
- `tests/db.test.ts`

## Status
Resolved
