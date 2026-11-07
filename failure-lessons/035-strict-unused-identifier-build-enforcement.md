# FL-035: Strict Unused Identifier Build Enforcement (TS6133) in Vite/TypeScript

- **Failure Class:** Build / Type Checking & Compiler Flag Strictness
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check & Type (`ui/tsconfig.json`, `cd ui && bun run build`)
- **Primary Source:** `ui/src/App.tsx`, `ui/src/components/ChatList.tsx`, `ui/src/components/PersonaSettingsPage.tsx`, `ui/src/components/StickerStudioModal.tsx`
- **Quote:** `"src/App.tsx:5:10 - error TS6133: 'Badge' is declared but its value is never read. error: script \"build\" exited with code 1"` - TypeScript compiler output

---

## 1. Context & Observable Symptoms
While upgrading the cockpit UI to use `@lobehub/ui` primitives and official AI badges, running the production build step (`cd ui && bun run build`, which triggers `tsc -b && vite build`) failed with compiler errors:
```text
src/App.tsx:5:10 - error TS6133: 'Badge' is declared but its value is never read.
src/components/ChatList.tsx:3:18 - error TS6133: 'Badge' is declared but its value is never read.
src/components/PersonaSettingsPage.tsx:9:26 - error TS6133: 'ModelIcon' is declared but its value is never read.
src/components/StickerStudioModal.tsx:3:15 - error TS6133: 'Button' is declared but its value is never read.
error: script "build" exited with code 1
```
These errors blocked bundling even though the application rendered properly in dev mode (`bun run dev`).

## 2. Root Cause Analysis (Fact vs Hypothesis)
- **Strict Local & Parameter Compiler Flags:**
  In `ui/tsconfig.json`, TypeScript is configured with:
  ```json
  "noUnusedLocals": true,
  "noUnusedParameters": true
  ```
- **Speculative Import Drift During Refactoring:**
  During fast incremental prototyping of new UI features, components like `Badge`, `ModelIcon`, and `Button` were imported at the top of component files before being connected to the JSX markup.
- **Vite Dev vs Build Divergence:**
  Vite's development server transforms TypeScript via esbuild without running type checking, allowing pages with unused variables to mount and function. However, the production build (`tsc -b && vite build`) invokes `tsc` in project reference mode, failing closed on any TS6133 error.

## 3. Impact & Architectural Vulnerability
- **Impact:** Failed production builds, blocked CI deployment jobs, and created build drift between development and production environments.
- **Architectural Vulnerability:** Allowing unused imports creates dead code bloat, slows type checking, and risks bundling unneeded transitive dependencies.

## 4. Smart Solution & Architectural Rectification
1. **Active Markup Integration:**
   Rather than dropping useful components, actively integrated imported components into the UI semantics:
   - Wired `Badge` into `App.tsx` and `ChatList.tsx` to display active unread/moderation counts.
   - Wired `ModelIcon` into `PersonaSettingsPage.tsx` to render official provider model logos.
2. **Surgical Pruning:**
   Removed truly redundant imports (such as unused `Button` in `StickerStudioModal.tsx`) before triggering the build gate.
3. **Mandatory Pre-Commit Typecheck Verification:**
   Enforced that every refactoring step must execute `tsc -b` or `bun run build` in the UI workspace before committing.

## 5. Verification & Regression Falsification
- **Build Execution:** Executed `cd ui && bun run build`:
  ```text
  $ tsc -b && vite build
  vite v6.4.1 building for production...
  transforming...
  ✓ 142 modules transformed.
  dist/index.html                   0.92 kB │ gzip:  0.48 kB
  dist/assets/index-D1o9iS-F.css   38.41 kB │ gzip:  7.82 kB
  dist/assets/index-CPi52Ff8.js   412.18 kB │ gzip: 128.45 kB
  ✓ built in 881ms
  ```
- **Zero Typecheck Errors:** TypeScript compilation exited with code 0.

## 6. Prevention Invariant & Reusable Lessons
> **The Zero-Unused-Locals Invariant:**  
> In TypeScript projects with `noUnusedLocals: true`, never introduce speculative imports without immediate DOM or logical integration. All UI component refactoring must be verified with `cd ui && bun run build` to ensure complete absence of TS6133 errors before handoff.

## 7. Related Artifacts & Metadata
- **Related Code:** `ui/tsconfig.json`, `ui/src/App.tsx`, `ui/src/components/ChatList.tsx`, `ui/src/components/PersonaSettingsPage.tsx`
- **Related Tests:** `cd ui && bun run build`
- **Related Lessons:** `failure-lessons/014-scope-discipline-and-incremental-ui-adoption.md`
- **Status:** Resolved
