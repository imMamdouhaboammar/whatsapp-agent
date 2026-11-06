import { useState } from 'react';
import { ArrowRight, Save, Settings2 } from 'lucide-react';
import type { ModeratorPersona, PolicyConfig } from '../api/types';
import { useLocale } from '../locale-context';

interface PersonaSettingsPageProps {
  onClose: () => void;
  initialPersona?: ModeratorPersona;
  error?: boolean;
  onRetry?: () => void;
  onSave: (persona: Partial<ModeratorPersona>, policy?: Partial<PolicyConfig>) => Promise<void>;
}

export function PersonaSettingsPage(props: PersonaSettingsPageProps) {
  const { tr } = useLocale();
  if (!props.initialPersona) {
    return (
      <main className="wa-settings-page">
        <div className="wa-settings-page-inner">
          <header className="wa-settings-page-header">
            <button type="button" className="wa-settings-back" onClick={props.onClose}><ArrowRight size={18} />{tr('المحادثات', 'Chats')}</button>
            <h1>{tr('إعدادات المساعد الذكي', 'AI assistant settings')}</h1>
          </header>
          <div className="wa-settings-loading" role={props.error ? 'alert' : 'status'}>
            <p>{props.error ? tr('تعذّر تحميل الإعدادات', 'Could not load settings') : tr('جارٍ تحميل الإعدادات', 'Loading settings')}</p>
            {props.error && <button type="button" className="wa-secondary-button" onClick={props.onRetry}>{tr('إعادة المحاولة', 'Try again')}</button>}
          </div>
        </div>
      </main>
    );
  }
  return <PersonaEditor initialPersona={props.initialPersona} onClose={props.onClose} onSave={props.onSave} />;
}

