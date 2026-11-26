# FL-045: Isomorphic SSR Route Gating, Public Funnel Isolation & Monorepo Tooling Boundaries

## Context
Integrating the public tailored-made landing page (`/lp/clinics`) and the 16-step interactive lead generation funnel (`/start`) into the `ui/` React + Vite + TypeScript application while strictly isolating them from the private owner dashboard cockpit and running full SSR regression suites under Node's native test runner (`node --test`).

## What happened
1. **SSR Route Blindness in OwnerAccessGate**: During SSR smoke tests (`lead-funnel-ui.test.mjs`), `<OwnerAccessGate><App initialPath="/start" /></OwnerAccessGate>` rendered the private password login screen (`wa-owner-access-screen`) instead of bypassing to the public lead funnel.
2. **Data Schema Discrepancy in Funnel Engine Tests**: In `lead-funnel-engine.test.mjs`, tests initially failed with `Option "ind_medical" does not exist on node "q01_industry"` and `Option "ops_team" does not exist on node "q02_ops_mode"`.
3. **Strict Unused Identifier Build Failure (TS6133)**: `tsc -b` failed with `src/components/OwnerAccessGate.tsx:1:8 - error TS6133: 'React' is declared but its value is never read.` when `React` was imported alongside `{ isValidElement, ... }` in a modern React 19 JSX runtime (`"jsx": "react-jsx"`).
4. **Monorepo Bundler Boundary in Root Commands**: Attempting to run a preview script from repository root via `node -e 'const { preview } = require("vite")'` threw `ERR_MODULE_NOT_FOUND: Cannot find package 'rolldown'` because Vite and its internal bundlers are scoped to `ui/node_modules/`.
5. **Vendored Skill Collision on Remote npx**: Attempting to execute `npx skills use "https://github.com/sentimony/agentic-workflow" --skill "session-learnings"` failed with `[SKILLS_USE_NO_MATCHING_SKILL] No matching skill found for: session-learnings` because the skill was already locally vendored and maintained under `.agents/plugins/gate0-preflight/skills/session-learnings/`.

## Observable symptom
- `lead-funnel-ui.test.mjs` test failure: `AssertionError [ERR_ASSERTION]: must render public funnel through gate`.
- `lead-funnel-engine.test.mjs` test failures: `Error: Option "ind_medical" does not exist on node "q01_industry"`.
- `tsc -b` failure: `TS6133: 'React' is declared but its value is never read`.
- Terminal error on root preview command: `Cannot find package 'rolldown'`.
- Skills CLI error: `[SKILLS_USE_NO_MATCHING_SKILL] No matching skill found for: session-learnings`.

## Impact
- Public visitors in server-rendered environments or search engine crawlers hitting `/start` or `/lp/clinics` would be locked out by the private owner login screen.
- TypeScript compiler and CI build gates blocked deployment due to an unused `React` default import under `noUnusedLocals: true`.
- Network dependency on non-existent remote skill names wasted execution cycles when local vendored tooling was already present on disk.

## Incorrect assumption
1. Assuming `window.location.pathname` is always accessible in route-gating middleware, ignoring Node.js SSR test environments where `typeof window === 'undefined'`.
2. Assuming `option.id` values matched tag prefixes (`ind_medical`, `ops_team`) rather than clean domain identifiers (`medical`, `team`).
3. Assuming default `import React` is harmless in TypeScript files configured with React 19 `jsx: react-jsx` and `noUnusedLocals: true`.
4. Assuming dependencies installed in a workspace subdirectory (`ui/node_modules/`) can be resolved by node when run from the monorepo root.

