import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageSquare, Pause, Play, Radio, RefreshCw, Users } from 'lucide-react';
import { api } from '../api/client';
import type { BroadcastAudienceFilter, BroadcastCampaignSummary, BroadcastRecipient, BroadcastRichKind, EligibleBroadcastContact } from '../api/types';
import { ConfirmAction } from './ToolDialog';
import { useLocale } from '../locale-context';
import studioCss from './broadcast-studio.css?url';

type Detail = Awaited<ReturnType<typeof api.getBroadcast>>;
type Step = 1 | 2 | 3 | 4;
type Action = 'approve' | 'pause' | 'cancel';
const received = (r: BroadcastRecipient) => r.sentAt !== undefined || ['sent','delivered','read','replied','followed_up'].includes(r.status);

export function BroadcastPage({onClose}: {onClose: () => void}) {
  const {tr,direction,language} = useLocale();
  const [step,setStep] = useState<Step>(1);
  const [campaigns,setCampaigns] = useState<BroadcastCampaignSummary[]>([]);
  const [detail,setDetail] = useState<Detail | null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [confirm,setConfirm] = useState<'approve' | 'cancel' | null>(null);
  const [name,setName] = useState('');
  const [goal,setGoal] = useState('');
  const [cta,setCta] = useState('');
  const [tone,setTone] = useState('adaptive');
  const [constraints,setConstraints] = useState('');
  const [useBrandKnowledge,setUseBrandKnowledge] = useState(true);
  const [kind,setKind] = useState<BroadcastRichKind>('text');
  const [mediaUrl,setMediaUrl] = useState('');
  const [fileName,setFileName] = useState('');
  const [query,setQuery] = useState('');
  const [activity,setActivity] = useState('all');
  const [chatMode,setChatMode] = useState<BroadcastAudienceFilter['chatMode']>();
  const [skipActive,setSkipActive] = useState(true);
  const [audience,setAudience] = useState<EligibleBroadcastContact[] | null>(null);
  const [selected,setSelected] = useState<string[]>([]);
  const [excluded,setExcluded] = useState<number | undefined>();
  const [permission,setPermission] = useState(false);
  const [windowMinutes,setWindowMinutes] = useState(120);
  const [quiet,setQuiet] = useState(true);
  const [timeZone,setTimeZone] = useState(new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [activeId,setActiveId] = useState('');
  const [nameOverrides,setNameOverrides] = useState<Record<string,string>>({});
  const [edits,setEdits] = useState<Record<string,string>>({});
  const [deliveryFilter,setDeliveryFilter] = useState('all');
  const lock = useRef(false);
  const detailId = detail?.campaign.id;
  const campaign = detail?.campaign;
  const recipients = detail?.recipients ?? [];
  const active = recipients.find(r=>r.id===activeId) ?? recipients[0];
  const hasEdits = Object.keys(edits).length > 0;
  const date = (timestamp?:number) => timestamp === undefined ? tr('غير متاح','Unavailable') : new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(timestamp);
  const status = (value:string) => {
    const labels:Record<string,string> = {draft:tr('مسودة','Draft'),approved:tr('معتمدة','Approved'),queued:tr('قيد التنفيذ أو غير مؤكدة','In flight / uncertain'),running:tr('قيد الإرسال','Sending'),paused:tr('متوقفة','Paused'),completed:tr('مكتملة','Completed'),cancelled:tr('ملغاة','Cancelled'),sent:tr('أُرسلت','Sent'),delivered:tr('وصلت','Delivered'),read:tr('قُرئت','Read'),replied:tr('ردّ','Replied'),followed_up:tr('تمت المتابعة','Followed up'),skipped:tr('مستبعد','Skipped'),failed:tr('فشلت','Failed'),opted_out:tr('ألغى الاشتراك','Opted out')};
    return labels[value] ?? value;
  };
  const nameSource = (source?:string) => source==='operator' ? tr('اسم راجعه المستخدم','Operator-confirmed name') : source==='inferred_from_chat' ? tr('تعريف ذاتي من المحادثة','Self-introduction') : source==='contact' ? tr('اسم جهة الاتصال','Contact label') : tr('اسم غير مؤكد','Unknown name');
  const refresh = useCallback(async (id?:string) => {
    const list = await api.listBroadcasts();
    setCampaigns(list.campaigns);
    if (id) setDetail(await api.getBroadcast(id));
  },[]);
  useEffect(()=>{
    let live=true;
    const load=async()=>{try{const result=await api.listBroadcasts();if(live)setCampaigns(result.campaigns);}catch(err){if(live)setError(err instanceof Error?err.message:'Campaign load failed');}finally{if(live)setLoading(false);}};
    void load();
    return ()=>{live=false;};
  },[]);
  useEffect(()=>{
    if(!detailId)return undefined;
    let live=true;
    let timer:ReturnType<typeof setTimeout> | undefined;
    const events=new EventSource('/api/events');
    const update=()=>{
      if(timer!==undefined)clearTimeout(timer);
      timer=setTimeout(()=>{
        if(lock.current || !live)return;
        const load=async()=>{try{const result=await api.getBroadcast(detailId);if(live&&!lock.current)setDetail(result);}catch(err){if(live)setError(err instanceof Error?err.message:'Live update failed');}};
        void load();
      },200);
    };
    events.addEventListener('broadcast_updated',update);
    events.addEventListener('broadcast_recipient_updated',update);
    events.addEventListener('open',update);
    return ()=>{live=false;events.close();if(timer!==undefined)clearTimeout(timer);};
  },[detailId]);
  const run=async(action:()=>Promise<void>)=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{await action();}catch(err){setError(err instanceof Error?err.message:tr('تعذّر الإجراء','Action failed'));}
    finally{lock.current=false;setBusy(false);}
  };
  const filter=():BroadcastAudienceFilter=>({
    query:query.trim()||undefined, limit:500, chatMode,
    ...(activity==='7'?{activeWithinDays:7}:activity==='30'?{activeWithinDays:30}:activity==='dormant'?{inactiveAtLeastDays:30}:{}),
    ...(skipActive?{skipActiveHours:24}:{}),
  });
  const invalidateAudience=()=>{setAudience(null);setSelected([]);setPermission(false);};
  const preview=()=>void run(async()=>{
    invalidateAudience();
    const result=await api.previewBroadcastAudience(undefined,filter());
    setAudience(result.contacts);setExcluded(result.excludedNoInbound);
  });
  const generate=()=>void run(async()=>{
    if(!selected.length||!permission)return;
    const result=await api.createBroadcast({name:name.trim(),goal:goal.trim(),transport:'auto',approvalMode:'preview_approve',permissionConfirmed:permission,
      audienceFilter:{...filter(),chatIds:selected},
      richContent:{kind,messageGoal:goal.trim(),compositionMode:'conversation',brief:{cta:cta.trim(),tone,constraints:constraints.trim(),useBrandKnowledge},
        ...(['image','video','document'].includes(kind)?{mediaUrl:mediaUrl.trim()}:{}),...(kind==='document'?{fileName:fileName.trim()}:{}),
      },
      followUp:{enabled:false,delayMinutes:120,triggerOn:'read_no_reply',messagePrompt:''},
      pacing:{minDelayMs:5000,maxDelayMs:5000,maxWindowMinutes:windowMinutes,...(quiet?{quietHours:{from:22,to:8,timeZone}}:{})},
    });
    setDetail(result);setActiveId(result.recipients[0]?.id??'');setEdits({});setNameOverrides({});setStep(3);
    await refresh(result.campaign.id);
  });
  const openCampaign=(id:string)=>void run(async()=>{
    const result=await api.getBroadcast(id);setDetail(result);setActiveId(result.recipients[0]?.id??'');setEdits({});setNameOverrides({});setDeliveryFilter('all');
    setStep(result.campaign.status==='draft'?3:4);
  });
  const updateRecipient=(recipient:BroadcastRecipient,patch:Parameters<typeof api.updateBroadcastRecipient>[2])=>void run(async()=>{
    if(!detailId)return;
    await api.updateBroadcastRecipient(detailId,recipient.id,patch);
    setEdits(previous=>{const next={...previous};delete next[recipient.id];return next;});
    await refresh(detailId);
  });
  const regenerate=(recipient:BroadcastRecipient)=>void run(async()=>{
    if(!detailId)return;
    await api.regenerateBroadcastRecipient(detailId,recipient.id,nameOverrides[recipient.id]?.trim()||undefined);
    setEdits(previous=>{const next={...previous};delete next[recipient.id];return next;});
    setNameOverrides(previous=>{const next={...previous};delete next[recipient.id];return next;});
    await refresh(detailId);
    setNotice(tr('تم إنشاء مسودة جديدة، وتحتاج إلى مراجعة.','New draft generated. Review it before approval.'));
  });
  const changeCampaign=(action:Action)=>void run(async()=>{
    if(!detailId)return;
    if(action==='approve')await api.approveBroadcast(detailId);
    else if(action==='pause')await api.pauseBroadcast(detailId);
    else await api.cancelBroadcast(detailId);
    await refresh(detailId);setStep(4);
  });
  const media=['image','video','document'].includes(kind);
  const briefValid=Boolean(name.trim()&&goal.trim()&&cta.trim()&&(!media||/^https:\/\//i.test(mediaUrl.trim())));
  const eligibleCount=audience?.length??0;
  const approved=campaign?.stats.approved??0;
  const drafts=campaign?.stats.draft??0;
  const canLaunch=Boolean(campaign&&['draft','paused'].includes(campaign.status)&&!drafts&&approved>0&&!hasEdits);
  const steps=[tr('موجز الحملة','Campaign brief'),tr('اختيار الجمهور','Audience'),tr('مراجعة الرسائل','Review drafts'),tr('الإطلاق والمتابعة','Launch & monitor')];
  return <main className="wa-broadcast-page bs-page" dir={direction}>
    <link rel="stylesheet" href={studioCss} precedence="page"/>
    <div className="bs-inner">
      <header className="wa-broadcast-header"><div><button className="wa-broadcast-back" type="button" onClick={onClose}>{direction==='rtl'?<ArrowRight size={17}/>:<ArrowLeft size={17}/>} {tr('المحادثات','Back to chats')}</button><h1>{tr('استوديو الحملات','Campaign Studio')}</h1><p>{tr('موجز واحد، ورسالة مختلفة لكل عميل سبق له التواصل معك.','One brief, individual messages for customers who have contacted you before.')}</p></div><button className="wa-tool-button" type="button" disabled={busy} onClick={()=>void run(()=>refresh(detailId))}><RefreshCw size={16}/>{tr('تحديث','Refresh')}</button></header>
      {error&&<p className="wa-tool-error" role="alert">{error}</p>}
      {notice&&<output className="wa-tool-status">{notice}</output>}
      <div className="wa-broadcast-layout bs-layout">
        <section className="wa-broadcast-panel bs-workspace" aria-labelledby="broadcast-compose-title" aria-busy={busy}>
          <div className="bs-work-head"><h2 id="broadcast-compose-title">{detail?detail.campaign.name:tr('حملة جديدة','New campaign')}</h2><span className="wa-tool-note">{tr('الخطوة','Step')} {step}/4</span></div>
          <ol className="bs-steps">{steps.map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined}><span>{index+1<step?<Check size={15}/>:index+1}</span><strong>{label}</strong></li>)}</ol>
          {step===1&&<div className="bs-form">
            <h3>{tr('ما الذي تريد إخبار عملائك به؟','What would you like to tell your customers?')}</h3>
            <p className="wa-tool-note">{tr('اكتب السياق العام والحقائق المؤكدة، واترك صياغة كل رسالة للذكاء الاصطناعي.','Provide the overall context and confirmed facts. AI drafts each individual message.')}</p>
            <div className="bs-presets">{[tr('إعادة التواصل','Re-engagement'),tr('عرض جديد','New offer'),tr('متابعة العملاء المميزين','VIP check-in')].map(preset=><button className="wa-tool-button" key={preset} disabled={busy} type="button" onClick={()=>{setName(preset);setGoal('');setCta('');}}>{preset}</button>)}</div>
            <fieldset className="wa-broadcast-fields" disabled={busy}><label className="wa-tool-field">{tr('اسم الحملة','Campaign name')}<input value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label>
              <label className="wa-tool-field">{tr('موضوع الحملة والعرض','Campaign topic & offer')}<textarea dir="auto" rows={5} maxLength={6000} value={goal} onChange={e=>setGoal(e.target.value)} placeholder={tr('ما الجديد؟ لمن يفيد؟ ما الحقائق التي يمكن ذكرها؟','What is new, who benefits, and what confirmed facts can be used?')}/></label>
              <label className="wa-tool-field">{tr('الإجراء المطلوب من العميل','Desired customer action')}<input value={cta} maxLength={300} onChange={e=>setCta(e.target.value)} placeholder={tr('مثلاً: الرد للاستفسار عن العرض','E.g. reply to ask about the offer')}/></label>
              <div className="wa-broadcast-pair"><label className="wa-tool-field">{tr('أسلوب الرسالة','Tone')}<select value={tone} onChange={e=>setTone(e.target.value)}><option value="adaptive">{tr('حسب المحادثة السابقة','Adaptive to conversation')}</option><option value="friendly">{tr('ودي','Friendly')}</option><option value="professional">{tr('مهني','Professional')}</option><option value="concise">{tr('مختصر','Concise')}</option></select></label>
                <label className="wa-tool-field">{tr('نوع الرسالة','Message format')}<select value={kind} onChange={e=>{const value=e.target.value;if(value==='text'||value==='voice_note'||value==='image'||value==='video'||value==='document')setKind(value);}}><option value="text">{tr('نص','Text')}</option><option value="voice_note">{tr('رسالة صوتية','Voice note')}</option><option value="image">{tr('صورة','Image')}</option><option value="video">{tr('فيديو','Video')}</option><option value="document">{tr('مستند','Document')}</option></select></label></div>
              {media&&<label className="wa-tool-field">{tr('رابط الوسائط HTTPS','HTTPS media URL')}<input dir="ltr" type="url" value={mediaUrl} onChange={e=>setMediaUrl(e.target.value)}/></label>}
              {kind==='document'&&<label className="wa-tool-field">{tr('اسم الملف','File name')}<input value={fileName} onChange={e=>setFileName(e.target.value)}/></label>}
              <label className="wa-tool-field">{tr('قيود الرسالة وما لا يجوز الوعد به','Constraints & prohibited promises')}<textarea rows={3} maxLength={1500} value={constraints} onChange={e=>setConstraints(e.target.value)}/></label>
              <label className="wa-broadcast-check"><input type="checkbox" checked={useBrandKnowledge} onChange={e=>setUseBrandKnowledge(e.target.checked)}/>{tr('استخدام المصادر الرسمية من Brand Brain','Use official Brand Brain sources')}</label>
            </fieldset>
            <div className="bs-footer"><button type="button" className="wa-tool-button wa-tool-primary" disabled={busy||!briefValid} onClick={()=>{invalidateAudience();setStep(2);}}>{tr('اختيار الجمهور','Select audience')} <ArrowRight size={16}/></button></div>
          </div>}
          {step===2&&<div className="bs-form"><h3>{tr('اختر من سبق لهم التواصل معك','Select previous conversation contacts')}</h3><p className="wa-tool-note">{tr('المحادثة السابقة ليست إذنًا بالتسويق. اختر فقط من لديهم موافقة صالحة على تلقي الرسالة.','A prior conversation is not marketing permission. Select only contacts with valid permission to receive this message.')}</p>
            <fieldset className="wa-broadcast-fields" disabled={busy}><div className="wa-broadcast-pair"><label className="wa-tool-field">{tr('موضوع أو اسم','Topic or name')}<input value={query} onChange={e=>{setQuery(e.target.value);invalidateAudience();}}/></label>
              <label className="wa-tool-field">{tr('آخر تفاعل','Last activity')}<select value={activity} onChange={e=>{setActivity(e.target.value);invalidateAudience();}}><option value="all">{tr('أي وقت','Any time')}</option><option value="7">{tr('آخر 7 أيام','Last 7 days')}</option><option value="30">{tr('آخر 30 يومًا','Last 30 days')}</option><option value="dormant">{tr('أكثر من 30 يومًا','Over 30 days ago')}</option></select></label></div>
              <label className="wa-tool-field">{tr('وضع المحادثة','Chat mode')}<select value={chatMode??''} onChange={e=>{const value=e.target.value;setChatMode(value==='autopilot'||value==='copilot'||value==='human'?value:undefined);invalidateAudience();}}><option value="">{tr('الكل','All modes')}</option><option value="autopilot">Autopilot</option><option value="copilot">Copilot</option><option value="human">{tr('بشري','Human')}</option></select></label>
              <label className="wa-broadcast-check"><input type="checkbox" checked={skipActive} onChange={e=>{setSkipActive(e.target.checked);invalidateAudience();}}/>{tr('استبعاد المحادثات النشطة خلال آخر 24 ساعة','Skip active chats in the last 24 hours')}</label>
              <button className="wa-tool-button" type="button" onClick={preview}><Users size={16}/>{tr('معاينة الجمهور','Preview audience')}</button>
            </fieldset>
            {audience!==null&&<><div className="bs-counts"><strong>{eligibleCount} {tr('ضمن المعاينة','eligible in preview')}</strong><span>{excluded!==undefined&&`${excluded} ${tr('دون رسالة واردة','without inbound history')}`}</span><span>{selected.length} {tr('محدد','selected')}</span></div>
              {audience.length>0?<><div className="bs-contact-list">{audience.map(contact=><label key={contact.chatId} className="bs-contact"><input type="checkbox" checked={selected.includes(contact.chatId)} disabled={busy} onChange={e=>{setSelected(prev=>e.target.checked?[...prev,contact.chatId]:prev.filter(id=>id!==contact.chatId));setPermission(false);}}/><div><strong dir="auto">{contact.name==='Unknown'?tr('اسم غير مؤكد','Unknown name'):contact.name}</strong><small dir="ltr">{contact.phoneNumber??contact.chatId}</small><small>{nameSource(contact.nameSource)} · {contact.messageCount} {tr('رسالة','messages')}</small>{contact.lastSnippet&&<p dir="auto">{contact.lastSnippet}</p>}</div><small>{date(contact.lastMessageAtMs)}</small></label>)}</div><button type="button" className="wa-tool-button" disabled={busy} onClick={()=>{setSelected([]);setPermission(false);}}>{tr('إلغاء كل الاختيارات','Clear selection')}</button></>:<p className="bs-empty">{tr('لا توجد جهات اتصال تطابق الفلاتر.','No contacts match the filters.')}</p>}
              <label className="wa-broadcast-check"><input type="checkbox" disabled={busy||!selected.length} checked={permission} onChange={e=>setPermission(e.target.checked)}/>{tr('أؤكد وجود موافقة على إرسال هذه الرسالة لكل مستلم محدد.','I confirm that every selected recipient has permission to receive this message.')}</label></>}
            <div className="bs-policy"><h4>{tr('نافذة الإرسال','Send window')}</h4><label className="wa-tool-field">{tr('المدة القصوى بالدقائق بعد الإطلاق','Maximum minutes after launch')}<input type="number" min={1} max={1440} value={windowMinutes} disabled={busy} onChange={e=>setWindowMinutes(Number(e.target.value))}/></label><label className="wa-broadcast-check"><input type="checkbox" checked={quiet} disabled={busy} onChange={e=>setQuiet(e.target.checked)}/>{tr('ساعات الهدوء: 10 مساءً إلى 8 صباحًا','Quiet hours: 10 PM to 8 AM')}</label>{quiet&&<label className="wa-tool-field">{tr('المنطقة الزمنية','Time zone')}<input dir="ltr" value={timeZone} disabled={busy} onChange={e=>setTimeZone(e.target.value)}/></label>}</div>
            <div className="bs-footer"><button className="wa-tool-button" disabled={busy} type="button" onClick={()=>setStep(1)}>{tr('السابق','Back')}</button><button className="wa-tool-button wa-tool-primary" disabled={busy||!selected.length||!permission||!Number.isInteger(windowMinutes)||windowMinutes<1||windowMinutes>1440} type="button" onClick={generate}>{busy?tr('جارٍ إنشاء المسودات…','Generating drafts…'):tr('إنشاء رسائل مخصصة','Generate personalized drafts')}</button></div>
            {busy&&<output className="wa-tool-note">{tr('تتم معالجة المستلمين بالتتابع. لن يتم إرسال أي رسالة في هذه الخطوة.','Recipients are processed sequentially. No messages are sent in this step.')}</output>}
          </div>}
          {step===3&&campaign&&<div className="bs-form"><div className="bs-work-head"><h3>{tr('راجع كل رسالة قبل اعتمادها','Review every draft before approval')}</h3><span className="wa-tool-note">{approved}/{recipients.length} {tr('معتمدة','approved')}</span></div>
            <div className="bs-review"><div className="bs-recipient-list" aria-label={tr('المستلمون','Recipients')}>{recipients.map(r=><button type="button" key={r.id} className="bs-recipient" aria-pressed={active?.id===r.id} disabled={busy} onClick={()=>setActiveId(r.id)}><strong dir="auto">{r.contactName}</strong><small>{status(r.status)}{edits[r.id]!==undefined?' · '+tr('تعديل غير محفوظ','Unsaved edit'):''}</small></button>)}</div>
              {active&&<div className="bs-message"><div className="bs-work-head"><strong dir="auto">{active.contactName}</strong><small>{status(active.status)}</small></div>
                <div className="bs-preview"><span>{tr('معاينة الرسالة المقترحة','Draft preview')}</span>{active.richContent?.personalization?.lastSnippet&&<p className="bs-incoming" dir="auto">{active.richContent.personalization.lastSnippet}</p>}<p className="bs-outgoing" dir="auto">{edits[active.id]??active.personalizedText}</p></div>
                {active.richContent?.personalization&&<p className="wa-tool-note">{nameSource(active.richContent.personalization.nameSource)} · {active.richContent.personalization.historyCount} {tr('رسالة سياقية','context messages')} · {active.richContent.personalization.brandSources} {tr('مصدر رسمي','official sources')}</p>}
                {campaign.status==='draft'&&['draft','approved','skipped'].includes(active.status)&&<div className="bs-policy"><label className="wa-tool-field">{tr('تصحيح اسم المستلم لهذه الحملة','Correct recipient name for this campaign')}<input maxLength={80} dir="auto" disabled={busy} value={nameOverrides[active.id]??''} onChange={e=>setNameOverrides(prev=>({...prev,[active.id]:e.target.value}))} placeholder={active.contactName==='Unknown'?tr('اتركه فارغًا دون تخمين','Leave blank rather than guess'):active.contactName}/></label><button type="button" className="wa-tool-button" disabled={busy||edits[active.id]!==undefined} onClick={()=>regenerate(active)}><RefreshCw size={15}/>{tr('إعادة صياغة الرسالة','Regenerate draft')}</button></div>}
                <label className="wa-tool-field">{tr('تحرير المسودة','Edit draft')}<textarea dir="auto" rows={5} maxLength={4000} disabled={busy||!['draft','approved','skipped'].includes(active.status)} value={edits[active.id]??active.personalizedText} onChange={e=>setEdits(prev=>({...prev,[active.id]:e.target.value}))}/></label>
                <div className="bs-presets">{['draft','approved','skipped'].includes(active.status)&&<><button className="wa-tool-button wa-tool-primary" type="button" disabled={busy||!(edits[active.id]??active.personalizedText).trim()} onClick={()=>updateRecipient(active,{personalizedText:edits[active.id]??active.personalizedText,status:'approved'})}>{tr('حفظ واعتماد','Save & approve')}</button><button className="wa-tool-button" type="button" disabled={busy} onClick={()=>updateRecipient(active,{status:active.status==='skipped'?'draft':'skipped'})}>{active.status==='skipped'?tr('إعادة للمراجعة','Return to review'):tr('استبعاد','Skip')}</button>{edits[active.id]!==undefined&&<button className="wa-tool-button" type="button" onClick={()=>setEdits(previous=>{const next={...previous};delete next[active.id];return next;})}>{tr('تراجع عن التعديل','Discard edit')}</button>}</>}</div>
                {active.error&&<p className="wa-tool-error">{active.error}</p>}
              </div>}
            </div>
            <div className="bs-footer"><span className="wa-tool-note">{drafts} {tr('بانتظار المراجعة','awaiting review')}</span><button type="button" className="wa-tool-button wa-tool-primary" disabled={!canLaunch||busy} onClick={()=>setStep(4)}>{tr('مراجعة الإطلاق','Review launch')}</button></div>
          </div>}
          {step===4&&campaign&&<div className="bs-form"><div className="bs-work-head"><h3>{tr('متابعة الحملة','Campaign monitoring')}</h3><span>{status(campaign.status)}</span></div>
            <div className="bs-metrics">{[[tr('المستلمون','Recipients'),recipients.length],[tr('أُرسلت','Sent'),recipients.filter(received).length],[tr('وصلت','Delivered'),recipients.filter(r=>r.deliveredAt!==undefined).length],[tr('قُرئت','Read'),recipients.filter(r=>r.readAt!==undefined).length],[tr('ردوا','Replied'),recipients.filter(r=>r.repliedAt!==undefined).length],[tr('ألغوا الاشتراك','Opted out'),campaign.stats.optedOut]].map(([label,count])=><div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
            <p className="wa-tool-note">{tr('الرد لا يعني إتمام عملية شراء. الأعداد تعتمد على إيصالات التسليم والردود المسجلة.','Replies are not purchases. Counts reflect recorded delivery receipts and replies.')}</p>
            {campaign.stats.queued>0&&<p className="wa-tool-error">{tr('هناك عمليات إرسال قيد التنفيذ أو غير مؤكدة. لن تتم إعادة إرسالها تلقائيًا.','Some deliveries are in flight or uncertain. They will not be automatically replayed.')}</p>}
            <div className="bs-policy"><strong>{approved} {tr('رسالة معتمدة لم تُرسل بعد','approved messages not yet sent')}</strong><p className="wa-tool-note">{tr('الإرسال متتابع، مع إعادة فحص الأهلية والاتصال عند التنفيذ. لا يوجد ضمان لعدم حظر الحساب.','Dispatch is sequential and rechecks eligibility and connection. Account restrictions cannot be ruled out.')}</p></div>
            <div className="bs-presets">{campaign.status==='draft'&&<button type="button" className="wa-tool-button" onClick={()=>setStep(3)}>{tr('عودة للمراجعة','Back to review')}</button>}{['draft','paused'].includes(campaign.status)&&<button className="wa-tool-button wa-tool-primary" type="button" disabled={busy||!canLaunch} onClick={()=>setConfirm('approve')}><Play size={16}/>{campaign.status==='paused'?tr('استئناف','Resume'):tr('إطلاق الحملة','Start campaign')}</button>}{['approved','running'].includes(campaign.status)&&<button className="wa-tool-button" type="button" disabled={busy} onClick={()=>changeCampaign('pause')}><Pause size={16}/>{tr('إيقاف مؤقت','Pause')}</button>}{!['cancelled','completed'].includes(campaign.status)&&<button className="wa-tool-button wa-tool-danger-outline" type="button" disabled={busy} onClick={()=>setConfirm('cancel')}>{tr('إلغاء الحملة','Cancel campaign')}</button>}</div>
            <label className="wa-tool-field">{tr('تصفية حالات المستلمين','Recipient status filter')}<select value={deliveryFilter} onChange={e=>setDeliveryFilter(e.target.value)}><option value="all">{tr('الكل','All')}</option><option value="read_no_reply">{tr('قرأ ولم يرد','Read without reply')}</option><option value="replied">{tr('ردّ','Replied')}</option><option value="failed">{tr('فشل','Failed')}</option><option value="opted_out">{tr('ألغى الاشتراك','Opted out')}</option></select></label>
            <div className="bs-deliveries">{recipients.filter(r=>deliveryFilter==='all'||(deliveryFilter==='read_no_reply'?r.readAt!==undefined&&r.repliedAt===undefined:r.status===deliveryFilter)).map(r=><div key={r.id}><strong dir="auto">{r.contactName}</strong><span>{status(r.status)}</span>{r.error&&<small>{r.error}</small>}</div>)}</div>
          </div>}
        </section>
        <aside className="wa-broadcast-panel bs-history" aria-labelledby="broadcast-history-title"><div className="bs-work-head"><h2 id="broadcast-history-title">{tr('الحملات','Campaigns')}</h2><span className="wa-tool-note">{campaigns.length}</span></div><button type="button" className="wa-tool-button" disabled={busy||hasEdits} onClick={()=>{setDetail(null);setEdits({});setStep(1);invalidateAudience();setName('');setGoal('');setCta('');setNotice('');}}>{tr('حملة جديدة','New campaign')}</button>
          {loading?<output className="wa-tool-note">{tr('جارٍ التحميل…','Loading…')}</output>:campaigns.length===0?<div className="bs-empty"><Radio size={25}/><p>{tr('لا توجد حملات بعد','No campaigns yet')}</p></div>:campaigns.map(c=><button type="button" className="wa-broadcast-campaign" key={c.id} aria-pressed={detailId===c.id} disabled={busy||hasEdits} onClick={()=>openCampaign(c.id)}><span><strong dir="auto">{c.name}</strong><small>{status(c.status)}</small></span><MessageSquare size={16}/></button>)}
        </aside>
      </div>
    </div>
    {confirm&&<ConfirmAction title={confirm==='approve'?tr('إطلاق الرسائل المعتمدة؟','Launch approved messages?'):tr('إلغاء الحملة؟','Cancel campaign?')} description={confirm==='approve'?tr('سيتم إرسال المسودات التي راجعتها واعتمدتها فقط.','Only reviewed, approved drafts will be sent.'):tr('تتوقف الرسائل المتبقية؛ لا يمكن سحب ما أُرسل بالفعل.','Remaining messages stop; already sent messages cannot be recalled.')} confirmLabel={confirm==='approve'?tr('تأكيد الإرسال','Confirm dispatch'):tr('تأكيد الإلغاء','Confirm cancellation')} onClose={()=>setConfirm(null)} onConfirm={()=>{const action=confirm;setConfirm(null);changeCampaign(action);}}/>}
  </main>;
}
