# FL-053: Stale Async UI Request Fencing, Explicit Transport Capabilities & Sync Health

## Context
React cockpit UI (`ui/src/App.tsx`, `ui/src/api/client.ts`, `ui/src/components/ChatThread.tsx`) and transport capability negotiation (`src/transport/capabilities.ts`, `src/transport/meta-cloud-api.ts`, `ui/src/lib/capabilities.ts`, `ui/src/lib/dashboard-sync.ts`) across WA-020, WA-024, and WA-026.

## What happened
1. **Stale Chat Request Overwrites (WA-020)**: Switching conversations rapidly allowed an older in-flight chat fetch to resolve after a newer selection and overwrite the active conversation view.
2. **Implicit Transport Capabilities (WA-024)**: Transport differences (e.g., Meta Cloud API vs. Baileys reactions/unsupported content) were not modeled as an explicit capability contract, causing UI controls or inbound unsupported content to behave ambiguously.
3. **Sync Health Blindness (WA-026)**: Transient dashboard sync failures did not model sync health explicitly or preserve last-known-good state cleanly in the UI.

## Observable symptom
- Selecting Chat B quickly after Chat A briefly showed Chat A's messages inside Chat B.
- UI offered unsupported transport actions or hid unsupported inbound content without clear indicators.
- Sync errors degraded dashboard visibility instead of surfacing sync health while keeping last-known-good data.

## Impact
- Operator confusion, risk of replying in the wrong conversation context, and silent capability/sync failures in the cockpit.

## Incorrect assumption
1. Assuming HTTP responses always arrive in the order requests were dispatched.
2. Assuming all WhatsApp transports support identical message/reaction features.
3. Assuming transient poll errors can simply overwrite or clear rendered dashboard state.

## Root cause
- **Confirmed**:
  1. `ui/src/App.tsx` lacked a request-epoch coordinator to discard stale async chat responses.
  2. Neither backend transport (`src/transport/capabilities.ts`) nor frontend (`ui/src/lib/capabilities.ts`) exposed a shared explicit capability contract.
  3. Dashboard sync state lacked a dedicated state machine (`ui/src/lib/dashboard-sync.ts`) preserving last-known-good data on error.

## Why the architecture allowed it
UI state was managed directly via ad-hoc `useEffect` fetches and boolean flags without request-sequence fencing or explicit state-machine modules.

## Fix
1. **Chat Request Fencing (WA-020)**: Introduced `ChatRequestCoordinator` (`ui/src/lib/chat-request-coordinator.ts`) to discard stale responses from superseded conversation selections.
2. **Explicit Capability Contract (WA-024)**: Added `src/transport/capabilities.ts` and `ui/src/lib/capabilities.ts` to expose transport capabilities and surface unsupported content explicitly in `ChatThread.tsx`.
3. **Explicit Sync Health Modeling (WA-026)**: Added `ui/src/lib/dashboard-sync.ts` to track sync status explicitly and retain last-known-good data on failure.

## Verification
Verified by unit test suites:
- `cd ui && bun test tests/chat-request-coordinator.test.ts tests/capabilities.test.ts tests/dashboard-sync.test.ts`
- `bun test tests/transport-capabilities.test.ts`

## Prevention rule
Async conversation loaders MUST fence responses through `ChatRequestCoordinator` (or equivalent epoch token), transport features MUST be gated by the explicit `capabilities` contract, and UI sync polling MUST preserve last-known-good data while surfacing sync health explicitly.

## Reusable lesson
Model async UI fetches, transport capabilities, and polling health as pure, unit-testable state coordinators outside React components so race conditions and degraded states are deterministic.

## Related code
- `ui/src/lib/chat-request-coordinator.ts`
- `ui/src/lib/capabilities.ts`
- `ui/src/lib/dashboard-sync.ts`
- `src/transport/capabilities.ts`
- `src/transport/meta-cloud-api.ts`
- `ui/src/api/client.ts`
- `ui/src/components/ChatThread.tsx`

## Related tests
- `ui/tests/chat-request-coordinator.test.ts`
- `ui/tests/capabilities.test.ts`
- `ui/tests/dashboard-sync.test.ts`
- `tests/transport-capabilities.test.ts`

## Status
Resolved
