# ROLE & TASK
You are a Senior Frontend & Product Engineer integrating a new **Public Tailored-Made Landing Page + 16-Step Interactive Lead Generation Funnel** into the existing `ui/` React + Vite + TypeScript application.

Your job is to wire everything cleanly, connect the landing page and the interactive funnel together, isolate them from the private owner dashboard, write comprehensive automated tests (state machine + graph integrity + UI/SSR), and verify the production build passes with zero errors.

---

## STEP 1: REPOSITORY DISCOVERY & COLLISION CHECK (DO THIS FIRST)
Before writing or moving any file, inspect:
1. `ui/package.json`, `ui/vite.config.ts`, `ui/tsconfig.app.json`, and `ui/.oxlintrc.json` to check:
   - Whether `resolveJsonModule` is enabled in TypeScript config.
   - Whether Tailwind CSS is installed and configured, or if the app uses plain CSS / design tokens (`DESIGN.md`, `ui/src/index.css`).
   - What router (if any) is used in `ui/src/App.tsx` (e.g., `react-router`, hash routing, or `window.location.pathname`).
2. `ui/src/App.tsx` and `ui/src/components/OwnerAccessGate.tsx` to understand how routes are guarded.
3. Existing `ui/src/components/FunnelPage.tsx` and backend `src/funnel/*` — **DO NOT overwrite, modify, or collide with them.** Keep all new public lead-gen code strictly isolated under `ui/src/marketing/`.
4. Existing `ui/tests/` (`a11y-ssr.test.mjs`, `brand-brain-ssr.test.mjs`, `locale-ssr.test.mjs`) to match the project's exact test runner and conventions.

---

## STEP 2: DIRECTORY ARCHITECTURE (ZERO COLLISION)
Organize the new public marketing & lead-gen system cleanly under `ui/src/marketing/`:

- `ui/src/marketing/landing/`
  - `types.ts`
  - `data/core.ts`
  - `data/verticals/clinics.ts` (and keep structure ready for other verticals)
  - `LandingPage.tsx`
- `ui/src/marketing/lead-funnel/`
  - `types.ts`
  - `engine.ts`
  - `registry.ts`
  - `InteractiveLeadFunnel.tsx`
  - `data/core-spine.json`
  - `data/industries/medical.json`
  - `data/industries/ecommerce.json`
  - `data/industries/real-estate.json`
  - `data/industries/tourism.json`
  - `data/industries/hospitality.json`
  - `data/industries/education.json`

**Styling Rule:**
- If Tailwind CSS is already installed in `ui/`, use it directly.
- If Tailwind CSS is NOT installed, DO NOT bloat the bundle by adding it blindly unless clean; instead create a scoped `ui/src/marketing/marketing.css` using the project's existing design tokens (`DESIGN.md` / `replica/design/tokens.json`) so the UI looks sharp, modern, mobile-first, and RTL-native without leaking styles into the main dashboard.

---

## STEP 3: INTEGRATION & ROUTING (CONNECT LANDING PAGE + INTERACTIVE FUNNEL)
Wire the public routes in `ui/src/App.tsx` (bypassing `OwnerAccessGate` completely so public visitors never see dashboard auth or trigger private API calls):

1. **Public Routes to support:**
   - `/start` → Standalone `InteractiveLeadFunnel` starting at `q01_industry` (for cold ad traffic).
   - `/lp/clinics` (and `/lp/:vertical`) → `LandingPage` for that vertical, with the `InteractiveLeadFunnel` embedded or launched cleanly via an interactive section/modal.
2. **Smart Pre-Seeding (Vertical → Funnel Sync):**
   - Add an optional prop `initialIndustry?: IndustryId` to `InteractiveLeadFunnel` and `createInitialSession(initialIndustry?)`.
   - When a visitor is already on `/lp/clinics` and clicks the Hero CTA or starts the embedded interactive assessment, skip `q01_industry` automatically, pre-seed `industryId: 'medical'`, and start directly at `q02_ops_mode` so we never ask them a question they already answered by clicking a clinic ad.
   - Keep `q01_industry` as the entry point when visiting `/start` directly.
