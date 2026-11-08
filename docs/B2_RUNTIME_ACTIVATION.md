# Batch 2 runtime activation and data boundaries

This page describes the combined runtime after B2 WCF, A08 proactive follow-ups, Meta Cloud API, S07 identity, the staged PostgreSQL work, and A05 Planner. It is a deployment checklist, not evidence of a live Meta account or a completed PostgreSQL cutover.

## Choose a transport

Existing Baileys behavior remains the default. Set `WHATSAPP_TRANSPORT=meta-cloud` for an official WhatsApp Business Cloud API account. The Meta startup refuses a partially configured account. Supply all of the following from a server-side secret manager:

```sh
WHATSAPP_TRANSPORT=meta-cloud
AGENT_AUTOPILOT_BRAND_ID=store
META_CLOUD_GRAPH_VERSION=v23.0
META_CLOUD_PHONE_NUMBER_ID=<phone-number-id>
META_CLOUD_BUSINESS_ACCOUNT_ID=<business-account-id>
META_CLOUD_ACCESS_TOKEN=<secret>
META_CLOUD_APP_SECRET=<secret>
META_CLOUD_VERIFY_TOKEN=<secret>
```

Only use the Graph version supported by the connected account. Configure the Meta webhook URL at `https://<public-host>/webhooks/meta` and the matching verify token. The application checks the HMAC signature on the original POST bytes before accepting messages or receipts. It rejects `/api/connect` and `/api/disconnect` in Meta mode; Baileys sessions are not started. The status endpoint includes `transportMode`.

Inbound Meta text is persisted with its native `wamid` and replay suppression, then processed by the existing burst/coordinator path. Meta delivery receipts update the S01 ledger, and failed receipts mark a previously accepted send failed without an automatic replay. Free-form Meta replies require a verified inbound message from the previous 24 hours. Voice note delivery remains a Baileys-only option.

## S07 recipient identity

Meta mode opens `contact-identity.sqlite` next to the primary SQLite data. Authenticated inbound phone JIDs are observed and mapped to immutable per-brand contact IDs. The S01 ledger captures a precise recipient binding on every new outbound send and rechecks it immediately before network dispatch. No nickname, phone fragment, model output, or unverified identity merge can change a destination. Outbound sends to unknown aliases fail closed. Configure any identity-merge evidence verifier in trusted owner/provider code; no permissive verifier is installed by default.

Use a persistent `DATA_DIR` in production. The `:memory:` mode shown in automated tests is disposable.

## A08 proactive template sends

Scheduling is available through the authenticated brand follow-up API. A scheduler is created only for Meta Cloud mode **and** only when the host injects a trusted `proactiveEligibility(trigger, now)` provider into `createFableWhatsAppAgent`. No such provider is invented by startup or constructed from the customer's WhatsApp message.

The trusted provider must consult current opt-in records, approved template name and language, current workflow relevance and expiry, recipient phone JID, brand quiet hours and timezone. The scheduler checks it when a trigger becomes due. The S01 ledger then performs a second live check after persisting and claiming the exact template intent. The consent reference and opt-in timestamp must match the immutable queued evidence. A revoked policy, changed recipient or unavailable evidence prevents the Meta request.

```ts
const agent = await createFableWhatsAppAgent({
  transport: 'meta-cloud',
  autoConnect: true,
  capabilityAutopilotBrandId: 'store',
  proactiveEligibility: async (trigger, now) => trustedBusinessEvidence(trigger, now)
});
```

`trustedBusinessEvidence` is an integration owned by the deployment, and must return the `ProactiveEligibility` contract from `src/agent/proactive-scheduler.ts`. A signed inbound customer reply cancels pending follow-ups for the canonical contact, and a signed STOP or equivalent opt-out prevents future scheduling. The provider's native `wamid` is saved as the S01 acceptance receipt. An ambiguous send is not retried automatically. Call `agent.stopProactiveScheduler()` before shutting down the host.

Templates must already be approved in the actual Meta Business account. This code does not approve templates or establish consent by itself.

## A05 inbound planner

To route eligible incoming messages through the brand's registered capabilities, explicitly configure:

```sh
AGENT_PLANNER_INBOUND=1
AGENT_PLANNER_BRAND_ID=store
AGENT_PLANNER_ALLOWED_SCOPES=inventory:read
AGENT_PLANNER_ALLOW_WRITES=0
AGENT_PLANNER_MAX_STEPS=5
```

The selected planner brand must match the runtime owner brand. The declared scopes must match actual registered tools; unconnected or disallowed scopes leave the existing moderator flow in place. Writes are disabled unless the owner enables them and relevant provider tools implement verified receipts. Inbound planner replays are tracked by brand/chat/message in `inbound-planner.sqlite`.

## WCF and PostgreSQL

WCF adds `conversation_folds`, `conversation_fold_messages`, and `conversation_fold_sources` inside `fable_whatsapp.db`. The historical PostgreSQL importer recognizes only 16 old source tables and deliberately refuses any unaccounted tables or new SQLite files. Combined inventory:

| Source | Tables | SQLite databases |
| --- | ---: | ---: |
| Original S0 | 16 | 7 |
| Existing learning plus S01 ledger | +5 | 0 |
| WCF | +3 | 0 |
| Optional persistent S07 identity | +4 | +1 |
| Optional enabled A05 inbound planner | +1 | +1 |
| Combined, when both options are active | **29** | **9** |

A08 follow-ups extend two previously counted tables. Inventory and exact source locations must be checked against the actual deployment. There is **no verified end-to-end PostgreSQL runtime cutover** for these stores. `DATASTORE=postgres` fails closed; do not force it. No production database import, external WhatsApp send or identity migration was performed during this batch.

## Verification

```sh
bun test
bunx tsc --noEmit
bun run build
```

The Meta integration tests use fake network responses and signed webhook fixtures. Before a real Meta deployment, validate account onboarding, template approval, app-secret rotation, webhook retries, provider rate limits, business data evidence and recoverable shutdown in a separate test account.
