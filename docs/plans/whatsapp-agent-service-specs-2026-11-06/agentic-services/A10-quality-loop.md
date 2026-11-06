# A10 Conversation Intelligence and Continuous Agent Improvement

**Priority:** P2 | **Runtime:** Bun instrumentation + Python offline evaluations | **UX:** /knowledge-gaps and /activity

## Why

Autonomy improves when the agent detects where it cannot resolve work, captures useful examples and learns where a business source or connector is missing. The agent should not silently rewrite business policy after one uncertain chat.

## Inputs

- Customer intents, tool traces, knowledge citations, model uncertainty, case outcome
- Repeated unanswered queries, missed retrieval, customer corrections, support reopenings
- Connector failures, false product matches, stale catalog results and duplicate follow-up attempts

## Outputs

- Knowledge Gap: question cluster, missing source type, example conversation redacted, occurrence count
- Proposed source patch: suggested FAQ or catalog correction with citations and confidence
- New skill candidate: repeated action requiring an external provider
- Scenario fixture: replayable anonymized transcript and expected tool outcomes
- Brand Pulse summary: leading inquiries, unresolved cases, product demand and observed conversion counts

## Safe improvement loop

1. Aggregate privacy-preserving traces
2. Cluster common failures and identify likely root source
3. Suggest an evidence-backed change to Brand Brain or connector mapping
4. Run offline test scenarios and shadow replay against previous version
5. Promote source changes by authority: ordinary verified sync can activate, ambiguous brand policy changes go to source review
6. Compare completion/citation/error rates after change

Owner intervention here is for changes to authoritative brand content, not approval of routine customer replies.

## Tests

- Three paraphrased no-answer questions create one coherent gap cluster
- Customer data is redacted from evaluation report
- A correction never changes live pricing without provider verification
- Candidate update that regresses an E2E scenario cannot auto-activate
- Dashboard counts based on real traces rather than invented success data

## Metrics

Autonomous resolution, evidence-supported answer rate, first-contact completion, tool failure by provider, reopened cases, proactive reply relevance, correction recurrence, average goal completion time. Define denominator for every metric.
