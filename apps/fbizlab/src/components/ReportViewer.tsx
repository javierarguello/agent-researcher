import Markdown from 'react-markdown';
import { proseUrl, safeHref, sourceLabel } from '../lib/safe-href';
import remarkGfm from 'remark-gfm';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { normalizeSectionStatuses } from '../lib/section-status';
import type { Lang } from '../i18n';

function humanizeKey(k: string): string {
  const s = k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const CURRENCY_RE = /price|revenue|cash.?flow|sde|sale|amount|cost|ebitda|valuation|salary|rent|income/i;

/**
 * Numbers in the reader's language, money in the model's currency.
 *
 * Both were hardcoded here exactly as they were in the PDF renderer — `en-US`
 * grouping and a bare `$` — so a Portuguese buyer read `1,234,567.5`, and every
 * catalog model billed in dollars whatever it researched. Held in a context
 * because the sub-renderers are components; the PDF threads the same shape as an
 * argument.
 */
interface NumFmt { abbr: (n: number) => string; money: (n: number) => string; plain: (n: number) => string; keyed: (k: string | undefined, n: number) => string }

function makeNumFmt(lang: string, currency = 'USD'): NumFmt {
  // Built once, like the symbol below already was — `group` constructed a fresh
  // `Intl.NumberFormat` on every call.
  const fmt0 = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });
  const group = (n: number, max = 2) => (max === 0 ? fmt0 : fmt2).format(n);
  // `symbol`, not `narrowSymbol`: narrow collapses CAD, AUD, MXN, SGD, HKD and NZD
  // onto a bare `$`, so a Canadian model's prices read as US dollars. Kept in step
  // with `makeNumFmt` in `packages/core/src/pdf/report-html.ts`.
  const sym = new Intl.NumberFormat(lang, { style: 'currency', currency, currencyDisplay: 'symbol', maximumFractionDigits: 0 })
    .formatToParts(0).find((x) => x.type === 'currency')?.value ?? '$';
  const abbr = (n: number) =>
    Math.abs(n) >= 1e6 ? `${group(n / 1e6, 2)}M` : Math.abs(n) >= 1e3 ? `${group(Math.round(n / 1e3), 0)}k` : group(Math.round(n), 0);
  const money = (n: number) => `${sym}${abbr(n)}`;
  return {
    abbr,
    money,
    plain: (n) => group(n),
    keyed: (k, n) => {
      const key = (k ?? '').toLowerCase();
      if (/year|count|targetcount|\bid\b/.test(key)) return String(n);
      return CURRENCY_RE.test(key) ? money(n) : group(n);
    },
  };
}

// Threaded as an argument, not held in module state: a mutable module-level
// "current formatter" is one concurrent render away from formatting one report
// with another's currency.

