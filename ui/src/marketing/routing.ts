export type PublicRoute =
  | { type: 'funnel' }
  | { type: 'landing'; vertical: string };

export function parsePublicRoute(pathname?: string): PublicRoute | null {
  if (typeof window === 'undefined' && !pathname) return null;
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  if (!path) return null;
  if (path === '/start' || path === '/start/') {
    return { type: 'funnel' };
  }
  if (path.startsWith('/lp/')) {
    const raw = path.slice(4).replace(/\/$/, '') || 'clinics';
    return { type: 'landing', vertical: raw };
  }
  return null;
}

export function isPublicMarketingRoute(pathname?: string): boolean {
  return parsePublicRoute(pathname) !== null;
}
