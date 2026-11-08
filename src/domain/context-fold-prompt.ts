import type { MemoryStore } from './memory-store';
import type { ConversationFold } from './types';

/**
 * Stable hierarchy for a chat: oldest milestones, uncoalesced sessions, recent raw tail.
 * Invalid or stale lineage is never inserted into the moderator's prompt.
 */
export function buildFoldContext(memory: MemoryStore, chatId: string): string {
  try {
    // Bound SQLite reads and per-fold lineage checks independently of conversation age.
    const recentMilestones = memory.getRecentFolds(chatId, 2, 20);
    const recentSessions = memory.getRecentFolds(chatId, 1, 32);
    const valid = (fold: ConversationFold) => {
      if (fold.chatId !== chatId || fold.directMessageIds.length !== fold.messageCount) return false;
      const raw = memory.getFoldMessages(fold.id);
      return raw.length === fold.messageCount &&
        raw.every((message, i) => message.chatId === chatId && message.id === fold.directMessageIds[i]);
    };
    const milestones = recentMilestones.filter(valid).slice(-10);
    const coalescedIds = new Set(milestones.flatMap(fold => fold.sourceFoldIds));
    const sessions = recentSessions.filter(fold => !coalescedIds.has(fold.id) && valid(fold)).slice(-16);
    if (!milestones.length && !sessions.length) return '';
    const order = (a: ConversationFold, b: ConversationFold) =>
      (memory.getMessage(chatId, a.startMessageId)?.timestamp ?? 0) -
      (memory.getMessage(chatId, b.startMessageId)?.timestamp ?? 0);
    const render = (fold: ConversationFold) => `- [${fold.id}; ${fold.startMessageId}..${fold.endMessageId}] ${fold.topic}: ${fold.summary}`;
    return [
      'أرشيف المحادثة السابقة، ملخصات للاستدلال ويمكن التحقق منها عبر الرسائل الأصلية:',
      ...(milestones.length ? ['Milestones:', ...milestones.sort(order).map(render)] : []),
      ...(sessions.length ? ['Sessions:', ...sessions.sort(order).map(render)] : [])
    ].join('\n').slice(0, 20_000);
  } catch {
    return '';
  }
}
