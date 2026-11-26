# Failure Lesson: React Synchronous Headless SSR Runner vs. Client-Side Code-Splitting

## Context
Tuning the frontend application (`ui/`) for fast mobile performance on public landing and lead funnel routes (`/start`, `/lp/*`) by code-splitting the operator console (`DashboardCockpit`) with `React.lazy`, while maintaining 100% passing headless SSR regression suites (`ui/tests/locale-ssr.test.mjs`, `ui/tests/a11y-ssr.test.mjs`) executed via `node:test` and `renderToStaticMarkup`.

## What happened
1. To meet the performance budget of $< 80\text{ kB}$ gzipped JavaScript for the public funnel, the monolithic `ui/src/App.tsx` was refactored into a thin router that dynamically loads the private operator dashboard via `const DashboardCockpit = lazy(() => import('./components/DashboardCockpit'))` wrapped in a `<Suspense>` boundary.
2. In the browser client, Vite / Rollup cleanly split the bundle, moving `@lobehub/ui`, `@lobehub/icons`, and dashboard components into isolated lazy chunks.
3. However, running the headless server-side rendering test suite (`cd ui && bun test`) immediately failed across multiple SSR assertions (e.g. `assert.match(ar, /class="wa-app" dir="rtl"/);`). Instead of rendering the complete application HTML, `renderToStaticMarkup` emitted only the Suspense fallback skeleton (`<div class="wa-owner-loading">...</div>`).

## Observable symptom
```text
AssertionError [ERR_ASSERTION]: Expected values to match:
/class="wa-app" dir="rtl"/
Found:
'<div class="wa-owner-loading"><p>جارٍ تحميل لوحة التحكم...</p></div>'
    at ui/tests/locale-ssr.test.mjs:58:10
```

## Impact
- Blocked automated UI test verification and CI pipelines from passing.
- Risked breaking server-side rendering (SSR), search engine crawling, and static HTML generation for the operator workspace if components were rendered without client-side hydration.

## Incorrect assumption
Assuming that `ReactDOMServer.renderToStaticMarkup` awaits pending promises inside `React.lazy` components if the dynamic import promise was already resolved in the JavaScript microtask queue.

## Root cause
**Confirmed**. In React 18 and React 19, `ReactDOMServer.renderToStaticMarkup` is strictly synchronous. It does NOT resolve or wait for `React.lazy` component loaders—even if the underlying promise is already fulfilled. The moment a `lazy()` component is encountered during `renderToStaticMarkup`, React immediately bails out to the nearest `<Suspense>` fallback.

## Why the architecture allowed it
The test suite executed in a Node.js/Bun environment using Vite's `ssrLoadModule` to load source files directly without a client bundler. In this environment, top-level `import()` statements behave as asynchronous module evaluations, but the test runner relied on synchronous `renderToStaticMarkup` rather than streaming SSR (`renderToPipeableStream`).

## Fix
Implemented an isomorphic dual-mode component resolution strategy in `ui/src/App.tsx`:
1. In SSR Node/Bun environments (`typeof window === 'undefined'`), asynchronously resolve and hold the synchronous `DashboardCockpit` component reference at module evaluation time:
   ```tsx
   let SsrDashboardCockpit: ComponentType | null = null;
   if (typeof window === 'undefined') {
     try {
       const mod = await import('./components/DashboardCockpit');
       SsrDashboardCockpit = mod.DashboardCockpit;
     } catch {}
   }
   ```
2. In `App()`, if running in SSR and `SsrDashboardCockpit` is populated, render it directly without wrapping in `React.lazy`:
   ```tsx
   if (typeof window === 'undefined' && SsrDashboardCockpit) {
     return <SsrDashboardCockpit />;
   }
   return (
     <Suspense fallback={<div className="wa-owner-loading"><p>جارٍ تحميل لوحة التحكم...</p></div>}>
       <LazyDashboardCockpit />
     </Suspense>
   );
   ```
3. In browser client environments (`typeof window !== 'undefined'`), Vite's production build ignores the SSR branch and bundles `LazyDashboardCockpit` as a separate dynamic chunk.

## Verification
```bash
# 1. Verify all 34 UI SSR tests pass
cd ui && bun test

# 2. Verify TypeScript build and chunking passes with zero errors
cd ui && bun run build
```

## Prevention rule
- **Rule**: "When introducing `React.lazy` code-splitting into React applications evaluated by synchronous server-side rendering test runners (`renderToStaticMarkup`), always provide an isomorphic SSR fallback that loads the synchronous component module during Node evaluation (`typeof window === 'undefined'`) while retaining `React.lazy` for client browser builds."
- **Enforcement Level**: Mandated in `AGENTS.md` and enforced via `ui/tests/locale-ssr.test.mjs` and `ui/tests/a11y-ssr.test.mjs`.

## Reusable lesson
`renderToStaticMarkup` and `renderToString` will never await `React.lazy` components. Whenever a performance optimization introduces dynamic `import()` route-splitting into a project with SSR assertions, verify the test suite in headless mode immediately. Dual-mode gating via `typeof window === 'undefined'` preserves both zero-byte client bundle splitting and complete server-rendered HTML.

## Related code
- `ui/src/App.tsx`
- `ui/src/components/DashboardCockpit.tsx`
- `ui/vite.config.ts`

## Related tests
- `ui/tests/locale-ssr.test.mjs`
- `ui/tests/a11y-ssr.test.mjs`
- `ui/tests/lead-funnel-ui.test.mjs`

## Status
Resolved
