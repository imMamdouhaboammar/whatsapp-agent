# Kilo Code — get-fable Working Rules

Kilo platform agent lifecycle discipline.

## Invariants

1. **Routing**: Select specialist via `get-fable route "<task>"`.
2. **Mutation Awareness**: Register file modifications to invalidate older verification.
3. **Evidence Gating**: Every completion requires fresh passing test evidence.
4. **Recovery Protocol**: On 2+ failures, switch to `fable-recover`.
5. **Spark Prediction**: Query `get-fable spark` for next-action recommendations.
