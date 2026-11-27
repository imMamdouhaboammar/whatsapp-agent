import { useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, Link2, MessageSquare, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { ApiError, brandBrainApi, type BrandScope, type BrandSourceInput } from '../api/client';
import { useLocale } from '../locale-context';
import brandBrainCss from '../brand-brain.css?url';

type Snapshot = Awaited<ReturnType<typeof brandBrainApi.load>>;
type Source = Snapshot['sources'][number];
type Retrieval = Awaited<ReturnType<typeof brandBrainApi.retrieve>>;
type Resolution = Awaited<ReturnType<typeof brandBrainApi.simulate>>;
type View = 'sources' | 'integrations' | 'test';
const emptySource: BrandSourceInput = { type: 'faq', authority: 'official', locator: '', content: '' };

function errorMessage(error: unknown, tr: (ar: string, en: string) => string) {
  if (error instanceof ApiError && error.status === 401) return tr('رمز وصول المالك غير صالح.', 'Invalid owner access token.');
  if (error instanceof ApiError && error.status === 503) return tr('الخدمة غير متاحة أو لم تُهيأ على الخادم.', 'Service unavailable or not configured on the server.');
  return error instanceof Error ? error.message : tr('تعذر إكمال الطلب.', 'Unable to complete request.');
}

function SourceEditor({ input, onChange, onSubmit, onCancel, busy, stale, replacing }: {
  input: BrandSourceInput; onChange: (input: BrandSourceInput) => void; onSubmit: (event: FormEvent) => void;
  onCancel: () => void; busy: boolean; stale: boolean; replacing: boolean;
}) {
  const { tr } = useLocale();
  return <form className="bb-editor" onSubmit={onSubmit} aria-labelledby="bb-editor-title">
    <div className="bb-section-head"><div><h3 id="bb-editor-title">{replacing ? tr('استبدال محتوى المصدر', 'Replace source content') : tr('إضافة مصدر', 'Add knowledge source')}</h3>
      <p>{replacing ? tr('أدخل المحتوى الكامل الجديد. يُحتفظ بالإصدارات السابقة.', 'Enter the full replacement content. Previous versions are retained.') : tr('يُحدّث المصدر الحالي إذا تطابق الاسم والنوع.', 'The same name and type update an existing source.')}</p></div></div>
    <fieldset disabled={busy}>
      <div className="bb-form-row">
        <label>{tr('نوع المصدر', 'Source type')}<select aria-label={tr('نوع المصدر', 'Source type')} disabled={replacing} value={input.type} onChange={e => { const type = e.target.value; if (type === 'faq' || type === 'text' || type === 'csv') onChange({...input,type}); }}><option value="faq">FAQ</option><option value="text">{tr('نص', 'Text')}</option><option value="csv">CSV</option></select></label>
        <label>{tr('درجة الاعتماد', 'Authority')}<select aria-label={tr('درجة الاعتماد', 'Authority')} value={input.authority} onChange={e => { const authority = e.target.value; if (authority === 'official' || authority === 'working' || authority === 'external') onChange({...input,authority}); }}><option value="official">{tr('رسمي', 'Official')}</option><option value="working">{tr('مسودة', 'Working')}</option><option value="external">{tr('مرجع خارجي', 'External')}</option></select></label>
      </div>
      <label>{tr('اسم أو عنوان المصدر', 'Source name or reference')}<input required maxLength={256} readOnly={replacing} value={input.locator} onChange={e => onChange({...input,locator:e.target.value})} placeholder={tr('سياسة الشحن', 'Shipping policy')}/></label>
      <label>{tr('محتوى المعرفة', 'Knowledge content')}<textarea required rows={7} dir="auto" value={input.content} onChange={e => onChange({...input,content:e.target.value})} placeholder={tr('أضف السياسة أو الأسئلة والإجابات هنا', 'Paste policy text or questions and answers')}/></label>
      <p className="bb-muted">{tr('الحد الأقصى 1 ميجابايت. لا تضف كلمات مرور أو بيانات عملاء حساسة.', 'Maximum 1 MB. Do not include passwords or sensitive customer data.')}</p>
      <div className="bb-actions"><button className="bb-button bb-primary" type="submit" disabled={stale || !input.locator.trim() || !input.content.trim()}>{busy ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ المصدر', 'Save source')}</button><button className="bb-button" type="button" onClick={onCancel}>{tr('إلغاء', 'Cancel')}</button></div>
    </fieldset>
  </form>;
}

function BrandWorkspace({ scope, initial, onSwitch }: { scope: BrandScope; initial: Snapshot; onSwitch: () => void }) {
  const { tr, language } = useLocale();
  const [snapshot, setSnapshot] = useState(initial);
  const [view, setView] = useState<View>('sources');
  const [editor, setEditor] = useState<BrandSourceInput | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [filter, setFilter] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState('');
  const [gid, setGid] = useState('');
  const [question, setQuestion] = useState('');
  const [goal, setGoal] = useState('');
  const [retrieval, setRetrieval] = useState<Retrieval | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (err) { setError(errorMessage(err, tr)); }
    finally { lock.current = false; setBusy(false); }
  };
  const refresh = async () => {
    try { setSnapshot(await brandBrainApi.load(scope)); setStale(false); setRetrieval(null); setResolution(null); }
    catch (err) { setStale(true); throw err; }
  };
  const invalidateTests = () => { setRetrieval(null); setResolution(null); };
  const refreshAfterWrite = async () => { invalidateTests(); await refresh(); };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!editor || stale) return;
    const input = {...editor,locator: replacing ? editor.locator : editor.locator.trim()};
    void run(async () => {
      if (new TextEncoder().encode(input.content).byteLength > 1024 * 1024) throw new Error(tr('المحتوى يتجاوز 1 ميجابايت.', 'Content exceeds 1 MB.'));
      const result = await brandBrainApi.save(scope,input);
      setEditor(null); setReplacing(false);
      setNotice(result.changed ? tr('تم حفظ إصدار جديد.', 'New source version saved.') : tr('المصدر مطابق للإصدار الحالي.', 'Source unchanged.'));
      await refreshAfterWrite();
    });
  };
  const retire = (source: Source) => void run(async () => {
    if (stale) return;
    const result = await brandBrainApi.retire(scope,source.sourceId);
    if (!result.retired || result.sourceId !== source.sourceId) throw new Error(tr('لم تتم إزالة المصدر.', 'Source was not retired.'));
    setConfirm(null); setNotice(tr('تم استبعاد المصدر من البحث.', 'Source retired from retrieval.'));
    await refreshAfterWrite();
  });
  const connect = (e: FormEvent) => {
    e.preventDefault();
    if (stale) return;
    void run(async () => {
      const result = await brandBrainApi.connect(scope,sheetId.trim(),gid.trim() || undefined);
      if (!result.connected || result.brandId !== scope.brandId || result.tool !== 'inventory.lookup') throw new Error(tr('لم يتم تسجيل الموصل.', 'Connector was not registered.'));
      setSheetId(''); setGid('');
      setNotice(tr('تم تسجيل الإعداد. اختبر SKU للتحقق من الوصول إلى الجدول.', 'Configuration saved. Test a SKU to verify sheet access.'));
      await refreshAfterWrite();
    });
  };
  const search = (e: FormEvent) => {
    e.preventDefault(); setRetrieval(null);
    void run(async () => { setRetrieval(await brandBrainApi.retrieve(scope,question.trim())); });
  };
  const simulate = (e: FormEvent) => {
    e.preventDefault(); setResolution(null);
    void run(async () => { setResolution(await brandBrainApi.simulate(scope,goal.trim())); });
  };
  const sourceName = (id: string) => snapshot.sources.find(source => source.sourceId === id)?.locator ?? id;
  const authorityName = (authority: Source['authority']) => authority === 'official' ? tr('رسمي','Official') : authority === 'working' ? tr('مسودة','Working') : tr('خارجي','External');
  const formatDate = (timestamp: number) => new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en', {dateStyle:'medium',timeStyle:'short'}).format(timestamp);
  const visible = snapshot.sources.filter(source => source.locator.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const inventory = snapshot.tools.some(tool => tool.name === 'inventory.lookup' && tool.kind === 'read');
  const views: Array<{id: View; label: string; icon: typeof BookOpen}> = [
    {id:'sources',label:tr('مصادر المعرفة','Knowledge sources'),icon:BookOpen},
    {id:'integrations',label:tr('التكاملات','Integrations'),icon:Link2},
    {id:'test',label:tr('البحث والمحاكاة','Search & simulation'),icon:MessageSquare},
  ];
  return <>
    <div className="bb-scope"><div><ShieldCheck size={19}/><span><strong>{tr('العلامة المفتوحة','Workspace brand')}</strong><code dir="ltr">{scope.brandId}</code></span></div>
      <div className="bb-actions"><button className="bb-button" type="button" disabled={busy} onClick={() => void run(refresh)}><RefreshCw size={16}/>{busy ? tr('جارٍ العمل…','Working…') : tr('تحديث','Refresh')}</button><button className="bb-button" type="button" disabled={busy} onClick={onSwitch}>{tr('تغيير العلامة','Switch brand')}</button></div></div>
    <nav className="bb-nav" aria-label={tr('أقسام Brand Brain','Brand Brain sections')}>{views.map(({id,label,icon:Icon}) => <button key={id} type="button" disabled={busy} aria-pressed={view===id} onClick={() => {setView(id);setError('');setNotice('');}}><Icon size={17}/>{label}</button>)}</nav>
    {error && <p className="bb-error" role="alert" dir="auto">{error}</p>}
    {notice && <output className="bb-success">{notice}</output>}
    {stale && <p className="bb-error" role="alert">{tr('البيانات المعروضة من آخر تحديث ناجح. حدّث قبل إجراء تغييرات أخرى.', 'Showing the last successful snapshot. Refresh before making more changes.')}</p>}
    {view === 'sources' && <section className="bb-panel" aria-labelledby="bb-sources-title" aria-busy={busy}>
      <div className="bb-section-head"><div><h2 id="bb-sources-title">{tr('مصادر المعرفة','Knowledge sources')} <span className="bb-count">{snapshot.sources.length}</span></h2><p>{tr('راجع المعرفة الحالية وأضف أو استبدل المصادر التي يعتمد عليها الوكيل.', 'Review the knowledge library and add or replace sources available to the agent.')}</p></div><button className="bb-button bb-primary" type="button" disabled={busy || stale || editor !== null} onClick={() => {setReplacing(false);setEditor({...emptySource});}}><Plus size={17}/>{tr('إضافة مصدر','Add source')}</button></div>
      {snapshot.conflicts.length > 0 && <section className="bb-conflicts" aria-labelledby="bb-conflicts-title"><h3 id="bb-conflicts-title">{tr('تعارض في سياسة الإرجاع','Return policy conflict')}</h3>{snapshot.conflicts.map(conflict => <div key={conflict.field}><p>{tr('مدد مختلفة للإرجاع بالأيام:', 'Conflicting return periods in days:')} <bdi>{conflict.values.join(' / ')}</bdi></p><ul>{conflict.sourceIds.map(id => <li key={id} dir="auto">{sourceName(id)}</li>)}</ul></div>)}<p>{tr('استبدل المحتوى أو استبعد المصدر القديم قبل الاعتماد على هذه السياسة.', 'Replace the content or retire an outdated source before relying on this policy.')}</p></section>}
      {editor && <SourceEditor input={editor} replacing={replacing} busy={busy} stale={stale} onChange={setEditor} onSubmit={save} onCancel={() => {setEditor(null);setReplacing(false);}}/>}
      <label className="bb-filter">{tr('البحث باسم المصدر','Find a source')}<span><Search size={17}/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder={tr('ابحث في المصادر','Search sources')}/></span></label>
      {visible.length === 0 ? <div className="bb-empty"><BookOpen size={26}/><strong>{snapshot.sources.length ? tr('لا توجد نتائج مطابقة','No matching sources') : tr('لم تضف مصادر بعد','No sources yet')}</strong><p>{snapshot.sources.length ? tr('جرّب اسمًا آخر.','Try another source name.') : tr('أضف سياسة أو أسئلة شائعة لتصبح متاحة في البحث.','Add a policy or FAQ to make it available for retrieval.')}</p></div> :
        <div className="bb-library">{visible.map(source => <article className="bb-source" key={source.sourceId}>
          <div className="bb-source-main"><strong dir="auto">{source.locator}</strong><span className="bb-muted"><bdi>{source.type.toUpperCase()}</bdi> · {authorityName(source.authority)}</span></div>
          <div className="bb-source-meta"><span>{tr('آخر إصدار','Last version')} <bdi>{formatDate(source.lastChecked)}</bdi></span><span>{tr('الإصدار','Version')} <code dir="ltr" title={source.versionId}>{source.versionId.slice(0,8)}</code></span></div>
          <div className="bb-actions"><button type="button" className="bb-button" disabled={busy || stale || editor !== null} onClick={() => {setReplacing(true);setEditor({type:source.type,authority:source.authority,locator:source.locator,content:''});}}>{tr('استبدال','Replace')}</button><button type="button" className="bb-button bb-quiet-danger" disabled={busy || stale} onClick={() => setConfirm(source.sourceId)}>{tr('استبعاد','Retire')}</button></div>
          {confirm === source.sourceId && <div className="bb-confirm"><span>{tr('سيُستبعد المصدر من النتائج مع الاحتفاظ بسجل الإصدارات. هل تؤكد؟','Remove this source from retrieval while retaining its version history?')}</span><div className="bb-actions"><button className="bb-button bb-quiet-danger" disabled={busy || stale} type="button" onClick={() => retire(source)}>{tr('تأكيد الاستبعاد','Confirm retirement')}</button><button className="bb-button" type="button" disabled={busy} onClick={() => setConfirm(null)}>{tr('إلغاء','Cancel')}</button></div></div>}
        </article>)}</div>}
    </section>}
    {view === 'integrations' && <section className="bb-panel" aria-labelledby="bb-integrations-title" aria-busy={busy}>
      <div className="bb-section-head"><div><h2 id="bb-integrations-title">{tr('ربط المخزون','Inventory connector')}</h2><p>{tr('مصدر مباشر لقراءة كمية المنتج وسعره عند البحث برقم SKU.','Read product quantity and price by exact SKU.')}</p></div><span className="bb-status">{inventory ? tr('الإعداد مسجل','Configured') : tr('غير مهيأ','Not configured')}</span></div>
      <div className="bb-two-col"><form className="bb-form" onSubmit={connect}><h3>Google Sheets</h3><p>{tr('يجب أن يكون تصدير CSV متاحًا للقراءة. الأعمدة المطلوبة: sku، stock، price. ويمكن إضافة currency وname.','CSV export must be readable. Required columns: sku, stock, price. Optional: currency and name.')}</p><p className="bb-muted">{tr('لا تنشر بيانات عملاء خاصة. تسجيل الإعداد لا يثبت الوصول للجدول.','Never publish private customer data. Saving the configuration does not verify access.')}</p><fieldset disabled={busy || stale}><label>Google Sheets ID<input required minLength={8} maxLength={160} pattern="[A-Za-z0-9_\-]+" dir="ltr" value={sheetId} onChange={e=>setSheetId(e.target.value)} placeholder="1AbCdEf..."/></label><label>{tr('معرف ورقة العمل (اختياري)','Worksheet GID (optional)')}<input pattern="[0-9]{1,15}" inputMode="numeric" maxLength={15} dir="ltr" value={gid} onChange={e=>setGid(e.target.value)} placeholder="0"/></label><button className="bb-button bb-primary" type="submit" disabled={!sheetId.trim()}>{inventory ? tr('تحديث الإعداد','Update configuration') : tr('ربط الجدول','Connect sheet')}</button></fieldset></form>
        <div className="bb-tools"><h3>{tr('الأدوات المسجلة','Registered tools')} <span className="bb-count">{snapshot.tools.length}</span></h3>{snapshot.tools.length ? snapshot.tools.map(tool => <div className="bb-tool" key={tool.name}><code dir="ltr">{tool.name}</code><span>{tool.kind==='read' ? tr('قراءة','Read') : tr('كتابة','Write')}</span><small dir="ltr">{tool.scope}</small></div>) : <p>{tr('لا توجد أدوات مسجلة لهذه العلامة.','No tools registered for this brand.')}</p>}<button className="bb-button" type="button" disabled={busy} onClick={()=>setView('test')}>{tr('انتقل إلى اختبار SKU','Go to SKU test')}</button></div></div>
    </section>}
    {view === 'test' && <section className="bb-panel" aria-labelledby="bb-test-title" aria-busy={busy}>
      <div className="bb-section-head"><div><h2 id="bb-test-title">{tr('البحث والمحاكاة','Search & simulation')}</h2><p>{tr('افحص الأدلة أولًا، ثم جرّب رد الوكيل دون إرسال رسالة واتساب.','Inspect retrieved evidence, then test a Brand Brain resolution without sending WhatsApp.')}</p></div></div>
      <div className="bb-two-col"><div className="bb-form"><h3>{tr('بحث الأدلة','Evidence search')}</h3><form className="bb-form" onSubmit={search}><label>{tr('سؤال البحث','Search question')}<textarea required rows={3} maxLength={2000} dir="auto" value={question} onChange={e=>{setQuestion(e.target.value);setRetrieval(null);}} disabled={busy || stale}/></label><button className="bb-button bb-primary" disabled={busy || stale || !question.trim()} type="submit">{tr('بحث','Search')}</button></form>
      {retrieval ? <div className="bb-result"><strong>{retrieval.answerability==='supported' ? tr('أدلة متاحة','Evidence found') : tr('أدلة غير كافية','Insufficient evidence')}</strong><p className="bb-muted">{tr('نتائج البحث وليست درجة ثقة في صحة الرد.','Retrieval results, not a confidence score for reply correctness.')}</p>{retrieval.evidence.map(item=><article key={JSON.stringify([item.sourceId,item.versionId,item.location])}><strong dir="auto">{sourceName(item.sourceId)}</strong><p dir="auto">{item.text}</p><span className="bb-muted">{authorityName(item.authority)} · <bdi>{item.location}</bdi> · <code dir="ltr">{item.versionId.slice(0,8)}</code></span></article>)}</div> : <p className="bb-empty-small">{tr('ستظهر المصادر والنصوص المطابقة هنا.','Matching sources and excerpts appear here.')}</p>}</div>
      <div className="bb-form"><h3>{tr('محاكاة الوكيل','Agent dry-run')}</h3><form className="bb-form" onSubmit={simulate}><label>{tr('طلب العميل التجريبي','Sample customer request')}<textarea required rows={3} maxLength={2000} dir="auto" value={goal} onChange={e=>{setGoal(e.target.value);setResolution(null);}} placeholder={tr('هل SKU-42 موجود؟','Is SKU-42 available?')} disabled={busy || stale}/></label><button className="bb-button bb-primary" disabled={busy || stale || !goal.trim()} type="submit">{tr('جرّب بدون إرسال','Test without sending')}</button></form><p className="bb-muted">{tr('تستخدم المحاكاة أدوات القراءة وقد تتصل بمصادر خارجية وتسجل التنفيذ. لا تحاكي مسار المحادثات الحية بالكامل ولا ترسل واتساب.','The dry-run may query configured read tools or external sources and records a workflow. It does not reproduce the full live conversation pipeline or send WhatsApp.')}</p>
      {resolution ? <div className="bb-result"><output className="bb-status">{resolution.status==='answered' ? tr('تمت الإجابة','Answered') : resolution.status==='clarification' ? tr('يحتاج توضيحًا','Needs clarification') : tr('بانتظار المزود','Waiting for provider')}</output><p className="bb-reply" dir="auto">{resolution.reply}</p><h4>{tr('الأدلة المستخدمة','Evidence used')}</h4>{resolution.evidence.length ? resolution.evidence.map((item,index)=><article key={JSON.stringify([item.kind,item.source,item.versionId,index])}><strong>{item.kind==='brand' ? tr('معرفة العلامة','Brand knowledge') : item.kind==='provider' ? tr('مزود البيانات','Data provider') : tr('مصدر ويب','Web source')}</strong><p dir="auto">{item.kind==='brand' ? sourceName(item.source) : item.source}</p>{item.versionId && <code dir="ltr">{item.versionId}</code>}</article>) : <p>{tr('لا توجد أدلة مؤكدة.','No confirmed evidence.')}</p>}<details><summary>{tr('معرف التنفيذ','Workflow ID')}</summary><code dir="ltr">{resolution.workflowId}</code></details></div> : <p className="bb-empty-small">{tr('سيظهر الرد وحالته والأدلة هنا.','Reply, status and evidence appear here.')}</p>}</div></div>
    </section>}
  </>;
}

