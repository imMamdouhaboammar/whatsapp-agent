# A07 Customer 360, Episodic Memory and Case Context

**Priority:** P1 | **Runtime:** Bun/SQLite | **Dependency:** existing Contact Dossier and planned WCF

## Customer-aware autonomy

The agent should remember what each customer discussed, what they purchased, preferences explicitly shared, open complaints, outstanding offers, promised actions and previous agent/tool results. A new reply should continue the customer relationship instead of restarting from zero.

## Memory categories

1. Verified customer data from account/CRM/order connectors
2. Observed conversation facts, with original message IDs
3. Commitments and scheduled actions, with due dates and owners
4. Derived intent/preferences, with confidence and expiry
5. Active support case and plan checkpoints

## WCF integration

Current repository has docs/plans/2026-11-06-whatsapp-context-fold.md with planned short-term verbatim tail, tiered folds and full lineage. A07 should consume WCF through one context interface once it is implemented. Before then, use existing MemoryStore and dossier. Do not build a parallel long-term transcript summary store.

Brand Brain describes the business, while Customer 360 describes a customer relationship. A customer's private PDF, phone or invoice never becomes general brand retrieval data.

## API

- customer.context({brand_id, contact_id, goal, budget_tokens}) -> recent turns, relevant original-message refs, valid facts, commitments, cases, linked provider entities
- customer.record_fact({brand_id, contact_id, fact, source_message_id, confidence, retention_class})
- customer.open_case / update_case / close_case with verified outcome and next action

## Memory discipline

Mark facts with origin, last verified timestamp and explicit correction. A shipping address from months ago should prompt confirmation for a new order. Distinguish commitments made by agent, customer and an operator. Delete or expire personal facts according to configured retention settings and legal obligations.

## Tests

- Three-month-old order promise is found with source message lineage
- Customer corrects address; new verified address supersedes prior
- Mixed Arabic/English names and IDs remain stable
- Two brands sharing one phone number have separate customer contexts
- Missing WCF service falls back to current recent history without blocking chat
