# FL-018: Git Branch History Secret Scanning & Interactive Rebase Remediation

- **Failure Class:** AppSec / Secret Scanner & VCS Integrity
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure & Git Push Policy
- **Primary Source:** `src/server/supabase.ts`, `ui/src/utils/supabase.ts`, GitHub PR #10
- **Quote:** `"1 secret were uncovered from the scan of 6 commits in your pull request. ❌ Secret: PostgreSQL Credentials Commit: d7fc9a63e6719f4b903af5e51925b6ac78e191c4 Filename: src/server/supabase.ts"` - GitGuardian Bot

---

## 1. Problem Description & Symptoms
In Pull Request #10, GitGuardian Security Checks failed on an unmerged feature branch (`feat/react-doctor-security-openreview`). Even after commit `94981ff` removed the hardcoded credentials and replaced them with fail-closed environment variables in the working tree, GitGuardian and GitHub Advanced Security continued to report a critical failure on the pull request.

## 2. Root Cause Analysis
- **Full History Range Scanning:** External security scanners (GitGuardian, TruffleHog, GitHub Secret Scanning) do not merely evaluate the tree at the branch HEAD. They analyze every individual commit in the PR revision range (`main..HEAD`).
- **Intermediate Leaks Survive in Git History:** Committing a secret in commit A and removing it in commit B leaves the plaintext credential accessible in commit A's git object database (`.git/objects/`). To security bots and auditors, the secret remains exposed and exploitable in the repository history.
- **Flawed "Fix-Forward" Reflex:** AI agents often attempt to patch secrets by making additional commits, which satisfies local linters but perpetually fails commit-history scanners.

## 3. Smart Solution & Architectural Rectification
1. **Interactive Rebase / Squash Remediation:**
   - On unmerged branches, rewrite history using `git reset --soft <base>` or `git rebase -i` to amalgamate intermediate commits into clean atomic commits where the secret was never introduced.
   - Force push the sanitized branch (`git push --force-with-lease origin <branch>`).
2. **Fail-Closed Secret Variable Invariant:**
   - In both backend server code and frontend client code, never provide credential-bearing default strings (e.g. `const url = process.env.URL || 'postgresql://...'`).
   - Default all secret variables to empty strings and enforce explicit runtime checks (`if (!url || !key) throw new Error(...)`).
3. **Automated Re-Scan:**
   - Once squashed and force-pushed, GitGuardian immediately re-scanned all 3 commits in the PR range, found 0 secrets, and automatically flipped its status to `SUCCESS`.

## 4. Verification Proof
- GitGuardian check run `128508811115` completed with `conclusion: SUCCESS`.
- `git log -p main..HEAD | grep -iE 'veB3|fzMGM88|fqnuoomndmjdoqqkeugd'` returned exit code 1 (zero matching secret strings across the entire commit range).
