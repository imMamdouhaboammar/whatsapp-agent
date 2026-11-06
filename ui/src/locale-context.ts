import { createContext, useContext } from 'react';

export type Language = 'ar' | 'en';

export interface LocaleContextValue {
  language: Language;
  direction: 'rtl' | 'ltr';
  setLanguage: (language: Language) => void;
  tr: (arabic: string, english: string) => string;
}

export const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale requires LocaleProvider');
  return context;
}
