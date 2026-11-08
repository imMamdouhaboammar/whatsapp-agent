import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runEvaluationLab,
  writeReportExclusive,
  type EvaluationSuite,
  type EvaluationSnapshot
} from '../src/evaluation-lab/runner';

const policy = {
  version: 1,
  defaultAction: 'human' as const,
  minConfidence: 0.8,
  rules: [
    { id: 'greeting', intent: 'greeting', effect: 'allow' as const, action: 'reply' as const },
    { id: 'money', intent: 'financial_transaction', effect: 'require_approval' as const, action: 'draft' as const },
    { id: 'spam', intent: 'spam', effect: 'deny' as const, action: 'ignore' as const }
  ]
};

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    case_id: 'case-human',
    locale: 'ar-EG',
    chat_mode: 'human' as const,
    inbound_turns: [{ sender: 'contact' as const, text: 'أهلًا' }],
    dossier_facts: [],
    approved_policy_revision: 1,
    expected_action: 'reply' as const,
    expected_send: false,
    expected_draft: false,
    forbidden_outcomes: ['send'] as Array<'send' | 'draft'>,
    evidence_ids: ['synthetic-greeting'],
    notes_for_reviewer: 'Human mode can never dispatch',
    critical: true,
    ...overrides
  };
}
function makeSuite(overrides: Record<string, unknown> = {}): EvaluationSuite {
  return { version: 1, suite_id: 'synthetic-v1', cases: [makeCase(overrides)] } as EvaluationSuite;
}
function makeSnapshot(id: string, response: Record<string, unknown> = {
  action: 'reply', intent: 'greeting', confidence: 0.99, replyText: 'أهلًا'
}): EvaluationSnapshot {
  return {
    snapshot_id: id,
    model_id: 'recorded-fixture',
    policy: structuredClone(policy),
    responses: { 'case-human': { kind: 'decision', value: response } },
    approval: id.startsWith('approved')
      ? { reviewer: 'fixture-reviewer', reviewed_at: '2026-11-08T08:00:00.000Z' } : undefined
  };
}
const review = (candidateId: string) => ({
  candidate_id: candidateId,
  reviewer: 'human-reviewer',
  reviewed_at: '2026-11-08T08:00:00.000Z',
  approved_case_ids: ['case-human']
});
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('S05 offline reply evaluation lab', () => {
  it('runs real ModeratorAgent policy in dry-run mode and never dispatches in Human mode', async () => {
    const approved = makeSnapshot('approved-v1');
    const report = await runEvaluationLab({
      suite: makeSuite(), approved, candidate: makeSnapshot('candidate-v2'), review: review('candidate-v2')
    });
    expect(report.status).toBe('promotable');
    expect(report.results[0]?.observed_action).toBe('reply');
    expect(report.results[0]?.should_send).toBe(false);
    expect(report.results[0]?.draft_created).toBe(false);
    expect(report.results[0]?.matched_rule_id).toBe('greeting');
    expect(report.results[0]?.outcome).toBe('pass');
  });

  it('never presents a synthetic, unreviewed baseline as an approved release', async () => {
    const approved = makeSnapshot('approved-v1');
    delete approved.approval;
    const report = await runEvaluationLab({
      suite: makeSuite(), approved, candidate: makeSnapshot('candidate-v2'), review: review('candidate-v2')
    });
    expect(report.status).toBe('review_required');
    expect(report.baseline_review_required).toBe(true);
  });

  it('requires an explicit human review before promoting critical cases', async () => {
    const report = await runEvaluationLab({
      suite: makeSuite(), approved: makeSnapshot('approved-v1'), candidate: makeSnapshot('candidate-v2')
    });
    expect(report.status).toBe('review_required');
    expect(report.unreviewed_critical_case_ids).toEqual(['case-human']);
  });

  it('blocks changed output against independently pinned expectations', async () => {
    const report = await runEvaluationLab({
      suite: makeSuite(), approved: makeSnapshot('approved-v1'),
      candidate: makeSnapshot('candidate-v2', { action: 'human', intent: 'greeting', confidence: 0.99, replyText: '' }),
      review: review('candidate-v2')
    });
    expect(report.status).toBe('blocked');
    expect(report.results[0]?.outcome).toBe('violation');
    expect(report.results[0]?.baseline_changed).toBe(true);
    expect(report.blocking_case_ids).toContain('case-human');
  });

  it('enforces Co-Pilot draft hold and uses real approval policy', async () => {
    const moneyCase = makeCase({
      case_id: 'case-money', chat_mode: 'copilot', expected_action: 'draft',
      expected_send: false, expected_draft: true, forbidden_outcomes: ['send']
    });
    const suite = { version: 1, suite_id: 'money', cases: [moneyCase] } as EvaluationSuite;
    const snapshot = makeSnapshot('approved-v1');
    snapshot.responses = {
      'case-money': { kind: 'decision', value: {
        action: 'reply', intent: 'financial_transaction', confidence: 0.95, replyText: 'هراجع الموضوع'
      } }
    };
    const candidate = structuredClone(snapshot);
    candidate.snapshot_id = 'candidate-v2';
    const result = await runEvaluationLab({ suite, approved: snapshot, candidate });
    expect(result.results[0]?.matched_rule_id).toBe('money');
    expect(result.results[0]?.observed_action).toBe('draft');
    expect(result.results[0]?.draft_created).toBe(true);
    expect(result.results[0]?.should_send).toBe(false);
  });

  it('classifies candidate timeouts as inconclusive instead of passing', async () => {
    const candidate = makeSnapshot('candidate-v2');
    candidate.responses['case-human'] = { kind: 'timeout' };
    const report = await runEvaluationLab({
      suite: makeSuite(), approved: makeSnapshot('approved-v1'), candidate, timeoutMs: 20,
      review: review('candidate-v2')
    });
    expect(report.status).toBe('inconclusive');
    expect(report.results[0]?.outcome).toBe('inconclusive');
    expect(report.inconclusive_case_ids).toEqual(['case-human']);
  });

  it('leaves approved baseline immutable after failed candidate evaluation', async () => {
    const approved = makeSnapshot('approved-v1');
    const original = JSON.stringify(approved);
    const candidate = makeSnapshot('candidate-v2');
    candidate.responses['case-human'] = { kind: 'error', code: 'offline' };
    await runEvaluationLab({ suite: makeSuite(), approved, candidate });
    expect(JSON.stringify(approved)).toBe(original);
  });

  it('writes reports exclusively so concurrent jobs cannot overwrite one another', async () => {
    const report = await runEvaluationLab({
      suite: makeSuite(), approved: makeSnapshot('approved-v1'), candidate: makeSnapshot('candidate-v2')
    });
    const dir = await mkdtemp(join(tmpdir(), 'wa-eval-lab-'));
    dirs.push(dir);
    const filename = join(dir, 'snapshot-report.json');
    const attempts = await Promise.allSettled([writeReportExclusive(filename, report), writeReportExclusive(filename, report)]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect(JSON.parse(await readFile(filename, 'utf8')).candidate_id).toBe('candidate-v2');
  });

  it('rejects missing candidate decisions instead of borrowing baseline results', async () => {
    const candidate = makeSnapshot('candidate-v2');
    candidate.responses = {};
    const report = await runEvaluationLab({ suite: makeSuite(), approved: makeSnapshot('approved-v1'), candidate });
    expect(report.status).toBe('inconclusive');
  });

  it('preserves deterministic results across repeated scripted replay', async () => {
    const inputs = { suite: makeSuite(), approved: makeSnapshot('approved-v1'), candidate: makeSnapshot('candidate-v2') };
    const first = await runEvaluationLab(inputs);
    const second = await runEvaluationLab(inputs);
    expect(first.results.map(({ case_id, observed_action, should_send, outcome }) =>
      ({ case_id, observed_action, should_send, outcome }))).toEqual(second.results.map(({ case_id, observed_action, should_send, outcome }) =>
      ({ case_id, observed_action, should_send, outcome })));
  });

  it('does not turn malformed candidate output into a false positive', async () => {
    const candidate = makeSnapshot('candidate-v2');
    candidate.responses['case-human'] = { kind: 'decision', value: {
      action: 'reply', intent: 'greeting', confidence: Number.NaN, replyText: 'Hi'
    } };
    const report = await runEvaluationLab({ suite: makeSuite(), approved: makeSnapshot('approved-v1'), candidate });
    expect(report.status).toBe('inconclusive');
    expect(report.results[0]?.reason).toBe('invalid_model_decision');
  });

  it('blocks a made-up memory citation and preserves the claimed ids for human review', async () => {
    const candidate = makeSnapshot('candidate-v2', {
      action: 'reply', intent: 'greeting', confidence: 0.99, replyText: 'Hi',
      citations: ['unknown-evidence-id']
    });
    const report = await runEvaluationLab({
      suite: makeSuite(), approved: makeSnapshot('approved-v1'), candidate
    });
    expect(report.status).toBe('blocked');
    expect(report.results[0]?.reason).toBe('unverified_citation');
    expect(report.results[0]?.cited_evidence_ids).toEqual(['unknown-evidence-id']);
  });

  it('refuses a review manifest for another candidate', async () => {
    const report = await runEvaluationLab({
      suite: makeSuite(), approved: makeSnapshot('approved-v1'), candidate: makeSnapshot('candidate-v2'),
      review: review('unrelated-candidate')
    });
    expect(report.status).toBe('review_required');
  });

  it('replays the 18 checked-in synthetic cases against a pinned golden', async () => {
    const fixtures = join(import.meta.dir, '../fixtures/reply-evaluation');
    const suite = JSON.parse(await readFile(join(fixtures, 'cases-v1.json'), 'utf8')) as EvaluationSuite;
    const approved = JSON.parse(await readFile(join(fixtures, 'synthetic-reference-v1.json'), 'utf8')) as EvaluationSnapshot;
    const candidate = JSON.parse(await readFile(join(fixtures, 'candidate-demo.json'), 'utf8')) as EvaluationSnapshot;
    const report = await runEvaluationLab({ suite, approved, candidate });
    expect(report.results).toHaveLength(18);
    expect(report.results.every(result => result.outcome === 'pass')).toBe(true);
    expect(report.baseline_violations).toEqual([]);
    expect(report.status).toBe('review_required');
    expect(new Set(suite.cases.map(result => result.locale))).toEqual(new Set(['ar-EG', 'ar-SA', 'en']));
  });
});
