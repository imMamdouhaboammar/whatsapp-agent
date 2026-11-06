# A04 Multimodal Understanding and Document Worker

**Priority:** P1 | **Runtime:** Python Docling worker + model native media + FFmpeg if installed | **Caller:** Bun

## Customer media to understand

- Images: product photo, invoice screenshot, shipping label, screen error, receipt
- Audio: WhatsApp voice notes in Arabic dialects or English, with timestamps and uncertainty for names/numbers
- PDF: brochures, forms, invoices, contracts, specification documents
- Office: DOCX, XLSX, CSV, PPTX, text
- Video: short product issue demonstration, support screen recording, delivery damage evidence

## Pipeline

1. Receive attachment metadata + short-lived authorized media handle, validate MIME/size
2. Route by content type, retain message_id and brand_id
3. Extract text, OCR, layout, tables, speaker/time segments or image/video observations
4. Structure entities (order ID, SKU, dimensions, requested quantity) with confidence and exact source location
5. Cross-check those entities against Brand Brain or live connector before acting
6. Store scoped evidence refs and return compact summary to planner; expire raw files per policy

## API

- media.analyze({brand_id, message_id, media_ref, mime_type, user_question, max_cost_class})
- Result: {kind, observations, entities, evidence_positions, ambiguous_fields, extracted_text_ref, derived_artifacts, warnings}
- media.extract_document({source_id, file_ref, parsing_profile}) for A01 ingestion, where output preserves headings, page numbers and table coordinates

## Design constraints

Reuse current voice transcription/synthesis instead of replacing it blindly. Do not rely on OCR-only text for image meaning; model may inspect the image when visual context matters. Treat every customer attachment as private conversation data, never as automatically shared brand knowledge. Video paths must handle sampling, frame chronology and clipped audio; quantify accuracy with fixtures.

## Tests

- Arabic voice mention of order #1459 yields correct number or explicit uncertainty
- Invoice screenshot extracts total and item lines without silently changing currency
- Multi-sheet XLSX retains sheet names and exact rows
- Scanned RTL PDF remains readable at source line/page
- Unsupported file provides useful explanation and safe fallback
- Corrupted video cannot crash Bun or block other chats
- Content instructing the agent to leak credentials stays inert

## Resource limits

Bound file size, number of pages/frames, processing time, concurrency and worker CPU/memory. Prefer async processing with a short WhatsApp acknowledgement if analysis is long.
