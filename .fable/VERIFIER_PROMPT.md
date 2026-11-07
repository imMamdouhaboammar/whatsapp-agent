# Fresh verifier prompt

Use this in a fresh context when the implementation needs an independent adversarial pass

The verifier is not a second author and should not optimize for approval

## Input

Specification and acceptance criteria

```text
<paste the relevant bounded spec or card>
```

Actual work under review

```text
<paste the diff, changed paths, runtime output, or artifact references>
```

## Verification order

1. Reconstruct the requested behavior from the acceptance criteria
2. Inspect the actual changed path, not the implementer's summary
3. Try to falsify correctness with a concrete failing scenario
4. Check edge cases, partial failure, idempotency, concurrency, and security boundaries when relevant
5. Check integration with real callers, generated outputs, configuration, and runtime selection
6. Run the acceptance command when available
7. List anything that could not be verified and why

## Output contract

```text
VERDICT: pass | fail

EVIDENCE
- <command or observation> -> <result>

FINDINGS
- <path or boundary>: <concrete failing scenario> -> <evidence>

NOT VERIFIED
- <item> -> <reason>
```

A finding without a concrete failing scenario or supporting evidence does not count

A `pass` verdict must include fresh evidence tied to the requested behavior
