import { useState } from 'react';
import { Check, Edit2, Sparkles, Brain, Clock, ShieldCheck, Play } from 'lucide-react';
import type { AgentDecision, AgentDraft, ModeratorPersona } from '../api/types';

interface ModeratorDrawerProps {
  drafts: AgentDraft[];
  latestThought?: {
    chatId: string;
    messageId: string;
    decision: AgentDecision;
  };
  persona?: ModeratorPersona;
  onApproveDraft: (draftId: string, editedText?: string) => Promise<void>;
  onRejectDraft: (draftId: string) => Promise<void>;
  onOpenSettings: () => void;
  onOpenSimulator: () => void;
}

export function ModeratorDrawer({
  drafts,
  latestThought,
  persona,
  onApproveDraft,
  onRejectDraft,
  onOpenSettings,
  onOpenSimulator
}: ModeratorDrawerProps) {
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const startEdit = (draft: AgentDraft) => {
    setEditingDraftId(draft.id);
    setEditText(draft.proposedReply);
  };

  const handleApprove = async (draftId: string) => {
    if (editingDraftId === draftId) {
      await onApproveDraft(draftId, editText);
      setEditingDraftId(null);
    } else {
      await onApproveDraft(draftId);
    }
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
            <p className="text-[10px] text-slate-400">Gemini 2.5 Agent</p>
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
                آخر استنتاج لحظي
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
                      onClick={() => handleApprove(draft.id)}
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

        {/* Persona Overview Card */}
        {persona && (
          <div className="p-3 bg-[#0b0f14] border border-[#263140] rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                الشخصية النشطة
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">{persona.model}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {persona.tone}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
