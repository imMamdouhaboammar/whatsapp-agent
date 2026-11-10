# Failure Lessons & Engineering Memory

> **The Core Invariant:**
> *"Pay for an engineering mistake once. After that, the project should remember it."*

This directory preserves battle-tested engineering lessons, root cause analyses, and architectural invariants derived from real session incidents, user corrections, and failure discoveries in `whatsapp-agent`.

## Index of Lessons
- [lessons-index.md](lessons-index.md) - Full catalog of failure records, truth states, and enforced rules.
- [testing-and-verification.md](testing-and-verification.md) - Regression test mappings, oracle proofs, and falsification protocols.
- [001-supabase-postgresql-memory-tier.md](001-supabase-postgresql-memory-tier.md) - Supabase PostgreSQL vs. Local SQLite persistence in production SaaS.
- [002-offline-reflection-latency-decoupling.md](002-offline-reflection-latency-decoupling.md) - Decoupling slow high-reasoning reflection loops from online WhatsApp socket turns.
- [003-fail-closed-credential-sanitization.md](003-fail-closed-credential-sanitization.md) - Unicode-aware fail-closed regex screening for long-term memory.
- [004-context-protection-and-rule-distillation.md](004-context-protection-and-rule-distillation.md) - Preventing context window exhaustion via dynamic rule compaction.
- [005-api-controller-payload-desynchronization.md](005-api-controller-payload-desynchronization.md) - Payload alias normalization in REST controllers.
- [006-buck2-hermetic-genrule-path-isolation.md](006-buck2-hermetic-genrule-path-isolation.md) - Buck2 hermetic genrule path isolation and macro collisions.
- [007-codeql-regex-range-ascii-collision.md](007-codeql-regex-range-ascii-collision.md) - CodeQL regex range ASCII collision (CWE-20).
- [008-file-system-race-condition-toctou.md](008-file-system-race-condition-toctou.md) - Elimination of file system race conditions (TOCTOU, CWE-367).
- [009-fable-mutation-evidence-synchronization.md](009-fable-mutation-evidence-synchronization.md) - Life-cycle state synchronization before git push.
- [010-ambient-hook-stdout-pollution.md](010-ambient-hook-stdout-pollution.md) - Stream separation: routing informational banners to stderr.
- [011-git-remote-tracking-ref-pruning.md](011-git-remote-tracking-ref-pruning.md) - Post-merge remote tracking ref pruning and clean tree transitions.
- [012-meta-astryx-stylex-layer-coexistence.md](012-meta-astryx-stylex-layer-coexistence.md) - Meta Astryx & StyleX CSS layer isolation alongside Tailwind v4.
- [013-react-peer-dependency-and-ssr-hook-dispatcher.md](013-react-peer-dependency-and-ssr-hook-dispatcher.md) - React 19 peer dependencies and SSR hook dispatchers.
- [014-scope-discipline-and-incremental-ui-adoption.md](014-scope-discipline-and-incremental-ui-adoption.md) - Scope discipline and incremental UI component adoption.
- [015-git-history-secret-scanner-remediation.md](015-git-history-secret-scanner-remediation.md) - Git branch history secret scanning & interactive rebase remediation.
- [016-react-doctor-transport-and-sse-resilience.md](016-react-doctor-transport-and-sse-resilience.md) - React Doctor transport hardening & resilient SSE stream parsing.
- [017-github-action-sha-pinning-and-ci-isolation.md](017-github-action-sha-pinning-and-ci-isolation.md) - Authoritative GitHub Action SHA pinning & hermetic runner environments.
- [018-bug-killer-staged-symlink-security-gate.md](018-bug-killer-staged-symlink-security-gate.md) - Bug Killer staged Git index symlink prevention.
- [019-polyglot-dependency-vulnerability-scanning-and-transitive-overrides.md](019-polyglot-dependency-vulnerability-scanning-and-transitive-overrides.md) - Polyglot dependency vulnerability scanning & transitive overrides.
- [020-stop-hook-lifecycle-fencing-and-two-step-verification.md](020-stop-hook-lifecycle-fencing-and-two-step-verification.md) - Stop-hook lifecycle fencing & two-step verification transitions.
- [021-supabase-ipv6-routing-and-pooler-discovery.md](021-supabase-ipv6-routing-and-pooler-discovery.md) - Supabase IPv6-only direct host vs. IPv4 Supavisor pooler cluster discovery.
- [022-postgresql-extension-schema-namespace-isolation.md](022-postgresql-extension-schema-namespace-isolation.md) - PostgreSQL extension schema namespace isolation (the `pgmq` schema invariant).
- [023-agent-kernel-vault-service-account-binding.md](023-agent-kernel-vault-service-account-binding.md) - Agent Kernel vault service account binding & permission drift hygiene.
- [024-supabase-cli-multi-org-token-scope-collision.md](024-supabase-cli-multi-org-token-scope-collision.md) - Supabase CLI multi-organization token scope collision.
- [037-anti-slop-sre-remediation-and-concurrency-bounding.md](037-anti-slop-sre-remediation-and-concurrency-bounding.md) - Anti-slop SRE remediation, unbounded concurrency bounding, and error telemetry.
- [038-ponytail-audit-remediation-and-lifecycle-integrity.md](038-ponytail-audit-remediation-and-lifecycle-integrity.md) - Ponytail forensic audit remediation, transport lifecycle & fail-closed guardrails.
- [039-impeccable-ui-ux-design-quality-and-accessibility-remediation.md](039-impeccable-ui-ux-design-quality-and-accessibility-remediation.md) - Impeccable UI/UX quality remediation, anti-slop elimination & accessibility invariants.
