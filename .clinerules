# Cline — get-fable Working Rules

Autonomous VS Code agent lifecycle rules for Cline.

## Invariants

1. **State & Routing**: Route tasks via `get-fable route "<task>"` and use canonical skills.
2. **Mutation Awareness**: Register file modifications to invalidate older verification.
3. **Evidence Gating**: Every completion requires fresh passing test evidence.
4. **Recovery Protocol**: On 2+ consecutive failures, halt mutations and enter `fable-recover`.
5. **Spark Prediction**: Query `get-fable spark` for next-move guidance.
