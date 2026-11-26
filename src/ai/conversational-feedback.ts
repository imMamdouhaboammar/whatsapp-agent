import type { ChatMessage } from '../domain/types';
import type { WorldTransitionRecord } from './jepa-world-model';

export type ConversationalFeedbackKind =
  | 'correction'
  | 'escalation'
  | 'positive_confirmation'
  | 'clarification_loop';

export interface ConversationalFeedbackSignal {
  kind: ConversationalFeedbackKind;
  confidence: number;
  evidenceSnippet: string;
  turnIndex: number;
  timestamp: number;
  suggestedScope: 'local' | 'global';
  worldFeedbackType: WorldTransitionRecord['feedbackType'];
}

const CORRECTION_PATTERNS: RegExp[] = [
  /(?:لا\s+مش\s+(?:قصدي|كده|ده)|مش\s+ده\s+اللي|غلط|معلومة\s+غلط|السعر\s+مش\s+كده|فهمتني\s+غلط)/i,
  /(?:\b(?:no,?\s*i\s+meant|that'?s\s+wrong|you\s+misunderstood|not\s+what\s+i\s+asked|wrong\s+price|incorrect)\b)/i
];

const ESCALATION_PATTERNS: RegExp[] = [
  /(?:عايز\s+أكلم\s+(?:حد|بشري|الإدارة|المدير)|كلمني\s+حد|مفيش\s+فايدة|زهقت|توقف|بطل\s+رد)/i,
  /(?:\b(?:talk\s+to\s+a?\s*human|real\s+person|manager|supervisor|stop\s+replying|useless)\b)/i
];

const POSITIVE_PATTERNS: RegExp[] = [
  /(?:تمام\s*(?:أوي|جداً|شكراً)?|تسلم(?:\s+إيدك)?|ممتاز|حلو\s+أوي|وصلت|فهمت\s+شكراً|شكراً\s+جزيلاً|مظبوط)/i,
  /(?:\b(?:perfect|thank\s+you|thanks\s+a\s+lot|got\s+it|makes\s+sense|awesome|great\s+help|resolved)\b)/i
];

function normalizeForLoopCheck(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ');
}

function tokenOverlap(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter((w) => w.length >= 2));
  const setB = new Set(b.split(' ').filter((w) => w.length >= 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) {
    if (setB.has(w)) shared++;
  }
  return shared / Math.max(setA.size, setB.size);
}

/**
 * Extracts implicit back-and-forth conversational feedback signals from a thread.
 * Only inspects customer (non-isFromMe) turns that follow agent/owner turns,
 * so untrusted inbound text is classified as an observational signal rather than
 * directly mutating global rules.
 */
export function extractConversationalFeedback(messages: ChatMessage[]): ConversationalFeedbackSignal[] {
  const signals: ConversationalFeedbackSignal[] = [];
  if (!messages || messages.length === 0) return signals;

  let lastAgentIdx = -1;
  let lastCustomerTextNorm = '';

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.isFromMe) {
      lastAgentIdx = i;
      continue;
    }

    const rawText = (msg.text || msg.transcription || '').trim();
    if (!rawText) continue;

    const snippet = rawText.slice(0, 180);
    const hasPriorAgentTurn = lastAgentIdx >= 0;

    if (ESCALATION_PATTERNS.some((re) => re.test(rawText))) {
      signals.push({
        kind: 'escalation',
        confidence: 0.9,
        evidenceSnippet: snippet,
        turnIndex: i,
        timestamp: msg.timestamp,
        suggestedScope: 'local',
        worldFeedbackType: 'unresolved'
      });
      lastCustomerTextNorm = normalizeForLoopCheck(rawText);
      continue;
    }

    if (hasPriorAgentTurn && CORRECTION_PATTERNS.some((re) => re.test(rawText))) {
      signals.push({
        kind: 'correction',
        confidence: 0.85,
        evidenceSnippet: snippet,
        turnIndex: i,
        timestamp: msg.timestamp,
        suggestedScope: 'local',
        worldFeedbackType: 'unresolved'
      });
      lastCustomerTextNorm = normalizeForLoopCheck(rawText);
      continue;
    }

    const norm = normalizeForLoopCheck(rawText);
    if (hasPriorAgentTurn && lastCustomerTextNorm && norm.length >= 8) {
      const overlap = tokenOverlap(lastCustomerTextNorm, norm);
      if (overlap >= 0.55) {
        signals.push({
          kind: 'clarification_loop',
          confidence: 0.78,
          evidenceSnippet: snippet,
          turnIndex: i,
          timestamp: msg.timestamp,
          suggestedScope: 'local',
          worldFeedbackType: 'unresolved'
        });
        lastCustomerTextNorm = norm;
        continue;
      }
    }

    if (hasPriorAgentTurn && POSITIVE_PATTERNS.some((re) => re.test(rawText))) {
      signals.push({
        kind: 'positive_confirmation',
        confidence: 0.82,
        evidenceSnippet: snippet,
        turnIndex: i,
        timestamp: msg.timestamp,
        suggestedScope: 'local',
        worldFeedbackType: 'resolved'
      });
    }

    lastCustomerTextNorm = norm;
  }

  return signals;
}

/**
 * Summarizes conversational feedback signals into a compact prompt block for ReflectionEngine.
 */
export function formatConversationalFeedbackForReflection(signals: ConversationalFeedbackSignal[]): string {
  if (signals.length === 0) return 'None detected.';
  return signals
    .map(
      (s) =>
        `- [${s.kind}] (turn ${s.turnIndex}, confidence ${s.confidence.toFixed(2)}, world=${s.worldFeedbackType}): "${s.evidenceSnippet}"`
    )
    .join('\n');
}
