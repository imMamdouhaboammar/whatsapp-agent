# FL-033: Package Hoisting & Nested Test Runner Isolation in Skill Workspaces

- **Failure Class:** Monorepo Architecture / Test Runner Discovery Contamination
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (`.agents/skills/` directory isolation & test runner patterns)
- **Primary Source:** `package.json`, `bun test`, `.agents/skills/unslop-preflight/`
- **Quote:** `"skills/unslop-preflight/tests/integrity.test.js: 5 tests failed: 5 fail"` - `bun test` runner output

---

## 1. Context & Observable Symptoms
When installing the `unslop-preflight` skill into the workspace root (`skills/unslop-preflight/`), executing the project's primary test suite (`bun test`) resulted in foreign test execution and 5 unexpected failures:
```text
skills/unslop-preflight/tests/harness-gates.test.js:
skills/unslop-preflight/tests/integrity.test.js:
5 tests failed:
 5 fail
at /Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/skills/unslop-preflight/tests/workflowSecurity.test.js:26:10
```
While the WhatsApp Agent's native test suite had 142 passing tests, the foreign tests inside `skills/unslop-preflight/tests/` failed because they expected to run inside their own standalone package directory with specialized environment configurations.

## 2. Root Cause Analysis (Fact vs Hypothesis)
- **Recursive Monorepo Test Discovery:**
  By default, `bun test` recursively scans all directories starting from the working directory root for files matching `*.test.{js,ts,jsx,tsx}` or `*.spec.{js,ts,jsx,tsx}`.
- **Root-Level Subdirectory Placement:**
  Placing third-party skills in a visible root folder (`skills/`) exposed their internal unit and integration test fixtures to the parent project's test runner.
- **Missing Standalone Package Context:**
  The skill's internal tests relied on relative directory paths (`process.cwd() === skillRoot`), which evaluated to the parent project root when run by `bun test`, triggering path assertion failures.

## 3. Impact & Architectural Vulnerability
- **Impact:** Contaminated local test reporting, broke continuous integration pipelines, and created false-positive regressions that obscured the true pass/fail status of repository code.
- **Architectural Vulnerability:** Monorepos lacking strict test discovery scoping or directory quarantine conventions are vulnerable to foreign test pollution whenever auxiliary toolchains or skills are vendor-copied into the repository tree.

## 4. Smart Solution & Architectural Rectification
1. **Quarantine into Hidden Dot-Directories:**
   Moved the installed skill out of the visible root directory `skills/` into `.agents/skills/unslop-preflight/` and user-global config `~/.gemini/config/skills/unslop-preflight/`.
   Test runners (including `bun test`, `vitest`, and `jest`) ignore dot-prefixed directories (`.*/*`) by default during recursive test discovery.
2. **Deterministic CLI Execution:**
   Invocations of the skill CLI target the quarantined path explicitly:
   ```bash
   bun .agents/skills/unslop-preflight/bin/cli.js audit
   ```
3. **Pristine Test Runner Output:**
   Purging visible root skill test suites immediately restored pristine test results for the project.

## 5. Verification & Regression Falsification
- **Clean Suite Run:** Executed `bun test`. Test runner traversed only native test directories:
  ```text
  142 pass
  0 fail
  530 expect() calls across 38 files. [8.81s]
  ```
- **Skill Functionality Intact:** Running `bun .agents/skills/unslop-preflight/bin/cli.js audit` continued to function with 100/100 score and 0 scanner failures.

## 6. Prevention Invariant & Reusable Lessons
> **The Quarantined Tooling Invariant:**  
> External agent skills, testing harnesses, and auxiliary developer tooling containing internal test suites MUST NEVER be checked out into visible root directories (`skills/`, `tools/`). They must strictly reside in dot-prefixed paths (`.agents/skills/`, `.claude/skills/`, `.gemini/config/skills/`) or be installed as scoped node modules to prevent test runner discovery contamination.

## 7. Related Artifacts & Metadata
- **Related Code:** `.agents/skills/unslop-preflight/`, `package.json`
- **Related Tests:** `tests/` (142 unit & integration tests)
- **Related Lessons:** `failure-lessons/006-buck2-hermetic-genrule-path-isolation.md`, `failure-lessons/020-bug-killer-staged-symlink-security-gate.md`
- **Status:** Resolved
