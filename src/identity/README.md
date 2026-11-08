# S07 contact identity reconciliation

`ContactIdentityDirectory` holds stable, per-brand contact UUIDs and immutable WhatsApp aliases. Phone JIDs, LIDs and group IDs remain separate until evidence links a pair. Verified links are independently reversible; historical message IDs and raw alias ownership are never rewritten.

## Hosting contract

Instantiate once using a **persistent** `dbPath` provided by the host. The default `:memory:` database is for tests only.

```ts
const directory = new ContactIdentityDirectory({
  dbPath: identityDbPath,
  // Synchronous, authority-scoped verification of the exact claim.
  // This callback must reject reused, revoked, mismatched, or unknown receipts.
  verifyEvidence: (claim) => trustedEvidenceStore.isApproved(claim),
});
```

**Default deny:** When `verifyEvidence` is omitted, every `verifyAliasRelationship` attempt throws `IdentityEvidenceError`. An allowed source label (`owner_verified` or `provider_verified`) and a well-formed reference are not proof. The host must authenticate owner review or provider mapping and verify that the receipt binds the exact brand, both JIDs, source and evidence reference. Verification is synchronous. Never use `() => true` outside tests.

## Observation and reconciliation

1. Call `observeAlias({ brandId, jid })` after authenticated inbound identity discovery or history import. Normalize device-specific JIDs in the transport adapter before observation
2. Queue uncertain matching aliases via `queueReview`. Display names and phone fragments may support a review suggestion but must never trigger a merge
3. After an owner/provider source produces a verified receipt, call `verifyAliasRelationship` with that receipt's reference. The directory stores only the SHA-256 digest of the reference
4. For a disputed decision, call `undoMerge({ brandId, decisionId })`. A redelivery of the old reference cannot reinstate an undone edge; only fresh, verified evidence can

## Durable S01 send ledger seam

At intent creation, persist the **whole immutable** JSON binding alongside the intent:

```ts
const recipientBinding = directory.bindRecipient({ brandId, jid });
await intentLedger.create({ ...intent, recipientBinding });
```

When the durable intent is dispatched, immediately before the network call:

```ts
const destination = directory.revalidateRecipient(intent.recipientBinding);
await whatsappSocket.sendMessage(destination, intent.payload);
```

A `RecipientBindingChangedError` means the old intent **must stop**, including after an alias merge is undone. Do not resolve a new canonical ID and silently substitute a different destination. Record the rejected attempt and require a fresh recipient decision. Group JIDs are not direct-recipient bindings.

`src/index.ts`, S01 send processing and owner-review HTTP/UI routes are intentionally outside this module's isolated PR; integrators must add authorization at those boundaries.
