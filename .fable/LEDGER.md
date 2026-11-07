# get-fable ledger

No active round yet

Create cards only when a substantial round is routed or planned

## Card contract

- `- [ ]` means open and blocks completion
- `- [x]` means completed and verified, so it needs substantive evidence
- `- [~]` means intentionally deferred with a reason
- `PAUSED: <reason>` temporarily suspends lifecycle enforcement for unrelated work

Use concrete acceptance and evidence

```text
example open:   - [ ] 1. Add request validation -- acceptance: bun test test/router.test.ts
example done:   - [x] 1. Add request validation -- evidence: bun test test/router.test.ts -> 8 passed
example defer:  - [~] 2. Redesign error copy -- deferred: outside this round
```

Strict phase, routing, failure streak, and evidence records live in `.fable/state.json`