## Root cause
- **Confirmed**:
  1. `OwnerAccessGate` inspected `isPublicMarketingRoute(window.location.pathname)`. In Node.js SSR (`renderToStaticMarkup`), `window` is `undefined`, causing the guard to evaluate to `false` and default to `access === 'checking'`, rendering the private auth status screen.
  2. The canonical JSON spine (`core-spine.json`) stores option keys in `id` (`medical`, `team`, `disagree`, `5_to_15m`) and places tag prefixes in `add_tags` (`ind_medical`, `has_team`). Tests incorrectly passed tag names to `selectOption`.
  3. `tsconfig.app.json` enforces `noUnusedLocals: true`. Importing `React` without referencing it as a namespace value triggers compile error TS6133.
  4. Bun workspace isolation links package binaries inside the workspace directory (`ui/node_modules/`); root-level node execution lacks the workspace `NODE_PATH`.

## Why the architecture allowed it
The application was originally architected as a single-tenant private dashboard where all routes were assumed to require owner authentication. Introducing public lead generation funnels required converting the auth gate into an isomorphic dual-mode boundary, but initial route inspection relied on client-only globals (`window`).

## Fix
1. **Isomorphic Route Resolution in `OwnerAccessGate.tsx`**:
   Resolved route path by checking `props.currentPath`, then introspecting child element props (`isValidElement(children) ? children.props?.initialPath : undefined`), and only then falling back to `window.location.pathname`. When public, rendered `OwnerAccessContext.Provider` with `required: false` immediately and skipped `api.getDashboardStatus()`.
2. **Public Funnel Lifecycle Decoupling in `App.tsx`**:
   Extracted the private dashboard cockpit into `DashboardCockpit`. When `parsePublicRoute()` matches `/start` or `/lp/*`, only `InteractiveLeadFunnel` or `LandingPage` is mounted. The private dashboard state, SSE event listeners, and chat polling are completely unmounted.
3. **Canonical Option Identifier Alignment**:
   Aligned test engine calls with the real option IDs in `core-spine.json` (`medical`, `team`, `disagree`).
4. **Surgical Import Cleanup (TS6133)**:
   Removed unused `React` default import from `OwnerAccessGate.tsx`, retaining only `{ isValidElement, useCallback, useEffect, ... }`.
5. **Local Vendored Skills Precedence**:
   Routed session learnings extraction directly to the vendored script `.agents/plugins/gate0-preflight/skills/session-learnings/scripts/extract_session_learnings.py`.

## Verification
- `cd ui && bun run test:ui`: 34/34 tests pass across 7 test suites (including `lead-funnel-graph`, `lead-funnel-engine`, `lead-funnel-interactive`, and `lead-funnel-ui`).
- `cd ui && bun run lint`: 0 errors.
- `cd ui && bun run build`: `tsc -b && vite build` built cleanly in 761ms with 0 errors.
- HTTP runtime preview smoke check: `GET /start` and `GET /lp/clinics` returned HTTP 200 OK.
- Full monorepo test suite: `bun test` passed 556 tests across 127 files.

## Prevention rule
- **Isomorphic Route Gating & Monorepo Tooling Invariant**: Security gates and authentication middleware must resolve route paths isomorphically (supporting `currentPath` prop and child prop introspection) so SSR test runners without `window` can verify public route bypasses. Public marketing routes must completely unmount private dashboard cockpits to prevent background API leaks. External agent harnesses must always prioritize locally vendored skills in `.agents/plugins/` over speculative network downloads.

## Reusable lesson
When adding public-facing marketing or lead generation funnels into an existing private dashboard application, never layer public components inside private data loaders. Isolate the public components at the top-level router, make authentication gates isomorphic, and ensure test suites assert that public routes make zero private network calls.

## Related code
- `ui/src/components/OwnerAccessGate.tsx`
- `ui/src/App.tsx`
- `ui/src/marketing/routing.ts`
- `ui/src/marketing/lead-funnel/InteractiveLeadFunnel.tsx`
- `ui/src/marketing/landing/LandingPage.tsx`
- `.agents/plugins/gate0-preflight/skills/session-learnings/`

## Related tests
- `ui/tests/lead-funnel-ui.test.mjs`
- `ui/tests/lead-funnel-engine.test.mjs`
- `ui/tests/lead-funnel-interactive.test.mjs`
- `ui/tests/lead-funnel-graph.test.mjs`

## Status
Resolved
