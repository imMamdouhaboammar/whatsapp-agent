import { useEffect, useState, type FormEvent } from 'react';
import { BookOpenText, CalendarCheck, Check, CheckCircle2, ChevronLeft, Edit3, Lightbulb, Mic, Plus, SlidersHorizontal, Trash2, X, ShieldAlert } from 'lucide-react';
import { Gemini, ModelIcon } from '@lobehub/icons';
import { AgentAvatar, Tag } from '@lobehub/ui';
import type { AgentDecision, AgentDraft, AgentMode, ContactDossier, ModeratorPersona } from '../api/types';
import { api } from '../api/client';
import { useLocale } from '../locale-context';

interface ModeratorDrawerProps {
  view: 'assistant' | 'drafts' | 'memory';
  drafts: AgentDraft[];
  latestThought?: { chatId: string; messageId: string; decision: AgentDecision };
  persona?: ModeratorPersona;
  selectedChatId?: string;
  selectedChatMode?: AgentMode;
  onSelectChat: (chatId: string) => void;
  onApproveDraft: (draftId: string, editedText?: string, asVoice?: boolean) => Promise<void>;
  onRejectDraft: (draftId: string) => Promise<void>;
}

function confidenceLabel(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 100).toString() + '%';
}

export function ModeratorDrawer({
  view, drafts, latestThought, persona, selectedChatId, selectedChatMode,
  onSelectChat, onApproveDraft, onRejectDraft
}: ModeratorDrawerProps) {
  const { tr } = useLocale();
  const [dossier, setDossier] = useState<ContactDossier | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [workingDraftId, setWorkingDraftId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [newFact, setNewFact] = useState('');
  const [newCommitment, setNewCommitment] = useState('');
  const [addingFact, setAddingFact] = useState(false);
  const [addingCommitment, setAddingCommitment] = useState(false);

  // Matured Contact Memories & Adaptive Style
  const [memories, setMemories] = useState<Array<{ id: string; content: string; created_at: number }>>([]);
  const [newMemory, setNewMemory] = useState('');
  const [addingMemory, setAddingMemory] = useState(false);
  const [chatStyle, setChatStyle] = useState<string>('casual');

  useEffect(() => {
    if (!selectedChatId) {
      return;
    }
    let active = true;
    api.getDossier(selectedChatId)
      .then((response) => { if (active) setDossier(response.dossier); })
      .catch((err) => {
        if (active) {
          setDossier(null);
          console.warn('Failed to fetch contact dossier:', err);
        }
      });

    api.getMemories(selectedChatId)
      .then((res) => { if (active) setMemories(res.memories || []); })
      .catch((err) => {
        if (active) {
          setMemories([]);
          console.warn('Failed to fetch contact memories:', err);
        }
      });

    api.getChatStyle(selectedChatId)
      .then((res) => { if (active) setChatStyle(res.style || 'casual'); })
      .catch((err) => {
        if (active) {
          setChatStyle('casual');
          console.warn('Failed to fetch chat style:', err);
        }
      });

    return () => { active = false; };
  }, [selectedChatId, latestThought]);

  const addMemoryEntry = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedChatId || !newMemory.trim()) return;
    setError('');
    try {
      const res = await api.addMemory(selectedChatId, newMemory.trim());
      if (res.status === 'rejected_credential') {
        setError(tr('تم رفض الحفظ: لا يمكن تخزين كلمات المرور أو البيانات السرية', 'Security block: Passwords or secrets cannot be stored'));
      } else {
        setNewMemory('');
        setAddingMemory(false);
        const updated = await api.getMemories(selectedChatId);
        setMemories(updated.memories || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memory');
    }
  };

  const deleteMemoryEntry = async (id: string) => {
    if (!selectedChatId) return;
    try {
      await api.deleteMemory(selectedChatId, id);
      setMemories(memories.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory');
    }
  };

  const handleStyleChange = async (newStyle: string) => {
    if (!selectedChatId) return;
    setChatStyle(newStyle);
    try {
      await api.setChatStyle(selectedChatId, newStyle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update style');
    }
  };

  const addEntry = async (event: FormEvent, type: 'fact' | 'commitment') => {
    event.preventDefault();
    if (!selectedChatId) return;
    const value = type === 'fact' ? newFact.trim() : newCommitment.trim();
    if (!value) return;
    setError('');
    try {
      const response = type === 'fact'
        ? await api.addFact(selectedChatId, value)
        : await api.addCommitment(selectedChatId, value);
      setDossier(response.dossier);
      if (type === 'fact') { setNewFact(''); setAddingFact(false); }
      else { setNewCommitment(''); setAddingCommitment(false); }
    } catch {
      setError(tr('تعذّر حفظ المعلومة، حاول مرة تانية', 'Could not save this information. Try again'));
    }
  };

  const performDraftAction = async (draft: AgentDraft, action: 'approve' | 'voice' | 'reject') => {
    if (workingDraftId) return;
    setWorkingDraftId(draft.id);
    setError('');
    try {
      if (action === 'reject') await onRejectDraft(draft.id);
      else await onApproveDraft(draft.id, editingDraftId === draft.id ? editText : undefined, action === 'voice');
      setEditingDraftId(null);
    } catch {
      setError(tr('تعذّر تنفيذ الطلب، المسودة لسه موجودة', 'Action failed. Your draft is still here'));
    } finally {
      setWorkingDraftId(null);
    }
  };

  const visibleDrafts = view === 'drafts' ? drafts : drafts.filter((draft) => draft.chatId === selectedChatId);
  const thought = latestThought?.chatId === selectedChatId ? latestThought?.decision : undefined;
  const showMemory = view === 'assistant' || view === 'memory';

  return (
    <div className="wa-agent">
      <header className="wa-agent-header">
        <div className="wa-agent-heading">
          <AgentAvatar
            seed={persona?.name || 'Moderator'}
            size={36}
            shape="hex"
            color="geekblue"
            state={visibleDrafts.length > 0 ? 'waiting' : 'idle'}
          />
          <div>
            <h2>{view === 'drafts' ? tr('المسودات المعلقة', 'Pending drafts') : view === 'memory' ? tr('ذاكرة المحادثة', 'Chat memory') : tr('المساعد الذكي', 'AI assistant')}</h2>
            <p><span className="wa-live-dot" /> {selectedChatMode === 'autopilot' ? tr('Auto-Pilot مفعّل', 'Auto-Pilot active') : selectedChatMode === 'copilot' ? tr('Co-Pilot مفعّل', 'Co-Pilot active') : selectedChatMode === 'human' ? tr('الوضع اليدوي', 'Human mode') : tr('جاهز للمتابعة', 'Ready')}</p>
          </div>
        </div>
      </header>

      <div className="wa-agent-scroll">
        {view !== 'memory' && (
          <section className="wa-agent-section">
            <div className="wa-agent-section-heading">
              <h3>{view === 'drafts' ? tr('بانتظار موافقتك', 'Needs your approval') : tr('ردود بانتظار الموافقة', 'Replies awaiting approval')}</h3>
              <span className="wa-count wa-count-subtle">{visibleDrafts.length}</span>
            </div>

            {visibleDrafts.length === 0 ? (
              <div className="wa-agent-empty">
                <span><CheckCircle2 size={23} /></span>
                <strong>{tr('مافيش ردود محتاجة مراجعة', 'No replies need review')}</strong>
                <p>{tr('أي مسودة جديدة هتظهر هنا قبل إرسالها', 'New drafts appear here before they are sent')}</p>
              </div>
            ) : visibleDrafts.map((draft) => (
              <article className="wa-draft" key={draft.id}>
                <div className="wa-draft-meta">
                  <Tag color="orange" variant="filled" className="wa-review-badge">{tr('مراجعة مطلوبة', 'Review required')}</Tag>
                  <Tag color="green" variant="outlined" className="wa-confidence"><CheckCircle2 size={14} /> {tr('الثقة', 'Confidence')} <b dir="ltr">{confidenceLabel(draft.confidence)}</b></Tag>
                </div>
                {view === 'drafts' && (
                  <button type="button" className="wa-draft-contact" onClick={() => onSelectChat(draft.chatId)}>
                    <span dir="ltr">{draft.chatId.split('@')[0]}</span><ChevronLeft size={14} />
                  </button>
                )}
                <div className="wa-incoming-context">
                  <span>{tr('الرسالة الواردة', 'Incoming message')}</span>
                  <p dir="auto">{draft.incomingText}</p>
                </div>
                {editingDraftId === draft.id ? (
                  <label className="wa-draft-edit">
                    <span>{tr('عدّل الرد قبل الإرسال', 'Edit before sending')}</span>
                    <textarea dir="auto" value={editText} onChange={(event) => setEditText(event.target.value)} rows={4} />
                  </label>
                ) : (
                  <p className="wa-proposed-reply" dir="auto">{draft.proposedReply}</p>
                )}
                <div className="wa-draft-actions">
                  <button type="button" className="wa-primary-button" disabled={Boolean(workingDraftId)} onClick={() => void performDraftAction(draft, 'approve')}>
                    <Check size={17} /> {tr('اعتماد وإرسال', 'Approve & send')}
                  </button>
                  <button type="button" className="wa-secondary-button" disabled={Boolean(workingDraftId)} onClick={() => {
                    if (editingDraftId === draft.id) setEditingDraftId(null);
                    else { setEditingDraftId(draft.id); setEditText(draft.proposedReply); }
                  }}>
                    {editingDraftId === draft.id ? <X size={16} /> : <Edit3 size={16} />}
                    {editingDraftId === draft.id ? tr('إلغاء', 'Cancel') : tr('تعديل', 'Edit')}
                  </button>
                </div>
                <div className="wa-draft-more-actions">
                  <button type="button" disabled={Boolean(workingDraftId)} onClick={() => void performDraftAction(draft, 'reject')}>{tr('رفض', 'Reject')}</button>
                  <button type="button" disabled={Boolean(workingDraftId)} onClick={() => void performDraftAction(draft, 'voice')}><Mic size={16} /> {tr('إرسال صوتي', 'Send as voice')}</button>
                </div>
                {draft.reasoning && (
                  <details className="wa-reason-details">
                    <summary><Lightbulb size={15} /> {tr('سبب الاقتراح', 'Why this reply?')}</summary>
                    <p dir="auto">{draft.reasoning}</p>
                  </details>
                )}
              </article>
            ))}
          </section>
        )}

        {thought && view === 'assistant' && (
          <section className="wa-agent-section wa-thought-section">
            <div className="wa-agent-section-heading"><h3><Lightbulb size={17} /> {tr('آخر قرار للمساعد', 'Latest AI decision')}</h3></div>
            <p dir="auto">{thought.reasoning}</p>
            <div className="wa-thought-footer">
              <span>{thought.intent}</span>
              <span>{tr('الثقة', 'Confidence')} <b dir="ltr">{confidenceLabel(thought.confidence)}</b></span>
            </div>
          </section>
        )}

        {showMemory && (
          <section className="wa-agent-section wa-memory-section">
            <div className="wa-agent-section-heading"><h3><BookOpenText size={17} /> {tr('ذاكرة المحادثة', 'Chat memory')}</h3></div>
            {!selectedChatId ? (
              <p className="wa-agent-hint">{tr('اختار محادثة لعرض المعلومات المحفوظة', 'Select a chat to view saved details')}</p>
            ) : (
              <>
                {/* Adaptive Conversation Style */}
                <div className="wa-memory-group">
                  <div className="wa-memory-group-heading">
                    <span><SlidersHorizontal size={15} /> {tr('نبرة وأسلوب المحادثة', 'Conversation style')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 p-2 bg-slate-900/60 rounded-lg border border-slate-800">
                    {(['casual', 'professional', 'playful', 'assertive', 'empathetic'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => void handleStyleChange(st)}
                        className={`px-2.5 py-1 text-xs rounded-md transition font-medium ${
                          chatStyle === st
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {st === 'casual' ? tr('عادي / ودود', 'Casual') :
                         st === 'professional' ? tr('رسمي / مهني', 'Professional') :
                         st === 'playful' ? tr('مرح / فكاهي', 'Playful') :
                         st === 'assertive' ? tr('حاسم / مباشر', 'Assertive') :
                         tr('داعم / متعاطف', 'Empathetic')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Explicit Contact Memories (Privacy Protected) */}
                <div className="wa-memory-group">
                  <div className="wa-memory-group-heading">
                    <span title={tr('ذاكرة مؤمنة لا تقبل كلمات المرور أو الأسرار', 'Secured memory rejecting credentials')}>
                      <ShieldAlert size={15} className="text-emerald-400" /> {tr('ذكريات مفضلة (مؤمنة)', 'Explicit memories')}
                    </span>
                    <button type="button" onClick={() => setAddingMemory(!addingMemory)} aria-label={tr('إضافة تفضيل', 'Add memory')}>
                      <Plus size={16} /> {tr('إضافة', 'Add')}
                    </button>
                  </div>
                  {memories.map((m) => (
                    <div key={m.id} className="wa-memory-item flex items-center justify-between group" dir="auto">
                      <span>{m.content}</span>
                      <button
                        type="button"
                        onClick={() => void deleteMemoryEntry(m.id)}
                        className="opacity-60 hover:opacity-100 p-1 text-red-400 hover:text-red-300 transition"
                        title={tr('حذف', 'Delete')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {!memories.length && <p className="wa-agent-hint">{tr('لا توجد تفضيلات مخصصة مسجلة', 'No custom preferences recorded')}</p>}
                  {addingMemory && (
                    <form className="wa-memory-form" onSubmit={(e) => void addMemoryEntry(e)}>
                      <input
                        value={newMemory}
                        onChange={(e) => setNewMemory(e.target.value)}
                        placeholder={tr('اكتب تفضيل جديد (مثلاً: يفضل الشحن الصباحي)', 'e.g. Prefers morning delivery')}
                      />
                      <button type="submit" className="wa-primary-button">{tr('حفظ', 'Save')}</button>
                    </form>
                  )}
                </div>

                {dossier?.stage && <span className="wa-contact-stage">{dossier.stage === 'lead' ? tr('جهة اتصال جديدة', 'New contact') : dossier.stage === 'customer' ? tr('عميل حالي', 'Customer') : dossier.stage === 'qualified' ? tr('عميل محتمل', 'Qualified lead') : dossier.stage === 'negotiation' ? tr('مرحلة تفاوض', 'Negotiation') : dossier.stage === 'vip' ? 'VIP' : dossier.stage}</span>}
                <div className="wa-memory-group">
                  <div className="wa-memory-group-heading">
                    <span><BookOpenText size={15} /> {tr('معلومات محفوظة', 'Saved facts')}</span>
                    <button type="button" onClick={() => setAddingFact(!addingFact)} aria-label={tr('إضافة معلومة', 'Add fact')}><Plus size={16} /> {tr('إضافة', 'Add')}</button>
                  </div>
                  {dossier?.facts?.map((fact, index) => <p className="wa-memory-item" dir="auto" key={fact + index}>{fact}</p>)}
                  {!dossier?.facts?.length && <p className="wa-agent-hint">{tr('مافيش معلومات محفوظة لسه', 'No saved facts yet')}</p>}
                  {addingFact && (
                    <form className="wa-memory-form" onSubmit={(event) => void addEntry(event, 'fact')}>
                      <input value={newFact} onChange={(event) => setNewFact(event.target.value)} placeholder={tr('اكتب معلومة جديدة', 'Add a new fact')} aria-label={tr('معلومة جديدة', 'New fact')} />
                      <button type="submit" className="wa-primary-button">{tr('حفظ', 'Save')}</button>
                    </form>
                  )}
                </div>
                <div className="wa-memory-group">
                  <div className="wa-memory-group-heading">
                    <span><CalendarCheck size={15} /> {tr('الوعود والالتزامات', 'Commitments')}</span>
                    <button type="button" onClick={() => setAddingCommitment(!addingCommitment)} aria-label={tr('إضافة التزام', 'Add commitment')}><Plus size={16} /> {tr('إضافة', 'Add')}</button>
                  </div>
                  {dossier?.commitments?.map((item, index) => <p className="wa-memory-item" dir="auto" key={item + index}><CheckCircle2 size={15} />{item}</p>)}
                  {!dossier?.commitments?.length && <p className="wa-agent-hint">{tr('مافيش التزامات محفوظة لسه', 'No saved commitments yet')}</p>}
                  {addingCommitment && (
                    <form className="wa-memory-form" onSubmit={(event) => void addEntry(event, 'commitment')}>
                      <input value={newCommitment} onChange={(event) => setNewCommitment(event.target.value)} placeholder={tr('اكتب التزام جديد', 'Add a commitment')} aria-label={tr('التزام جديد', 'New commitment')} />
                      <button type="submit" className="wa-primary-button">{tr('حفظ', 'Save')}</button>
                    </form>
                  )}
                </div>
              </>
            )}
          </section>
        )}
        {error && <p className="wa-inline-error" role="alert">{error}</p>}
        {persona && (
          <footer className="wa-agent-footer">
            <ModelIcon model={persona.model} size={17} />
            <Gemini.Color size={17} />
            <span dir="ltr">{persona.model}</span>
            <span>·</span>
            <span dir="ltr">{persona.voiceName || 'kore'}</span>
          </footer>
        )}
      </div>
    </div>
  );
}

