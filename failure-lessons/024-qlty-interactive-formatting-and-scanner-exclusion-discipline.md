# FL-024: Qlty Interactive Formatting Deadlock & Scanner Exclusion Discipline

- **Failure Class:** Tooling / Autonomous Agent Terminal Deadlock & Scanner Bloat
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** structure ([.qlty/qlty.toml](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/.qlty/qlty.toml), [package.json](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/package.json))
- **Primary Source:** `.qlty/qlty.toml`, `package.json`, `~/.qlty/bin/qlty`
- **Quote:** `UNFORMATTED FILES: 1 \n ? Format these files? [Yes/no] ›` - Qlty CLI interactive prompt blocking headless execution

---

## 1. Problem Description & Symptoms
1. **Headless Subprocess Hang:** Running `qlty check` in automated agent turns or CI environments causes processes to freeze indefinitely when unformatted files exist. The CLI displays an interactive prompt (`? Format these files? [Yes/no] ›`) waiting on stdin, causing background task timeouts.
2. **Scanner Bloat & Heavy Runtime Installation:** Running `qlty init` without project-specific exclusions causes Qlty to scan external agent skills (`.agents/skills/`), test fixture directories, and third-party tools. It triggers multi-minute downloads of Java 25 (for `radarlint-python`), Python 3.11, and emits 37+ false positive linter issues on files that are not part of core application code.

## 2. Root Cause Analysis
- **Interactive Formatter Default:** By default, Qlty couples linting and formatting into the `check` command. In a non-interactive shell without `--no-formatters`, it prompts the operator interactively.
- **Unbounded Initial Discovery:** `qlty init` inspects all files reachable from the repository root, failing to differentiate maintainer/agent metadata directories (`.agents/`, `.claude/`, `.unslop/`) from actual source files (`src/`, `ui/src/`).

## 3. Smart Solution & Architectural Rectification
1. **Decouple Linting from Formatting in Tooling & CI:**
   Always pass `--no-formatters` when invoking `qlty check` in scripts, agent commands, or CI jobs. Delegate auto-formatting exclusively to the dedicated `qlty fmt` command:
   ```json
   "scripts": {
     "qlty": "qlty check --no-formatters",
     "qlty:fmt": "qlty fmt"
   }
   ```
2. **Rigorous Scanner Exclusions in `.qlty/qlty.toml`:**
   Define explicit `exclude_patterns` covering vendor, agent skill packages, and build outputs:
   ```toml
   exclude_patterns = [
     "*_min.*",
     "*.min.*",
     "**/.agents/**",
     "**/.claude/**",
     "**/.unslop/**",
     "**/node_modules/**",
     "**/dist/**",
     "**/build/**",
     "**/*.d.ts",
   ]
   ```
3. **Explicit Test Pattern Scoping:**
   Define `test_patterns` (`**/tests/**`, `**/*.test.*`) so AST analysis tools (like Bandit) do not treat unit test assertions as production code security risks.

## 4. Verification Proof
- `qlty check .github/workflows/ci.yml --no-formatters` runs in under 1 second without terminal blocking and reports `✔ No issues`.
- Verified clean package scripts in `package.json`.
