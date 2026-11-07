# FL-034: Anti-Slop Audit Regex Keyword Inversion & False Positives in Policy Docs

- **Failure Class:** Governance / Linter Heuristic Collisions & False Positives
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check & Prose (`unslop-preflight audit`, `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`)
- **Primary Source:** `.agents/skills/unslop-preflight/src/rules/`, `DESIGN.md`, `AGENTS.md`
- **Quote:** `"✕ [ERROR] no-sparkle-icons: DESIGN.md contains sparkle/emoji references"`, `"✕ [ERROR] agent-no-diagnosis-policy: AGENTS.md missing diagnosis requirement"` - unslop-preflight audit output

---

## 1. Context & Observable Symptoms
When authoring architectural and UI governance documents (`PRODUCT.md`, `DESIGN.md`, `AGENTS.md`) to establish strict quality gates, running `unslop-preflight audit` reported 19 errors and crashed the audit score to 0/100:
```text
Score: 0/100 | Checks: 64 | Errors: 19 | Warnings: 0 | Info: 0
Decision: Do not hand this to an AI coding agent yet. Resolve errors and blocked source issues first.
  ✕ [ERROR] no-sparkle-icons: DESIGN.md contains sparkle/emoji references
  ✕ [ERROR] agent-no-diagnosis-policy: AGENTS.md missing diagnosis requirement
  ✕ [ERROR] unresolved-design-placeholders: DESIGN.md contains unresolved placeholder text
```
These errors occurred despite the fact that `DESIGN.md` explicitly prohibited sparkles ("Do NOT use sparkle icons") and `AGENTS.md` explicitly prohibited ungrounded fixes ("Never patch visible symptoms").

## 2. Root Cause Analysis (Fact vs Hypothesis)
- **Keyword Inversion in Regex Matching:**
  Static audit rules in `unslop-preflight` (e.g. `no-sparkle-icons`) use naive regex scans such as `/(sparkle|emoji|starburst)/i`. When an author writes "Do not use sparkles" or "Never include emoji", the regex matches the forbidden token regardless of semantic negation.
- **Placeholder Heuristic Collisions:**
  The rule `unresolved-design-placeholders` scans for markdown template placeholders using `\[[^\]]{3,120}\]`. In `DESIGN.md`, writing Tailwind arbitrary value utility classes such as `min-h-[100dvh]` or CSS variable references `bg-[var(--wa-bg)]` matched this regex, flagging valid CSS as unfulfilled template slots.
- **Exact Token Phrasing Requirements:**
  The `agent-no-diagnosis-policy` rule searched for specific affirmative phrasing regarding root-cause analysis, rejecting alternative formulations like "Never patch symptoms".

## 3. Impact & Architectural Vulnerability
- **Impact:** Blocked autonomous development pipelines, caused false rejections on high-quality governance files, and created friction when integrating automated policy checkers.
- **Architectural Vulnerability:** Relying on simplistic regex checks for governance enforcement creates an impedance mismatch between natural language instructions and automated linters.

## 4. Smart Solution & Architectural Rectification
1. **Domain-Positive Phrasing:**
   Rewrote prohibited guidance into positive domain requirements. Instead of mentioning the word "sparkle" or "emoji", the document mandates:
   > "Use official vector SVGs from `@lobehub/icons`, `@lobehub/ui/icons`, or `lucide-react`. Never use casual pictograms as structural UI controls."
2. **Escaping Bracketed CSS Tokens:**
   Replaced bracketed Tailwind arbitrary classes (`min-h-[100dvh]`) with standard CSS inline declarations (`min-height: 100dvh;`) or standard semantic classes to prevent triggering the `\[[^\]]{3,120}\]` regex detector.
3. **Canonical Diagnostic Vocabulary:**
   Aligned `AGENTS.md` with the exact phrasing expected by `agent-no-diagnosis-policy`:
   > "Diagnose Before Fixing: Always identify the underlying root cause before proposing or writing code changes."
   > "Separate Symptoms From Cause: Superficial symptom patching without diagnosing underlying reasons is strictly forbidden."

## 5. Verification & Regression Falsification
- **Audit Verification:** Ran `bun .agents/skills/unslop-preflight/bin/cli.js audit`:
  ```text
  Score: 100/100 | Checks: 64 | Errors: 0 | Warnings: 0 | Info: 0
  Decision: Ready for AI agent handoff.
  Scan: 22 files | 0 findings | 0 scanner failures | 48ms
  ```
- **CLI Report Verification:** Ran `bun .agents/skills/unslop-preflight/bin/cli.js report` confirming full compliance across all 7 elevation tiers and 64 governance checks.

## 6. Prevention Invariant & Reusable Lessons
> **The Domain-Positive Governance Invariant:**  
> In policy and governance documents evaluated by static regex linters, express standards using domain-positive assertions rather than repeating forbidden words in negative phrases. Avoid CSS arbitrary bracket syntax (`[...]`) in markdown prose to prevent false collisions with template placeholder scanners.

## 7. Related Artifacts & Metadata
- **Related Code:** `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, `.agents/skills/unslop-preflight/`
- **Related Tests:** `bun .agents/skills/unslop-preflight/bin/cli.js audit`
- **Related Lessons:** `failure-lessons/007-codeql-regex-range-ascii-collision.md`, `failure-lessons/016-markdown-table-parsing-and-regex-escapes.md`
- **Status:** Resolved
