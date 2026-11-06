import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, Check, CheckCheck, Clock3, FileText, MessageCircle, Mic, Reply, Send, X } from 'lucide-react';
import type { AgentMode, ChatMessage, ChatSummary } from '../api/types';
import { useLocale, type Language } from '../locale-context';

interface ChatThreadProps {
  chat?: ChatSummary;
  messages: ChatMessage[];
  onSendMessage: (text: string, replyToMessageId?: string) => Promise<void>;
  onSendReaction: (messageId: string, emoji: string) => Promise<void>;
  onChangeMode: (mode: AgentMode) => Promise<void>;
  onBack: () => void;
  onOpenInspector: () => void;
}

const modeOptions: Array<{ value: AgentMode; label: string }> = [
  { value: 'autopilot', label: 'تلقائي' },
  { value: 'copilot', label: 'بالموافقة' },
  { value: 'human', label: 'يدوي' }
];

function messageTime(timestamp: number, language: Language): string {
  return new Date(timestamp).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

export function ChatThread({ chat, messages, onSendMessage, onSendReaction, onChangeMode, onBack, onOpenInspector }: ChatThreadProps) {
  const { language, tr } = useLocale();
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [messages, chat?.id]);

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!inputText.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await onSendMessage(inputText.trim(), replyingTo?.id);
      setInputText('');
      setReplyingTo(null);
    } catch {
      setError(tr('تعذّر إرسال الرسالة. حاول مرة تانية', 'Could not send the message. Try again'));
    } finally {
      setSending(false);
    }
  };

  const changeMode = async (mode: AgentMode) => {
    if (!chat || chat.agentMode === mode) return;
    try {
      await onChangeMode(mode);
      setError('');
    } catch {
      setError(tr('تعذّر تغيير وضع المحادثة', 'Could not change the chat mode'));
    }
  };

  const scrollToMessage = (messageId: string) => {
    const element = document.getElementById('msg-' + messageId);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedId(messageId);
    window.setTimeout(() => setHighlightedId(null), 1800);
  };

  if (!chat) {
    return (
      <main className="wa-thread wa-thread-empty">
        <div className="wa-welcome-icon"><MessageCircle size={34} /></div>
        <h2>{tr('اختار محادثة علشان تبدأ', 'Select a conversation')}</h2>
        <p>{tr('تابع الرسائل، راجع ردود المساعد، أو رد بنفسك في أي وقت', 'Read messages, review AI drafts, or reply yourself at any time')}</p>
      </main>
    );
  }

  const visibleMessages = messages.filter((message) =>
    (Boolean(message.text?.trim()) && message.text !== '[رسالة]') ||
    ['audio', 'image', 'video', 'document'].includes(message.type)
  );

  return (
    <main className="wa-thread" aria-label={tr('محادثة ', 'Conversation with ') + chat.name}>
      <header className="wa-thread-header">
        <button type="button" className="wa-thread-back wa-icon-button" onClick={onBack} aria-label={tr('العودة للمحادثات', 'Back to chats')}><ArrowRight size={21} /></button>
        <span className="wa-avatar wa-avatar-thread">
          {chat.avatarUrl ? <img src={chat.avatarUrl} alt="" /> : chat.name.slice(0, 1)}
        </span>
        <div className="wa-thread-contact">
          <h2>{chat.name} {chat.isGroup && <span className="wa-group-label">{tr('مجموعة', 'Group')}</span>}</h2>
          <p dir="auto">{chat.phoneNumber || tr('محادثة واتساب', 'WhatsApp conversation')}</p>
        </div>
        <button type="button" className="wa-thread-agent wa-icon-button" onClick={onOpenInspector} aria-label={tr('عرض المساعد الذكي', 'Show AI assistant')} title={tr('عرض المساعد الذكي', 'Show AI assistant')}><Bot size={21} /></button>
      </header>

      <div className="wa-chat-mode-bar">
        <span className="wa-mode-title">{tr('وضع المحادثة', 'Chat mode')}</span>
        <div className="wa-segmented" role="group" aria-label={tr('وضع المحادثة', 'Chat mode')}>
          {modeOptions.map((mode) => (
            <button
              type="button"
              key={mode.value}
              className={chat.agentMode === mode.value ? 'is-active' : ''}
              aria-pressed={chat.agentMode === mode.value}
              onClick={() => void changeMode(mode.value)}
            >{mode.value === 'autopilot' ? tr('تلقائي', 'Auto-Pilot') : mode.value === 'copilot' ? tr('بالموافقة', 'Co-Pilot') : tr('يدوي', 'Human')}</button>
          ))}
        </div>
      </div>

      <div className="wa-message-canvas">
        <div className="wa-message-stream">
          {visibleMessages.length === 0 ? (
            <p className="wa-thread-empty-message">{tr('لسه مفيش رسائل في المحادثة دي', 'No messages in this conversation yet')}</p>
          ) : visibleMessages.map((message) => {
            const quotedFallback = message.replyToId ? messages.find((item) => item.id === message.replyToId) : undefined;
            const quoted = message.quotedMessage || (quotedFallback ? {
              id: quotedFallback.id,
              sender: quotedFallback.sender,
              senderName: quotedFallback.isFromMe ? tr('أنت', 'You') : (quotedFallback.senderName || tr('جهة الاتصال', 'Contact')),
              text: quotedFallback.text || quotedFallback.transcription || '[' + quotedFallback.type + ']'
            } : undefined);
            const isOutbound = message.isFromMe;
            return (
              <article key={message.id} id={'msg-' + message.id} className={'wa-message ' + (isOutbound ? 'is-outbound' : 'is-inbound')}>
                <div className={'wa-bubble ' + (highlightedId === message.id ? 'is-highlighted' : '')}>
                  {quoted && (
                    <button type="button" className="wa-quoted-message" onClick={() => scrollToMessage(quoted.id)} title={tr('الانتقال للرسالة الأصلية', 'Jump to quoted message')}>
                      <strong>{quoted.senderName || tr('رسالة سابقة', 'Earlier message')}</strong>
                      <span>{quoted.text}</span>
                    </button>
                  )}
                  {message.type === 'audio' && (
                    <div className="wa-audio-note">
                      <span className="wa-audio-icon"><Mic size={17} /></span>
                      <div>
                        <strong>{tr('رسالة صوتية', 'Voice message')}</strong>
                        <span dir="auto">{message.transcription || message.text || tr('رسالة صوتية', 'Voice message')}</span>
                      </div>
                    </div>
                  )}
                  {message.type === 'image' && message.mediaUrl && <img className="wa-media-image" src={message.mediaUrl} alt={tr('صورة مرفقة', 'Attached image')} loading="lazy" />}
                  {message.type === 'video' && message.mediaUrl && <video className="wa-media-image" src={message.mediaUrl} controls preload="metadata" />}
                  {message.type === 'document' && <div className="wa-document-note"><FileText size={20} /><span>{tr('مستند مرفق', 'Attached document')}</span></div>}
                  {message.type !== 'audio' && message.text && message.text !== '[رسالة]' && <p className="wa-message-text" dir="auto">{message.text}</p>}
                  <div className="wa-message-meta">
                    <time dir="auto">{messageTime(message.timestamp, language)}</time>
                    {isOutbound && (message.status === 'pending'
                      ? <Clock3 size={13} aria-label={tr('قيد الإرسال', 'Pending')} />
                      : message.status === 'sent'
                        ? <Check size={14} aria-label={tr('أُرسلت إلى واتساب', 'Sent to WhatsApp')} />
                        : message.status === 'delivered'
                          ? <CheckCheck size={15} aria-label={tr('تم التسليم', 'Delivered')} />
                          : message.status === 'read'
                            ? <CheckCheck size={15} className="is-read" aria-label={tr('تمت القراءة', 'Read')} />
                            : null)}
                  </div>
                  {Boolean(message.reactions?.length) && (
                    <div className="wa-message-reactions">
                      {message.reactions?.map((emoji, index) => <span key={emoji + index}>{emoji}</span>)}
                    </div>
                  )}
                </div>
                <div className="wa-message-actions" aria-label={tr('إجراءات الرسالة', 'Message actions')}>
                  {['👍', '❤️', '🙏'].map((emoji) => (
                    <button key={emoji} type="button" onClick={() => void onSendReaction(message.id, emoji).catch(() => setError(tr('تعذّر إرسال التفاعل', 'Could not send reaction')))} aria-label={tr('التفاعل ', 'React ') + emoji}>{emoji}</button>
                  ))}
                  <button type="button" onClick={() => setReplyingTo(message)} aria-label={tr('الرد على الرسالة', 'Reply to message')} title={tr('الرد', 'Reply')}><Reply size={15} /></button>
                </div>
              </article>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <form className="wa-composer" onSubmit={handleSend}>
        {replyingTo && (
          <div className="wa-replying-to">
            <div>
              <strong><Reply size={14} /> {tr('الرد على', 'Reply to')} {replyingTo.isFromMe ? tr('نفسك', 'yourself') : (replyingTo.senderName || chat.name)}</strong>
              <p dir="auto">{replyingTo.text || replyingTo.transcription || tr('رسالة مرفقة', 'Attachment')}</p>
            </div>
            <button type="button" className="wa-icon-button" onClick={() => setReplyingTo(null)} aria-label={tr('إلغاء الرد', 'Cancel reply')}><X size={16} /></button>
          </div>
        )}
        {error && <p className="wa-inline-error" role="alert">{error}</p>}
        <div className="wa-composer-row">
          <input
            type="text"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder={tr('اكتب رسالة...', 'Type a message...')}
            disabled={sending}
            aria-label={tr('نص الرسالة', 'Message text')}
            dir="auto"
          />
          <button type="submit" className="wa-send-button" disabled={sending || !inputText.trim()} aria-label={tr('إرسال الرسالة', 'Send message')} title={tr('إرسال الرسالة', 'Send message')}>
            <Send size={19} />
          </button>
        </div>
      </form>
    </main>
  );
}

