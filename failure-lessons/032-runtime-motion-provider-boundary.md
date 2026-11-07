# FL-032: Runtime Motion Provider Boundary in React Component Libraries (@lobehub/ui)

- **Failure Class:** Runtime / Context Boundary & Peer Dependency Decoupling
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (`ui/src/locale-context.tsx`, `ui/src/i18n.tsx`)
- **Primary Source:** `ui/src/components/ModeratorDrawer.tsx`, `ui/src/components/PersonaSettingsPage.tsx`, `ui/src/components/StickerStudioModal.tsx`, `@lobehub/ui`
- **Quote:** `"error: Please wrap your app with <ConfigProvider> (or <MotionProvider>) and pass the motion component at useMotionComponent"` - SSR & Vitest test runner

---

## 1. Context & Observable Symptoms
When integrating `@lobehub/ui` modern UI primitives (`Button`, `ActionIcon`, `Avatar`, `ConfigProvider`) into the WhatsApp Agent React Cockpit (`ui/`), client mounting and headless SSR tests threw fatal runtime exceptions:
```text
14 | 	if (!context) throw new Error("Please wrap your app with <ConfigProvider> (or <MotionProvider>) and pass the motion component");
error: Please wrap your app with <ConfigProvider> (or <MotionProvider>) and pass the motion component
      at useMotionComponent (/Users/mamdouhaboammar/.bun/install/cache/links/@lobehub+ui@6.15.2+.../node_modules/@lobehub/ui/es/ConfigProvider/useMotionComponent.mjs:14:15)
      at ActionIcon (/Users/mamdouhaboammar/.bun/install/cache/links/@lobehub+ui@6.15.2+.../node_modules/@lobehub/ui/es/ActionIcon/index.mjs:42:28)
```
This failure blocked both client-side interactivity and the automated UI SSR regression test suite (`bun test:ui`).

## 2. Root Cause Analysis (Fact vs Hypothesis)
- **Peer Animation Decoupling:** Modern component libraries such as `@lobehub/ui` deliberately avoid bundling heavy animation libraries (e.g., `motion` or `framer-motion`) directly into their distribution bundles. Instead, they leave animation engines as optional peer dependencies.
- **Fail-Closed Context Hook:** Internally, animated subcomponents (`ActionIcon`, `Button`, `Modal`, `Drawer`) invoke `useMotionComponent()`. If `MotionComponentContext` is null or undefined, the hook immediately fails closed by throwing an Error rather than degrading silently or polyfilling a dummy driver.
- **SSR & Component Tree Isolation:** In headless SSR tests (`ui/tests/locale-ssr.test.mjs`), components were rendered without wrapping top-level application context providers, immediately triggering the context error.

## 3. Impact & Architectural Vulnerability
- **Impact:** Crashed headless component tests, broke server-side rendering, and created white-screen runtime errors on client view transitions.
- **Architectural Vulnerability:** Without an explicit, universally accessible Motion Provider layer at the highest root boundary of the UI, individual components cannot safely adopt library primitives without each test and route reimplementing provider boilerplate.

## 4. Smart Solution & Architectural Rectification
1. **Explicit Motion Dependency Installation:**
   Installed `motion@^14.10.1` and `@lobehub/fluent-emoji@^5.0.1` via Bun inside `ui/package.json`.
2. **Foundational Provider Encapsulation:**
   Injected `<ConfigProvider motion={motion} enableCustomFonts={false}>` directly into `LocaleProvider` in `ui/src/locale-context.tsx` and `ui/src/i18n.tsx`.
   ```tsx
   import { motion } from 'motion/react';
   import { ConfigProvider } from '@lobehub/ui';

   export function LocaleProvider({ children }: { children: React.ReactNode }) {
     const { language, direction } = useLocale();
     return (
       <ConfigProvider motion={motion} enableCustomFonts={false}>
         <div dir={direction} data-locale={language}>
           {children}
         </div>
       </ConfigProvider>
     );
   }
   ```
3. **Universal Test Inheritance:**
   Because all UI tests and entry points render through `LocaleProvider` or wrap with `ConfigProvider`, every component automatically inherits the valid motion runtime in both browser and headless Node/Bun test environments.

## 5. Verification & Regression Falsification
- **SSR Test Execution:** `cd ui && bun test:ui` passed 13/13 tests across Arabic RTL and English LTR without context or dispatcher errors.
- **Vite Production Build:** `cd ui && bun run build` passed cleanly in 881ms with 0 bundler errors.
- **Live Cockpit Inspection:** Verified in browser that `@lobehub/ui` `ActionIcon` and `Button` animate smoothly without console warnings.

## 6. Prevention Invariant & Reusable Lessons
> **The Motion Context Invariant:**  
> Any React application or component harness adopting `@lobehub/ui` MUST provide an explicit `motion` instance through `<ConfigProvider motion={motion}>` or `<MotionProvider motion={motion}>` at the foundational provider boundary, ensuring headless SSR test harnesses and client routes share identical animation runtime context.

## 7. Related Artifacts & Metadata
- **Related Code:** `ui/src/locale-context.tsx`, `ui/src/i18n.tsx`, `ui/src/App.tsx`, `ui/package.json`
- **Related Tests:** `ui/tests/locale-ssr.test.mjs`
- **Related Lessons:** `failure-lessons/013-react-peer-dependency-and-ssr-hook-dispatcher.md`
- **Status:** Resolved
