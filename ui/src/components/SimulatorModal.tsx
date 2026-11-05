import { useState } from 'react';
import { X, Sparkles, CheckCircle2, Clock } from 'lucide-react';

interface SimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSimulate: (text: string, senderName?: string) => Promise<any>;
}

export function SimulatorModal({ isOpen, onClose, onSimulate }: SimulatorModalProps) {
  const [testText, setTestText] = useState('السلام عليكم، هو الكورس متاح حالياً وبكام؟');
  const [senderName, setSenderName] = useState('عميل تجريبي');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!isOpen) return null;

  const handleRun = async () => {
    if (!testText.trim() || loading) return;
    setLoading(true);
    try {
      const data = await onSimulate(testText, senderName);
      setResult(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl bg-[#131922] border border-[#263140] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#263140] bg-[#0b0f14]/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">محاكي اختبار الموديرتور</h2>
              <p className="text-xs text-slate-400">Test Gemini Moderator Responses</p>
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
        <div className="p-6 space-y-4 text-right">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">اسم الشخص التجريبي:</label>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="w-full px-3 py-2 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-100 focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">نص الرسالة الافتراضية:</label>
            <textarea
              rows={3}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="w-full p-3 bg-[#0b0f14] border border-[#263140] rounded-xl text-xs text-slate-100 focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleRun}
              disabled={loading || !testText.trim()}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors shadow-lg shadow-emerald-900/20"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>جاري التحليل والرد...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>اختبار الرد الآن</span>
                </>
              )}
            </button>
          </div>

          {/* Result Card */}
          {result && (
            <div className="mt-4 p-4 bg-[#0b0f14] border border-emerald-500/30 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#1c2430]">
                <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  قرار الموديرتور: {result.decision?.action?.toUpperCase()}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  ثقة: {Math.round((result.decision?.confidence ?? 0) * 100)}%
                </span>
              </div>

              <div className="text-xs text-slate-300">
                <span className="text-slate-400">النية المكتشفة: </span>
                <strong className="text-emerald-300">{result.decision?.intent}</strong>
              </div>

              <div className="text-xs text-slate-300">
                <span className="text-slate-400">التفسير المنطقي: </span>
                <span className="italic">{result.decision?.reasoning}</span>
              </div>

              {result.decision?.replyText && (
                <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-100 font-medium text-xs leading-relaxed">
                  <span className="block text-[10px] text-emerald-400/80 mb-1 font-bold">الرد البشري المقترح:</span>
                  "{result.decision.replyText}"
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  محاكاة وقت الكتابة: {result.decision?.simulatedDelayMs}ms
                </span>
                {result.decision?.suggestedReaction && (
                  <span>إيموجي مقترح: {result.decision.suggestedReaction}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
