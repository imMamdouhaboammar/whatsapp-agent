# FL-009: Fable Mutation-Evidence Life-Cycle Synchronization

- **Failure Class:** Workflow / Pre-Push Governance Gate
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check (`.git/hooks/pre-push`, `get-fable`)
- **Primary Source:** `.fable/state.json`
- **Quote:** `state.json: substantial work is complete without fresh passing evidence (verified generation 11 < mutation generation 12)` - command

---

## 1. Context
`get-fable` is an autonomous engineering lifecycle harness that monitors mutations, verification generations, and quality gates across Git commits and pushes.

## 2. What Happened
After implementing the Astryx design primitives, Buck2 configuration, and continuous reflection engine, the code changes advanced the workspace `mutationGeneration` from 11 to 12. When attempting to push the branch (`git push -u origin feat/buck2-astryx-ui-hardening`), the `pre-push` hook blocked the push because `verifiedGeneration` was still at 11.

## 3. Observable Symptom
```text
=== Fable spec and ledger verification ===
state.json: substantial work is complete without fresh passing evidence (verified generation 11 < mutation generation 12)
error: failed to push some refs
```

## 4. Impact
The push to GitHub was rejected, preventing pull request creation until evidence was formally registered.

## 5. Incorrect Assumption
Assumed that running `bun test` in the terminal was sufficient for the git hook to permit the push. In Fable, the test execution must be explicitly recorded into `.fable/state.json` to advance the verification counter.

## 6. Root Cause
**Confirmed**: Fable's life-cycle state machine treats any substantial code modification as unverified until an explicit proof artifact or evidence entry is recorded matching the current mutation generation.

## 7. Why the Architecture Allowed It
The pre-push hook fails closed to prevent pushing untested code to remote CI.

## 8. Fix
Executed the Fable evidence registration command to record the passing test run:
```bash
get-fable evidence pass test "bun test" "172 pass 0 fail across 84 files"
```
This advanced `verifiedGeneration` to 12, satisfying the state machine constraint and allowing the push to proceed.

## 9. Verification
- `get-fable lint` passed with 0 errors.
- `git push -u origin feat/buck2-astryx-ui-hardening` succeeded.

## 10. Prevention Rule
In repositories governed by `get-fable`, whenever substantial code edits occur, record fresh passing evidence via `get-fable evidence pass <kind> <cmd> <summary>` before invoking `git push`.

## 11. Reusable Lesson
Automated life-cycle governance engines require explicit cryptographic or generational evidence. Always synchronize the state machine before attempting external transport actions (push, publish).

## 12. Related Code
- `.fable/state.json`
- `.git/hooks/pre-push`

## 13. Related Tests
- Full monorepo test suite (`bun test`)

## 14. Related Lessons
- [001-supabase-postgresql-memory-tier.md](001-supabase-postgresql-memory-tier.md)

## 15. Status
**Resolved**
