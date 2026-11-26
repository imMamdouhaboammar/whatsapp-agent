import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Network, Play, RefreshCw } from 'lucide-react';
import { api, ApiError, type FunnelMethodMeta, type CircuitBreakerStatus, type FunnelDispatchResult, type FunnelMode } from '../api/client';
import { useLocale } from '../locale-context';
import { parseFunnelRequest } from './funnel-request';
import styles from './funnel-page.css?url';

const modeLabels: Record<FunnelMode, [string, string]> = {
  ALL_SETTLED: ['انتظار كل النتائج', 'All settled'],
  FIRST_SUCCESS: ['أول نتيجة ناجحة', 'First success'],
  QUORUM: ['حد أدنى من النتائج الناجحة', 'Quorum'],
};

function activeTargets(method: FunnelMethodMeta) {
  return method.targets.filter(target => target.enabled !== false);
}

function FunnelReceipt({ receipt, pending, error }: { receipt: FunnelDispatchResult | null; pending: boolean; error: string }) {
  const { tr } = useLocale();
  const cancelledCount = receipt?.results.filter(result => result.cancelled).length ?? 0;
  const partial = Boolean(receipt?.success && receipt.failedCount > cancelledCount);
  return <section className="wa-funnel-panel wa-funnel-response" aria-labelledby="funnel-receipt-title" aria-busy={pending}>
    <div className="wa-funnel-section-heading"><h2 id="funnel-receipt-title">{tr('نتائج التنفيذ', 'Execution receipt')}</h2>
      {receipt && <span className={partial ? 'wa-funnel-state is-warn' : receipt.success ? 'wa-funnel-state is-good' : 'wa-funnel-state is-bad'}>{receipt.success ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}
        {partial ? tr('نجاح جزئي', 'Partial success') : receipt.success ? tr('ناجح', 'Succeeded') : tr('غير ناجح', 'Failed')}</span>}
    </div>
    {error && <p className="wa-funnel-error" role="alert">{error}</p>}
    {pending ? <div className="wa-funnel-empty"><output>{tr('جارٍ انتظار نتائج الأهداف…', 'Waiting for target responses…')}</output></div> :
      receipt ? <div className="wa-funnel-receipt-body">
        <dl className="wa-funnel-metrics">
          <div><dt>{tr('المدة', 'Duration')}</dt><dd dir="ltr">{receipt.totalDurationMs} <small>ms</small></dd></div>
          <div><dt>{tr('ناجحة', 'Succeeded')}</dt><dd>{receipt.successfulCount}</dd></div>
          <div><dt>{tr('فشلت', 'Failed')}</dt><dd>{receipt.failedCount - cancelledCount}</dd></div>
        </dl>
        {cancelledCount > 0 && <p className="wa-funnel-note">{tr('طلبات أُلغيت بعد نجاح هدف آخر:', 'Cancelled after another target succeeded:')} {cancelledCount}</p>}
        <div className="wa-funnel-trace"><strong>{tr('المسار', 'Method')}</strong><code dir="ltr">{receipt.method}</code><strong>Trace ID</strong><code dir="ltr">{receipt.traceId}</code></div>
        {receipt.error && <p className="wa-funnel-error" role="alert" dir="auto">{receipt.error}</p>}
        {receipt.results.map(result => <details key={result.targetId} className="wa-funnel-result">
          <summary><span><strong dir="auto">{result.targetName}</strong>{receipt.winningTargetId === result.targetId && <small>{tr('النتيجة الفائزة', 'Winning target')}</small>}</span>
            <span className="wa-funnel-result-meta"><span className={result.cancelled ? 'wa-funnel-state is-warn' : result.success ? 'wa-funnel-state is-good' : 'wa-funnel-state is-bad'}>{result.cancelled ? tr('أُلغي', 'Cancelled') : result.statusCode}</span><code dir="ltr">{result.durationMs} ms</code></span></summary>
          {result.error && <p className={result.cancelled ? "wa-funnel-note" : "wa-funnel-error"} dir="auto">{result.error}</p>}
          {result.data !== undefined && <pre dir="ltr">{JSON.stringify(result.data, null, 2)}</pre>}
        </details>)}
        <details className="wa-funnel-raw"><summary>{tr('عرض JSON الكامل', 'Raw JSON receipt')}</summary><pre dir="ltr">{JSON.stringify(receipt, null, 2)}</pre></details>
      </div> : !error && <div className="wa-funnel-empty"><Network size={30}/><strong>{tr('لا توجد نتائج بعد', 'No request executed')}</strong><p>{tr('اختر مسارًا وأرسل طلبًا لمشاهدة نتيجة كل هدف.', 'Select a method and dispatch a request to inspect each target response.')}</p></div>}
  </section>;
}

