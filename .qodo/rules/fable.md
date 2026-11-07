# Qodo — get-fable Working Rules

Qodo (formerly CodiumAI) lifecycle rules.

## Invariants

1. **Routing**: Route task intent to the designated specialist.
2. **Mutation Awareness**: Record file modifications to keep evidence fresh.
3. **Evidence Gating**: Re-run verification after code changes.
4. **Recovery**: Diagnose repeated errors with `fable-recover`.
5. **Spark**: Use `get-fable spark` for minimal next steps.
