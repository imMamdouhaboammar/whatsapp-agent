import { useEffect, useState } from 'react';
import {
  Activity, ArrowLeft, ArrowRight, BookOpen, Bot, ChevronDown,
  CircleHelp, Database, Headphones, LockKeyhole, MessageCircle,
  Mic2, Puzzle, RotateCcw, Save, Send, Settings2, ShieldCheck,
  SlidersHorizontal, Users, Wifi, Zap
} from 'lucide-react';
import type { ModeratorPersona, PolicyConfig, SystemStatus } from '../api/types';
import { Gemini, Google, ModelIcon } from '@lobehub/icons';
import { AgentAvatar } from '@lobehub/ui';
import { useLocale } from '../locale-context';
import './persona-settings.css';

type SettingsSection = 'assistant' | 'models';

interface PersonaSettingsPageProps {
  onClose: () => void;
  onOpenKnowledge?: () => void;
  onOpenSimulator?: () => void;
  connectionState?: SystemStatus['state'];
  initialPersona?: ModeratorPersona;
  error?: boolean;
  onRetry?: () => void;
  onSave: (persona: Partial<ModeratorPersona>, policy?: Partial<PolicyConfig>) => Promise<void>;
}

const sectionFromPath = (): SettingsSection =>
  typeof window !== 'undefined' && window.location.pathname === '/settings/models' ? 'models' : 'assistant';

export function PersonaSettingsPage(props: PersonaSettingsPageProps) {
  const { tr, direction } = useLocale();

  if (!props.initialPersona) {
    return (
      <main className="wa-premium-settings wa-premium-settings-loading" dir={direction} aria-busy={!props.error}>
        <section className="wa-ps-loading-panel" role={props.error ? 'alert' : 'status'}>
          <Settings2 size={26} />
          <h1>{tr('إعدادات المساعد', 'Assistant settings')}</h1>
          <p>{props.error ? tr('تعذّر تحميل الإعدادات', 'Could not load settings') : tr('جارٍ تحميل إعدادات المساعد', 'Loading assistant settings')}</p>
          {props.error && <button type="button" className="wa-ps-button wa-ps-button-primary" onClick={props.onRetry}>{tr('إعادة المحاولة', 'Try again')}</button>}
          <button type="button" className="wa-ps-button wa-ps-button-quiet" onClick={props.onClose}>{tr('العودة للمحادثات', 'Back to chats')}</button>
        </section>
      </main>
    );
  }

  return <PersonaEditor {...props} initialPersona={props.initialPersona} />;
}

