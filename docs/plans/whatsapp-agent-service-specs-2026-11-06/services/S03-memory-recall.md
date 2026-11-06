# S03: Source-linked Conversation Memory

Priority P1 | Bun + SQLite FTS5

## User problem

The agent has stored conversations and contact dossiers, but it needs a safe way to answer "كنت قلتلك إيه عن الموعد؟" or "What budget did they mention?" with exact evidence and a path to correct wrong memory

## Existing parts

src/domain/memory-store.ts, src/domain/db.ts and contact dossier support in src/ai/moderator-agent.ts

## Scope

1. Index messages with normalized chat_id, message_id, timestamp, original text and optional speaker metadata
2. Use SQLite FTS5 for keyword recall, with explicit per-chat filtering; test Arabic diacritics, Unicode and common spelling variants
3. Return source_message_ids, excerpts, timestamps, relevance indicator and retrieval reason
4. Surface recalled facts and their sources in collapsible AI inspector
5. Support correction, pin, forget and chat-level retention settings
6. Never turn retrieved text into agent instructions or give it cross-chat authority

## Query contract

Input: chat_id, question, max_hits, current_turn_message_ids, retention_scope

Output: hits [{message_id, timestamp, short_excerpt, match_reason}], no_answer_reason

Retrieval uses parameterized queries. Validate the actual availability of FTS5 in the Bun-bundled SQLite binary before migration. Simple keyword search may miss paraphrases; an embedding index is a later research option requiring measured accuracy gains and consent

## Important constraints

- No global search through private conversations when answering a contact's message
- Quote original chat text only where the current user/agent is authorized to access it
- Do not store generated "fact" without source IDs and conflict handling
- Keep message deletion, index deletion and dossier deletion synchronized transactionally where possible

## Acceptance tests

- Contact A's query returns zero hits from Contact B
- Query with Arabic numbers, diacritics and punctuation has documented, tested tokenization behavior
- Deleting a message removes its recall entry and prevents replay
- False dossier fact corrected by user no longer appears as current truth
- Quoted malicious instruction in an old message never changes assistant role
- Missing matches produce honest unknown, not an invented answer
- Migration on existing SQLite database is additive and reversible by feature flag

## Extraction gate

Try FTS5 before separate Rust Tantivy or vector infrastructure. Extract only after measured corpus size, relevance or throughput demonstrates a bottleneck
