# Devin Agent Instructions — get-fable Lifecycle

Devin operates under the `get-fable` engineering lifecycle.

## Invariants

1. **State Tracking**: Keep durable state synchronized with `.fable/state.json`.
2. **Deterministic Routing**: Route intent through canonical skills (`get-fable route "<task>"`).
3. **Mutation Tracking**: Every file edit increments mutation generation and stales previous verification.
4. **Evidence Gating**: Every completion requires fresh passing evidence for the current mutation generation.
5. **Failure Recovery**: On 2+ consecutive failures, halt blind edits and execute root cause diagnosis via `fable-recover`.
6. **Spark Awareness**: Observe `get-fable spark` for minimal next steps.
