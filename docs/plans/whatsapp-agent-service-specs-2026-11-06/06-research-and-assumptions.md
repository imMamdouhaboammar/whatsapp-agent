# Research Notes and Source Links

Research checked 2026-11-06. Official primary documentation was preferred. Described APIs and capabilities must be retested against installed SDK versions during implementation.

| Question | Primary source | Finding / design consequence |
| --- | --- | --- |
| Can Gemini fetch current web facts? | https://ai.google.dev/gemini-api/docs/google-search | Google Search grounding supports live queries and grounding metadata; route external questions there, retain citations |
| Can Gemini orchestrate tools? | https://ai.google.dev/gemini-api/docs/function-calling | Function calls can execute serial or parallel tool operations, with app owning tool execution and result validation |
| Managed retrieval alternative? | https://ai.google.dev/gemini-api/docs/file-search | Gemini File Search provides file indexing and retrieval; benchmark quality/cost/data controls against local index |
| Hybrid retrieval at scale? | https://qdrant.tech/documentation/guides/optimize/ | Qdrant supports semantic and keyword/hybrid workflows with reranking; measure against local baseline |
| Which attachments can be parsed? | https://docling-project.github.io/docling/ | Docling supports rich document conversion and some media formats with appropriate extras; separate ingestion from interactive chat |
| Can the agent operate commerce tools? | https://shopify.dev/docs/api/admin-graphql | Shopify Admin GraphQL exposes commerce entities and mutations; provider credentials/scopes required |
| WooCommerce integration? | https://woocommerce.github.io/woocommerce-rest-api-docs/ | REST API includes products/orders for tool-backed support and sales |
| Sheets-based small businesses? | https://developers.google.com/workspace/sheets/api/guides/concepts | Sheets APIs allow read/write of structured business data |
| Long-running tasks? | https://docs.temporal.io/ | Temporal supports durable workflow execution; optional if Bun journal cannot meet requirements |
| WhatsApp automation and proactive messaging? | https://business.whatsapp.com/policy?lang=en_US | WhatsApp Business Platform allows automation, with opt-in, approved business-initiated templates and 24-hour service conversation rules; implement these as automated platform eligibility checks |
| WhatsApp Cloud API and structured Flows? | https://www.postman.com/meta/whatsapp-business-platform/overview | Official Meta Business Platform API collection documents Cloud API and message/Flow interfaces |

## Critical distinction

**Agent initiative** (choosing to contact an eligible customer independently) is part of the product. **Message eligibility** (customer opted in, correct template/window and brand identity) is a provider/channel condition applied automatically. No per-message approval by an owner is required for otherwise eligible routine engagement.

Current Baileys is an unofficial WhatsApp Web transport; the recommended brand-ready path includes an independent Meta Cloud API adapter. Capabilities should depend on a transport-neutral message API, with provider-specific features declared by each adapter.

## Open decisions to validate with real merchants

1. Are first target customers retail/e-commerce, service bookings or general communities? This determines the first live connector and evaluation data
2. What private data may a brand authorize the agent to retain, and for how long?
3. Which countries and WhatsApp messaging tier will be supported in initial commercial launch?
4. Is brand knowledge hosted local-only or in a managed vector index?
5. Are agent-created financial commitments limited to checkout/quotes or actual refund/payment actions?
6. Which provider handles media retention and signed-link expiry?

The first implementation need not wait for every answer: use a test merchant profile, test accounts and connector mocks while product choices are validated.

## Repo-specific correction

The 2026-11-06 WhatsApp Context Fold file is an implementation plan. It proposes Bun SQLite LSM-style message folds, prefix cache stability and original message lineage. Do not advertise its >90% cache target or subsecond response claims as measured results. Brand RAG is separate from conversational folding, and a caller should merge relevant context from both.
