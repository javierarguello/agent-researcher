import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** Supported UI languages — MUST match the API's manifest `lang` set (SUPPORTED_LANGS). */
export const LANGS = ['en', 'es', 'fr', 'pt'] as const;
export type Lang = (typeof LANGS)[number];
/** Native language names for the switcher. */
export const LANG_LABELS: Record<Lang, string> = { en: 'English', es: 'Español', fr: 'Français', pt: 'Português' };

const KEY = 'fbizlab_lang';
const isLang = (v: string): v is Lang => (LANGS as readonly string[]).includes(v);

interface LangState { lang: Lang; setLang: (l: Lang) => void; }
const LangContext = createContext<LangState | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(KEY) ?? navigator.language.slice(0, 2);
    return saved && isLang(saved) ? saved : 'en';
  });
  const setLang = (l: Lang) => { localStorage.setItem(KEY, l); setLangState(l); };
  const value = useMemo(() => ({ lang, setLang }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangState {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within <LangProvider>');
  return ctx;
}

/** Pick a value from a localized dict, falling back to English. */
export function pick<T>(dict: Partial<Record<Lang, T>>, lang: Lang): T {
  return (dict[lang] ?? dict.en) as T;
}
