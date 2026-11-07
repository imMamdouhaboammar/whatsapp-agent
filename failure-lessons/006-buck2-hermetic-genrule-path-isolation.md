# FL-006: Buck2 Hermetic Scratch Isolation & Path Macro Resolution

- **Failure Class:** Build Infrastructure / Toolchain Isolation
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (`BUCK`, `.buckconfig`)
- **Primary Source:** [BUCK](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/BUCK), [.buckconfig](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/.buckconfig)
- **Quotes:** 
  - `src/App.tsx(2,130): error TS2307: Cannot find module 'lucide-react'`
  - `Error resolving $(pwd). There was no mapping for pwd.`
  - `line 7: ../out/ui_test.log: No such file or directory`

---

## 1. Context
Integrating Meta's Buck2 build system into an existing polyglot monorepo containing Bun/TypeScript backend (`src/`), React 19/Vite frontend (`ui/`), and Python worker (`workers/media-python/`).

## 2. What Happened
1. **Node Modules Resolution Failure in Staging:**
   Buck2 genrules execute inside isolated scratch directories (`buck-out/v2/art/root/<hash>/__<target>__/srcs`). When defining `ui_build`, declared `srcs` only included source files (`ui/src/**/*`, `ui/package.json`, etc.). Because `node_modules` was rightfully excluded from `srcs` (to prevent massive input hashing), executing `(cd ui && bun run build)` inside the sandbox failed with `Cannot find module 'lucide-react'` and missing TypeScript types.
2. **Starlark Macro Collision on `$(pwd)`:**
   Attempting to resolve working directory via `$(pwd)` caused Buck2's parser to fail: `Error resolving $(pwd). There was no mapping for pwd.` In Buck2, `$(...)` syntax is reserved for Starlark macro expansions (`$(location ...)`, `$(exe ...)`).
3. **Relative `$OUT` Path Invalidation:**
   Buck2 sets `$OUT` as a relative path from the scratch directory (e.g. `../out/ui_test.log`). When a genrule command executed `cd "$ROOT/ui"` followed by `> "$OUT"`, the shell attempted to write to `ui/../out/` which did not exist.

## 3. Observable Symptoms
- Build failure code 3 with missing module resolution errors during `buck2 build //:ui_build`.
- Starlark analysis failure during `buck2 build //...` when `$(pwd)` was in command strings.
- Shell stderr: `../out/ui_test.log: No such file or directory`.

## 4. Root Cause Analysis
- **Confirmed**: Buck2 isolates genrule executions into sandbox directories and treats `$(...)` as Starlark macro expansions. Any command that changes directory invalidates relative environment variables provided by the build runner, and any build step requiring host tooling caches (`node_modules`) must reference the persistent project root rather than the staged sandbox.

## 5. Smart Solution & Invariants
1. **Dynamic Project Root Resolution via Bash Parameter Expansion:**
   Use bash string trimming `${PWD%%/buck-out/*}` which operates on the runtime `$PWD` variable without triggering Buck2's `$(...)` macro syntax:
   ```bash
   ROOT="${PWD%%/buck-out/*}"
   ```
2. **Absolute Target Out Capture:**
   Capture absolute destination before any directory changes:
   ```bash
   TARGET_OUT="$PWD/$OUT"
   ```
3. **Bundled Prelude Toolchains:**
   Configure `.buckconfig` with `[external_cells] prelude = bundled` to leverage Buck2's internal Starlark prelude matching its exact binary release, avoiding external git submodule synchronization issues.
4. **Comprehensive Ignore Patterns:**
   Add `[project] ignore = .git, node_modules, ui/node_modules, ui/dist, data, .fable, workers/media-python/.venv` to `.buckconfig` to ensure zero-cost file watching.

## 6. Verification Proof
- `buck2 targets //...` successfully queries all 6 monorepo targets.
- `buck2 build //...` builds cleanly with 0 errors (`BUILD SUCCEEDED`).
- `buck2 build --show-output //...` verifies artifact generation across backend checks, frontend builds, and test logs.
