import type { ChatMessage, ContextBudgetStatus, ConversationFold } from './types';

export interface ModelContextProfile {
  name: string;
  limitTokens: number;
  targetContextBudget: number;
  softPruneThresholdRatio: number; // e.g. 0.45 (45% of target budget)
  strongPruneThresholdRatio: number; // e.g. 0.75 (75% of target budget)
  minRecentMessages: number;
  maxRecentMessages: number;
}

const DEFAULT_PROFILES: Record<string, ModelContextProfile> = {
  'gemini-4-hydrogen': {
    name: 'gemini-4-hydrogen',
    limitTokens: 1_048_576,
    targetContextBudget: 16_000,
    softPruneThresholdRatio: 0.45,
    strongPruneThresholdRatio: 0.75,
    minRecentMessages: 10,
    maxRecentMessages: 20
  },
  'gemini-4-argon': {
    name: 'gemini-4-argon',
    limitTokens: 1_048_576,
    targetContextBudget: 32_000,
    softPruneThresholdRatio: 0.45,
    strongPruneThresholdRatio: 0.75,
    minRecentMessages: 10,
    maxRecentMessages: 30
  },
  'gemini-4-carbon': {
    name: 'gemini-4-carbon',
    limitTokens: 1_048_576,
    targetContextBudget: 64_000,
    softPruneThresholdRatio: 0.50,
    strongPruneThresholdRatio: 0.80,
    minRecentMessages: 15,
    maxRecentMessages: 50
  },
  'gemini-3.8-flash': {
    name: 'gemini-3.8-flash',
    limitTokens: 1_048_576,
    targetContextBudget: 32_000,
    softPruneThresholdRatio: 0.45,
    strongPruneThresholdRatio: 0.75,
    minRecentMessages: 10,
    maxRecentMessages: 30
  },
  'gemini-1.5-pro': {
    name: 'gemini-1.5-pro',
    limitTokens: 2_097_152,
    targetContextBudget: 64_000,
    softPruneThresholdRatio: 0.50,
    strongPruneThresholdRatio: 0.80,
    minRecentMessages: 15,
    maxRecentMessages: 50
  }
};

const FALLBACK_PROFILE: ModelContextProfile = {
  name: 'default',
  limitTokens: 1_048_576,
  targetContextBudget: 32_000,
  softPruneThresholdRatio: 0.45,
  strongPruneThresholdRatio: 0.75,
  minRecentMessages: 10,
  maxRecentMessages: 30
};

export function getModelContextProfile(modelName?: string): ModelContextProfile {
  if (!modelName) return FALLBACK_PROFILE;
  const normalized = modelName.trim().toLowerCase();
  for (const [key, profile] of Object.entries(DEFAULT_PROFILES)) {
    if (normalized.includes(key)) return profile;
  }
  return FALLBACK_PROFILE;
}

/**
 * Fast, robust multi-lingual token estimation (Arabic morphology ~2.5 chars/token; English ~4 chars/token).
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const str = text.trim();
  if (!str) return 0;

  // Count Arabic characters vs Latin characters
  let arabicCount = 0;
  let latinCount = 0;
  for (let i = 0; i < Math.min(str.length, 500); i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x0600 && code <= 0x06ff) {
      arabicCount++;
    } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      latinCount++;
    }
  }

  const isArabicDominant = arabicCount >= latinCount;
  const divisor = isArabicDominant ? 2.8 : 4.0;
  return Math.max(1, Math.ceil(str.length / divisor));
}

export function estimateMessageTokens(message: ChatMessage): number {
  const content = message.text || message.transcription || '';
  const senderOverhead = 6;
  const quotedOverhead = message.quotedMessage ? estimateTokens(message.quotedMessage.text) + 8 : 0;
  return estimateTokens(content) + senderOverhead + quotedOverhead;
}

export function estimateFoldsTokens(folds: ConversationFold[]): number {
  let total = 0;
  for (const fold of folds) {
    total += estimateTokens(fold.topic) + estimateTokens(fold.summary) + 12;
    for (const fact of fold.factsExtracted) {
      total += estimateTokens(fact) + 3;
    }
  }
  return total;
}

/**
 * Dynamically computes how many recent messages to keep uncompressed in the prompt
 * based on current model capacity and context headroom.
 */
export function computeDynamicRecentCount(
  profile: ModelContextProfile,
  uncompressedCount: number,
  foldsCount: number
): number {
  // If no folds exist yet, allow keeping up to maxRecentMessages
  if (foldsCount === 0) {
    return Math.min(Math.max(profile.minRecentMessages, uncompressedCount), profile.maxRecentMessages);
  }
  // If folds exist, preserve a crisp recent zone
  return profile.minRecentMessages;
}

export interface EvaluateBudgetParams {
  chatId: string;
  modelName?: string;
  recentMessages: ChatMessage[];
  folds: ConversationFold[];
  uncompressedCount: number;
  staticPrefixTokens?: number;
  dossierTokens?: number;
  notebookTokens?: number;
}

/**
 * Calculates real-time Active Context Pruning (ACP) metrics and token savings.
 */
export function evaluateContextBudgetStatus(params: EvaluateBudgetParams): ContextBudgetStatus {
  const profile = getModelContextProfile(params.modelName);
  const staticTokens = params.staticPrefixTokens ?? 600;
  const dossierTokens = params.dossierTokens ?? 0;
  const notebookTokens = params.notebookTokens ?? 0;

  let recentTokens = 0;
  for (const msg of params.recentMessages) {
    recentTokens += estimateMessageTokens(msg);
  }

  const foldsTokens = estimateFoldsTokens(params.folds);
  const currentTokens = staticTokens + dossierTokens + notebookTokens + foldsTokens + recentTokens;

  let tier1Count = 0;
  let tier2Count = 0;
  let tier3Count = 0;
  let rawCompressedCount = 0;

  for (const fold of params.folds) {
    if (fold.tier === 1) tier1Count++;
    else if (fold.tier === 2) tier2Count++;
    else if (fold.tier === 3) tier3Count++;
    rawCompressedCount += fold.messageCount;
  }

  // Estimated tokens if raw messages were sent uncompressed (~35 tokens per chat message on average)
  const estimatedRawTokens = rawCompressedCount * 35;
  const tokensSaved = Math.max(0, estimatedRawTokens - foldsTokens);
  const totalVirtualTokens = tokensSaved + currentTokens;
  const compressionRatio = totalVirtualTokens > 0
    ? Number((tokensSaved / totalVirtualTokens).toFixed(2))
    : 0;

  const usageRatio = currentTokens / profile.targetContextBudget;
  let nudgeDecision: 'idle' | 'soft' | 'strong' = 'idle';

  if (usageRatio >= profile.strongPruneThresholdRatio || params.uncompressedCount >= 25) {
    nudgeDecision = 'strong';
  } else if (usageRatio >= profile.softPruneThresholdRatio || params.uncompressedCount >= 15) {
    nudgeDecision = 'soft';
  }

  return {
    chatId: params.chatId,
    model: profile.name,
    modelLimitTokens: profile.limitTokens,
    targetContextBudget: profile.targetContextBudget,
    currentTokens,
    tokensSaved,
    compressionRatio,
    activeFoldsCount: params.folds.length,
    tier1Count,
    tier2Count,
    tier3Count,
    rawMessageCount: rawCompressedCount + params.recentMessages.length,
    uncompressedMessageCount: params.uncompressedCount,
    preservedRecentCount: params.recentMessages.length,
    nudgeDecision
  };
}
