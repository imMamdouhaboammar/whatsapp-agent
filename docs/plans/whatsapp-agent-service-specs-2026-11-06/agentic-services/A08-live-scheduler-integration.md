# A08 Proactive Engagement: Live Scheduler Integration

## Implemented boundary

- `FollowUpStore` durably records due triggers, contact opt-outs, cancellations, deferrals, dispatch claims, ambiguous provider outcomes, and verified delivery receipts in SQLite
- `ProactiveEngagementScheduler.runOnce(now, limit)` scans due triggers, evaluates current permission/relevance, atomically claims one submission, and reconciles ambiguous S01 intents without resubmitting
- `start({ signal, intervalMs, now, onError })` runs the scanner immediately and periodically until aborted, default interval 30 seconds
- `onCustomerMessage({ brandId, contactId, text })` cancels pending messages for the canonical contact, emits `engagement.replied`, and persists an opt-out on explicit STOP/unsubscribe variants
- Permanent rejections are terminal and audited via `decision_reason`; temporary deferrals move the next due time forward 15 minutes to prevent starvation of eligible contacts
- There are no direct WhatsApp transport calls inside A08, no owner approval step for individual eligible messages, and no sender fallback to Baileys

## Required S01 template action bridge (not connected by this branch)

The current S01 delivery ledger accepts text/voice. Extend it with a durable **template** action before enabling the A08 polling loop in application startup.

`ProactiveTemplateIntentSender.submit(command)` must create or reuse one S01 intent using the unique source identity, commit it before any provider network request, and use its stored state for all retries/reconciliation. A08 will not call `MetaCloudApi.sendTemplate` itself.

| Command field | Consumer and requirement |
| --- | --- |
| `sourceKind: autopilot`, `sourceId: a08:<triggerId>`, `sourceRevision: 1`, `idempotencyKey` | Unique S01 action identity, persistent across process restarts and duplicate due scans |
| `actionKind: template`, `triggerId`, `sourceWorkflowId`, `reason` | A08 traceability, business event reference and action type |
| `brandId`, `contactId`, `contactJid` | Brand-scoped S07 canonical identity and verified channel address; the bridge resolves the Meta Cloud recipient phone |
| `consentRef`, `optedInAtMs` | Lookup actual opt-in evidence; revocation must be checked again at S01 submission time |
| `templateRef`, `template.name`, `template.languageCode`, `template.components` | Approved template catalog identity and exact payload recorded in S01 before sending |
| `relevanceVerifiedAtMs`, `expiresAtMs` | Current business evidence, freshness bound, and durable send deadline/TTL |
| `quietHours.from`, `quietHours.to`, `quietHours.timeZone` | Brand-local send restrictions, checked again when S01 actually dispatches |

`ProactiveTemplateComponent` matches the initial official Meta adapter shape: `{ type: 'header' | 'body'; parameters: Array<{ type: 'text'; text: string }> }`. Media and button variants need explicit future support in both adapters.

**Adapter mapping:** after persisted S01 intent creation and fresh final permission checks, pass `{ to, template: { name, languageCode, components }, eligibility: { optedInAtMs, approvedTemplate: true } }` to `MetaCloudApi.sendTemplate`. Save its native `wamid` as S01/provider receipt. Never send a freeform Baileys message for a Meta proactive template. The S01 bridge must also enforce template approval and consent at the precise outbound attempt, including queued work.

`ProactiveTemplateIntentSender.lookup(identity)` must be **read only**: find the existing S01 intent by source identity and return its state and provider receipt, without calling a transport. A08 moves `attempting` / `uncertain` to `sent` only after observing an accepted/delivered/read provider receipt; otherwise it remains unresolved and never resubmits blindly.

## Business evidence callback

The runtime supplies `eligibility(trigger, now)` using real brand/customer state, rather than hardcoded booleans:

1. Verify a real, current contact opt-in, matching the trigger's `consentRef`
2. Resolve the canonical S07 contact JID; verify the official Meta channel and approved template
3. Recheck the originating business workflow: order status, quote terms, appointment availability, case state, or customer-requested reminder
4. Return `relevance.relevant`, `sourceWorkflowId`, `verifiedAtMs`, and `expiresAtMs` based on that actual workflow
5. Provide the actual brand timezone, quiet hours, consent timestamp, and approved template payload

A08 fails closed on missing, future-dated, expired, irrelevant or mismatched evidence. A queued S01 intent must independently recheck the same permissions and TTL immediately before network delivery. A08's in-process callback is an initial policy decision, not a substitute for S01's final delivery gate.

## Runtime attachment

After S01 template support and official Meta credentials are available:

```ts
const controller = new AbortController();
const followUps = new FollowUpStore({ dbPath: durableFollowupPath });
const proactive = new ProactiveEngagementScheduler({
  store: followUps,
  eligibility: checkCurrentBusinessEvidence,
  sender: s01TemplateIntentBridge,
  onEvent: appendEngagementEvent
});
void proactive.start({ signal: controller.signal, onError: reportSchedulerError });

// In the authenticated inbound coordinator after S07 identity resolution:
proactive.onCustomerMessage({ brandId, contactId, text: inboundText });
// Forward the inbound conversation and workflow context to A05 as appropriate.

// On graceful shutdown:
controller.abort();
await runnerCompletion;
followUps.close();
```

Keep the returned `start` promise as `runnerCompletion`; do not close the store while a send attempt is in flight. The sample is intentionally wiring-only and performs no real outbound messaging.

## Verification

```sh
bun test tests/proactive-scheduler.test.ts tests/follow-ups.test.ts --reporter=dot
bunx tsc --noEmit
cd ui && bun run test:ui && bun run build
```

The A08 tests cover current relevance and expiry, Meta/template/consent checks, quiet hours, due-scan fairness, concurrent one-send claims, persisted restart reconciliation, inbound replies and explicit opt-outs, periodic polling, and audit reasons. Network responses are stubbed; no live Meta or WhatsApp messages are sent.
