# Autonomous Agent Architecture

## Primary path

Customer WhatsApp or eligible proactive trigger
-> Transport Adapter (Baileys today; official Meta Cloud API target)
-> Event Normalizer
-> Bun Agent Orchestrator (goal planner, skill router, context, action journal)
-> Retrieval and Tool Services (Brand RAG, Web Scout, multimodal worker, connectors)
-> Outcome Check and Reply Composer
-> Outbound WhatsApp Adapter with receipt reconciliation

The planner can loop between retrieval and actions until a customer goal is complete, a targeted clarification is needed or an exceptional limitation is reached. UI displays progress and outcomes but does not govern each action.

## Process ownership

**Bun**: transport routing, account/brand identity, agent turns, model calls, skill registry, workflow journal, outbound messages, customer/case records and the proposed WCF memory integration

**Python**: document/media ingestion through Docling and other parsers, returning structured evidence and artifact references, without unrestricted app/database or WhatsApp access

**Retrieval**: brand-scoped FTS5 and embeddings first; optional Qdrant hybrid dense/sparse rerank when measured quality and corpus size require it. External research from grounded search, separated from company-authored policy

**Go**: independent scheduling of proactive triggers only if latency, availability or operational requirements warrant a separate process. Otherwise use Bun durable job runner

**Rust**: optional accelerator for measured CPU-bound extraction, normalization or indexing. No Rust mandate until profiling

## Four distinct sources of truth

1. **Conversation**: recent messages + WCF folds + verified original message lineage + customer dossier
2. **Brand knowledge**: versioned website, uploaded documents, catalog, FAQ and policy
3. **Live business state**: actual stock, current prices, order status, booking slots from connector at action time
4. **External current knowledge**: dated evidence and URLs from independently retrieved public sources

Do not serve cached stock as a timeless fact. Do not let public webpages override the brand's own return policy. Do not index customers' private files into a shared brand corpus.

## Proposed persistent records

- brands, brand_sources, brand_source_versions, knowledge_chunks, brand_facts
- connectors (brand_id, provider, scopes, status, credential_reference)
- agent_workflows (workflow_id, brand_id, contact_id, goal, state, cursor)
- agent_tool_runs (workflow_id, idempotency_key, tool, request_ref, result_ref, status)
- customer_cases (brand_id, contact_id, intent, status, next_step)
- engagement_triggers (brand_id, contact_id, reason, due_at, consent_ref, template_ref, status)
- evidence_refs (source_id, version_id, location, retrieved_at)
- agent_evaluations (scenario_id, trace_ref, measured_outcome, failure_class)

Every record and query is scoped by brand_id, and personal history by contact_id. These are schema proposals, not existing migrations.

## Turn contract

1. Inbound message normalized with native WhatsApp ID and media metadata
2. Load WCF context and customer facts, identify goal and needed evidence
3. Plan bounded steps; call knowledge, web or live connectors as relevant
4. Journal consequential tools and verify results, avoiding duplicated writes
5. Reply, ask one precise question, continue work, schedule follow-up or exceptional handoff
6. On send success, update case/memory/outcome and any follow-up trigger

Routine steps are autonomous. Brand-level permissions and platform conversation-window requirements are checked automatically, without repetitive human confirmation.

## Failures

- Tool times out after a write: inspect provider result using idempotency key before retry
- Search unavailable: answer from validated brand knowledge with freshness disclosure or ask for a specific missing datum
- Ambiguous photo: request one useful identifying attribute instead of inventing a SKU
- Connection drops: resume journaled work without duplicate outgoing messages
- High-impact unsupported act: isolate only that act for exceptional owner decision and continue the rest

## Contracts

Start with versioned authenticated local HTTP/stdio JSON for Python workers and Bun modules. Retain gRPC/protobuf as an option if benchmarks justify it. No worker directly receives full WhatsApp session credentials.
