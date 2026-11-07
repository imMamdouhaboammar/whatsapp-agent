# FL-022: Stop-Hook Lifecycle Fencing & Two-Step Verification Transitions in get-fable

- **Failure Class:** Workflow / Agent Lifecycle & State Machine Invariants
- **Truth State:** Confirmed root cause
- **Enforcement Rung:** Check (`get-fable` stop hook & state transition gates)
- **Primary Source:** `.fable/state.json`, `.gemini/config/plugins/get-fable/`
- **Quote:** `"Stop hook blocked termination: [get-fable] BLOCKED stop: substantial work has current verification evidence but durable workflow phase is 'idle', not 'complete'. Finish verification and transition with get-fable state complete."`

---

## 1. Problem Description & Symptoms
During an agent session involving code changes, the agent attempted to complete its turn to report results and await user feedback. However, the `get-fable` stop hook intercepted and blocked the agent from terminating:
```text
Stop hook blocked termination: [get-fable] BLOCKED stop: substantial work has no fresh passing completion evidence for the current mutation generation. Record proof with `get-fable evidence pass <kind> <source> <detail>` after verifying the requested behavior.
```
After recording evidence, a second termination attempt was blocked:
```text
Stop hook blocked termination: [get-fable] BLOCKED stop: substantial work has current verification evidence but durable workflow phase is 'idle', not 'complete'. Finish verification and transition with `get-fable state complete`.
```

## 2. Root Cause Analysis
- **Mutation Invalidation:** Any substantial workspace mutation (file writes, edits, installations) automatically increments `mutationGeneration` in `.fable/state.json`, immediately rendering older verification evidence stale (`verifiedGeneration < mutationGeneration`).
- **State Machine Transition Constraints:** Fable's lifecycle state machine strictly prohibits direct jumps from `executing` to `complete`. A transition to `complete` is permitted **only** when the state machine is currently in the `verifying` phase with matching verification generation.
- **Turn Termination Guard:** The stop hook fails closed to ensure an agent never leaves the repository in an unverified or transitional state without recorded proof.

## 3. Smart Solution & Architectural Rectification
The canonical protocol for completing mutations under `get-fable` requires the following deterministic steps:
1. **Transition to Verifying:**
   ```bash
   get-fable state verifying
   ```
2. **Execute Required Tests / Security Scans:**
   Run full verification (`bun test`, `cd ui && bun test:ui`, `bun run security:audit`).
3. **Record Typed Passing Evidence:**
   Record proof matching the active mutation generation:
   ```bash
   get-fable evidence pass test "bun test" "162 pass across 41 files; OSV and pip-audit clean"
   ```
   This advances `verifiedGeneration` to equal `mutationGeneration`.
4. **Transition to Complete:**
   ```bash
   get-fable state complete
   ```
   Now the phase is `complete` and `verifiedGeneration == mutationGeneration`, cleanly satisfying the stop hook invariant.

## 4. Verification Proof
- `get-fable state` transitioned cleanly: `executing -> verifying -> complete`.
- Hook execution permitted immediate termination with zero blocks.
