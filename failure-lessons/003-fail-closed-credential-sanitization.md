# FL-003: Fail-Closed Unicode Credential Sanitization in Memory

- **Failure Class:** AppSec / Sensitive Data Leakage
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check (Automated Regex Filter before Storage)
- **Primary Source:** `src/domain/learning-memory.ts`
- **Quote:** `"Zero Credentials in Memory: Never persist passwords, API keys, tokens, or OTPs. All memory additions must pass Unicode-aware fail-closed regex screening."` - AGENTS.md

---

## 1. Problem Description & Symptoms
WhatsApp users often paste passwords, OTP codes, API tokens, or payment credentials into customer service chats. When an AI agent performs automated fact extraction or procedural rule induction, these sensitive tokens risk being persisted indefinitely in plaintext files (`notebook.md` and `workbook.md`) and database tables, leading to catastrophic compliance and privacy violations.

## 2. Root Cause Analysis
- Naive Memory Accumulation: Ingesting customer text into persistent state without an intervening sanitization boundary.
- Non-Latin Credential Forms: English-only regexes miss Egyptian and Modern Standard Arabic phrases for credentials (e.g. `كلمة السر`, `رمز التأكيد`, `كود التحقق`).

## 3. Smart Solution & Architectural Rectification
1. **Unicode-Aware Fail-Closed Filter (`scrubCredentials`):**
   - Filters API keys across all major providers (`sk-*`, `AIza*`, `ghp_*`, `xox*`).
   - Filters Bearer and Authorization header values.
   - Filters bilingual password patterns: `(?:password|secret|passwd|كلمة[\s_]*المر|رمز[\s_]*الس)`.
   - Filters OTP and verification pins: `(?:otp|code|pin|رمز(?:\s+التأكيد)?|كود)`.
   - Filters credit card patterns (13-16 digits).
   - Replaces all matches with `[REDACTED_CREDENTIAL]`.
2. **Boundary Enforcement:**
   - Any addition to `workbook.md`, `notebook.md`, or `wa_agent.learning_states` must pass through `scrubCredentials` before serialization.

## 4. Verification Proof
- `tests/reflection-learning.test.ts` test case `"enforces Unicode-aware fail-closed credential sanitization before writing memory"`.
