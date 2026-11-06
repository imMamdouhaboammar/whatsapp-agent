import {useState,type FormEvent} from 'react';
import {ArrowLeft, BookOpen, Database, Link2, PlayCircle, RotateCcw, ShieldCheck} from 'lucide-react';
import {useLocale} from '../locale-context';
import '../brand-brain.css';

interface Source {sourceId:string;type:string;locator:string;authority:string;versionId:string;lastChecked:number}
interface Evidence {text:string;sourceId:string;versionId:string;score:number}
export function BrandBrainPage({onClose}:{onClose:()=>void}) {
 const {tr,direction}=useLocale();
 const [brandId,setBrandId]=useState('default');
 const [token,setToken]=useState('');
 const [type,setType]=useState<'faq'|'text'|'csv'>('faq');
 const [authority,setAuthority]=useState<'official'|'working'|'external'>('official');
 const [locator,setLocator]=useState('');
 const [content,setContent]=useState('');
 const [sheetId,setSheetId]=useState('');
 const [question,setQuestion]=useState('');
 const [goal,setGoal]=useState('');
 const [sources,setSources]=useState<Source[]>([]);
 const [evidence,setEvidence]=useState<Evidence[]>([]);
 const [tools,setTools]=useState<string[]>([]);
 const [resolution,setResolution]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);

 const request=async(path:string,method='GET',body?:unknown)=>{
  const response=await fetch(path,{
   method,
   headers:{'Content-Type':'application/json','X-Agent-Owner-Token':token},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const result=await response.json().catch(()=>({error:'Invalid response'}));
  if(!response.ok)throw new Error(result.error||tr('تعذر إكمال الطلب','Unable to complete request'));
  return result;
 };
 const prefix='/api/brands/'+encodeURIComponent(brandId);
 const refresh=async()=>{
  const [sourceResponse,toolResponse]=await Promise.all([request(prefix+'/sources'),request(prefix+'/tools')]);
  setSources(sourceResponse.sources??[]);
  setTools((toolResponse.tools??[]).map((tool:{name:string})=>tool.name));
 };
 const run=async(fn:()=>Promise<void>)=>{
  setBusy(true);setError('');setNotice('');
  try{await fn();}catch(err){setError(err instanceof Error?err.message:String(err));}finally{setBusy(false);}
 };
 const upload=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await request(prefix+'/sources','POST',{type,locator,authority,content});
  await refresh();setContent('');setNotice(tr('تم حفظ المصدر وإصدار جديد عند الحاجة','Source saved and versioned if changed'));
 });};
 const connect=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await request(prefix+'/connectors/google-sheets','POST',{sheetId});
  await refresh();setNotice(tr('تم تفعيل موصل المخزون','Inventory connector enabled'));
 });};
 const search=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  const response=await request(prefix+'/retrieve','POST',{question,limit:5});
  setEvidence(response.evidence??[]);
 });};
 const simulate=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  const response=await request('/api/agent/resolve','POST',{brandId,contactId:'ui-simulator',text:goal});
  setResolution(response.reply??'');
  setNotice(tr('محاكاة فقط — لم تُرسل رسالة واتساب','Simulation only — no WhatsApp message sent'));
 });};

 return <main className="bb-page" dir={direction}>
  <div className="bb-top"><button className="bb-back" onClick={onClose} type="button"><ArrowLeft size={18}/>{tr('العودة للمحادثات','Back to chats')}</button><span className="bb-pill"><ShieldCheck size={15}/>{tr('إعدادات محمية','Protected settings')}</span></div>
  <header className="bb-heading"><div className="bb-icon"><BookOpen size={25}/></div><div><h1>Brand Brain</h1><p>{tr('إدارة معرفة البراند ومصادر الأدلة وربط بيانات المتجر','Manage business knowledge, grounded evidence and store data')}</p></div></header>
  <section className="bb-card bb-access"><h2>{tr('صلاحية المالك والبراند','Owner access and brand')}</h2>
   <p>{tr('أدخل رمز الوصول المطابق لإعداد AGENT_CAPABILITIES_OWNER_TOKEN في خادمك. الرمز لا يُحفظ في المتصفح.','Enter the token configured as AGENT_CAPABILITIES_OWNER_TOKEN on your server. The browser does not save it.')}</p>
   <div className="bb-fields"><label>{tr('رمز وصول المالك','Owner access token')}<input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder={tr('الرمز السري','Secret token')}/></label>
   <label>{tr('معرف البراند','Brand ID')}<input value={brandId} onChange={e=>setBrandId(e.target.value)} pattern="[A-Za-z0-9_-]{1,64}" required dir="ltr"/></label>
   <button type="button" onClick={()=>void run(refresh)} disabled={!token||busy}><RotateCcw size={17}/>{tr('تحميل بيانات البراند','Load brand')}</button></div>
  </section>
  {error && <p className="bb-error" role="alert">{error}</p>}
  {notice && <p className="bb-success" role="status">{notice}</p>}
  <div className="bb-grid">
   <section className="bb-card"><h2><BookOpen size={20}/>{tr('مصادر المعرفة','Knowledge sources')}</h2>
    <form onSubmit={upload} className="bb-form">
     <label>{tr('نوع المصدر','Source type')}<select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="faq">FAQ</option><option value="text">{tr('نص','Text')}</option><option value="csv">CSV</option></select></label>
     <label>{tr('درجة الاعتماد','Authority')}<select value={authority} onChange={e=>setAuthority(e.target.value as typeof authority)}><option value="official">{tr('رسمي','Official')}</option><option value="working">{tr('مسودة','Working')}</option><option value="external">{tr('مرجع خارجي','External')}</option></select></label>
     <label>{tr('اسم أو عنوان المصدر','Source name or reference')}<input value={locator} onChange={e=>setLocator(e.target.value)} required placeholder="shipping-policy"/></label>
     <label>{tr('محتوى المعرفة','Knowledge content')}<textarea value={content} onChange={e=>setContent(e.target.value)} rows={6} required placeholder={tr('اكتب السياسة أو الأسئلة الشائعة هنا','Paste FAQs or policy text here')}/></label>
     <button disabled={!token||busy} type="submit"><Database size={16}/>{tr('حفظ المصدر','Save source')}</button>
    </form>
    <div className="bb-items"><h3>{tr('المصادر الحالية','Current sources')} ({sources.length})</h3>{sources.length===0 && <p>{tr('لا توجد مصادر محملة','No loaded sources')}</p>}
    {sources.map(s=><article key={s.sourceId}><strong>{s.locator}</strong><span>{s.type} · {s.authority} · {s.versionId.slice(0,8)}</span></article>)}</div>
   </section>
   <div className="bb-column">
    <section className="bb-card"><h2><Link2 size={20}/>{tr('ربط المخزون','Inventory connector')}</h2>
     <p>{tr('Google Sheets — يستخدم رابط CSV منشورًا للقراءة فقط. لا تمنحه بيانات عملاء خاصة.','Google Sheets — uses a published, read-only CSV. Never expose private customer data.')}</p>
     <form className="bb-form" onSubmit={connect}><label>Google Sheets ID<input value={sheetId} onChange={e=>setSheetId(e.target.value)} required dir="ltr" placeholder="1AbCdEf..."/></label>
     <button disabled={!token||busy} type="submit">{tr('ربط الجدول','Connect sheet')}</button></form>
     <p>{tr('الأدوات المتاحة','Available tools')}: {tools.length?tools.join(', '):tr('لا توجد أدوات','None')}</p>
    </section>
    <section className="bb-card"><h2>{tr('بحث الأدلة','Evidence search')}</h2><form className="bb-form" onSubmit={search}>
     <label>{tr('سؤال البحث','Search question')}<input value={question} onChange={e=>setQuestion(e.target.value)} required/></label>
     <button type="submit" disabled={!token||busy}>{tr('ابحث','Search')}</button>
    </form><div className="bb-items">{evidence.map((item,i)=><article key={item.sourceId+i}><p>{item.text}</p><span>{tr('المصدر','Source')}: {item.sourceId.slice(0,10)} · v:{item.versionId.slice(0,8)}</span></article>)}</div>
    </section>
    <section className="bb-card"><h2><PlayCircle size={20}/>{tr('تجربة الـAgent','Agent dry-run')}</h2><form className="bb-form" onSubmit={simulate}>
     <label>{tr('طلب العميل التجريبي','Sample customer request')}<input value={goal} onChange={e=>setGoal(e.target.value)} required placeholder={tr('هل SKU-42 موجود؟','Is SKU-42 available?')}/></label>
     <button type="submit" disabled={!token||busy}>{tr('جرّب بدون إرسال','Test without sending')}</button>
    </form>{resolution && <output className="bb-result">{resolution}</output>}</section>
   </div>
  </div>
 </main>;
}
