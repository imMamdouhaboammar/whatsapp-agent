import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LocaleContext, type Language } from './locale-context';
import { ConfigProvider } from '@lobehub/ui';
// react-doctor-disable-next-line react-doctor/use-lazy-motion
import { motion } from 'motion/react';
const STORAGE_KEY = 'whatsapp-agent-language';

function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'ar';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: Language }) {
  const [language, setLanguage] = useState<Language>(() => initial ?? initialLanguage());

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // The current session can still switch languages when storage is unavailable.
    }
  }, [language]);

  const tr = useCallback((arabic: string, english: string) => language === 'ar' ? arabic : english, [language]);
  const value = useMemo(() => ({
    language,
    direction: language === 'ar' ? 'rtl' as const : 'ltr' as const,
    setLanguage,
    tr
  }), [language, tr]);

  return (
    <LocaleContext.Provider value={value}>
      <ConfigProvider motion={motion} direction={value.direction} locale={value.language} enableCustomFonts={false}>
        {children}
      </ConfigProvider>
    </LocaleContext.Provider>
  );
}
