import type { MemoryStore } from './memory-store';
import type { ConversationFold } from './types';

/**
 * Stable 3-tier LSM hierarchy for a chat:
 * - Archival Milestones (Tier 3)
 * - Milestone Summaries (Tier 2)
 * - Session Summaries (Tier 1)
 *
 * Superseded folds are excluded. Invalid or stale lineage is never inserted into the moderator's prompt.
 * Optionally resolves and decompresses a local window (±2 turns) if an incoming message quotes an archived message.
 */
function renderFold(fold: ConversationFold): string {
  return `- [${fold.id}; ${fold.startMessageId}..${fold.endMessageId}] ${fold.topic}: ${fold.summary}`;
}

export function buildFoldContext(memory: MemoryStore, chatId: string, quotedMessageId?: string): string {
  try {
    // Bound SQLite reads and per-fold lineage checks independently of conversation age.
    const recentArchivals = memory.getRecentFolds(chatId, 3, 10);
    const recentMilestones = memory.getRecentFolds(chatId, 2, 20);
    const recentSessions = memory.getRecentFolds(chatId, 1, 32);

    const valid = (fold: ConversationFold) => {
      if (fold.chatId !== chatId || fold.directMessageIds.length !== fold.messageCount) return false;
      const raw = memory.getFoldMessages(fold.id);
      return raw.length === fold.messageCount &&
        raw.every((message, i) => message.chatId === chatId && message.id === fold.directMessageIds[i]);
    };

    const archivals = recentArchivals.filter(valid).slice(-5);
    const coalescedMilestoneIds = new Set(archivals.flatMap(fold => fold.sourceFoldIds));
    const milestones = recentMilestones.filter(fold => !coalescedMilestoneIds.has(fold.id) && valid(fold)).slice(-10);
    const coalescedSessionIds = new Set([
      ...milestones.flatMap(fold => fold.sourceFoldIds),
      ...archivals.flatMap(fold => fold.sourceFoldIds)
    ]);
    const sessions = recentSessions.filter(fold => !coalescedSessionIds.has(fold.id) && valid(fold)).slice(-16);

    if (!archivals.length && !milestones.length && !sessions.length) return '';

    const order = (a: ConversationFold, b: ConversationFold) =>
      (memory.getMessage(chatId, a.startMessageId)?.timestamp ?? 0) -
      (memory.getMessage(chatId, b.startMessageId)?.timestamp ?? 0);

    const sections: string[] = [
      'أرشيف المحادثة السابقة، ملخصات للاستدلال ويمكن التحقق منها عبر الرسائل الأصلية:',
      ...(archivals.length ? ['Archival History:', ...archivals.toSorted(order).map(renderFold)] : []),
      ...(milestones.length ? ['Milestones:', ...milestones.toSorted(order).map(renderFold)] : []),
      ...(sessions.length ? ['Sessions:', ...sessions.toSorted(order).map(renderFold)] : [])
    ];

    // Decompress-on-demand: if a quoted message ID is provided and lies within any fold,
    // inject its local context window (±2 messages)
    if (quotedMessageId) {
      const allActiveFolds = [...archivals, ...milestones, ...sessions];
      const isFolded = allActiveFolds.some(f => f.directMessageIds.includes(quotedMessageId));
      if (isFolded) {
        const window = memory.getMessageWindow(chatId, quotedMessageId, 2);
        if (window.length > 0) {
          const renderedWindow = window.map(m => {
            const sender = m.isFromMe ? 'أنا' : (m.senderName || 'الطرف الآخر');
            return `  * ${sender}: ${m.text || m.transcription || `[${m.type}]`}`;
          }).join('\n');
          sections.push('\n[السياق التفصيلي للرسالة المقتبسة من الأرشيف]:\n' + renderedWindow);
        }
      }
    }

    return sections.join('\n').slice(0, 20_000);
  } catch {
    return '';
  }
}
