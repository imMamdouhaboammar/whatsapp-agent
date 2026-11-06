# S06: Commitments and Follow-ups

> Historical supporting note from V1. The draft-only human confirmation approach is superseded by A08's autonomous eligible follow-up execution.

Priority P2 | Bun scheduled module

## User problem

A contact or the account owner mentions a deadline or promise in a chat. The application should turn that into a reviewable reminder, then optionally propose a follow-up message without contacting people unexpectedly

## Existing parts

Contact dossier commitments saved by ModeratorAgent and SQLite, chat time stamps and draft approval UI

## Scope

1. Extract candidate task: actor, task, due time, zone, evidence message ID, confidence
2. Create PENDING_REVIEW item, not an automatic reminder based on a vague model guess
3. Owner may confirm, edit, dismiss or mark complete
4. Scheduler raises a local notification/reminder at an explicit time
5. Follow-up wording can be drafted; sending follows S02 and S01
6. Support quiet hours, postponed reminders and contact-specific disabling

## State

SUGGESTED -> CONFIRMED -> DUE -> COMPLETED or CANCELLED

An overdue item is still visible after app restart. Re-running a scheduler tick must not create duplicate alerts; use a unique (commitment_id, occurrence_version)

## Time semantics

Store due_at UTC and a concrete IANA timezone. Preserve original expression ("بكرة الصبح") and the resolved date. If location, time or actor is unclear, ask for clarification; do not silently invent a deadline

## Acceptance tests

- "هرد عليك بكرة" produces a suggestion, not an outbound WhatsApp message
- "كلمني يوم الجمعة" without time remains unconfirmed
- Duplicate event replay creates one reminder
- DST and app restart behavior is verified with virtual clock tests
- Changing timezone does not silently move an already confirmed absolute due time
- A due reminder during quiet hours is deferred according to owner policy
- A cancelled commitment cannot send a follow-up

## Extraction gate

Keep scheduling in Bun while there is one local process. If durable scheduling must operate independently during app downtime, compare an external scheduler or a Go service against always-on hosting and user expectations. Do not add a daemon solely for a small reminder list
