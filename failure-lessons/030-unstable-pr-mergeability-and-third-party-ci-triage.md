# FL-030: Unstable PR Mergeability Triage & Disconnected Third-Party Webhook Isolation

- **Failure Class:** Git Operations / PR Merge Triage
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** recipe (`gh pr merge`, `git worktree`)
- **Primary Source:** PR #9, GitHub API (`/statuses`, `/check-runs`)
- **Quote:** `"treat https://github.com/imMamdouhaboammar/whatsapp-agent/pull/9 untill it be mergeble and merge"` - User Request

---

## 1. Problem Description & Symptoms
When triaging Pull Request #9, GitHub reported "1/4 checks failing" with `mergeStateStatus: UNSTABLE`. The failing check was an external webhook from Vercel:
`Deployment has failed — run this Vercel CLI command: npx vercel inspect dpl_HYhzSnAjLAdeouH7sAtfsSLSYJNC --logs`.
Agents commonly get stuck attempting to repair third-party infrastructure configurations, or mistakenly report that the PR is blocked and cannot be merged.

## 2. Root Cause Analysis
- **`UNSTABLE` Semantic Meaning in GitHub API:** In GitHub Actions and the Pull Request API, `mergeStateStatus: "UNSTABLE"` simply indicates that at least one commit status check returned failure. It does *not* mean the branch has merge conflicts or that required branch protections are failing.
- **Disconnected Third-Party Webhooks:** An external Vercel project (`media-python` under scope `doha-team`) was linked to the repository with root directory pointed at `workers/media-python`. Because `workers/media-python` is an internal helper script without a Vercel Serverless Function entrypoint (`api/index.py`), Vercel deployments failed independently of repository health.
- **Unprotected Branch:** Querying `/branches/main/protection` returned `404 Branch not protected`, meaning Vercel was an advisory status, not a required merge gate.

## 3. Smart Solution & Architectural Rectification
1. **Differentiate Advisory Checks from Mandatory Branch Protections:**
   Inspect branch protection rules first:
   ```bash
   gh api repos/<owner>/<repo>/branches/main/protection
   ```
   If no protection rules require the failing check, assess whether the failure represents real application defect or external deployment noise.
2. **Execute Full Local Verification in Isolated Worktree:**
   Before merging an `UNSTABLE` PR, switch to the dedicated git worktree (`whatsapp-agent-pg-migration-20261106`) and execute the complete test pyramid:
   - `bun test` (154 tests passing).
   - `bun test tests/pg-migration.test.ts` (12 migration tests passing).
   - `cd ui && bun test:ui && bun run build` (13 SSR tests and Vite build passing).
3. **Execute Clean Merge:**
   Once local proof is green, merge cleanly:
   ```bash
   gh pr merge <pr_number> --merge
   ```
4. **Fast-Forward Synchronize Local Workspace:**
   Sync the main checkout using atomic stash and merge:
   ```bash
   git stash && git merge origin/main && git stash pop
   ```

## 4. Verification Proof
- Pull Request #9 merged cleanly with commit `eb175ee`.
- 154 backend tests, 12 database migration tests, and 13 UI tests passing on `main`.
