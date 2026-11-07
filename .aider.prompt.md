# Aider — get-fable Working Rules

Git-first CLI engineering discipline with get-fable.

## Invariants

1. **Route Intent**: Execute `get-fable route "<task>"` before editing files.
2. **Mutation Awareness**: Commit and verify each atomic change cleanly.
3. **Evidence Gating**: Re-verify tests after code changes before claiming task completion.
4. **Recovery Protocol**: On repeated test failures, halt edits and diagnose with `fable-recover`.
5. **Spark Prediction**: Check `get-fable spark` for next actions.
