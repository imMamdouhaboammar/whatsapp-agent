import { useEffect, useState } from 'react';
import { CheckCircle2, Play, ShieldCheck, Bot, X } from 'lucide-react';
import type { AgentDecision } from '../api/types';
import { useLocale } from '../locale-context';
import { useModalDismiss } from '../hooks/useModalDismiss';

interface SimulationResult { decision?: AgentDecision }

interface SimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSimulate: (text: string, senderName?: string) => Promise<SimulationResult>;
}

export function SimulatorModal({ isOpen, onClose, onSimulate }: SimulatorModalProps) {
  const { language, tr } = useLocale();
  const [testText, setTestText] = useState('');
  const [senderName, setSenderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState('');

  useModalDismiss(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) {
      setResult(null);
      setError('');
      setTestText('');
      setSenderName('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const action = result?.decision?.action;
  const actionLabel = action === 'reply' ? tr('رد تلقائي', 'Auto reply')
    : action === 'draft' ? tr('مسودة للمراجعة', 'Draft for review')
    : action === 'human' ? tr('تسليم للفريق', 'Human handoff')
    : action === 'ignore' ? tr('بدون رد', 'No response')
    : tr('قرار المساعد', 'Assistant decision');
  const actionDetail = action === 'reply' ? tr('المساعد هيقدر يرد على رسالة بالشكل ده', 'The assistant would reply to a message like this')
    : action === 'draft' ? tr('المساعد هيجهّز مسودة لمراجعتها', 'The assistant would prepare a draft for review')
    : action === 'human' ? tr('المساعد هيسيب المحادثة للفريق', 'The assistant would hand the conversation to your team')
    : action === 'ignore' ? tr('المساعد مش هيرد على الرسالة دي', 'The assistant would leave this message unanswered')
    : tr('شوف كيف يتصرف المساعد مع الرسالة', 'See how the assistant handles the message');

  const handleRun = async () => {
    if (!testText.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await onSimulate(testText.trim(), senderName.trim() || undefined));
    } catch {
      setError(tr('تعذّر اختبار الرد، حاول تاني', 'Could not preview the response. Try again'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wa-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {/* react-doctor-disable-next-line react-doctor/prefer-html-dialog */}
      <section className="wa-modal wa-modal-medium" role="dialog" aria-modal="true" aria-labelledby="sim-title">
        <header className="wa-modal-header">
          <div className="wa-modal-heading">
            <span className="wa-modal-icon"><Bot size={20} /></span>
            <div>
              <h2 id="sim-title">{tr('معاينة رد المساعد', 'Assistant preview')}</h2>
              <p>{tr('شوف المساعد هيتصرف إزاي مع رسالة عميل', 'See how the assistant would handle a customer message')}</p>
            </div>
          </div>
          <button type="button" className="wa-icon-button" onClick={onClose} aria-label={tr('إغلاق', 'Close')}><X size={20} /></button>
        </header>
        <div className="wa-modal-content wa-sim-content">
          <p className="wa-sim-privacy"><ShieldCheck size={17} aria-hidden="true" /><span><strong>{tr('معاينة خاصة', 'Private preview')}</strong> {tr('مش بيبعت رسائل ولا بيحفظ محادثات', 'No messages are sent or saved')}</span></p>
          <label className="wa-field">
            <span>{tr('اسم العميل التجريبي', 'Test customer name')}</span>
            <input dir="auto" maxLength={120} value={senderName} onChange={(event) => setSenderName(event.target.value)} placeholder={language === 'ar' ? 'عميل تجريبي' : 'Test customer'} />
          </label>
          <label className="wa-field">
            <span>{tr('رسالة العميل', 'Customer message')}</span>
            <textarea dir="auto" rows={4} maxLength={4000} value={testText} onChange={(event) => setTestText(event.target.value)} placeholder={tr('مثال: الطلب هيوصل إمتى؟', 'Example: When will my order arrive?')} />
          </label>
          <button type="button" className="wa-primary-button wa-full-button" onClick={() => void handleRun()} disabled={loading || !testText.trim()}>
            <Play size={17} />{loading ? tr('جارٍ الاختبار', 'Testing') : tr('معاينة الرد', 'Preview response')}
          </button>
          {error && <p className="wa-inline-error" role="alert">{error}</p>}
          {result && (
            <section className="wa-sim-result" aria-live="polite">
              <div className="wa-sim-result-heading">
                <span><CheckCircle2 size={18} /> {tr('نتيجة المعاينة', 'Preview result')}</span>
                <strong dir="auto">{actionLabel}</strong>
              </div>
              <p className="wa-sim-outcome-detail">{actionDetail}</p>
              <div className="wa-sim-facts">
                <p><span>{tr('نوع الطلب', 'Intent')}</span><b dir="auto">{result.decision?.intent?.replaceAll('_', ' ') || tr('غير محدد', 'Unknown')}</b></p>
                {result.decision?.modelRouting && (
                  <p><span>{tr('توجيه النموذج', 'Model Routing')}</span><b dir="ltr">{result.decision.modelRouting.tier.toUpperCase()} &rarr; {result.decision.modelRouting.selectedModel} ({Math.round(result.decision.modelRouting.confidence * 100)}%, {result.decision.modelRouting.routerLatencyMs}ms)</b></p>
                )}
                {result.decision?.reasoning && <p><span>{tr('سبب القرار', 'Reason')}</span><span dir="auto">{result.decision.reasoning}</span></p>}
              </div>
              {result.decision?.replyText && <div className="wa-sim-reply"><span>{tr('الرد المتوقع', 'Expected reply')}</span><p dir="auto">{result.decision.replyText}</p></div>}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
