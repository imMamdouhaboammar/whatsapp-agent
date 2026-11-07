# FL-019: GitHub Actions Upstream SHA Resolution & Hermetic Runners

- **Failure Class:** CI/CD & Build Infrastructure
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check & Structure
- **Primary Source:** `.github/workflows/ci.yml`, `.github/workflows/openreview.yml`
- **Quote:** `"Unable to resolve action trufflesecurity/trufflehog@805395444... Action not found"` and `"Cannot find package 'hono'"` - GitHub Actions Runner Log

---

## 1. Problem Description & Symptoms
In Pull Request #10, the newly introduced OpenReview and CI workflows failed immediately:
1. GitHub Actions reported `Unable to resolve action` on pinned action SHAs (`trufflesecurity/trufflehog` and `sourcery-ai/action`).
2. The OpenReview automated test workflow crashed with `Cannot find package 'hono'` during unit test execution.
3. CI runners with `bun install --frozen-lockfile` failed because the lockfile had not been updated after dependency additions.

## 2. Root Cause Analysis
- **Speculative Action Hashes:** Pinning actions by copying truncated or hallucinated SHAs from older templates breaks GitHub Actions workflow validation. GitHub requires an exact 40-character commit SHA or an active tag/branch ref that actually exists in the remote repository.
- **Missing Dependency Step in Ephemeral VMs:** GitHub Actions runners start as clean, empty virtual machines. A job cannot execute test files importing packages (like `hono` or `@supabase/supabase-js`) without an explicit dependency installation step beforehand.
- **Frozen Lockfile Enforcement:** Modern package managers (`bun install --frozen-lockfile`) fail-closed if `package.json` contains dependencies that do not exactly match entries in `bun.lock`.

## 3. Smart Solution & Architectural Rectification
1. **Authoritative Upstream SHA Querying:**
   - Instead of guessing or copying hashes, query real commit SHAs directly from the upstream repository using `git ls-remote`:
     ```bash
     git ls-remote https://github.com/trufflesecurity/trufflehog refs/heads/main
     git ls-remote https://github.com/sourcery-ai/action refs/heads/main
     ```
   - Pinned exact verified SHAs: `trufflesecurity/trufflehog@f8221ca52ac51bf66228d6ec3691f3ea0782ae15` and `sourcery-ai/action@438ce67e9f15fbeacb72257da23e2fffb1b6d354`.
2. **Explicit Dependency Installation:**
   - Added `Run Bun Install` (`bun install`) prior to executing any tests or review scripts in `.github/workflows/openreview.yml`.
3. **Synchronized Lockfile Regeneration:**
   - Ran `bun install` locally and committed the generated `bun.lock` alongside dependency additions to guarantee zero lockfile mismatch.

## 4. Verification Proof
- `OpenReview Autonomous Review` action run `42407680627` completed with status `COMPLETED` and conclusion `SUCCESS` in 8 seconds.
- `CI & Quality Gate` action run `42407680662` completed with all 3 jobs (`Run Unit, Integration & UI Quality Gates`, `TruffleHog Secret Scanning`, `Qlty Code Quality Gate`) passing with `conclusion: SUCCESS`.
