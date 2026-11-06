# WhatsApp Agent | Market & Product Maturity Benchmark

**Version:** 1.0  
**Date:** 6 November 2026  
**Code baseline:** [main @ 8e3d8c7](https://github.com/imMamdouhaboammar/whatsapp-agent/tree/8e3d8c7da06ffb6d55edbbc3ddd0320ae97ceac6)  
**Status:** Research and source-code assessment, not a live pilot validation

## 1. Product target

A free, self-hosted WhatsApp business agent that takes responsibility for routine customer conversations, accesses business knowledge, performs real actions through business connectors, follows up when eligible, and can be extended with paid skills and plugins

The target user is a brand owner or manager, initially supported through an assisted beta. The owner operates the application and pays hosting, database, WhatsApp channel, and AI-provider costs

The core promise must be measured by **customer goals completed with verified outcomes**, not by messages generated or the number of AI tools installed

## 2. External benchmark

### Meta Business Agent, WhatsApp Business App

Meta publicly describes the following experience, with availability varying by market and eligible account:

1. Fast onboarding inside the WhatsApp Business app
2. Learning from existing business material such as previous chats, website, Facebook Page, catalogs, FAQs and prices
3. 24/7 answers, lead qualification and product recommendations
4. Owner-selected tone, operating conditions and audience segments such as new customers or ad arrivals
5. Human takeover and topic-based escalation
6. In-chat testing, rewriting poor answers and continuous improvement

These are **vendor-advertised capabilities**, not independently verified conversion, accuracy or reliability results. Meta also markets a broader *Business Agent Platform* with enterprise connectors and actions. Do not assume every Platform capability is available in the WhatsApp Business App offering

### Fair-comparison rule: API and first-party boundaries

Meta controls WhatsApp and has direct relationships with Facebook Pages, ads and the Business App. Our application must only be assessed against capabilities that an independent provider can legitimately implement with documented interfaces and business-authorized data

| Class | Meaning | Benchmark treatment |
| --- | --- | --- |
| **A: Portable** | Works with business-owned inputs or supported generic interfaces, such as FAQ, CRM, product feed, conversation memory, tests and human takeover | **Count toward maturity and release requirements** |
| **B: Conditional** | Requires a supported WhatsApp/API capability, a merchant connector, metadata from an ad campaign, or additional permissions | Count **only when the selected integration exposes the required data** |
| **C: First-party-dependent** | Native Business App setup, private Meta account context, automatic Facebook Page history, ad signals not exposed through a documented integration, and native WhatsApp discovery placement | **Reference-only**; never reduce maturity score or block launch |

Do not recreate unavailable Meta metadata by guessing. If a campaign source is unknown, record it as **unknown**, allow an owner-defined segment if appropriate, and avoid claiming verified ad attribution

For catalogs, a Shopify, WooCommerce, ERP, PostgreSQL, Google Sheets or authorized product-feed integration can satisfy the product recommendation benchmark. Direct access to the native WhatsApp catalog is optional and only required for an explicitly supported adapter

**Primary evidence:**  
- [Meta Business Agent product page](https://whatsappbusiness.com/products/business-app-ai-agent/)  
- [Meta resource: setup, testing, feedback, takeover](https://whatsappbusiness.com/resources/resource-library/meta-business-agent-whatsapp/)  
- [June 2026 announcement, Business Agent Platform](https://whatsappbusiness.com/blog/introducing-meta-business-agent-ai/)

### Wider market practice

Intercom Fin documents train/test/deploy/analyze workflows, knowledge sources, guidance, procedures, simulations, batch tests, answer inspection, audiences, handoff, and resolution analytics

Zendesk documents AI agents that use knowledge, generative procedures, authorized actions, API integrations, conversation handoff and analytics

These establish a useful product benchmark, **not a formal ISO or regulatory industry standard**

**Primary evidence:**  
- [Intercom Fin explained](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained)  
- [Zendesk AI agents](https://support.zendesk.com/hc/en-us/articles/6970583409690-About-AI-agents)

## 3. Evidence vocabulary

| Label | Meaning |
| --- | --- |
| Live integrated | Present in the default inbound/outbound flow in inspected source |
| Functional but limited | Real implementation exists, with constrained inputs or scope |
| API/opt-in only | Can be called through API, a flag or isolated service, not the normal default customer flow |
| Planned | Spec or contract exists, implementation is absent or not evidenced |
| Unverified | Needs real instance tests, measured behavior, or account-specific confirmation |

**Important:** A test file, class, endpoint or mock is never sufficient on its own to claim production capability

## 4. Meta feature parity assessment

| Meta capability | Our evidence | Current verdict | Expected next capability |
| --- | --- | --- | --- |
| 24/7 inbound replies | `src/index.ts`, `src/ai/moderator-agent.ts`, Baileys transport | Live integrated in code; uptime unverified | Durable send/recovery and officially supported channel |
| Tone and persona | `/api/persona`, settings UI, persistent persona | Live integrated | Brand-specific presets and versioned instructions |
| Business facts and FAQ | `BrandKnowledgeStore`, Brand Brain UI | Functional but limited: text, FAQ, CSV | URL crawler, upload UX, source freshness and permissions |
| PDFs and office documents | `/documents/ingest`, Python extraction worker | API-only owner ingestion | UI upload and verified live retrieval across formats |
| Website sync and authorized chat memory | Legacy dossier and knowledge APIs | Partial memory; no website sync | Website retrieval and memory from conversations this deployment can lawfully access; historic Meta-only data is reference-only |
| Knowledge conflicts | `listConflicts` | Limited example for return-policy day values | Typed authority and conflict resolution across prices, shipping, warranties, etc. |
| Catalog product recommendation | Google Sheets read-only SKU lookup | Lookup exists; recommendation flow incomplete | Connect an authorized business catalog, then recommend based on attributes, stock and price; native WhatsApp catalog access is conditional |
| Lead qualification and sales completion | Moderator dossiers and bounded agent modules | Partial | Verified lead state, basket/quote/order creation and receipts |
| Audience targeting for eligible contacts | Per-chat Auto/Co/Human modes | Missing general segment rules | Everyone/new/existing/owner-tagged segments; ad-origin rules only when verified metadata is available |
| Human takeover | Chat mode API, drafts and permissions | Functional but limited | Topic-based escalation queues, ownership and handback |
| Test as customer | `/api/simulate`, Simulator UI | Live integrated | Isolated preview and scenario/batch testing |
| Rewrite answer and improve | Quality API and manual source edits | API-only quality capture, no in-chat correction loop | Feedback -> proposed source change -> regression eval -> promotion |
| Multilingual handling | Locale, persona language, Gemini | Partial; no multilingual acceptance suite covering real accounts | Language coverage cases and mixed Arabic/SKU checks |
| Voice | Audio transcription + TTS | Live integrated in code, production accuracy unverified | Voice tests across dialects and poor-quality audio |
| Image/document/video in incoming chat | Message types registered, limited text/caption handling | Not a completed multimodal resolution flow | Download, inspect, cite extracted evidence, then act |
| Proactive follow-up | `FollowUpStore` and API | Scheduled record; actual dispatch is not wired in production | Channel eligibility, template, opted-in send, receipt and reconciliation |
| Enterprise business actions | `ToolRegistry`, `BoundedPlanner`, `AutonomousOperator` | Partial; full planner not active by default | Orders, CRM, booking, payment links, case updates with receipts |

### Precise caveats in our source

- `AGENT_CAPABILITIES_AUTOPILOT` is opt-in in `src/index.ts`; the more capable operator is not always the default path
- `AutonomousOperator` currently makes mainly SKU-pattern inventory checks, retrieval and web-grounding decisions; it is not yet a broad multi-step business planner
- `BrandKnowledgeStore` has FTS5 and optional embedding support, but `createCapabilities` does not configure an embedding provider by default
- Return-policy conflict detection currently recognizes the `returns_days` pattern, not general policy conflicts
- The inbound WhatsApp adapter transcribes voice, while image, video and document branches mainly preserve captions/placeholders in the customer message
- The simulator writes simulated messages into the memory store; it should be isolated from live contacts, metrics and training data before market release
- The Google Sheets inventory source expects a published read-only CSV; it is not a full private store or WhatsApp catalog connector
- `FollowUpStore.evaluate` requires a `meta-cloud` channel to dispatch eligible outbound follow-ups, and no live Meta Cloud adapter was found in the inspected default transport

## 5. Maturity levels

| Level | Name | Exit evidence |
| --- | --- | --- |
| L0 | Absent | No working implementation |
| L1 | Prototype | Code, contract or controlled demo exists |
| L2 | Integrated | Wired into a product flow, handles ordinary use, has basic tests |
| L3 | Verified MVP | Deterministic E2E, negative cases and real sandbox/provider receipts pass |
| L4 | Pilot proven | Multiple real businesses use the feature; incidents, outcome metrics and recovery are observed |
| L5 | Repeatable market | Repeatable installation and upgrades, sustained reliability, documented support and measurable outcomes |

**Scoring rule:** Each domain receives a 0-5 level based on evidence. A domain contributes `weight × level / 5`. This is a team-defined maturity instrument, not an external certification

### Initial code-only scorecard

| Domain | Weight | Provisional current | Evidence limitation |
| --- | ---: | ---: | --- |
| Channel delivery and message continuity | 12 | L2 | Baileys integrated, no official adapter or live recovery proof |
| Autonomous conversation and tool use | 12 | L2 | Routine replies integrated; advanced tools opt-in/limited |
| Knowledge accuracy and freshness | 12 | L2 | Brand sources and FTS5 exist; weak sync/conflict coverage |
| Sales and catalog execution | 10 | L1 | SKU lookups, no order or recommendation lifecycle |
| Audience from owned data and proactive engagement | 8 | L1 | Per-chat modes and scheduling, no reusable segment rules |
| Human collaboration and takeover | 8 | L2 | Modes/drafts, incomplete case ownership and handback |
| Multimodal understanding | 8 | L2 | Voice active; incoming image/document flows incomplete |
| Evaluation and learning | 10 | L1 | Simulator and quality API, no full feedback/promotion loop |
| Self-host setup and operations | 10 | L1 | Bun quickstart, no verified one-command business onboarding |
| Isolation, authorization and privacy | 6 | L1 | Brand scoping for new APIs, legacy owner auth not established |
| Extensions and installable skills | 4 | L0 | Marketplace, signing and lifecycle not implemented |
| **Total** | **100** | **29.6 / 100** | **Indicative static assessment only** |

The overall number is **not a measured product success score**. No live tenant, load, accuracy, cost, or uptime benchmark has been run. A high composite score cannot override a failed launch gate below

## 6. Mandatory launch gates

These gates are binary: each must be passed with evidence for the intended deployment model

| Gate | Acceptance contract |
| --- | --- |
| G1 Channel legitimacy | Clear supported WhatsApp Business connection method, documented outbound eligibility and legal/product-policy review |
| G2 Owner access | Authentication for all read/write/AI settings endpoints; least-privilege roles; credentials never in frontend payloads |
| G3 Data isolation | No brand-to-brand message, document, memory, tool or evaluation leakage in adversarial tests |
| G4 Durable delivery | Unknown send outcomes can be reconciled, duplicate business actions prevented in retry/crash tests |
| G5 Source integrity | Price, stock, return promises and booking claims can be traced to current brand/provider evidence |
| G6 Human takeover | Owner can stop the agent and continue a conversation immediately; escalation context survives |
| G7 Outreach eligibility | Consent/opt-out, audience, 24-hour window and template eligibility enforced before every business-initiated send |
| G8 Self-host recovery | Guided install, configuration check, backup, restore, migration, upgrade and rollback successfully exercised |
| G9 Test isolation | Simulations cannot create real outbound messages, contaminate live customer memory, or inflate production metrics |
| G10 Pilot observability | Connection health, action journal, latency, error classes, pending tasks and per-goal outcomes accessible to owner |

WhatsApp Business Messaging Policy specifically calls for a clear escalation path when businesses automate responses and has conditions for business-initiated messages outside the 24-hour customer service window. The official Business Platform requires opt-in and templates for proactive outbound

**Official sources:** [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/), [Business Platform features](https://whatsappbusiness.com/products/business-platform-features/)

## 7. Product gates by stage

### MVP for assisted beta

1. One connected brand and one working WhatsApp channel with predictable recovery
2. Owner can add/edit business details, FAQ, price and shipping policy, plus at least one live knowledge source
3. Agent responds to known business questions and asks for missing information rather than guessing
4. Manual takeover, return to Auto-pilot and a clear unresolved-conversation state
5. Scenario simulator with isolated test records and usable feedback
6. Evidence for relevant price/product claims and a real inventory lookup
7. Owner authentication, migration/backup/restore, structured logs and support diagnostics
8. Full E2E proof for representative Arabic, English, voice and mixed-content conversations

**MVP excludes by default:** marketplace billing, many connectors, advanced multi-brand console, speculative autonomous marketing campaigns and full omnichannel functionality

### Portable functional parity

- Website + catalog ingestion with refresh timestamps, precedence and conflict review
- Product discovery and recommendations against current stock/price
- Audience targeting for everyone, new contacts and owner-defined segments; ad-attributed leads only through verified integration data
- Escalation topics and clean human handback
- Reply corrections that become testable guidance or knowledge updates
- Lead qualification and a verified sales/service workflow such as order status or booking
- Controlled proactive follow-up when the channel and consent allow it

Native Business App onboarding, privileged Facebook Page learning, inaccessible ad metadata and Meta-owned discovery experiences are excluded from our parity score. They can inspire interaction design without becoming product requirements

### Product identity beyond Meta

- Self-hosted application with optional managed Supabase/PostgreSQL or owner-operated PostgreSQL
- Business-owned provider credentials, portable exports and explicit data retention
- Installable extensions, scoped skills and testable connector contracts
- Model provider choice, source-level evidence and action traces
- Costs per resolved customer goal visible to the owner

These are target claims. They must remain out of marketing until they pass the corresponding maturity level

## 8. PostgreSQL and Supabase direction

The current repository still contains several `bun:sqlite` databases. The database migration is a **planned next step**, not a current capability

One application data contract should support either:

1. Business-managed PostgreSQL via `DATABASE_URL`
2. A business-owned Supabase PostgreSQL project with optional managed Auth/Storage/Vector capabilities where available

Use migrations, tenant/brand keys, audit fields, backup-restore drills and least-privilege access. Supabase recommends RLS for exposed schemas and states that service-role credentials bypass RLS and remain server-side

Do not assume self-hosted Supabase has all managed-platform services: its official documentation notes differences in managed backups/PITR, observability and other features. Database hosting choice should not alter agent behavior contracts

**Official sources:** [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security/), [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting)

## 9. Scenario benchmark

Use fixed, versioned fixtures with synthetic data. Every scenario records input, source versions, selected tools, authorized mutations, final customer response, provider receipt and expected outcome

| ID | Scenario | Pass evidence |
| --- | --- | --- |
| M01 | Working hours / location question | Response matches latest owner-provided facts |
| M02 | Two conflicting return policies | Ambiguity surfaced; outdated terms never presented as certain |
| M03 | Owner changes price in source | New answer reflects latest published version and records its origin |
| M04 | Customer shows product photo | Product identity established or specific clarification requested |
| M05 | SKU, size and delivery estimate | Catalog match + real stock + shipping source, or no unsupported ETA |
| M06 | Customer asks for alternative product | Recommendation respects budget, attributes and stock |
| M07 | Voice complaint with screenshot | Transcription + relevant extraction + accurate case/ticket context |
| M08 | Human takeover after sensitive issue | Agent pauses; complete context appears in owner inbox |
| M09 | Owner rewrites a bad answer | Regression fixture added; guidance/source change improves replay |
| M10 | New contact with an owner-defined segment | Audience rule applies using available contact attributes; ad origin is tested only if the connector supplies it |
| M11 | Follow-up after quote | Explicit eligibility proof, correct template and exactly one recorded send |
| M12 | Customer opts out | Future eligible marketing follow-ups blocked |
| M13 | Order tool times out after mutation | Reconcile before retry; no duplicate order |
| M14 | Injection embedded in business document | Content treated as data; no unauthorized tool call |
| M15 | Brand B asks for Brand A price | No cross-brand source returned |
| M16 | Restart during queued outbound | Delivery state reconciled; owner can see uncertain vs confirmed |
| M17 | Arabic/Egyptian dialect with English SKU | Correct answer and correct mixed-script identifiers |
| M18 | Fresh business install and restore | Install, connect, test, backup, restore and resume verified |

Each scenario must run across unit, integration and real provider/sandbox where applicable. Passing mocks alone caps maturity at L2

## 10. Operating scorecard

Every metric needs a numerator, denominator, segment and observation window

| Metric | Definition |
| --- | --- |
| Autonomous goal completion | Verified completed customer goals / eligible customer goal attempts |
| Grounded material claims | Claims confirmed against current sources or provider records / checked material claims |
| First-contact completion | Eligible conversations completed without later reopen / eligible conversations |
| Appropriate escalation | Correctly escalated cases / cases required to escalate in annotated evaluation set |
| Unnecessary escalation | Escalations without an actual escalation trigger / all escalations |
| Provider action success | Confirmed provider mutations / attempted provider mutations |
| Duplicate action count | Repeated real mutations across idempotent retries; target zero in fault tests |
| Outreach eligibility | Valid consent, segment and template cases / attempted proactive sends |
| Opt-out compliance | Opted-out users with no prohibited contact / all opted-out fixture cases |
| Knowledge freshness | Verified current sources / sources whose freshness interval elapsed |
| Incident recovery | Time to recover service and reconcile uncertain sends per incident |
| Business onboarding time | Time from blank installation to first verified test response |
| Cost per resolved goal | AI + WhatsApp + infrastructure costs / verified autonomous resolutions |
| Human takeover effort | Time and actions from escalation trigger to human ownership |

**Do not borrow conversion or accuracy claims from vendor marketing.** Create holdout sets from pilot businesses, redacted where required, and report the actual sample size and uncertainty

## 11. Recommended execution order

### P0: viable, supportable pilot

1. Resolve channel strategy, account authorization and owner-access contracts
2. Move persistence to PostgreSQL with managed Supabase as optional target, prove migrations and restore
3. Wire source ingestion and freshness into the default conversation flow
4. Isolate simulator traffic, establish deterministic replay and a baseline outcome scorecard
5. Test send recovery, takeover, privacy boundaries and one live inventory action end to end
6. Run an assisted pilot with a small set of different real businesses

### P1: close portable feature parity gaps

1. Website crawler, catalog ingestion and source conflict review
2. Catalog-aware recommendations and verified sales service actions
3. Audience rules based on contact state and owner data, optional verified ad attribution, and compliant follow-up
4. Human takeover improvement and answer-correction feedback
5. Incoming document, photo and voice resolution across the same tool flow

### P2: build the extension business

1. Extension manifest, permission scopes, install/update/rollback
2. Compatibility and isolation tests for third-party skills
3. Paid plugin catalog, licensing and billing
4. Verified multi-brand management and provider cost insights

## 12. Positioning and release discipline

The strongest launch promise is: **Your business owns the deployment, the data configuration and the agent's business capabilities**

Do not market it as matching every native Meta feature. For the assisted beta, lead with one useful customer goal that the agent completes reliably on the customer's own infrastructure. P1 targets **portable outcomes** and respects first-party access limits

Potential buying reason: businesses that need customization, direct access to their records, flexible tools, inspectable decisions and deployment control

Hard reality: Meta has native WhatsApp onboarding and platform integration. A Baileys-based implementation carries a different operational and policy risk. WhatsApp's official Business Platform has rules around customer-initiated and business-initiated messaging, and the product must offer a supported channel strategy before broad commercial distribution

The intended MPL-2.0 license is still a draft PR in this baseline, and the current `README.md` states MIT. Reconcile this before public release

## 13. Evidence and refresh protocol

- Pin every assessment to a commit SHA and assessment date
- Record each maturity change with a passed test link, real provider receipt or pilot observation
- Keep code-present, live-integrated and real-business-proven status separate
- Recheck Meta, Intercom and Zendesk claims quarterly, or when a public feature changes
- Re-score after each milestone and list unverified claims explicitly
- Apply launch gates before any score-based release decision

**Initial audit sources in the repository:** `src/index.ts`, `src/agent/*`, `src/ai/moderator-agent.ts`, `src/server/api.ts`, `src/transport/whatsapp-socket.ts`, `src/domain/*`, `ui/src/components/BrandBrainPage.tsx`, and the tests under `tests/`

**Limitations:** No Bun test suite, external provider sandbox, live connected business, account policy approval, scale test, or penetration test was executed in this research session
