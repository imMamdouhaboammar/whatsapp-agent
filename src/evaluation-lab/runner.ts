/**
 * Offline reply evaluation. Every model response is a checked-in recording.
 * Importing this module does not import the WhatsApp send adapter or HTTP client.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ModeratorAgent, DEFAULT_MODERATOR_PERSONA } from '../ai/moderator-agent';
import { MemoryStore } from '../domain/memory-store';
import { scrubCredentials } from '../domain/learning-memory';
import { evaluatePermission } from '../domain/permission-engine';
import type { AgentMode, AutonomyAction, ChatMessage, PolicyConfig, PolicyRule } from '../domain/types';

export type EvaluationLocale = 'ar-EG' | 'ar-SA' | 'en';
export type EvaluationTurn = { sender: 'contact' | 'owner'; text: string };
export type ForbiddenOutcome = 'send' | 'draft';
export interface EvaluationCase {
  case_id: string;
  locale: EvaluationLocale;
  chat_mode: AgentMode;
  inbound_turns: EvaluationTurn[];
  dossier_facts: string[];
  approved_policy_revision: number;
  expected_action: AutonomyAction;
  expected_send: boolean;
  expected_draft: boolean;
  forbidden_outcomes: ForbiddenOutcome[];
  evidence_ids: string[];
  notes_for_reviewer: string;
  critical: boolean;
}
export interface EvaluationSuite {
  version: number;
  suite_id: string;
  cases: EvaluationCase[];
}
export type RecordedModelResponse =
  | { kind: 'decision'; value: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number } }
  | { kind: 'timeout' }
  | { kind: 'error'; code: string };
export interface EvaluationSnapshot {
  snapshot_id: string;
  model_id: string;
  policy: PolicyConfig;
  responses: Record<string, RecordedModelResponse>;
  approval?: { reviewer: string; reviewed_at: string };
}
export interface HumanReview {
  candidate_id: string;
  reviewer: string;
  reviewed_at: string;
  approved_case_ids: string[];
}
export interface EvaluationResult {
  case_id: string;
  locale: EvaluationLocale;
  outcome: 'pass' | 'violation' | 'inconclusive';
  reason: string;
  expected_action: AutonomyAction;
  observed_action?: AutonomyAction;
  should_send?: boolean;
  draft_created?: boolean;
  matched_rule_id?: string | null;
  policy_reason?: string;
  baseline_action?: AutonomyAction;
  baseline_changed: boolean;
  human_review: 'approved' | 'pending' | 'not_required';
  evidence_ids: string[];
  cited_evidence_ids?: string[];
  model_id: string;
  model_usage?: { input_tokens?: number; output_tokens?: number };
  elapsed_ms: number;
}
export interface EvaluationReport {
  suite_id: string;
  suite_version: number;
  approved_id: string;
  candidate_id: string;
  status: 'blocked' | 'inconclusive' | 'review_required' | 'promotable';
  blocking_case_ids: string[];
  inconclusive_case_ids: string[];
  unreviewed_critical_case_ids: string[];
  results: EvaluationResult[];
  baseline_violations: string[];
  baseline_review_required: boolean;
  evaluated_at: string;
}
export interface EvaluationOptions {
  suite: EvaluationSuite;
  approved: EvaluationSnapshot;
  candidate: EvaluationSnapshot;
  review?: HumanReview;
  timeoutMs?: number;
}
type ReplayObservation = Pick<EvaluationResult, 'observed_action' | 'should_send' |
  'draft_created' | 'matched_rule_id' | 'policy_reason' | 'model_usage' | 'elapsed_ms' |
  'cited_evidence_ids'> & {
    infrastructureError?: string;
  };

const ALLOWED_LOCALES = new Set<string>(['ar-EG', 'ar-SA', 'en']);
const ALLOWED_MODES = new Set<string>(['autopilot', 'copilot', 'human']);
const MAX_TIMEOUT_MS = 120_000;

/** Fail-closed, bounded credential screening before replay memory and report writes. */
function assertSafeFixtureContent(value: unknown): void {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  const maxEntries = 10_000;
  let inspected = 0;

  while (pending.length > 0) {
    if (++inspected > maxEntries) throw new Error('Fixture safety scan limit exceeded');
    const item = pending.pop();
    if (typeof item === 'string') {
      if (scrubCredentials(item) !== item) {
        throw new Error('Sensitive fixture content: redact credentials before offline replay');
      }
      continue;
    }
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const children = Object.values(item);
    if (children.length + pending.length > maxEntries) {
      throw new Error('Fixture safety scan limit exceeded');
    }
    for (const child of children) pending.push(child);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

function isAction(value: unknown): value is AutonomyAction {
  return value === 'reply' || value === 'draft' || value === 'human' ||
    value === 'ignore' || value === 'act';
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isPolicyRule(value: unknown): value is PolicyRule {
  return isRecord(value) && typeof value.id === 'string' && typeof value.intent === 'string' &&
    (value.effect === 'allow' || value.effect === 'require_approval' || value.effect === 'deny') &&
    (value.action === undefined || isAction(value.action)) &&
    (value.minConfidence === undefined || typeof value.minConfidence === 'number');
}

type ReplaySnapshot = Pick<EvaluationSnapshot, 'snapshot_id' | 'model_id' | 'policy'> & {
  responses: Record<string, unknown>;
  approval?: unknown;
};

function isReplaySnapshot(value: unknown): value is ReplaySnapshot {
  return isRecord(value) && isNonemptyString(value.snapshot_id) && isNonemptyString(value.model_id) &&
    isRecord(value.responses) && isRecord(value.policy) &&
    typeof value.policy.version === 'number' && isAction(value.policy.defaultAction) &&
    typeof value.policy.minConfidence === 'number' &&
    Array.isArray(value.policy.rules) && value.policy.rules.every(isPolicyRule);
}

function isEvaluationTurn(value: unknown): value is EvaluationTurn {
  return isRecord(value) && (value.sender === 'contact' || value.sender === 'owner') &&
    isNonemptyString(value.text);
}

function isEvaluationCase(value: unknown): value is EvaluationCase {
  if (!isRecord(value)) return false;
  const { inbound_turns: turns, forbidden_outcomes: forbidden } = value;
  return typeof value.case_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{1,100}$/.test(value.case_id) &&
    typeof value.locale === 'string' && ALLOWED_LOCALES.has(value.locale) &&
    typeof value.chat_mode === 'string' && ALLOWED_MODES.has(value.chat_mode) &&
    isAction(value.expected_action) &&
    Array.isArray(turns) && turns.every(isEvaluationTurn) && turns.at(-1)?.sender === 'contact' &&
    isStringList(value.dossier_facts) && isStringList(value.evidence_ids) &&
    Array.isArray(forbidden) && forbidden.every((item: unknown) => item === 'send' || item === 'draft') &&
    isNonemptyString(value.notes_for_reviewer) &&
    typeof value.expected_send === 'boolean' && typeof value.expected_draft === 'boolean' &&
    typeof value.critical === 'boolean' && typeof value.approved_policy_revision === 'number';
}

function readSuite(value: unknown, policyVersion: number): EvaluationSuite {
  if (!isRecord(value) || !isNonemptyString(value.suite_id) ||
      typeof value.version !== 'number' || !Number.isInteger(value.version) ||
      !Array.isArray(value.cases) || value.cases.length === 0) {
    throw new Error('Evaluation suite must have a version, identifier and nonempty cases');
  }
  const ids = new Set<string>();
  const cases: EvaluationCase[] = [];
  const rawCases: unknown[] = value.cases;
  for (const testCase of rawCases) {
    if (!isEvaluationCase(testCase) || ids.has(testCase.case_id) ||
        testCase.approved_policy_revision !== policyVersion) {
      const id = isRecord(testCase) && typeof testCase.case_id === 'string' ? testCase.case_id : 'unknown';
      throw new Error(`Invalid or duplicate fixture: ${id}`);
    }
    cases.push(testCase);
    ids.add(testCase.case_id);
  }
  return { suite_id: value.suite_id, version: value.version, cases };
}

const hasReviewMetadata = (value: unknown): value is Record<string, unknown> => {
  return isRecord(value) && isNonemptyString(value.reviewer) &&
    typeof value.reviewed_at === 'string' && Number.isFinite(Date.parse(value.reviewed_at));
};

function eligibleReviews(review: unknown, candidateId: string): Set<string> {
  if (!hasReviewMetadata(review) || review.candidate_id !== candidateId ||
      !isStringList(review.approved_case_ids)) return new Set();
  return new Set(review.approved_case_ids);
}

type ReplayDecision = Record<string, unknown> & {
  action: AutonomyAction;
  intent: string;
  confidence: number;
  citations?: string[];
};

function isReplayDecision(value: unknown): value is ReplayDecision {
  return isRecord(value) && isAction(value.action) && isNonemptyString(value.intent) &&
    typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1 &&
    (value.replyText === undefined || typeof value.replyText === 'string') &&
    (value.citations === undefined || isStringList(value.citations));
}

function isModelUsage(value: unknown): value is NonNullable<EvaluationResult['model_usage']> {
  return isRecord(value) && (value.input_tokens === undefined || typeof value.input_tokens === 'number') &&
    (value.output_tokens === undefined || typeof value.output_tokens === 'number');
}

function setupSyntheticHistory(memory: MemoryStore, testCase: EvaluationCase, chatId: string): void {
  memory.setChatMode(chatId, testCase.chat_mode);
  for (const [index, turn] of testCase.inbound_turns.slice(0, -1).entries()) {
    memory.addMessage({
      id: `history-${index}`, chatId, sender: turn.sender, text: turn.text, timestamp: index + 1,
      type: 'text', isFromMe: turn.sender === 'owner'
    });
  }
  if (testCase.dossier_facts.length > 0) {
    memory.saveDossier({
      chatId, name: 'Synthetic contact', stage: 'lead',
      facts: testCase.dossier_facts, commitments: [], updatedAt: 1
    });
  }
}

async function observe(testCase: EvaluationCase, snapshot: ReplaySnapshot, timeoutMs: number): Promise<ReplayObservation> {
  const recording = snapshot.responses[testCase.case_id];
  if (!recording) return { infrastructureError: 'missing_candidate_recording', elapsed_ms: 0 };
  if (!isRecord(recording) ||
      (recording.kind !== 'decision' && recording.kind !== 'timeout' && recording.kind !== 'error')) {
    return { infrastructureError: 'invalid_recording', elapsed_ms: 0 };
  }
  const decision = isReplayDecision(recording.value) ? recording.value : undefined;
  if (recording.kind === 'decision' && !decision) {
    return { infrastructureError: 'invalid_model_decision', elapsed_ms: 0 };
  }

  const memory = new MemoryStore({ dataDir: ':memory:' });
  const started = performance.now();
  let modelError = false;
  const chatId = `case_${testCase.case_id}@simulator.invalid`;
  try {
    setupSyntheticHistory(memory, testCase, chatId);

    // The model is a scripted in-process double: no credentials, transport or network access.
    const model = {
      generateContent: async () => {
        if (recording.kind === 'timeout') return new Promise<never>(() => {});
        if (recording.kind === 'error') {
          modelError = true;
          throw new Error('Recorded model failure');
        }
        return { text: JSON.stringify(recording.value) };
      }
    };
    const moderator = new ModeratorAgent(model, memory, {
      policy: structuredClone(snapshot.policy),
      persona: { ...DEFAULT_MODERATOR_PERSONA, language: testCase.locale,
        model: snapshot.model_id, simulateTypingDelay: false }
    });
    const inbound = testCase.inbound_turns.at(-1);
    if (!inbound) return { infrastructureError: 'missing_inbound_turn', elapsed_ms: 0 };
    const message: ChatMessage = {
      id: 'current', chatId, sender: 'contact', senderName: 'Synthetic contact',
      text: inbound.text, timestamp: testCase.inbound_turns.length + 1,
      isFromMe: false, type: 'text'
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        moderator.processInboundMessage(message, { dryRun: true }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Replay timeout')), timeoutMs);
        })
      ]);
      if (modelError) return { infrastructureError: 'recorded_model_error', elapsed_ms: Math.round(performance.now() - started) };

      // Record the actual production evaluator's matched rule; the actual action
      // and send disposition come from the real ModeratorAgent dry run.
      const permission = evaluatePermission(snapshot.policy, {
        intent: decision?.intent ?? 'general_faq',
        confidence: decision?.confidence ?? 0.85,
        requestedAction: decision?.action
      });
      return {
        observed_action: result.decision.action,
        should_send: result.shouldSendImmediately,
        draft_created: Boolean(result.draftCreated),
        matched_rule_id: permission.matchedRuleId,
        policy_reason: permission.reason,
        model_usage: decision && isModelUsage(recording.usage) ? recording.usage : undefined,
        cited_evidence_ids: decision?.citations && [...decision.citations],
        elapsed_ms: Math.round(performance.now() - started)
      };
    } catch (error) {
      return {
        infrastructureError: error instanceof Error && error.message === 'Replay timeout'
          ? 'model_timeout' : 'replay_failure',
        elapsed_ms: Math.round(performance.now() - started)
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    memory.close();
  }
}

function verdict(testCase: EvaluationCase, observed: ReplayObservation): { outcome: EvaluationResult['outcome']; reason: string } {
  if (observed.infrastructureError) return { outcome: 'inconclusive', reason: observed.infrastructureError };
  const forbiddenSend = testCase.forbidden_outcomes.includes('send') && observed.should_send;
  const forbiddenDraft = testCase.forbidden_outcomes.includes('draft') && observed.draft_created;
  const unknownCitation = observed.cited_evidence_ids?.some(id => !testCase.evidence_ids.includes(id));
  if (unknownCitation) return { outcome: 'violation', reason: 'unverified_citation' };
  if (observed.observed_action !== testCase.expected_action ||
      observed.should_send !== testCase.expected_send ||
      observed.draft_created !== testCase.expected_draft ||
      forbiddenSend || forbiddenDraft) {
    return { outcome: 'violation', reason: forbiddenSend || forbiddenDraft
      ? 'forbidden_outcome' : 'contract_mismatch' };
  }
  return { outcome: 'pass', reason: 'contract_matched' };
}

/** Independent goldens remain untouched even when the candidate fails. */
export async function runEvaluationLab(options: { suite: unknown; approved: unknown; candidate: unknown; review?: unknown; timeoutMs?: number }): Promise<EvaluationReport> {
  const { approved, candidate, review } = options;
  for (const input of [options.suite, approved, candidate, review]) assertSafeFixtureContent(input);
  if (!isReplaySnapshot(approved) || !isReplaySnapshot(candidate)) {
    throw new Error('Invalid evaluation snapshot');
  }
  if (approved.snapshot_id === candidate.snapshot_id) {
    throw new Error('Candidate must have an independent snapshot identifier');
  }
  const suite = readSuite(options.suite, approved.policy.version);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('timeoutMs must be between 1 and 120000');
  }
  const approvedReviews = eligibleReviews(review, candidate.snapshot_id);
  const baselineReviewRequired = !hasReviewMetadata(approved.approval);
  const results: EvaluationResult[] = [];
  const baselineViolations: string[] = [];
  for (const testCase of suite.cases) {
    const baseline = await observe(testCase, approved, timeoutMs);
    const baselineVerdict = verdict(testCase, baseline);
    if (baselineVerdict.outcome !== 'pass') baselineViolations.push(testCase.case_id);
    const candidateObservation = candidate === approved
      ? baseline : await observe(testCase, candidate, timeoutMs);
    const resultVerdict = verdict(testCase, candidateObservation);
    results.push({
      case_id: testCase.case_id,
      locale: testCase.locale,
      outcome: resultVerdict.outcome,
      reason: resultVerdict.reason,
      expected_action: testCase.expected_action,
      observed_action: candidateObservation.observed_action,
      should_send: candidateObservation.should_send,
      draft_created: candidateObservation.draft_created,
      matched_rule_id: candidateObservation.matched_rule_id,
      policy_reason: candidateObservation.policy_reason,
      baseline_action: baseline.observed_action,
      baseline_changed: baseline.observed_action !== candidateObservation.observed_action ||
        baseline.should_send !== candidateObservation.should_send ||
        baseline.draft_created !== candidateObservation.draft_created,
      human_review: testCase.critical
        ? (approvedReviews.has(testCase.case_id) ? 'approved' : 'pending') : 'not_required',
      evidence_ids: [...testCase.evidence_ids],
      cited_evidence_ids: candidateObservation.cited_evidence_ids,
      model_id: candidate.model_id,
      model_usage: candidateObservation.model_usage,
      elapsed_ms: candidateObservation.elapsed_ms
    });
  }
  const blocking = results.filter(r => r.outcome === 'violation').map(r => r.case_id);
  const inconclusive = results.filter(r => r.outcome === 'inconclusive').map(r => r.case_id);
  const unreviewed = results.filter(r => r.human_review === 'pending').map(r => r.case_id);
  const status: EvaluationReport['status'] = baselineViolations.length || blocking.length
    ? 'blocked' : inconclusive.length
      ? 'inconclusive' : baselineReviewRequired || unreviewed.length ? 'review_required' : 'promotable';
  return {
    suite_id: suite.suite_id,
    suite_version: suite.version,
    approved_id: approved.snapshot_id,
    candidate_id: candidate.snapshot_id,
    status,
    blocking_case_ids: [...new Set([...baselineViolations, ...blocking])],
    inconclusive_case_ids: inconclusive,
    unreviewed_critical_case_ids: unreviewed,
    baseline_violations: baselineViolations,
    baseline_review_required: baselineReviewRequired,
    results,
    evaluated_at: new Date().toISOString()
  };
}

/** Exclusive creation prevents concurrent runs from replacing another report. */
export async function writeReportExclusive(path: string, report: EvaluationReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
