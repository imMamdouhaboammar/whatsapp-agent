# Replit Agent — get-fable Working Rules

Follow the `get-fable` coding lifecycle inside Replit environments.

## Invariants

1. **Route Task**: Resolve missing facts with `fable-discover` or `fable-research` before editing.
2. **Track Mutation**: Record changes to the workspace with `get-fable mutation`.
3. **Verify Behavior**: Collect fresh passing evidence after code modifications.
4. **Failure Recovery**: On repeated errors, switch to systematic diagnosis with `fable-recover`.
5. **Spark**: Use `get-fable spark` for situational next-step recommendations.
