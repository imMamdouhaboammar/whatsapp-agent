import { describe, expect, test } from 'bun:test';
import {
  getModelContextProfile,
  estimateTokens,
  estimateMessageTokens,
  estimateFoldsTokens,
  computeDynamicRecentCount,
  evaluateContextBudgetStatus
} from '../src/domain/dynamic-context-window';
import type { ChatMessage, ConversationFold } from '../src/domain/types';

describe('Dynamic Context Window & ACP Token Budgeting', () => {
  test('resolves model context profiles correctly with appropriate targets and thresholds', () => {
    const hydrogen = getModelContextProfile('gemini-4-hydrogen');
    expect(hydrogen.name).toBe('gemini-4-hydrogen');
    expect(hydrogen.targetContextBudget).toBe(16_000);
    expect(hydrogen.softPruneThresholdRatio).toBe(0.45);

    const argon = getModelContextProfile('gemini-4-argon');
    expect(argon.name).toBe('gemini-4-argon');
    expect(argon.targetContextBudget).toBe(32_000);

    const carbon = getModelContextProfile('gemini-4-carbon');
    expect(carbon.name).toBe('gemini-4-carbon');
    expect(carbon.targetContextBudget).toBe(64_000);

    const fallback = getModelContextProfile('unknown-model');
    expect(fallback.targetContextBudget).toBe(32_000);
  });

  test('accurately estimates multi-lingual token counts for Arabic and English', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);

    // English string
    const english = 'Hello world, how are you doing today?';
    const enTokens = estimateTokens(english);
    expect(enTokens).toBeGreaterThan(5);
    expect(enTokens).toBeLessThan(15);

    // Arabic string
    const arabic = 'السلام عليكم ورحمة الله وبركاته، محتاج أعرف تفاصيل الأسعار والخصومات المتاحة حالياً';
    const arTokens = estimateTokens(arabic);
    expect(arTokens).toBeGreaterThan(15);
    expect(arTokens).toBeLessThan(45);
  });

  test('computes message and fold token estimates including overhead and facts', () => {
    const msg: ChatMessage = {
      id: 'm1',
      chatId: 'test@s.whatsapp.net',
      sender: 'user',
      text: 'عايز أعرف سعر باقة البرو كام؟',
      timestamp: Date.now(),
      isFromMe: false,
      type: 'text'
    };
    const msgTokens = estimateMessageTokens(msg);
    expect(msgTokens).toBeGreaterThan(10);

    const fold: ConversationFold = {
      id: 'f1',
      chatId: 'test@s.whatsapp.net',
      tier: 1,
      topic: 'استفسار عن الباقات',
      summary: 'العميل سأل عن سعر باقة البرو والخيارات المتاحة للدفع',
      startMessageId: 'm1',
      endMessageId: 'm2',
      directMessageIds: ['m1', 'm2'],
      sourceFoldIds: [],
      messageCount: 2,
      factsExtracted: ['باقة البرو'],
      createdAt: Date.now()
    };
    const foldTokens = estimateFoldsTokens([fold]);
    expect(foldTokens).toBeGreaterThan(15);
  });

  test('computes dynamic recent count based on fold count and model profile', () => {
    const profile = getModelContextProfile('gemini-4-argon');
    // When no folds exist yet, expands up to maxRecentMessages
    const countNoFolds = computeDynamicRecentCount(profile, 25, 0);
    expect(countNoFolds).toBe(25);

    // When folds exist, locks to clean minRecentMessages
    const countWithFolds = computeDynamicRecentCount(profile, 25, 3);
    expect(countWithFolds).toBe(profile.minRecentMessages);
  });

  test('evaluates ACP context budget status, token savings, and transitions nudge decisions', () => {
    const recentMessages: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `m-${i}`,
      chatId: 'user@s.whatsapp.net',
      sender: 'user',
      text: `رسالة رقم ${i} بخصوص الاتفاق`,
      timestamp: Date.now() + i * 1000,
      isFromMe: i % 2 === 0,
      type: 'text'
    }));

    const folds: ConversationFold[] = [
      {
        id: 'fold-t1',
        chatId: 'user@s.whatsapp.net',
        tier: 1,
        topic: 'مناقشة الأسعار',
        summary: 'تم الاتفاق على السعر الأساسي',
        startMessageId: 'm-old-1',
        endMessageId: 'm-old-20',
        directMessageIds: Array.from({ length: 20 }, (_, i) => `m-old-${i}`),
        sourceFoldIds: [],
        messageCount: 20,
        factsExtracted: ['سعر أساسي'],
        createdAt: Date.now() - 100_000
      }
    ];

    // Idle nudge
    const statusIdle = evaluateContextBudgetStatus({
      chatId: 'user@s.whatsapp.net',
      modelName: 'gemini-4-argon',
      recentMessages,
      folds,
      uncompressedCount: 5
    });

    expect(statusIdle.chatId).toBe('user@s.whatsapp.net');
    expect(statusIdle.model).toBe('gemini-4-argon');
    expect(statusIdle.tokensSaved).toBeGreaterThan(0);
    expect(statusIdle.compressionRatio).toBeGreaterThan(0);
    expect(statusIdle.tier1Count).toBe(1);
    expect(statusIdle.nudgeDecision).toBe('idle');

    // Soft nudge when uncompressed messages exceed 15
    const statusSoft = evaluateContextBudgetStatus({
      chatId: 'user@s.whatsapp.net',
      modelName: 'gemini-4-argon',
      recentMessages,
      folds,
      uncompressedCount: 18
    });
    expect(statusSoft.nudgeDecision).toBe('soft');

    // Strong nudge when uncompressed messages reach 25
    const statusStrong = evaluateContextBudgetStatus({
      chatId: 'user@s.whatsapp.net',
      modelName: 'gemini-4-argon',
      recentMessages,
      folds,
      uncompressedCount: 28
    });
    expect(statusStrong.nudgeDecision).toBe('strong');
  });
});
