import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Play, Sparkles, X } from 'lucide-react';
import type { AgentDecision } from '../api/types';
import { useLocale } from '../locale-context';

interface SimulationResult {
  decision?: AgentDecision;
}

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

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRun = async () => {
    if (!testText.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await onSimulate(testText.trim(), senderName.trim() || undefined));
    } catch {
      setError(tr('تعذّر اختبار الرد. حاول مرة تانية', 'Could not test the response. Try again'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wa-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="wa-modal wa-modal-medium" role="dialog" aria-modal="true" aria-labelledby="sim-title">
        <header className="wa-modal-header">
          <div className="wa-modal-heading">
            <span className="wa-modal-icon"><Sparkles size={20} /></span>
            <div>
              <h2 id="sim-title">{tr('اختبار رد المساعد', 'Test assistant response')}</h2>
              <p>{tr('جرّب رسالة وشوف قرار المساعد', 'Preview how the assistant handles a message')}</p>
            </div>
          </div>
          <button type="button" className="wa-icon-button" onClick={onClose} aria-label={tr('إغلاق', 'Close')}><X size={20} /></button>
        </header>
        <div className="wa-modal-content wa-sim-content">
          <label className="wa-field">
            <span>{tr('اسم الشخص التجريبي', 'Test sender name')}</span>
            <input dir="auto" value={senderName} onChange={(event) => setSenderName(event.target.value)} placeholder={language === 'ar' ? 'عميل تجريبي' : 'Example contact'} />
          </label>
          <label className="wa-field">
            <span>{tr('الرسالة التجريبية', 'Test message')}</span>
            <textarea dir="auto" rows={4} value={testText} onChange={(event) => setTestText(event.target.value)} placeholder={tr('مثال: هل نقدر نحدد موعد بكرة؟', 'Example: Can we schedule a call tomorrow?')} />
          </label>
          <button type="button" className="wa-primary-button wa-full-button" onClick={() => void handleRun()} disabled={loading || !testText.trim()}><Play size={17} />{loading ? tr('جارٍ اختبار الرد', 'Testing response') : tr('اختبار الرد الآن', 'Run test')}</button>
          {error && <p className="wa-inline-error" role="alert">{error}</p>}
          {result && (
            <section className="wa-sim-result" aria-live="polite">
              <div className="wa-sim-result-heading">
                <span><CheckCircle2 size={18} /> {tr('قرار المساعد', 'AI decision')}</span>
                <strong dir="ltr">{result.decision?.action || 'N/A'}</strong>
              </div>
              <div className="wa-sim-facts">
                <p><span>{tr('الثقة', 'Confidence')}</span><b dir="ltr">{Math.round((result.decision?.confidence || 0) * 100)}%</b></p>
                <p><span>{tr('النية', 'Intent')}</span><b dir="auto">{result.decision?.intent || tr('غير محددة', 'Unknown')}</b></p>
                <p><span>{tr('سبب القرار', 'Reasoning')}</span><span dir="auto">{result.decision?.reasoning || tr('لا توجد تفاصيل', 'No details')}</span></p>
              </div>
              {result.decision?.replyText && <div className="wa-sim-reply"><span>{tr('الرد المقترح', 'Suggested reply')}</span><p dir="auto">{result.decision.replyText}</p></div>}
              <div className="wa-sim-latency"><Clock3 size={14} /> {tr('تأخير الكتابة المتوقع', 'Expected typing delay')}: <span dir="ltr">{result.decision?.simulatedDelayMs || 0} ms</span></div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

