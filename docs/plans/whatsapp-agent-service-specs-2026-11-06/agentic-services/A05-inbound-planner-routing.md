# A05 Inbound WhatsApp Auto-Pilot Routing

## Integration status

The opt-in inbound router is implemented as `src/agent/inbound-planner.ts` and attached to `AgentTurnCoordinator` through an optional `planner` dependency. Existing moderation and read-only inventory behavior are unchanged when the router is disabled. No `src/index.ts` or S01 transport files are modified in this branch

## Exact root integration

In `src/index.ts`, import:

```ts
import { createInboundPlanner } from './agent/inbound-planner';
```

Before the existing `new AgentTurnCoordinator(...)` call:

```ts
const inboundPlanner = createInboundPlanner({
  planner: capabilities.planner,
  registry: capabilities.registry,
  dataDir,
  brandId: options.capabilityAutopilotBrandId ?? process.env.AGENT_AUTOPILOT_BRAND_ID
});
```

Pass `planner: inboundPlanner` as an additional property in the existing coordinator dependency object. When adding coordinated shutdown, call `inboundPlanner?.close()` to release the inbound SQLite connection. Leave the S01 send-intent boundary unchanged: `shouldSendImmediately` uses its durable, idempotent outbound path. The existing transport already excludes historical messages and previously persisted message IDs before pushing them into the burst accumulator

The optional coordinator call `processInboundMessage(message, {historical:true})` or `{replayed:true}` also fails closed with `action:'ignore'`, without running any provider or moderator actions

## Owner configuration

Set the following environment variables for one explicitly selected brand:

```env
AGENT_AUTOPILOT_BRAND_ID=shop
AGENT_PLANNER_INBOUND=1
AGENT_PLANNER_BRAND_ID=shop
AGENT_PLANNER_ALLOWED_SCOPES=orders:read,tickets:write
AGENT_PLANNER_ALLOW_WRITES=1
AGENT_PLANNER_MAX_STEPS=5
```

The two brand IDs must agree. The planner stays disabled if the opt-in flag, exact owner brand, scope list or planner instance is missing. A scope must be a concrete `service:permission` string, without wildcards. All configured scopes must correspond to registered tools for that brand. Only `AGENT_PLANNER_ALLOW_WRITES=1` permits configured write tools. The example order and ticket tools are fixture adapters; production adapters must be connected and trusted before exposing their scopes

`AGENT_PLANNER_MAX_STEPS` accepts 1 through 8; default is 5. No per-action owner approval is requested when a permitted provider operation runs in Autopilot mode

## Inbound behavior

1. Only live, individual text messages in an Autopilot chat reach the planner. Human/Copilot modes, own messages, groups and unsupported content retain the existing moderator behavior
2. Every inbound ID is atomically claimed in `inbound_planner_turns`, scoped by brand and chat. An already claimed message ID returns `ignore`, including after process restart
3. Workflow IDs are deterministically derived from brand, chat and message IDs. BoundedPlanner performs owner-scope tool routing, argument/result validation, provider receipt checks and durable ActionJournal write reconciliation
4. Confirmed provider evidence yields one automatic WhatsApp reply through the existing outbound send-intent handling. An unresolved provider result yields an explicit uncertainty response, with no retry of the write
5. A single safe clarification question may be returned without provider evidence. Requests for passwords, secrets, tokens, verification codes or card data defer to existing moderation. Unrecognized or unsupported tasks also fall back to moderation
6. The coordinator serializes per-chat turns; other chats can run concurrently

`inbound_planner_turns` stores brand/chat/message IDs, a deterministic workflow ID and status only. Customer message text and credentials are not stored in this replay ledger

## Offline acceptance

- Fixture goal: customer requests order 441 status and a support ticket
- Mock provider sequence: `order.lookup` reports delayed; `ticket.create` returns `providerReceiptId=T-441`
- Outcome: automatic reply includes the confirmed ticket receipt; no owner click or live WhatsApp transport is required
- Duplicate same message and same message ID after SQLite reopen: no second tool call, no second reply
- Historical/replayed metadata, human/copilot modes, group chats and own messages: no planner writes
- Write disallowed through owner env: model prompt cannot grant permission
- Provider timeout: one uncertain write, explicit waiting reply, no blind replay
- Missing details: one bounded clarification; sensitive credential request defers to moderator

Verification uses `bun test tests/inbound-planner.test.ts tests/agent-turn-coordinator.test.ts`, root `bun test`, `bunx tsc --noEmit`, UI production build, Bug Killer, and Fable lifecycle gates

## Remaining production connection

The route is ready to receive actual WhatsApp turns once root wires the optional dependency and enables owner settings. End-to-end provider mutations were exercised only against deterministic test fixtures; no external ticket creation or WhatsApp send was performed. Real provider adapters must enforce customer identity and supply reconciliation callbacks and reliable receipts
