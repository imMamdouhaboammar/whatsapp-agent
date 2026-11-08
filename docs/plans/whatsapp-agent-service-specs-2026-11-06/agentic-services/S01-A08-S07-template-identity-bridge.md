# S01 + A08 + S07: durable Meta template and recipient identity bridge

## Runtime preconditions

This branch extends `src/domain/send-ledger.ts` and `src/domain/send-intent-service.ts`, without modifying application startup. The integration owner must configure:

- One durable `MemoryStore({ dbPath })` for S01 send intent, attempts and receipts. Never use `:memory:` for production state
- One durable `ContactIdentityDirectory({ dbPath: identityDbPath, verifyEvidence })` for S07, instantiated with an independently persistent identity database and trusted relationship verifier
- One `SendIntentService` per brand, with `brandId` supplied by trusted brand configuration, `recipientDirectory`, `sendTemplate` connected to the official Meta Cloud adapter, and `verifyTemplateEligibility` backed by current brand/provider/business records
- A08 `ProactiveEngagementScheduler` started only after those dependencies are ready, with authenticated inbound replies and STOP forwarded using S07 canonical contact identity

When a recipient directory is configured, it is required for **every** outgoing action. Text and voice also capture the immutable S07 `RecipientBinding` at queue creation and revalidate that exact binding immediately before network dispatch, after any awaited voice synthesis. An unbound legacy queued intent or a changed identity becomes terminal `failed`, reason `recipient_binding_changed`, with no network call. Source IDs, chat IDs and contact IDs are never silently remapped.

## Injectable SendIntentService options

```ts
const service = new SendIntentService({
  memoryStore,
  brandId: trustedBrandId,
  recipientDirectory: contactDirectory,
  sendText: baileysSendText,
  prepareVoice: voiceSynthesis,
  sendVoice: baileysSendVoice,
  sendTemplate: ({ to, template, eligibility }) =>
    metaCloudApi.sendTemplate({ to, template, eligibility }),
  verifyTemplateEligibility: async (intent, now) =>
    trustedBrandPolicyAndProviderEvidence(intent, now)
});
```

`recipientDirectory` requires `brandId`. Without a directory, old text/voice behavior stays compatible. An official proactive template requires all of `recipientDirectory`, `sendTemplate`, and `verifyTemplateEligibility`; the service rejects an incomplete configuration.

The `sendTemplate` adapter argument is structurally identical to `MetaCloudTemplateRequest`:

```ts
{
  to: string; // E.164 digits, derived from S07-verified phone JID
  template: {
    name: string;
    languageCode: string;
    components?: Array<{
      type: 'header' | 'body';
      parameters: Array<{ type: 'text'; text: string }>;
    }>;
  };
  eligibility: { optedInAtMs: number; approvedTemplate: boolean };
}
```

The `approvedTemplate: true` value sent to Meta comes only **after** `verifyTemplateEligibility` confirms the actual approved name/language, matching consent evidence and fresh workflow state. A caller-supplied boolean is never used as authorization.

## A08 to S01 intent mapping

`ProactiveTemplateIntentSender.submit(command)` should call:

```ts
const input: SendTemplateIntentInput = {
  sourceKind: 'autopilot',
  sourceId: command.sourceId,
  sourceRevision: command.sourceRevision,
  actionKind: 'template',
  chatId: command.contactJid,
  text: '',
  policyRevision: currentBrandPolicyRevision,
  expiresAt: command.expiresAtMs,
  template: command.template,
  templateEligibility: {
    consentRef: command.consentRef,
    optedInAtMs: command.optedInAtMs,
    sourceWorkflowId: command.sourceWorkflowId,
    relevanceVerifiedAtMs: command.relevanceVerifiedAtMs,
    quietHours: command.quietHours
  }
};
const { intent } = await service.sendTemplate(input);
return {
  intentId: intent.id,
  state: intent.state,
  providerMessageId: intent.nativeMessageId
};
```

The service captures and persists `recipientBinding` via `ContactIdentityDirectory.bindRecipient({ brandId, jid })`. Do not accept a caller-crafted binding as a substitute. Template payload, evidence, immutable recipient identity, expiry and revision are stored in the send ledger's `payload_json` and covered by its payload hash. The existing unique constraint over `(source_kind, source_id, source_revision, action_kind)` gives durable idempotency. Reusing the identity with changed content or evidence raises `SendIntentConflictError`.

`ProactiveTemplateIntentSender.lookup(identity)` must use `memoryStore.getSendLedger().getBySource({ sourceKind, sourceId, sourceRevision, actionKind: 'template' })` **read only**. Do not redispatch or create a new intent during reconciliation. On accepted Meta response, the S01 ledger records its native `wamid`. An ambiguous provider outcome remains `uncertain` across restarts; `retryUncertain` explicitly rejects template actions.

## Trusted live authorization

`verifyTemplateEligibility(intent, now)` returns `VerifiedTemplateAuthorization`:

```ts
{
  consentRef: string;
  optedInAtMs: number;
  approvedTemplate: { name: string; languageCode: string };
  sourceWorkflowId: string;
  relevant: boolean;
  relevanceVerifiedAtMs: number;
  relevanceExpiresAtMs: number;
  quietHours: { from: number; to: number; timeZone: string };
}
```

Resolve this evidence from authoritative brand state and source workflow (shipment, quote, appointment, support case). It must match the stored consent reference, opt-in timestamp, template name/language and workflow ID. `relevant` must still be true, live verification must be at most five minutes old, and the trusted relevance expiry must be in the future. Current trusted brand quiet hours are applied at dispatch, even if a queue snapshot previously had different hours. Queue evidence itself must be at most five minutes old and template TTL is capped at one hour.

If live authorization is missing, revoked, expired, incompatible, or within quiet hours, the attempt ends as `failed` with reason `template_policy_denied` without contacting Meta. If the transport might have started, an error is `uncertain` and never silently replayed. A proactive template can start a contact with no previous chat record once all trusted checks pass, while freeform autopilot text/voice remain blocked in Human and Co-Pilot chat modes.

## Native provider failure receipts

On the authenticated Meta webhook callback, pass a correlated delivery-failure status through `sendIntents.deliveryFailed(chatId, nativeWamid)`. This marks a previously `accepted` or `delivered` intent as terminal `failed`, audits `provider_delivery_failed` and publishes the send-intent state. Duplicate failure callbacks, unrelated native IDs and previously `read` messages are ignored. No retry is scheduled by this transition.

## Regression proof

```sh
bun test tests/send-template-identity-bridge.test.ts tests/send-intents.test.ts --reporter=dot
bunx tsc --noEmit
```

Tests cover durable native `wamid` and payload state, duplicate suppression and changed-source conflicts, ambiguous outcome without resending, immutable S07 recipient binding across identity merge, voice synthesis race, legacy queued item fail-closed migration, revoked consent, verified brand quiet hours, and first-contact template autonomy without weakening existing text/voice mode protection. All network calls in these tests are injected fakes.
