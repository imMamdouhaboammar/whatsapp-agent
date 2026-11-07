# Amazon Q Dev — get-fable Lifecycle Rules

Enforce get-fable coding standards in AWS & IDE coding sessions.

## Invariants

1. **Routing**: Select the canonical specialist for the current task (`get-fable route "<task>"`).
2. **Mutation Awareness**: Workspace edits invalidate previous verification proof.
3. **Evidence-Gated Completion**: Collect fresh, passing verification evidence before marking work complete.
4. **Recovery**: Diagnose repeated build or test failures with `fable-recover`.
5. **Spark**: Check `get-fable spark` for minimal next steps.
