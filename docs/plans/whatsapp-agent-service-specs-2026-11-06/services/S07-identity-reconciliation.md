# S07: Contact Identity Reconciliation

Priority P2 | Bun canonical identity module

## User problem

WhatsApp can represent a contact by phone JID, LID or group-related identifiers. A merge or imported history must not combine unrelated people or direct a message to the wrong recipient

## Existing parts

src/transport/whatsapp-socket.ts canonicalizeJid and identity handling; chat and message persistence

## Scope

- Canonical contact_id assigned by Bun, separate from mutable transport aliases
- One-to-many aliases with source, verification time and confidence
- Reconciliation on explicit verified alias changes, with reversible merge decision
- UI shows a clear "possible duplicate contact" review where evidence is insufficient
- The send gateway resolves the final JID immediately before dispatch and validates it against the reviewed contact

## Do not infer

- Two similar display names are not proof of the same contact
- A group participant's JID must not be reused as a direct chat destination without validation
- One matching phone fragment is not enough to merge full histories

## Acceptance tests

- LID and phone alias for same verified contact map to one contact_id
- Unverified aliases remain separate
- Two contacts with identical display names are not merged
- Group and direct chats remain separate
- A contact alias change during queued delivery causes recipient revalidation
- Undoing a wrong suggested merge restores both histories without losing messages
