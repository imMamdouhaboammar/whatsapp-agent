# Meta Cloud webhook HTTP route contract

Implementation: `src/server/meta-cloud-routes.ts`

## API

`registerMetaCloudWebhookRoutes(app, meta)` registers two public HTTP routes on an existing Hono instance:

| Request | Route | Contract |
| --- | --- | --- |
| GET | `/webhooks/meta` | Meta's `hub.mode`, `hub.verify_token` and `hub.challenge` verification, returning the exact challenge when accepted |
| POST | `/webhooks/meta` | The original raw HTTP Request reaches `MetaCloudApi.handleWebhookPost` without prior body parsing. A signed, bounded and correctly bound event is acknowledged only after its callback resolves |

`meta` must satisfy the exported `MetaCloudWebhookRouteHandler` type, which contains `handleWebhookGet(Request)` and `handleWebhookPost(Request)`. The usual implementation is one `MetaCloudApi` per configured WhatsApp Business Account and business phone number.

The route wrapper catches unexpected adapter exceptions and responds with generic HTTP 503. The adapter retains the specific 200/400/401/403/413/503 behavior and its HMAC, identity, payload limit, deduplication and callback handling.

## Integration seam for `src/index.ts`

The application integration owner should attach this after creating the Hono app, with a server-only credential source and a durable event sink:

```ts
const meta = new MetaCloudApi({
  config: await brandCredentials.loadForConfiguredPhone(),
  onEvent: async event => {
    // Durable event processing, scoped to this brand and native message ID.
    await durableMetaEventSink.process(event);
  }
});

registerMetaCloudWebhookRoutes(app, meta);
```

The example names `brandCredentials` and `durableMetaEventSink` are integration ports, not modules provided by this PR.

For `inbound_text`, persist and deduplicate before routing to the inbound messaging workflow. For `receipt`, correlate the existing S01 intent by chat ID and native `wamid`, preserving monotonic sent/delivered/read states. For `delivery_failed`, persist the failure separately from a delivery-success receipt.

Keep the callback asynchronous and do not return success until its durable operation has completed. If persistence or reconciliation fails, reject the callback so Meta can retry. The adapter's in-process cache of recent events is bounded and does not replace durable dedup across process restarts or multiple instances.

## Deployment boundary

- Meta verification and delivery requests are service-to-service traffic. They cannot use an owner's dashboard cookie or browser CORS identity; GET is authenticated by the verify token and POST by raw-body HMAC-SHA256
- The route lives at `/webhooks/meta`, outside the existing dashboard `/api/*` authentication scope
- Forward the exact raw request bytes, including whitespace. Do not add JSON middleware that consumes/reconstructs the request before verification
- Bind both WABA ID and Meta phone-number ID to the adapter's configuration. Do not reuse a credential-bearing adapter across unrelated brands or silently route a signed webhook for another identity
- Configure a public HTTPS reverse-proxy path and ensure forwarding preserves the `X-Hub-Signature-256` header
- The tests use locally generated HMAC signatures and an injected no-network fetch. They do not provision a Meta webhook or send messages
- This PR only registers a route helper. The application entry point and live callbacks remain an explicit integration step owned by the host

See [Meta Cloud API adapter](./meta-cloud-api-adapter.md) for the outbound and provider event contract.
