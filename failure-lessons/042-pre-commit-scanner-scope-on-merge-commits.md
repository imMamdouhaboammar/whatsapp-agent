# FL-042: Pre-Commit Security Scanner Scope Inflation on Merge Commits

## Context
Reconciling long-lived feature branches (`perf/backend-optimization` `#104` and `feat/interactive-funnel-and-cockpit-modularization` `#106`) with `origin/main` after 56 files landed on `main`.

## What happened
After running `git merge origin/main` on `perf/backend-optimization` and resolving conflicts, `git commit` triggered the local Bug Killer (`bk`) pre-commit hook. Because `git diff --cached` on a merge commit compares `HEAD` against all incoming `MERGE_HEAD` changes, `bk` scanned all 56 `origin/main` files (including `Dockerfile` and unrelated modules) and blocked the commit with 6–10 pre-existing findings.

## Observable symptom
`[Bug Killer] Staged security gate failed. Review the findings before committing.` with findings (`BK-AI-DOS-001`, `BK-AI-DOS-007`, `BK-AI-INF-012`) outside the branch's actual changes, even though scanning the branch's 5 modified files directly reported 0 findings.

## Impact
Blocked legitimate merge commits locally, tempting agents to bypass hooks with `--no-verify`.

## Incorrect assumption
Assuming `git commit` on a merge commit only scans files edited by the current branch.

## Root cause
**Confirmed**: On a merge commit, `git diff --cached` includes every file modified between the branch's merge-base and `origin/main`. Pre-commit SAST hooks evaluate the entire staged diff.

## Why the architecture allowed it
The pre-commit hook evaluates `git diff --cached` uniformly for both normal commits and merge commits.

## Fix
Instead of bypassing the security gate (`--no-verify`), extracted the branch's net diff against `origin/main` (`git diff --binary origin/main > /tmp/branch.patch`), aborted the merge, reset the branch cleanly to `origin/main`, applied the patch, and committed. This scoped `git diff --cached` strictly to the branch's own changes, allowing `bk` to pass with 0 findings, followed by `git push --force-with-lease`.

## Verification
- `bk` pre-commit passed with `Findings detected: 0` on both `#104` (`ec7d4ed`) and `#106` (`bf43b53`).
- Both PRs passed all GitHub CI, CodeQL, Qlty, TruffleHog, and Security Audit checks.

## Prevention rule
- **Clean-Rebase Over Merge-Commit Gate Bypass**: Never pass `--no-verify` when a pre-commit scanner flags unrelated upstream files inside a merge commit. Re-apply the branch's net diff onto `origin/main` (`git diff --binary origin/main` + `reset --hard origin/main` + `apply`) so pre-commit gates audit strictly the branch's own delta.
