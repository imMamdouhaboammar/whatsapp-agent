import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Pause, Play, Radio, RefreshCw, Send, Users, XCircle } from 'lucide-react';
import { api } from '../api/client';
import type {
  BroadcastApprovalMode,
  BroadcastCampaignSummary,
  BroadcastRecipient,
  BroadcastRichKind,
  BroadcastTransport,
  EligibleBroadcastContact,
} from '../api/types';
import { useLocale } from '../locale-context';

export function BroadcastPage({ onClose }: { onClose: () => void }) {
  const { direction, tr } = useLocale();
  const [campaigns, setCampaigns] = useState<BroadcastCampaignSummary[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<BroadcastCampaignSummary | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [audiencePreview, setAudiencePreview] = useState<EligibleBroadcastContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
          ...(mediaUrl.trim() ? { mediaUrl: mediaUrl.trim() } : {}),
          ...(fileName.trim() ? { fileName: fileName.trim() } : {}),
          ...(templateName.trim() ? { templateName: templateName.trim(), templateLanguage: 'en_US' } : {}),
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
      await loadCampaigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setBusy(false);
    }
  };

  const handleEditRecipient = async (recipientId: string, personalizedText: string) => {
    if (!selectedCampaign) return;
    const res = await api.updateBroadcastRecipient(selectedCampaign.id, recipientId, { personalizedText });
    setRecipients((prev) => prev.map((r) => (r.id === recipientId ? res.recipient : r)));
  };

  const handleToggleSkip = async (recipient: BroadcastRecipient) => {
    if (!selectedCampaign) return;
    const nextStatus = recipient.status === 'skipped' ? 'draft' : 'skipped';
    const res = await api.updateBroadcastRecipient(selectedCampaign.id, recipient.id, { status: nextStatus });
    setRecipients((prev) => prev.map((r) => (r.id === recipient.id ? res.recipient : r)));
  };

  const handleApprove = async () => {
    if (!selectedCampaign) return;
    setBusy(true);
    try {
      const res = await api.approveBroadcast(selectedCampaign.id);
      setSelectedCampaign(res.campaign);
      await selectCampaign(selectedCampaign.id);
      await loadCampaigns();
    } finally {
      setBusy(false);
    }
  };

  const handlePause = async () => {
    if (!selectedCampaign) return;
    const res = await api.pauseBroadcast(selectedCampaign.id);
    setSelectedCampaign(res.campaign);
    await loadCampaigns();
  };

  const handleCancel = async () => {
    if (!selectedCampaign) return;
    const res = await api.cancelBroadcast(selectedCampaign.id);
    setSelectedCampaign(res.campaign);
    await loadCampaigns();
  };

  return (
    <div dir={direction} style={{ padding: '24px', maxWidth: '1160px', margin: '0 auto', color: '#111827', fontSize: '13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #e5e7eb', paddingBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Radio size={20} color="#0f766e" />
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{tr('البث الذكي التفاعلي (Agentic Broadcast)', 'Smart Agentic Broadcast')}</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={() => void loadCampaigns()} style={{ padding: '8px 12px', borderRadius: '999px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <RefreshCw size={14} /> {tr('تحديث', 'Refresh')}
          </button>
          <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: '999px', border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <ArrowRight size={14} /> {tr('العودة للمحادثات', 'Back to Chats')}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: '10px 14px', borderRadius: '10px', background: '#fef2f2', color: '#991b1b', marginBottom: '16px', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(380px, 1.25fr)', gap: '20px', alignItems: 'start' }}>
        <section style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '18px' }}>
          <h2 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700 }}>{tr('إنشاء حملة بث جديدة', 'Create Broadcast Campaign')}</h2>

          <label style={{ display: 'block', marginBottom: '10px' }}>
            <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>{tr('اسم الحملة', 'Campaign Name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('مثال: عرض الجمعة للعملاء السابقين', 'e.g. VIP Offer for Past Leads')} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
          </label>

          <label style={{ display: 'block', marginBottom: '10px' }}>
            <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>{tr('وصف الجمهور المستهدف (ممن لهم تواصل سابق)', 'Target Audience (Previous Connections Only)')}</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={audiencePrompt} onChange={(e) => setAudiencePrompt(e.target.value)} placeholder={tr('مثال: العملاء المهتمين بالباقة السنوية', 'e.g. leads interested in annual plan')} style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
              <button type="button" disabled={busy} onClick={() => void handlePreviewAudience()} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #0f766e', background: '#f0fdfa', color: '#0f766e', cursor: 'pointer', fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <Users size={14} /> {tr('معاينة', 'Preview')}
              </button>
            </div>
          </label>

          {audiencePreview.length > 0 && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#f0fdfa', color: '#115e59', fontSize: '12px', marginBottom: '10px' }}>
              {tr(`تم العثور على ${audiencePreview.length} عميل مؤهل بتواصل سابق.`, `Found ${audiencePreview.length} eligible contacts with previous connection.`)}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <label>
              <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>{tr('قناة الإرسال', 'Transport')}</span>
              <select value={transport} onChange={({ currentTarget: { value } }) => { if (value === 'auto' || value === 'baileys' || value === 'meta-cloud') setTransport(value); }} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }}>
                <option value="auto">{tr('تلقائي (Auto)', 'Auto')}</option>
                <option value="baileys">Baileys (WhatsApp Web)</option>
                <option value="meta-cloud">Meta Cloud API</option>
              </select>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>{tr('نوع المحتوى (Rich)', 'Rich Content Type')}</span>
              <select value={kind} onChange={({ currentTarget: { value } }) => { if (value === 'text' || value === 'image' || value === 'video' || value === 'document' || value === 'voice_note' || value === 'template') setKind(value); }} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }}>
                <option value="text">{tr('نص مخصص', 'Personalized Text')}</option>
                <option value="image">{tr('صورة + وصف', 'Image + Caption')}</option>
                <option value="video">{tr('فيديو + وصف', 'Video + Caption')}</option>
                <option value="document">{tr('ملف PDF / مستند', 'PDF / Document')}</option>
                <option value="voice_note">{tr('رسالة صوتية (AI Voice)', 'AI Voice Note')}</option>
                <option value="template">{tr('قالب Meta رسمي', 'Meta Approved Template')}</option>
              </select>
            </label>
          </div>

          {(kind === 'image' || kind === 'video' || kind === 'document') && (
            <div style={{ display: 'grid', gridTemplateColumns: kind === 'document' ? '1fr 1fr' : '1fr', gap: '8px', marginBottom: '10px' }}>
              <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://example.com/media..." style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
              {kind === 'document' && (
                <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="brochure.pdf" style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
              )}
            </div>
          )}

          {kind === 'template' && (
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={tr('اسم القالب المعتمد في Meta (مثال: promo_offer)', 'Approved Meta template name')} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px', marginBottom: '10px' }} />
          )}

          <label style={{ display: 'block', marginBottom: '10px' }}>
            <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>{tr('هدف الرسالة (يصيغها الـ AI لكل عميل)', 'Message Goal (AI personalizes per user)')}</span>
            <textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={tr('اكتب العرض أو الرسالة الأساسية وسيتولى المساعد تخصيصها لكل عميل بناءً على سياقه...', 'Describe the offer and AI will tailor it to each contact...')} style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <label>
              <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>{tr('وضع الإطلاق', 'Approval Mode')}</span>
              <select value={approvalMode} onChange={({ currentTarget: { value } }) => { if (value === 'preview_approve' || value === 'autonomous') setApprovalMode(value); }} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }}>
                <option value="preview_approve">{tr('معاينة وموافقة بشرية', 'Preview & Approve')}</option>
                <option value="autonomous">{tr('تلقائي بالكامل (Autonomous)', 'Autonomous Dispatch')}</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px', cursor: 'pointer' }}>
              <input type="checkbox" checked={followUpEnabled} onChange={(e) => setFollowUpEnabled(e.target.checked)} />
              <span style={{ fontSize: '12px', fontWeight: 600 }}>{tr('متابعة تلقائية لو قرأ ومردش', 'Auto follow-up if read & no reply')}</span>
            </label>
          </div>

          {followUpEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px', marginBottom: '12px' }}>
              <input type="number" min={1} value={followUpDelay} onChange={(e) => setFollowUpDelay(Number(e.target.value) || 60)} title={tr('التأخير بالدقائق', 'Delay (minutes)')} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
              <input value={followUpPrompt} onChange={(e) => setFollowUpPrompt(e.target.value)} placeholder={tr('توجيه رسالة المتابعة التلقائية...', 'Follow-up AI prompt...')} style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
            </div>
          )}

          <button type="button" disabled={busy} onClick={() => void handleCreateCampaign()} style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: 'none', background: '#0f766e', color: '#ffffff', fontWeight: 700, fontSize: '13px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <Send size={15} /> {busy ? tr('جارٍ التجهيز...', 'Preparing...') : tr('توليد الحملة بالذكاء الاصطناعي', 'Generate AI Broadcast')}
          </button>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '18px' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700 }}>{tr('الحملات', 'Campaigns')} ({campaigns.length})</h2>
            {loading ? (
              <p style={{ color: '#6b7280', margin: 0 }}>{tr('جارٍ التحميل...', 'Loading...')}</p>
            ) : campaigns.length === 0 ? (
              <p style={{ color: '#6b7280', margin: 0 }}>{tr('لا توجد حملات بث بعد.', 'No broadcast campaigns yet.')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {campaigns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void selectCampaign(c.id)}
                    style={{
                      textAlign: 'start',
                      padding: '10px 14px',
                      borderRadius: '999px',
                      border: selectedCampaign?.id === c.id ? '1px solid #0f766e' : '1px solid #e5e7eb',
                      background: selectedCampaign?.id === c.id ? '#f0fdfa' : '#f9fafb',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.name}</span>
                    <span style={{ fontSize: '12px', color: '#374151' }}>
                      {c.status} · {c.stats.sent + c.stats.delivered + c.stats.read + c.stats.replied}/{c.stats.total}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedCampaign && (
            <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '10px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>{selectedCampaign.name}</h3>
                  <span style={{ fontSize: '12px', color: '#4b5563' }}>
                    {selectedCampaign.status} · {selectedCampaign.transport} · {selectedCampaign.richContent.kind}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(selectedCampaign.status === 'draft' || selectedCampaign.status === 'paused') && (
                    <button type="button" disabled={busy} onClick={() => void handleApprove()} style={{ padding: '7px 12px', borderRadius: '999px', border: 'none', background: '#0f766e', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Play size={13} /> {tr('اعتماد وإرسال', 'Approve & Send')}
                    </button>
                  )}
                  {selectedCampaign.status === 'running' && (
                    <button type="button" onClick={() => void handlePause()} style={{ padding: '7px 12px', borderRadius: '999px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Pause size={13} /> {tr('إيقاف مؤقت', 'Pause')}
                    </button>
                  )}
                  {selectedCampaign.status !== 'completed' && selectedCampaign.status !== 'cancelled' && (
                    <button type="button" onClick={() => void handleCancel()} style={{ padding: '7px 12px', borderRadius: '999px', border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', cursor: 'pointer', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <XCircle size={13} /> {tr('إلغاء', 'Cancel')}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto' }}>
                {recipients.map((r) => (
                  <div key={r.id} style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #e5e7eb', background: '#f9fafb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <strong style={{ fontSize: '13px' }}>{r.contactName}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: '#0f766e', fontWeight: 600 }}>{r.status}</span>
                        {r.status === 'draft' || r.status === 'skipped' ? (
                          <button type="button" onClick={() => void handleToggleSkip(r)} style={{ padding: '3px 8px', borderRadius: '999px', border: '1px solid #d1d5db', background: '#fff', fontSize: '11px', cursor: 'pointer' }}>
                            {r.status === 'skipped' ? tr('تضمين', 'Include') : tr('تخطي', 'Skip')}
                          </button>
                        ) : (
                          <CheckCircle2 size={14} color="#0f766e" />
                        )}
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      value={r.personalizedText}
                      disabled={r.status !== 'draft'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRecipients((prev) => prev.map((item) => (item.id === r.id ? { ...item, personalizedText: val } : item)));
                      }}
                      onBlur={(e) => {
                        if (r.status === 'draft') void handleEditRecipient(r.id, e.target.value);
                      }}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '12px', background: r.status === 'draft' ? '#fff' : '#f3f4f6' }}
                    />
                    {r.error && <div style={{ color: '#991b1b', fontSize: '11px', marginTop: '4px' }}>{r.error}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
