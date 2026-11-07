# FL-012: Meta Astryx & StyleX CSS Layer Isolation Alongside Tailwind v4 & RTL Cockpit

- **Failure Class:** Styling Architecture / Cascading Collisions
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (CSS `@layer` and Scoped Design System Tokens)
- **Primary Source:** `ui/src/main.tsx`, `ui/src/index.css`
- **Quote:** `"Confirm everything is wired up correctly without breaking existing styles."` - User Request

---

## 1. Problem Description & Symptoms
When introducing the Meta Astryx Design System (`@astryxdesign/core`, `@astryxdesign/theme-neutral`, `@stylexjs/stylex`) into an existing production WhatsApp AI cockpit that relies on Tailwind CSS v4 and custom brand tokens (`--wa-green`, `--wa-surface`, custom scrollbars, Arabic RTL bidirectional layouts), a major risk is cascading style clobbering. Unscoped CSS resets frequently reset `box-sizing`, margins, font declarations, and directionality, breaking pre-existing UI layouts and causing regression test failures.

## 2. Root Cause Analysis
- **Reset Invasiveness:** Standard third-party resets apply unlayered universal selectors (`* { margin: 0; padding: 0 }`) that overpower consumer design tokens.
- **Directional Blindness:** Many western design systems assume LTR as default, clobbering `dir="rtl"` layout adaptations for Arabic interfaces.
- **Specificity Escalation:** Attempting to override broken styles with `!important` or high-specificity class chains creates technical debt and breaks component swizzling.

## 3. Smart Solution & Architectural Rectification
1. **Leverage CSS `@layer` Hierarchy:**
   - Astryx natively defines `@layer reset, astryx-base, astryx-theme;` within `@astryxdesign/core/reset.css` and `@astryxdesign/core/astryx.css`.
   - In modern CSS Cascading rules, unlayered styles (our `ui/src/index.css` and Tailwind v4 utilities) automatically take precedence over all `@layer` declarations, completely eliminating specificity wars.
2. **Theme Scoping via `@scope`:**
   - Astryx neutral theme rules are encapsulated within `@scope ([data-astryx-theme="neutral"])`.
   - Wrapping the root application tree in `<Theme theme={neutralTheme}>` in `ui/src/main.tsx` applies theme attributes safely without leaking into unmanaged DOM portals.
3. **Preserve Native Cockpit Custom Properties:**
   - Kept all WhatsApp theme variables (`--wa-*`) and Arabic font-family stacks (`IBM Plex Sans Arabic`, `Noto Sans Arabic`) in `ui/src/index.css` intact.

## 4. Verification Proof
- `cd ui && bun test:ui`: 13/13 passing with Arabic RTL and English LTR controls intact.
- `cd ui && bun run build`: Zero CSS syntax or bundler errors, output bundle rendered cleanly in 803ms.
- `bun test`: All 162 backend and integration tests pass without regression.
