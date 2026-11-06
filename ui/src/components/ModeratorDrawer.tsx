import { useState, useEffect } from 'react';
import { Check, Edit2, Sparkles, Brain, Clock, ShieldCheck, Play, Mic, UserCheck, Bookmark, CheckCircle2, Plus } from 'lucide-react';
import type { AgentDecision, AgentDraft, ModeratorPersona, ContactDossier } from '../api/types';
import { api } from '../api/client';

interface ModeratorDrawerProps {
  drafts: AgentDraft[];
  latestThought?: {
    chatId: string;
    messageId: string;
    decision: AgentDecision;
  };
  persona?: ModeratorPersona;
  selectedChatId?: string;
  onApproveDraft: (draftId: string, editedText?: string, asVoice?: boolean) => Promise<void>;
  onRejectDraft: (draftId: string) => Promise<void>;
  onOpenSettings: () => void;
  onOpenSimulator: () => void;
}

export function ModeratorDrawer({
  drafts,
  latestThought,
  persona,
  selectedChatId,
  onApproveDraft,
  onRejectDraft,
  onOpenSettings,
  onOpenSimulator
}: ModeratorDrawerProps) {
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [dossier, setDossier] = useState<ContactDossier | null>(null);
  const [newFact, setNewFact] = useState('');
  const [newCommitment, setNewCommitment] = useState('');
  const [addingFact, setAddingFact] = useState(false);
  const [addingCommitment, setAddingCommitment] = useState(false);

  useEffect(() => {
    if (!selectedChatId) {
      setDossier(null);
      return;
    }

    api.getDossier(selectedChatId)
      .then((res) => setDossier(res.dossier))
      .catch(() => setDossier(null));
  }, [selectedChatId, latestThought]);

  const handleAddFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChatId || !newFact.trim()) return;
    try {
      const res = await api.addFact(selectedChatId, newFact.trim());
      setDossier(res.dossier);
      setNewFact('');
      setAddingFact(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddCommitment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChatId || !newCommitment.trim()) return;
    try {
      const res = await api.addCommitment(selectedChatId, newCommitment.trim());
      setDossier(res.dossier);
      setNewCommitment('');
      setAddingCommitment(false);
    } catch (err) {
      console.error(err);
    }
  };

  const startEdit = (draft: AgentDraft) => {
    setEditingDraftId(draft.id);
    setEditText(draft.proposedReply);
  };

  const handleApprove = async (draftId: string, asVoice = false) => {
    if (editingDraftId === draftId) {
      await onApproveDraft(draftId, editText, asVoice);
      setEditingDraftId(null);
    } else {
      await onApproveDraft(draftId, undefined, asVoice);
    }
  };

  const stageBadgeColors: Record<string, string> = {
    vip: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    customer: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    negotiation: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    qualified: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    lead: 'bg-slate-700/50 text-slate-300 border-slate-600'
  };

  const stageNames: Record<string, string> = {
    vip: 'عميل VIP متميز ⭐',
    customer: 'عميل حالي 🤝',
    negotiation: 'مرحلة تفاوض 💼',
    qualified: 'مهتم مؤهل 🎯',
    lead: 'جهة اتصال جديدة 🌱'
  };

  return (
    <div className="w-80 md:w-88 border-l border-[#263140] bg-[#131922] flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="p-3.5 border-b border-[#263140] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-100">تحليلات الموديرتور</h3>
            <p className="text-[10px] text-emerald-400 font-medium">Gemini 4 Argon & 3.8 Voice</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSimulator}
            title="تجربة الردود (Simulator)"
            className="p-1.5 rounded-lg bg-[#1c2430] hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 text-xs transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenSettings}
            title="إعدادات الشخصية والقواعد"
            className="px-2.5 py-1 rounded-lg bg-[#1c2430] hover:bg-[#253245] text-slate-300 text-[11px] font-medium transition-colors"
          >
            تخصيص
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Latest Agent Thought */}
        {latestThought && (
          <div className="p-3 bg-[#0b0f14] border border-emerald-500/30 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-emerald-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                آخر استنتاج لحظي (Argon Brain)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ثقة: {Math.round(latestThought.decision.confidence * 100)}%
              </span>
            </div>

            <p className="text-xs text-slate-300 italic leading-relaxed">
              "{latestThought.decision.reasoning}"
            </p>

            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-[#1c2430]">
              <span>النية: <strong className="text-slate-200">{latestThought.decision.intent}</strong></span>
              <span className="flex items-center gap-1 text-slate-400">
                <Clock className="w-2.5 h-2.5" />
                تأخير بشري: {latestThought.decision.simulatedDelayMs}ms
              </span>
            </div>
          </div>
        )}

        {/* Contact Dossier & Long-Term Memory */}
        {dossier && (
          <div className="p-3 bg-[#0b0f14] border border-[#263140] rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
                ملف جهة الاتصال والذاكرة
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${stageBadgeColors[dossier.stage || 'lead']}`}>
                {stageNames[dossier.stage || 'lead'] || dossier.stage}
              </span>
            </div>

            {/* Extracted Facts */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1 font-medium text-slate-300">
                  <Bookmark className="w-3 h-3 text-emerald-400" />
                  الحقائق المستخلصة ({dossier.facts?.length || 0})
                </span>
                <button
                  type="button"
                  onClick={() => setAddingFact(!addingFact)}
                  className="text-[10px] text-emerald-400 hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-2.5 h-2.5" /> إضافة
                </button>
              </div>

              {addingFact && (
                <form onSubmit={handleAddFact} className="flex gap-1.5 mt-1">
                  <input
                    type="text"
                    value={newFact}
                    onChange={(e) => setNewFact(e.target.value)}
                    placeholder="اكتب حقيقة جديدة عن العميل..."
                    className="flex-1 px-2.5 py-1 bg-[#131922] border border-[#263140] rounded-lg text-[11px] text-slate-100 focus:outline-hidden focus:border-emerald-500"
                  />
                  <button type="submit" className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px]">
                    حفظ
                  </button>
                </form>
              )}

              {dossier.facts && dossier.facts.length > 0 ? (
                <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                  {dossier.facts.map((fact, idx) => (
                    <div key={idx} className="p-1.5 rounded-lg bg-[#131922] border border-[#1e2735] text-[11px] text-slate-300 leading-snug">
                      • {fact}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 italic">لا توجد حقائق مسجلة بعد.</p>
              )}
            </div>

            {/* Commitments & Promises */}
            <div className="space-y-1.5 pt-2 border-t border-[#1c2430]">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1 font-medium text-slate-300">
                  <CheckCircle2 className="w-3 h-3 text-cyan-400" />
                  الوعود والالتزامات المعلقة ({dossier.commitments?.length || 0})
                </span>
                <button
                  type="button"
                  onClick={() => setAddingCommitment(!addingCommitment)}
                  className="text-[10px] text-cyan-400 hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-2.5 h-2.5" /> إضافة
                </button>
              </div>

              {addingCommitment && (
                <form onSubmit={handleAddCommitment} className="flex gap-1.5 mt-1">
                  <input
                    type="text"
                    value={newCommitment}
                    onChange={(e) => setNewCommitment(e.target.value)}
                    placeholder="اكتب التزاماً أو وعداً قُطع للعميل..."
                    className="flex-1 px-2.5 py-1 bg-[#131922] border border-[#263140] rounded-lg text-[11px] text-slate-100 focus:outline-hidden focus:border-cyan-500"
                  />
                  <button type="submit" className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[10px]">
                    حفظ
                  </button>
                </form>
              )}

              {dossier.commitments && dossier.commitments.length > 0 ? (
                <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                  {dossier.commitments.map((comm, idx) => (
                    <div key={idx} className="p-1.5 rounded-lg bg-[#131922] border border-cyan-900/30 text-[11px] text-cyan-200 leading-snug">
                      ✓ {comm}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 italic">لا توجد وعود أو التزامات معلقة.</p>
              )}
            </div>
          </div>
        )}

        {/* Pending Drafts Queue */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <span>مسودات بانتظار الموافقة</span>
              <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 font-bold text-[10px] flex items-center justify-center">
                {drafts.length}
              </span>
            </span>
          </div>

          {drafts.length === 0 ? (
            <div className="p-4 bg-[#0b0f14] border border-[#263140] rounded-xl text-center text-slate-500 text-[11px]">
              لا توجد مسودات معلقة. الموديرتور يعمل بسلاسة.
            </div>
          ) : (
            <div className="space-y-2.5">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="p-3 bg-[#0b0f14] border border-amber-500/30 rounded-xl space-y-2 text-xs"
                >
                  <div className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>محادثة: {draft.chatId.split('@')[0]}</span>
                    <span className="text-amber-400 font-medium">بانتظار موافقتك</span>
                  </div>

                  <div className="p-2 bg-[#18202b] rounded-lg text-slate-400 text-[11px]">
                    <strong>الرسالة الواردة:</strong> {draft.incomingText}
                  </div>

                  {editingDraftId === draft.id ? (
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full p-2 bg-[#131922] border border-[#263140] rounded-lg text-xs text-slate-100 focus:outline-hidden focus:border-emerald-500"
                      rows={3}
                    />
                  ) : (
                    <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/30 rounded-lg text-emerald-100 font-medium">
                      "{draft.proposedReply}"
                    </div>
                  )}

                  <div className="text-[10px] text-slate-400 italic">
                    السبب: {draft.reasoning}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    {editingDraftId === draft.id ? (
                      <button
                        onClick={() => setEditingDraftId(null)}
                        className="px-2 py-1 rounded-lg text-slate-400 hover:text-slate-200 text-[11px]"
                      >
                        إلغاء التعديل
                      </button>
                    ) : (
                      <button
                        onClick={() => startEdit(draft)}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
                        title="تعديل الرد"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => onRejectDraft(draft.id)}
                      className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] font-medium transition-colors"
                    >
                      تجاهل
                    </button>

                    <button
                      onClick={() => handleApprove(draft.id, true)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/30 text-[11px] font-medium transition-colors"
                      title="توليد فويس نوت عبر Gemini 3.8 Flash TTS"
                    >
                      <Mic className="w-3 h-3" />
                      فويس
                    </button>

                    <button
                      onClick={() => handleApprove(draft.id, false)}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium transition-colors shadow-sm"
                    >
                      <Check className="w-3 h-3" />
                      إرسال الرد
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Persona Overview & Active Stack Card */}
        {persona && (
          <div className="p-3 bg-[#0b0f14] border border-[#263140] rounded-xl space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                حزمة النماذج النشطة
              </span>
              <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                {persona.model}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-300">
              <div className="p-2 rounded-lg bg-[#131922] border border-[#1e2735]">
                <span className="text-slate-500 block mb-0.5">🧠 نموذج التفكير:</span>
                <span className="font-mono text-emerald-300 font-semibold">{persona.model}</span>
              </div>
              <div className="p-2 rounded-lg bg-[#131922] border border-[#1e2735]">
                <span className="text-slate-500 block mb-0.5">🎙️ محرك الصوت:</span>
                <span className="font-mono text-cyan-300 font-semibold">{persona.voiceName || 'kore'}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed border-t border-[#1c2430] pt-2">
              {persona.tone}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