function PersonaEditor({ onClose, initialPersona, onSave }: {
  onClose: () => void;
  initialPersona: ModeratorPersona;
  onSave: PersonaSettingsPageProps['onSave'];
}) {
  const { tr } = useLocale();
  const [persona, setPersona] = useState<ModeratorPersona>(() => ({
    ...initialPersona,
    rules: [...initialPersona.rules]
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(persona);
      onClose();
    } catch {
      setError(tr('تعذّر حفظ الإعدادات، حاول مرة تانية', 'Could not save settings. Try again'));
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (tone: string, prompt: string) => setPersona({ ...persona, tone, systemPrompt: prompt });

  return (
    <main className="wa-settings-page" aria-labelledby="persona-title">
      <div className="wa-settings-page-inner">
        <header className="wa-settings-page-header">
          <div className="wa-settings-page-title">
            <button type="button" className="wa-settings-back" onClick={onClose}><ArrowRight size={18} />{tr('المحادثات', 'Chats')}</button>
            <div className="wa-settings-heading">
              <span className="wa-modal-icon"><Settings2 size={20} /></span>
              <div>
                <h1 id="persona-title">{tr('إعدادات المساعد الذكي', 'AI assistant settings')}</h1>
                <p>{tr('الشخصية، النموذج وطريقة الرد', 'Persona, model and response behavior')}</p>
              </div>
            </div>
          </div>
        </header>
        <div className="wa-settings-page-scroll">
          <div className="wa-settings-page-content wa-settings-content">
          <section className="wa-settings-section">
            <h3>{tr('قوالب جاهزة', 'Quick presets')}</h3>
            <div className="wa-presets">
              <button type="button" onClick={() => applyPreset(
                'طبيعي وبشوش باللهجة المصرية',
                ['أنت مسؤول عن مساعدة صاحب الحساب في الرد على رسائل واتساب',
                  'استخدم عامية مصرية طبيعية، وراعِ سياق كل محادثة',
                  'لا تختلق معلومات أو مواعيد أو وعودًا غير موجودة في سياق المحادثة'].join('\n')
              )}>
                <span>🇪🇬</span><strong>{tr('مصري ودود', 'Friendly Egyptian')}</strong><small>{tr('أسلوب شخصي وطبيعي', 'Warm personal tone')}</small>
              </button>
              <button type="button" onClick={() => applyPreset(
                'مهني وواضح باللغة العربية الفصحى المعاصرة',
                ['أنت مساعد خدمة عملاء على واتساب',
                  'قدّم إجابات واضحة ومختصرة بلغة عربية فصحى معاصرة',
                  'التزم بالمعلومات المتاحة واطلب توضيحًا عند الحاجة'].join('\n')
              )}>
                <span>💼</span><strong>{tr('خدمة العملاء', 'Customer support')}</strong><small>{tr('لغة رسمية واضحة', 'Clear professional tone')}</small>
              </button>
            </div>
          </section>

          <section className="wa-settings-section">
            <h3>{tr('الشخصية', 'Persona')}</h3>
            <div className="wa-settings-grid">
              <label className="wa-field">
                <span>{tr('اسم المساعد', 'Assistant name')}</span>
                <input value={persona.name} onChange={(event) => setPersona({ ...persona, name: event.target.value })} />
              </label>
              <label className="wa-field">
                <span>{tr('نبرة الحديث', 'Tone of voice')}</span>
                <input dir="auto" value={persona.tone} onChange={(event) => setPersona({ ...persona, tone: event.target.value })} />
              </label>
            </div>
            <label className="wa-field">
              <span>{tr('تعليمات المساعد', 'Assistant instructions')}</span>
              <textarea dir="auto" rows={5} value={persona.systemPrompt} onChange={(event) => setPersona({ ...persona, systemPrompt: event.target.value })} />
            </label>
          </section>

          <section className="wa-settings-section">
            <h3>{tr('النموذج والصوت', 'Model & voice')}</h3>
            <div className="wa-settings-grid">
              <label className="wa-field">
                <span>{tr('نموذج Gemini', 'Gemini model')}</span>
                <select dir="ltr" value={persona.model} onChange={(event) => setPersona({ ...persona, model: event.target.value })}>
                  <option value="gemini-4-argon">gemini-4-argon</option>
                  <option value="gemini-3.8-flash">gemini-3.8-flash</option>
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                </select>
              </label>
              <label className="wa-field">
                <span>{tr('صوت الرسائل', 'Voice-note voice')}</span>
                <select dir="ltr" value={persona.voiceName || 'kore'} onChange={(event) => setPersona({ ...persona, voiceName: event.target.value })}>
                  <option value="kore">Kore</option>
                  <option value="fenrir">Fenrir</option>
                  <option value="puck">Puck</option>
                  <option value="aoede">Aoede</option>
                  <option value="charon">Charon</option>
                  <option value="ar-XA-Chirp3-HD-Fenrir">Chirp 3 HD Fenrir</option>
                </select>
              </label>
            </div>
          </section>

          <section className="wa-settings-section">
            <h3>{tr('التحكم في الردود', 'Response controls')}</h3>
            <label className="wa-field wa-range-field">
              <span>{tr('الحد الأدنى للثقة', 'Minimum confidence')} <b dir="ltr">{Math.round(persona.minConfidence * 100)}%</b></span>
              <input type="range" min=".5" max=".95" step=".05" value={persona.minConfidence} onChange={(event) => setPersona({ ...persona, minConfidence: Number(event.target.value) })} />
            </label>
            <label className="wa-toggle-row">
              <span>
                <strong>{tr('محاكاة الكتابة الطبيعية', 'Natural typing delay')}</strong>
                <small>{tr('انتظار قصير قبل إرسال الردود التلقائية', 'A short pause before automatic replies')}</small>
              </span>
              <input type="checkbox" checked={persona.simulateTypingDelay} onChange={(event) => setPersona({ ...persona, simulateTypingDelay: event.target.checked })} />
            </label>
          </section>
          {error && <p className="wa-inline-error" role="alert">{error}</p>}
          </div>
        </div>
        <footer className="wa-settings-page-footer">
          <button type="button" className="wa-primary-button" disabled={saving} onClick={() => void handleSave()}><Save size={16} /> {saving ? tr('جارٍ الحفظ', 'Saving') : tr('حفظ الإعدادات', 'Save settings')}</button>
        </footer>
      </div>
    </main>
  );
}

