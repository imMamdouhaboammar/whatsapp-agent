# WhatsApp Agent: Autonomous Brand Operator Blueprint V2

Research-backed capability specifications | 2026-11-06 | Planning deliverable

## Product thesis

The owner links a brand WhatsApp account, teaches the agent about the business, connects operational tools, sets an autonomy profile once and activates it. The agent then owns the full customer-conversation lifecycle: discovering intent, answering accurately, taking actions in business software, starting eligible conversations, making follow-ups, resolving requests and learning from outcomes.

**Auto-Pilot is the primary product mode.** Owner involvement is exceptional rather than required for routine replies or everyday business actions. Co-Pilot and Human modes remain optional fallbacks.

The objective is a capable, independently acting brand representative with reliable execution and evidence, not a message-approval dashboard.

## Recommended release priorities

| Priority | Agent capability | Main implementation |
| --- | --- | --- |
| P0 | A01 Brand Brain: website, documents, catalog, policies | Bun orchestration + Python ingestion |
| P0 | A02 Hybrid Knowledge Retrieval | SQLite FTS5 + embeddings initially; optional Qdrant |
| P0 | A05 Agent Planner and Skill Runner | Bun/TypeScript, persisted workflow journal |
| P0 | A06 Business Connector Hub | Bun/TypeScript typed adapters |
| P1 | A03 Web Scout: current outside-world facts | Gemini Google Search grounding / URL context |
| P1 | A04 Multimodal Inbox | Existing audio path + Python Docling + media adapters |
| P1 | A07 Customer 360 | Existing SQLite and planned WCF extension |
| P1 | A08 Proactive Follow-Up | Bun scheduler; Go candidate if measured |
| P1 | A09 Sales, Service and Booking Skills | Tool-backed specialist playbooks |
| P2 | A10 Agent Quality Loop | Bun telemetry + offline Python eval suites |

## Repository reality

Repo inspected at main commit e6be0b2e787d7219265dd4c21188b0638dea00d5 (2026-11-06). Existing app uses Bun, Baileys, Gemini, SQLite WAL, drafts/modes, memories, voice capabilities and React bilingual RTL/LTR UI.

docs/plans/2026-11-06-whatsapp-context-fold.md exists as a **plan**, not verified implemented functionality. Our Customer 360 design builds on its proposed conversation folding and message lineage, avoiding a duplicate memory subsystem.

Existing Baileys transport is unofficial. For brands using the Meta WhatsApp Business Platform, add an official Cloud API adapter and model template, consent and 24-hour window constraints.

## Owner journey

1. Connect WhatsApp
2. Create Brand Brain from website, files, catalog and business facts
3. Connect operational apps like Shopify, WooCommerce, Sheets, calendar and CRM
4. Choose an **Autonomy Profile** once
5. Run simulated conversations, then activate Auto-Pilot
6. Monitor resolved requests, ongoing work, scheduled follow-ups, outcomes and knowledge gaps

The agent should not ask the owner to approve each ordinary reply, stock lookup, shipping check or eligible follow-up.

## Package map

- START-HERE-AR.md: owner summary in Egyptian Arabic
- 01-repository-evidence.md: baseline inspection from first pass
- 02-capability-catalog.md: autonomy-first feature map
- 03-architecture.md: orchestration, knowledge and tool boundaries
- 04-release-plan-and-tests.md: phased implementation and acceptance
- 05-privacy-and-threats.md: supporting trust and compliance notes
- 06-research-and-assumptions.md: primary sources and open decisions
- 07-implementation-map.md: initial repo mapping
- agentic-services/A01-A10: detailed build specs
- services/S01-S08: **supporting engineering appendices from V1**, no longer the primary product roadmap
- contracts/: proposed event and worker interfaces
- decision-record.json: capability-first decision record

Research/specs only. No working code, app tests, live WhatsApp session or deployment was completed for this package.

## Implementation principle

Prefer modular services inside the Bun application before splitting deployment. Python is justified for document/media processing; Go can own scheduled tasks if measured requirements warrant extraction; Rust is reserved for demonstrated CPU bottlenecks. Agent capabilities, integration and tests come before language variety.
