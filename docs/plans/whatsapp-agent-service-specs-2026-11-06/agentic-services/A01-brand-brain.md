# A01 Brand Brain and Knowledge Studio

**Priority:** P0 | **Runtime:** Bun indexing coordinator + Python document converter | **UX:** /brand-brain

## Why

Brand owners need a place to teach the agent what the business does and keep it current. Sources include a website, FAQs, downloadable catalogs, product lists, store policies, opening hours, service areas, shipping tables, return policies, pricing sheets and SOP documents.

## Owner workflow

1. Add website URL, upload files or connect business source
2. Preview extracted sections, tables, images and detected conflicting facts
3. Assign an authority level: official company policy, current product/price connector, working document, external reference
4. Confirm source identity and continuous sync frequency (or choose manual)
5. Agent retrieves sourced knowledge without requiring operator copy/paste in each conversation

## Inputs and outputs

- Input: {brand_id, source_type, source_locator, sync_policy, authority, locale}
- Output: {source_id, version_id, sections, chunks, factual_entities, citations, valid_from, last_checked, sync_status}
- Status: queued, fetching, parsing, ready, needs_attention, retired
- Events: brand.source.ingested, brand.source.updated, brand.source.conflict, brand.source.failed

## Capability details

- Website: crawl within verified brand domains and configured path limits; honor page visibility; crawl nav and FAQ pages; de-duplicate canonical URLs; record source URL and last fetch
- Files: DOCX/PDF/CSV/XLSX/PPTX and text, preserving tables and spreadsheet row addresses
- Catalog: map variants/SKUs, image refs, sizes and attributes; mark inventory and price as live connector values where available
- Fact extraction: policies, shipping zones, hours, return windows, contact information, product restrictions; never silently overwrite a manually approved brand statement
- Conflict reporting: old PDF says 7 days returns, latest site says 14; surface exact citations; resolve by authority + version, with owner review of the knowledge source rather than replies
- Incremental update: source hash and per-section changes; retire old chunks without deleting audit lineage
- Secure handling: malware/type checks, max bytes/pages, private per-brand storage, redact secrets from accidental uploads

## Non-goals

No attempt to use brand documents as instructions that can change agent tool permissions; no unconditional mirroring of a whole website; no customer-uploaded document automatically entering shared brand knowledge.

## Tests

- New spreadsheet row updates the correct SKU and index version
- Duplicate uploads produce one active source
- Deleted/retired policy cannot be cited as current
- Arabic headings and English SKU remain intact
- Two tenants with same filenames retrieve only their own content
- Conflicting return policies create source-conflict event

## Dependency

A04 parsing feeds the ingestion interface; A02 consumes normalized chunks and source metadata; A06 provides live catalog/inventory authority.