export function BrandBrainPage({onClose}:{onClose:()=>void}) {
  const {tr,direction}=useLocale();
  const [brandId,setBrandId]=useState('default');
  const [token,setToken]=useState('');
  const [session,setSession]=useState<{scope:BrandScope;snapshot:Snapshot}|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const lock=useRef(false);
  const load=async (event:FormEvent)=>{
    event.preventDefault();
    if(lock.current || !token.trim() || !/^[A-Za-z0-9_-]{1,64}$/.test(brandId))return;
    lock.current=true;setLoading(true);setError('');
    try { const scope={brandId,token};const snapshot=await brandBrainApi.load(scope);setSession({scope,snapshot});setToken(''); }
    catch(err){setError(errorMessage(err,tr));}
    finally{lock.current=false;setLoading(false);}
  };
  return <main className="bb-page" dir={direction}>
    <link rel="stylesheet" href={brandBrainCss} precedence="page"/>
    <div className="bb-inner">
      <header className="bb-heading"><button className="bb-back" onClick={onClose} type="button"><ArrowLeft size={18}/>{tr('العودة للمحادثات','Back to chats')}</button><h1>Brand Brain</h1><p>{tr('إدارة مصادر المعرفة والتكاملات واختبار ردود الوكيل.','Manage knowledge sources, integrations and test agent replies.')}</p></header>
      {session ? <BrandWorkspace key={session.scope.brandId} scope={session.scope} initial={session.snapshot} onSwitch={()=>{setSession(null);setToken('');setError('');}}/> :
        <section className="bb-panel bb-access" aria-labelledby="bb-access-title"><div className="bb-section-head"><div><h2 id="bb-access-title">{tr('فتح مساحة العلامة','Open brand workspace')}</h2><p>{tr('أدخل معرف العلامة ورمز وصول المالك الخاص بالخادم. لا يحفظ التطبيق الرمز في التخزين المحلي.','Enter your brand ID and server owner token. The app does not persist the token in browser storage.')}</p></div><ShieldCheck size={24}/></div>
          <form className="bb-form" onSubmit={load}><fieldset disabled={loading}><label>{tr('معرف العلامة','Brand ID')}<input required pattern="[A-Za-z0-9_\-]{1,64}" maxLength={64} dir="ltr" value={brandId} onChange={e=>setBrandId(e.target.value)}/></label><label>{tr('رمز وصول المالك','Owner access token')}<input type="password" required autoComplete="off" dir="ltr" value={token} onChange={e=>setToken(e.target.value)} placeholder={tr('الرمز السري','Server owner token')}/></label><button className="bb-button bb-primary" type="submit" disabled={!token.trim()}>{loading ? tr('جارٍ التحميل…','Loading…') : tr('تحميل بيانات العلامة','Load brand')}</button></fieldset></form>
          {error && <p className="bb-error" role="alert">{error}</p>}
          <p className="bb-muted">{tr('العلامة المستخدمة للمحادثات الحية تُحدد في إعدادات الخادم. المحاكاة هنا لا تغيرها.','The brand used for live conversations is configured on the server. Testing here does not change it.')}</p>
        </section>}
    </div>
  </main>;
}
