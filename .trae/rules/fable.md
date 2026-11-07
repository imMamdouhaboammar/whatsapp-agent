# Trae — get-fable Lifecycle Rules

Enforce get-fable lifecycle governance in Trae IDE.

## Invariants

1. **Routing**: Route intent to the appropriate specialist (`get-fable route "<task>"`).
2. **State & Mutation**: Keep changes tracked with `get-fable mutation`.
3. **Verification**: Validate code changes with fresh evidence before completion.
4. **Recovery**: When tests fail repeatedly, halt edits and diagnose via `fable-recover`.
5. **Spark**: Use `get-fable spark` for next-action clarity.
