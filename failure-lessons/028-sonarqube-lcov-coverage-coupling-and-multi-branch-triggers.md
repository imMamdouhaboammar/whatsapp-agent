# FL-028: SonarQube LCOV Coverage Coupling & Multi-Branch Workflow Triggers

- **Failure Class:** CI/CD & Code Quality Gate Alignment
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** structure ([.github/workflows/build.yml](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/.github/workflows/build.yml), [.gitignore](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/.gitignore))
- **Primary Source:** `.github/workflows/build.yml`, `bun test --coverage`
- **Quote:** `"Here is a base configuration to run a SonarQube Cloud analysis on your master branch and Pull Requests... The build and test steps are optional."` - User Request

---

## 1. Problem Description & Symptoms
1. **Dormant Workflows on Modern Repositories:** Boilerplate SonarQube templates reference legacy `master` branch triggers (`branches: [master]`). On modern repositories utilizing `main`, push events to the default branch never trigger SonarQube scans.
2. **0% Coverage in SonarCloud:** When the optional build/test step is left unconfigured, SonarQube scans the AST for syntax issues but reports 0% line and branch coverage, degrading the overall code quality rating.
3. **Untracked Local Coverage Sprawl:** Running local test coverage dumps directories (`coverage/lcov.info`) that pollute `git status` unless registered in `.gitignore`.

## 2. Root Cause Analysis
- **Branch Naming Drift:** GitHub shifted default branches to `main`, while legacy templates assume `master`.
- **LCOV Format Expectation:** SonarQube's JavaScript/TypeScript sensor requires LCOV format specified via `-Dsonar.javascript.lcov.reportPaths=coverage/lcov.info`.
- **Bun Coverage Flags:** The Bun test runner requires explicit arguments (`--coverage --coverage-reporter=lcov --coverage-dir=coverage`) to generate the `lcov.info` file rather than plain text terminal summaries.

## 3. Smart Solution & Architectural Rectification
1. **Dual Branch Triggering:**
   Support both standard and legacy conventions in `.github/workflows/build.yml`:
   ```yaml
   'on':
     push:
       branches:
         - main
         - master
     pull_request:
       types: [opened, synchronize, reopened]
   ```
2. **Deterministic Bun Test Coverage Generation:**
   Embed automated test coverage and build execution directly before the SonarQube scan step:
   ```yaml
   - name: Build and Test with Coverage
     run: |
       bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage
       cd ui && bun run build
   ```
3. **Direct Sonar Parameter Binding & Scoping:**
   Pass the LCOV report path and exclusion patterns in `args`:
   ```yaml
   args: >
     -Dsonar.organization=mamdouhezz
     -Dsonar.projectKey=mamdouhezz_fableagenticwhatsapp
     -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
     -Dsonar.exclusions=**/node_modules/**,**/dist/**,**/.agents/**,**/.qlty/**,**/ui/dist/**
   ```
4. **Git Workspace Hygiene:**
   Add `coverage/` to `.gitignore`.

## 4. Verification Proof
- `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage` creates verified `coverage/lcov.info`.
- `qlty check .github/workflows/build.yml` reports `✔ No issues`.
