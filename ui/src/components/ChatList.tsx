import { useState } from 'react';
import { Search, Bot, User, FileText } from 'lucide-react';
import type { ChatSummary } from '../api/types';

interface ChatListProps {
  chats: ChatSummary[];
  selectedChatId?: string;
  onSelectChat: (chatId: string) => void;
}

export function ChatList({ chats, selectedChatId, onSelectChat }: ChatListProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'autopilot' | 'copilot'>('all');

  const filtered = chats.filter((chat) => {
    const matchSearch =
      chat.name.toLowerCase().includes(search.toLowerCase()) ||
      chat.id.toLowerCase().includes(search.toLowerCase()) ||
      (chat.lastMessage && chat.lastMessage.toLowerCase().includes(search.toLowerCase()));

    if (!matchSearch) return false;
    if (filter === 'unread') return chat.unreadCount > 0;
    if (filter === 'autopilot') return chat.agentMode === 'autopilot';
    if (filter === 'copilot') return chat.agentMode === 'copilot';
    return true;
  });

  const formatTime = (ts?: number) => {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getModeBadge = (mode: string) => {
    switch (mode) {
      case 'autopilot':
        return (
          <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20">
            <Bot className="w-2.5 h-2.5" />
            تلقائي
          </span>
        );
      case 'copilot':
        return (
          <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-md border border-amber-500/20">
            <FileText className="w-2.5 h-2.5" />
            مسودات
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-500/10 px-1.5 py-0.5 rounded-md border border-slate-500/20">
            <User className="w-2.5 h-2.5" />
            يدوي
          </span>
        );
    }
  };

  return (
    <div className="w-80 md:w-96 border-r border-[#263140] bg-[#131922] flex flex-col h-full shrink-0">
      {/* Search Header */}
      <div className="p-3 border-b border-[#263140] space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text"
            placeholder="بحث في المحادثات..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-3 pr-9 py-2 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-emerald-500"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors shrink-0 ${
              filter === 'all'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 bg-[#0b0f14]'
            }`}
          >
            الكل ({chats.length})
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors shrink-0 ${
              filter === 'unread'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 bg-[#0b0f14]'
            }`}
          >
            غير مقروء
          </button>
          <button
            onClick={() => setFilter('autopilot')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors shrink-0 ${
              filter === 'autopilot'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 bg-[#0b0f14]'
            }`}
          >
            تلقائي
          </button>
          <button
            onClick={() => setFilter('copilot')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors shrink-0 ${
              filter === 'copilot'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 bg-[#0b0f14]'
            }`}
          >
            مسودة
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1c2430]/60">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            لا توجد محادثات مطابقة
          </div>
        ) : (
          filtered.map((chat) => {
            const isSelected = chat.id === selectedChatId;
            return (
              <div
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={`flex items-start gap-3 p-3.5 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#1c2430] border-r-2 border-emerald-400'
                    : 'hover:bg-[#18202b]'
                }`}
              >
                {/* Avatar */}
                <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-emerald-700 to-teal-500 flex items-center justify-center text-white font-semibold text-sm shrink-0 shadow-md">
                  {chat.name.slice(0, 1).toUpperCase()}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {chat.name}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {formatTime(chat.lastTimestamp)}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 truncate mb-1.5">
                    {chat.lastMessage || 'لا توجد رسائل بعد'}
                  </p>

                  <div className="flex items-center justify-between">
                    <div>{getModeBadge(chat.agentMode)}</div>
                    {chat.unreadCount > 0 && (
                      <span className="min-w-4.5 h-4.5 px-1 rounded-full bg-emerald-500 text-slate-950 font-bold text-[10px] flex items-center justify-center">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
