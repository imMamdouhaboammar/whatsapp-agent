import { useState, type FormEvent } from 'react';
import { Layers, RefreshCw, Search } from 'lucide-react';
import { api } from '../api/client';
import type { ChatMessage, ContextBudgetStatus, ConversationFold } from '../api/types';
import { useLocale } from '../locale-context';
import { ToolDialog } from './ToolDialog';

export function ContextCompressionModal({ chatId, status, onRefresh, onClose }: {
  chatId: string;
  status: ContextBudgetStatus;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const { tr, language } = useLocale();
  const [compressing, setCompressing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<{ messages: ChatMessage[]; folds: ConversationFold[] } | null>(null);
  const [notice, setNotice] = useState('');
  const [foldError, setFoldError] = useState('');
  const [searchError, setSearchError] = useState('');
  const format = (value: number) => new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-US').format(value);
  const percent = status.targetContextBudget > 0 ? Math.min(100, Math.max(0, status.currentTokens / status.targetContextBudget * 100)) : 0;
  const tiers = [
    { name: tr('جلسات المحادثة', 'Sessions'), detail: tr('ملخصات الحديث الأخير', 'Recent conversation summaries'), count: status.tier1Count },
    { name: tr('محطات مهمة', 'Milestones'), detail: tr('ملخصات الجلسات المجمعة', 'Combined session summaries'), count: status.tier2Count },
    { name: tr('أرشيف طويل الأمد', 'Archive'), detail: tr('ملخصات الذاكرة التاريخية', 'Long-term historical summaries'), count: status.tier3Count },
  ];
  const refresh = async () => {
    setRefreshing(true); setFoldError('');
    try { await onRefresh(); }
    catch { setFoldError(tr('تعذّر تحديث حالة السياق. حاول مرة أخرى.', 'Could not refresh context. Try again.')); }
    finally { setRefreshing(false); }
  };
  const compress = async () => {
    if (compressing) return;
    setCompressing(true); setFoldError(''); setNotice('');
    try {
      await api.foldNow(chatId);
      setNotice(tr('تم طلب الضغط. يتم تنفيذه في الخلفية وقد لا توجد رسائل مؤهلة. حدّث الحالة لمتابعة النتيجة.', 'Compression requested. Processing is asynchronous and may find no eligible messages. Refresh status to check the result.'));
      await onRefresh();
    } catch { setFoldError(tr('تعذّر إكمال الطلب أو تحديث الحالة. حاول التحديث أولًا.', 'Could not complete the request or refresh status. Refresh before retrying.')); }
    finally { setCompressing(false); }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true); setSearchError(''); setResults(null);
    try { const response = await api.searchMemory(chatId, query.trim()); setResults(response.results); }
    catch { setSearchError(tr('تعذّر البحث في الذاكرة. حاول مرة أخرى.', 'Memory search failed. Try again.')); }
    finally { setSearching(false); }
  };
  return <ToolDialog title={tr('سياق المحادثة وذاكرتها', 'Context & memory')} description={tr('راقب استهلاك السياق واضغط المحادثات وابحث في الأرشيف.', 'Monitor the context budget, compress conversations and search archived memory.')} wide onClose={onClose} footer={<>
    <button type="button" className="wa-tool-button" disabled={refreshing || compressing} onClick={() => void refresh()}><RefreshCw size={16}/>{refreshing ? tr('جارٍ التحديث', 'Refreshing…') : tr('تحديث الحالة', 'Refresh status')}</button>
    <button type="button" className="wa-tool-button wa-tool-primary" disabled={compressing || refreshing} onClick={() => void compress()}><Layers size={17}/>{compressing ? tr('جارٍ الطلب', 'Requesting…') : tr('ضغط السياق الآن', 'Compress context')}</button>
  </>}>
    <div className="wa-context-budget">
      <div className="wa-context-budget-head"><h3>{tr('السياق المستخدم', 'Active token budget')}</h3><span className="wa-tool-note" dir="ltr">{format(Math.round(percent * 10) / 10)}%</span></div>
      <p className="wa-context-count"><strong>{format(status.currentTokens)}</strong> <span>/ {format(status.targetContextBudget)} {tr('توكن', 'tokens')}</span></p>
      <progress className={percent >= 90 ? 'wa-context-progress is-critical' : percent >= 75 ? 'wa-context-progress is-high' : 'wa-context-progress'} max={100} value={percent} aria-label={tr('استهلاك السياق', 'Context usage')}/>
      <p className="wa-tool-note">{status.nudgeDecision === 'strong' ? tr('يوصى بالضغط حسب قواعد الذاكرة.', 'Compression recommended by the memory policy.') : status.nudgeDecision === 'soft' ? tr('يمكن ضغط السياق عند توفر رسائل مؤهلة.', 'Compression may be useful when messages are eligible.') : tr('لا توجد توصية بالضغط الآن.', 'No compression recommendation right now.')}</p>
    </div>
    <dl className="wa-context-metrics"><div><dt>{tr('التوفير', 'Savings')}</dt><dd>{format(Math.round(status.compressionRatio * 100))}%</dd></div><div><dt>{tr('الملخصات', 'Folds')}</dt><dd>{format(status.activeFoldsCount)}</dd></div><div><dt>{tr('التوكنز الموفرة', 'Saved tokens')}</dt><dd>{format(status.tokensSaved)}</dd></div></dl>
    <section className="wa-tool-section"><h3>{tr('مستويات الذاكرة', 'Memory tiers')}</h3><ol className="wa-context-tiers">{tiers.map((tier, index) => <li key={tier.name}><span className="wa-tier-index">{index + 1}</span><div><strong>{tier.name}</strong><small>{tier.detail}</small></div><b>{format(tier.count)}</b></li>)}</ol></section>
    <section className="wa-tool-section"><h3>{tr('البحث في الذاكرة', 'Search memory')}</h3><form className="wa-tool-search" onSubmit={search}>
      <input aria-label={tr('كلمات البحث', 'Memory search query')} placeholder={tr('ابحث في الرسائل والملخصات', 'Search messages and summaries')} value={query} disabled={searching} onChange={e => { setQuery(e.target.value); setResults(null); setSearchError(''); }}/>
      <button type="submit" className="wa-tool-button" disabled={searching || !query.trim()}><Search size={16}/>{searching ? tr('جارٍ البحث', 'Searching…') : tr('بحث', 'Search')}</button>
    </form>
    {searchError && <p className="wa-tool-error" role="alert">{searchError}</p>}
    {results && <div className="wa-context-results" aria-live="polite">
      {results.folds.map(f => <article key={f.id}><strong>{f.topic}</strong><small>{tr('ملخص', 'Summary')} · {tr('المستوى', 'Tier')} {f.tier}</small><p dir="auto">{f.summary}</p></article>)}
      {results.messages.map(m => <article key={m.id}><strong>{m.isFromMe ? tr('أنت', 'You') : tr('العميل', 'Contact')}</strong><p dir="auto">{m.text}</p></article>)}
      {!results.folds.length && !results.messages.length && <p className="wa-tool-note">{tr('لا توجد نتائج مطابقة.', 'No matching results.')}</p>}
    </div>}</section>
    {notice && <output className="wa-tool-notice">{notice}</output>}
    {foldError && <p className="wa-tool-error" role="alert">{foldError}</p>}
  </ToolDialog>;
}