function PersonaEditor({ initialPersona, onClose, onOpenKnowledge, onOpenSimulator, connectionState, onSave }: PersonaSettingsPageProps & { initialPersona: ModeratorPersona }) {
  const { language, tr, direction } = useLocale();
  const [active, setActive] = useState<SettingsSection>(sectionFromPath);
  const [savedPersona, setSavedPersona] = useState<ModeratorPersona>(() => ({ ...initialPersona, rules: [...initialPersona.rules] }));
  const [persona, setPersona] = useState<ModeratorPersona>(() => ({ ...initialPersona, rules: [...initialPersona.rules] }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const dirty = JSON.stringify(persona) !== JSON.stringify(savedPersona);
  const connected = connectionState === 'connected';

  useEffect(() => {
    const onPopState = () => setActive(sectionFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setField = <K extends keyof ModeratorPersona>(key: K, value: ModeratorPersona[K]) => {
    setPersona((previous) => ({ ...previous, [key]: value }));
    setSavedNotice(false);
  };

  const navigate = (section: SettingsSection) => {
    if (section === active) return;
    window.history.pushState({ waSettings: true }, '', `/settings/${section}`);
    setActive(section);
    setError('');
  };

  const leave = (target: () => void) => {
    if (dirty && !window.confirm(tr('عندك تغييرات مش محفوظة، هل تريد المغادرة؟', 'You have unsaved changes. Leave without saving?'))) return;
    target();
  };

  const reset = () => { setPersona({ ...savedPersona, rules: [...savedPersona.rules] }); setError(''); setSavedNotice(false); };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError('');
    try {
      await onSave(persona);
      setSavedPersona({ ...persona, rules: [...persona.rules] });
      setSavedNotice(true);
    } catch {
      setError(tr('تعذّر حفظ الإعدادات، حاول مرة تانية', 'Could not save changes. Please try again'));
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (tone: string, prompt: string) => {
    setPersona((previous) => ({ ...previous, tone, systemPrompt: prompt }));
    setSavedNotice(false);
    setShowPresets(false);
  };

  const assistantPage = active === 'assistant';
  const pageTitle = assistantPage ? tr('المساعد الذكي', 'AI assistant') : tr('النماذج ومزودو الخدمة', 'Models & providers');
  const pageIntro = assistantPage
    ? tr('حدد شخصية المساعد وطريقة حديثه وتعليماته في محادثات واتساب', 'Shape how your agent speaks and handles WhatsApp conversations')
    : tr('اختر النموذج والصوت وطريقة الاستجابة للمحادثات', 'Choose the model, voice and response controls your agent uses');

  return (
    <main className="wa-premium-settings" dir={direction} aria-label={tr('الإعدادات', 'Settings')}>
      <nav className="wa-ps-rail" aria-label={tr('التنقل الرئيسي', 'Primary navigation')}>
        <button type="button" className="wa-ps-rail-button" onClick={() => leave(onClose)} title={tr('المحادثات', 'Chats')} aria-label={tr('المحادثات', 'Chats')}><MessageCircle size={21} /><span>{tr('محادثات', 'Chats')}</span></button>
        <span className="wa-ps-rail-button is-disabled" aria-disabled="true" title={tr('قريبًا', 'Coming soon')}><Activity size={21} /><span>{tr('نشاط', 'Activity')}</span></span>
        <button type="button" className="wa-ps-rail-button" onClick={() => onOpenKnowledge && leave(onOpenKnowledge)} disabled={!onOpenKnowledge} title={tr('المعرفة', 'Knowledge')} aria-label={tr('المعرفة', 'Knowledge')}><BookOpen size={21} /><span>{tr('معرفة', 'Knowledge')}</span></button>
        <span className="wa-ps-rail-button is-disabled" aria-disabled="true" title={tr('قريبًا', 'Coming soon')}><Puzzle size={21} /><span>{tr('إضافات', 'Extensions')}</span></span>
        <div className="wa-ps-rail-spacer" />
        <span className="wa-ps-rail-button is-active" aria-current="page"><Settings2 size={21} /><span>{tr('إعدادات', 'Settings')}</span></span>
      </nav>

      <aside className="wa-ps-sidebar" aria-label={tr('أقسام الإعدادات', 'Settings sections')}>
        <div className="wa-ps-side-heading">
          <h2>{tr('الإعدادات', 'Settings')}</h2>
          <p>{tr('إعدادات مساحة العمل والمساعد والتطبيق', 'Workspace, agent and app configuration')}</p>
        </div>
        <div className="wa-ps-side-scroll">
          <p className="wa-ps-nav-label">{tr('مساحة العمل', 'WORKSPACE')}</p>
          <span className="wa-ps-nav-link is-future"><SlidersHorizontal size={17} />{tr('عام', 'General')}<span className="wa-ps-soon">{tr('قريبًا', 'Soon')}</span></span>
          <span className="wa-ps-nav-link is-future"><Users size={17} />{tr('الفريق والصلاحيات', 'Team & access')}</span>
          <span className="wa-ps-nav-link is-future"><Wifi size={17} />{tr('القنوات', 'Channels')}</span>
          <p className="wa-ps-nav-label">{tr('المساعد', 'AGENT')}</p>
          <button type="button" className={`wa-ps-nav-link ${assistantPage ? 'is-selected' : ''}`} onClick={() => navigate('assistant')} aria-current={assistantPage ? 'page' : undefined}><Bot size={18} />{tr('المساعد الذكي', 'AI assistant')}</button>
          <button type="button" className={`wa-ps-nav-link ${!assistantPage ? 'is-selected' : ''}`} onClick={() => navigate('models')} aria-current={!assistantPage ? 'page' : undefined}><Bot size={18} />{tr('النماذج ومزودو الخدمة', 'Models & providers')}</button>
          <span className="wa-ps-nav-link is-future"><Mic2 size={17} />{tr('صوت العلامة', 'Brand voice')}</span>
          <span className="wa-ps-nav-link is-future"><Zap size={17} />{tr('الأتمتة', 'Automations')}</span>
          <button type="button" className="wa-ps-nav-link" onClick={() => onOpenKnowledge && leave(onOpenKnowledge)} disabled={!onOpenKnowledge}><BookOpen size={18} />{tr('المعرفة', 'Knowledge')}<ArrowLeft className="wa-ps-external-arrow" size={14} /></button>
          <p className="wa-ps-nav-label">{tr('التطبيق', 'PLATFORM')}</p>
          <span className="wa-ps-nav-link is-future"><Puzzle size={17} />{tr('الإضافات', 'Extensions')}</span>
          <span className="wa-ps-nav-link is-future"><ShieldCheck size={17} />{tr('البيانات والخصوصية', 'Data & privacy')}</span>
          <span className="wa-ps-nav-link is-future"><Database size={17} />{tr('الاستضافة', 'Deployment')}</span>
        </div>
        <div className="wa-ps-side-foot"><CircleHelp size={16} />{tr('بعض الأقسام ستتاح قريبًا', 'More settings are coming soon')}</div>
      </aside>

      <section className="wa-ps-main" aria-labelledby="wa-ps-title">
        <header className="wa-ps-page-header">
          <div className="wa-ps-header-copy">
            <button type="button" className="wa-ps-mobile-back" onClick={() => leave(onClose)}>{language === 'ar' ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}{tr('المحادثات', 'Back to chats')}</button>
            <div className="wa-ps-breadcrumb"><span>{tr('الإعدادات', 'Settings')}</span><span aria-hidden="true">/</span><strong>{pageTitle}</strong></div>
            <h1 id="wa-ps-title">{pageTitle}</h1>
            <p>{pageIntro}</p>
          </div>
          <div className="wa-ps-header-actions">
            <span className={`wa-ps-save-status ${dirty ? 'is-unsaved' : ''}`} role="status">{dirty ? tr('تغييرات غير محفوظة', 'Unsaved changes') : savedNotice ? tr('تم حفظ التغييرات', 'Changes saved') : tr('كل التغييرات محفوظة', 'All changes saved')}</span>
            <button type="button" className="wa-ps-button wa-ps-button-quiet" onClick={reset} disabled={!dirty || saving}><RotateCcw size={16} />{tr('تراجع', 'Discard')}</button>
            <button type="button" className="wa-ps-button wa-ps-button-primary" onClick={() => void save()} disabled={!dirty || saving}><Save size={16} />{saving ? tr('جارٍ الحفظ', 'Saving') : tr('حفظ التغييرات', 'Save changes')}</button>
          </div>
        </header>

        <div className="wa-ps-scroll-area" key={active}>
          <div className="wa-ps-columns">
            <div className="wa-ps-primary-column">
              {assistantPage ? (
                <>
                  <section className="wa-ps-card">
                    <div className="wa-ps-card-head"><div><h2>{tr('الهوية والشخصية', 'Identity & persona')}</h2><p>{tr('الاسم واللغة والأسلوب الذي يتحدث به المساعد', 'Define the agent’s identity, language and tone')}</p></div><button type="button" className="wa-ps-text-action" onClick={() => setShowPresets((show) => !show)} aria-expanded={showPresets}><SlidersHorizontal size={16} />{tr('قوالب جاهزة', 'Quick presets')}<ChevronDown size={14} /></button></div>
                    <div className="flex items-center gap-3.5 mb-4 p-3 bg-slate-900/40 rounded-xl border border-slate-800/80">
                      <AgentAvatar seed={persona.name || 'Assistant'} size={48} shape="capsule" color="geekblue" />
                      <div>
                        <strong className="block text-sm text-slate-200">{persona.name || tr('مساعد واتساب', 'WhatsApp Assistant')}</strong>
                        <span className="text-xs text-slate-400">{persona.tone || tr('نبرة متوازنة وطبيعية', 'Balanced, natural tone')}</span>
                      </div>
                    </div>
                    {showPresets && <div className="wa-ps-presets"><button type="button" onClick={() => applyPreset('طبيعي وبشوش باللهجة المصرية', ['أنت مسؤول عن مساعدة صاحب الحساب في الرد على رسائل واتساب', 'استخدم عامية مصرية طبيعية، وراعِ سياق كل محادثة', 'لا تختلق معلومات أو مواعيد أو وعودًا غير موجودة في سياق المحادثة'].join('\n'))}><strong>{tr('مصري ودود', 'Friendly Egyptian')}</strong><span>{tr('أسلوب قريب وطبيعي', 'Warm, natural tone')}</span></button><button type="button" onClick={() => applyPreset('مهني وواضح باللغة العربية الفصحى المعاصرة', ['أنت مساعد خدمة عملاء على واتساب', 'قدّم إجابات واضحة ومختصرة بلغة عربية فصحى معاصرة', 'التزم بالمعلومات المتاحة واطلب توضيحًا عند الحاجة'].join('\n'))}><strong>{tr('خدمة العملاء', 'Customer support')}</strong><span>{tr('لغة مهنية واضحة', 'Clear, professional tone')}</span></button></div>}
                    <div className="wa-ps-field-grid">
                      <label className="wa-ps-field"><span>{tr('اسم المساعد', 'Assistant name')}</span><input dir="auto" value={persona.name} onChange={(event) => setField('name', event.target.value)} /></label>
                      <label className="wa-ps-field"><span>{tr('اللغة الأساسية', 'Primary language')}</span><input dir="auto" value={persona.language} onChange={(event) => setField('language', event.target.value)} placeholder={tr('العربية المصرية', 'Arabic (Egypt)')} /></label>
                    </div>
                    <label className="wa-ps-field"><span>{tr('نبرة الحديث', 'Tone of voice')}</span><input dir="auto" value={persona.tone} onChange={(event) => setField('tone', event.target.value)} /></label>
                  </section>
                  <section className="wa-ps-card wa-ps-instructions">
                    <div className="wa-ps-card-head"><div><h2>{tr('التعليمات الأساسية', 'Core instructions')}</h2><p>{tr('يرجع المساعد للتعليمات دي أثناء التعامل مع المحادثات', 'The agent uses these directions when handling conversations')}</p></div></div>
                    <label className="wa-ps-field"><span className="wa-ps-technical-label">{tr('تعليمات المساعد', 'Assistant instructions')}</span><textarea dir="auto" rows={9} value={persona.systemPrompt} onChange={(event) => setField('systemPrompt', event.target.value)} /></label>
                    <div className="wa-ps-field-meta"><span>{tr('تقدر تكتب بالعربية أو الإنجليزية', 'Write in Arabic or English')}</span><span>{persona.systemPrompt.length.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')} {tr('حرف', 'characters')}</span></div>
                  </section>
                </>
              ) : (
                <>
                  <section className="wa-ps-card">
                    <div className="wa-ps-card-head"><div><h2 className="flex items-center gap-2"><Gemini.Color size={22} /> {tr('النموذج الأساسي', 'Primary AI model')}</h2><p>{tr('النموذج المستخدم لفهم الرسائل واتخاذ قرار الرد', 'Select the Gemini model used for conversation decisions')}</p></div></div>
                    <label className="wa-ps-field"><span>{tr('نموذج Gemini', 'Gemini model')}</span><select dir="ltr" value={persona.model} onChange={(event) => setField('model', event.target.value)}><option value="gemini-4-argon">gemini-4-argon</option><option value="gemini-3.8-flash">gemini-3.8-flash</option><option value="gemini-3.1-pro">gemini-3.1-pro</option>{!['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro'].includes(persona.model) && <option value={persona.model}>{persona.model}</option>}</select></label>
                    <div className="wa-ps-detail-row"><span>{tr('مزود الخدمة', 'API provider')}</span><strong className="flex items-center gap-1.5"><Google.Color size={16} /><ModelIcon model={persona.model} size={16} /> Google Gemini</strong></div>
                  </section>
                  <section className="wa-ps-card">
                    <div className="wa-ps-card-head"><div><h2>{tr('الرسائل الصوتية', 'Voice notes')}</h2><p>{tr('اختار الصوت المستخدم في ردود المساعد الصوتية', 'Choose the voice used in audio replies')}</p></div><Headphones size={22} className="wa-ps-muted-icon" /></div>
                    <label className="wa-ps-field"><span>{tr('الصوت', 'Voice')}</span><select dir="ltr" value={persona.voiceName || 'kore'} onChange={(event) => setField('voiceName', event.target.value)}><option value="kore">Kore</option><option value="fenrir">Fenrir</option><option value="puck">Puck</option><option value="aoede">Aoede</option><option value="charon">Charon</option><option value="ar-XA-Chirp3-HD-Fenrir">Chirp 3 HD Fenrir</option></select></label>
                  </section>
                  <section className="wa-ps-card">
                    <div className="wa-ps-card-head"><div><h2>{tr('التحكم في الاستجابة', 'Response controls')}</h2><p>{tr('اضبط شروط الرد والتوقيت في المحادثات', 'Fine-tune when and how the agent responds')}</p></div></div>
                    <label className="wa-ps-range"><span>{tr('الحد الأدنى للثقة', 'Minimum confidence')}</span><strong dir="ltr">{Math.round(persona.minConfidence * 100)}%</strong><input type="range" min="0.5" max="0.95" step="0.05" value={persona.minConfidence} onChange={(event) => setField('minConfidence', Number(event.target.value))} /><small>{tr('الحد المطلوب قبل إرسال رد تلقائي', 'Confidence required before sending an automatic reply')}</small></label>
                    <label className="wa-ps-switch-row"><span><strong>{tr('محاكاة الكتابة الطبيعية', 'Natural typing delay')}</strong><small>{tr('انتظار قصير قبل إرسال الردود التلقائية', 'Pause briefly before sending automatic replies')}</small></span><input type="checkbox" role="switch" checked={persona.simulateTypingDelay} onChange={(event) => setField('simulateTypingDelay', event.target.checked)} /></label>
                  </section>
                </>
              )}
            </div>
            <aside className="wa-ps-context-column" aria-label={tr('معلومات مساعدة', 'Contextual information')}>
              {assistantPage ? (
                <>
                  <section className="wa-ps-card wa-ps-preview"><div className="wa-ps-card-head"><div><h2>{tr('جرّب مساعدك', 'Try your assistant')}</h2><p>{tr('اختبر طريقة تعامله مع رسالة تجريبية', 'Preview how the agent handles a sample message')}</p></div></div><div className="wa-ps-preview-message"><div className="wa-ps-example-label">{tr('مثال توضيحي', 'Illustrative example')}</div><div className="wa-ps-bubble is-incoming">{tr('مرحبًا، ممكن أعرف تفاصيل التوصيل؟', 'Hi! Can I get the delivery details?')}</div><div className="wa-ps-bubble is-outgoing">{tr('أهلًا بيك، أكيد أقدر أساعدك، تحب التوصيل لأي مدينة؟', 'Of course! What city would you like delivery to?')}</div></div><button type="button" className="wa-ps-button wa-ps-button-outline wa-ps-test-button" onClick={onOpenSimulator} disabled={!onOpenSimulator}><Send size={16} />{tr('اختبار رد حقيقي', 'Test a real response')}{language === 'ar' ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}</button></section>
                  <section className="wa-ps-card"><div className="wa-ps-card-head"><div><h2>{tr('حالة المساعد', 'Agent status')}</h2><p>{tr('معلومات من إعداداتك الحالية', 'Your current configuration')}</p></div></div><div className="wa-ps-status-line"><span className={`wa-ps-status-dot ${connected ? 'is-online' : ''}`} />{connected ? tr('واتساب متصل', 'WhatsApp connected') : tr('واتساب غير متصل', 'WhatsApp not connected')}</div><div className="wa-ps-detail-row"><span>{tr('النموذج', 'AI model')}</span><strong dir="ltr">{persona.model}</strong></div><div className="wa-ps-detail-row"><span>{tr('اللغة', 'Language')}</span><strong dir="auto">{persona.language}</strong></div></section>
                </>
              ) : (
                <>
                  <section className="wa-ps-card wa-ps-explainer"><h2>{tr('كيف تُستخدم الإعدادات؟', 'How these settings work')}</h2><ol><li><strong>{tr('رسالة واردة', 'Incoming message')}</strong><p>{tr('العميل يبعت رسالة على واتساب', 'A customer sends a WhatsApp message')}</p></li><li><strong>{tr('فهم السياق', 'Model evaluates context')}</strong><p>{tr('النموذج يراجع التعليمات والمعلومات المتاحة', 'The model checks instructions and available context')}</p></li><li><strong>{tr('اختيار الرد', 'Agent responds')}</strong><p>{tr('المساعد يحدد الرد المناسب حسب إعداداتك', 'The agent chooses a response using your settings')}</p></li></ol></section>
                  <section className="wa-ps-card"><h2>{tr('التكوين الحالي', 'Current configuration')}</h2><div className="wa-ps-detail-row"><span>{tr('المزود', 'Provider')}</span><strong>Google Gemini</strong></div><div className="wa-ps-detail-row"><span>{tr('النموذج', 'Model')}</span><strong dir="ltr">{persona.model}</strong></div><div className="wa-ps-detail-row"><span>{tr('الصوت', 'Voice')}</span><strong dir="ltr">{persona.voiceName || 'kore'}</strong></div><button type="button" className="wa-ps-button wa-ps-button-outline wa-ps-test-button" onClick={onOpenSimulator} disabled={!onOpenSimulator}><Send size={16} />{tr('اختبار الاستجابة', 'Test response')}</button></section>
                </>
              )}
              <p className="wa-ps-context-note"><LockKeyhole size={15} />{tr('إعدادات المساعد محفوظة على استضافتك', 'Agent settings are stored on your own host')}</p>
            </aside>
          </div>
          {error && <p className="wa-ps-error" role="alert">{error}</p>}
          <div className="wa-ps-bottom-space" />
        </div>
      </section>
    </main>
  );
}
