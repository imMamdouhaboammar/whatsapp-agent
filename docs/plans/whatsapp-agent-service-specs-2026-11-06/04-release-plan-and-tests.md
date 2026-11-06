# Delivery Plan, TDD and Agent Evaluations

## Phase 0: contracts and baseline, estimated 1 sprint

- Inspect current branch and tests, especially the WCF plan; baseline message latency and tool-call behavior
- Define brand_id, contact_id, evidence refs, workflow journal, tool manifest and consent/outreach states
- Add evaluation fixtures before changing orchestration
- Build thin tool registry with fake connectors; add UI diagnostic traces

Exit: deterministic tests prove a customer message chooses an appropriate simulated tool and produces an answer backed by data.

## Phase 1: complete one real customer goal, estimated 2–3 sprints

- A01 website/FAQ/PDF + sheet ingestion and freshness metadata
- A02 exact and semantic brand search, citations, version filtering
- A05 planner with action journal, tool loop, stop conditions and recovery
- A06 first real connector (choose target merchant's inventory/orders source)
- Minimal Brand Brain and Connectors pages, RTL/LTR tests

Exit: customer asks about a product, agent checks verified stock and current price, responds and records follow-up context without manual approval.

## Phase 2: modalities and lasting context, estimated 2 sprints

- A04 voice note, product photo, PDF, DOCX, XLSX, CSV and screenshot; preserve provenance
- A07 bridge to WCF once that implementation is merged and tested; until then use existing dossier and conversation memory
- A03 Google Search grounding for genuine outside-world questions with citation and recency
- Customer case and outcome status

Exit: screenshot + voice complaint creates a ticket after extracting an order reference and verifying it from provider.

## Phase 3: proactive ownership, estimated 2 sprints

- A08 durable event triggers, opt-out/quiet-time handling, proactive template selection
- A09 sales, support, bookings and quote workflows with independently testable tool receipts
- Owner-facing Follow-ups and Agent Activity screens
- Formal Cloud API adapter decision and migration spike for commercial outbound use

Exit: permitted quote follow-up or order delay notification is sent autonomously, with proof of opt-in/template eligibility and no duplicate send.

## Phase 4: measured improvement, ongoing

- A10 scorecards for goal completion, hallucination, retrieval quality, connector outcomes and unnecessary escalations
- Add more connectors based on merchant demand; measure whether Go scheduling or Qdrant migration is justified
- Expand load tests, security and tenant-isolation coverage

## E2E scenarios (fixtures must use fake customer data)

| ID | Input | Required actions | Observable pass |
| --- | --- | --- | --- |
| E01 | Customer sends product photo, asks size 42 and ETA | Image recognition -> catalog match -> stock API -> shipping API | Correct SKU/stock/ETA with provider trace, or precise clarification |
| E02 | Voice complaint + shipping label screenshot | Transcription + OCR -> order lookup -> ticket creation | One ticket, accurate customer reply, follow-up if pending |
| E03 | Customer uploads PDF requesting 100-unit quote | Parse document -> identify SKUs -> live prices -> quote PDF -> CRM | Quote totals reflect current catalog and existing terms |
| E04 | Owner updates source spreadsheet price | Ingest -> validate -> source version -> reindex | New price served; old price traceable, no stale answer |
| E05 | Customer asks time-sensitive external fact | Web grounding -> credible recent source -> response | Current source URL and publication/observation date preserved |
| E06 | Customer requests booking | Calendar free/busy -> slot proposal -> booking mutation | Booking confirmed only after provider result |
| E07 | Customer stops replying to offer | Trigger qualification -> consent/template check -> schedule -> send | Appropriate follow-up once, opt-out stops future sends |
| E08 | Network drops after order-create API write | Journal unknown state -> reconcile order key | No second order or duplicate customer acknowledgement |
| E09 | Prompt injection hidden in PDF | Parse as data -> reject instructions -> authorized tool plan | Malicious tool action never invoked |
| E10 | Arabic with product SKU and English address | Language/direction handling -> search -> response | Arabic natural response; SKU, URL, phone remain correct |
| E11 | Brand B asks about Brand A document | Scoped retrieval | Zero cross-brand chunks, quotes or cache hits |
| E12 | Customer references 3-month-old promise | WCF or original message search -> evidence | Accurate historical fact, message lineage, no invented promise |

## Measurements, no fabricated benchmarks

- Autonomous goal-completion rate: customer goal completed with confirmed business state / eligible goal attempts
- Unsupported action rate: actions with absent permissions or provider authority / total action attempts
- Answer evidence accuracy: evaluator checks each material claim against retrieved or provider data
- Action duplication rate: duplicate provider mutations / eligible mutations, target zero in retry tests
- Appropriate clarification rate: unclear requests that get specific clarification instead of a fabricated answer
- Proactive relevance: sent events with current intent, valid consent and expected benefit / all proactive sends
- Human intervention: track exceptions, not as a global target to minimize at all costs

Every change requires unit tests, adapter contract tests, state-machine tests, recorded-model replay and at least one scenario E2E. Use Bun first for app tests; Python pytest for ingestion workers. These are acceptance criteria, not tests already executed.

## Release protection

Ship per-brand feature flags, use shadow tool plans before enabling writes, and maintain rollback to the previous agent-turn implementation. For writes, canary on test stores/accounts before production.
