# FL-020: Bug Killer Staged Git Index Symlink Prevention

- **Failure Class:** AppSec / Pre-Commit Gate & Index Integrity
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check & Structure
- **Primary Source:** `.git/hooks/pre-commit`, `.gitignore`, Bug Killer (`bk`)
- **Quote:** `"Changed non-regular Git index entry requires review: .claude/skills/supabase"` - Bug Killer Pre-Commit Hook

---

## 1. Problem Description & Symptoms
When attempting to commit changes after running `npx skills add <skill>`, the Bug Killer pre-commit security gate (`bk security scan --staged --fail-on high`) halted the commit with a fatal index security error, reporting that a non-regular Git index entry was staged.

## 2. Root Cause Analysis
- **Symlink Creation by Skill Installers:** Package and skill managers (such as `npx skills add` or Claude Code plugins) frequently create relative filesystem symbolic links (`.claude/skills/foo -> ../../skills/foo`) to avoid duplicating file trees.
- **Directory Traversal & Path Escape Risks:** Staging symbolic links into a Git repository introduces security vulnerabilities (e.g., path traversal, symlink spoofing, arbitrary host file overwrites upon checkout on other operating systems).
- **Strict Staged Index Assessment:** Bug Killer's `--staged` mode inspects the actual Git index tree (`git ls-files -s`). It enforces a strict invariant that all staged entries must be regular files or directories, rejecting POSIX symlink mode `120000`.

## 3. Smart Solution & Architectural Rectification
1. **Deduplicate to Real Directories:**
   - Instead of staging relative symlinks, convert skills into concrete directories with their own canonical `SKILL.md` files.
2. **Safeguard Local Agent Caches in `.gitignore`:**
   - Add `.agents/` and `.claude/` local runtime directories to `.gitignore` so temporary host-level symlinks and state caches are never staged into the repository index.
3. **Hermetic Staged Scan:**
   - Running `bk security scan --staged --profile quick --fail-on high` evaluates only genuine regular files and passes cleanly with 0 findings.

## 4. Verification Proof
- `bk security scan --profile quick --staged --fail-on high` executed on all staged files and returned:
  ```text
  🛡️ Bug Killer Security Guard Scan Report
     Files assessed: 270
     Rules evaluated: 330 | Applicable: 329 | Unsupported: 0
     Findings detected: 0
  ```
- All subsequent pre-commit hooks passed without manual bypass flags.
