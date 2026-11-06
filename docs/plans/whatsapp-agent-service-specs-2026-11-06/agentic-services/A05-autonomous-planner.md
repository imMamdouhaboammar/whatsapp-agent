# A05 Autonomous Planner, Tool Router and Durable Execution

**Priority:** P0 | **Runtime:** Bun/TypeScript | **Owner:** Agent Orchestrator

## Responsibility

Turn a free-form customer goal into an outcome. The agent can think through a plan, inspect brand data, call live tools, ask for missing information, complete a business operation and record what actually happened. No owner click is needed for routine allowed actions.

## Core state machine

received -> understanding -> gathering_evidence -> choosing_action -> executing -> verifying -> responding -> completed

Alternate states: needs_customer_detail, scheduled, waiting_provider, exceptional_escalation, cancelled, failed_recoverable

One conversation coordinator owns each active customer turn. Specialist skills are delegated internally and cannot independently send conflicting messages.

## Skill manifest

Each tool declares name, description, JSON argument schema, result schema, read/write classification, brand scopes, prerequisites, idempotency mode, cost category, duration and compensation/reconciliation behavior. Tool registry dynamically exposes only connected and authorized tools.

## Example plan

Goal: "عايز أشوف حالة الطلب 441 ولو متأخر بلغني"

1. Identify/order number, query live order connector
2. If identity verification needed, ask one targeted question
3. Find carrier event and ETA
4. Respond with confirmed status
5. Create a follow-up trigger for a changed status when eligible
6. Log case and tool receipts

## Workflow journal

- workflow_id, brand_id, conversation_id, goal, current_step, state, actor
- Each write: tool_run_id, idempotency_key, provider_request_id, observed_result, uncertainty and timestamp
- If a write times out, reconcile by external ID before any retry
- Bound maximum tool loops, elapsed time, external requests and model cost by brand profile
- Do not mark "booked", "refunded" or "ordered" unless provider confirms

## Model strategy

Use Gemini function calling with deterministic app-side tool execution. Let planner dynamically select tools and re-plan after tool output. Use JSON schema validation, small atomic tool functions and an outcome checker. Avoid pretending model text is the source of truth for a database mutation.

## Tests

- Multi-step action uses correct provider sequence; final answer matches provider result
- Missing parameter asks customer rather than guesses
- Bad tool output prompts retry or appropriate recovery
- Timeout after a create action never duplicates external write
- Competing incoming bursts preserve per-chat serialized action ownership
- A malicious knowledge chunk cannot grant new tools or change configured profile
- Restart in waiting_provider resumes from journal

## Acceptance

At least one real end-to-end commerce or support use case runs in Auto-Pilot with a confirmed external outcome, using test credentials and fixtures.
