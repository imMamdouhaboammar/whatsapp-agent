# FL-040: Root AI Slop, Speculative Config Bloat & Multi-Platform Scaffolding Sprawl

## Context & Incident Trigger
An inspection of the repository root revealed extreme AI configuration bloat: 15 separate directories and boilerplate prompt stubs (`.amazonq/`, `.continue/`, `.cursor/`, `.devin/`, `.junie/`, `.kilo/`, `.openhands/`, `.plandex/`, `.qodo/`, `.trae/`, `.aider.prompt.md`, `.clinerules`, `.replit.md`, `.roomodes`, `.windsurfrules`) plus `skills-lock.json`.

Each file contained identical, uncurated 11-line boilerplate stubs (`get-fable route "<task>"`, `get-fable spark`, etc.) for tools that are not used by the repository developers or runtime. This created severe drawbacks:
1. **The Vibe Coding Footprint**: Created an immediate visual impression of uncurated, chaotic AI tool churning without code-owner stewardship.
2. **Context Pollution & Indexing Overhead**: Language servers, grep, ripgrep, and AST indexing tools traversed 15 redundant folders and parsed duplicate prompt markdown files on every scan.
3. **Hypocrisy with Anti-Slop Discipline**: While the repository maintained `unslop-preflight` and `/anti-slop-engineering` to eliminate cosmetic and behavioral slop in UI and code, the project's root front door was drowning in multi-platform AI slop.

## Root Cause Analysis
- **Speculative Multi-Platform Scaffolding**: Automated CLI commands (e.g. multi-platform rule generators) indiscriminately scaffold rule files for every known AI agent in the repository root rather than honoring actual project tooling.
- **Absence of Root Directory Governance**: Lack of a fail-closed `.gitignore` rule or invariant prohibiting speculative third-party editor stubs in shared version control.
- **Violation of Single Source of Truth (SSOT)**: Fragmenting instructions across 15 separate files violates DRY, leading to drift against the canonical project constitution (`AGENTS.md`).

## Surgical Remediation & Invariants Enforced
1. **Purged All Speculative AI Stubs**: Removed `.amazonq`, `.continue`, `.cursor`, `.devin`, `.junie`, `.kilo`, `.openhands`, `.plandex`, `.qodo`, `.trae`, `.aider.prompt.md`, `.clinerules`, `.replit.md`, `.roomodes`, and `.windsurfrules` from Git tracking.
2. **Fail-Closed `.gitignore` Fencing**: Added speculative AI configuration paths to `.gitignore` under `# Agent Runtimes & Local Machine Artifacts` so multi-platform toolchain exports can never be committed to repository root.
3. **Canonical Single Source of Truth**: Enforced `AGENTS.md` as the sole, authoritative agent constitution for the repository.
4. **The Zero Platform Sprawl Invariant**:
   `The Zero Platform Sprawl & Root Configuration Invariant: Project repositories must maintain strictly one canonical agent constitution (AGENTS.md). Committing speculative, copy-pasted configuration folders or prompt stubs for unused third-party AI platforms (.amazonq, .continue, .cursor, .devin, .junie, .kilo, .openhands, .plandex, .qodo, .trae, .aider.prompt.md, .clinerules, .roomodes, .windsurfrules) is prohibited AI slop.`

## Verification Proof
- `git rm -r`: Removed 15 speculative directories and prompt files.
- `bun test`: 410 passed, 0 failed, 1 skipped across 106 test files.
- `cd ui && bun test:ui`: 14 passed, 0 failed across bilingual SSR and component tests.
- `get-fable lint`: Passed with 0 errors.
- `bun .agents/skills/unslop-preflight/bin/cli.js audit`: 100/100 score.
