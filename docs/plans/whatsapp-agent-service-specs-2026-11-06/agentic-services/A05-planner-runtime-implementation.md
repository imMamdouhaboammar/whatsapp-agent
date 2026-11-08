# A05 Autonomous Planner Runtime | Batch 2 implementation

## Runtime behavior

The owner-authenticated `POST /api/agent/plan` route drives the bounded, brand-scoped planner with a connected Gemini model. An authorized brand owner supplies a goal and owner-approved scopes; the customer message never grants tool authority. Registered tools must belong to that brand, be permitted by the scopes, declare a JSON input schema, and respect the explicit `allowWrites` flag

The planner:

1. Chooses at most one declared tool per model step, up to five steps by default and eight at most
2. Checks model-provided tool arguments against the manifest schema and the tool's own validator
3. Executes through the brand's registered provider adapter
4. Checks optional provider-result schema before accepting returned evidence
5. Journals each write with stable workflow and per-step idempotency keys in SQLite
6. Reconciles uncertain writes with the external provider before ever treating a repeated call as confirmed
7. Refuses success claims for write operations without provider-returned receipt references
8. Serializes concurrent turns per brand-contact, including when two planner instances share a tool registry

No owner click is required for a routine write already authorized in the request. An uncertain provider outcome stays in `waiting_provider` and is never blindly retried. The API itself does not send a WhatsApp message

## Owner API

`POST /api/agent/plan`

Required header: `x-agent-owner-token` matching the configured `AGENT_CAPABILITIES_OWNER_TOKEN`

Example payload:

```json
{
  "brandId": "brand-a",
  "contactId": "customer-441",
  "goal": "Check order 441 and create a support ticket if delayed",
  "allowedScopes": ["orders:read", "tickets:write"],
  "allowWrites": true,
  "workflowId": "case-441",
  "maxSteps": 5
}
```

Allowed scopes come from authenticated owner policy, never WhatsApp input. All requests are checked for valid brand/contact/goal, well-formed scopes, bounded optional fields, and boolean write permission. Tools registered for a different brand are invisible

The response contains `status`, `reply`, `workflowId`, and an `evidence` array; confirmed writes carry `providerReceiptId`. A retry with the same workflow ID and matching identity can reconcile an uncertain write; changing the brand, contact, or goal for that workflow ID fails

## Fixture acceptance and verification

- Offline end-to-end test: mock provider looks up order 441, then creates a support ticket with receipt `T-441`. The API returns `completed`, two evidence items, and the receipt, with WhatsApp auto-connect disabled
- Restart test: a write becomes uncertain, SQLite is closed and reopened, and the external reconciliation callback returns a receipt without a second write
- Security tests: conflicting workflow identities and idempotency keys fail, malformed JSON schemas fail, unknown brand tools fail, malicious tool-output instructions cannot grant write authority
- Concurrency tests: overlapping turns for one brand-contact are serialized, while separate contacts run concurrently
- Full `bun test`: 277 passed, 2 skipped (unconfigured Supabase integration), 0 failed, 1,031 assertions, 50 files
- `bunx tsc --noEmit`: passed
- `cd ui && bun run build`: passed, existing large bundle warning
- `bk security scan --profile project --changed-only --fail-on medium .`: zero findings
- `get-fable` evidence: verified generation matches mutation generation at push time

## Known integration boundaries

The provider execution boundary is real code, but the example support-ticket provider is a deterministic test fixture. Production ticket/order adapters require their own authenticated connectors, declared permission scopes, reconciliation callbacks and provider receipt validation before live writes are enabled. Google Sheets inventory registration now declares the manifest required for read-only planner discovery. No production WhatsApp sends, refunds or order writes were exercised in this batch

The planner uses SQLite for durable local workflow receipts. Integrating these records with the production PostgreSQL runtime is a separate batch-owned persistence task
