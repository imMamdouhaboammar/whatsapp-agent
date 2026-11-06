import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Send, Sparkles, CheckCheck, Mic, Reply, X } from 'lucide-react';
import type { AgentMode, ChatMessage, ChatSummary } from '../api/types';

interface ChatThreadProps {
  chat?: ChatSummary;
  messages: ChatMessage[];
  onSendMessage: (text: string, replyToMessageId?: string) => Promise<void>;
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
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;
    setSending(true);
    try {
      await onSendMessage(inputText.trim(), replyingToMessage?.id);
      setInputText('');
      setReplyingToMessage(null);
    } finally {
      setSending(false);
    }
  };

  const scrollToMessage = (messageId?: string) => {
    if (!messageId) return;
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMessageId(messageId);
      setTimeout(() => setHighlightedMessageId(null), 2500);
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
              {chat.phoneNumber || chat.id}
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
          messages
            .filter((m) => m.text !== '[رسالة]' && (m.text?.trim() || m.type === 'audio'))
            .map((msg) => {
            const isMe = msg.isFromMe;
            const isHighlighted = highlightedMessageId === msg.id;

            // Resolve quoted message from either direct property or replyToId
            const quotedFallback = msg.replyToId ? messages.find((m) => m.id === msg.replyToId) : undefined;
            const quotedInfo = msg.quotedMessage || (quotedFallback ? {
              id: quotedFallback.id,
              sender: quotedFallback.sender,
              senderName: quotedFallback.isFromMe ? 'أنت' : (quotedFallback.senderName || 'المتصل'),
              text: quotedFallback.text || (quotedFallback.transcription ? `🎵 ${quotedFallback.transcription}` : `[${quotedFallback.type}]`),
              type: quotedFallback.type
            } : undefined);

            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`flex flex-col group transition-all duration-300 ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-xs shadow-md relative transition-all duration-300 ${
                    isHighlighted ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#0b0f14]' : ''
                  } ${
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

                  {/* Quoted / Swiped Message Preview (WhatsApp Native Card) */}
                  {quotedInfo && (
                    <div
                      onClick={() => scrollToMessage(quotedInfo.id)}
                      title="اضغط للذهاب إلى الرسالة المقتبسة"
                      className={`mb-2 p-2 rounded-xl text-[11px] border-r-4 transition-all duration-200 cursor-pointer select-none ${
                        isMe
                          ? 'bg-emerald-900/50 border-emerald-400 hover:bg-emerald-900/70 text-emerald-100'
                          : 'bg-[#0f141c]/90 border-emerald-500 hover:bg-[#151c27] text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-[10px] text-emerald-400 mb-0.5">
                        <Reply className="w-3 h-3 rotate-180 shrink-0" />
                        <span>{quotedInfo.senderName || 'رد على رسالة'}</span>
                      </div>
                      <p className="text-slate-300 line-clamp-2 text-xs leading-relaxed italic">
                        {quotedInfo.text}
                      </p>
                    </div>
                  )}

                  {/* Audio Voice Note Player & Transcription */}
                  {msg.type === 'audio' && (
                    <div className="mb-2 p-2.5 bg-[#0b0f14]/90 border border-emerald-500/30 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                          <Mic className="w-3.5 h-3.5 text-emerald-400" />
                          {isMe ? 'فويس نوت صادر (Gemini 3.8 Flash TTS)' : 'فويس نوت وارد (تفريغ Gemini 3.5 Transcribe)'}
                        </span>
                        <span className="text-[9px] text-emerald-400/80 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          PTT High Fidelity
                        </span>
                      </div>

                      {/* WhatsApp Audio Waveform Bar */}
                      <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-[#141b24] text-emerald-400 border border-[#1e2735]">
                        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                          <Mic className="w-3 h-3 text-emerald-400" />
                        </div>
                        <div className="flex-1 flex items-center gap-0.5 h-5 px-1">
                          {[4, 8, 12, 6, 10, 16, 14, 9, 5, 11, 18, 13, 7, 10, 6, 12, 8, 5, 11, 15, 9].map((h, i) => (
                            <div
                              key={i}
                              style={{ height: `${h}px` }}
                              className="flex-1 bg-emerald-400/70 rounded-full"
                            />
                          ))}
                        </div>
                      </div>

                      <p className="text-xs text-slate-200 leading-relaxed italic pr-1">
                        "{msg.text?.replace(/^🎵 \[رسالة صوتية صادرة:\s*/, '').replace(/\]$/, '') || msg.transcription || 'رسالة صوتية'}"
                      </p>
                    </div>
                  )}

                  {/* Message Text for regular text messages */}
                  {msg.type !== 'audio' && (
                    <p className="whitespace-pre-wrap leading-relaxed text-slate-100">
                      {msg.text}
                    </p>
                  )}

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

                  {/* Reactions Badge */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 -mb-0.5">
                      {msg.reactions.map((emoji, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center text-xs bg-[#0b0f14]/80 border border-[#263140] rounded-full px-2 py-0.5 shadow-xs"
                        >
                          {emoji}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Quick Action Bar on Hover (Reactions + WhatsApp-style Reply button) */}
                  <div className="absolute -top-3.5 left-2 hidden group-hover:flex items-center gap-1.5 bg-[#131922] border border-[#263140] rounded-full px-2 py-0.5 shadow-xl z-10">
                    {['👍', '❤️', '🙏', '😂', '🔥'].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => onSendReaction(msg.id, emoji)}
                        className="hover:scale-125 transition-transform text-xs"
                      >
                        {emoji}
                      </button>
                    ))}
                    <div className="w-px h-3 bg-[#263140] mx-0.5" />
                    <button
                      type="button"
                      onClick={() => setReplyingToMessage(msg)}
                      className="flex items-center gap-1 hover:text-emerald-400 text-slate-300 text-[10px] font-medium px-1.5 py-0.5 hover:bg-slate-800 rounded-md transition-colors"
                      title="رد على هذه الرسالة بالسحب"
                    >
                      <Reply className="w-3 h-3 rotate-180" />
                      <span>رد</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form with Active Reply Bar */}
      <form onSubmit={handleSend} className="p-3 border-t border-[#263140] bg-[#131922] flex flex-col gap-2 shrink-0">
        {/* WhatsApp-style Active Swiped Reply Bar */}
        {replyingToMessage && (
          <div className="px-3.5 py-2 bg-[#0b0f14] border border-[#263140] rounded-xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-1 h-8 bg-emerald-500 rounded-full shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                  <Reply className="w-3 h-3 rotate-180" />
                  <span>الرد على: {replyingToMessage.isFromMe ? 'أنت' : (replyingToMessage.senderName || 'المتصل')}</span>
                </div>
                <p className="text-[11px] text-slate-300 truncate italic">
                  {replyingToMessage.text || (replyingToMessage.transcription ? `🎵 ${replyingToMessage.transcription}` : `[${replyingToMessage.type}]`)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingToMessage(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1a2332] transition-colors"
              title="إلغاء الرد"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={replyingToMessage ? `اكتب رداً على ${replyingToMessage.isFromMe ? 'أنت' : (replyingToMessage.senderName || 'المتصل')}...` : 'اكتب رسالة للرد المباشر يدوياً...'}
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
        </div>
      </form>
    </div>
  );
}
