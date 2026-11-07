# FL-011: Git Remote Tracking Ref Pruning & Clean Tree Branch Transitions

- **Failure Class:** Git / Version Control Synchronization
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Recipe (`git checkout <dirty-file>`, `git fetch --prune origin`)
- **Primary Source:** Git working tree & remote branch tracking refs
- **Quote:** `failed to run git: error: Your local changes to the following files would be overwritten by checkout: .fable/state.json. Please commit your changes or stash them before you switch branches.` - command

---

## 1. Context
Completing a feature lifecycle: merging PR #11 into `main`, deleting the feature branch remotely, returning the local working tree to `main`, and cleaning up ephemeral git branches and worktrees.

## 2. What Happened
1. When running `gh pr merge 11 --squash --delete-branch`, GitHub successfully squashed and merged the pull request and deleted the branch on `origin`.
2. However, the CLI tool attempted to switch the local checkout to `main`, but failed because `.fable/state.json` had unstaged local changes.
3. Even after deleting the local branch (`git branch -D feat/...`), `remotes/origin/feat/...` remained in the local git repository list (`git branch -a`) because Git does not automatically prune deleted remote tracking references during normal fetch/pull operations.

## 3. Observable Symptom
- `failed to run git: error: Your local changes to the following files would be overwritten by checkout`
- `git branch -a` listed `remotes/origin/feat/buck2-astryx-ui-hardening` as still active long after the remote branch had been deleted on GitHub.

## 4. Impact
Confusing branch states, lingering stale branches that look active, and blocked automation scripts that assume branch checkout succeeds automatically after PR merge.

## 5. Incorrect Assumption
Assumed that deleting a branch on GitHub via `gh pr merge --delete-branch` automatically cleans up local tracking branches (`refs/remotes/origin/*`) in the local git database.

## 6. Root Cause
**Confirmed**: Git maintains an independent local cache of remote tracking refs. A remote deletion does not delete local remote-tracking refs unless explicitly invoked with `--prune` (`git fetch --prune origin`). Furthermore, any uncommitted dirty file in the working directory blocks `git checkout`.

## 7. Why the Architecture Allowed It
Git's distributed architecture intentionally isolates local tracking states from remote server mutations until an explicit pruning synchronization occurs.

## 8. Fix
1. Discarded or stashed temporary local modifications:
   ```bash
   git checkout .fable/state.json
   ```
2. Switched cleanly to the default branch and pulled:
   ```bash
   git checkout main && git pull origin main
   ```
3. Deleted the local feature branch:
   ```bash
   git branch -D feat/buck2-astryx-ui-hardening
   ```
4. Pruned stale remote tracking references:
   ```bash
   git fetch --prune origin
   ```

## 9. Verification
- `git branch -a` outputs only `* main` and `remotes/origin/main`.
- `git status` confirms `nothing to commit, working tree clean`.

## 10. Prevention Rule
After remote PR merges, always ensure the local working tree is clean before switching branches, and execute `git fetch --prune origin` to purge deleted remote-tracking references.

## 11. Reusable Lesson
Never assume `git pull` or `gh pr merge` cleans up your local git cache. Always pair branch cleanup with `git fetch --prune`.

## 12. Related Code
- Git workflow scripts & GitHub Actions

## 13. Related Tests
- Quality Gate & Push Policy

## 14. Related Lessons
- [009-fable-mutation-evidence-synchronization.md](009-fable-mutation-evidence-synchronization.md)

## 15. Status
**Resolved**
