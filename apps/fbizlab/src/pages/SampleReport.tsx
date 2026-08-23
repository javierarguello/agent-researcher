import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { ReportViewer } from '../components/ReportViewer';
import type { TemplateManifest } from '../api/types';

/**
 * The public sample dossier — the landing's "see a sample summary", made real.
 *
 * Anonymous and API-free by construction: it fetches ONE static file
 * (`/sample-dossier.json`, written by `scripts/build-sample.ts` from a real paid
 * run) and renders it through the same `ReportViewer` a buyer's own report goes
 * through. No session, no `/templates` call — that endpoint is authenticated, which
 * is why the section titles, the cover spec and the mandate figures are baked into
 * the file rather than fetched.
 *
 * No PDF: the download is a paid artifact behind a job the visitor does not own.
 *
 * The dossier is 196 kB and is NOT bundled — it is fetched when this route is
 * opened, so the landing pays nothing for it.
 */
/** Exported for `copy-parity.test.tsx`: every language must carry every key. */
export const T = {
  en: {
    banner: 'Sample dossier',
    back: '← Florida Biz Labs',
    cta: 'Run one on your criteria',
    heading: 'A real dossier, exactly as it was produced',
    body: 'Nothing here was written or tidied up by hand. This is one complete report from a real run: the analysts searched the live market, and the shortlist, figures, charts and sources are what they came back with.',
    caveat: 'Listings move fast — the businesses below were on the market on the day of the run and may be gone. Figures come from listings and third-party sources and are not independently verified.',
    englishNote: 'This sample was researched in English, so the dossier itself is in English.',
    reqL: 'The request behind it',
    fields: { industry: 'Industry', location: 'Where', price: 'Asking price', mode: 'Report tier', cost: 'What it costs' },
    credits: 'credits',
    loading: 'Loading the sample dossier…',
    failed: 'The sample could not be loaded. Please try again.',
  },
  es: {
    banner: 'Dossier de ejemplo',
    back: '← Florida Biz Labs',
    cta: 'Genera uno con tus criterios',
    heading: 'Un dossier real, tal como se produjo',
    body: 'Nada de esto fue escrito ni retocado a mano. Es un reporte completo de una corrida real: los analistas buscaron en el mercado en vivo, y la lista corta, las cifras, los gráficos y las fuentes son lo que encontraron.',
    caveat: 'Los avisos se mueven rápido — los negocios de abajo estaban en venta el día de la corrida y pueden ya no estarlo. Las cifras vienen de los avisos y de fuentes de terceros, y no se verifican de forma independiente.',
    englishNote: 'Este ejemplo se investigó en inglés, así que el dossier está en inglés.',
    reqL: 'La solicitud que lo originó',
    fields: { industry: 'Industria', location: 'Dónde', price: 'Precio de venta', mode: 'Nivel del reporte', cost: 'Lo que cuesta' },
    credits: 'créditos',
    loading: 'Cargando el dossier de ejemplo…',
    failed: 'No se pudo cargar el ejemplo. Inténtalo de nuevo.',
  },
  fr: {
    banner: 'Dossier d’exemple',
    back: '← Florida Biz Labs',
    cta: 'Lancez-en un sur vos critères',
    heading: 'Un vrai dossier, tel qu’il a été produit',
    body: 'Rien ici n’a été écrit ni retouché à la main. C’est un rapport complet issu d’une vraie exécution : les analystes ont cherché sur le marché en direct, et la liste, les chiffres, les graphiques et les sources sont ce qu’ils ont rapporté.',
    caveat: 'Les annonces bougent vite — les affaires ci-dessous étaient à vendre le jour de l’exécution et peuvent ne plus l’être. Les chiffres proviennent des annonces et de sources tierces, sans vérification indépendante.',
    englishNote: 'Cet exemple a été recherché en anglais, le dossier est donc en anglais.',
    reqL: 'La demande à l’origine',
    fields: { industry: 'Secteur', location: 'Où', price: 'Prix demandé', mode: 'Niveau du rapport', cost: 'Ce que cela coûte' },
    credits: 'crédits',
    loading: 'Chargement du dossier d’exemple…',
    failed: 'Impossible de charger l’exemple. Veuillez réessayer.',
  },
  pt: {
    banner: 'Dossiê de exemplo',
    back: '← Florida Biz Labs',
    cta: 'Gere um com seus critérios',
    heading: 'Um dossiê real, exatamente como foi produzido',
    body: 'Nada aqui foi escrito ou ajustado à mão. É um relatório completo de uma execução real: os analistas pesquisaram o mercado ao vivo, e a lista, os números, os gráficos e as fontes são o que eles trouxeram.',
    caveat: 'Os anúncios mudam rápido — os negócios abaixo estavam à venda no dia da execução e podem não estar mais. Os números vêm de anúncios e de fontes de terceiros e não são verificados de forma independente.',
    englishNote: 'Este exemplo foi pesquisado em inglês, portanto o dossiê está em inglês.',
    reqL: 'O pedido que o originou',
    fields: { industry: 'Setor', location: 'Onde', price: 'Preço pedido', mode: 'Nível do relatório', cost: 'Quanto custa' },
    credits: 'créditos',
    loading: 'Carregando o dossiê de exemplo…',
    failed: 'Não foi possível carregar o exemplo. Tente novamente.',
  },
};

