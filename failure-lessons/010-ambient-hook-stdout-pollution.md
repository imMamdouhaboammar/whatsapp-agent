# FL-010: Ambient Hook Stdout Stream Pollution and Shell Redirection Integrity

- **Failure Class:** CLI / Shell Streams & Process Boundary Pollution
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (POSIX file descriptor separation: stdout vs stderr)
- **Primary Source:** Shell profile integration & agent lifecycle hooks
- **Quote:** `Agent lifecycle hooks and ambient diagnostic scripts must route all human-facing banners to stderr, never stdout, to prevent stream pollution during shell redirection.` - Constitution

---

## 1. Context
Autonomous agent environments, CLI harnesses, and shell plugins frequently install hooks (e.g. `pre-push`, `pre-commit`, prompt wrappers, or background watchers) that display diagnostic banners, phase status, or motivational headers.

## 2. What Happened
An ambient agent hook printed informational status messages (`[get-fable] Canonical coding lifecycle active...`) directly to `stdout`. When an automated subshell or parent agent ran a CLI tool intending to parse JSON or text from stdout (e.g., `gh pr view --json ...` or `bun test`), the informational banner was prepended to the command output stream.

## 3. Observable Symptom
Commands expecting pure JSON or clean string payloads failed or required string trimming because non-payload banner text was present at the top of stdout:
```text
[get-fable] Canonical coding lifecycle active.
Runtime state: phase=complete; failureStreak=0...
{"status": "ok"}
```

## 4. Impact
Automated tools, pipes, subshells, and JSON decoders break when unexpected text pollutes the stdout channel.

## 5. Incorrect Assumption
Assumed that printing helpful diagnostic messages to standard output is harmless during interactive or scripted sessions.

## 6. Root Cause
**Confirmed**: Failure to adhere to the UNIX standard for stream separation: `stdout` (FD 1) is reserved for data and machine payloads; `stderr` (FD 2) is reserved for diagnostics, progress indicators, and human logs.

## 7. Why the Architecture Allowed It
Shell scripts and console loggers defaulted to `echo` or `console.log` rather than `>&2` or `console.error`.

## 8. Fix
Enforced that all ambient hooks, diagnostic watchers, and human-facing progress messages route exclusively to `stderr`:
- In Shell / Bash: `echo "..." >&2` or `printf "..." >&2`.
- In TypeScript / Node / Bun: `process.stderr.write("...")` or `console.error("...")`.
- In Python: `sys.stderr.write("...")`.

## 9. Verification
- Subshell command evaluation (`gh pr view --json ...`) parses valid JSON cleanly without header strip workarounds.
- Automated tests capturing process stdout receive pure test runner outputs.

## 10. Prevention Rule
Agent lifecycle hooks, ambient diagnostic scripts, and CLI wrappers MUST route all human-facing banners and telemetry to `stderr`, never `stdout`, to guarantee stream purity during shell redirection and piping.

## 11. Reusable Lesson
Whenever designing developer CLI tools or background hooks that run ambiently in a user's terminal, never print to `stdout` unless specifically asked to emit a data payload.

## 12. Related Code
- Lifecycle hooks & `.zshrc` / `.bashrc` prompt scripts
- `crates/fable-cli`

## 13. Related Tests
- CI quality gate test runners

## 14. Related Lessons
- [009-fable-mutation-evidence-synchronization.md](009-fable-mutation-evidence-synchronization.md)

## 15. Status
**Resolved**
