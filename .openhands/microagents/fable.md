# OpenHands — get-fable Microagent Rules

OpenHands (OpenDevin) software agent lifecycle governance.

## Invariants

1. **State Tracking**: Synchronize with `.fable/state.json`.
2. **Deterministic Routing**: Route tasks via `get-fable route "<task>"`.
3. **Mutation Awareness**: Register file modifications to invalidate stale evidence.
4. **Evidence-Gated Completion**: Collect fresh passing evidence after final mutation.
5. **Recovery Protocol**: On 2+ failures, execute root cause diagnosis via `fable-recover`.
6. **Spark**: Query `get-fable spark` for minimal atomic actions.
