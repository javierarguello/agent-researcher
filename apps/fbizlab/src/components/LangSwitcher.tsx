import { LANGS, LANG_LABELS, useLang } from '../i18n';

/** Compact segmented language switcher (EN · ES · FR · PT) covering every API language. */
export function LangSwitcher() {
  const { lang, setLang } = useLang();
  return (
    <div className="langseg" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={lang === l ? 'on' : ''}
          aria-pressed={lang === l}
          title={LANG_LABELS[l]}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
