# FL-054: AGENTS.md 24 KB Rule Truncation Cap & Scoped Rule Splitting

## Context
Maintaining the project's canonical agent constitution (`AGENTS.md`) and Antigravity rule injection pipeline across 50+ accumulated failure lessons.

## What happened
As new failure lessons (`FL-001` through `FL-050`) were appended to `AGENTS.md` with multi-sentence explanations, `AGENTS.md` grew to `37,445` bytes (`165` lines). During session startup, Antigravity's rule loader silently truncated `13,525` bytes from the end of `AGENTS.md` (`<truncated 13525 bytes>`), dropping sections 16–20, the Verification Checklist, and the Gate 0 Preflight invariants from the agent's initial context.

## Observable symptom
- System prompt `<RULE[.../AGENTS.md]>` ended with `<truncated 13525 bytes>` right inside section 15.
- Newly added rules at the bottom of `AGENTS.md` were invisible at session start unless the agent manually read `AGENTS.md`.

## Impact
- High-priority invariants (UI accessibility, stacked PR hygiene, SSR route gating, SQLite/worker concurrency, Gate 0 preflight) were silently excluded from agent context on every new session.

## Incorrect assumption
Assuming `AGENTS.md` can grow indefinitely and remain 100% loaded into every agent session's system prompt.

## Root cause
- **Confirmed**: Antigravity enforces an approximate 24 KB per-file budget when injecting `AGENTS.md` into `<user_rules>`. At `37,445` bytes, the tail `13,525` bytes were truncated.

## Why the architecture allowed it
Every new failure lesson appended verbose 3–5 line summaries directly into `AGENTS.md` instead of keeping `AGENTS.md` ultra-concise (1-line briefs) and offloading full technical details to `failure-lessons/*.md` or scoped `.agents/rules/*.md` files.

## Fix
1. **Concise 1-Line Invariants in `AGENTS.md`**: Condensed verbose rule descriptions in `AGENTS.md` into crisp 1-sentence actionable briefs with `[FL-NNN](./failure-lessons/...)` links, bringing `AGENTS.md` well below the 24 KB injection cap so zero bytes are truncated.
2. **Single Source of Deep Truth**: Preserved all technical details, root-cause proofs, and code references in `failure-lessons/*.md` and `failure-lessons/lessons-index.md`.

## Verification
Verified `wc -c AGENTS.md` is strictly `< 24,000` bytes and `python3 .agents/plugins/gate0-preflight/skills/session-learnings/scripts/extract_session_learnings.py audit` confirms all 54 failure lessons remain referenced in `AGENTS.md`.

## Prevention rule
Keep `AGENTS.md` strictly under `24,000` bytes (`< 24 KB`). Every rule in `AGENTS.md` MUST be a concise 1-sentence actionable brief linking to `failure-lessons/<topic>.md`, and any domain-heavy guidance exceeding the budget MUST be extracted into scoped `.agents/rules/*.md` files.

## Reusable lesson
Treat `AGENTS.md` as a fixed-budget hot cache (~24 KB): if it truncates, the newest rules silently vanish. Measure `wc -c AGENTS.md` whenever updating project rules.

## Related code
- `AGENTS.md`
- `failure-lessons/lessons-index.md`
- `.agents/rules/`

## Related tests
- `wc -c AGENTS.md` (`< 24000`)
- `python3 .agents/plugins/gate0-preflight/skills/session-learnings/scripts/extract_session_learnings.py audit`

## Status
Resolved
