import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCheck, Clock3, FileText, Layers, MessageCircle, Mic, Reply, Send, Trash2, X } from 'lucide-react';
import { Gemini } from '@lobehub/icons';
import { Avatar } from '@lobehub/ui';
import type { AgentMode, ChatMessage, ChatSummary, ContextBudgetStatus } from '../api/types';
import { api } from '../api/client';
import { useLocale, type Language } from '../locale-context';
import { ContextCompressionModal } from './ContextCompressionModal';
import { useModalDismiss } from '../hooks/useModalDismiss';

interface ChatThreadProps {
  chat?: ChatSummary;
  messages: ChatMessage[];
  onSendMessage: (text: string, replyToMessageId?: string, clientMutationId?: string) => Promise<void>;
  onRetrySendIntent: (intentId: string, clientMutationId: string) => Promise<void>;
  onSendReaction: (messageId: string, emoji: string) => Promise<void>;
  /** WA-024: false when the active transport cannot send reactions. */
  reactionsEnabled?: boolean;
  onChangeMode: (mode: AgentMode) => Promise<void>;
  onBack: () => void;
  onOpenInspector: () => void;
  onDeleteChat?: (chatId: string) => Promise<void>;
  onClearMessages?: (chatId: string) => Promise<void>;
}

const modeOptions: Array<{ value: AgentMode; label: string }> = [
  { value: 'autopilot', label: 'تلقائي' },
  { value: 'copilot', label: 'بالموافقة' },
  { value: 'human', label: 'يدوي' }
];

