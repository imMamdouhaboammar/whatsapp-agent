import { useState } from 'react';
import { MessageCircle, Search } from 'lucide-react';
import type { ChatSummary } from '../api/types';
import { useLocale, type Language } from '../locale-context';

interface ChatListProps {
  chats: ChatSummary[];
  selectedChatId?: string;
  pendingDraftChatIds: string[];
  onSelectChat: (chatId: string) => void;
}

type ChatFilter = 'all' | 'unread' | 'review';

function displayTime(timestamp: number | undefined, language: Language): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' });
}

export function ChatList({ chats, selectedChatId, pendingDraftChatIds, onSelectChat }: ChatListProps) {
  const { language, tr } = useLocale();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const query = search.trim().toLocaleLowerCase();

  const filtered = chats.filter((chat) => {
    const matchesQuery = !query || [chat.name, chat.id, chat.lastMessage ?? '']
      .some((value) => value.toLocaleLowerCase().includes(query));
    if (!matchesQuery) return false;
    if (filter === 'unread') return chat.unreadCount > 0;
    if (filter === 'review') return pendingDraftChatIds.includes(chat.id);
    return true;
  });

  return (
    <section className="wa-inbox" aria-label={tr('قائمة الدردشات', 'Chat list')}>
      <div className="wa-inbox-header">
        <div className="wa-section-heading">
          <h1>{tr('الدردشات', 'Chats')}</h1>
          <span className="wa-inbox-total" aria-label={tr('عدد المحادثات', 'Number of chats')}>{chats.length}</span>
        </div>
        <label className="wa-search">
          <Search size={19} aria-hidden="true" />
          <span className="sr-only">{tr('ابحث عن محادثة', 'Search chats')}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr('ابحث عن محادثة', 'Search chats')}
          />
        </label>
        <div className="wa-filters" role="group" aria-label={tr('تصفية المحادثات', 'Chat filters')}>
          {([
            ['all', tr('الكل', 'All')],
            ['unread', tr('غير المقروءة', 'Unread')],
            ['review', tr('تحتاج مراجعة', 'Needs review')]
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={'wa-filter ' + (filter === key ? 'is-active' : '')}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
              {key === 'review' && pendingDraftChatIds.length > 0 && (
                <span className="wa-filter-count">{new Set(pendingDraftChatIds).size}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="wa-chat-list">
        {filtered.length === 0 ? (
          <div className="wa-inbox-empty">
            <MessageCircle size={30} strokeWidth={1.5} />
            <strong>{search ? tr('مفيش نتائج للبحث', 'No matching chats') : filter === 'review' ? tr('كل الردود اتراجعت', 'All caught up') : tr('لسه مفيش محادثات', 'No chats yet')}</strong>
            <p>{search ? tr('جرّب اسم أو كلمة تانية', 'Try a different name or keyword') : filter === 'review' ? tr('أي رد محتاج موافقتك هيظهر هنا', 'Drafts that need your approval appear here') : tr('اربط واتساب علشان تظهر محادثاتك هنا', 'Link WhatsApp to see your conversations')}</p>
          </div>
        ) : filtered.map((chat) => {
          const selected = chat.id === selectedChatId;
          const hasDraft = pendingDraftChatIds.includes(chat.id);
          return (
            <button
              type="button"
              key={chat.id}
              className={'wa-chat-item ' + (selected ? 'is-selected' : '')}
              onClick={() => onSelectChat(chat.id)}
              aria-current={selected ? 'true' : undefined}
            >
              <span className="wa-avatar wa-avatar-chat">
                {chat.avatarUrl ? <img src={chat.avatarUrl} alt="" loading="lazy" /> : chat.name.slice(0, 1)}
              </span>
              <span className="wa-chat-content">
                <span className="wa-chat-primary">
                  <strong title={chat.name}>{chat.name}</strong>
                  <time dir="auto">{displayTime(chat.lastTimestamp, language)}</time>
                </span>
                <span className="wa-chat-preview" dir="auto">{chat.lastMessage || tr('لا توجد رسائل بعد', 'No messages yet')}</span>
                <span className="wa-chat-bottom">
                  <span className={'wa-mode-chip wa-mode-' + chat.agentMode}>{chat.agentMode === 'autopilot' ? tr('تلقائي', 'Auto-Pilot') : chat.agentMode === 'copilot' ? tr('بالموافقة', 'Co-Pilot') : tr('يدوي', 'Human')}</span>
                  {hasDraft && <span className="wa-needs-review">{tr('بانتظار موافقة', 'Awaiting approval')}</span>}
                  {chat.unreadCount > 0 && <span className="wa-count">{chat.unreadCount}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

