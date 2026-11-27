import { isRecord } from './sqlite-values';
import type { ModeratorPersona, PolicyConfig, PolicyRule, AutonomyAction } from './types';

const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const numeric = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const action = (value: unknown): value is AutonomyAction => value === 'reply' || value === 'draft' || value === 'ignore' || value === 'human' || value === 'act';
const rule = (value: unknown): value is PolicyRule => isRecord(value) && bounded(value.id, 120) && bounded(value.intent, 120) &&
  (value.effect === 'allow' || value.effect === 'require_approval' || value.effect === 'deny') &&
  (value.action === undefined || action(value.action)) && (value.minConfidence === undefined || numeric(value.minConfidence,0,1));

export function isPersonaPatch(value: unknown): value is Partial<ModeratorPersona> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key,v]) => {
    switch (key) {
      case 'name': case 'language': return bounded(v,120);
      case 'tone': return bounded(v,2000);
      case 'systemPrompt': return bounded(v,30000);
      case 'rules': return Array.isArray(v) && v.length <= 100 && v.every((item: unknown) => bounded(item,2000));
      case 'model': case 'voiceName': return bounded(v,160);
      case 'temperature': return numeric(v,0,2);
      case 'minConfidence': return numeric(v,0,1);
      case 'simulateTypingDelay': return typeof v === 'boolean';
      case 'minTypingDelayMs': case 'maxTypingDelayMs': return numeric(v,0,60000) && Number.isInteger(v);
      default: return false;
    }
  });
}

export function isPolicyPatch(value: unknown): value is Partial<PolicyConfig> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key,v]) => {
    switch (key) {
      case 'version': return numeric(v,1,Number.MAX_SAFE_INTEGER) && Number.isInteger(v);
      case 'defaultAction': return action(v);
      case 'minConfidence': return numeric(v,0,1);
      case 'rules': return Array.isArray(v) && v.length <= 100 && v.every(rule);
      default: return false;
    }
  });
}

export function decodeAssistantSettings(value: unknown): {persona?: Partial<ModeratorPersona>;policy?: Partial<PolicyConfig>} | null {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'persona' && key !== 'policy')) return null;
  if (value.persona === undefined && value.policy === undefined) return null;
  if (value.persona !== undefined && !isPersonaPatch(value.persona)) return null;
  if (value.policy !== undefined && !isPolicyPatch(value.policy)) return null;
  return {persona:value.persona,policy:value.policy};
}
