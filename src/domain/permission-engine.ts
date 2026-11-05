import type { AgentDecision, AutonomyAction, PolicyConfig, PolicyRule } from './types';

const AUTHORITY_RANK: Record<string, number> = {
  ignore: 0,
  human: 1,
  draft: 2,
  reply: 3,
  act: 4
};

const EFFECT_RANK: Record<string, number> = {
  allow: 1,
  require_approval: 2,
  deny: 3
};

export interface PermissionEvaluationResult {
  action: AutonomyAction;
  allowed: boolean;
  reason: string;
  matchedRuleId: string | null;
  downgraded: boolean;
}

export function applyModelCeiling(policyAction: AutonomyAction, requestedAction?: AutonomyAction): { action: AutonomyAction; downgraded: boolean } {
  if (!requestedAction) return { action: policyAction, downgraded: false };
  if (policyAction === 'human' || policyAction === 'ignore') {
    return { action: policyAction, downgraded: false };
  }
  if (requestedAction === 'human' || requestedAction === 'ignore') {
    return { action: requestedAction, downgraded: true };
  }

  const policyRank = AUTHORITY_RANK[policyAction] ?? 0;
  const requestedRank = AUTHORITY_RANK[requestedAction] ?? 0;

  if (requestedRank < policyRank) {
    return { action: requestedAction, downgraded: true };
  }
  return { action: policyAction, downgraded: false };
}

export function evaluatePermission(
  policy: PolicyConfig,
  decision: Pick<AgentDecision, 'intent' | 'confidence'> & { requestedAction?: AutonomyAction }
): PermissionEvaluationResult {
  const minConfidence = policy.minConfidence ?? 0.75;
  const confidence = Number(decision.confidence ?? 0);

  if (confidence < minConfidence) {
    return {
      action: 'human',
      allowed: false,
      reason: 'low_confidence',
      matchedRuleId: null,
      downgraded: true
    };
  }

  // Find matching rule by intent
  const matchingRule = policy.rules.find((r) => r.intent === decision.intent || r.intent === '*');

  if (!matchingRule) {
    const defaultAction = policy.defaultAction ?? 'human';
    return {
      action: defaultAction,
      allowed: defaultAction !== 'deny' as any,
      reason: 'no_matching_rule',
      matchedRuleId: null,
      downgraded: false
    };
  }

  if (matchingRule.effect === 'deny') {
    return {
      action: 'ignore',
      allowed: false,
      reason: 'rule_denied',
      matchedRuleId: matchingRule.id,
      downgraded: true
    };
  }

  if (matchingRule.effect === 'require_approval') {
    return {
      action: 'draft',
      allowed: true,
      reason: 'approval_required',
      matchedRuleId: matchingRule.id,
      downgraded: true
    };
  }

  // Effect is allow
  const targetAction = matchingRule.action ?? 'reply';
  const ceiling = applyModelCeiling(targetAction, decision.requestedAction);

  return {
    action: ceiling.action,
    allowed: true,
    reason: ceiling.downgraded ? 'model_requested_less_autonomy' : 'rule_allowed',
    matchedRuleId: matchingRule.id,
    downgraded: ceiling.downgraded
  };
}
