import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, ChevronRight, Play, RefreshCw, ShieldAlert, Zap } from 'lucide-react';
import { api } from '../api/client';
import { useLocale } from '../locale-context';

export function FunnelPage({ onClose }: { onClose: () => void }) {
  const { direction, tr } = useLocale();
  const [methods, setMethods] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const [dispatchPayload, setDispatchPayload] = useState('{\n  "sku": "SKU-42"\n}');
  const [lastReceipt, setLastReceipt] = useState<any | null>(null);
  const [dispatching, setDispatching] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [mRes, sRes] = await Promise.all([
        api.getFunnelMethods().catch(() => ({ methods: [] })),
        api.getFunnelStats().catch(() => ({ circuitBreakers: [] }))
      ]);
      setMethods(mRes.methods || []);
      setStats(sRes.circuitBreakers || []);
      setSelectedMethod((prev) => (mRes.methods?.length > 0 && !prev ? mRes.methods[0].method : prev));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDispatch = async () => {
    if (!selectedMethod) return;
    setDispatching(true);
    setLastReceipt(null);
    try {
      let parsedPayload: any = undefined;
      if (dispatchPayload.trim()) {
        try {
          parsedPayload = JSON.parse(dispatchPayload);
        } catch {
          parsedPayload = { raw: dispatchPayload };
        }
      }
      const receipt = await api.dispatchFunnel({
        method: selectedMethod,
        payload: parsedPayload
      });
      setLastReceipt(receipt);
      void loadData();
    } catch (err: any) {
      setLastReceipt({ error: err.message, success: false });
    } finally {
      setDispatching(false);
    }
  };

  const handleResetCb = async (targetId: string) => {
    await api.resetCircuitBreaker(targetId);
    void loadData();
  };

  return (
    <div className="wa-settings-page" dir={direction}>
      <header className="wa-settings-header">
        <button
          type="button"
          className="wa-settings-back"
          onClick={onClose}
          aria-label={tr('العودة للمحادثات', 'Back to chats')}
        >
          {direction === 'rtl' ? <ChevronRight size={20} /> : <ArrowRight size={20} />}
          <span>{tr('المحادثات', 'Chats')}</span>
        </button>
        <div className="wa-settings-title-group">
          <h1>{tr('محرك التوزيع المتوازي (Funnel Engine)', 'Scatter-Gather Funnel Engine')}</h1>
          <p>{tr('محرك توجيه وحماية استدعاءات الـ APIs الخارجية، النماذج، والـ Webhooks', 'High-throughput scatter-gather & hedged request dispatcher for AI and external systems')}</p>
        </div>
        <button
          type="button"
          className="wa-icon-button"
          onClick={loadData}
          disabled={loading}
          title={tr('تحديث البيانات', 'Refresh data')}
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <main className="wa-settings-content">
        <section className="wa-settings-section">
          <h2>
            <Activity size={18} />
            <span>{tr('قواطع الدائرة (Circuit Breakers)', 'Target Circuit Breakers')}</span>
          </h2>
          <div className="wa-brand-overview-grid" style={{ marginTop: '0.75rem' }}>
            {stats.length === 0 ? (
              <div className="wa-brand-empty">
                <p>{tr('لا توجد قواطع دائرة نشطة حالياً. القواطع تعمل تلقائياً عند أول استدعاء للهدف.', 'No active circuit breakers yet. They initialize automatically upon first dispatch.')}</p>
              </div>
            ) : (
              stats.map((cb) => (
                <div key={cb.targetId} className="wa-brand-source-card">
                  <div className="wa-source-meta">
                    <span className="wa-source-kind">TARGET</span>
                    <strong className="wa-source-title">{cb.targetId}</strong>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: cb.state === 'CLOSED' ? '#10b98120' : cb.state === 'OPEN' ? '#ef444420' : '#f59e0b20',
                        color: cb.state === 'CLOSED' ? '#10b981' : cb.state === 'OPEN' ? '#ef4444' : '#f59e0b'
                      }}
                    >
                      {cb.state}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '6px', color: '#64748b' }}>
                    <span>{tr('إجمالي العمليات: ', 'Total calls: ')}{cb.totalCalls}</span> | <span>{tr('الإخفاقات: ', 'Failures: ')}{cb.totalFailures}</span>
                  </div>
                  {cb.state === 'OPEN' && (
                    <button
                      type="button"
                      className="wa-brand-button-secondary"
                      style={{ marginTop: '8px', padding: '4px 10px', fontSize: '11px' }}
                      onClick={() => handleResetCb(cb.targetId)}
                    >
                      <RefreshCw size={12} />
                      <span>{tr('إعادة ضبط القاطع', 'Reset Breaker')}</span>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="wa-settings-section">
          <h2>
            <Zap size={18} />
            <span>{tr('مسارات التوزيع المسجلة (Registered Methods)', 'Registered Methods')}</span>
          </h2>
          <div className="wa-brand-overview-grid" style={{ marginTop: '0.75rem' }}>
            {methods.map((m) => (
              <div key={m.method} className="wa-brand-source-card">
                <div className="wa-source-meta">
                  <span className="wa-source-kind">{m.mode}</span>
                  <strong className="wa-source-title">{m.method}</strong>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{m.description}</span>
                </div>
                <div style={{ fontSize: '12px', marginTop: '6px' }}>
                  <span>{tr('الأهداف: ', 'Targets: ')}{m.targets?.length || 0}</span> | <span>{tr('المهلة: ', 'Timeout: ')}{m.timeoutMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="wa-settings-section">
          <h2>
            <Play size={18} />
            <span>{tr('منصة الاختبار المباشر (Interactive Dispatch Sandbox)', 'Interactive Dispatch Sandbox')}</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
            <div>
              <label htmlFor="funnel-method-select" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                {tr('اختر المسار:', 'Select Method:')}
              </label>
              <select
                id="funnel-method-select"
                value={selectedMethod}
                onChange={(e) => setSelectedMethod(e.target.value)}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', maxWidth: '320px' }}
              >
                {methods.map((m) => (
                  <option key={m.method} value={m.method}>{m.method} ({m.mode})</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="funnel-payload-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                {tr('حمولة الـ JSON (Payload):', 'JSON Payload:')}
              </label>
              <textarea
                id="funnel-payload-input"
                rows={4}
                value={dispatchPayload}
                onChange={(e) => setDispatchPayload(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '12px', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', maxWidth: '480px' }}
              />
            </div>

            <div>
              <button
                type="button"
                className="wa-brand-button-primary"
                onClick={handleDispatch}
                disabled={dispatching || !selectedMethod}
              >
                <Play size={14} />
                <span>{dispatching ? tr('جارٍ الإرسال...', 'Dispatching...') : tr('تنفيذ التوزيع المتوازي', 'Execute Scatter-Gather')}</span>
              </button>
            </div>

            {lastReceipt && (
              <div style={{ marginTop: '1rem', background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px', overflowX: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  {lastReceipt.success ? <CheckCircle2 size={16} color="#10b981" /> : <ShieldAlert size={16} color="#ef4444" />}
                  <strong>{tr('إيصال التنفيذ (Execution Receipt):', 'Execution Receipt:')}</strong>
                </div>
                <pre style={{ margin: 0 }}>{JSON.stringify(lastReceipt, null, 2)}</pre>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