function BreakerHealth({ stats, loading, available, disabled, onReset }: {
  stats: CircuitBreakerStatus[]; loading: boolean; available: boolean; disabled: boolean; onReset: (id: string) => Promise<void>;
}) {
  const { tr } = useLocale();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [resetDone, setResetDone] = useState(false);
  const reset = async (id: string) => {
    if (resetting) return;
    setResetting(id); setError(''); setResetDone(false);
    try { await onReset(id); setResetDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : tr('تعذّرت إعادة الضبط.', 'Reset failed.')); }
    finally { setResetting(null); setConfirmation(null); }
  };
  const label = (state: CircuitBreakerStatus['state']) => state === 'CLOSED' ? tr('مغلق · يسمح بالطلبات', 'Closed · accepting requests') : state === 'OPEN' ? tr('مفتوح · يرفض الطلبات', 'Open · blocking requests') : tr('نصف مفتوح · اختبار التعافي', 'Half-open · recovery probe');
  return <section className="wa-funnel-panel wa-funnel-health" aria-labelledby="funnel-health-title">
    <div className="wa-funnel-section-heading"><div><h2 id="funnel-health-title">{tr('حالة قواطع الدائرة', 'Target circuit breakers')}</h2><p>{tr('حالة الأهداف بعد آخر تحديث للبيانات.', 'Target health as of the last data refresh.')}</p></div><span className="wa-funnel-note">{stats.length} {tr('قاطع', 'tracked')}</span></div>
    {error && <p className="wa-funnel-error" role="alert">{error}</p>}
    {resetDone && <output className="wa-funnel-notice">{tr('تمت إعادة ضبط القاطع.', 'Circuit breaker reset.')}</output>}
    {!available ? <p className="wa-funnel-note">{loading ? tr('جارٍ التحميل…', 'Loading…') : tr('بيانات الحالة غير متاحة.', 'Health data unavailable.')}</p> : stats.length === 0 ? <p className="wa-funnel-note">{tr('لم تُسجل قواطع بعد. تظهر بعد أول طلب إلى هدف مهيأ.', 'No breakers tracked yet. They appear after the first request to a configured target.')}</p> :
      <section className="wa-funnel-table-wrap" aria-label={tr('جدول القواطع', 'Circuit breaker table')}><table className="wa-funnel-table"><thead><tr><th scope="col">{tr('الهدف', 'Target')}</th><th scope="col">{tr('الحالة', 'State')}</th><th scope="col">{tr('الطلبات', 'Calls')}</th><th scope="col">{tr('الإخفاقات', 'Failures')}</th><th scope="col">{tr('الإجراء', 'Action')}</th></tr></thead>
        <tbody>{stats.map(cb => <tr key={cb.targetId}><th scope="row"><code dir="ltr">{cb.targetId}</code></th><td><span className="wa-funnel-mobile-label">{tr('الحالة', 'State')}</span><span className={'wa-funnel-state ' + (cb.state === 'CLOSED' ? 'is-good' : cb.state === 'OPEN' ? 'is-bad' : 'is-warn')}>{label(cb.state)}</span>{cb.state === 'OPEN' && cb.cooldownRemainingMs !== undefined && <small className="wa-funnel-note">{Math.ceil(cb.cooldownRemainingMs / 1000)} s</small>}</td><td><span className="wa-funnel-mobile-label">{tr('الطلبات', 'Calls')}</span>{cb.totalCalls}</td><td><span className="wa-funnel-mobile-label">{tr('الإخفاقات', 'Failures')}</span>{cb.totalFailures}</td>
          <td className="wa-funnel-table-action">{cb.state !== 'CLOSED' && (confirmation === cb.targetId ? <div className="wa-funnel-confirm"><span>{tr('إعادة فتح الطلبات لهذا الهدف؟', 'Allow requests to this target again?')}</span><button type="button" className="wa-funnel-button is-danger" disabled={disabled || Boolean(resetting)} onClick={() => void reset(cb.targetId)}>{resetting ? tr('جارٍ الضبط…', 'Resetting…') : tr('تأكيد', 'Confirm reset')}</button><button type="button" className="wa-funnel-button" disabled={Boolean(resetting)} onClick={() => setConfirmation(null)}>{tr('إلغاء', 'Cancel')}</button></div> : <button type="button" className="wa-funnel-button" disabled={disabled || Boolean(resetting)} onClick={() => { setConfirmation(cb.targetId); setError(''); setResetDone(false); }}>{tr('إعادة ضبط', 'Reset breaker')}</button>)}</td></tr>)}</tbody></table></section>}
  </section>;
}

