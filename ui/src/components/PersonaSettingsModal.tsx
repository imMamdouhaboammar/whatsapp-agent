import { useState, useEffect } from 'react';
import { X, Save, Sliders } from 'lucide-react';
import type { ModeratorPersona, PolicyConfig } from '../api/types';

interface PersonaSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPersona?: ModeratorPersona;
  initialPolicy?: PolicyConfig;
  onSave: (persona: Partial<ModeratorPersona>, policy?: Partial<PolicyConfig>) => Promise<void>;
}

export function PersonaSettingsModal({
  isOpen,
  onClose,
  initialPersona,
  onSave
}: PersonaSettingsModalProps) {
  const [persona, setPersona] = useState<ModeratorPersona | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialPersona) {
      setPersona(JSON.parse(JSON.stringify(initialPersona)));
    }
  }, [initialPersona, isOpen]);

  if (!isOpen || !persona) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(persona);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (tone: string, prompt: string) => {
    setPersona({
      ...persona,
      tone,
      systemPrompt: prompt
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-[#131922] border border-[#263140] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#263140] bg-[#0b0f14]/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">تخصيص شخصية الموديرتور والقواعد</h2>
              <p className="text-xs text-slate-400">Agent Persona & Policy Controls</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#1c2430] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-right">
          {/* Quick Presets */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-2">قوالب جاهزة سريعة:</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  applyPreset(
                    'طبيعي جداً، بشوش، محترف، باللهجة المصرية الراقية بدون أي تكلف أو تصنع كأنك صاحب الشات تماماً',
                    `أنت الموديرتور المسؤول عن الرد على رسائل الواتساب نيابة عن صاحب الحساب.
مهمتك الرد على جهات الاتصال بطريقة بشرية 100% كأن صاحب الحساب هو من يكتب بنفسه.
القواعد:
1. لا تذكر إطلاقاً أنك ذكاء اصطناعي أو بوت.
2. اكتب بلغة عامية مصرية طبيعية وسلسة وودودة وجمل قصيرة.
3. تفاعل مع سياق الحديث باهتمام وافهم قصد الطرف الآخر.`
                  )
                }
                className="px-3 py-1.5 rounded-xl bg-[#1c2430] hover:bg-emerald-500/20 text-xs text-slate-300 hover:text-emerald-400 border border-[#263140] transition-colors"
              >
                🇪🇬 موديرتور مصري بشوش وطبيعي
              </button>
              <button
                type="button"
                onClick={() =>
                  applyPreset(
                    'مهني، راقي، محترف، باللغة العربية الفصحى المعاصرة المريحة',
                    `أنت الموديرتور الرسمي لخدمة العملاء على واتساب.
أجب باحترافية واضحة، دقيقة، ومرحبة للغاية، مع حل مشكلات العملاء وتقديم يد العون بلغة فصحى راقية.`
                  )
                }
                className="px-3 py-1.5 rounded-xl bg-[#1c2430] hover:bg-emerald-500/20 text-xs text-slate-300 hover:text-emerald-400 border border-[#263140] transition-colors"
              >
                🏢 خدمة عملاء احترافية (فصحى)
              </button>
            </div>
          </div>

          {/* Persona Name */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">اسم الموديرتور / الحساب:</label>
            <input
              type="text"
              value={persona.name}
              onChange={(e) => setPersona({ ...persona, name: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-100 focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* Model Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">موديل Gemini المعتمد:</label>
              <select
                value={persona.model}
                onChange={(e) => setPersona({ ...persona, model: e.target.value })}
                className="w-full px-3 py-2 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-100 focus:outline-hidden focus:border-emerald-500"
              >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (فائق السرعة - ننصح به)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (تفكير عميق)</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                حد أدنى للثقة قبل الموافقة التلقائية: {(persona.minConfidence * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={persona.minConfidence}
                onChange={(e) => setPersona({ ...persona, minConfidence: parseFloat(e.target.value) })}
                className="w-full mt-2 accent-emerald-500"
              />
            </div>
          </div>

          {/* Tone Description */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">نبرة وأسلوب الحديث (Tone):</label>
            <input
              type="text"
              value={persona.tone}
              onChange={(e) => setPersona({ ...persona, tone: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-100 focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* System Prompt / Guidelines */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">تعليمات الموديرتور المفصلة (System Prompt):</label>
            <textarea
              rows={6}
              value={persona.systemPrompt}
              onChange={(e) => setPersona({ ...persona, systemPrompt: e.target.value })}
              className="w-full p-3 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-100 leading-relaxed focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* Simulated Typing Delays */}
          <div className="p-3 bg-[#0b0f14] border border-[#263140] rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">محاكاة سرعة الكتابة البشرية (Typing Delay)</span>
              <input
                type="checkbox"
                checked={persona.simulateTypingDelay}
                onChange={(e) => setPersona({ ...persona, simulateTypingDelay: e.target.checked })}
                className="accent-emerald-500 rounded-sm"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              يقوم بإظهار حالة "يكتب الآن... (typing)" على واتساب لفترة زمنية تتناسب مع طول الرسالة كإنسان طبيعي لتجنب الحظر الآلي.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#263140] bg-[#0b0f14]/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium transition-colors shadow-lg shadow-emerald-900/20"
          >
            <Save className="w-3.5 h-3.5" />
            <span>حفظ الإعدادات</span>
          </button>
        </div>
      </div>
    </div>
  );
}
