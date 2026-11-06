# A06 Business Skills and Connector Hub

**Priority:** P0 | **Runtime:** Bun/TypeScript adapters | **UX:** /skills

## Purpose

An agent that only chats cannot resolve most business requests. Connectors let it read current business records and carry out authorized operations.

## First connector candidates

| Provider | Reads | Writes | Key customer job |
| --- | --- | --- | --- |
| Shopify GraphQL | Products, variants, stock, orders | Draft orders, tags or customer records where supported | Product sale and order status |
| WooCommerce REST | Products, stock, orders, shipping | Update eligible orders/customer fields | Store support |
| Google Sheets | Product/service table, appointments, CRM-like lists | Row append/update with stable IDs | Small business without ERP |
| Google Calendar | Available slots, events | Create/update eligible appointments | Booking and reminder |
| CRM/helpdesk | Contact, lead, case, status | Create/update lead or ticket | Complaint resolution |
| Delivery provider | Shipment events and ETA | Authorized pickup/rebook requests | Shipping support |
| Catalog/quotation service | Catalog, bundles, terms | Produce quote/PDF with audit ID | B2B sales |

Choose the first actual integration based on target brand's data source rather than building all connectors at once.

## Adapter contract

- discoverCapabilities(brand_id): typed tools with required OAuth scopes
- execute({brand_id, customer_ref, workflow_id, tool_name, input, idempotency_key})
- return {status, provider_receipt_id, normalized_output, updated_at, retry_advice}
- credentials referenced from secret manager, never passed to a language model
- per-connector dry-run/test call, deactivation, version and health reporting

## Correctness

- Provider responses are source of truth for current inventory, delivery, booking and successful writes
- The agent may autonomously read inventory, create eligible tickets and book slots under owner-defined terms
- Financial actions can have preconfigured ceilings and tool scopes, set once in Auto-Pilot profile
- Never execute account-wide bulk operations just because a message or file asked for them
- Idempotency and reconciliation are mandatory for writes

## Tests

- Stock changed between search and checkout: final reply uses fresh stock
- Double-submit after network loss creates one booking/order
- Expired token generates connector_reauth_needed and useful customer continuation
- Brand A token is inaccessible from Brand B
- Missing permission removes tool from the planner registry
- A refund-capable provider with brand profile disallowing refunds exposes no refund tool

## Future connector store

Versioned manifests and capability discovery can support plug-in adapters, including MCP servers, but each tool goes through typed argument validation and per-brand credentials.
