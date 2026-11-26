import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Pause, Play, Radio, RefreshCw, Send, Users, XCircle } from 'lucide-react';
import { api } from '../api/client';
import type {
  BroadcastApprovalMode,
  BroadcastCampaignSummary,
  BroadcastRecipient,
  BroadcastRichKind,
  BroadcastTransport,
  EligibleBroadcastContact,
} from '../api/types';
import { ConfirmAction } from './ToolDialog';
import { useLocale } from '../locale-context';

const sentCount = (campaign: BroadcastCampaignSummary) => campaign.stats.sent + campaign.stats.delivered + campaign.stats.read + campaign.stats.replied + campaign.stats.followedUp;

export function BroadcastPage({ onClose }: { onClose: () => void }) {
  const { direction, tr } = useLocale();
  const [campaigns, setCampaigns] = useState<BroadcastCampaignSummary[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<BroadcastCampaignSummary | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [audiencePreview, setAudiencePreview] = useState<EligibleBroadcastContact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<'create' | 'approve' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [audiencePrompt, setAudiencePrompt] = useState('');
  const [goal, setGoal] = useState('');
  const [transport, setTransport] = useState<BroadcastTransport>('auto');
  const [approvalMode, setApprovalMode] = useState<BroadcastApprovalMode>('preview_approve');
  const [kind, setKind] = useState<BroadcastRichKind>('text');
  const [mediaUrl, setMediaUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [followUpDelay, setFollowUpDelay] = useState(120);
  const [followUpPrompt, setFollowUpPrompt] = useState('');

  const loadCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.listBroadcasts();
      setCampaigns(res.campaigns || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load broadcasts');
    } finally {
      setLoading(false);
    }
  }, []);

  const selectCampaign = useCallback(async (id: string) => {
    try {
      const res = await api.getBroadcast(id);
      setSelectedCampaign(res.campaign);
      setRecipients(res.recipients || []);
      setEdits({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadInitialCampaigns = async () => {
      try {
        const res = await api.listBroadcasts();
        if (active) setCampaigns(res.campaigns || []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load broadcasts');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadInitialCampaigns();
    return () => {
      active = false;
    };
  }, []);

  const handlePreviewAudience = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.previewBroadcastAudience(audiencePrompt.trim() || undefined);
      setAudiencePreview(res.contacts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview audience');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!name.trim() || !goal.trim()) {
      setError(tr('اكتب اسم الحملة وهدف الرسالة أولاً.', 'Enter campaign name and message goal first.'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await api.createBroadcast({
        name: name.trim(),
        goal: goal.trim(),
        transport,
        approvalMode,
        audiencePrompt: audiencePrompt.trim() || undefined,
        richContent: {
          kind,
          messageGoal: goal.trim(),
          ...(['image', 'video', 'document'].includes(kind) && mediaUrl.trim() ? { mediaUrl: mediaUrl.trim() } : {}),
          ...(kind === 'document' && fileName.trim() ? { fileName: fileName.trim() } : {}),
          ...(kind === 'template' && templateName.trim() ? { templateName: templateName.trim(), templateLanguage: 'en_US' } : {}),
        },
        followUp: {
          enabled: followUpEnabled,
          delayMinutes: followUpDelay,
          triggerOn: 'read_no_reply',
          messagePrompt: followUpPrompt.trim() || tr('متابعة لطيفة للتأكد من وصول العرض والرد على أي استفسار.', 'Polite follow-up checking if they have any questions.'),
        },
      });
      setSelectedCampaign(created.campaign);
      setRecipients(created.recipients);
      setEdits({});
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setBusy(false);
    }
  };

  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : tr('تعذّر تنفيذ الإجراء', 'Action failed')); }
    finally { setBusy(false); }
  };

  const handleEditRecipient = (recipientId: string, personalizedText: string) => perform(async () => {
    if (!selectedCampaign) return;
    const res = await api.updateBroadcastRecipient(selectedCampaign.id, recipientId, { personalizedText });
    setRecipients(prev => prev.map(r => r.id === recipientId ? res.recipient : r));
    setEdits(prev => { const next = { ...prev }; delete next[recipientId]; return next; });
  });

  const handleToggleSkip = (recipient: BroadcastRecipient) => perform(async () => {
    if (!selectedCampaign) return;
    const res = await api.updateBroadcastRecipient(selectedCampaign.id, recipient.id, { status: recipient.status === 'skipped' ? 'draft' : 'skipped' });
    setRecipients(prev => prev.map(r => r.id === recipient.id ? res.recipient : r));
    await loadCampaigns();
  });

  const handleCampaignAction = (action: 'approve' | 'pause' | 'cancel') => perform(async () => {
    if (!selectedCampaign) return;
    if (action === 'approve') await api.approveBroadcast(selectedCampaign.id);
    else if (action === 'pause') await api.pauseBroadcast(selectedCampaign.id);
    else await api.cancelBroadcast(selectedCampaign.id);
    await selectCampaign(selectedCampaign.id);
    await loadCampaigns();
  });

  const hasEdits = Object.keys(edits).length > 0;
  const isMedia = kind === 'image' || kind === 'video' || kind === 'document';
  const valid = Boolean(name.trim() && goal.trim() && (!isMedia || mediaUrl.trim()) && (kind !== 'template' || templateName.trim()) && (!followUpEnabled || (Number.isInteger(followUpDelay) && followUpDelay >= 1)));
  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: tr('مسودة', 'Draft'), approved: tr('معتمدة', 'Approved'), queued: tr('في الانتظار', 'Queued'),
      running: tr('قيد الإرسال', 'Running'), paused: tr('متوقفة مؤقتًا', 'Paused'), completed: tr('مكتملة', 'Completed'),
      cancelled: tr('ملغاة', 'Cancelled'), sent: tr('أُرسلت', 'Sent'), delivered: tr('وصلت', 'Delivered'),
      read: tr('قُرئت', 'Read'), replied: tr('تم الرد', 'Replied'), followed_up: tr('تمت المتابعة', 'Followed up'),
      skipped: tr('مستبعدة', 'Skipped'), failed: tr('فشلت', 'Failed'), opted_out: tr('ألغى الاشتراك', 'Opted out')
    };
    return labels[status] ?? status;
  };

  return <main dir={direction} className="wa-broadcast-page">
    <div className="wa-broadcast-inner">
      <div className="wa-broadcast-header">
        <div><button type="button" className="wa-broadcast-back" onClick={onClose}><ArrowRight size={16}/>{tr('المحادثات', 'Back to chats')}</button>
          <h1><Radio size={24}/>{tr('البث الذكي', 'Smart Agentic Broadcast')}</h1>
          <p>{tr('جهّز رسائل مخصصة للعملاء، وراجع المستلمين وتابع حالة الإرسال.', 'Compose personalized messages, review recipients and track delivery.')}</p></div>
        <button type="button" className="wa-tool-button" disabled={loading || busy || hasEdits} onClick={() => void perform(async () => { await loadCampaigns(); if (selectedCampaign) await selectCampaign(selectedCampaign.id); })}><RefreshCw size={16}/>{tr('تحديث', 'Refresh')}</button>
      </div>
      {error && <p className="wa-tool-error" role="alert">{error}</p>}
      <div className="wa-broadcast-layout">
        <section className="wa-broadcast-panel" aria-labelledby="broadcast-compose-title">
          <div className="wa-broadcast-panel-heading"><h2 id="broadcast-compose-title">{tr('إنشاء حملة', 'New campaign')}</h2><p>{tr('حدّد هدف الرسائل والجمهور قبل الإرسال.', 'Define your audience and message goal before sending.')}</p></div>
          <fieldset className="wa-broadcast-fields" disabled={busy}>
            <label className="wa-tool-field">{tr('اسم الحملة', 'Campaign name')}<input value={name} onChange={e => setName(e.target.value)} placeholder={tr('عرض العملاء السابقين', 'Returning customer offer')}/></label>
            <div className="wa-tool-stack"><label className="wa-tool-field" htmlFor="broadcast-audience">{tr('الجمهور المستهدف', 'Target audience')}</label>
              <div className="wa-tool-search"><input id="broadcast-audience" value={audiencePrompt} onChange={e => { setAudiencePrompt(e.target.value); setAudiencePreview(null); }} placeholder={tr('صف العملاء المناسبين', 'Describe the eligible contacts')}/><button type="button" className="wa-tool-button" onClick={() => void handlePreviewAudience()}><Users size={16}/>{tr('معاينة', 'Preview')}</button></div>
              <p className="wa-tool-note">{tr('العملاء الذين سبق لهم التواصل فقط.', 'Only contacts with previous interactions are eligible.')}</p>
              {audiencePreview !== null && <output className="wa-tool-status">{tr('عدد العملاء المؤهلين:', 'Eligible contacts:')} {audiencePreview.length}</output>}
            </div>
            <label className="wa-tool-field">{tr('هدف الرسالة', 'Message goal')}<textarea rows={4} value={goal} onChange={e => setGoal(e.target.value)} placeholder={tr('اشرح العرض وما تريد من العميل فعله', 'Describe the offer and desired customer action')}/></label>
            <div className="wa-broadcast-pair">
              <label className="wa-tool-field">{tr('قناة الإرسال', 'Transport')}<select value={transport} onChange={({currentTarget:{value}}) => { if (value === 'auto' || value === 'baileys' || value === 'meta-cloud') setTransport(value); }}><option value="auto">{tr('تلقائي', 'Auto')}</option><option value="baileys">Baileys</option><option value="meta-cloud">Meta Cloud API</option></select></label>
              <label className="wa-tool-field">{tr('نوع المحتوى', 'Content type')}<select value={kind} onChange={({currentTarget:{value}}) => { if (value === 'text' || value === 'image' || value === 'video' || value === 'document' || value === 'voice_note' || value === 'template') setKind(value); }}><option value="text">{tr('نص مخصص', 'Personalized text')}</option><option value="image">{tr('صورة', 'Image')}</option><option value="video">{tr('فيديو', 'Video')}</option><option value="document">{tr('مستند', 'Document')}</option><option value="voice_note">{tr('رسالة صوتية', 'Voice note')}</option><option value="template">{tr('قالب Meta', 'Meta template')}</option></select></label>
            </div>
            {isMedia && <label className="wa-tool-field">{tr('رابط الملف', 'Media URL')}<input type="url" dir="ltr" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="https://…"/></label>}
            {kind === 'document' && <label className="wa-tool-field">{tr('اسم الملف', 'File name')}<input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="brochure.pdf"/></label>}
            {kind === 'template' && <label className="wa-tool-field">{tr('اسم القالب المعتمد', 'Approved template name')}<input value={templateName} onChange={e => setTemplateName(e.target.value)}/></label>}
            <label className="wa-tool-field">{tr('طريقة الإطلاق', 'Approval mode')}<select value={approvalMode} onChange={({currentTarget:{value}}) => { if (value === 'preview_approve' || value === 'autonomous') setApprovalMode(value); }}><option value="preview_approve">{tr('مراجعة ثم اعتماد', 'Review and approve')}</option><option value="autonomous">{tr('إرسال تلقائي', 'Autonomous dispatch')}</option></select></label>
            <div className="wa-broadcast-followup">
              <label className="wa-broadcast-check"><input type="checkbox" checked={followUpEnabled} onChange={e => setFollowUpEnabled(e.target.checked)}/><strong>{tr('متابعة تلقائية عند القراءة دون رد', 'Follow up after read without reply')}</strong></label>
              {followUpEnabled && <div className="wa-tool-stack"><label className="wa-tool-field">{tr('التأخير بالدقائق', 'Delay in minutes')}<input type="number" min={1} step={1} value={followUpDelay} onChange={e => setFollowUpDelay(Number(e.target.value))}/></label><label className="wa-tool-field">{tr('توجيه المتابعة', 'Follow-up instructions')}<input value={followUpPrompt} onChange={e => setFollowUpPrompt(e.target.value)}/></label></div>}
            </div>
            <button type="button" className="wa-tool-button wa-tool-primary wa-broadcast-submit" disabled={!valid || busy || hasEdits} onClick={() => { if (approvalMode === 'autonomous') setConfirmation('create'); else void handleCreateCampaign(); }}><Send size={16}/>{busy ? tr('جارٍ التنفيذ', 'Working…') : approvalMode === 'autonomous' ? tr('إنشاء وإطلاق الحملة', 'Create & launch campaign') : tr('إنشاء مسودات الرسائل', 'Generate message drafts')}</button>
          </fieldset>
        </section>
        <section className="wa-broadcast-history" aria-labelledby="broadcast-history-title">
          <div className="wa-broadcast-panel">
            <div className="wa-broadcast-panel-heading"><h2 id="broadcast-history-title">{tr('الحملات', 'Campaigns')} <span className="wa-broadcast-count">{campaigns.length}</span></h2><p>{tr('اختر حملة لعرض حالتها والمستلمين.', 'Select a campaign to review its status and recipients.')}</p></div>
            {loading ? <output className="wa-tool-note">{tr('جارٍ التحميل', 'Loading…')}</output> : campaigns.length === 0 ? <div className="wa-tool-empty wa-broadcast-empty"><Radio size={28}/><strong>{tr('لا توجد حملات بعد', 'No campaigns yet')}</strong><span>{tr('ستظهر حملاتك هنا بعد إنشائها.', 'Your campaigns will appear here once created.')}</span></div> :
              <div className="wa-broadcast-list">{campaigns.map(c => <button type="button" key={c.id} className="wa-broadcast-campaign" aria-pressed={selectedCampaign?.id === c.id} disabled={busy || hasEdits} onClick={() => void perform(() => selectCampaign(c.id))}><span><strong>{c.name}</strong><small>{statusLabel(c.status)}</small></span><span className="wa-broadcast-campaign-progress">{sentCount(c)} / {c.stats.total}<small>{tr('تم الإرسال', 'Sent')}</small></span></button>)}</div>}
          </div>
          {selectedCampaign && <div className="wa-broadcast-panel">
            <div className="wa-broadcast-panel-heading"><h2 dir="auto">{selectedCampaign.name}</h2><p>{statusLabel(selectedCampaign.status)} · {selectedCampaign.transport}</p></div>
            <dl className="wa-context-metrics"><div><dt>{tr('المستلمون', 'Recipients')}</dt><dd>{selectedCampaign.stats.total}</dd></div><div><dt>{tr('أُرسلت', 'Sent')}</dt><dd>{sentCount(selectedCampaign)}</dd></div><div><dt>{tr('فشلت', 'Failed')}</dt><dd>{selectedCampaign.stats.failed}</dd></div></dl>
            <div className="wa-broadcast-actions">
              {(selectedCampaign.status === 'draft' || selectedCampaign.status === 'paused') && <button type="button" className="wa-tool-button wa-tool-primary" disabled={busy || hasEdits} onClick={() => setConfirmation('approve')}><Play size={15}/>{tr('اعتماد وإرسال', 'Approve & send')}</button>}
              {selectedCampaign.status === 'running' && <button type="button" className="wa-tool-button" disabled={busy} onClick={() => void handleCampaignAction('pause')}><Pause size={15}/>{tr('إيقاف مؤقت', 'Pause')}</button>}
              {selectedCampaign.status !== 'completed' && selectedCampaign.status !== 'cancelled' && <button type="button" className="wa-tool-button wa-tool-danger-outline" disabled={busy || hasEdits} onClick={() => setConfirmation('cancel')}><XCircle size={15}/>{tr('إلغاء الحملة', 'Cancel campaign')}</button>}
            </div>
            {hasEdits && <output className="wa-tool-note">{tr('احفظ تعديلات الرسائل أو تراجع عنها قبل المتابعة.', 'Save or discard message edits before continuing.')}</output>}
            <h3 className="wa-broadcast-recipient-title">{tr('المستلمون', 'Recipients')}</h3>
            {recipients.length === 0 && <p className="wa-tool-note">{tr('لا يوجد مستلمون.', 'No recipients.')}</p>}
            <div className="wa-broadcast-recipients">{recipients.map(r => <article key={r.id} className="wa-broadcast-recipient"><div className="wa-tool-row"><strong dir="auto">{r.contactName}</strong><span className="wa-tool-note">{statusLabel(r.status)}</span></div>
              <label className="wa-tool-field"><span>{tr('الرسالة المخصصة', 'Personalized message')}</span><textarea rows={3} dir="auto" value={edits[r.id] ?? r.personalizedText} disabled={busy || r.status !== 'draft'} onChange={e => setEdits(prev => ({ ...prev, [r.id]: e.target.value }))}/></label>
              <div className="wa-broadcast-actions">{edits[r.id] !== undefined && <><button type="button" className="wa-tool-button wa-tool-primary" disabled={busy || !edits[r.id]?.trim()} onClick={() => void handleEditRecipient(r.id, edits[r.id] ?? '')}>{tr('حفظ', 'Save')}</button><button type="button" className="wa-tool-button" disabled={busy} onClick={() => setEdits(prev => { const next = { ...prev }; delete next[r.id]; return next; })}>{tr('تراجع', 'Discard')}</button></>}
              {(r.status === 'draft' || r.status === 'skipped') && <button type="button" className="wa-tool-button" disabled={busy || edits[r.id] !== undefined} onClick={() => void handleToggleSkip(r)}>{r.status === 'skipped' ? tr('تضمين', 'Include') : tr('استبعاد', 'Skip')}</button>}</div>
              {r.error && <p className="wa-tool-error" role="alert">{r.error}</p>}
            </article>)}</div>
          </div>}
        </section>
      </div>
    </div>
    {confirmation && <ConfirmAction title={confirmation === 'cancel' ? tr('إلغاء الحملة؟', 'Cancel campaign?') : tr('تأكيد الإرسال', 'Confirm dispatch')} description={confirmation === 'cancel' ? tr('سيتم إلغاء الرسائل التي لم تُرسل بعد.', 'Remaining unsent messages will be cancelled.') : tr('قد يبدأ إرسال الرسائل للعملاء المؤهلين فور التأكيد.', 'Messages may be sent to eligible contacts immediately after confirmation.')} confirmLabel={confirmation === 'cancel' ? tr('إلغاء الحملة', 'Cancel campaign') : tr('تأكيد الإرسال', 'Confirm dispatch')} onClose={() => setConfirmation(null)} onConfirm={() => { const action = confirmation; setConfirmation(null); if (action === 'create') void handleCreateCampaign(); else void handleCampaignAction(action); }}/>}
  </main>;
}
