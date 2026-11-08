# Meta WhatsApp Cloud API Adapter (B02)

Status: typed transport adapter and local contract tests are ready. It is **not wired to live HTTP routes or credentials**. S01 owns durable outbound idempotency and the application owns brand credential lookup.

## Integration contract

Source: `src/transport/meta-cloud-api.ts`

- `new MetaCloudApi({ config, fetch?, now?, onEvent? })` binds one brand's specific WhatsApp Business Account ID and phone number ID
- `sendText({ to, text, lastInboundAtMs })` permits free-form replies only inside a 24-hour customer service window established by a verified inbound message
- `sendTemplate({ to, template: { name, languageCode, components? }, eligibility: { optedInAtMs, approvedTemplate } })` requires verified opt-in evidence and an approved template. The initial component implementation intentionally supports text header/body parameters only
- Both outbound methods return `{ messageId }` with Meta's **native** `wamid` after a confirmed successful API response, or throw `MetaCloudTransportError` with code `WHATSAPP_ACCEPTANCE_AMBIGUOUS`. The adapter never invents message IDs
- `handleWebhookGet(Request): Response` verifies Meta's subscription challenge
- `handleWebhookPost(Request): Promise<Response>` verifies the exact raw HTTP body with `X-Hub-Signature-256` before parsing, checks both WABA and phone number ID, and invokes the injected `onEvent` for verified inbound text, sent/delivered/read receipts, and separate failed deliveries
- `onEvent` must durably persist each event before resolving. A missing or failing callback returns HTTP 503 to permit Meta retry

## Production wiring requirements

1. At startup, load access token, app secret, webhook verification token, WABA ID and business phone number ID **only on the server** from an approved secret store. Do not put these values in UI state, logs, browser bundles, or diagnostic exports
2. Route Meta verification GET and webhook POST to the adapter for the matching configured brand account. Preserve the **raw POST body**. Do not pre-parse it in middleware
3. Feed verified inbound events to the existing inbound ingestion path, preserving Meta's original message ID and timestamp for the customer service window
4. For sends, persist and claim the S01 intent first, then call the adapter via the S01 transport sender. A08 scheduled templates must reach this same durable intent path. Map returned `messageId` to the ledger only after an accepted Meta response. An uncertain response remains uncertain pending reconciliation
5. Correlate signed receipt events to existing S01 accepted intent by **chat ID + native ID**. A read receipt should never regress to delivered/sent. Handle `delivery_failed` separately without pretending it is an accepted or read receipt
6. Keep brand credentials and webhook identity isolated per brand. This adapter intentionally requires both `businessAccountId` and `phoneNumberId` to process POST webhooks
7. Provision approved templates, valid opt-ins, Graph API version and token rotation in Meta's business setup before live sending. The caller must derive `eligibility` from trusted records; the adapter validates the typed evidence but cannot validate a third-party consent record by itself

## Security and delivery boundaries

- Exact-byte HMAC-SHA256 with constant-time comparison; missing/malformed/invalid signatures are rejected before JSON parsing
- A 1 MiB bounded request stream stops reading and cancels the body on overflow, including when `Content-Length` is absent
- A signed webhook with a wrong WABA/phone identity is rejected; unknown message statuses are ignored
- Native IDs are preserved, including genuine padded Base64 `wamid` strings
- Recent duplicate events are suppressed in one adapter instance and concurrent callbacks are serialized, capped at 10,000 recent events. **Process restarts and multiple instances require durable deduplication in the application's event store**
- Callback failures trigger retry, and provider error messages/tokens are never echoed. HTTP acceptance still does not guarantee final WhatsApp delivery
- Live network sends were **not** attempted; test transports use injected mock fetch

## Meta-owned protocol references

- [Official WhatsApp Cloud API Postman collection](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api)
- [Meta Cloud API send-message examples](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
- [WhatsApp webhook verification, Meta's official archived SDK reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
