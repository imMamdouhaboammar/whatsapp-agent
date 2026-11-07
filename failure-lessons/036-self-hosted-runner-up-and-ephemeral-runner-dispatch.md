# FL-036: Self-Hosted Runner-Up Architecture & Ephemeral Runner Token Dispatch for GitHub Actions

- **Failure Class:** CI/CD & Infrastructure / Runner Topology & Fallback
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (`.github/workflows/ci.yml`)
- **Primary Source:** `.github/workflows/ci.yml`, `kunchenguid/runner-up`
- **Quote:** `"https://github.com/kunchenguid/runner-up"` - user directive to adopt runner-up architecture

---

## 1. Context & Observable Symptoms
When configuring continuous integration for a high-performance local Apple Silicon development setup, GitHub Actions workflows configured with standard `ubuntu-latest` lacked native access to macOS ARM64 runtimes (e.g. Buck2, local hardware virtualization, and native Bun M-series binaries). However, pinning jobs strictly to `runs-on: self-hosted` caused CI pipelines to hang indefinitely in "Waiting for a runner to pick up this job" whenever the local machine or `runner-up` daemon was offline.

## 2. Root Cause Analysis (Fact vs Hypothesis)
- **Label Set Disjunction:** GitHub Actions runner routing treats label sets as strict subsets. A job specifying `runs-on: [self-hosted, macOS, ARM64, runner-up]` cannot be picked up by a standard GitHub-hosted runner.
- **Ephemeral Token Lifecycle:** Self-hosted runner orchestrators like `runner-up` register ephemeral runners via GitHub's runner registration API (`POST /repos/{owner}/{repo}/actions/runners/registration-token`). If a runner is terminated or restarts, the runner registration must be cleanly refreshed.
- **Single-Point-of-Failure CI Configuration:** Workflows that do not define matrix fallback or separate cloud jobs fail when the workstation is sleeping or disconnected from the network.

## 3. Impact & Architectural Vulnerability
- **Impact:** Blocked pull request merges, delayed code review feedback, and reliance on manual local test execution when remote CI hangs.
- **Architectural Vulnerability:** Coupling repository CI health entirely to a single local workstation undermines the reliability of continuous integration.

## 4. Smart Solution & Architectural Rectification
1. **Tiered Dual-Runner Workflow Architecture:**
   Configured `.github/workflows/ci.yml` with explicit runner targeting and dual pathways:
   - High-performance local tier: runs on `[self-hosted, macOS, ARM64, runner-up]` when the runner daemon is active.
   - Cloud fallback tier: runs on standard GitHub-hosted runners (`ubuntu-latest`) to guarantee PR checks complete even when local daemons are offline.
2. **Deterministic Hermetic Step Sequence:**
   Ensured that runner jobs independently execute full environment setup (`actions/checkout@v4`, `oven-sh/setup-bun@v2`, `bun install --frozen-lockfile`) rather than assuming pre-existing global dependencies on the host machine.
3. **Secret Hygiene & Non-Root Execution:**
   Followed `runner-up` best practices by running jobs under non-root user permissions with scoped repository access tokens.

## 5. Verification & Regression Falsification
- **Workflow Lint & Validation:** Validated `.github/workflows/ci.yml` syntax using GitHub Actions schema parsers.
- **Hermetic Step Execution:** Verified that `bun test` and `cd ui && bun test:ui` execute successfully within the workflow structure.

## 6. Prevention Invariant & Reusable Lessons
> **The Dual-Topology CI Invariant:**  
> When introducing self-hosted or ephemeral runners (such as `runner-up`) to accelerate CI pipelines, always maintain an automated cloud fallback (`ubuntu-latest`) or dual matrix configuration so external PRs and offline states never block the repository quality gates.

## 7. Related Artifacts & Metadata
- **Related Code:** `.github/workflows/ci.yml`
- **Related Tests:** GitHub Actions CI execution
- **Related Lessons:** `failure-lessons/019-github-action-sha-pinning-and-ci-isolation.md`
- **Status:** Resolved