function messageTime(timestamp: number, language: Language): string {
  return new Date(timestamp).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

export const ChatThread = memo(function ChatThread({ chat, messages, onSendMessage, onRetrySendIntent, onSendReaction, onChangeMode, onBack, onOpenInspector, onDeleteChat, onClearMessages, reactionsEnabled = true }: ChatThreadProps) {
  const { language, tr } = useLocale();
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [confirmRetryId, setConfirmRetryId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [showManageModal, setShowManageModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [contextStatus, setContextStatus] = useState<ContextBudgetStatus | null>(null);
  const [showContextModal, setShowContextModal] = useState(false);
  const sendMutationId = useRef(crypto.randomUUID());
  const retryMutationIds = useRef(new Map<string, string>());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const manageDialogRef = useModalDismiss(showManageModal, () => setShowManageModal(false));

  useEffect(() => {
    if (!chat?.id) {
      setContextStatus(null);
      return undefined;
    }
    let cancelled = false;
    const loadContext = async (chatId: string) => {
      try {
        const res = await api.getContextStatus(chatId);
        if (!cancelled && res?.status) setContextStatus(res.status);
      } catch (err) {
        if (!cancelled) console.warn('[ChatThread] Failed to fetch context status:', err);
      }
    };
    void loadContext(chat.id);
    return () => { cancelled = true; };
  }, [chat?.id, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [messages, chat?.id]);

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!inputText.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await onSendMessage(inputText.trim(), replyingTo?.id, sendMutationId.current);
      sendMutationId.current = crypto.randomUUID();
      setInputText('');
      setReplyingTo(null);
    } catch {
      setError(tr('تعذّر إرسال الرسالة. حاول مرة تانية', 'Could not send the message. Try again'));
    } finally {
      setSending(false);
    }
  };

  const retryIntent = async (intentId: string) => {
    if (confirmRetryId !== intentId) {
      retryMutationIds.current.set(intentId, crypto.randomUUID());
      setConfirmRetryId(intentId);
      return;
    }
    const mutationId = retryMutationIds.current.get(intentId);
    if (!mutationId) return;
    setRetryingId(intentId);
    setError('');
    try {
      await onRetrySendIntent(intentId, mutationId);
      setConfirmRetryId(null);
    } catch {
      setError(tr('تعذّرت إعادة الإرسال. راجع حالة الرسالة قبل المحاولة مرة تانية', 'Retry failed. Check the message status before trying again'));
    } finally {
      setRetryingId(null);
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
          {chat.avatarUrl ? <Avatar avatar={chat.avatarUrl} alt={chat.name} size={36} shape="circle" /> : chat.name.slice(0, 1)}
        </span>
        <div className="wa-thread-contact">
          <h2>{chat.name} {chat.isGroup && <span className="wa-group-label">{tr('مجموعة', 'Group')}</span>}</h2>
          <p dir="auto">{chat.phoneNumber || tr('محادثة واتساب', 'WhatsApp conversation')}</p>
        </div>
        <div className="wa-thread-actions" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {contextStatus && (
            <button
              type="button"
              className="wa-icon-button"
              onClick={() => setShowContextModal(true)}
              aria-label={tr('سياق وضغط المحادثة (ACP)', 'Conversation Context & Compression (ACP)')}
              title={tr('سياق وضغط المحادثة (ACP)', 'Conversation Context & Compression (ACP)')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '12px',
                background: contextStatus.compressionRatio > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(0, 0, 0, 0.05)',
                color: contextStatus.compressionRatio > 0 ? '#059669' : 'inherit',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              <Layers size={15} />
              <span>{Math.round(contextStatus.compressionRatio * 100)}%</span>
            </button>
          )}
          <button
            type="button"
            className="wa-icon-button"
            onClick={() => setShowManageModal(true)}
            aria-label={tr('إدارة بيانات المحادثة', 'Manage chat data')}
            title={tr('إدارة بيانات المحادثة', 'Manage chat data')}
          >
            <Trash2 size={18} />
          </button>
          <button type="button" className="wa-thread-agent wa-icon-button" onClick={onOpenInspector} aria-label={tr('عرض المساعد الذكي', 'Show AI assistant')} title={tr('عرض المساعد الذكي', 'Show AI assistant')}><Gemini.Color size={21} /></button>
        </div>
      </header>

      <div className="wa-chat-mode-bar">
        <span className="wa-mode-title">{tr('وضع المحادثة', 'Chat mode')}</span>
        <fieldset className="wa-segmented" style={{ minInlineSize: 0, marginInline: 0 }} aria-label={tr('وضع المحادثة', 'Chat mode')}>
          {modeOptions.map((mode) => (
            <button
              type="button"
              key={mode.value}
              className={chat.agentMode === mode.value ? 'is-active' : ''}
              aria-pressed={chat.agentMode === mode.value}
              onClick={() => void changeMode(mode.value)}
            >{mode.value === 'autopilot' ? tr('تلقائي', 'Auto-Pilot') : mode.value === 'copilot' ? tr('بالموافقة', 'Co-Pilot') : tr('يدوي', 'Human')}</button>
          ))}
        </fieldset>
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
            const { sendIntentId } = message;
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
                  {message.type === 'video' && message.mediaUrl && <>
                    <video className="wa-media-image" src={message.mediaUrl} controls preload="metadata" aria-label={tr('فيديو مرفق', 'Attached video')}>
                      <track kind="captions" srcLang={language} label={tr('الترجمة النصية غير متوفرة', 'Captions unavailable')} src="data:text/vtt;charset=utf-8,WEBVTT%0A%0A" />
                    </video>
                    <a href={message.mediaUrl} target="_blank" rel="noreferrer">
                      {tr('فتح الفيديو المرفق', 'Open attached video')}
                    </a>
                  </>}
                  {message.type === 'document' && <div className="wa-document-note"><FileText size={20} /><span>{tr('مستند مرفق', 'Attached document')}</span></div>}
                  {message.type !== 'audio' && message.text && message.text !== '[رسالة]' && <p className="wa-message-text" dir="auto">{message.text}</p>}
                  {isOutbound && message.deliveryState && (
                    <div className={'wa-delivery-status is-' + message.deliveryState} role={message.deliveryState === 'uncertain' ? 'alert' : 'status'}>
                      {message.deliveryState === 'uncertain' || message.deliveryState === 'failed' ? <AlertCircle size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}
                      <div className="wa-delivery-details">
                        <strong>{message.deliveryState === 'queued' ? tr('بانتظار الإرسال', 'Queued for sending') : message.deliveryState === 'attempting' ? tr('جارٍ الإرسال', 'Sending') : message.deliveryState === 'uncertain' ? tr('الإرسال غير مؤكد، راجع واتساب قبل إعادة المحاولة', 'Send unconfirmed. Check WhatsApp before retrying') : tr('تعذّر الإرسال', 'Send failed')}</strong>
                        {message.lastAttemptAt && <small>{tr('آخر محاولة', 'Last attempt')}: {messageTime(message.lastAttemptAt, language)}</small>}
                        {message.nativeMessageId && <small dir="auto">ID: {message.nativeMessageId}</small>}
                        {message.deliveryState === 'uncertain' && sendIntentId && (
                          <div className="wa-delivery-actions">
                            <button type="button" disabled={retryingId === sendIntentId} onClick={() => void retryIntent(sendIntentId)}>
                              {retryingId === sendIntentId ? tr('جارٍ التحقق', 'Processing') : confirmRetryId === sendIntentId ? tr('تأكيد إعادة الإرسال', 'Confirm retry') : tr('إعادة الإرسال بعد المراجعة', 'Retry after checking')}
                            </button>
                            {confirmRetryId === sendIntentId && <button type="button" onClick={() => setConfirmRetryId(null)}>{tr('إلغاء', 'Cancel')}</button>}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
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
                      {Array.from(new Set(message.reactions), (emoji) => <span key={emoji}>{emoji}</span>)}
                    </div>
                  )}
                </div>
                <div className="wa-message-actions" aria-label={tr('إجراءات الرسالة', 'Message actions')}>
                  {reactionsEnabled && ['👍', '❤️', '🙏'].map((emoji) => (
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
            onChange={(event) => { setInputText(event.target.value); sendMutationId.current = crypto.randomUUID(); }}
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
      {showManageModal && (
        <div
          className="wa-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowManageModal(false);
          }}
        >
          <dialog
            className="wa-modal"
            ref={manageDialogRef}
            open
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="chat-manage-title"
            style={{ position: 'relative', margin: 0, maxHeight: 'min(90dvh, 720px)', overflowY: 'auto' }}
          >
            <div className="wa-modal-header">
              <div className="wa-modal-heading">
                <span className="wa-modal-icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                  <Trash2 size={20} />
                </span>
                <div>
                  <h2 id="chat-manage-title">{tr('إدارة بيانات المحادثة', 'Manage conversation data')}</h2>
                  <p dir="auto">{chat.name}</p>
                </div>
              </div>
              <button
                type="button"
                className="wa-icon-button"
                onClick={() => setShowManageModal(false)}
                aria-label={tr('إلغاء', 'Close')}
              >
                <X size={20} />
              </button>
            </div>
            <div className="wa-modal-content">
              <p style={{ fontSize: '12px', color: 'var(--wa-muted, #64746f)', margin: '0 0 16px', lineHeight: '1.6' }}>
                {tr(
                  'يمكنك مسح سجل الرسائل فقط للبدء من جديد مع بقاء جهة الاتصال والذاكرة، أو حذف المحادثة بالكامل من قاعدة البيانات.',
                  'You can clear messages to start fresh while preserving the contact, or delete the conversation thread completely.'
                )}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  className="wa-ps-button wa-ps-button-quiet"
                  style={{ justifyContent: 'flex-start', padding: '12px 14px' }}
                  disabled={actionLoading}
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      if (onClearMessages) {
                        await onClearMessages(chat.id);
                      } else {
                        await api.clearChatMessages(chat.id);
                      }
                      setShowManageModal(false);
                    } catch {
                      setError(tr('فشل مسح الرسائل', 'Failed to clear messages'));
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  <span>{tr('مسح الرسائل فقط', 'Clear messages only')}</span>
                </button>
                <button
                  type="button"
                  className="wa-ps-button wa-ps-button-danger"
                  style={{ justifyContent: 'flex-start', padding: '12px 14px' }}
                  disabled={actionLoading}
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      if (onDeleteChat) {
                        await onDeleteChat(chat.id);
                      } else {
                        await api.deleteChat(chat.id);
                      }
                      setShowManageModal(false);
                      onBack();
                    } catch {
                      setError(tr('فشل حذف المحادثة', 'Failed to delete chat'));
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  <span>{tr('حذف المحادثة بالكامل', 'Delete conversation completely')}</span>
                </button>
              </div>
            </div>
          </dialog>
        </div>
      )}

      {showContextModal && contextStatus && <ContextCompressionModal chatId={chat.id} status={contextStatus} onClose={() => setShowContextModal(false)} onRefresh={async () => {
        const result = await api.getContextStatus(chat.id);
        if (!result.status) throw new Error('Context status unavailable');
        setContextStatus(result.status);
      }} />}
    </main>
  );
});

