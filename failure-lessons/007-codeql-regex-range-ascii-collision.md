# FL-007: CodeQL Regex Range Misinterpretation (ASCII Range Collisions)

- **Failure Class:** AppSec / Input Validation (CWE-20)
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check & Test (`tests/whatsapp-formatter.test.ts`)
- **Primary Source:** [src/domain/whatsapp-formatter.ts](file:///Users/mamdouhaboammar/Documents/M-Research/whatsapp-agent/src/domain/whatsapp-formatter.ts#L77)
- **Quote:** `"Suspicious character range that is equivalent to [:;<=>?@A-Z\[\\\]^_`a-z{|]"` - GitHub CodeQL Alert #1 (`js/overly-large-range`)

---

## 1. Context
The WhatsApp conversational agent formats Markdown outputs into mobile-optimized WhatsApp text. The function `convertMarkdownTables` parses Markdown table headers and separators (`|---|---|`) to convert table rows into readable bullet points.

## 2. What Happened
Line 77 previously evaluated separator lines using:
```typescript
const isSeparator = /^\|?[\s:-|-]+\|?$/.test(tableLines[1]);
```
Inside the character class `[\s:-|-]`, an unescaped hyphen `-` was placed between `:` and `|`. In JavaScript RegExp syntax, `-` between two characters creates an inclusive ASCII range. Because `:` is ASCII 58 and `|` is ASCII 124, `:-|` matched 66 characters:
- Digits and symbols: `: ; < = > ? @`
- Uppercase Latin letters: `A` through `Z`
- Punctuation: `[ \ ] ^ _ \``
- Lowercase Latin letters: `a` through `z`
- Braces: `{ |`

## 3. Observable Symptoms
- GitHub CodeQL static analysis flagged Alert #1 with high confidence (`js/overly-large-range`, CWE-20).
- Normal conversational lines with colons, words, or letters could falsely trigger table separator logic.

## 4. Root Cause Analysis
- **Confirmed**: An unintended ASCII character range was formed due to placement of an unescaped hyphen between two characters inside a character class. The developer intended to match the character set `{ \s, :, -, | }`.

## 5. Smart Solution & Invariants
1. **Escape Hyphens in Character Sets:**
   Always escape hyphens (`\-`) or place them at the very end of the character class so JavaScript RegExp treats them as literal characters:
   ```typescript
   const isSeparator = /^\|?[\s:|\-]+\|?$/.test(tableLines[1]);
   ```
2. **Deterministic Table Parsing:**
   The regex now strictly matches only whitespace, colon, pipe, and literal hyphen.

## 6. Verification Proof
- `bun test tests/whatsapp-formatter.test.ts` passes 7/7 tests with 0 regressions.
- CodeQL alert rule `js/overly-large-range` is resolved and eliminated.
