# AGENTS.md

## Repository Overview & Philosophy
Autonomous engineering agent constitution for `whatsapp-agent`: a production WhatsApp conversational AI copilot with SSE streaming, Supabase PostgreSQL persistence (with local SQLite cache), multi-model fallback, and a React + Lobe UI cockpit. Keep `AGENTS.md` strictly `< 24 KB` ([FL-054](./failure-lessons/054-agents-md-rule-truncation-and-scoped-splitting.md))—use 1-sentence briefs here and full post-mortems in [`failure-lessons/`](./failure-lessons/README.md).

## Engineering Mandates

### 1. Root Cause Mode
- Diagnose underlying root causes and write a falsifiable reproduction before fixing; never patch symptoms superficially.
- Apply the smallest canonical fix, preserve existing regression suites, and prove with `bun test` and `cd ui && bun test:ui`.

### 2. Package Manager & Runtime Integrity
- **Bun Mandatory**: Use `bun`, `bunx`, and `bun test` for all JS/TS work; never invoke `npm` or `yarn`.
- **Zero Credentials & Dynamic Fixtures**: Never persist secrets/OTPs; construct dummy secrets dynamically in tests (`['sk', 'live', ...].join('-')`) to satisfy `BK-AI-SEC-001` ([FL-015](./failure-lessons/015-static-secret-scanner-test-fixtures.md)).
- **Fail-Closed Model Fallback**: Fail immediately on 401/403 auth errors; never switch models on auth failures.

### 3. Harness & Tooling Governance
- Only install required skills; prioritize `unslop-preflight`, `lobe-icons`, `lobe-ui` for UI work and `test-guard`, `clean-code-guard` for quality.
- **Vendored Skills Priority**: Invoke locally vendored skills in `.agents/plugins/gate0-preflight/` and `.agents/skills/` directly rather than speculative `npx skills use` network downloads ([FL-045](./failure-lessons/045-isomorphic-ssr-route-gating-and-public-funnel-isolation.md)).

### 4. React, UI & Anti-Slop Standards
- Wrap React trees with `react-error-boundary` and `<ConfigProvider motion={motion}>` / `<MotionProvider motion={motion}>` ([FL-032](./failure-lessons/032-runtime-motion-provider-boundary.md)).
- **Permissive Inbound Controller**: Accept both `editedText` and `replyText` on human-revision REST endpoints ([FL-005](./failure-lessons/005-api-controller-payload-desynchronization.md)).
- **Intentional Vector UI & Accessible Modals**: Use `@lobehub/icons`, `@lobehub/ui/icons`, or `lucide-react` (no decorative stars/magic wands); modals must declare `role="dialog"`, `aria-modal="true"`, focus trap, Escape dismiss, and `overflow-y-auto` within `max-height: min(90dvh, 720px)`.
- **Impeccable UI/UX & Accessibility**: Use flat unboxed pill rows (no nested cards), text `>= 11px` (`>= 12px` body), WCAG AA contrast `>= 4.5:1`, composite-only animations (no layout-property transitions), `overflow: clip` on shells, and light `color-scheme` grounding ([FL-039](./failure-lessons/039-impeccable-ui-ux-design-quality-and-accessibility-remediation.md)).
- **Zero-Unused-Locals (TS6133)**: Verify UI refactors with `cd ui && bun run build` ([FL-035](./failure-lessons/035-strict-unused-identifier-build-enforcement.md)).

### 5. Memory, Reflection & Serialization
- **Supabase Production Memory**: Persist long-term learning states to Supabase PostgreSQL (`wa_agent.learning_states`), never SQLite fallbacks ([FL-001](./failure-lessons/001-supabase-postgresql-memory-tier.md)).
- **Offline Reflection Decoupling**: Run `ReflectionWorker` offline on cold threads (15m) or moderation actions so inbound replies stay `< 2s` ([FL-002](./failure-lessons/002-offline-reflection-latency-decoupling.md)).
- **Fail-Closed Credential Screening & Distillation**: Pass memory additions through `scrubCredentials` ([FL-003](./failure-lessons/003-fail-closed-credential-sanitization.md)); auto-distill `workbook.md` above 15 rules / 2500 tokens ([FL-004](./failure-lessons/004-context-protection-and-rule-distillation.md)).
- **Reflection Isolation & Serialized Turn/Send Fencing**: Serialize turns, burst drains, and sends via `ExecutionQueue`, `InboundJobLedger`, and `SendLedger`, scoping reflection strictly by trusted contact ([FL-051](./failure-lessons/051-reflection-isolation-and-serialized-execution.md)).

