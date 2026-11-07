# get-fable spec: <project or round>

## Outcome

<What must exist when this round is complete, and who observes the result>

## Constraints

- <hard requirement>
- <compatibility or safety boundary>
- <explicit non-goal>

## Evidence packet

Record only load-bearing facts that can change the implementation

- [measured] <fact observed in code, test, runtime, or tool output>
- [inferred] <conclusion supported by listed evidence>
- [not-shown] <important fact that remains unresolved>

Do not start architecture while a `[not-shown]` fact can still change the solution

## Chosen approach

<Short description of the selected design and why it fits the evidence and constraints>

## Work cards

Each card should be small enough to understand and verify independently

```text
Card 1: <title>
Does: <bounded behavior change>
Acceptance: <command or observable condition>
Depends on: <card or none>
Parallel with: <card or none>
```

## Decisions

- <date>: <decision, supporting evidence, and consequence>

## Completion contract

The round is complete only when the requested behavior exists, the real affected path has been verified, passing evidence is recorded in `.fable/state.json`, and the durable phase reaches `complete`
