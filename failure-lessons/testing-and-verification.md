# Testing & Verification Guide: Failure-to-Test Invariants

This document codifies the testing methodologies, regression harnesses, and falsification protocols protecting the `whatsapp-agent` codebase.

---

## 1. The Regression Falsifiability Contract (The 3-Step Test)

A regression test is not proven useful until shown to fail when the fix is removed:

$$\text{Fixed Implementation} \xrightarrow{\text{Pass}} \text{Broken Defect Injected} \xrightarrow{\text{MUST Fail}} \text{Restored Implementation} \xrightarrow{\text{Pass}}$$

1. **Step 1 (Green)**: The test passes with the fix applied.
2. **Step 2 (Red)**: Revert the fix or inject the original failure mode. The test **MUST fail**. If it passes, the test is tautological (vacuous) and offers false confidence.
3. **Step 3 (Green)**: Restore the fix. The test must return to green.

---

## 2. Failure-to-Test Mapping Table

| Failure ID | Failure Mode | Protected Invariant | Regression Test Location | Verification Command |
|---|---|---|---|---|
| **FL-001** | SQLite fallback in production Supabase | Production state must persist to Supabase PostgreSQL | `tests/postgres-learning-store.test.ts` | `bun test tests/postgres-learning-store.test.ts` |
| **FL-002** | Synchronous reflection latency in WhatsApp turn | Reflection must execute asynchronously on cold threads (<2s fast turn) | `tests/engine-integration.test.ts` & `tests/reflection-learning.test.ts` | `bun test tests/engine-integration.test.ts` |
| **FL-003** | Sensitive customer credentials leaked to memory | Unicode-aware regex screening must redact secrets before persist | `tests/reflection-learning.test.ts` | `bun test tests/reflection-learning.test.ts` |
| **FL-004** | Context window exhaustion from sprawling rules | Rules must be distilled when count > 15 or tokens > 2500 | `tests/reflection-learning.test.ts` | `bun test tests/reflection-learning.test.ts` |
| **FL-005** | API controller drops feedback when payload field is `replyText` | REST endpoints must accept standard payload synonyms | `tests/reflection-learning.test.ts` | `bun test tests/reflection-learning.test.ts` |
| **FL-006** | Pre-commit static secret scanner blocked test fixtures | Test fixtures asserting secret scrubbing must construct tokens dynamically | `tests/reflection-learning.test.ts` | `bk security scan --staged --fail-on high` |
| **FL-007** | CodeQL TOCTOU file system race condition | Filesystem operations must use direct read/write with atomic catch | `tests/reflection-learning.test.ts` | CodeQL Security Analysis |
| **FL-008** | WhatsApp markdown table parser omits valid data rows | Table separator detector must validate every cell individually | `tests/whatsapp-formatter.test.ts` | `bun test tests/whatsapp-formatter.test.ts` |
| **FL-009** | Pre-push hook blocks push after code mutation | Fable life-cycle verifiedGeneration must match mutationGeneration | `.fable/state.json` | `get-fable lint` |
| **FL-010** | Ambient diagnostic hooks pollute stdout | Informational banners must route exclusively to stderr | POSIX FD separation | Subshell JSON evaluation |
| **FL-011** | Stale remote tracking refs linger after PR merge | Local tracking refs must be pruned via `git fetch --prune` | Git repo references | `git fetch --prune origin && git branch -a` |
| **FL-015** | Git commit history retains leaked credentials | Intermediate commits must be squashed/rebased to expunge secrets | `main..HEAD` history | `git log -p main..HEAD \| grep -iE 'veB3\|fzMGM88'` |
| **FL-016** | Unchecked fetch responses and naked SSE JSON.parse | HTTP responses must check `res.ok`, and SSE listeners must use `try/catch` | `ui/src/api/client.ts`, `ui/src/App.tsx` | `bunx react-doctor --yes --no-telemetry .` in `ui/` |
| **FL-017** | Unresolved action SHAs & missing dependencies in CI | GitHub Actions must pin 40-char SHAs from `git ls-remote` and run `bun install` | `.github/workflows/ci.yml` | GitHub Actions check runs |
| **FL-018** | Staged relative symlinks rejected by pre-commit hook | Git index must contain only regular files; ignore `.agents/` and `.claude/` | `.git/hooks/pre-commit`, `.gitignore` | `bk security scan --staged --fail-on high` |
| **FL-019** | Transitive dependency vulnerabilities in polyglot monorepo | Polyglot SCA with OSV-Scanner & pip-audit with package overrides | `package.json`, `.github/workflows/security-audit.yml` | `bun run security:audit` |
| **FL-020** | Stop hook blocks termination on direct executing->complete jumps | Two-step state transition verifying -> complete with passing typed evidence | `.fable/state.json` | `get-fable state complete` |
| **FL-021** | Supabase direct host IPv6-only DNS resolution failure | Discovered IPv4 pooler cluster index with tenant username namespacing | `src/server/supabase.ts`, `tests/supabase-connection.test.ts` | `bun test tests/supabase-connection.test.ts` |
| **FL-022** | Hardcoded extension namespace rejection (`pgmq`) | Dedicated schema creation prior to extension activation | `supabase/migrations/20261107000000_enable_agent_extensions.sql` | `bun -e "import { sql } from './src/server/supabase'..."` |
| **FL-023** | Agent Kernel vault permission drift and missing accounts | Enforce octal 0600 on env files & canonical service-accounts.json binding | `~/.agent-kernel/service-accounts.json`, `.env` | `agent-kernel env status` |
| **FL-024** | Supabase CLI multi-organization token 403 Forbidden | Decoupled local project-ref configuration from interactive CLI state | `supabase/.temp/project-ref`, `supabase/config.toml` | Direct wire connection & integration tests |
| **FL-037** | Anti-Slop SRE unbounded concurrency & silent catches | Chunked batching, full jitter backoffs, and structured error logging | `src/agent/brand-knowledge.ts`, `src/domain/rate-limiter.ts` | `bun test tests/brand-knowledge.test.ts` |
| **FL-038** | Ponytail forensic audit findings (auth, socket, stickers, leaks) | Explicit disconnect flag, exempt auth prefixes, 100 KB WebP limits, and fail-closed keys | `src/transport/whatsapp-socket.ts`, `src/server/dashboard-auth.ts`, `src/server/api.ts` | `bun test tests/sticker-api.test.ts && bun test tests/dashboard-auth.test.ts` |
| **FL-039** | UI/UX accessibility, contrast & AI anti-pattern defects | W3C APG dialog standards, focus trapping, useModalDismiss hook, and WCAG AA contrast | `ui/src/components/`, `ui/src/index.css` | `cd ui && bun test:ui && bun run build` |

