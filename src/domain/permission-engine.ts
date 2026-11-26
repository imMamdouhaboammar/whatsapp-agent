import type { AgentDecision, AgentMode, AutonomyAction, PolicyConfig } from './types';

const AUTHORITY_RANK: Record<string, number> = {
  ignore: 0,
  human: 1,
  draft: 2,
  reply: 3,
  act: 4
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

export interface McpToolPermissionInput {
  agentMode: AgentMode;
  risk: 'readOnly' | 'mutating';
  requiresHumanApproval?: boolean;
}

export interface McpToolPermissionResult {
  decision: 'execute' | 'require_approval' | 'deny';
  reason: string;
}

/**
 * Evaluates whether an external MCP tool may execute automatically, must pause
 * for Copilot/human approval, or is blocked in human-only mode.
 */
export function evaluateMcpToolPermission(input: McpToolPermissionInput): McpToolPermissionResult {
  if (input.agentMode === 'human') {
    return { decision: 'deny', reason: 'human_mode_active' };
  }

  if (input.risk === 'readOnly') {
    return { decision: 'execute', reason: 'readonly_tool_allowed' };
  }

  // Mutating or unknown tools require human approval in copilot mode or when explicitly flagged.
  if (input.agentMode === 'copilot') {
    return { decision: 'require_approval', reason: 'copilot_mutating_approval_required' };
  }

  if (input.requiresHumanApproval) {
    return { decision: 'require_approval', reason: 'tool_requires_human_approval' };
  }

  return { decision: 'execute', reason: 'autopilot_mutating_allowed' };
}