export function FunnelPage({ onClose }: { onClose: () => void }) {
  const { direction, tr } = useLocale();
  const [snapshot, setSnapshot] = useState<{ methods: FunnelMethodMeta[]; stats: CircuitBreakerStatus[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState('');
  const [payload, setPayload] = useState('');
  const [query, setQuery] = useState('');
  const [key, setKey] = useState('');
  const [requestError, setRequestError] = useState('');
  const [receipt, setReceipt] = useState<FunnelDispatchResult | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [resetting, setResetting] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (initial = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!initial) { setLoading(true); setLoadError(''); }
    try {
      const [methods, stats] = await Promise.all([api.getFunnelMethods(controller.signal), api.getFunnelStats(controller.signal)]);
      if (controller.signal.aborted) return;
      setSnapshot({ methods: methods.methods, stats: stats.circuitBreakers });
      setSelectedMethod(previous => methods.methods.some(m => m.method === previous) ? previous : methods.methods.find(m => activeTargets(m).length > 0)?.method ?? methods.methods[0]?.method ?? '');
      setUnavailable(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setUnavailable(err instanceof ApiError && err.status === 503);
      setLoadError(err instanceof Error ? err.message : 'Could not load funnel data');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initialize = async () => { await load(true); };
    void initialize();
    return () => requestRef.current?.abort();
  }, [load]);

  const methods = snapshot?.methods ?? [];
  const stats = snapshot?.stats ?? [];
  const selected = methods.find(m => m.method === selectedMethod);
  const targetCount = selected ? activeTargets(selected).length : 0;
  const busy = loading || dispatching || resetting;
  const canMutate = !busy && !loadError && Boolean(key.trim());
  const dispatch = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !targetCount || !canMutate) return;
    let request: ReturnType<typeof parseFunnelRequest>;
    try { request = parseFunnelRequest(payload, query); }
    catch { setRequestError(tr('أدخل JSON صالحًا على هيئة كائن. قيم معلمات الرابط يجب أن تكون نصية.', 'Enter valid JSON objects. Query parameter values must be strings.')); return; }
    setDispatching(true); setRequestError(''); setReceipt(null);
    try { setReceipt(await api.dispatchFunnel({ method: selected.method, ...request }, key)); await load(); }
    catch (err) { setRequestError(err instanceof ApiError && err.status === 401 ? tr('مفتاح Funnel API غير صالح أو غير مهيأ على الخادم.', 'Invalid or unconfigured Funnel API key.') : err instanceof Error ? err.message : tr('تعذّر تنفيذ الطلب.', 'Dispatch failed.')); }
    finally { setDispatching(false); }
  };
  const reset = async (id: string) => {
    if (!canMutate) throw new Error(tr('أدخل المفتاح وحدّث البيانات أولًا.', 'Enter the key and refresh data first.'));
    setResetting(true);
    try {
      const response = await api.resetCircuitBreaker(id, key);
      if (!response.success || response.targetId !== id) throw new Error(tr('القاطع غير موجود أو لم تتم إعادة ضبطه.', 'Breaker was not found or was not reset.'));
      await load();
    } finally { setResetting(false); }
  };
  return <main className="wa-funnel-page" dir={direction}>
    <link rel="stylesheet" href={styles} precedence="app"/>
    <div className="wa-funnel-inner">
      <header className="wa-funnel-header"><div><button type="button" className="wa-funnel-back" onClick={onClose}>{direction === 'rtl' ? <ArrowRight size={17}/> : <ArrowLeft size={17}/>} {tr('المحادثات', 'Chats')}</button>
        <h1>{tr('التوزيع المتوازي للطلبات', 'Scatter-Gather Funnel Engine')}</h1><p>{tr('نفّذ طلبًا عبر عدة أهداف، وافحص النتائج وحالة قواطع الدائرة.', 'Dispatch requests across multiple targets, inspect responses and manage circuit breakers.')}</p></div>
        <button type="button" className="wa-funnel-button" disabled={busy} onClick={() => void load()}><RefreshCw size={16}/>{loading ? tr('جارٍ التحديث…', 'Refreshing…') : tr('تحديث البيانات', 'Refresh')}</button></header>
      <div className="wa-funnel-overview">
        <span><strong>{snapshot ? methods.length : tr('غير متاح', 'N/A')}</strong>{tr('مسارات مسجلة', 'Registered methods')}</span>
        <span><strong>{snapshot ? methods.reduce((count, method) => count + activeTargets(method).length, 0) : tr('غير متاح', 'N/A')}</strong>{tr('أهداف مفعّلة', 'Enabled targets')}</span>
        <span><strong>{snapshot ? stats.filter(cb => cb.state === 'OPEN').length : tr('غير متاح', 'N/A')}</strong>{tr('قواطع مفتوحة', 'Open breakers')}</span>
      </div>
      {loadError && <p role="alert" className="wa-funnel-error">{unavailable ? tr('التوزيع المتوازي غير متاح.', 'Funnel engine is unavailable.') : tr('تعذّر تحميل البيانات. حدّث الصفحة لإعادة المحاولة.', 'Could not load funnel data. Refresh to retry.')} {snapshot && tr('البيانات المعروضة من آخر تحديث ناجح.', 'Showing last successful snapshot.')} <span dir="auto">{loadError}</span></p>}
      <section className="wa-funnel-panel wa-funnel-methods" aria-labelledby="funnel-methods-title">
        <div className="wa-funnel-section-heading"><div><h2 id="funnel-methods-title">{tr('المسارات المسجلة', 'Registered methods')}</h2><p>{tr('اختر المسار المطلوب لتنفيذ الطلب.', 'Select a route for your request.')}</p></div></div>
        {loading && !snapshot ? <output className="wa-funnel-note">{tr('جارٍ تحميل المسارات…', 'Loading methods…')}</output> : snapshot && !methods.length ? <p className="wa-funnel-note">{tr('لا توجد مسارات مسجلة.', 'No registered methods.')}</p> :
          <div className="wa-funnel-method-list">{methods.map(m => <button type="button" key={m.method} className="wa-funnel-method" aria-pressed={m.method === selectedMethod} disabled={busy} onClick={() => { setSelectedMethod(m.method); setReceipt(null); setRequestError(''); }}>
            <span className="wa-funnel-method-name"><code dir="ltr">{m.method}</code><small dir="auto">{m.description}</small></span><span>{tr(...modeLabels[m.mode])}</span><span className="wa-funnel-method-count"><strong>{activeTargets(m).length}/{m.targets.length}</strong><small>{tr('أهداف مفعّلة', 'Enabled targets')}</small></span><code dir="ltr">{m.timeoutMs} ms</code></button>)}</div>}
      </section>
      <div className="wa-funnel-workspace">
        <section className="wa-funnel-panel" aria-labelledby="funnel-request-title">
          <div className="wa-funnel-section-heading"><h2 id="funnel-request-title">{tr('إعداد الطلب', 'Request')}</h2>{selected && <code dir="ltr" className="wa-funnel-selected">{selected.method}</code>}</div>
          <form className="wa-funnel-form" onSubmit={dispatch}>
            <label className="wa-funnel-field" htmlFor="funnel-key">{tr('مفتاح Funnel API', 'Funnel API key')}<input id="funnel-key" type="password" autoComplete="off" dir="ltr" value={key} disabled={dispatching || resetting} onChange={e => setKey(e.target.value)} placeholder={tr('أدخل مفتاح الخادم', 'Enter server key')}/></label>
            <p className="wa-funnel-note">{tr('يُستخدم للتنفيذ وإعادة الضبط ولا يحفظه التطبيق في التخزين المحلي.', 'Used for dispatch and reset. Not persisted by the app.')}</p>
            {selected && <div className="wa-funnel-targets"><strong>{tr('الأهداف', 'Targets')} ({targetCount})</strong>{selected.targets.length ? selected.targets.map(target => <div key={target.id}><code dir="ltr">{target.id}</code><span className="wa-funnel-note">{target.enabled === false ? tr('معطّل', 'Disabled') : target.method ?? tr('تلقائي', 'Auto')}</span></div>) : <p className="wa-funnel-note">{tr('لا توجد أهداف مهيأة لهذا المسار.', 'No targets configured for this method.')}</p>}{selected.mode === 'QUORUM' && <p className="wa-funnel-note">{tr('الحد الأدنى للنجاح:', 'Required successes:')} {selected.quorumCount ?? Math.floor(targetCount / 2) + 1}</p>}</div>}
            <label className="wa-funnel-field" htmlFor="funnel-payload">{tr('محتوى الطلب (JSON)', 'Request body (JSON)')}<textarea id="funnel-payload" dir="ltr" rows={6} spellCheck={false} placeholder={'{\n  "sku": "SKU-42"\n}'} value={payload} disabled={busy} onChange={e => { setPayload(e.target.value); setRequestError(''); }}/></label>
            <p className="wa-funnel-note">{tr('اترك المحتوى فارغًا لإرسال طلب دون body. طريقة HTTP تتبع إعداد الهدف.', 'Leave blank to omit the body. The HTTP method follows the target configuration.')}</p>
            <details className="wa-funnel-query"><summary>{tr('معلمات الرابط (اختياري)', 'Query parameters (optional)')}</summary><label className="wa-funnel-field" htmlFor="funnel-query">{tr('معلمات JSON نصية', 'JSON string parameters')}<textarea id="funnel-query" dir="ltr" rows={3} spellCheck={false} value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setRequestError(''); }}/></label></details>
            <div className="wa-funnel-request-footer"><p className="wa-funnel-note">{tr('التنفيذ يرسل طلبات فعلية إلى الأهداف المهيأة وقد ينفّذ إجراءات خارجية.', 'Dispatch sends real requests to configured targets and may trigger external actions.')}</p>
              <button type="submit" className="wa-funnel-button is-primary" disabled={!canMutate || !selected || targetCount === 0}><Play size={16}/>{dispatching ? tr('جارٍ التنفيذ…', 'Dispatching…') : tr('تنفيذ الطلب', 'Dispatch request')}</button></div>
            {selected && targetCount === 0 && <p className="wa-funnel-note">{tr('يجب تهيئة هدف واحد على الأقل قبل التنفيذ.', 'Configure at least one enabled target before dispatching.')}</p>}
          </form>
        </section>
        <FunnelReceipt receipt={receipt} pending={dispatching} error={requestError}/>
      </div>
      <BreakerHealth stats={stats} available={Boolean(snapshot)} loading={loading} disabled={!canMutate} onReset={reset}/>
    </div>
  </main>;
}
