# Continue — get-fable Working Rules

IDE extension layer lifecycle rules for Continue.

## Invariants

1. **Routing**: Determine task specialist before writing code (`get-fable route "<task>"`).
2. **Mutation Awareness**: Register changes with `get-fable mutation`.
3. **Evidence Gating**: Re-run verification after code changes.
4. **Recovery Protocol**: On repeated errors, diagnose with `fable-recover`.
5. **Spark**: Query `get-fable spark` for next-action recommendations.
