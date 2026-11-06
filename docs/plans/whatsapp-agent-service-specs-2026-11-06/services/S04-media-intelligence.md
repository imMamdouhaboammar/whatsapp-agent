# S04: Media Intelligence Worker

Priority P1 | Python isolated process + FFmpeg where needed

## User problem

People send screenshots, receipts, PDFs, voice notes and clips. The assistant should understand the relevant content, preserve uncertainty and let a human inspect the extracted evidence before acting

## Existing parts

Baileys media receive/download in src/transport/whatsapp-socket.ts; audio transcription in src/ai/audio-transcriber.ts; current Gemini client. S04 extends only uncovered input types or quality/operational gaps

## Proposed input types, ordered

1. Images: OCR and visible-scene description
2. PDFs: safe text extraction first; OCR only for scanned pages
3. Audio: use current transcript as first choice; optional language and speaker/context enrichment
4. Short video: metadata, selective keyframes and concise time-coded description after explicit user opt-in

## Boundary

One Python worker receives content via bounded local stream or capability-scoped temporary handle. It never opens WhatsApp sessions, reads the whole chat database, sends messages or accesses unrestricted cloud credentials. Bun validates attachment source, MIME signature and size before transfer

Output: media_id, document_type, extracted_text, evidence [{kind, page_or_time, snippet}], confidence/unknown fields, safety_flags, processing_duration and model/tool version. Human or agent interprets output under S02. It is untrusted content even if extraction succeeded

## Runtime limits

- Max input bytes, allowed MIME types, worker memory/CPU budget and execution deadline are configurable and conservative
- Embedded URLs, macros and active PDF content must not execute
- FFmpeg processing uses argument arrays rather than shell interpolation; avoid arbitrary network protocols and unsafe paths
- Do not persist a second permanent media archive by default
- Scrub temporary bytes on completion and timeout, subject to platform limitations
- If a worker fails, show "unable to inspect" and leave the original attachment accessible through the established UI path

## Acceptance tests

- Text image in Arabic and English returns page/region evidence
- Scanned PDF and text-based PDF are handled through appropriate paths
- Corrupt PDF, wrong MIME, oversized media and decompression bomb are rejected without crashing Bun
- Worker crash and timeout leave the chat usable and no automatic send occurs
- Prompt injection inside OCR text does not alter permission policy
- Media from chat A is never attached to chat B's context
- Original bytes are not emitted into logs or traces
- User can disable media inspection per chat and globally

## Release scope

Phase 1 image + PDF only. Record real failure cases before extending to video. The Python service is a separate process because parsers, OCR and optional decoding libraries have distinct dependencies and resource needs
