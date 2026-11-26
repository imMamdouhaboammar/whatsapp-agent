import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCheck, Clock3, FileText, Layers, MessageCircle, Mic, Reply, Search, Send, Trash2, X, Zap } from 'lucide-react';
import { Gemini } from '@lobehub/icons';
import { Avatar } from '@lobehub/ui';
import type { AgentMode, ChatMessage, ChatSummary, ContextBudgetStatus, ConversationFold } from '../api/types';
import { api } from '../api/client';
import { useLocale, type Language } from '../locale-context';
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
  const [compressing, setCompressing] = useState(false);
  const [memorySearchQuery, setMemorySearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ messages: ChatMessage[]; folds: ConversationFold[] } | null>(null);
  const [searchingMemory, setSearchingMemory] = useState(false);
  const sendMutationId = useRef(crypto.randomUUID());
  const retryMutationIds = useRef(new Map<string, string>());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useModalDismiss(showManageModal, () => setShowManageModal(false));
  useModalDismiss(showContextModal, () => setShowContextModal(false));

  useEffect(() => {
    if (!chat?.id) {
      setContextStatus(null);
      return;
    }
    let cancelled = false;
    api.getContextStatus(chat.id).then((res) => {
      if (!cancelled && res?.status) setContextStatus(res.status);
    }).catch((err: unknown) => {
      if (!cancelled) {
        console.warn('[ChatThread] Failed to fetch context status:', err);
      }
    });
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
    setRetryingId(intentId);
    setError('');
    try {
      await onRetrySendIntent(intentId, retryMutationIds.current.get(intentId)!);
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
                  {isOutbound && message.deliveryState && (
                    <div className={'wa-delivery-status is-' + message.deliveryState} role={message.deliveryState === 'uncertain' ? 'alert' : 'status'}>
                      {message.deliveryState === 'uncertain' || message.deliveryState === 'failed' ? <AlertCircle size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}
                      <div className="wa-delivery-details">
                        <strong>{message.deliveryState === 'queued' ? tr('بانتظار الإرسال', 'Queued for sending') : message.deliveryState === 'attempting' ? tr('جارٍ الإرسال', 'Sending') : message.deliveryState === 'uncertain' ? tr('الإرسال غير مؤكد، راجع واتساب قبل إعادة المحاولة', 'Send unconfirmed. Check WhatsApp before retrying') : tr('تعذّر الإرسال', 'Send failed')}</strong>
                        {message.lastAttemptAt && <small>{tr('آخر محاولة', 'Last attempt')}: {messageTime(message.lastAttemptAt, language)}</small>}
                        {message.nativeMessageId && <small dir="auto">ID: {message.nativeMessageId}</small>}
                        {message.deliveryState === 'uncertain' && message.sendIntentId && (
                          <div className="wa-delivery-actions">
                            <button type="button" disabled={retryingId === message.sendIntentId} onClick={() => void retryIntent(message.sendIntentId!)}>
                              {retryingId === message.sendIntentId ? tr('جارٍ التحقق', 'Processing') : confirmRetryId === message.sendIntentId ? tr('تأكيد إعادة الإرسال', 'Confirm retry') : tr('إعادة الإرسال بعد المراجعة', 'Retry after checking')}
                            </button>
                            {confirmRetryId === message.sendIntentId && <button type="button" onClick={() => setConfirmRetryId(null)}>{tr('إلغاء', 'Cancel')}</button>}
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
                      {message.reactions?.map((emoji, index) => <span key={emoji + index}>{emoji}</span>)}
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
          {/* react-doctor-disable-next-line react-doctor/prefer-html-dialog */}
          <section
            className="wa-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-manage-title"
            style={{ maxHeight: 'min(90dvh, 720px)', overflowY: 'auto' }}
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
          </section>
        </div>
      )}

      {showContextModal && contextStatus && (
        <div className="wa-modal-backdrop" onClick={() => setShowContextModal(false)}>
          <section
            className="wa-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={tr('سياق وضغط المحادثة', 'Context & Compression Status')}
            style={{ maxWidth: '480px', maxHeight: 'min(90dvh, 720px)', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wa-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers size={18} />
                <h3 style={{ margin: 0, fontSize: '15px' }}>{tr('سياق وضغط المحادثة (ACP)', 'Context Window & ACP Compression')}</h3>
              </div>
              <button
                type="button"
                className="wa-icon-button"
                onClick={() => setShowContextModal(false)}
                aria-label={tr('إغلاق', 'Close')}
              >
                <X size={16} />
              </button>
            </div>
            <div className="wa-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280' }}>
                  <span>{tr('استهلاك التوكنز الفعلي', 'Active Token Budget')}</span>
                  <span>{contextStatus.currentTokens.toLocaleString()} / {contextStatus.targetContextBudget.toLocaleString()}</span>
                </div>
                <div style={{ height: '6px', borderRadius: '3px', background: '#e5e7eb', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.round((contextStatus.currentTokens / contextStatus.targetContextBudget) * 100))}%`,
                      background: contextStatus.nudgeDecision === 'strong' ? '#ef4444' : contextStatus.nudgeDecision === 'soft' ? '#f59e0b' : '#10b981',
                      borderRadius: '3px'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(0,0,0,0.03)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>{tr('التوفير', 'Savings')}</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#059669' }}>
                    {Math.round(contextStatus.compressionRatio * 100)}%
                  </div>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(0,0,0,0.03)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>{tr('سجلات الطي', 'Folds')}</div>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{contextStatus.activeFoldsCount}</div>
                </div>
                <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(0,0,0,0.03)', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>{tr('توكنز وفرناها', 'Saved Tokens')}</div>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{contextStatus.tokensSaved.toLocaleString()}</div>
                </div>
              </div>

              <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontWeight: 600, color: '#374151' }}>{tr('مستويات الأرشيف المتراكم (LSM Tiers):', 'Archival Hierarchy (LSM Tiers):')}</span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                    Tier 1 ({contextStatus.tier1Count}): {tr('جلسات', 'Sessions')}
                  </span>
                  <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                    Tier 2 ({contextStatus.tier2Count}): {tr('محطات', 'Milestones')}
                  </span>
                  <span style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                    Tier 3 ({contextStatus.tier3Count}): {tr('أرشيف دائم', 'Archivals')}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="wa-ps-button"
                style={{ justifyContent: 'center', gap: '8px', padding: '10px 14px' }}
                disabled={compressing}
                onClick={async () => {
                  setCompressing(true);
                  try {
                    await api.foldNow(chat.id);
                    const res = await api.getContextStatus(chat.id);
                    if (res?.status) setContextStatus(res.status);
                  } catch {
                    setError(tr('تعذّر ضغط المحادثة حالياً', 'Could not compress context now'));
                  } finally {
                    setCompressing(false);
                  }
                }}
              >
                <Zap size={15} />
                <span>{compressing ? tr('جاري الضغط والتلخيص...', 'Compressing context...') : tr('ضغط وتلخيص المحادثة الآن (Fold Now)', 'Compress Context Now (Fold Now)')}</span>
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid #f3f4f6', paddingTop: '10px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    value={memorySearchQuery}
                    onChange={(e) => setMemorySearchQuery(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && memorySearchQuery.trim()) {
                        setSearchingMemory(true);
                        try {
                          const res = await api.searchMemory(chat.id, memorySearchQuery.trim());
                          setSearchResults(res.results);
                        } finally {
                          setSearchingMemory(false);
                        }
                      }
                    }}
                    placeholder={tr('ابحث في الأرشيف والرسائل القديمة...', 'Search historical memory and folds...')}
                    style={{ flex: 1, padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                  />
                  <button
                    type="button"
                    className="wa-icon-button"
                    disabled={searchingMemory || !memorySearchQuery.trim()}
                    onClick={async () => {
                      setSearchingMemory(true);
                      try {
                        const res = await api.searchMemory(chat.id, memorySearchQuery.trim());
                        setSearchResults(res.results);
                      } finally {
                        setSearchingMemory(false);
                      }
                    }}
                    aria-label={tr('بحث', 'Search')}
                  >
                    <Search size={16} />
                  </button>
                </div>
                {searchResults && (
                  <div style={{ maxHeight: '140px', overflowY: 'auto', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {searchResults.folds.map((f) => (
                      <div key={f.id} style={{ background: '#f9fafb', padding: '4px 6px', borderRadius: '4px' }}>
                        <strong>[Fold] {f.topic}:</strong> {f.summary.slice(0, 100)}...
                      </div>
                    ))}
                    {searchResults.messages.map((m) => (
                      <div key={m.id} style={{ background: '#f9fafb', padding: '4px 6px', borderRadius: '4px' }}>
                        <strong>[Msg] {m.isFromMe ? 'أنا' : 'العميل'}:</strong> {m.text.slice(0, 100)}
                      </div>
                    ))}
                    {searchResults.folds.length === 0 && searchResults.messages.length === 0 && (
                      <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>{tr('لا توجد نتائج مطابقة', 'No matching results')}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
});

