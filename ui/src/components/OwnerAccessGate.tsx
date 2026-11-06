import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, LockKeyhole, LogOut, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { useLocale } from '../locale-context';
import { OwnerAccessContext } from './owner-access-context';
import './owner-access.css';

type AccessState = 'checking' | 'ready' | 'locked' | 'error';

export function OwnerSignOutButton({ onSignOut, pending }: { onSignOut: () => Promise<void>; pending: boolean }) {
  const { tr } = useLocale();
  return <button
    type="button" className="wa-icon-button wa-owner-signout"
    onClick={() => void onSignOut()} disabled={pending}
    aria-label={tr('تسجيل الخروج', 'Sign out')} title={tr('تسجيل الخروج', 'Sign out')}
  ><LogOut size={18} aria-hidden="true" /></button>;
}

export function OwnerAccessGate({ children }: { children: ReactNode }) {
  const { tr, direction } = useLocale();
  const [access, setAccess] = useState<AccessState>('checking');
  const [required, setRequired] = useState(false);

  const checkAccess = useCallback(async () => {
    try {
      const result = await api.getDashboardStatus();
      setRequired(result.required);
      setAccess(result.required && !result.authenticated ? 'locked' : 'ready');
    } catch {
      setAccess('error');
    }
  }, []);

  useEffect(() => {
    void checkAccess();
    window.addEventListener('focus', checkAccess);
    return () => window.removeEventListener('focus', checkAccess);
  }, [checkAccess]);

  const signOut = async () => {
    await api.endDashboardSession();
    setAccess('locked');
  };

  if (access === 'ready') return <OwnerAccessContext.Provider value={{ required, signOut }}>{children}</OwnerAccessContext.Provider>;
  if (access === 'checking') {
    return <main className="wa-owner-access-screen" dir={direction} role="status">
      <div className="wa-owner-loading"><LockKeyhole size={22} /><p>{tr('جارٍ فتح مساحة العمل', 'Opening your workspace')}</p></div>
    </main>;
  }

  return <OwnerAccessLogin
    connectionError={access === 'error'}
    onRetry={checkAccess}
    onLogin={async (token) => {
      await api.startDashboardSession(token);
      setAccess('ready');
    }}
  />;
}

export function OwnerAccessLogin({
  onLogin, onRetry, connectionError = false
}: {
  onLogin: (token: string) => Promise<void>;
  onRetry: () => void;
  connectionError?: boolean;
}) {
  const { language, setLanguage, direction, tr } = useLocale();
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onLogin(token);
      setToken('');
    } catch {
      setError(tr('رمز الوصول غير صحيح، حاول تاني', 'That access token did not work. Try again'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="wa-owner-access-screen" dir={direction}>
      <div className="wa-owner-access-card">
        <aside className="wa-owner-access-brand">
          <div className="wa-owner-brand-logo" dir="ltr"><MessageCircle size={21} /><span>WhatsApp <strong>Agent</strong></span></div>
          <div className="wa-owner-brand-content">
            <span className="wa-owner-eyebrow"><ShieldCheck size={16} /> {tr('مساحة خاصة', 'Private workspace')}</span>
            <h1>{tr('محادثات عملائك، في مكان واحد', 'Customer conversations, in one place')}</h1>
            <p>{tr('المساعد وإعداداته وبيانات البراند متاحة لأصحاب الوصول فقط', 'Your assistant, brand knowledge and conversations stay within your workspace')}</p>
          </div>
          <div className="wa-owner-brand-footer">{tr('مستضاف عندك', 'Self-hosted')} · WhatsApp Agent</div>
        </aside>
        <section className="wa-owner-access-form-section" aria-labelledby="wa-owner-title">
          <button type="button" className="wa-owner-language" onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')} aria-label={tr('غيّر اللغة', 'Switch language')}>
            {language === 'ar' ? 'EN' : 'عربي'}
          </button>
          <div className="wa-owner-form-content">
            <div className="wa-owner-form-icon"><LockKeyhole size={23} /></div>
            <p className="wa-owner-form-kicker">{tr('دخول المالك', 'Owner access')}</p>
            <h2 id="wa-owner-title">{tr('الدخول لمساحة العمل', 'Access your workspace')}</h2>
            <p className="wa-owner-description">{tr('اكتب رمز الوصول اللي حددته وقت إعداد الاستضافة', 'Enter the access token you set when hosting the app')}</p>
            {connectionError ? (
              <div className="wa-owner-auth-error" role="alert">
                {tr('تعذّر الاتصال بالتطبيق', 'Could not reach the app')}
                <button type="button" onClick={onRetry}><RefreshCw size={15} /> {tr('إعادة المحاولة', 'Try again')}</button>
              </div>
            ) : (
              <form onSubmit={(event) => void submit(event)} noValidate>
                <label htmlFor="wa-owner-token">{tr('رمز الوصول', 'Access token')}</label>
                <input
                  id="wa-owner-token" name="owner-token" type="password" autoComplete="current-password"
                  value={token} onChange={(event) => { setToken(event.target.value); setError(''); }}
                  required maxLength={512} aria-invalid={Boolean(error)} aria-describedby={error ? 'wa-owner-error' : undefined}
                />
                {error && <p className="wa-owner-auth-error" id="wa-owner-error" role="alert">{error}</p>}
                <button className="wa-owner-submit" type="submit" disabled={submitting || !token.trim()}>
                  {submitting ? tr('جارٍ التحقق', 'Checking access') : tr('دخول', 'Continue')}
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
