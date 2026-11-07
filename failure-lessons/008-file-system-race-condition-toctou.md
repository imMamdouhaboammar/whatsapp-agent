# FL-008: Elimination of File System Race Conditions (TOCTOU) in Tooling and Storage Layers

- **Failure Class:** AppSec / Concurrency (CWE-367 TOCTOU)
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Structure (`patch-baileys.mjs`, `src/domain/learning-memory.ts`) & Check (CodeQL AST Security Analysis)
- **Primary Source:** [patch-baileys.mjs](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/patch-baileys.mjs) & [src/domain/learning-memory.ts](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/src/domain/learning-memory.ts)
- **Quote:** `"The file may have changed since it was checked."` - GitHub CodeQL Alert (`js/file-system-race`)

---

## 1. Context
File system read, write, and patch operations occur in two key places:
1. `patch-baileys.mjs` on `postinstall` to patch `@whiskeysockets/baileys` connection flags for companion socket compatibility.
2. `src/domain/learning-memory.ts` when loading or initializing agent markdown memory stores (`notebook.md` and `workbook.md`).

## 2. What Happened
Both files previously checked file existence prior to file operations:
```javascript
// patch-baileys.mjs
if (!existsSync(path)) return;
let src = readFileSync(path, 'utf8');

// src/domain/learning-memory.ts
if (fs.existsSync(filePath)) {
  return fs.readFileSync(filePath, 'utf-8');
}
```
Checking `existsSync` before reading or writing creates a Time-of-Check to Time-of-Use (TOCTOU) vulnerability. Between the `existsSync` call and the `readFileSync`/`writeFileSync` calls, the file state can change, be removed, or be replaced with a symlink by an unprivileged concurrent process in multi-tenant environments.

## 3. Observable Symptoms
- GitHub CodeQL Security Scan flagged alerts for CWE-367 (`js/file-system-race`).

## 4. Root Cause Analysis
- **Confirmed**: The "check-then-act" anti-pattern in file system interactions. The file existence check is redundant because filesystem read operations natively report non-existence via error codes (`ENOENT`).

## 5. Smart Solution & Invariants
1. **Direct Operation with Explicit Error Handling:**
   Remove `existsSync` entirely. Execute `readFileSync` directly and handle `ENOENT` explicitly in a `try / catch` block:
   ```typescript
   try {
     return fs.readFileSync(filePath, 'utf-8');
   } catch (err: any) {
     if (err && typeof err === 'object' && err.code === 'ENOENT') {
       return defaultContent;
     }
     throw err;
   }
   ```
2. **Atomic Execution:**
   The check and read become a single atomic system call, eliminating the race window.
3. **Directory Creation:**
   Use `fs.mkdirSync(dir, { recursive: true })` unconditionally before writes, avoiding separate directory existence checks.

## 6. Verification Proof
- `node patch-baileys.mjs` executes cleanly and idempotently with 0 warnings.
- CodeQL Security Analysis run on PR #11 passed with 0 alerts across JS/TS.
- `bun test tests/reflection-learning.test.ts` passed 10/10 tests without regression.

## 7. Prevention Rule
File system access must avoid `fs.existsSync` pre-checks. Always perform the read or write directly within a `try/catch` block handling `ENOENT` or error codes atomically.

## 8. Status
**Resolved**
