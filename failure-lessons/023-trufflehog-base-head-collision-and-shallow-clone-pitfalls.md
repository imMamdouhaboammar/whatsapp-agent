# FL-023: TruffleHog Base-Head Collision, Shallow Clone Pitfalls & Test Fixture Exclusion Discipline

- **Failure Class:** CI/CD & Secret Scanning / Runtime Collision
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** check ([.github/workflows/ci.yml](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/.github/workflows/ci.yml), [.trufflehog-exclude](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/.trufflehog-exclude))
- **Primary Source:** `.github/workflows/ci.yml`, `.trufflehog-exclude`, `trufflesecurity/trufflehog@v3.99.8`
- **Quote:** `"Copy and paste the following snippet into your .yml file. - name: TruffleHog OSS uses: trufflesecurity/trufflehog@v3.99.8 and configure all its requirements to work properly"` - User Request

---

## 1. Problem Description & Symptoms
When integrating the official TruffleHog OSS GitHub Action (`trufflesecurity/trufflehog@v3.99.8`), pipelines frequently encounter three compounding failures:
1. **`BASE == HEAD` Fatal Exit:** Passing `base: ${{ github.event.repository.default_branch }}` and `head: HEAD` unconditionally causes TruffleHog's composite action entrypoint to exit with a fatal error on direct pushes to `main`, because the base branch and HEAD commit resolve to identical SHAs.
2. **Shallow Clone Scan Blindness:** Standard `actions/checkout@v4` runs with `fetch-depth: 1` by default. TruffleHog cannot compute differential commit ranges or detect secrets across branch ancestry without the complete git object database.
3. **Synthetic Test Fixture & Lockfile False Positives:** Security detectors flag dummy test tokens (e.g. mock API keys used in sanitizer tests) and base64 hashes inside `bun.lock` unless explicit path exclusions are provided.

## 2. Root Cause Analysis
- **Composite Action Parameter Guard:** TruffleHog's `action.yml` contains an explicit sanity check:
  ```bash
  if [ -n "$BASE" ] || [ -n "$HEAD" ]; then
    # If BASE == HEAD, exit with error
  ```
  On push events to the default branch, both resolve to `main`, aborting the workflow.
- **Git Ancestry Requirement:** Differential scanning requires git log traversal between commits, which fails with `fatal: ambiguous argument: unknown revision` on shallow checkouts.
- **Unverified Noise:** Without `--only-verified`, TruffleHog emits alarms for pattern-matched strings regardless of whether the credential is an active, live secret.

## 3. Smart Solution & Architectural Rectification
1. **Dynamic Event-Gated Ref Mapping:**
   Gate `base` and `head` strictly behind `pull_request` events in `.github/workflows/ci.yml`. On `push` events, leave them empty so TruffleHog automatically falls back to inspecting `github.event.commits.*.id`:
   ```yaml
   - name: TruffleHog OSS
     uses: trufflesecurity/trufflehog@v3.99.8
     with:
       path: ./
       base: ${{ github.event_name == 'pull_request' && github.event.repository.default_branch || '' }}
       head: ${{ github.event_name == 'pull_request' && 'HEAD' || '' }}
       extra_args: --exclude-paths=.trufflehog-exclude --only-verified
   ```
2. **Mandatory Full Depth Checkout:**
   Configure `fetch-depth: 0` on `actions/checkout@v4`.
3. **Dedicated Regex Exclusions File:**
   Create `.trufflehog-exclude` with regex per line ignoring build artifacts, caches, and lockfiles:
   ```regex
   .*node_modules/.*
   .*ui/dist/.*
   .*dist/.*
   .*\.git/.*
   .*\.qlty/.*
   .*\.cache/.*
   .*bun\.lock.*
   .*coverage/.*
   ```
4. **Live Credential Verification:**
   Enforce `--only-verified` in `extra_args` to eliminate synthetic test token alerts.

## 4. Verification Proof
- Executed `trufflehog git file://. --max-depth=1 --exclude-paths=.trufflehog-exclude --only-verified`: finished in 563ms with 0 verified secrets.
- Validated `.github/workflows/ci.yml` with `qlty check`: 0 actionlint and 0 yamllint errors.
