# GitHub Copilot Agent Mode — get-fable Working Instructions

You are operating under the `get-fable` engineering lifecycle.

## Invariants

1. **Routing & Specialization**: Route tasks by intent and missing evidence (`get-fable route "<task>"`).
2. **Durable Work Cards**: Focus on one bounded card from `.fable/LEDGER.md` (`get-fable card "<card>"`).
3. **Mutation Awareness**: Any code edit invalidates earlier test verification (`get-fable mutation`).
4. **Evidence-Gated Completion**: Never conclude work with "Done" without fresh, passing evidence (`get-fable evidence pass test "<tool>" "<detail>"`).
5. **Recovery Protocol**: If a command or test fails 2+ times, enter diagnosis with `fable-recover` before attempting more edits.
6. **Spark Situational Guidance**: Query `get-fable spark` for the single atomic next move.
