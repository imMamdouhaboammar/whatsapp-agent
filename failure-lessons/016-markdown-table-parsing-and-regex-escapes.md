# FL-016: Markdown Table Parsing and Regex Escape Safety

- **Failure Class:** Syntax / Formatter Parser Edge Cases & Linter Hygiene
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check (`qlty check`, `oxlint`) & Review (`CodeRabbit`)
- **Primary Source:** `src/domain/whatsapp-formatter.ts`
- **Quote:** `convertMarkdownTables: In table parsing, lines like "| - | |" or rows without explicit cell separators could be mistakenly skipped or emitted as headers unless each cell conforms strictly to separator regex` - CodeRabbit

---

## 1. Context
`src/domain/whatsapp-formatter.ts` converts standard GitHub Markdown tables into readable WhatsApp bulleted messages (`convertMarkdownTables`), because WhatsApp does not support native Markdown table rendering.

## 2. What Happened
1. **CodeRabbit Finding**: The initial table separator line detector checked whether the line contained `|` and `-`, which could misidentify valid data rows (such as rows with empty cells or single dash values) as separator lines, or fail on tables without outer leading/trailing pipes.
2. **Linter Finding (`qlty`/`oxlint`)**: The regex pattern used `\-` inside `/\:?\-+\:?/`, triggering oxlint's `no-useless-escape` warning because `-` does not require escaping outside character classes.

## 3. Observable Symptom
- CodeRabbit flagged: *"Add a regression test for the WhatsApp table formatter’s separator detection around isSeparator"*.
- `qlty check` warning: *"Unnecessary escape character: \- (no-useless-escape)"*.

## 4. Impact
Potential data loss in WhatsApp chat messages if a table row was mistakenly omitted as a header separator, and CI quality gate warnings on code formatting.

## 5. Incorrect Assumption
Assumed that checking `line.includes('|') && line.includes('-')` was sufficient to detect separator lines like `|---|---|`.

## 6. Root Cause
**Confirmed**: Table separators must be evaluated per cell, not per line. A separator line is only valid if *every* cell inside it consists exclusively of dashes and optional alignment colons (`:?-+:?`).

## 7. Why the Architecture Allowed It
The line splitter was doing quick string checks instead of parsing cells with the existing `parseCells` helper.

## 8. Fix
1. Refactored `isSeparator` to split the line into cells and verify every cell matches `/^:?-+:?$/`:
```typescript
const isSeparator = (line: string) => {
  const cells = parseCells(line);
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
};
```
2. Removed the unnecessary escape on `-`, ensuring clean linter execution.

## 9. Verification
- `bun test tests/whatsapp-formatter.test.ts` passed 7/7 tests.
- Added test cases for missing outer pipes, empty cell columns, and mixed alignment.
- `bun run qlty` reported: `✔ No issues`.

## 10. Prevention Rule
Markdown table separator detectors must validate every parsed cell individually (`/^:?-+:?$/`) rather than applying line-level substring or fuzzy checks, and regular expressions must not escape characters unnecessarily (`no-useless-escape`).

## 11. Reusable Lesson
When writing custom Markdown formatters or parsers, parse structural elements into tokens/cells before making filtering decisions. Line-level heuristics always fail on edge cases.

## 12. Related Code
- `src/domain/whatsapp-formatter.ts`

## 13. Related Tests
- `tests/whatsapp-formatter.test.ts`

## 14. Related Lessons
- [005-api-controller-payload-desynchronization.md](005-api-controller-payload-desynchronization.md)

## 15. Status
**Resolved**
