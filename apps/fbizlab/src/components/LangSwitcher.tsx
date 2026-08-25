import { useLocation } from 'react-router-dom';
import { LANGS, LANG_LABELS, isLandingPath, landingPath, useLang } from '../i18n';

/**
 * Compact segmented language switcher (EN · ES · FR · PT) covering every API language.
 *
 * **On a landing path it renders anchors, everywhere else buttons**, and that is an
 * SEO fix rather than a style choice. `/es`, `/fr` and `/pt` are real prerendered
 * pages with their own localized `<title>`, description and FAQ JSON-LD — and until
 * now NOTHING linked to them. The switcher was buttons, the sitemap named a dead
 * host, and the hreflang alternates named the same dead host, so all three
 * translations were orphans: no crawlable path in, from anywhere. Three languages of
 * translation work that no search engine could reach.
 *
 * Off the landing the anchors would be lies — there is no `/es/app/credits`, the
 * language there is a stored preference — so those stay buttons. `setLang` already
 * knows the difference and navigates only on landing paths; this mirrors that rule
 * in the markup instead of restating it.
 *
 * `onClick` + `preventDefault` keeps it a client-side navigation for a person, while
 * the `href` is what a crawler (and a middle-click, and "copy link address") needs.
 */
export function LangSwitcher() {
  const { lang, setLang } = useLang();
  const { pathname } = useLocation();
  const crawlable = isLandingPath(pathname);

  return (
    <div className="langseg" role="group" aria-label="Language">
      {LANGS.map((l) =>
        crawlable ? (
          <a
            key={l}
            href={landingPath(l)}
            className={lang === l ? 'on' : ''}
            aria-current={lang === l ? 'true' : undefined}
            title={LANG_LABELS[l]}
            onClick={(e) => { e.preventDefault(); setLang(l); }}
          >
            {l.toUpperCase()}
          </a>
        ) : (
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
        ),
      )}
    </div>
  );
}
