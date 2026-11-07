# Plandex — get-fable Working Rules

Terminal multi-file engine lifecycle discipline for Plandex.

## Invariants

1. **Routing & Planning**: Convert requirements into bounded cards before execution (`get-fable plan` / `get-fable route "<task>"`).
2. **Mutation Awareness**: Register file modifications to invalidate stale evidence.
3. **Evidence Gating**: Passing verification must succeed on the final mutation.
4. **Recovery Protocol**: On repeated errors, halt edits and diagnose with `fable-recover`.
5. **Spark Prediction**: Query `get-fable spark` for next-action recommendations.
