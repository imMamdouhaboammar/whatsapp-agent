# FL-044: Cockpit Modularization Reconciliation & CodeQL Cryptographic Randomness

## Context
Reconciling PR #106 (`feat/interactive-funnel-and-cockpit-modularization`) with `main` after WA-020, WA-024, and WA-026 landed, and resolving 3 CodeQL `Insecure randomness` alerts.

## What happened
1. PR #106 refactored `ui/src/App.tsx` into a thin lazy-loaded router delegating the cockpit to `ui/src/components/DashboardCockpit.tsx`. Meanwhile, `main` landed WA-020 (`ChatRequestCoordinator`), WA-024 (`reactionsEnabled` capability gating), and WA-026 (`DashboardSync` freshness banner) directly in `ui/src/App.tsx`, creating large merge conflicts.
2. CodeQL flagged 3 `Insecure randomness` alerts for `Math.random().toString(36).slice(2, 10)` in `generateSessionId()` across `ui/src/marketing/lead-funnel/engine.ts` and `InteractiveFunnelEngine/src/funnel/engine.ts`.

## Observable symptom
- Merge conflicts across `ui/src/App.tsx` and `ui/src/components/ChatThread.tsx`.
- GitHub CodeQL check failing with `This uses a cryptographically insecure random number generated at Math.random() in a security context`.

## Impact
Blocked PR #106 from merging and risked silently dropping WA-020/024/026 reliability fixes if `App.tsx` had been overwritten blindly.

## Incorrect assumption
Assuming a `DashboardCockpit.tsx` extraction can be resolved by keeping `--ours` on `App.tsx` without porting subsequent `main` features into the extracted component.

## Root cause
**Confirmed**:
1. Extracting a monolithic `App.tsx` into `DashboardCockpit.tsx` while `main` continues modifying `App.tsx` requires porting `main`'s `App.tsx` into `DashboardCockpit.tsx` rather than discarding either side.
2. Fallback session ID generation used `Math.random()`, which CodeQL flags as insecure randomness.

## Why the architecture allowed it
Session ID generators retained a `Math.random()` fallback branch even though Bun, Node >= 19, and all target browsers support Web Crypto (`crypto.randomUUID` / `crypto.getRandomValues`).

## Fix
1. Ported `origin/main:ui/src/App.tsx` into `ui/src/components/DashboardCockpit.tsx` (preserving 100% of WA-020, WA-024, and WA-026), kept `ui/src/App.tsx` as the thin modular router, and merged `memo` + `reactionsEnabled` in `ui/src/components/ChatThread.tsx`.
2. Replaced `Math.random()` in `generateSessionId()` in both `engine.ts` files with `crypto.randomUUID()` and a `crypto.getRandomValues(new Uint8Array(8))` fallback (failing closed if Web Crypto is unavailable).

## Verification
- `cd ui && bun run test:ui`: 34/34 tests passed (including all funnel engine, graph, interactive, SSR, and cockpit locale/a11y tests).
- `cd ui && bun run build`: `tsc -b && vite build` passed in 681ms.
- GitHub `CodeQL` check on PR #106: passed in 4s (0 alerts).

## Prevention rule
- **Component Extraction Porting & Web Crypto ID Invariant**: When reconciling a component-extraction PR with `main`, port `main`'s latest logic into the extracted target component rather than accepting `--ours` on the router shell. Never use `Math.random()` as a fallback for session or entity IDs; use `crypto.randomUUID()` with `crypto.getRandomValues()` and fail closed if unavailable.
