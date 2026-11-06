# A09 Specialist Playbooks Under One Conversation Coordinator

**Priority:** P1 | **Runtime:** Bun skill registry + model tool calling | **UX:** /skills and /activity

## Specialist capabilities

1. Sales advisor: discovery, variant recommendation, product visual match, bundles and checkout link
2. Support resolver: investigate shipment, returns, damage, missing item, create ticket, confirm outcome
3. Booking agent: collect purpose, check availability, book and remind
4. Quote writer: parse attachment, collect missing specs, price from live provider, create quote artifact
5. Community moderator: answer FAQs, welcome new participants where supported, detect issues, maintain brand tone
6. Retention agent: remember follow-up commitments, address product needs and relevant renewals
7. After-sales agent: installation guidance, troubleshooting and warranty procedure from official brand documents

## Routing principle

The primary A05 planner owns the customer and the outbound reply. It may invoke specialist skill handlers internally, but the customer sees one coherent agent. Specialists can share relevant evidence, while only the coordinator decides final action and sends.

## Playbook anatomy

- Intent, trigger phrases and required customer data
- Required brand knowledge and connector tools
- Steps, acceptable alternate paths, clarification prompts
- Business constraints (no unsupported price promise or unauthorized refund)
- Completion proof (provider order ID, ticket ID, calendar event or cited answer)
- Follow-up triggers and case closure criteria

## Example: PDF quote

Customer attaches PDF specification requesting 100 units. Quote skill extracts line items, matches catalog SKUs, checks live price and stock, identifies missing technical options, creates a branded quote with validity date, stores it to CRM and offers a link or attachment. A08 schedules one compliant check-in if appropriate.

## Tests

- Specialists do not duplicate or race customer replies
- Unavailable tools are omitted and service asks for missing authorization/data
- Bookings and quotes are described as confirmed only after provider receipt
- Mixed-intent customer request ("track old order and buy another") completes both goals or states precise next steps
- Brand voice and locale are preserved across specialist transitions