### 6. Security, SAST & DevSecOps
- **Regex Class Hygiene (CWE-20) & Table Parsing**: Escape hyphens in character classes (`[\s:|\-]`); validate markdown table separators cell-by-cell (`/^:?-+:?$/`) without useless escapes ([FL-007](./failure-lessons/007-codeql-regex-range-ascii-collision.md), [FL-016](./failure-lessons/016-markdown-table-parsing-and-regex-escapes.md)).
- **Atomic File Access (No TOCTOU, CWE-367)**: Omit `existsSync` before read/write; handle `ENOENT` in `try/catch` ([FL-008](./failure-lessons/008-file-system-race-condition-toctou.md)).
- **Git History Secret Cleanliness**: Squash/rebase leaked secrets out of branch history (`main..HEAD`) and fail-closed on empty fallbacks ([FL-018](./failure-lessons/018-git-history-secret-scanner-remediation.md)).
- **Polyglot SCA (`osv-scanner` / `pip-audit`)**: Run `bun run security:audit` (fail on CVSS `>= 7.0`) and patch transitive advisories via `package.json` `"overrides"` ([FL-021](./failure-lessons/021-polyglot-dependency-vulnerability-scanning-and-transitive-overrides.md)).

### 7. Monorepo, Build & Design System Coexistence
- **Buck2 Hermeticity**: Resolve repo root via `${PWD%%/buck-out/*}`, capture `$TARGET_OUT` before `cd`, use `prelude = bundled`, and ignore `.git`, `node_modules`, `ui/node_modules`, `data`, `.venv` ([FL-006](./failure-lessons/006-buck2-hermetic-genrule-path-isolation.md)).
- **Astryx / StyleX Coexistence**: Adopt infra before consumers ([FL-014](./failure-lessons/014-scope-discipline-and-incremental-ui-adoption.md)), load resets inside `@layer`/`@scope` ([FL-012](./failure-lessons/012-meta-astryx-stylex-layer-coexistence.md)), and run all UI commands inside `ui/` to prevent dual React instances ([FL-013](./failure-lessons/013-react-peer-dependency-and-ssr-hook-dispatcher.md)).
- **SSR Route Gating, Funnel Isolation & Bundle Budget**: Resolve paths isomorphically in `OwnerAccessGate` (`currentPath`, child `initialPath`, `window.location.pathname`), unmount `DashboardCockpit` on `/start` and `/lp/*` ([FL-045](./failure-lessons/045-isomorphic-ssr-route-gating-and-public-funnel-isolation.md)), allow synchronous SSR bypass for `React.lazy` in tests ([FL-046](./failure-lessons/046-react-ssr-headless-runner-code-splitting.md)), and keep `@lobehub/*`/`@shikijs` out of root providers (`< 80 kB` marketing bundle) ([FL-047](./failure-lessons/047-transitive-provider-hoisting-and-bundle-isolation.md)).

### 8. Database, Performance & Operational Resilience
- **Supabase Pooler, Extensions & Vault**: Use regional Supavisor pooler (`aws-[0-3]-[region].pooler.supabase.com`) with `postgres.<ref>` ([FL-025](./failure-lessons/025-supabase-ipv6-routing-and-pooler-discovery.md)), create matching schemas for extensions like `pgmq` ([FL-027](./failure-lessons/027-postgresql-extension-schema-namespace-isolation.md)), enforce `0600` on `.env` with `~/.agent-kernel/service-accounts.json` ([FL-029](./failure-lessons/029-agent-kernel-vault-service-account-binding.md)), and declare `supabase/.temp/project-ref` locally ([FL-031](./failure-lessons/031-supabase-cli-multi-org-token-scope-collision.md)).
- **SQLite, Atomic Ingest & Worker Bounds**: Keep `PRAGMA foreign_keys = OFF;` for orphan-repair tests ([FL-048](./failure-lessons/048-sqlite-foreign-keys-and-orphan-test-invariants.md)), batch turn dossier mutations into one `updateDossierExtracts` transaction ([FL-049](./failure-lessons/049-turn-extraction-batching-and-atomic-dossier-persistence.md)), use $O(1)$ bounded Map eviction (`keys().next().value`), and bound external workers (`<= 2` concurrency, `<= 30s`, `<= 20 MB`) ([FL-050](./failure-lessons/050-linear-eviction-complexity-and-worker-isolation.md)).
- **Transport, Lifecycle, UI Fencing & SRE**:
  - Mark disconnects `isExplicitlyClosed = true` and clear `reconnectTimer` with full jitter; exempt `/api/auth/`, `/api/webhooks/`, `/api/funnel/`, `/api/brands/`, `/api/agent/`; cap WebP stickers at `100 KB` (`101,888` bytes); buffer LLM HTTP text before JSON parse; fail closed on audio transcode, unconfigured registries, and empty `catch` blocks; bound batch size (`10`), catalog queries (`LIMIT 500`), and JSON parse with `safeJsonParse` ([FL-037](./failure-lessons/037-anti-slop-sre-remediation-and-concurrency-bounding.md), [FL-038](./failure-lessons/038-ponytail-audit-remediation-and-lifecycle-integrity.md)).
  - Coalesce concurrent shutdowns and propagate teardown exit codes; check serving channel in `/ready`; fail `doctor` on write-probe or key errors; bound SSE subscribers/pending writes; pin Bun 1.4 with `--frozen-lockfile` and non-root Docker runtime ([FL-052](./failure-lessons/052-process-lifecycle-readiness-and-container-determinism.md)).
  - Fence async chat fetches via `ChatRequestCoordinator`, gate features via explicit `capabilities`, and preserve last-known-good state in `DashboardSync` ([FL-053](./failure-lessons/053-stale-async-ui-fencing-and-explicit-capabilities.md), [FL-017](./failure-lessons/017-react-doctor-transport-and-sse-resilience.md)).