3. **Environment & Config (No Hardcoded Phone Numbers):**
   - Read `VITE_SALES_WHATSAPP_NUMBER` and `VITE_FREE_DOWNLOAD_URL` from `import.meta.env` with safe fallback placeholders and document them in `.env.example`.
4. **Analytics & Drop-Off Tracking Hook:**
   - Wire `onEvent` in `InteractiveLeadFunnel` to emit structured events to Microsoft Clarity (if `window.clarity` exists) and `dataLayer` (if `window.dataLayer` exists), tracking `funnel_started`, `funnel_step_completed`, `funnel_objection_triggered`, `funnel_step_back`, `funnel_completed`, and `funnel_cta_clicked` with `nodeId`, `industryId`, and `painScore`.

---

## STEP 4: AUTOMATED TESTING SUITE (MANDATORY)
Write comprehensive tests covering both the state machine logic and the UI integration:

1. **Graph & JSON Integrity Tests (`ui/tests/lead-funnel-graph.test.ts` or `.mjs` matching repo runner):**
   - Validate `core-spine.json` and ALL 6 industry JSON packs (`medical`, `ecommerce`, `real_estate`, `tourism`, `hospitality`, `education`).
   - Assert every `default_next` and every `next_node_override` resolves to a real node or `result_blueprint` (zero broken links or dead ends).
   - Assert every industry pack defines all required nodes (`ind_q1`, `ind_react1`, `ind_obj1`, `ind_q2`, `ind_react2`, `ind_obj2`), non-empty `vocab`, and non-empty `sample_conversation`.
   - Assert every `{{variable}}` placeholder in every `title_template` and `body_template` exists in `IndustryVocab` (zero unresolved `{{...}}` strings in rendered output).

2. **State Machine & Edge Case Tests (`ui/tests/lead-funnel-engine.test.ts`):**
   - Walk through all 3 `ops_mode` branches (`team`, `solo`, `existing_bot`) × all 6 industries to completion (`result_blueprint`).
   - Verify clicking "لأ مش مقتنع" (`skeptical` tag) routes to the exact `objection_handler` node and increments `objectionsRaised`.
   - Verify `goBack()` snapshot restoration: select 4 answers, go back 2 steps, pick a different branch (including changing `ops_mode` or `industry_id`), and assert `painScore`, `tags`, `answers`, and `objectionsRaised` are restored accurately with zero leaked tags or score drift.
   - Verify `painScore` stays clamped between `0` and `100`.
   - Verify `initialIndustry` pre-seeding starts cleanly at `q02_ops_mode` with `canGoBack: false`.
   - Verify `buildFinalBlueprint()` produces valid `https://wa.me/...` URLs with properly URI-encoded Arabic summary text, and routes `self_hosted_diy` users to `DOWNLOAD_FREE_CORE`.

3. **UI, RTL & Accessibility Smoke Tests:**
   - Verify SSR/render of both `LandingPage` (in `eg`, `gcc`, `en` with correct `dir="rtl"` / `dir="ltr"`) and `InteractiveLeadFunnel` without crashing or accessing `window` unsafely during SSR.
   - Verify keyboard navigation (`1`–`6` selects options, `Escape` navigates back) and progress bar `aria-valuenow` updates.
   - Verify public routes (`/start`, `/lp/clinics`) render without requiring `OwnerAccessGate` authentication.

---

## STEP 5: VERIFICATION GATES (DO NOT SKIP)
Run all checks and report actual command outputs before finishing:
1. Run all new funnel & landing tests + ALL existing `ui/tests/*` to confirm zero regressions.
2. Run TypeScript typecheck (`tsc --noEmit`) inside `ui/`.
3. Run linter (`oxlint`) inside `ui/`.
4. Run production build (`bun run build` or `vite build`) inside `ui/` and report the bundle size impact.
5. Start the dev server briefly or run a headless smoke check to verify `/start` and `/lp/clinics` return HTTP 200 and render cleanly.

Deliver a concise final report listing:
- Files created/modified
- Any styling or routing adaptations made to fit the existing `ui/` setup
- Exact test & build outputs
- How to preview `/start` and `/lp/clinics` locally