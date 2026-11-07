# JetBrains Junie — get-fable Working Rules

JetBrains Junie IDE assistant governance with get-fable.

## Invariants

1. **Routing**: Select specialist via `get-fable route "<task>"`.
2. **Mutation Awareness**: File modifications invalidate older verification.
3. **Evidence Gating**: Passing verification must succeed on the final mutation.
4. **Failure Recovery**: On 2+ consecutive failures, enter `fable-recover`.
5. **Spark**: Query `get-fable spark` for next-action recommendations.
