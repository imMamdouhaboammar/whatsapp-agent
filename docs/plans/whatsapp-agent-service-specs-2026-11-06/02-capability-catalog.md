# Autonomy-first Capability Catalogue

Agentic means the assistant selects and executes appropriate steps to complete customer goals with a traceable outcome, rather than only drafting chat replies.

| Module | Customer result | Background capability | Autonomy behavior |
| --- | --- | --- | --- |
| Brand Brain | Correct policies, price lists, product facts | Ingestion, sync, provenance | Resolve brand-specific questions |
| Hybrid RAG | Precise, defensible answers | Lexical + dense retrieval, rerank, freshness | Select facts, check conflicts |
| Web Scout | Answers about recent external facts | Search, URL verification, grounded citations | Research when business data is insufficient |
| Multimodal Inbox | Natural messages and attachments | OCR, ASR, document tables, image/video reading | Understand without customer retyping |
| Planner + Skill Runner | Multi-step issue completed | Function calling, durable progress, retries | Decide next action and invoke tools |
| Connector Hub | Orders, inventory, tickets, quotes, bookings | Typed APIs and write receipts | Read and write real business state |
| Customer 360 | Personalized continuity | Facts, WCF summaries, case state | Remember commitments |
| Proactive Engagement | Timely follow-up | Business events, timers, templates | Start eligible conversations automatically |
| Specialist Skills | Sales conversion, customer support | Playbooks and tool scopes | Coordinate specialist capability in one chat |
| Quality Loop | Fewer repeated failures | Replay, gap detection, evaluations | Improve knowledge and workflows |

## Expansion ideas

1. Smart Catalog Visual Search, matching product photos to SKUs and attributes
2. Voice-native Selling, understanding dialects and optionally returning voice notes
3. Quote Composer, parsing purchase specifications and issuing a PDF quote
4. Case Resolver, identifying orders, checking shipping and updating tickets
5. Bookable Flows, selecting slots and collecting structured details
6. Campaign Intelligence, contacting eligible customers with templates and reply tracking
7. Knowledge Gap Miner, clustering unanswered or poorly evidenced queries
8. Business Pulse, surfacing complaint clusters and stock demand to the owner
9. Human Takeover Memory, preserving context during exceptional intervention
10. Multi-brand Workspaces, with isolation of identities, knowledge, tools and conversations

## Modes

- **Auto-Pilot (default)**: research, respond, use tools and follow up under a brand Autonomy Profile
- **Co-Pilot (optional)**: propose actions to a human for selected accounts or time periods
- **Human (optional)**: owner runs chat; agent remains available for context and retrieval

Autonomy Profile is set during onboarding, not per message. Allow normal status reads, creating tickets, booking open slots, quotes within configured terms and compliant outreach automatically. Reserve defined exceptional acts such as large refunds or unsupported commitments for owner review.

## Product routes, English LTR and Arabic RTL

- Inbox: compact native-style message area, actual sent/delivered/read states, per-chat mode, attachment previews
- Brand Brain: source library, upload, website sync, policy edits, evidence conflicts
- Agent Skills: connectors, authorized scopes, health, test action, activity
- Auto-Pilot: autonomy profile, hours, outreach conditions, scenario tests
- Follow-ups: pending and completed tasks with reason and result
- Agent Activity: live traces of research, tool calls, actions and outcomes
- Knowledge Gaps: missing documents and low-evidence questions
- Customer 360: contact identity, orders, cases, preferences and commitments

AI assistant sidebar uses a standard compact width and collapse control. Settings is a dedicated route with a single navigation entry. UI must mirror RTL correctly while keeping phone numbers, SKUs, timestamps and URLs legible in LTR.