// ── Localised UI labels (report content itself is already in the report language) ──
// `Lang` from `../i18n`, not a copy of the union declared here. This file used to
// shadow the app-wide one, so a language could be added to `LANGS` — offered in
// the switcher, carried in the URL, sent to the API — with no entry in this table,
// and `?? RL.en` below then served English headings over the translated report.
// Now the missing key is a build error.
export const RL: Record<Lang, Record<string, string>> = {
  en: { aiDisclaimer: 'AI-generated — can make mistakes. Always verify results before acting.', unenrichedSection: 'This section was researched and written, but the step that adds extra depth to it did not finish. Everything here is sourced as usual.', reconstructedSection: 'The step that researches this section did not finish. A later step wrote it from the rest of the dossier, so read it as less directly sourced than the others.', degradedSection: 'We could not complete this section for this report.', allElseOk: 'Everything else was researched and written as usual.', sections: 'Sections', snapshot: 'Snapshot', aiReport: 'AI analysis dossier', dossier: 'Generated dossier', reqMode: 'Mode', reqLang: 'Dossier language', reqSources: 'Sources consulted', reqCredits: 'Credits spent', targets: 'Targets', priceRange: 'Price range', combinedRevenue: 'Combined revenue', combinedSde: 'Combined SDE', criteria: 'Mandate', revenue: 'Revenue', sde: 'SDE', asking: 'Asking', location: 'Location', industry: 'Industry', priceBand: 'Price band', revenueFloor: 'Min revenue', cashFlowFloor: 'Min cash flow', financingPreference: 'Financing', realEstatePreference: 'Real estate', business: 'Transaction', salePrice: 'Sale price', multiple: 'Multiple', mentions: 'Mentions', netSentiment: 'Net sentiment', sentimentDist: 'Sentiment distribution', positive: 'Positive', neutral: 'Neutral', negative: 'Negative' },
  es: { aiDisclaimer: 'Generado por IA — puede cometer errores. Verifica siempre los resultados antes de actuar.', unenrichedSection: 'Esta sección se investigó y redactó, pero la etapa que le agrega profundidad no llegó a completarse. Todo lo que ves aquí está documentado como siempre.', reconstructedSection: 'La etapa que investiga esta sección no llegó a completarse. Una etapa posterior la redactó a partir del resto del dossier, así que tómala como menos documentada que las demás.', degradedSection: 'No pudimos completar esta sección para este informe.', allElseOk: 'Todo lo demás se investigó y redactó con normalidad.', sections: 'Secciones', snapshot: 'Resumen', aiReport: 'Dossier de análisis IA', dossier: 'Dossier generado', reqMode: 'Modo', reqLang: 'Idioma del dossier', reqSources: 'Fuentes consultadas', reqCredits: 'Créditos gastados', targets: 'Objetivos', priceRange: 'Rango de precio', combinedRevenue: 'Ingresos combinados', combinedSde: 'SDE combinado', criteria: 'Mandato', revenue: 'Ingresos', sde: 'SDE', asking: 'Precio', location: 'Ubicación', industry: 'Industria', priceBand: 'Rango de precio', revenueFloor: 'Ingreso mín', cashFlowFloor: 'Flujo mín', financingPreference: 'Financiamiento', realEstatePreference: 'Inmueble', business: 'Transacción', salePrice: 'Precio de venta', multiple: 'Múltiplo', mentions: 'Menciones', netSentiment: 'Sentimiento neto', sentimentDist: 'Distribución de sentimiento', positive: 'Positivo', neutral: 'Neutral', negative: 'Negativo' },
  fr: { aiDisclaimer: 'Généré par IA — peut faire des erreurs. Vérifiez toujours les résultats avant d’agir.', unenrichedSection: 'Cette section a été recherchée et rédigée, mais l’étape qui lui ajoute de la profondeur n’a pas abouti. Tout ce qui figure ici est sourcé comme d’habitude.', reconstructedSection: 'L’étape qui recherche cette section n’a pas abouti. Une étape ultérieure l’a rédigée à partir du reste du dossier : considérez-la comme moins directement sourcée que les autres.', degradedSection: 'Nous n’avons pas pu terminer cette section pour ce rapport.', allElseOk: 'Tout le reste a été recherché et rédigé normalement.', sections: 'Sections', snapshot: 'Aperçu', aiReport: 'Dossier d’analyse IA', dossier: 'Dossier généré', reqMode: 'Mode', reqLang: 'Langue du dossier', reqSources: 'Sources consultées', reqCredits: 'Crédits dépensés', targets: 'Cibles', priceRange: 'Fourchette de prix', combinedRevenue: 'Revenu combiné', combinedSde: 'SDE combiné', criteria: 'Mandat', revenue: 'Revenu', sde: 'SDE', asking: 'Prix', location: 'Localisation', industry: 'Secteur', priceBand: 'Fourchette de prix', revenueFloor: 'Revenu min', cashFlowFloor: 'Cash-flow min', financingPreference: 'Financement', realEstatePreference: 'Immobilier', business: 'Transaction', salePrice: 'Prix de vente', multiple: 'Multiple', mentions: 'Mentions', netSentiment: 'Sentiment net', sentimentDist: 'Distribution du sentiment', positive: 'Positif', neutral: 'Neutre', negative: 'Négatif' },
  pt: { aiDisclaimer: 'Gerado por IA — pode cometer erros. Verifique sempre os resultados antes de agir.', unenrichedSection: 'Esta seção foi pesquisada e redigida, mas a etapa que lhe acrescenta profundidade não foi concluída. Tudo aqui está documentado como sempre.', reconstructedSection: 'A etapa que pesquisa esta seção não foi concluída. Uma etapa posterior a redigiu a partir do restante do dossiê, portanto leia-a como menos documentada que as demais.', degradedSection: 'Não conseguimos concluir esta seção deste relatório.', allElseOk: 'Todo o restante foi pesquisado e redigido normalmente.', sections: 'Seções', snapshot: 'Resumo', aiReport: 'Dossiê de análise IA', dossier: 'Dossiê gerado', reqMode: 'Modo', reqLang: 'Idioma do dossiê', reqSources: 'Fontes consultadas', reqCredits: 'Créditos gastos', targets: 'Alvos', priceRange: 'Faixa de preço', combinedRevenue: 'Receita combinada', combinedSde: 'SDE combinado', criteria: 'Mandato', revenue: 'Receita', sde: 'SDE', asking: 'Preço', location: 'Localização', industry: 'Setor', priceBand: 'Faixa de preço', revenueFloor: 'Receita mín', cashFlowFloor: 'Fluxo mín', financingPreference: 'Financiamento', realEstatePreference: 'Imóvel', business: 'Transação', salePrice: 'Preço de venda', multiple: 'Múltiplo', mentions: 'Menções', netSentiment: 'Sentimento líquido', sentimentDist: 'Distribuição de sentimento', positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo' },
};

// ── Charts ──
const PALETTE = ['#e65100', '#3d8b5a', '#2563a8', '#a06a00', '#8a5cf0', '#0e8a8a'];
const CHART_TYPES = new Set(['bar', 'line', 'pie', 'area']);
interface ChartSpec { type: 'bar' | 'line' | 'pie' | 'area'; title: string; description?: string; labels: string[]; series: Array<{ name: string; data: Array<number | null> }>; unit?: string; stacked?: boolean; }
function isChartSpec(v: unknown): v is ChartSpec {
  const o = v as ChartSpec | null;
  return !!o && typeof o === 'object' && !Array.isArray(o) && CHART_TYPES.has((o as ChartSpec).type) && Array.isArray(o.labels) && Array.isArray(o.series);
}
function fmtUnit(unit: string | undefined, v: number | null, f: NumFmt): string {
  if (v == null) return '';
  const s = Math.abs(v) >= 1000 ? f.abbr(v) : f.plain(v);
  if (unit === '$') return `$${s}`;
  if (unit === '%') return `${v}%`;
  return unit ? `${s}${unit}` : s;
}
function ChartSpecRender({ spec, f }: { spec: ChartSpec; f: NumFmt }) {
  const rows = spec.labels.map((label, i) => {
    const r: Record<string, unknown> = { label };
    spec.series.forEach((s) => { r[s.name] = s.data[i] ?? null; });
    return r;
  });
  const tick = (v: number) => fmtUnit(spec.unit, v, f);
  const legend = spec.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null;
  let chart: React.ReactNode;
  if (spec.type === 'pie') {
    const s0 = spec.series[0];
    const data = spec.labels.map((label, i) => ({ name: label, value: s0?.data[i] ?? 0 }));
    chart = (<PieChart><Pie data={data} dataKey="value" nameKey="name" outerRadius="80%" label={(e: { name: string }) => e.name}>{data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip formatter={(v: number) => fmtUnit(spec.unit, v, f)} /></PieChart>);
  } else if (spec.type === 'line' || spec.type === 'area') {
    const C = spec.type === 'line' ? LineChart : AreaChart;
    chart = (<C data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5dfd4" /><XAxis dataKey="label" fontSize={11} stroke="#6b6860" /><YAxis tickFormatter={tick} fontSize={11} width={54} stroke="#6b6860" /><Tooltip formatter={(v: number) => fmtUnit(spec.unit, v, f)} />{legend}{spec.series.map((s, i) => spec.type === 'line'
      ? <Line key={s.name} type="monotone" dataKey={s.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
      : <Area key={s.name} type="monotone" dataKey={s.name} stackId={spec.stacked ? '1' : undefined} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.22} />)}</C>);
  } else {
    chart = (<BarChart data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5dfd4" /><XAxis dataKey="label" fontSize={11} stroke="#6b6860" interval={0} angle={rows.length > 6 ? -20 : 0} textAnchor={rows.length > 6 ? 'end' : 'middle'} height={rows.length > 6 ? 56 : 30} /><YAxis tickFormatter={tick} fontSize={11} width={54} stroke="#6b6860" /><Tooltip formatter={(v: number) => fmtUnit(spec.unit, v, f)} />{legend}{spec.series.map((s, i) => <Bar key={s.name} dataKey={s.name} stackId={spec.stacked ? '1' : undefined} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />)}</BarChart>);
  }
  return (
    <div className="card" style={{ padding: 16, marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{spec.title}</div>
      {spec.description && <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{spec.description}</div>}
      <div style={{ height: 250 }}><ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer></div>
    </div>
  );
}

/**
 * The Markdown elements a report may render. `a` opens in a new tab; `img`
 * renders NOTHING.
 *
 * Images are dropped at the element level on purpose. react-markdown's default
 * `urlTransform` lets an `https:`, protocol-relative or same-origin `src`
 * through, and a report field is model output written after reading web pages —
 * so `![photo](https://attacker/p.gif?…)` in any prose field was a tracking
 * beacon that fired from the reader's IP on every open of the report, the shared
 * read link and the admin's view. Nothing honest is lost: the engine's directive
 * asks for links, charts are structured `ChartSpec`s, and the PDF has never
 * drawn an image. If a model ever needs pictures, that is an allowlisted asset
 * pipeline, not Markdown.
 */
const MD = {
  // A link with no href left after `proseUrl` (an unsafe scheme) is its text, not a
  // dead anchor styled as a live one.
  // `title` is dropped, not clipped. react-markdown maps `[t](url "title")` onto
  // the attribute, and that string is the PAGE'S OWN ACCOUNT OF ITSELF, written
  // after reading attacker-controlled evidence — 5,160 characters of "Official
  // registry of the State of Florida" was one hover from being displayed exactly as
  // written, unbounded, on all three surfaces. R7-24 bounded the Sources tooltip for
  // this reason and kept what WE compose (host, clipped label, url); here there is
  // nothing of ours to keep (round 8, R8-34).
  // `node` goes too: react-markdown passes its hast node to a custom component and
  // the TS type does not mention it, so the spread wrote `node="[object Object]"`
  // onto every prose anchor in the buyer's report (round 9, R9-23). Inert, and not
  // attacker-controlled — but the subject of this override is what that spread is
  // allowed to carry, and it audited one of the two props that do not belong.
  a: ({ title: _title, node: _node, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (p.href ? <a {...p} target="_blank" rel="noopener noreferrer" /> : <>{p.children}</>),
  img: () => null,
};
const Prose = ({ md }: { md: string }) => <div className="prose"><Markdown remarkPlugins={[remarkGfm]} components={MD} urlTransform={proseUrl}>{md}</Markdown></div>;

/** A row of coral-accented stat tiles: { value, label }. */
function Tiles({ items }: { items: Array<{ value: string; label: string }> }) {
  if (!items.length) return null;
  return <div className="rv-tiles">{items.map((t, i) => <div key={i} className="rv-tile"><div className="rv-tile__v">{t.value}</div><div className="rv-tile__l">{t.label}</div></div>)}</div>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
type Obj = Record<string, unknown>;

// ── Structured primitives (blocks.ts): metrics, prioritised risks, projections ──
interface Metric { label: string; value: string; emphasis?: string; hint?: string | null }
interface Risk { severity: 'high' | 'medium' | 'low'; title: string; detail: string }
interface Projection { periods: string[]; rows: Array<{ metric: string; unit?: string; values: Array<number | null> }>; note?: string | null }
const isMetric = (x: unknown): x is Metric => !!x && typeof x === 'object' && typeof (x as Metric).label === 'string' && typeof (x as Metric).value === 'string' && !('severity' in (x as Obj));
const isRisk = (x: unknown): x is Risk => !!x && typeof x === 'object' && typeof (x as Risk).severity === 'string' && typeof (x as Risk).title === 'string';
const isProjection = (v: unknown): v is Projection => !!v && typeof v === 'object' && Array.isArray((v as Projection).periods) && Array.isArray((v as Projection).rows) && !!(v as Projection).rows[0] && Array.isArray((v as Projection).rows[0]!.values);
const RISK_COLOR: Record<string, string> = { high: 'var(--risk)', medium: '#a06a00', low: 'var(--muted)' };
const rowVal = (unit: string | undefined, v: number, f: NumFmt) => (unit === '%' ? `${v}%` : unit === 'x' ? `${v}x` : unit === '#' ? String(v) : f.money(v));

function MetricTiles({ items }: { items: Metric[] }) {
  return <div className="rv-tiles">{items.map((m, i) => (
    <div key={i} className="rv-tile">
      <div className="rv-tile__v" style={{ color: m.emphasis === 'positive' ? 'var(--positive)' : m.emphasis === 'negative' ? 'var(--risk)' : undefined }}>{m.value}</div>
      <div className="rv-tile__l">{m.label}</div>
      {m.hint && <div className="rv-tile__h">{m.hint}</div>}
    </div>
  ))}</div>;
}
function RiskList({ items }: { items: Risk[] }) {
  return <div className="stack" style={{ gap: 10 }}>{items.map((r, i) => (
    <div key={i} className="rv-risk" style={{ borderLeftColor: RISK_COLOR[r.severity] ?? 'var(--muted)' }}>
      <div className="between" style={{ alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.title}</div>
        <span className="rv-sev" style={{ color: RISK_COLOR[r.severity], borderColor: RISK_COLOR[r.severity] }}>{r.severity}</span>
      </div>
      {r.detail && <Prose md={r.detail} />}
    </div>
  ))}</div>;
}
function ProjectionView({ t, f }: { t: Projection; f: NumFmt }) {
  const dollarRows = t.rows.filter((r) => (r.unit ?? '$') === '$');
  const spec: ChartSpec = { type: 'bar', title: '', labels: t.periods, series: (dollarRows.length ? dollarRows : t.rows).map((r) => ({ name: r.metric, data: r.values })), unit: (dollarRows.length ? '$' : t.rows[0]?.unit) };
  return (
    <div>
      <div className="rv-table-wrap"><table className="rv-table">
        <thead><tr><th /><>{t.periods.map((p, i) => <th key={i}>{p}</th>)}</></tr></thead>
        <tbody>{t.rows.map((r, i) => (
          <tr key={i}><td className="rv-table__m">{r.metric}</td><>{r.values.map((v, j) => <td key={j}>{v == null ? '—' : rowVal(r.unit, v, f)}</td>)}</></tr>
        ))}</tbody>
      </table></div>
      {t.note && <div className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>{t.note}</div>}
      {spec.series.length > 0 && <ChartSpecRender spec={spec} f={f} />}
    </div>
  );
}

/**
 * What the model says its cover summarises. Same shape as the template's `cover`,
 * arriving through the manifest — this file used to read `shortlist`/`deep_dives`
 * and a field called `business`, so another model's report had no snapshot and no
 * entity cards.
 */
interface CoverSpec {
  from: string[];
  nameKey: string;
  figures?: Array<{ labelKey: string; agg: 'count' | 'range' | 'sum'; field?: string }>;
  tiles?: Array<{ labelKey: string; field: string }>;
}

/** One of the things this model compares, as a card with figure tiles. */
function DealCard({ d, l, f, cover, coverLabels }: { d: Obj; l: Record<string, string>; f: NumFmt; cover?: CoverSpec; coverLabels?: Record<string, string> }) {
  const tiles: Array<{ value: string; label: string }> = [];
  for (const spec of cover?.tiles ?? []) {
    const v = d[spec.field];
    if (isNum(v)) tiles.push({ value: f.money(v), label: coverLabels?.[spec.labelKey] ?? l[spec.labelKey] ?? humanizeKey(spec.labelKey) });
  }
  const prose = ['overview', 'financials', 'impliedMultiple', 'includedAssets', 'leaseTerms', 'reasonForSale', 'growthOpportunities'] as const;
  const url = typeof d.sourceUrl === 'string' ? d.sourceUrl : undefined;
  return (
    <div className="rv-deal">
      <div className="between" style={{ alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{String(d[cover?.nameKey ?? 'name'] ?? '')}</div>
        {d.match === 'relaxed' && <span className="badge" style={{ color: 'var(--accent)' }}>relaxed</span>}
      </div>
      {typeof d.location === 'string' && <div className="mono muted" style={{ fontSize: 11, marginTop: 3 }}>{d.location}</div>}
      {typeof d.relaxedNote === 'string' && d.relaxedNote && <div className="soft" style={{ fontSize: 12.5, marginTop: 6 }}>{d.relaxedNote}</div>}
      {typeof d.duplicateWarning === 'string' && d.duplicateWarning && <div className="risk" style={{ fontSize: 12.5, marginTop: 6 }}>⚠ {d.duplicateWarning}</div>}
      <Tiles items={tiles} />
      {prose.map((k) => (typeof d[k] === 'string' && d[k] ? (
        <div key={k} style={{ marginTop: 12 }}>
          <div className="rv-flabel">{humanizeKey(k)}</div>
          <Prose md={d[k] as string} />
        </div>
      ) : null))}
      {Array.isArray(d.risks) && d.risks.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="rv-flabel">{humanizeKey('risks')}</div>
          {(d.risks as unknown[]).every(isRisk)
            ? <RiskList items={d.risks as Risk[]} />
            : <ul className="rv-bullets">{(d.risks as string[]).map((r, i) => <li key={i}><Markdown remarkPlugins={[remarkGfm]} components={MD} urlTransform={proseUrl}>{r}</Markdown></li>)}</ul>}
        </div>
      )}
      {safeHref(url) && <a className="mono accent" style={{ fontSize: 11, display: 'inline-block', marginTop: 10 }} href={safeHref(url)!} target="_blank" rel="noreferrer">source ↗</a>}
    </div>
  );
}

// ── Sources → condensed ↗ link list ──
interface Source { url: string; label?: string; id?: number }
const isSourceList = (v: unknown): v is { items: Source[] } => !!v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items) && typeof ((v as { items: Source[] }).items[0]?.url) === 'string';
function SourceList({ items }: { items: Source[] }) {
  return <ul className="rv-sources">{items.map((s, i) => (
    // The tooltip is the row again, not the page's own account of itself: whatever
    // the row shows (host first, label clipped) plus the url, so hovering cannot
    // reveal 4,900 characters of a title an attacker wrote about their own
    // authority — the thing `sourceLabel` exists to bound (round 7, R7-24).
    // By CODE POINT: a `.slice(0, 320)` on the string ended a long url in a lone
    // high surrogate and the screen painted `?` (round 8, R8-35). `sourceLabel`
    // already cuts this way; this was the one line in the batch that did not.
    <li key={i} title={Array.from(`${sourceLabel(s)} — ${s.url}`).slice(0, 320).join('')}>{safeHref(s.url)
      ? <a href={safeHref(s.url)!} target="_blank" rel="noreferrer"><span className="rv-src-arrow">↗</span>{sourceLabel(s)}</a>
      : <span><span className="rv-src-arrow">↗</span>{sourceLabel(s)}</span>}</li>
  ))}</ul>;
}

// ── Checklist → checkbox-icon items ──
const isChecklist = (v: unknown): v is { categories: Array<{ category: string; items: string[] }> } => !!v && typeof v === 'object' && Array.isArray((v as { categories?: unknown }).categories) && Array.isArray((v as { categories: Array<{ items?: unknown }> }).categories[0]?.items);
function Checklist({ categories }: { categories: Array<{ category: string; items: string[] }> }) {
  return <div className="stack" style={{ gap: 20 }}>{categories.map((c, i) => (
    <div key={i}>
      <div className="rv-flabel">{c.category}</div>
      <ul className="rv-check">{c.items.map((it, j) => (
        <li key={j}><span className="rv-checkbox" /><span><Markdown remarkPlugins={[remarkGfm]} components={MD} urlTransform={proseUrl}>{it}</Markdown></span></li>
      ))}</ul>
    </div>
  ))}</div>;
}

// ── Comparable transactions → table ──
const isTransactions = (v: unknown): v is Obj[] => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && !!v[0] && 'description' in (v[0] as Obj) && ('multiple' in (v[0] as Obj) || 'salePrice' in (v[0] as Obj) || 'revenue' in (v[0] as Obj));
const multipleNum = (m: unknown): string | null => { const x = String(m ?? '').match(/([\d.]+)\s*x/i); return x ? `${x[1]}x` : null; };
const clip = (s: unknown, n = 64): string => { const t = String(s ?? '').replace(/[*_#]/g, ''); return t.length > n ? `${t.slice(0, n).trim()}…` : t; };
function TransactionsTable({ rows, l, f }: { rows: Obj[]; l: Record<string, string>; f: NumFmt }) {
  return (
    <div className="rv-table-wrap"><table className="rv-table">
      <thead><tr><th>{l.business}</th><th>{l.location}</th><th>{l.salePrice}</th><th>{l.revenue}</th><th>{l.multiple}</th></tr></thead>
      <tbody>{rows.map((r, i) => {
        const mult = multipleNum(r.multiple);
        return (
          <tr key={i}>
            <td className="rv-table__m rv-table__wrap">{clip(r.business ?? r.description)}</td>
            <td>{typeof r.location === 'string' ? r.location : '—'}</td>
            <td>{isNum(r.salePrice) ? f.money(r.salePrice) : '—'}</td>
            <td>{isNum(r.revenue) ? f.money(r.revenue) : '—'}</td>
            <td className="rv-mult">{mult ?? '—'}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

// ── Community reviews → sentiment indicators + condensed mentions ──
const SENT: Record<string, string> = { positive: '#3d8b5a', neutral: '#c9bfa8', mixed: '#a06a00', negative: '#c0392b' };
interface Mention { platform?: string; url?: string; topic?: string; summary?: string; sentiment?: string }
const hasMentions = (v: unknown): v is { overview?: string; mentions: Mention[] } => !!v && typeof v === 'object' && Array.isArray((v as { mentions?: unknown }).mentions);
function CommunitySentiment({ v, l }: { v: { overview?: string; mentions: Mention[] }; l: Record<string, string> }) {
  const mentions = v.mentions ?? [];
  const total = mentions.length;
  const c = { positive: 0, neutral: 0, negative: 0 };
  for (const m of mentions) {
    if (m.sentiment === 'positive') c.positive++;
    else if (m.sentiment === 'negative') c.negative++;
    else c.neutral++;
  }
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const net = pct(c.positive) - pct(c.negative);
  return (
    <div>
      <div className="rv-tiles">
        <div className="rv-tile"><div className="rv-tile__v">{total}</div><div className="rv-tile__l">{l.mentions}</div></div>
        <div className="rv-tile"><div className="rv-tile__v" style={{ color: net >= 0 ? 'var(--positive)' : 'var(--risk)' }}>{net >= 0 ? '+' : ''}{net}</div><div className="rv-tile__l">{l.netSentiment}</div></div>
      </div>
      {total > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="rv-flabel">{l.sentimentDist}</div>
          <div className="rv-sentbar">
            <span style={{ width: `${pct(c.positive)}%`, background: SENT.positive }} />
            <span style={{ width: `${pct(c.neutral)}%`, background: SENT.neutral }} />
            <span style={{ width: `${pct(c.negative)}%`, background: SENT.negative }} />
          </div>
          <div className="rv-sentlegend">
            <span><i style={{ background: SENT.positive }} />{l.positive} {pct(c.positive)}%</span>
            <span><i style={{ background: SENT.neutral }} />{l.neutral} {pct(c.neutral)}%</span>
            <span><i style={{ background: SENT.negative }} />{l.negative} {pct(c.negative)}%</span>
          </div>
        </div>
      )}
      {v.overview && <div style={{ marginTop: 18 }}><Prose md={v.overview} /></div>}
      {mentions.length > 0 && (
        <div className="stack" style={{ gap: 14, marginTop: 16 }}>{mentions.map((m, i) => (
          <div key={i} className="rv-mention">
            <div className="rv-mention__head">
              {m.topic && <div className="rv-mention__title">{m.topic}</div>}
              {m.platform && (
                <span className="rv-mention__src">
                  {m.sentiment && <i style={{ background: SENT[m.sentiment] ?? 'var(--muted)' }} />}
                  {m.platform}
                </span>
              )}
            </div>
            {m.summary && <Prose md={m.summary} />}
            {safeHref(m.url) && <a className="mono accent" style={{ fontSize: 11, display: 'inline-block', marginTop: 10 }} href={safeHref(m.url)!} target="_blank" rel="noreferrer">↗ source</a>}
          </div>
        ))}</div>
      )}
    </div>
  );
}

/** Generic value renderer for arbitrary nested report fields. */
function Value({ v, k, l, f }: { v: unknown; k?: string; l: Record<string, string>; f: NumFmt }) {
  if (v == null || v === '') return null;
  if (isChartSpec(v)) return <ChartSpecRender spec={v} f={f} />;
  if (typeof v === 'string') return <Prose md={v} />;
  if (typeof v === 'number') return <span>{f.keyed(k, v)}</span>;
  if (typeof v === 'boolean') return <span>{v ? 'Yes' : 'No'}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (v.every(isRisk)) return <RiskList items={v as Risk[]} />;
    if (v.every(isMetric)) return <MetricTiles items={v as Metric[]} />;
    if (isTransactions(v)) return <TransactionsTable rows={v} l={l} f={f} />;
    if (v.every((x) => typeof x === 'string')) return <ul className="rv-bullets">{v.map((x, i) => <li key={i}><Markdown remarkPlugins={[remarkGfm]} components={MD} urlTransform={proseUrl}>{x as string}</Markdown></li>)}</ul>;
    return <div className="stack" style={{ gap: 10 }}>{v.map((x, i) => <div key={i} className="rv-card"><ObjectFields o={x as Obj} l={l} f={f} /></div>)}</div>;
  }
  if (typeof v === 'object') {
    if (isSourceList(v)) return <SourceList items={v.items} />;
    if (isChecklist(v)) return <Checklist categories={v.categories} />;
    if (hasMentions(v)) return <CommunitySentiment v={v} l={l} />;
    if (isProjection(v)) return <ProjectionView t={v} f={f} />;
    return <ObjectFields o={v as Obj} l={l} f={f} />;
  }
  return null;
}

/** Object → labelled field blocks. */
function ObjectFields({ o, l, f }: { o: Obj; l: Record<string, string>; f: NumFmt }) {
  const entries = Object.entries(o).filter(([, val]) => val != null && val !== '');
  return (
    <div className="stack" style={{ gap: 12 }}>
      {entries.map(([k, val]) => (
        <div key={k}>
          <div className="rv-flabel">{humanizeKey(k)}</div>
          <Value v={val} k={k} l={l} f={f} />
        </div>
      ))}
    </div>
  );
}

/** Dispatch a whole section to the right presentation. */
function SectionBody({ v, l, f, cover, coverLabels }: { v: unknown; l: Record<string, string>; f: NumFmt; cover?: CoverSpec; coverLabels?: Record<string, string> }) {
  if (Array.isArray(v)) {
    if (v.every(isChartSpec)) return <>{v.map((c, i) => <ChartSpecRender key={i} spec={c as ChartSpec} f={f} />)}</>;
    if (cover?.nameKey && v.length && typeof v[0] === 'object' && v[0] && cover.nameKey in (v[0] as Obj)) {
      return <div className="stack" style={{ gap: 14 }}>{(v as Obj[]).map((d, i) => <DealCard key={i} d={d} l={l} f={f} cover={cover} coverLabels={coverLabels} />)}</div>;
    }
    return <Value v={v} l={l} f={f} />;
  }
  return <Value v={v} l={l} f={f} />;
}

// ── Snapshot (right rail) ──
function collectDeals(report: Obj, cover: CoverSpec | undefined): Obj[] {
  if (!cover) return [];
  const src = cover.from.flatMap((k) => (Array.isArray(report[k]) ? (report[k] as Obj[]) : []));
  const byName = new Map<string, Obj>();
  for (const d of src) {
    const name = String(d[cover.nameKey] ?? Math.random());
    const cur = byName.get(name) ?? {};
    for (const [k, val] of Object.entries(d)) if (val != null && cur[k] == null) cur[k] = val;
    byName.set(name, cur);
  }
  return [...byName.values()];
}

/**
 * Renders a report defensively: every section is drawn by FEATURE-DETECTING its
 * shape (isMetric/isRisk/isProjection/string/…), so it never fails across report
 * versions — old prose-only reports and new structured ones both render, and an
 * unknown future field just renders generically. `meta.schemaVersion`
 * ("<template>@<version>") is exposed (data-report-version) so components can
 * identify a report's version for analytics or explicit version branching later.
 */
export function ReportViewer({ report, sections, title, lang = 'en', meta, request, currency, cover, coverLabels }: {
  report: Obj; sections?: Array<{ key: string; title: string }>; title?: string; lang?: string; meta?: Obj;
  /** ISO 4217 the model's figures are in (from its manifest). Default USD. */
  currency?: string;
  /** What this model summarises on the snapshot, from its manifest. */
  cover?: CoverSpec;
  /**
   * The cover's labels, already localized, from the manifest.
   *
   * `CoverSpec.labelKey` is documented as looked up in `TemplateI18n.cover`, and
   * nothing looked it up: this component fell back to `RL`, whose cover entries
   * are Florida's vocabulary in all four languages. The flagship looked right and
   * the second model to declare a cover got its raw key printed as the label.
   */
  coverLabels?: Record<string, string>;
  /** Request context appended to the right-rail Mandate card (mode, language, sources, credits). */
  request?: { modeLabel?: string | null; languageLabel?: string | null; sourcesFound?: number | null; creditsSpent?: number | null };
}) {
  const l = RL[(lang as Lang)] ?? RL.en;
  const f = makeNumFmt(lang, currency);
  const reportVersion = String(meta?.schemaVersion ?? '');
  const HIDE = new Set(['search_criteria']); // shown in the right rail instead

  // Sections the engine could not complete. Their bodies still SATISFY the schema
  // — a required enum becomes its first value, a required number becomes 0 — so
  // rendering one shows a fabricated recommendation and zero prices as findings.
  // The engine names them; the reader must never see the filler.
  // Only `lost` suppresses a body. An `unenriched` section holds real content a
  // refiner never deepened, and a `reconstructed` one what an enricher wrote when
  // its producer never delivered — hiding either would take away work the buyer paid
  // for and replace it with an apology that is not true. Their LINES differ:
  // `unenriched` claims the section was researched, which `reconstructed` is not
  // (round 7, R7-1).
  // Read through the coercion, never off the raw field: this viewer is handed the
  // STORED `meta`, and every report written before `meta.sections` existed says
  // `degradedSections` instead. See `lib/section-status.ts`.
  const statuses = normalizeSectionStatuses(meta?.sections, meta?.degradedSections);
  const degraded = new Set<string>(statuses.filter((x) => x.status === 'lost').map((x) => x.key));
  const unenriched = new Set<string>(statuses.filter((x) => x.status === 'unenriched').map((x) => x.key));
  const reconstructed = new Set<string>(statuses.filter((x) => x.status === 'reconstructed').map((x) => x.key));
  const ordered = (sections?.length ? sections : Object.keys(report).map((k) => ({ key: k, title: humanizeKey(k) })))
    // A degraded section survives this filter even when its placeholder is `null`.
    // A schema that is nullable at the root degrades to exactly that, and dropping
    // it here means the buyer is never told a section they paid for is missing —
    // the report simply does not mention it.
    .filter((s) => (report[s.key] != null || degraded.has(s.key)) && !HIDE.has(s.key));
  const pad = (i: number) => String(i + 1).padStart(2, '0');

  // Snapshot metrics from the deals — never from a degraded section, or the
  // headline numbers are computed from placeholder zeros.
  const deals = collectDeals(Object.fromEntries(Object.entries(report).filter(([k]) => !degraded.has(k))), cover);
  const snap: Array<{ value: string; label: string }> = [];
  for (const fig of cover?.figures ?? []) {
    // From the manifest, in the reader's language. `l` is this file's own
    // dictionary and its cover entries are Florida's vocabulary, so any other
    // model fell through to the raw key.
    const label = coverLabels?.[fig.labelKey] ?? l[fig.labelKey] ?? humanizeKey(fig.labelKey);
    if (fig.agg === 'count') { if (deals.length) snap.push({ value: String(deals.length), label }); continue; }
    const nums = deals.map((d) => d[fig.field ?? '']).filter(isNum);
    if (!nums.length) continue;
    if (fig.agg === 'range') {
      // `keyed` decides money vs plain from the FIELD NAME — the convention this
      // file already uses everywhere else. A blanket `money()` put a currency
      // symbol on a sum of acres.
      const fmt = (n: number) => f.keyed(fig.field, n);
      snap.push({ value: nums.length > 1 ? `${fmt(Math.min(...nums))}–${fmt(Math.max(...nums))}` : fmt(nums[0]!), label });
    } else {
      const total = nums.reduce((x, y) => x + y, 0);
      if (total > 0) snap.push({ value: f.keyed(fig.field, total), label });
    }
  }

  // …and not through the side door either. `search_criteria` is hidden from the
  // section flow and rendered in the right-hand rail instead, so the degraded
  // branch below never fires for it — the placeholder came out as the buyer's
  // Location, and as the meta line under the title, with no apology anywhere.
  // Anything that reads a section outside `ordered` has to consult `degraded` too.
  const crit = degraded.has('search_criteria') ? undefined : (report.search_criteria as Obj | undefined);
  const CRIT_KEYS = ['location', 'industry', 'priceBand', 'revenueFloor', 'cashFlowFloor', 'financingPreference', 'realEstatePreference'];
  const critRows = crit ? CRIT_KEYS.filter((k) => crit[k] != null && crit[k] !== '') : [];
  const metaLine = [crit?.location, crit?.industry].filter(Boolean).join(' · ');

  // Request context (mode, language, sources consulted, credits) — appended to the Mandate card.
  const reqRows: Array<[string, string]> = [];
  if (request?.modeLabel) reqRows.push([l.reqMode!, request.modeLabel]);
  if (request?.languageLabel) reqRows.push([l.reqLang!, request.languageLabel]);
  if (request?.sourcesFound != null) reqRows.push([l.reqSources!, String(request.sourcesFound)]);
  if (request?.creditsSpent != null) reqRows.push([l.reqCredits!, `◆ ${request.creditsSpent}`]);

  return (
    <div className="rv" data-report-version={reportVersion}>
      <aside className="rv-nav">
        <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 14 }}>{l.sections}</div>
        <ol>
          {ordered.map((s, i) => (
            <li key={s.key}><a href={`#sec-${s.key}`}><span className="rv-nav__n">{pad(i)}</span>{s.title}</a></li>
          ))}
        </ol>
      </aside>

      <div className="rv-main">
        <span className="rv-eyebrow">{l.aiReport}</span>
        {title && <h1 className="rv-title">{title}</h1>}
        {(metaLine || crit) && <div className="rv-meta">{[metaLine, l.dossier].filter(Boolean).join(' · ')}</div>}
        <div className="rv-disclaimer">{l.aiDisclaimer}</div>

        {ordered.map((s, i) => (
          <section key={s.key} id={`sec-${s.key}`} className="rv-sec">
            <h2 className="rv-sechead"><span className="rv-secnum">{pad(i)}</span>{s.title}</h2>
            {/* `unenriched` keeps its body and gains a line saying the deepening
                pass did not run — the buyer used to be told nothing at all. */}
            {unenriched.has(s.key) && <p className="rv-degraded soft">{l.unenrichedSection}</p>}
            {/* `reconstructed`: no producer researched it; a later pass wrote it. */}
            {reconstructed.has(s.key) && <p className="rv-degraded soft">{l.reconstructedSection}</p>}
            {degraded.has(s.key)
              ? <p className="rv-degraded soft">{l.degradedSection}{statuses.length === 1 ? ` ${l.allElseOk}` : ''}</p>
              : <SectionBody v={report[s.key]} l={l} f={f} cover={cover} coverLabels={coverLabels} />}
          </section>
        ))}
      </div>

      <aside className="rv-side">
        {snap.length > 0 && (
          <>
            <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 12 }}>{l.snapshot}</div>
            <div className="rv-snapgrid">
              {snap.map((t, i) => <div key={i} className="rv-snaptile"><div className="rv-snaptile__l">{t.label}</div><div className="rv-snaptile__v">{t.value}</div></div>)}
            </div>
          </>
        )}
        {(critRows.length > 0 || reqRows.length > 0) && (
          <div className="rv-crit">
            <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 10 }}>{l.criteria}</div>
            {critRows.map((k) => (
              <div key={k} className="rv-crit__row">
                <span className="rv-crit__k">{l[k] ?? humanizeKey(k)}</span>
                <span className="rv-crit__v">{String(crit![k])}</span>
              </div>
            ))}
            {reqRows.map(([k, v]) => (
              <div key={k} className="rv-crit__row">
                <span className="rv-crit__k">{k}</span>
                <span className="rv-crit__v">{v}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