interface Dossier {
  title?: string;
  sections: Array<{ key: string; title: string }>;
  cover?: TemplateManifest['cover'];
  coverLabels?: TemplateManifest['coverLabels'];
  currency?: string;
  request: { modeLabel?: string | null; languageLabel?: string | null; sourcesFound?: number | null; creditsSpent?: number | null };
  params: Record<string, unknown>;
  meta: Record<string, unknown>;
  report: Record<string, unknown>;
}

/** `$150,000 – $3,000,000`, in the reader's grouping, with an open end when a bound is missing. */
function priceRange(params: Record<string, unknown>, lang: string, currency = 'USD'): string | null {
  const min = typeof params.askingPriceMin === 'number' ? params.askingPriceMin : null;
  const max = typeof params.askingPriceMax === 'number' ? params.askingPriceMax : null;
  if (min == null && max == null) return null;
  const money = (n: number) => new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  if (min != null && max != null) return `${money(min)} – ${money(max)}`;
  return min != null ? `${money(min)} +` : `≤ ${money(max!)}`;
}

export function SampleReport() {
  const { lang } = useLang();
  const t = T[lang as keyof typeof T] ?? T.en;

  const dossier = useQuery({
    queryKey: ['sample-dossier'],
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<Dossier> => {
      const res = await fetch('/sample-dossier.json');
      if (!res.ok) throw new Error(`sample ${res.status}`);
      return res.json() as Promise<Dossier>;
    },
  });

  const d = dossier.data;
  // The report's own language, never the reader's — the same rule the shared read
  // link follows: this dossier was researched in English and its numbers are dollars.
  const reportLang = String(d?.meta?.language ?? 'en');
  const price = d ? priceRange(d.params, lang, d.currency) : null;

  return (
    <div className="read-shell">
      <div className="read-banner mono">
        <Link to="/">{t.back}</Link>
        <span>{t.banner}</span>
        <Link className="btn btn--black btn--sm" to="/login">{t.cta}</Link>
      </div>
      <div className="read-body">
        <div className="card" style={{ padding: 22, marginBottom: 24 }}>
          <div className="stack" style={{ gap: 10 }}>
            <h2 style={{ margin: 0 }}>{t.heading}</h2>
            <p className="soft" style={{ margin: 0, lineHeight: 1.6 }}>{t.body}</p>
            {reportLang !== lang && <p className="mono soft" style={{ margin: 0, fontSize: 12 }}>{t.englishNote}</p>}
            {d && (
              <>
                <div className="mono soft" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 6 }}>{t.reqL}</div>
                <div className="sample__rows">
                  {([
                    [t.fields.industry, typeof d.params.industry === 'string' ? d.params.industry : null],
                    [t.fields.location, typeof d.params.location === 'string' ? d.params.location : null],
                    [t.fields.price, price],
                    [t.fields.mode, d.request.modeLabel ?? null],
                    [t.fields.cost, d.request.creditsSpent != null ? `${d.request.creditsSpent} ${t.credits}` : null],
                  ] as Array<[string, string | null]>)
                    .filter(([, v]) => !!v)
                    .map(([k, v]) => (
                      <div key={k} className="sample__row"><span className="mono">{k}</span><b>{v}</b></div>
                    ))}
                </div>
              </>
            )}
            <p className="fineprint" style={{ margin: '6px 0 0' }}>{t.caveat}</p>
          </div>
        </div>

        {dossier.isPending && <p className="soft mono" style={{ fontSize: 13 }} aria-live="polite">{t.loading}</p>}
        {dossier.isError && <p className="soft mono" style={{ fontSize: 13 }}>{t.failed}</p>}
        {d && (
          <ReportViewer
            report={d.report}
            sections={d.sections}
            title={d.title}
            lang={reportLang}
            meta={d.meta}
            currency={d.currency}
            cover={d.cover}
            coverLabels={d.coverLabels}
            request={d.request}
          />
        )}
      </div>
    </div>
  );
}
