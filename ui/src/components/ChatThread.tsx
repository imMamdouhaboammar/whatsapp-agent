import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Send, Sparkles, CheckCheck, Mic } from 'lucide-react';
import type { AgentMode, ChatMessage, ChatSummary } from '../api/types';

interface ChatThreadProps {
  chat?: ChatSummary;
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onSendReaction: (messageId: string, emoji: string) => Promise<void>;
  onChangeMode: (mode: AgentMode) => Promise<void>;
}

export function ChatThread({
  chat,
  messages,
  onSendMessage,
  onSendReaction,
  onChangeMode
}: ChatThreadProps) {
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;
    setSending(true);
    try {
      await onSendMessage(inputText.trim());
      setInputText('');
    } finally {
      setSending(false);
    }
  };

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0b0f14] text-slate-500 p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#131922] border border-[#263140] flex items-center justify-center text-slate-400 mb-3 shadow-lg">
          <Sparkles className="w-8 h-8 text-emerald-400" />
        </div>
        <h3 className="text-base font-semibold text-slate-200">اختر محادثة لبدء المتابعة</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          يمكنك مراقبة ردود الموديرتور الذكي، التحكم في وضع العمل، أو الرد مباشرة بشكل يدوي.
        </p>
      </div>
    );
  }

  const formatMessageTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0b0f14] h-full overflow-hidden">
      {/* Thread Header */}
      <div className="px-5 py-3 border-b border-[#263140] bg-[#131922] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white font-semibold text-sm shadow-md">
            {chat.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              {chat.name}
              {chat.isGroup && (
                <span className="text-[10px] text-slate-400 bg-[#1c2430] px-1.5 py-0.5 rounded-md">
                  مجموعة
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-400 font-mono" dir="ltr">
              {chat.id}
            </p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 hidden sm:inline">وضع المحادثة:</span>
          <select
            value={chat.agentMode}
            onChange={(e) => onChangeMode(e.target.value as AgentMode)}
            className="px-3 py-1.5 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-200 font-medium focus:outline-hidden focus:border-emerald-500 cursor-pointer"
          >
            <option value="autopilot">⚡ تلقائي (Auto-Pilot)</option>
            <option value="copilot">📝 مسودات (Co-Pilot)</option>
            <option value="human">👤 يدوي (Human Only)</option>
          </select>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            لا توجد رسائل مسجلة في هذه المحادثة حتى الآن.
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.isFromMe;
            return (
              <div
                key={msg.id}
                className={`flex flex-col group ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-xs shadow-md relative ${
                    isMe
                      ? 'bg-emerald-950/80 border border-emerald-500/30 text-emerald-100 rounded-br-xs'
                      : 'bg-[#18202c] border border-[#263140] text-slate-100 rounded-bl-xs'
                  }`}
                >
                  {/* Sender Name if not me */}
                  {!isMe && msg.senderName && (
                    <div className="text-[10px] font-semibold text-emerald-400 mb-1">
                      {msg.senderName}
                    </div>
                  )}

                  {/* Audio transcription badge */}
                  {msg.type === 'audio' && (
                    <div className="mb-2 p-2 bg-[#0b0f14]/80 border border-[#263140] rounded-xl flex items-center gap-2">
                      <Mic className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-bold text-emerald-400 block">رسالة صوتية مفرغة:</span>
                        <span className="text-xs text-slate-200 block italic">
                          {msg.transcription || 'جاري التفريغ الصوتي...'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Message Text */}
                  <p className="whitespace-pre-wrap leading-relaxed text-slate-100">
                    {msg.type === 'audio' ? (msg.transcription || '🎵 رسالة صوتية') : msg.text}
                  </p>

                  {/* Metadata: Time and Status */}
                  <div className="flex items-center justify-end gap-1.5 mt-1 text-[10px] text-slate-400">
                    {isMe && (
                      <span className="flex items-center gap-0.5 text-emerald-400/80">
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>رد موديرتور</span>
                      </span>
                    )}
                    <span>{formatMessageTime(msg.timestamp)}</span>
                    {isMe && <CheckCheck className="w-3 h-3 text-emerald-400" />}
                  </div>

                  {/* Quick Reactions Bar on Hover */}
                  <div className="absolute -top-3 left-2 hidden group-hover:flex items-center gap-1 bg-[#131922] border border-[#263140] rounded-full px-2 py-0.5 shadow-lg z-10">
                    {['👍', '❤️', '🙏', '😂', '🔥'].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => onSendReaction(msg.id, emoji)}
                        className="hover:scale-125 transition-transform text-xs"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <form onSubmit={handleSend} className="p-3 border-t border-[#263140] bg-[#131922] flex items-center gap-2 shrink-0">
        <input
          type="text"
          placeholder="اكتب رسالة للرد المباشر يدوياً..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={sending}
          className="flex-1 px-4 py-2.5 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || sending}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-lg shadow-emerald-900/20"
        >
          <Send className="w-3.5 h-3.5" />
          <span>إرسال</span>
        </button>
      </form>
    </div>
  );
}
