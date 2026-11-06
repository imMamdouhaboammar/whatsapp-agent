# Repository Integration Map

Repository baseline: imMamdouhaboammar/whatsapp-agent main e6be0b2e787d7219265dd4c21188b0638dea00d5.

Existing files observed during review include src/index.ts, src/ai/gemini-client.ts, src/ai/moderator-agent.ts, src/transport/whatsapp-socket.ts, src/domain/db.ts, src/domain/memory-store.ts, src/domain/types.ts and src/server/api.ts. Paths below are proposals, not claims that files exist.

| Existing integration | New modules (proposed) | Ownership |
| --- | --- | --- |
| src/ai/moderator-agent.ts | src/agent/goal-planner.ts, skill-runner.ts, outcome-check.ts | Agent orchestration |
| src/ai/gemini-client.ts | src/agent/model-tools.ts, search-grounding.ts | Model + tool invocation |
| src/domain/db.ts, memory-store.ts | src/brand/knowledge-store.ts, src/agent/workflow-store.ts | Durable app state |
| src/transport/whatsapp-socket.ts | src/transport/adapter.ts, meta-cloud-adapter.ts | One selected transport/account |
| src/server/api.ts | src/server/routes/brand-brain.ts, connectors.ts, followups.ts | UI API |
| Existing voice handling | workers/media-python/, src/agent/media-service.ts | Documents and attachments |
| Existing contact dossier | src/customer/customer-360.ts | Identity/case context |
| docs/plans/2026-11-06-whatsapp-context-fold.md | WCF implementation as planned, src/customer/context-bridge.ts | Context assembly; no duplicate fold tables |
| Existing React UI | Brand Brain, Skills, Autopilot, Follow-ups, Agent Activity routes | Product pages RTL/LTR |

## Build sequence and contract ownership

1. Add branded source records and normalized document contracts, test with website/CSV/PDF
2. Implement retrieval as a replaceable interface; benchmark FTS5 + embeddings and managed File Search with identical queries
3. Build planner tool registry backed by deterministic mocks and an action journal
4. Add one live inventory/order connector and run E01/E08 scenarios
5. Add file/media worker and call it through the same tool registry
6. Integrate WCF when merged; before that rely on current memory store
7. Add scheduled engagement and official WhatsApp capabilities as adapter features
8. Expand specialists/evaluations and measured extractions only after evidence

## No repo write by this research package

No application source files changed. The proposed integration plan needs a fresh tree check before execution because the main branch is active.
