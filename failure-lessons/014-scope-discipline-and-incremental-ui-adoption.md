# FL-014: Scope Discipline & Two-Phase Design System Adoption (Infrastructure Before Surface Refactoring)

- **Failure Class:** Process / Premature Refactoring
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Prose & Workflow Protocol (Compound Engineering 80/20 & Fable Scope Discipline)
- **Primary Source:** `AGENTS.md`, `ui/src/App.tsx`, `ui/src/components/`
- **Quote:** `"طيب ليه منفذتش بقا تحسينات الواجهة بيه؟ فهمني الفكرة"` - User Query

---

## 1. Problem Description & Symptoms
When instructed to integrate a complex design system (like Meta Astryx), AI agents frequently conflate *infrastructure integration* with *consumer UI refactoring*. An agent that immediately begins rewriting live application components during the initial install phase risks introducing regressions across dozens of unverified files, breaking active tests, and confusing the user who asked for an initial plan or environment check. Conversely, stopping at infrastructure without explaining why components were not yet swapped leaves the user wondering if the job was incomplete.

## 2. Root Cause Analysis
- **Speculative Refactoring:** AI agents tend to jump directly into editing application markup before proving that the build toolchain, CSS layers, and CLI commands compile cleanly.
- **Unstated Mental Models:** Failing to communicate the engineering separation between *Foundation Integration* (Phase 1) and *Surgical Component Upgrades* (Phase 2) creates a perceived disconnect between agent actions and user expectations.

## 3. Smart Solution & Architectural Rectification
1. **Enforce Two-Phase Adoption Pattern:**
   - **Phase 1 (Zero-Regression Substrate):** Check peer requirements, install packages, integrate CLI scripts, inject root `<Theme>` and CSS layers, and verify component catalog (`astryx component --list`) with zero modifications to application UI code.
   - **Phase 2 (Surgical Incremental Refactoring):** Upgrade high-value surfaces incrementally (Modals -> Drawers -> Header Controls -> Chat Components) with test execution (`bun test:ui` and `bun test`) at each step.
2. **Transparent Architectural Clarification:**
   - When completing Phase 1, clearly report that the substrate is active, explain why live components were preserved (protecting 162 passing tests and Arabic RTL layouts), and offer concrete component upgrade targets.
3. **Surgical Implementation:**
   - When authorized by user ("Yes do it بأفضل اسلوب هندسي"), selectively adopt verified Astryx primitives:
     - `Button` in `PairingModal.tsx` and `ModeratorDrawer.tsx`.
     - `Badge` in `ModeratorDrawer.tsx` and `App.tsx`.
     - `StatusDot` with pulsating states in `App.tsx`.

## 4. Verification Proof
- Zero regression across all 162 backend test suites and 13 UI SSR suites.
- Clean Git history separating infrastructure configuration from UI component adoption.
- Full bilingual Arabic RTL and English LTR fidelity preserved.