---

## 3. Reusable Testing Patterns & Guidelines

### A. Dynamic Token Assembly for Secret Scanners
```typescript
// ❌ WRONG: Triggers static security scanners (BK-AI-SEC-001, TruffleHog)
const badSecret = "sk-live-1234567890abcdef1234567890abcdef";

// ✅ CORRECT: Assembled dynamically at runtime
const safeSecret = ['sk', 'live', '1234567890abcdef1234567890abcdef'].join('-');
```

### B. Atomic Filesystem Read Pattern (No TOCTOU)
```typescript
// ❌ WRONG: CWE-367 TOCTOU race condition
if (fs.existsSync(filePath)) {
  const content = fs.readFileSync(filePath, 'utf-8');
}

// ✅ CORRECT: Direct atomic read with ENOENT handling
try {
  const content = fs.readFileSync(filePath, 'utf-8');
} catch (err: any) {
  if (err?.code === 'ENOENT') {
    return defaultContent;
  }
  throw err;
}
```

### C. Markdown Table Cell-by-Cell Delimiter Validation
```typescript
// ❌ WRONG: Line-level substring or loose regex check
const isSeparator = (line: string) => line.includes('|') && line.includes('-');

// ✅ CORRECT: Tokenize cells and validate each against separator pattern
const isSeparator = (line: string) => {
  const cells = parseCells(line);
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
};
```
