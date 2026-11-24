# FL-041: Stacked PR Integration & Upstream Ancestry Preservation

## Context
Integrating a 21-PR linear hardening stack (`#97–#103`, `#105`, `#107–#119`) from a contributor fork (`OpenReview-bot`) alongside independent feature and performance PRs (`#104`, `#106`) into `main`.

## What happened
1. Earlier PRs in the stack (`#97`, `#98`) failed `Typecheck and Lint (blocking)` due to an unused variable (`NEGATIVE_WINDOW_MS` in `tests/conversation-execution-integrity.test.ts`), which was already fixed in `#99`.
2. PR `#100` (`fix/77-78-reflection-isolation-persistence`) received a late commit (`dba75b2`, `atomicMirrorWrite` in `src/domain/learning-memory.ts`) after `#101–#119` had already branched off `7daa228`. As a result, `#100` passed CodeQL, while `#101–#119` all failed CodeQL on `src/domain/learning-memory.ts:208` (potential filesystem race condition).

## Observable symptom
- 21 open PRs stacked linearly; attempting to squash-merge `#97` or `#100` would rewrite commit SHAs and create cascading merge conflicts across `#101–#119`.
- `gh pr checks 119` showed all 12 CI/security gates passing except `CodeQL` (`src/domain/learning-memory.ts:208`).

## Impact
Blocking 21 PRs and 26 production-hardening issues (`#71–#96`) from landing cleanly on `main`.

## Incorrect assumption
Assuming stacked PRs must be squash-merged individually from bottom to top, or that a PR at the top of a stack (`#119`) automatically includes late commits pushed to an earlier PR (`#100`).

## Root cause
**Confirmed**:
1. Squash-merging any intermediate PR in a linear stack alters commit history and invalidates descendant branches.
2. Late fix commits on `#100` (`dba75b2`) were not propagated to `#101–#119`.

## Why the architecture allowed it
Multi-stage PR stacks branched sequentially without automated rebase/propagation when an earlier stage receives review-triage commits.

## Fix
1. Merged `#100` into `main` using `--merge` (preserving exact commit SHAs), which automatically resolved and marked `#97`, `#98`, `#99`, and `#100` as merged on GitHub.
2. Checked out `#119` (`gh pr checkout 119`), merged `origin/main` (bringing in `dba75b2` `atomicMirrorWrite`), resolved the single import conflict in `src/domain/learning-memory.ts`, verified all gates locally, pushed to the fork (`maintainerCanModify=true`), waited for CodeQL and CI to pass, and merged `#119` with `--merge`, automatically marking `#101–#119` as merged.
3. Rebased and merged independent PRs (`#104`, `#106`) *after* the hardening stack landed on `main`.

## Verification
- `gh pr list --state open`: 0 open PRs remaining.
- `gh issue close 70`: all 26 hardening issues (`#71–#96`) and controlling issue `#70` closed cleanly.
- `tsc --noEmit`, `oxlint`, `security:audit`, and `ui test:ui` (34/34) all passed on `main` (`fa5c5d4`).

## Prevention rule
- **Stacked PR Merge-Commit Invariant**: When integrating a linear stack of dependent PRs, never `--squash` intermediate PRs. Merge the clean base milestone (`--merge`), reconcile `origin/main` into the stack tip so late fixes propagate, verify all CI/CodeQL gates on the tip, and `--merge` the tip to preserve commit ancestry. Integrate independent feature/perf PRs only after the hardening stack lands.
