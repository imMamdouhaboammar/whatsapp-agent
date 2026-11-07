# FL-013: React DOM SSR Hook Mismatch & Peer Dependency Deduplication in Bun Monorepos

- **Failure Class:** Runtime / Dependency Management
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (Single Workspace Boundary & Unified Vite SSR Registry)
- **Primary Source:** `ui/package.json`, `ui/tests/locale-ssr.test.mjs`
- **Quote:** `"TypeError: Cannot read properties of null (reading 'useEffect')"` - Node SSR diagnostic execution

---

## 1. Problem Description & Symptoms
When testing Astryx components (`Button`, `Badge`) in an ad-hoc Node.js SSR script executed from the repository root, React threw:
```
TypeError: Cannot read properties of null (reading 'useEffect')
    at usePressFeedback (file://.../@astryxdesign/core/dist/hooks/usePressFeedback.js:53:3)
    at Button (file://.../@astryxdesign/core/dist/Button/Button.js:412:25)
    at renderWithHooks (...)
```
This error occurred despite `react` and `react-dom` matching major version 19.

## 2. Root Cause Analysis
- **Monorepo Hoisting & Dual React Copies:**
  In a repository with a root backend service and a nested `ui/` frontend workspace, running ad-hoc Node/Bun scripts from the root directory resolved hoisted copies of `react` (v19.3.1) and `react-dom` (v19.3.0) from different cache paths (`.bun/install/cache/...`).
- **Null Dispatcher:**
  In React 19, `useEffect` during server-side rendering is handled by the internal dispatcher. If the component imports `React` from one file path and the server renderer (`react-dom/server`) imports `React` from another, `resolveDispatcher()` returns `null`, causing immediate fatal exceptions on render.

## 3. Smart Solution & Architectural Rectification
1. **Directory-Isolated Execution:**
   - Enforce that all frontend operations, dependencies, and testing scripts must execute with working directory set to `ui/` (`cd ui && bun run ...` or `bun --cwd ui ...`).
2. **Unified Module Registry via Vite SSR:**
   - In `ui/tests/locale-ssr.test.mjs`, components are loaded via `vite.ssrLoadModule('/src/components/...')`. Vite acts as a unified module loader that strictly deduplicates `react` and `react-dom` to the single version pinned in `ui/package.json`.
3. **Exact Peer Dependency Alignment:**
   - Astryx requires `react: ">=19.0.0"`, `react-dom: ">=19.0.0"`, and `@stylexjs/stylex: "^0.19.0"`. `ui/package.json` pins `react@^19.3.1`, `react-dom@^19.3.1`, and `@stylexjs/stylex@^0.19.1`, ensuring zero version divergence.

## 4. Verification Proof
- `cd ui && bun -e "..."` verified that `Button` and `Badge` render valid HTML without hook exceptions when resolved inside `ui/`.
- `cd ui && bun test:ui` passed 13/13 SSR tests in 4.8s.
- `cd ui && bun run build` passed with zero bundler or TypeScript errors.
