import { describe, expect, it } from 'bun:test';
import { evaluatePermission, applyModelCeiling } from '../src/domain/permission-engine';
import type { PolicyConfig } from '../src/domain/types';

describe('Permission Engine', () => {
  const samplePolicy: PolicyConfig = {
    version: 1,
    defaultAction: 'human',
    minConfidence: 0.8,
    rules: [
      { id: 'faq_rule', intent: 'faq_inquiry', effect: 'allow', action: 'reply' },
      { id: 'refund_rule', intent: 'refund_request', effect: 'require_approval', action: 'draft' },
      { id: 'spam_rule', intent: 'spam', effect: 'deny', action: 'ignore' }
    ]
  };

  it('allows reply for high-confidence faq intent', () => {
    const result = evaluatePermission(samplePolicy, {
      intent: 'faq_inquiry',
      confidence: 0.95
    });
    expect(result.allowed).toBe(true);
    expect(result.action).toBe('reply');
    expect(result.matchedRuleId).toBe('faq_rule');
  });

  it('downgrades to human when confidence is below minimum threshold', () => {
    const result = evaluatePermission(samplePolicy, {
      intent: 'faq_inquiry',
      confidence: 0.65
    });
    expect(result.allowed).toBe(false);
    expect(result.action).toBe('human');
    expect(result.reason).toBe('low_confidence');
    expect(result.downgraded).toBe(true);
  });

  it('forces draft when rule requires approval', () => {
    const result = evaluatePermission(samplePolicy, {
      intent: 'refund_request',
      confidence: 0.9
    });
    expect(result.allowed).toBe(true);
    expect(result.action).toBe('draft');
    expect(result.reason).toBe('approval_required');
  });

  it('denies spam intents', () => {
    const result = evaluatePermission(samplePolicy, {
      intent: 'spam',
      confidence: 0.99
    });
    expect(result.allowed).toBe(false);
    expect(result.action).toBe('ignore');
  });

  it('applies model ceiling when model requested lower autonomy', () => {
    const ceiling = applyModelCeiling('reply', 'draft');
    expect(ceiling.action).toBe('draft');
    expect(ceiling.downgraded).toBe(true);
  });
});
