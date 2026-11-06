# S05: Reply Evaluation Lab

Priority P1 | Offline Python runner

## User problem

Changing a persona, permission rule or model can silently alter the assistant's behavior in sensitive Arabic conversations. Owners need evidence before enabling the new version in Auto-Pilot

## Existing parts

CLI simulator, ModeratorAgent decision structure, existing permission tests and drafts. The runner must reuse the same real policy evaluator in a dry-run mode

## Scope

- Versioned, reviewed conversation fixtures covering ar-EG, ar-SA and en
- Expected behavioral contract: chat mode, allowed action, recipient, sensitive-content handling, and whether draft approval is required
- Offline replay with WhatsApp send adapter disabled by construction
- Report decision mismatches, response citations, human judgments, model usage and elapsed time
- Compare candidate prompt/model/policy to a pinned approved baseline on identical fixtures
- Promote a candidate only after a human review of critical cases

## Fixture format

case_id, locale, chat_mode, inbound_turns, dossier_facts, approved_policy_revision, expected_action, forbidden_outcomes, evidence_ids, notes_for_reviewer

Every fixture declares why it exists. Test data should be synthetic or explicitly consented, redacted real examples. Keep fixture revisions and expected behavior under code review; never rewrite goldens merely to match the newest model output

## Required test suites

- Consent and privileged requests
- Money, medical and legal uncertainty
- Prompt injection in user message and media/OCR result
- Recipient confusion or old quoted content
- Ambiguous Arabizi, slang, dialect and mixed Arabic/English
- Wrong context/memory citation
- Long message, multi-bubble split and low-confidence behavior
- Offline or failed model response
- Human, Co-Pilot and Auto-Pilot mode preservation

## Reporting

Separate deterministic contract violations (blocking), model judgment samples (human review), and infrastructure errors (test inconclusive). Never describe a model quality grade as objectively proven without an independently defined rubric and review population

## Acceptance tests

- A failure in "must not send in Human mode" blocks candidate promotion
- No fixture or worker can reach the real send gateway
- Replaying same deterministic policy test yields same result
- Two parallel reports cannot overwrite another version's results
- Candidate model timeout yields inconclusive, not passing
- Approved baseline is preserved after unsuccessful candidate evaluation

## Operation

Run on demand or in CI after changes to prompts/policy/model adapters. Start as a CLI worker; no always-on Python API service is needed
