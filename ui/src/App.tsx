import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { parsePublicRoute, type PublicRoute } from './marketing/routing';
import { InteractiveLeadFunnel } from './marketing/lead-funnel/InteractiveLeadFunnel';
import { LandingPage } from './marketing/landing/LandingPage';
import { CLINICS_VERTICAL } from './marketing/landing/data/verticals/clinics';

// For SSR environments (e.g. tests using renderToStaticMarkup in Node/Vite SSR):
let SsrDashboardCockpit: ComponentType | null = null;
if (typeof window === 'undefined') {
  try {
    const mod = await import('./components/DashboardCockpit');
    SsrDashboardCockpit = mod.DashboardCockpit;
  } catch {
    // browser or client bundling ignores this
  }
}

// Client-side lazy-loaded cockpit so marketing & lead-funnel chunks stay lightweight (< 80 kB)
const LazyDashboardCockpit = lazy(() =>
  import('./components/DashboardCockpit').then((m) => ({ default: m.DashboardCockpit }))
);

function WhatsAppIcon({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export function App({ initialPath }: { initialPath?: string } = {}) {
  const [publicRoute, setPublicRoute] = useState<PublicRoute | null>(() => parsePublicRoute(initialPath));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setPublicRoute(parsePublicRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (publicRoute?.type === 'funnel') {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center px-4 py-8 sm:py-12">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <header className="flex items-center justify-between border-b border-slate-800 pb-4">
            <a
              href="/lp/clinics"
              className="flex items-center gap-2 text-sm font-bold text-white hover:text-emerald-400 transition"
            >
              <WhatsAppIcon size={22} className="text-emerald-400" />
              <span>WhatsApp Agent</span>
            </a>
            <span className="text-xs text-slate-400">تقييم تفاعلي فوري (16 خطوة)</span>
          </header>
          <InteractiveLeadFunnel />
        </div>
      </main>
    );
  }

  if (publicRoute?.type === 'landing') {
    const verticalConfig = publicRoute.vertical === 'clinics' ? CLINICS_VERTICAL : CLINICS_VERTICAL;
    return <LandingPage vertical={verticalConfig} />;
  }

  if (typeof window === 'undefined' && SsrDashboardCockpit) {
    return <SsrDashboardCockpit />;
  }

  return (
    <Suspense
      fallback={
        <div
          className="wa-owner-loading"
          style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <p>جارٍ تحميل لوحة التحكم...</p>
        </div>
      }
    >
      <LazyDashboardCockpit />
    </Suspense>
  );
}

export default App;
