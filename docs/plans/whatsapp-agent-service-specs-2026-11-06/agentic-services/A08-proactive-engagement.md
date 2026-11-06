# A08 Proactive Engagement and Autonomous Follow-Up

**Priority:** P1 | **Runtime:** Bun durable scheduler initially; conditional Go worker | **UX:** /follow-ups

## Agent-initiated conversations

Initiative is a product feature. The agent may start eligible conversations at a useful moment based on a connected event, business rule or previous customer agreement.

## Trigger library

- Quote submitted but customer has not replied after configured interval
- Order shipment delayed or status changed
- Appointment tomorrow or rescheduling available
- Open support case received a new provider update
- Customer-requested callback or reminder date
- Back-in-stock for a customer who asked for that exact product
- Renewal/reorder due based on explicitly saved customer need
- Lead follow-up after an opt-in form or live interaction

## Decision and action

1. Receive event or due timer, load customer state, reason and last interactions
2. Check relevance, recency, duplicate suppression and quiet hours
3. Confirm contact eligibility under the connected WhatsApp channel
4. Within valid service window use appropriate response; outside window on Business Platform use an approved business-initiated template with opt-in
5. Personalize only within allowed template variables, send once, journal provider receipt
6. On reply, return full context to A05 planner; on opt-out, stop future triggers

## API

- followup.schedule({brand_id, contact_id, reason, due_at, source_workflow_id, eligibility_context})
- followup.evaluate({trigger_id, as_of}) -> send/skip/defer, reasons, template ID
- followup.cancel({trigger_id, reason})
- Event: engagement.trigger.ready, engagement.sent, engagement.skipped, engagement.replied

## Why this preserves full autonomy

The owner configures communication rules, contact consent and brand voice once. The agent determines the next eligible moment and initiates the interaction, without drafting each reminder for approval. Platform rules are evaluated automatically as channel constraints.

## Tests

- Opted-in customer with delayed delivery gets one accurate proactive update
- No opt-in or unavailable approved template -> no disallowed business-initiated message
- Customer replies before reminder -> pending reminder is canceled
- Restart during send -> receipt reconciliation prevents duplicate delivery
- Customer says stop -> all future eligible campaigns and case nudges suppressed
- A price quote follow-up contains correct currently valid terms

## Data caution

Never interpret silence as permission to send arbitrary marketing. Do not bulk-spam or evade WhatsApp account restrictions; make outreach relevant and supported by the channel's conditions.
