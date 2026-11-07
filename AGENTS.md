# AGENTS.md

## Repository Overview & Philosophy
You are an autonomous engineering agent working in the `whatsapp-agent` codebase. This project powers a production-grade WhatsApp conversational AI copilot and autonomous moderator with real-time SSE streaming, SQLite WAL persistence, multi-model fallback, and a React + Lobe UI cockpit.

## Engineering Mandates

### 1. Root Cause Mode
Whenever investigating any bug, regression, crash, layout shift, or unexpected behavior:
- **Diagnose Before Fixing**: Always identify the underlying root cause before proposing or writing code changes.
- **Reproduce First**: Formulate a falsifiable test or minimal reproduction that proves the failure.
- **Separate Symptoms From Cause**: Superficial symptom patching without diagnosing underlying reasons is strictly forbidden.
- **Smallest Root Fix**: Implement the cleanest, most surgical fix at the canonical boundary.
- **Verification Proof**: Prove the fix with regression test execution (`bun test` and `bun test:ui`) before marking the issue resolved.
- **Preserve Existing Behavior**: Do not break existing regression suites; all pre-existing tests must remain green.

### 2. Package Manager & Runtime Integrity
- **Bun is Mandatory**: Every JavaScript and TypeScript operation (installing packages, running scripts, running tests, local dev) must use Bun (`bun`, `bunx`, `bun test`). Never invoke `npm` or `yarn`.
- **Zero Credentials in Memory**: Never persist passwords, API keys, tokens, or OTPs. All memory additions must pass Unicode-aware fail-closed regex screening.
- **WhatsApp Network Boundary**: Enforce a strict limit of 100 KB (101,888 bytes) on all generated WebP stickers.
- **Fail-Closed Model Fallback**: Fail immediately on 401/403 authentication errors. Never switch models on auth failures.

### 3. Install Agent Harness & Tooling Inventory
When selecting tools and skills for this project, adhere strictly to the harness governance rules:
- **Bulk Install Guard**: Only install what this project actually needs right now. Do not bulk install every available skill, as unnecessary context overhead degrades reasoning.
- **Harness Priority Matrix**:
  - `unslop-preflight` (Priority: Required) — Used before and during frontend modifications to prevent AI slop, audit design tokens, and enforce accessibility. Skip when working exclusively on backend database migrations.
  - `lobe-icons` (Priority: Required) — Used for rendering official AI provider logos and model badges in UI components. Skip when editing CLI tools.
  - `lobe-ui` (Priority: Required) — Used for accessible UI primitives (AgentAvatar, Tag, Badge, Avatar, ActionIcon, ConfigProvider). Skip when writing server routes.
  - `test-guard` (Priority: Recommended) — Enforces TDD red-green verification loops.
  - `clean-code-guard` (Priority: Recommended) — Enforces DRY, KISS, and modular code hygiene.
- **Trust & Verification Steps**: Always perform a version check, dry run, and source code review before adopting external harnesses. Verify dependencies and ensure rollback paths exist.

### 4. React & Code Review Harness Recommendations
- **React Runtime Safety**: Wrap component trees with a resilient React Error Boundary (`react-error-boundary`) and `ConfigProvider` to safeguard against rendering exceptions and runtime boundary failures.
- **Code Review & Duplication**: Maintain clean architectural boundaries between `src/domain` (business logic), `src/server` (HTTP API), `src/ai` (Gemini moderator & fallback), and `ui/src` (React cockpit). Regularly execute duplication scan and review graph checks to prevent copy-pasting styling or schema definitions.

### 5. Anti-Slop Interface Standards
- **Intentional Iconography**: Never use decorative floating stars or magic wands as lazy signifiers for AI functionality. Use precise semantic icons (`Bot`, `Settings`, `Sliders`, `Zap`, `Image`).
- **Vector Assets Only**: Never use casual pictograms as structural UI controls. Always use official vector SVGs from `@lobehub/icons`, `@lobehub/ui/icons`, or `lucide-react`.
- **Accessible Modals**: Every modal or drawer must declare `role="dialog"`, `aria-modal="true"`, trap keyboard focus, bind dismiss to the Escape key, and enforce internal scrolling (`overflow-y-auto`) within `max-height: min(90dvh, 720px)`.

## Verification Checklist
- [x] Run backend test pyramid: `bun test` passes 100% with 0 failures.
- [x] Run UI SSR test suite: `cd ui && bun test:ui` passes 100% across bilingual assertions.
- [x] Run Vite build check: `cd ui && bun run build` builds cleanly with 0 TypeScript or bundler errors.
- [x] Run unslop-preflight audit: `bun .agents/skills/unslop-preflight/bin/cli.js audit` passes all governance gates.
- [x] Verify live server health: `curl -s http://localhost:3000/api/status` returns state `connected`.
