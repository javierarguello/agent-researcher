import { LANGS, LANG_LABELS, useLang, type Lang } from '../i18n';

/** Compact language switcher covering every API-supported language. */
export function LangSwitcher() {
  const { lang, setLang } = useLang();
  return (
    <select
      className="langsel"
      aria-label="Language"
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
    >
      {LANGS.map((l) => (
        <option key={l} value={l}>{LANG_LABELS[l]}</option>
      ))}
    </select>
  );
}
