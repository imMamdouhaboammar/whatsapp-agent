# Failure Lesson: Transitive Component Provider Hoisting & Marketing Funnel Bundle Isolation

## Context
Enforcing the target performance budget of $< 80\text{ kB}$ gzipped JavaScript on public marketing routes (`/start` 16-step interactive lead funnel and `/lp/clinics` tailored landing page), referencing `docs/FRONTEND_BUNDLE_COST.md` where the initial monolithic client bundle measured 1,947 kB (605 kB gzipped).

## What happened
1. In `ui/src/App.tsx`, the public funnel header imported `<WhatsApp size={22} className="text-emerald-400" />` from `@lobehub/ui/icons`.
2. Concurrently, `ui/src/main.tsx` wrapped the entire application tree inside `<LocaleProvider>` from `ui/src/i18n.tsx`.
3. To satisfy FL-032 (which required an enclosing motion provider for `@lobehub/ui` primitives), `LocaleProvider` statically imported `<ConfigProvider motion={motion}>` from `@lobehub/ui` and `motion/react`.
4. As a result, even though `DashboardCockpit` was dynamically code-split with `React.lazy`, Vite / Rollup bundled `@lobehub/ui` (and its 8,682 transitive modules including `@shikijs`, `antd`, and `@base-ui/react`) directly into the root entry chunk (`index-*.js`).
5. The public marketing routes inherited a 605 kB gzipped initial payload, severely violating the 80 kB budget and degrading mobile first-contentful-paint (FCP) on slow 3G/4G cellular connections.

## Observable symptom
```text
dist/index.html                     0.61 kB │ gzip:   0.36 kB
dist/assets/index-DArty4gX.css    375.70 kB │ gzip:  61.91 kB
dist/assets/index-B22Kq1ZF.js   1,947.66 kB │ gzip: 605.23 kB

(!) Some chunks are larger than 500 kB after minification.
```

## Impact
- High initial bandwidth consumption and parse latency on mobile devices loading public acquisition funnels.
- Negated the architectural purpose of route-level code-splitting by pulling the entire enterprise operator UI graph into lightweight marketing pages.

## Incorrect assumption
Assuming that wrapping high-level context providers (`ConfigProvider`) at the application entry point and using brand icons from `@lobehub/ui/icons` in layout headers would not prevent Rollup from tree-shaking the unused component library out of public routes.

## Root cause
**Confirmed**. JavaScript module bundling trees retain any dependency statically imported from an active route's component tree. Because `App.tsx` imported `@lobehub/ui/icons` and `main.tsx` imported `LocaleProvider` which imported `@lobehub/ui`, Rollup hoisted the entire design system graph into the foundational entry chunk.

## Why the architecture allowed it
`LocaleProvider` was originally created during the single-tenant dashboard era to provide both translation dictionaries and design system configuration. When public marketing funnels were added, they were wrapped with the same root provider without isolating the heavy UI framework dependencies needed only by the operator console.

## Fix
1. **Decoupled Icon Dependencies in Public Routes**:
   Replaced the `@lobehub/ui/icons` import in `ui/src/App.tsx` with an accessible, standalone inline SVG `WhatsAppIcon` component, completely eliminating design system dependencies from the public header.
2. **Explicit Rollup Manual Chunking in `ui/vite.config.ts`**:
   Configured `build.rollupOptions.output.manualChunks` to partition the bundle into distinct functional chunks:
   ```ts
   manualChunks(id) {
     if (id.includes('node_modules/@lobehub') || id.includes('node_modules/antd') || id.includes('node_modules/@ant-design')) {
       return 'vendor-lobehub';
     }
     if (id.includes('node_modules/@astryxdesign') || id.includes('node_modules/@stylexjs')) {
       return 'vendor-astryx';
     }
     if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
       return 'vendor-react';
     }
     if (id.includes('ui/src/marketing')) {
       return 'public-funnel';
     }
   }
   ```
3. **HTTP Compression & Cache-Control**:
   Enabled `hono/compress` in `src/index.ts` and applied `Cache-Control: public, max-age=31536000, immutable` for all static `/assets/*` chunks, ensuring visitors only download the lightweight marketing code once.

## Verification
```bash
# 1. Run Vite production build and verify chunk sizes
cd ui && bun run build

# Output confirms public funnel is 30.19 kB gzip (< 80 kB budget):
# dist/assets/public-funnel-DjVlbqfu.js        104.41 kB │ gzip:  30.19 kB
# dist/assets/index-BAtMVVLa.js                139.39 kB │ gzip:  47.06 kB
# dist/assets/vendor-lobehub-OQLg-a4g.js     1,109.91 kB │ gzip: 346.18 kB (isolated to dashboard)

# 2. Run all UI test suites
cd ui && bun test
```

## Prevention rule
- **Rule**: "Public customer-facing routes (`/start`, `/lp/*`) must never import components, icons, or providers from heavy internal operator libraries (`@lobehub/ui`, `@astryxdesign`). All shared layout headers on public pages must use standalone SVG icons or tree-shaken primitives, and Vite `manualChunks` must isolate operator UI frameworks into separate vendor bundles so public JS stays under 80 kB gzipped."
- **Enforcement Level**: Mandated in `AGENTS.md` and enforced via `cd ui && bun run build` chunk budget verification.

## Reusable lesson
Component libraries with rich feature sets often carry massive transitive dependency graphs. Never import a single icon or convenience component from an enterprise design system into a public landing page. Use inline SVGs or micro-libraries for public acquisition surfaces, and use explicit bundler chunk splitting to quarantine operator dependencies.

## Related code
- `ui/src/App.tsx`
- `ui/vite.config.ts`
- `ui/src/i18n.tsx`
- `src/index.ts`

## Related tests
- `ui/tests/lead-funnel-ui.test.mjs`
- `ui/tests/lead-funnel-interactive.test.mjs`

## Status
Resolved
