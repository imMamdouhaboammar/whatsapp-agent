# S05 Reply Evaluation Lab

A local, recorded-response evaluation runner for moderation policy changes. It replays the real `ModeratorAgent.processInboundMessage(..., { dryRun: true })` decision path, including the production `evaluatePermission` function. The model is replaced with an in-process recording, and each case uses an ephemeral in-memory database. No WhatsApp socket, HTTP sender, external model client or production database is instantiated.

## Run

From the repository root, with Bun:

```sh
bun run src/evaluation-lab/cli.ts --candidate fixtures/reply-evaluation/candidate-demo.json
```

The default suite is `fixtures/reply-evaluation/cases-v1.json`, and the pinned synthetic reference is `fixtures/reply-evaluation/synthetic-reference-v1.json`. This checked-in example has **no human approval** and cannot qualify a candidate for promotion. Supply a separately reviewed baseline using `--approved` before considering release. Override the suite with `--suite`. Use `--timeout-ms 5000` for replay deadlines and `--out /path/to/report.json` for an explicit report location. Reports are written exclusively: an existing file will never be replaced.

The demo candidate deliberately has no human-review manifest. All 18 recorded fixtures pass their deterministic checks, but the CLI exits 2 with `review_required` because both the reference baseline and critical candidate cases await human approval. An inconclusive model replay also exits 2, and a malformed input exits 1.

## Candidate format

Copy the baseline snapshot, give `snapshot_id` a new immutable identifier, and replace each recorded `responses[case_id]` with the proposed model's output for that exact input. The runner requires every candidate recording. It never silently borrows an approved answer when one is absent. Both snapshots reference a real `PolicyConfig` with its own revision number.

Recordings are JSON objects shaped like:

```json
{
  "kind": "decision",
  "value": {
    "action": "reply",
    "intent": "general_faq",
    "confidence": 0.93,
    "replyText": "Recorded synthetic reply"
  }
}
```

For failure scenarios use `{"kind":"timeout"}` or `{"kind":"error","code":"offline"}`. They are reported as `inconclusive`, never passing. The `usage` field may contain genuine, separately recorded token counts; absent usage is left absent. A recorded `value.citations` array is compared against the fixture's approved `evidence_ids`; unknown evidence IDs block promotion and are visible to the reviewer. The current ModeratorAgent does not validate factual citation claims, so this checks references in recordings only. Do not invent usage or quality scores.

## Human review

For candidate promotion, a real reviewer examines all critical cases, verifies expected behavior and provides a review manifest. Example shape:

```json
{
  "candidate_id": "candidate-identical-to-reviewed-snapshot-id",
  "reviewer": "actual-reviewer-identity",
  "reviewed_at": "2026-11-08T12:00:00.000Z",
  "approved_case_ids": ["case-id-the-reviewer-actually-accepted"]
}
```

After an authorized human review, the baseline snapshot must include an `approval` object with the real reviewer's identity and ISO timestamp. Pass `--review path/to/actual-review.json` for the candidate. The runner reports `promotable` only if all deterministic contracts pass, no case is inconclusive, the baseline has documented human approval and every critical case has a valid review entry for the current candidate ID. This is an evaluation gate, not an automatic production deployment.

## Fixture policy

The checked-in suite contains only synthetic content in ar-EG, ar-SA, and English. The runner screens complete suites, recordings, and review manifests with the repository's `scrubCredentials` helper and rejects credential-bearing input before any fixture reaches replay memory or a report. Every case includes a reason for its presence, an expected action and send/draft disposition, a policy revision, evidence IDs, and forbidden effects. Cases cover privacy and consent, financial/medical/legal uncertainty, prompt injection in text and OCR-like input, quoted content, recipient confusion, dialect and Arabizi ambiguity, memory uncertainty, long replies, model fallback, spam, and Human/Co-Pilot/Auto-Pilot behavior.

Changes to a reviewed golden require normal code review; do not update expected outcomes just because a new model produced something else.

## Current boundary

This first version verifies production moderation and policy decisions against recorded model responses. It does not benchmark live model quality, run a full WhatsApp integration, validate factual claims or observe real delivery receipts. A model evaluation with live API calls belongs in a separate, explicitly authorized data-collection step that produces reviewable recordings. The lab itself remains offline.