### 9. Lifecycle, Git, CI & Governance
- **Fable & Hook Streams**: Sync `verifiedGeneration === mutationGeneration` (`get-fable evidence pass`) ([FL-009](./failure-lessons/009-fable-mutation-evidence-synchronization.md)) via `verifying` -> `complete` ([FL-022](./failure-lessons/022-stop-hook-lifecycle-fencing-and-two-step-verification.md)); send hook banners to `stderr` only ([FL-010](./failure-lessons/010-ambient-hook-stdout-pollution.md)).
- **Clean Root & Quarantine**: Maintain only `AGENTS.md` (no multi-platform config sprawl) ([FL-040](./failure-lessons/040-root-ai-slop-config-bloat-and-platform-sprawl.md)), quarantine external skills in dot-prefixed dirs ([FL-033](./failure-lessons/033-nested-skill-package-test-hoisting.md)), use domain-positive lint prose ([FL-034](./failure-lessons/034-anti-slop-regex-keyword-inversion.md)), and never commit symlinks (`bk` gate) ([FL-020](./failure-lessons/020-bug-killer-staged-symlink-security-gate.md)).
- **Git & PR Hygiene**: Use `git fetch --prune origin` after merges ([FL-011](./failure-lessons/011-git-remote-tracking-ref-pruning.md)); `--merge` stacked PRs and reconcile `origin/main` into tip ([FL-041](./failure-lessons/041-stacked-pr-integration-and-ancestry-preservation.md)); rebase net diff instead of `--no-verify` ([FL-042](./failure-lessons/042-pre-commit-scanner-scope-on-merge-commits.md)); diagnose `.env` pooler contention before code edits and root-anchor `/data/` in `.gitignore` ([FL-043](./failure-lessons/043-local-env-pooler-exhaustion-and-gitignore-hygiene.md)); port `main` logic into extracted components and use `crypto.randomUUID()` ([FL-044](./failure-lessons/044-cockpit-modularization-reconciliation-and-crypto-randomness.md)).
- **CI Gates**: Pin GitHub Actions to 40-char SHAs (`git ls-remote`) ([FL-019](./failure-lessons/019-github-action-sha-pinning-and-ci-isolation.md)), keep `ubuntu-latest` fallback for `runner-up` ([FL-036](./failure-lessons/036-self-hosted-runner-up-and-ephemeral-runner-dispatch.md)), use `fetch-depth: 0` with empty `base` on TruffleHog push ([FL-023](./failure-lessons/023-trufflehog-base-head-collision-and-shallow-clone-pitfalls.md)), run `qlty --no-formatters` ([FL-024](./failure-lessons/024-qlty-interactive-formatting-and-scanner-exclusion-discipline.md)), guard `sourcery-ai/action` with `continue-on-error: true` ([FL-026](./failure-lessons/026-sourcery-mandatory-ci-tokens-and-multi-client-mcp-headers.md)), emit Bun LCOV for SonarQube ([FL-028](./failure-lessons/028-sonarqube-lcov-coverage-coupling-and-multi-branch-triggers.md)), and verify mergeable PRs locally when optional webhooks fail ([FL-030](./failure-lessons/030-unstable-pr-mergeability-and-third-party-ci-triage.md)).
- **Full Failure Lessons**: [`failure-lessons/`](./failure-lessons/README.md) | [`docs/session-learnings/AGENTS.md`](./docs/session-learnings/AGENTS.md)

## Verification Checklist
- [x] `bun test` (backend test pyramid)
- [x] `cd ui && bun test:ui` (UI SSR suite)
- [x] `cd ui && bun run build` (Vite + TypeScript)
- [x] `buck2 build //...` (Buck2 monorepo)
- [x] `bun run security:audit` & `uvx pip-audit -r workers/media-python/requirements.txt`
- [x] `bun .agents/skills/unslop-preflight/bin/cli.js audit` & `bunx impeccable detect ui/src/`

<!-- gate0-preflight:start -->
## Gate 0 Preflight & Engineering Invariants
1. **GitHub-First Remote Diff (GitHub >> Local >> GitHub)**: Run `git fetch && git diff HEAD..@{u} -- <file>` and `git pull --rebase` before blind edits. Details in `Failure-lessons/remote-diff-guard.md`.
2. **Deterministic PreToolUse & Budget Placement**: Enforce `decision: deny` hooks and keep `AGENTS.md` `< 24 KB` ([FL-054](./failure-lessons/054-agents-md-rule-truncation-and-scoped-splitting.md)). Details in `Failure-lessons/passive-hook-weakness.md`.
3. **Autonomous Capability Routing**: Infer domain and invoke native MCPs/skills without waiting for `@mentions`. Details in `Failure-lessons/autonomous-routing-discipline.md`.
4. **Non-Interactive Automation**: Always pass `--yes`, `-f`, `git branch -D`, or `input=''` in unattended scripts. Details in `Failure-lessons/interactive-script-background-hang.md`.
<!-- gate0-preflight:end -->
