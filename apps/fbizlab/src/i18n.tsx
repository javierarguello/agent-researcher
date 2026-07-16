import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Supported UI languages — MUST match the API's manifest `lang` set (SUPPORTED_LANGS). */
export const LANGS = ['en', 'es', 'fr', 'pt'] as const;
export type Lang = (typeof LANGS)[number];
/** Native language names for the switcher. */
export const LANG_LABELS: Record<Lang, string> = { en: 'English', es: 'Español', fr: 'Français', pt: 'Português' };

const KEY = 'fbizlab_lang';
const isLang = (v: string): v is Lang => (LANGS as readonly string[]).includes(v);

/**
 * The public landing carries its language in the URL for SEO: `/` = English
 * (x-default), `/es` `/fr` `/pt` for the rest. Non-English maps to a path prefix;
 * English stays at the bare path. Returns the URL language, or null when the path
 * has none (root `/`, or the private `/app` and `/login` areas).
 */
function langInPath(pathname: string): Lang | null {
  const seg = pathname.split('/')[1] ?? '';
  return isLang(seg) ? seg : null;
}
/** Landing routes (where the language belongs in the URL). */
function isLandingPath(pathname: string): boolean {
  return pathname === '/' || langInPath(pathname) !== null;
}

interface LangState { lang: Lang; setLang: (l: Lang) => void; }
const LangContext = createContext<LangState | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Preference used off the landing (private app/login pages carry no URL lang).
  const [stored, setStored] = useState<Lang>(() => {
    const saved = localStorage.getItem(KEY) ?? navigator.language.slice(0, 2);
    return saved && isLang(saved) ? saved : 'en';
  });

  const urlLang = langInPath(location.pathname);
  // On the landing the URL is authoritative (root `/` is canonical English);
  // elsewhere fall back to the stored preference.
  const lang: Lang = urlLang ?? (location.pathname === '/' ? 'en' : stored);

  // Keep the stored preference in sync when a URL language is present, so moving
  // from `/es` into `/login` keeps Spanish.
  useEffect(() => {
    if (urlLang && urlLang !== stored) { localStorage.setItem(KEY, urlLang); setStored(urlLang); }
  }, [urlLang, stored]);

  const setLang = (l: Lang) => {
    localStorage.setItem(KEY, l);
    setStored(l);
    // On the landing, the language lives in the URL — navigate to keep it crawlable.
    if (isLandingPath(location.pathname)) navigate(l === 'en' ? '/' : `/${l}`);
  };

  const value = useMemo(() => ({ lang, setLang }), [lang, location.pathname]);
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
