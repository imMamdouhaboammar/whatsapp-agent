# A02 Hybrid Knowledge Retrieval and Evidence Broker

**Priority:** P0 | **Runtime:** Bun query service + FTS5 and embeddings; optional Qdrant | **UX:** answer citations and knowledge trace

## Problem

Semantic-only retrieval can miss SKUs, order identifiers and exact policy phrases. Keyword-only search misses synonyms and dialect wording. The agent needs both, with source authority and freshness.

## Query plan

1. Determine scope: brand facts, live source, customer memory or public web
2. Detect identifiers (SKU, order number, model code, exact quoted product name)
3. Run lexical retrieval for exact entities and dense retrieval for intent/similar wording
4. Fuse ranked candidates; filter brand_id, locale, document status and version
5. Rerank top candidates with lightweight relevance check or model-based reranker
6. Return answerable evidence; flag conflicting or insufficient sources

## Contracts

- retrieve({brand_id, contact_id?, question, intent, k, as_of, source_types?, locale})
- result: {evidence:[{source_id, version_id, chunk_id, text, location, score, authority, last_checked}], conflict_set, freshness, answerability}
- evaluate retrieval separately with labeled test questions and citation alignment

## Authority rules

- Live inventory/pricing/booking status requires A06 tool call at the moment of action
- Brand policy is sourced from A01, not an external article
- Personal commitments come from A07/WCF original-message lineage
- External current events use A03 and dated URLs
- Retrieval returns snippets as evidence, never privileged model/tool instructions

## Storage decision

MVP: SQLite FTS5 + embeddings in a branded local vector table/compatible store; do not choose embedding dimensions before selecting model. Qdrant optional when isolation, filtering, hybrid retrieval quality or corpus size cannot meet measured targets. Gemini File Search is an alternative benchmark, with managed indexing tradeoffs.

## Evaluation dataset

Include exact SKU, Arabic colloquial synonym, rare model, conflicting policy, table-based price, obsolete version, zero-result, adversarial PDF instruction and cross-brand names. Score recall@k, top-source relevance, supported final claims and latency; report actual results only after tests.

## Failure

If evidence is weak, ask a narrow question or consult a live source. Never invent a return window, price or stock status. Preserve evidence references with the workflow trace.
