import type { CoverSpec } from '../templates/types.js';
/**
 * Builds a print-ready HTML document for a research report — the SHARED base used
 * by every app's PDF (the worker renders this HTML to PDF with headless Chromium).
 * Layout + structure live here and are app-agnostic; per-app branding comes from
 * the `PdfTheme`. It feature-detects the same structured blocks the on-screen
 * viewer does (metrics, risks, projections, sources, checklists, transactions,
 * community sentiment), so any report version renders without failing.
 */
import type { PdfTheme } from './theme.js';
import { normalizeSectionStatuses } from '../engine/section-status.js';
import { sectionsNotice } from '../jobs/report-copy.js';
import { LANGS, type Lang } from '../languages.js';

type Obj = Record<string, unknown>;

export interface BuildReportHtmlInput {
  report: Obj;
  meta?: Obj;
  /** Ordered sections (key + localized title) from the template manifest. */
  sections?: Array<{ key: string; title: string }>;
  title?: string;
  /** Request params (for the mandate/criteria block). */
  params?: Obj;
  /**
   * Localized param labels from the manifest, and which key holds the buyer's
   * free text.
   *
   * Both were guessed before: labels came from `humanizeKey` (English, in every
   * language, over prose in theirs — "Sba friendly"), and the exclusion was the
   * literal name `instructions`. A model whose free-text field is called something
   * else had that whole blob printed into the artifact the buyer forwards.
   */
  paramLabels?: Record<string, string>;
  /** How this model summarises its findings on the cover (from the template). */
  cover?: CoverSpec;
  /**
   * The cover's labels, already localized, from the manifest.
   *
   * `CoverSpec.labelKey` is documented as looked up in `TemplateI18n.cover`, and
   * nothing looked it up — this renderer fell back to `RL`, whose cover entries
   * are Florida's vocabulary in all four languages. So the flagship looked right
   * and any other model got its raw key as the label.
   */
  coverLabels?: Record<string, string>;
  /** ISO 4217 the model's figures are in. Default USD. */
  currency?: string;
  lang?: string;
  theme: PdfTheme;
  /** ISO date the report was generated (dossier stamp). Pass explicitly — the
   *  builder is pure and does not read the clock. */
  generatedAt?: string;
}

// ── small helpers ──────────────────────────────────────────────────────────
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function humanizeKey(k: string): string {
  const s = k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const CURRENCY_RE = /price|revenue|cash.?flow|sde|sale|amount|cost|ebitda|valuation|salary|rent|income/i;

/**
 * Numbers in the buyer's language and the model's currency.
 *
 * Both were hardcoded: `en-US` grouping printed `1,234,567.5` to a reader who
 * writes `1.234.567,5`, and a bare `$` meant every model in the catalog billed in
 * dollars whatever it researched. Built once per render and threaded like the
 * theme already is, rather than read from module state.
 */
export interface NumFmt {
  abbr: (n: number) => string;
  money: (n: number) => string;
  plain: (n: number) => string;
  keyed: (key: string | undefined, n: number) => string;
  row: (unit: string | undefined, v: number) => string;
}

export function makeNumFmt(lang: string, currency = 'USD'): NumFmt {
  // Two formatters, built once. `group` used to construct one PER CALL and `cur`
  // constructed one per money VALUE — 1,821 `Intl.NumberFormat` constructions in a
  // single large report, 91% of the render, and `buildReportHtml` 1.85x slower
  // than before currency support. Hoisting is byte-identical output at 1/11th the
  // time. The browser copy of this function already hoisted it; this one did not,
  // which is the argument against writing the same rule twice.
  const fmt0 = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });
  const group = (n: number, max = 2) => (max === 0 ? fmt0 : fmt2).format(n);
  // `currencyDisplay: 'symbol'`, not `narrowSymbol`. Narrow collapses CAD, AUD,
  // MXN, SGD, HKD and NZD onto a bare `$`, so a model researching Canadian deals
  // printed a price a reader takes for US dollars — the same class of defect as
  // the hardcoded `$` this replaced, only harder to spot. `symbol` still gives a
  // bare `$` for USD in English, `€`, `£`, `¥`, `R$` unchanged, and `CA$`/`MX$`
  // where it matters.
  const sym = new Intl.NumberFormat(lang, { style: 'currency', currency, currencyDisplay: 'symbol', maximumFractionDigits: 0 })
    .formatToParts(0)
    .find((x) => x.type === 'currency')?.value ?? '$';
  const abbr = (n: number) =>
    Math.abs(n) >= 1e6 ? `${group(n / 1e6, 2)}M` : Math.abs(n) >= 1e3 ? `${group(Math.round(n / 1e3), 0)}k` : group(Math.round(n), 0);
  const money = (n: number) => `${sym}${abbr(n)}`;
  return {
    abbr,
    money,
    plain: (n) => group(n),
    keyed: (key, n) => {
      const k = (key ?? '').toLowerCase();
      if (/year|count|targetcount|\bid\b/.test(k)) return String(n);
      return CURRENCY_RE.test(k) ? money(n) : group(n);
    },
    row: (unit, v) => (unit === '%' ? `${v}%` : unit === 'x' ? `${v}x` : unit === '#' ? group(v, 0) : money(v)),
  };
}

/** Minimal, SAFE Markdown → HTML (escape first, then a few inline/block rules). */
function mdInline(s: string): string {
  let out = esc(s);
  // An image is not a thing a report renders — the web viewer drops the element
  // (see ReportViewer's `MD`) and this renderer never emitted one. Without this
  // line the link rule below turned `![alt](url)` into `!` + a link labelled by
  // the alt text: a click-beacon dressed as a "verified photo".
  out = out.replace(/!\[[^\]]*\]\([^\s)]*\)/g, '');
  // `u` is ALREADY escaped — `esc(s)` ran on the whole string first — so it goes
  // into the attribute as is. It used to be escaped a second time, which turned
  // every `&amp;` into `&amp;amp;`: in both real July reports, every prose
  // citation of a URL with two or more query parameters carried it, the PDF's
  // link annotation carried it, and a click sent a parameter named `amp;ref`
  // while the same URL in the Sources list (escaped once) was right. The URL may
  // hold one level of balanced parentheses (`…/Hialeah,_Florida_(city)`) and may
  // be a `mailto:` — the same set the web viewer's Markdown allows, so the two
  // artifacts agree on what is a link.
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)(?:[^\s()]|\([^\s()]*\))+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

const BULLET_LINE = /^\s*[-*]\s+/;
/** `1. ` / `2) ` — one or two digits, so a sentence opening with a year is not a list. */
const NUMBERED_LINE = /^\s*(\d{1,2})[.)]\s+/;

/**
 * Block-level Markdown: headings, bullet lists, numbered lists, paragraphs.
 *
 * Lists are recognised as RUNS of list lines inside a block, not only as blocks
 * made entirely of them. The shape the model actually writes — measured in the
 * real reports — is a prose line followed directly by its items
 * (`Esto implicaría:\n1. …\n2. …`), and that used to flatten into one run-on
 * paragraph: "1. Request the CIM. 2. Verify the lease. 3. …". A numbered run that
 * starts past 1 keeps its number (`<ol start="2">`), so items the model separated
 * with blank lines still count up instead of each restarting at 1.
 */
function mdToHtml(md: string): string {
  const blocks = String(md ?? '').trim().split(/\n{2,}/);
  return blocks
    .map((b) => {
      const lines = b.split('\n');
      // Markdown headings (### Foo) → a styled sub-heading (never show the #s).
      const h = lines[0]?.match(/^\s*(#{1,6})\s+(.*)$/);
      if (h && lines.length === 1) return `<div class="mdh">${mdInline(h[2] ?? '')}</div>`;
      const out: string[] = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i]!;
        if (BULLET_LINE.test(line)) {
          const items: string[] = [];
          while (i < lines.length && BULLET_LINE.test(lines[i]!)) items.push(lines[i++]!.replace(BULLET_LINE, ''));
          out.push(`<ul>${items.map((it) => `<li>${mdInline(it)}</li>`).join('')}</ul>`);
          continue;
        }
        const numbered = line.match(NUMBERED_LINE);
        if (numbered) {
          const start = Number(numbered[1]);
          const items: string[] = [];
          while (i < lines.length && NUMBERED_LINE.test(lines[i]!)) items.push(lines[i++]!.replace(NUMBERED_LINE, ''));
          out.push(`<ol${start === 1 ? '' : ` start="${start}"`}>${items.map((it) => `<li>${mdInline(it)}</li>`).join('')}</ol>`);
          continue;
        }
        const para: string[] = [];
        // Strip any stray leading heading markers on a mixed block.
        while (i < lines.length && !BULLET_LINE.test(lines[i]!) && !NUMBERED_LINE.test(lines[i]!)) para.push(lines[i++]!.replace(/^\s*#{1,6}\s+/, ''));
        out.push(`<p>${mdInline(para.join(' '))}</p>`);
      }
      return out.join('');
    })
    .join('');
}

// ── localized field labels (report content is already in its language) ──
// `Lang` comes from `languages.ts`; this file used to declare its own copy of the
// union, so the supported list could gain a language and this table stayed
// compiling — and the guards below then collapsed that language to `en`, which is
// the exact shape of the bug: translated prose under English headings.
const RL: Record<Lang, Record<string, string>> = {
  en: { degradedSection: 'We could not complete this section for this report. Everything else was researched and written as usual.', unenrichedSection: 'This section was researched and written, but the pass that adds extra depth to it did not finish. Everything here is sourced as usual.', reconstructedSection: 'The step that researches this section did not finish. A later step wrote it from the rest of the dossier, so read it as less directly sourced than the others.', contents: 'Contents', aiDisclaimer: 'AI-generated research — it can make mistakes. Always verify results against the original listings before acting.', index: 'Report index', mandate: 'Mandate', snapshot: 'Snapshot', business: 'Transaction', location: 'Location', salePrice: 'Sale price', revenue: 'Revenue', multiple: 'Multiple', sde: 'SDE', asking: 'Asking', mentions: 'Mentions', netSentiment: 'Net sentiment', sentimentDist: 'Sentiment distribution', positive: 'Positive', neutral: 'Neutral', negative: 'Negative', source: 'source', yes: 'Yes', no: 'No', howToRead: 'How to read this report', howToReadBody: 'Sections are ordered from summary to detail. Figures in accent colour are AI estimates — verify against primary documents before acting.', kicker: 'AI ANALYSIS REPORT', targets: 'Targets', priceRange: 'Price range', combinedRevenue: 'Combined revenue', combinedSde: 'Combined SDE', footerNote: 'AI-GENERATED — VERIFY RESULTS' },
  es: { degradedSection: 'No pudimos completar esta sección para este informe. Todo lo demás se investigó y redactó con normalidad.', unenrichedSection: 'Esta sección se investigó y redactó, pero la pasada que le agrega profundidad no llegó a completarse. Todo lo que ves aquí está documentado como siempre.', reconstructedSection: 'La etapa que investiga esta sección no llegó a completarse. Una etapa posterior la redactó a partir del resto del dossier, así que tómala como menos documentada que las demás.', contents: 'Contenido', aiDisclaimer: 'Investigación generada por IA — puede cometer errores. Verifica siempre los resultados con los avisos originales antes de actuar.', index: 'Índice del reporte', mandate: 'Mandato', snapshot: 'Resumen', business: 'Transacción', location: 'Ubicación', salePrice: 'Precio de venta', revenue: 'Ingresos', multiple: 'Múltiplo', sde: 'SDE', asking: 'Precio', mentions: 'Menciones', netSentiment: 'Sentimiento neto', sentimentDist: 'Distribución de sentimiento', positive: 'Positivo', neutral: 'Neutral', negative: 'Negativo', source: 'fuente', yes: 'Sí', no: 'No', howToRead: 'Cómo leer este reporte', howToReadBody: 'Las secciones van de resumen a detalle. Las cifras en color son estimaciones de IA — verifícalas con documentos primarios antes de actuar.', kicker: 'INFORME DE ANÁLISIS CON IA', targets: 'Objetivos', priceRange: 'Rango de precio', combinedRevenue: 'Ingresos combinados', combinedSde: 'SDE combinado', footerNote: 'GENERADO CON IA — VERIFICA LOS RESULTADOS' },
  fr: { degradedSection: 'Nous n’avons pas pu terminer cette section pour ce rapport. Tout le reste a été recherché et rédigé normalement.', unenrichedSection: 'Cette section a été recherchée et rédigée, mais la passe qui lui ajoute de la profondeur n’a pas abouti. Tout ce qui figure ici est sourcé comme d’habitude.', reconstructedSection: 'L’étape qui recherche cette section n’a pas abouti. Une étape ultérieure l’a rédigée à partir du reste du dossier : considérez-la comme moins directement sourcée que les autres.', contents: 'Sommaire', aiDisclaimer: 'Recherche générée par IA — elle peut se tromper. Vérifiez toujours les résultats auprès des annonces d’origine avant d’agir.', index: 'Index du rapport', mandate: 'Mandat', snapshot: 'Aperçu', business: 'Transaction', location: 'Localisation', salePrice: 'Prix de vente', revenue: 'Revenu', multiple: 'Multiple', sde: 'SDE', asking: 'Prix', mentions: 'Mentions', netSentiment: 'Sentiment net', sentimentDist: 'Distribution du sentiment', positive: 'Positif', neutral: 'Neutre', negative: 'Négatif', source: 'source', yes: 'Oui', no: 'Non', howToRead: 'Comment lire ce rapport', howToReadBody: 'Les sections vont du résumé au détail. Les chiffres en couleur sont des estimations IA — vérifiez-les avant d’agir.', kicker: 'RAPPORT D’ANALYSE IA', targets: 'Cibles', priceRange: 'Fourchette de prix', combinedRevenue: 'Revenu cumulé', combinedSde: 'SDE cumulé', footerNote: 'GÉNÉRÉ PAR IA — VÉRIFIEZ LES RÉSULTATS' },
  pt: { degradedSection: 'Não conseguimos concluir esta seção deste relatório. Todo o restante foi pesquisado e redigido normalmente.', unenrichedSection: 'Esta seção foi pesquisada e redigida, mas a passagem que lhe acrescenta profundidade não foi concluída. Tudo aqui está documentado como sempre.', reconstructedSection: 'A etapa que pesquisa esta seção não foi concluída. Uma etapa posterior a redigiu a partir do restante do dossiê, portanto leia-a como menos documentada que as demais.', contents: 'Conteúdo', aiDisclaimer: 'Pesquisa gerada por IA — pode cometer erros. Verifique sempre os resultados nos anúncios originais antes de agir.', index: 'Índice do relatório', mandate: 'Mandato', snapshot: 'Resumo', business: 'Transação', location: 'Localização', salePrice: 'Preço de venda', revenue: 'Receita', multiple: 'Múltiplo', sde: 'SDE', asking: 'Preço', mentions: 'Menções', netSentiment: 'Sentimento líquido', sentimentDist: 'Distribuição de sentimento', positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo', source: 'fonte', yes: 'Sim', no: 'Não', howToRead: 'Como ler este relatório', howToReadBody: 'As seções vão do resumo ao detalhe. Números em cor são estimativas de IA — verifique antes de agir.', kicker: 'RELATÓRIO DE ANÁLISE COM IA', targets: 'Alvos', priceRange: 'Faixa de preço', combinedRevenue: 'Receita combinada', combinedSde: 'SDE combinado', footerNote: 'GERADO POR IA — VERIFIQUE OS RESULTADOS' },
};

// ── structured-block detectors (mirror the on-screen viewer) ──
interface Metric { label: string; value: string; emphasis?: string; hint?: string | null }
interface Risk { severity: string; title: string; detail: string }
interface Projection { periods: string[]; rows: Array<{ metric: string; unit?: string; values: Array<number | null> }>; note?: string | null }
interface Source { url: string; label?: string }
interface Mention { platform?: string; url?: string; topic?: string; summary?: string; sentiment?: string }

interface ChartSpec { type: string; title?: string; description?: string; labels: string[]; series: Array<{ name: string; data: Array<number | null> }>; unit?: string }
const CHART_TYPES = new Set(['bar', 'line', 'pie', 'area']);
const isChartSpec = (v: unknown): v is ChartSpec => {
  const o = v as ChartSpec;
  return !!o && typeof o === 'object' && !Array.isArray(o) && CHART_TYPES.has(o.type) && Array.isArray(o.labels) && Array.isArray(o.series);
};
const isMetric = (x: unknown): x is Metric => !!x && typeof x === 'object' && typeof (x as Metric).label === 'string' && typeof (x as Metric).value === 'string' && !('severity' in (x as Obj));
const isRisk = (x: unknown): x is Risk => !!x && typeof x === 'object' && typeof (x as Risk).severity === 'string' && typeof (x as Risk).title === 'string';
const isProjection = (v: unknown): v is Projection => !!v && typeof v === 'object' && Array.isArray((v as Projection).periods) && Array.isArray((v as Projection).rows) && !!(v as Projection).rows[0] && Array.isArray((v as Projection).rows[0]!.values);
const isSourceList = (v: unknown): v is { items: Source[] } => !!v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items) && typeof ((v as { items: Source[] }).items[0]?.url) === 'string';
const isChecklist = (v: unknown): v is { categories: Array<{ category: string; items: string[] }> } => !!v && typeof v === 'object' && Array.isArray((v as { categories?: unknown }).categories) && Array.isArray((v as { categories: Array<{ items?: unknown }> }).categories[0]?.items);
const isTransactions = (v: unknown): v is Obj[] => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && !!v[0] && 'description' in (v[0] as Obj) && ('multiple' in (v[0] as Obj) || 'salePrice' in (v[0] as Obj) || 'revenue' in (v[0] as Obj));
const hasMentions = (v: unknown): v is { overview?: string; mentions: Mention[] } => !!v && typeof v === 'object' && Array.isArray((v as { mentions?: unknown }).mentions);

const SEV_COLOR = (t: PdfTheme, s: string) => (s === 'high' ? t.colors.negative : s === 'medium' ? t.colors.warn : t.colors.positive);
const SENT_COLOR = (t: PdfTheme): Record<string, string> => ({ positive: t.colors.positive, neutral: t.colors.borderStrong, mixed: t.colors.warn, negative: t.colors.negative });
const multipleNum = (m: unknown): string | null => { const x = String(m ?? '').match(/([\d.]+)\s*x/i); return x ? `${x[1]}x` : null; };
const clip = (s: unknown, n = 64): string => { const t = String(s ?? '').replace(/[*_#]/g, ''); return t.length > n ? `${t.slice(0, n).trim()}…` : t; };

// ── block renderers (return HTML strings) ──────────────────────────────────
function metricsGrid(items: Metric[], t: PdfTheme): string {
  const cells = items
    .map((m) => {
      const color = m.emphasis === 'positive' ? t.colors.positive : m.emphasis === 'negative' ? t.colors.negative : t.colors.inkStrong;
      const hint = m.hint ? `<div class="mlabel" style="margin-top:6px">${esc(m.hint)}</div>` : '';
      return `<div class="mtile"><div class="mlabel">${esc(m.label)}</div><div class="mval" style="color:${color}">${esc(m.value)}</div>${hint}</div>`;
    })
    .join('');
  return `<div class="mtiles">${cells}</div>`;
}
function riskRows(items: Risk[], t: PdfTheme): string {
  return `<div class="risks">${items
    .map((r) => {
      const c = SEV_COLOR(t, r.severity);
      return `<div class="riskrow"><span class="sev" style="color:${c};border-color:${c}">${esc(r.severity.toUpperCase())}</span><div><div class="risktitle">${esc(r.title)}</div><div class="riskdetail">${mdToHtml(r.detail)}</div></div></div>`;
    })
    .join('')}</div>`;
}
function barsHtml(labels: string[], values: Array<number | null>, unit: string | undefined, t: PdfTheme, f: NumFmt): string {
  const nums = values.filter((v): v is number => isNum(v));
  const max = nums.length ? Math.max(...nums) : 0;
  const bars = labels
    .map((lab, i) => {
      const v = values[i];
      const h = isNum(v) && max > 0 ? Math.max(4, Math.round((v / max) * 100)) : 0;
      const last = i === labels.length - 1;
      const barColor = last ? t.colors.accent : t.colors.borderStrong;
      const txt = isNum(v) ? (unit ? f.row(unit, v) : f.abbr(v)) : '—';
      return `<div class="bar"><div class="barval">${esc(txt)}</div><div class="barfill" style="height:${h}%;background:${barColor}"></div><div class="barlab">${esc(lab)}</div></div>`;
    })
    .join('');
  return `<div class="chart">${bars}</div>`;
}
function projectionHtml(p: Projection, t: PdfTheme, f: NumFmt): string {
  const dollarRows = p.rows.filter((r) => (r.unit ?? '$') === '$');
  const chartRow = (dollarRows[0] ?? p.rows[0])!;
  const chart = barsHtml(p.periods, chartRow.values, chartRow.unit ?? '$', t, f);
  const head = `<tr><th></th>${p.periods.map((pd) => `<th>${esc(pd)}</th>`).join('')}</tr>`;
  const body = p.rows
    .map((r) => `<tr><td class="tm">${esc(r.metric)}</td>${r.values.map((v) => `<td>${v == null ? '—' : esc(f.row(r.unit, v))}</td>`).join('')}</tr>`)
    .join('');
  const note = p.note ? `<div class="mono muted note">${esc(p.note)}</div>` : '';
  return `<div class="card">${chart}<table class="ptable"><thead>${head}</thead><tbody>${body}</tbody></table>${note}</div>`;
}
function chartVal(unit: string | undefined, v: number | null, f: NumFmt): string {
  if (v == null) return '—';
  return unit ? f.row(unit, v) : f.abbr(v);
}
function chartSpecHtml(spec: ChartSpec, t: PdfTheme, f: NumFmt): string {
  const series = spec.series ?? [];
  const s0 = series[0];
  const header = `${spec.title ? `<div class="chart-title">${esc(spec.title)}</div>` : ''}${spec.description ? `<div class="chart-desc">${esc(spec.description)}</div>` : ''}`;
  // Bar/line/area → CSS bars of the first series. Pie or multi-series → the table
  // below carries the rest (grouped bars in print add little over a clean table).
  const chart = (spec.type === 'bar' || spec.type === 'line' || spec.type === 'area') && s0 && s0.data?.some((v) => isNum(v))
    ? barsHtml(spec.labels ?? [], s0.data ?? [], spec.unit, t, f)
    : '';
  const head = `<tr><th></th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr>`;
  const body = (spec.labels ?? [])
    .map((lab, i) => `<tr><td class="tm">${esc(lab)}</td>${series.map((s) => `<td>${esc(chartVal(spec.unit, s.data?.[i] ?? null, f))}</td>`).join('')}</tr>`)
    .join('');
  const table = series.length ? `<table class="ptable"><thead>${head}</thead><tbody>${body}</tbody></table>` : '';
  return `<div class="card">${header}${chart}${table}</div>`;
}
/**
 * A URL a report may LINK to: `http(s)` and `mailto:`. Anything else — the
 * `javascript:`/`data:` a model can be talked into writing as a `sourceUrl` —
 * is rendered as its label, no anchor. Prose links were already held to this by
 * `mdInline`; the three raw \`href\`s (deal card, community mention, Sources)
 * were not.
 */
export function safeHref(url: unknown): string | null {
  return typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

/** How much of a source's name a row shows before it is cut. Real listing titles: ≤130. */
const SOURCE_LABEL_MAX = 160;

/**
 * What a Sources row says: the HOST, then the page's own title, clipped.
 *
 * The title is whatever the page's author put in `<title>`; the M red team's
 * page called itself "Florida Department of Business Regulation — Official
 * Registry" and, with no host shown and no length bound, that is exactly what
 * the row said. The host is the one thing about a source its author does not
 * choose.
 */
export function sourceLabel(s: { url: string; label?: string }): string {
  const label = (s.label ?? '').trim();
  let host = '';
  try {
    host = new URL(s.url).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  const chars = Array.from(label);
  const clipped = chars.length > SOURCE_LABEL_MAX ? `${chars.slice(0, SOURCE_LABEL_MAX - 1).join('')}…` : label;
  if (!clipped) return host || s.url;
  return host && clipped.toLowerCase() !== host ? `${host} — ${clipped}` : clipped;
}

function sourceListHtml(items: Source[], t: PdfTheme): string {
  return `<ul class="sources">${items
    .map((s) => {
      const href = safeHref(s.url);
      const label = esc(sourceLabel(s));
      return href
        ? `<li><a href="${esc(href)}"><span class="arw" style="color:${t.colors.accent}">↗</span>${label}</a></li>`
        : `<li><span class="arw" style="color:${t.colors.accent}">↗</span>${label}</li>`;
    })
    .join('')}</ul>`;
}
function checklistHtml(categories: Array<{ category: string; items: string[] }>, t: PdfTheme): string {
  return categories
    .map((c) => `<div class="checkcat"><div class="flabel">${esc(c.category)}</div><ul class="check">${c.items.map((it) => `<li><span class="cbox" style="border-color:${t.colors.accent}"></span><span>${mdInline(it)}</span></li>`).join('')}</ul></div>`)
    .join('');
}
function transactionsHtml(rows: Obj[], l: Record<string, string>, f: NumFmt): string {
  const head = `<tr><th>${esc(l.business)}</th><th>${esc(l.location)}</th><th>${esc(l.salePrice)}</th><th>${esc(l.revenue)}</th><th>${esc(l.multiple)}</th></tr>`;
  const body = rows
    .map((r) => {
      const mult = multipleNum(r.multiple);
      return `<tr><td class="tm">${esc(clip(r.business ?? r.description))}</td><td>${typeof r.location === 'string' ? esc(r.location) : '—'}</td><td>${isNum(r.salePrice) ? esc(f.money(r.salePrice)) : '—'}</td><td>${isNum(r.revenue) ? esc(f.money(r.revenue)) : '—'}</td><td class="mult">${mult ?? '—'}</td></tr>`;
    })
    .join('');
  return `<div class="card p0"><table class="ptable"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
function sentimentHtml(v: { overview?: string; mentions: Mention[] }, l: Record<string, string>, t: PdfTheme): string {
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
  const S = SENT_COLOR(t);
  const tiles = `<div class="mtiles"><div class="mtile"><div class="mlabel">${esc(l.mentions)}</div><div class="mval">${total}</div></div><div class="mtile"><div class="mlabel">${esc(l.netSentiment)}</div><div class="mval" style="color:${net >= 0 ? t.colors.positive : t.colors.negative}">${net >= 0 ? '+' : ''}${net}</div></div></div>`;
  const dist = total
    ? `<div class="sentblock"><div class="flabel">${esc(l.sentimentDist)}</div><div class="sentbar"><span style="width:${pct(c.positive)}%;background:${S.positive}"></span><span style="width:${pct(c.neutral)}%;background:${S.neutral}"></span><span style="width:${pct(c.negative)}%;background:${S.negative}"></span></div><div class="sentlegend"><span><i style="background:${S.positive}"></i>${esc(l.positive)} ${pct(c.positive)}%</span><span><i style="background:${S.neutral}"></i>${esc(l.neutral)} ${pct(c.neutral)}%</span><span><i style="background:${S.negative}"></i>${esc(l.negative)} ${pct(c.negative)}%</span></div></div>`
    : '';
  const overview = v.overview ? `<div class="sentblock">${mdToHtml(v.overview)}</div>` : '';
  const cards = mentions
    .map((m) => {
      const sc = S[m.sentiment ?? 'neutral'] ?? t.colors.muted;
      const src = safeHref(m.url) ? `<a class="mono srclink" href="${esc(safeHref(m.url))}" style="color:${t.colors.accent}">↗ ${esc(l.source)}</a>` : '';
      return `<div class="mention"><div class="mention-head"><span class="dot" style="background:${sc}"></span><span class="mono plat">${esc(m.platform ?? '')}</span>${m.topic ? `<span class="topic">${esc(m.topic)}</span>` : ''}</div>${m.summary ? `<div class="mention-body">${mdInline(m.summary)}</div>` : ''}${src}</div>`;
    })
    .join('');
  return `${tiles}${dist}${overview}<div class="mentions">${cards}</div>`;
}
function dealCardHtml(d: Obj, l: Record<string, string>, t: PdfTheme, f: NumFmt, cover?: CoverSpec, labels?: Record<string, string>, coverLabels?: Record<string, string>): string {
  const tiles: Array<[string, string]> = [];
  for (const spec of cover?.tiles ?? []) {
    const v = d[spec.field];
    if (isNum(v)) tiles.push([f.money(v), coverLabels?.[spec.labelKey] ?? l[spec.labelKey] ?? humanizeKey(spec.labelKey)]);
  }
  const tileHtml = tiles.length ? `<div class="dtiles">${tiles.map(([v, lab]) => `<div class="dtile"><div class="mlabel">${esc(lab)}</div><div class="mval">${esc(v)}</div></div>`).join('')}</div>` : '';
  // EVERY string field, in the order the section declared them, rather than a
  // hardcoded list of this model's seven. A field a template adds now appears
  // without a change here; another model's fields appeared not at all before.
  const skipProse = new Set([cover?.nameKey ?? '', 'location', 'sourceUrl']);
  const prose = Object.entries(d)
    .filter(([k, v]) => typeof v === 'string' && v && !skipProse.has(k))
    .map(([k, v]) => `<div class="field"><div class="flabel">${esc(labels?.[k] ?? humanizeKey(k))}</div>${mdToHtml(v as string)}</div>`)
    .join('');
  const risks = Array.isArray(d.risks) && d.risks.length
    ? `<div class="field"><div class="flabel">${esc(humanizeKey('risks'))}</div>${(d.risks as unknown[]).every(isRisk) ? riskRows(d.risks as Risk[], t) : `<ul class="bullets">${(d.risks as string[]).map((r) => `<li>${mdInline(r)}</li>`).join('')}</ul>`}</div>`
    : '';
  const loc = typeof d.location === 'string' ? `<div class="mono muted dloc">${esc(d.location)}</div>` : '';
  const url = safeHref(d.sourceUrl) ? `<a class="mono srclink" href="${esc(safeHref(d.sourceUrl))}" style="color:${t.colors.accent}">${esc(l.source)} ↗</a>` : '';
  return `<div class="deal"><div class="dealname">${esc(String(d[cover?.nameKey ?? 'name'] ?? ''))}</div>${loc}${tileHtml}${prose}${risks}${url}</div>`;
}

// ── generic recursive value rendering ──
function valueHtml(v: unknown, k: string | undefined, l: Record<string, string>, t: PdfTheme, f: NumFmt): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return mdToHtml(v);
  if (typeof v === 'number') return `<span>${esc(f.keyed(k, v))}</span>`;
  if (typeof v === 'boolean') return `<span>${v ? l.yes : l.no}</span>`;
  if (isChartSpec(v)) return chartSpecHtml(v, t, f);
  if (Array.isArray(v)) {
    if (!v.length) return '';
    if (v.every(isChartSpec)) return v.map((cspec) => chartSpecHtml(cspec as ChartSpec, t, f)).join('');
    if (v.every(isRisk)) return riskRows(v as Risk[], t);
    if (v.every(isMetric)) return metricsGrid(v as Metric[], t);
    if (isTransactions(v)) return transactionsHtml(v, l, f);
    if (v.every((x) => typeof x === 'string')) return `<ul class="bullets">${v.map((x) => `<li>${mdInline(x as string)}</li>`).join('')}</ul>`;
    return `<div class="stack">${v.map((x) => `<div class="card">${objectFieldsHtml(x as Obj, l, t, f)}</div>`).join('')}</div>`;
  }
  if (typeof v === 'object') {
    if (isSourceList(v)) return sourceListHtml(v.items, t);
    if (isChecklist(v)) return checklistHtml(v.categories, t);
    if (hasMentions(v)) return sentimentHtml(v, l, t);
    if (isProjection(v)) return projectionHtml(v, t, f);
    return objectFieldsHtml(v as Obj, l, t, f);
  }
  return '';
}
function objectFieldsHtml(o: Obj, l: Record<string, string>, t: PdfTheme, f: NumFmt): string {
  // Defensive: an array may hold nulls or primitives — render those directly.
  if (!o || typeof o !== 'object') return valueHtml(o, undefined, l, t, f);
  return `<div class="stack">${Object.entries(o)
    .filter(([, val]) => val != null && val !== '')
    .map(([key, val]) => `<div class="field"><div class="flabel">${esc(humanizeKey(key))}</div>${valueHtml(val, key, l, t, f)}</div>`)
    .join('')}</div>`;
}
function sectionBodyHtml(v: unknown, l: Record<string, string>, t: PdfTheme, f: NumFmt, cover?: CoverSpec, labels?: Record<string, string>, coverLabels?: Record<string, string>): string {
  // Entity cards when the array holds the things this model compares — recognised
  // by the template's own `nameKey`, not by a field called `business`.
  const nameKey = cover?.nameKey;
  if (nameKey && Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && nameKey in (v[0] as Obj)) {
    return `<div class="stack">${(v as Obj[]).map((d) => dealCardHtml(d, l, t, f, cover, labels, coverLabels)).join('')}</div>`;
  }
  return valueHtml(v, undefined, l, t, f);
}

// ── snapshot (cover) ──
/**
 * The entities this model compares, merged across the sections that hold them.
 *
 * Which sections, and which field names one, come from the template's `cover`
 * spec. Both used to be this model's own — `shortlist`/`deep_dives` and
 * `business` — so another model's dossier had no cover statistics and no entity
 * cards, because nothing matched.
 */
function collectDeals(report: Obj, cover: CoverSpec | undefined): Obj[] {
  if (!cover) return [];
  const src = cover.from.flatMap((k: string) => (Array.isArray(report[k]) ? (report[k] as Obj[]) : []));
  const byName = new Map<string, Obj>();
  for (const d of src) {
    const name = String(d[cover.nameKey] ?? Math.random());
    const cur = byName.get(name) ?? {};
    for (const [k, val] of Object.entries(d)) if (val != null && cur[k] == null) cur[k] = val;
    byName.set(name, cur);
  }
  return [...byName.values()];
}

/** Build the full print HTML document for a report. */
/**
 * The line Chromium draws in every page's bottom margin.
 *
 * Lives here, next to the rest of the PDF's copy, because the worker builds the
 * footer template outside the HTML and had it hardcoded in English — on every page
 * of every dossier, including the fully-translated Spanish one.
 */
export function pdfFooterNote(lang: unknown): string {
  const l = (LANGS as string[]).includes(String(lang)) ? (String(lang) as Lang) : 'en';
  return RL[l].footerNote!;
}

export function buildReportHtml(input: BuildReportHtmlInput): string {
  const { report, theme: t } = input;
  // Sections the engine could not complete. Their bodies still SATISFY the report
  // schema — that is what makes the report deliverable — so a required enum holds
  // its first value and a required number holds 0. Rendering one prints a
  // recommendation the engine never made, at a price of zero, into the artifact
  // the buyer keeps and forwards.
  //
  // `meta.sections` is the contract. The web viewer honoured it and this renderer
  // did not, so the same report apologised on screen and fabricated in the PDF —
  // the version that looks most authoritative.
  //
  // Only `lost` suppresses. An `unenriched` section holds real content that a
  // refiner never deepened, and a `reconstructed` one holds what an enricher wrote
  // when its producer never delivered; hiding either would take away work the buyer
  // paid for and replace it with an apology that is not true. They get DIFFERENT
  // lines: `unenriched` says the section was researched, which for `reconstructed`
  // is exactly what did not happen (round 7, R7-1).
  //
  // Read through the coercion, never off the raw field: this renderer is called
  // on a STORED `report.json`, on demand and with `force`, so most of what it
  // sees was written before `meta.sections` existed at all.
  const statuses = normalizeSectionStatuses(input.meta?.sections, input.meta?.degradedSections);
  const degraded = new Set<string>(statuses.filter((x) => x.status === 'lost').map((x) => x.key));
  const unenriched = new Set<string>(statuses.filter((x) => x.status === 'unenriched').map((x) => x.key));
  const reconstructed = new Set<string>(statuses.filter((x) => x.status === 'reconstructed').map((x) => x.key));
  const lang = ((LANGS as string[]).includes(input.lang ?? '') ? input.lang : 'en') as Lang;
  const l = RL[lang];
  // Numbers in the reader's language, money in the model's currency. Built once
  // and threaded like the theme; both used to be `en-US` and `$` everywhere.
  const f = makeNumFmt(lang, input.currency);
  // On the COVER, not only beside the sections it happened to.
  //
  // The per-section lines say what is missing where; this says it once, on the
  // first page, in the artifact the buyer forwards to a partner or a lender.
  // Whoever opens the PDF without ever seeing the web page had no way to know.
  const notice = sectionsNotice(input.lang, statuses);
  const pad = (i: number) => String(i + 1).padStart(2, '0');
  const HIDE = new Set(['search_criteria']);
  const ordered = (input.sections?.length ? input.sections : Object.keys(report).map((k) => ({ key: k, title: humanizeKey(k) })))
    // A degraded section survives even when its placeholder is `null` — a schema
    // nullable at the root degrades to exactly that, and dropping it means the PDF
    // never mentions a section the buyer paid for.
    .filter((s) => (report[s.key] != null || degraded.has(s.key)) && !HIDE.has(s.key));

  // Cover snapshot from deals — never from a degraded section, or the headline
  // price range is computed from placeholder zeros and shows $0 as the cheapest
  // target found.
  const deals = collectDeals(Object.fromEntries(Object.entries(report).filter(([k]) => !degraded.has(k))), input.cover);
  const snap: Array<[string, string]> = [];
  // Localized like everything else on this page. The cover is the first thing the
  // buyer sees and it was English in all four languages — including the complete
  // Spanish case, where every other string on the page was translated.
  // Declared by the model, not inferred from this one's field names. `askingPrice`,
  // `revenue` and `cashFlowSde` were read straight off the report, so a template
  // that calls its figures anything else got a cover with no statistics at all.
  for (const fig of input.cover?.figures ?? []) {
    // NOT out of `paramLabels`: a model whose PARAM happens to share a name with a
    // cover `labelKey` silently overrode the cover's label with the form's.
    const label = input.coverLabels?.[fig.labelKey] ?? l[fig.labelKey] ?? humanizeKey(fig.labelKey);
    if (fig.agg === 'count') {
      if (deals.length) snap.push([String(deals.length), label]);
      continue;
    }
    const nums = deals.map((d) => d[fig.field ?? '']).filter(isNum);
    if (!nums.length) continue;
    if (fig.agg === 'range') {
      // `keyed` decides money vs plain from the FIELD NAME, the same convention
      // every other number in this file already uses. A blanket `money()` put a
      // currency symbol on a sum of acres.
      const fmt = (n: number) => f.keyed(fig.field, n);
      snap.push([nums.length > 1 ? `${fmt(Math.min(...nums))}–${fmt(Math.max(...nums))}` : fmt(nums[0]!), label]);
    } else {
      const total = nums.reduce((x, y) => x + y, 0);
      if (total > 0) snap.push([f.keyed(fig.field, total), label]);
    }
  }

  const date = input.generatedAt ? new Date(input.generatedAt) : undefined;
  // `en-US` printed "03 AUG 2026" on a Portuguese dossier. The locale follows the
  // report like the rest of the page.
  const dateStr = date ? date.toLocaleDateString(lang, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '';
  const yearStr = date ? String(date.getFullYear()) : '';
  const dossierId = `${t.dossierPrefix}-${yearStr}`;

  const mandate = input.params ?? (report.search_criteria as Obj | undefined);
  const mandateRows = mandate
    ? Object.entries(mandate)
        .filter(([k, v]) => {
          if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return false;
          // `instructions` is a param jobs written before 2026-08-17 still carry; it
          // was free text, never a mandate row.
          if (k === 'mode' || k === 'language' || k === 'instructions') return false;
          // `directives` is an object with its own localized block in the manifest;
          // rendered here it printed literally "[object Object]".
          return typeof v !== 'object' || Array.isArray(v);
        })
        .slice(0, 8)
        .map(([k, v]) => `<div class="mrow"><span>${esc(input.paramLabels?.[k] ?? humanizeKey(k))}</span><b>${esc(typeof v === 'boolean' ? (v ? l.yes : l.no) : Array.isArray(v) ? v.join(', ') : isNum(v) ? f.keyed(k, v) : v)}</b></div>`)
        .join('')
    : '';

  const cover = `
  <section class="pg cover">
    <div class="cover-top">
      <div class="brandrow">
        <div class="logo"></div>
        <div><div class="brandname">${esc(t.brand)}</div><div class="mono tagline">${esc(t.tagline)}</div></div>
      </div>
      <div class="mono coverstamp">DOSSIER ${esc(dossierId)}${dateStr ? `<br>${esc(dateStr)}` : ''}</div>
    </div>
    <div class="cover-mid">
      <div class="mono kicker">${esc(l.kicker)}</div>
      <h1 class="covertitle">${esc(input.title ?? t.brand)}</h1>
      ${snap.length ? `<div class="coverstats">${snap.map(([v, lab]) => `<div><div class="mono covstatlab">${esc(lab.toUpperCase())}</div><div class="covstatval">${esc(v)}</div></div>`).join('')}</div>` : ''}
      ${notice ? `<div class="covernotice">${esc(notice)}</div>` : ''}
      <div class="coverdisc">${esc(l.aiDisclaimer)}</div>
    </div>
  </section>`;

  const contents = `
  <section class="pg">
    <div class="body">
      <div class="mono eyebrow muted">${esc((l.contents ?? '').toUpperCase())}</div>
      <h2 class="pagetitle">${esc(l.index)}</h2>
      <ol class="toc">${ordered.map((s, i) => `<li><a href="#sec-${esc(s.key)}"><span class="mono tocn">${pad(i)}</span><span>${esc(s.title)}</span></a></li>`).join('')}</ol>
      ${mandateRows ? `<div class="mandate"><div class="mono flabel muted">${esc((l.mandate ?? '').toUpperCase())}</div><div class="mrows">${mandateRows}</div></div>` : ''}
      <div class="howto"><div class="mono flabel muted">${esc((l.howToRead ?? '').toUpperCase())}</div><p>${esc(l.howToReadBody)}</p></div>
    </div>
  </section>`;

  const sectionsHtml = ordered
    .map((s, i) => `
  <section class="pg" id="sec-${esc(s.key)}">
    <div class="body">
      <div class="mono eyebrow accent">${pad(i)} · ${esc(s.title.toUpperCase())}</div>
      <h2 class="pagetitle">${esc(s.title)}</h2>
      <div class="seccontent">${
        unenriched.has(s.key) ? `<p class="soft">${esc(l.unenrichedSection ?? '')}</p>` : ''
      }${
        reconstructed.has(s.key) ? `<p class="soft">${esc(l.reconstructedSection ?? '')}</p>` : ''
      }${
        degraded.has(s.key)
          ? `<p class="soft">${esc(l.degradedSection ?? '')}</p>`
          : sectionBodyHtml(report[s.key], l, t, f, input.cover, input.paramLabels, input.coverLabels)
      }</div>
    </div>
  </section>`)
    .join('');

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">
<style>@import url('${t.fonts.fontImport}');</style>
<style>${css(t)}</style>
</head><body>${cover}${contents}${sectionsHtml}</body></html>`;
}

function css(t: PdfTheme): string {
  const c = t.colors;
  return `
  /* Content pages reserve top/bottom margins so the running footer never overlaps
     text; the cover (first page) bleeds full with margin 0. */
  @page { size: letter; margin: 0.7in 0; }
  @page :first { margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:${c.page}; }
  body { font-family:${t.fonts.body}; color:${c.ink}; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .mono { font-family:${t.fonts.mono}; }
  .muted { color:${c.muted}; }
  .accent { color:${c.accent}; }
  a { color:${c.accent}; text-decoration:none; word-break:break-word; }
  /* Block layout everywhere content can span pages — flex containers orphan/blank
     under Chrome's print pagination. @page margins reserve the header/footer band. */
  .pg { background:${c.page}; }
  .pg + .pg { break-before:page; }
  .body { padding:0 0.78in; }

  /* cover — full-bleed first page (own padding, @page:first margin 0) */
  .cover { min-height:11in; display:flex; flex-direction:column; justify-content:space-between; background:${c.accent}; color:${c.onAccent}; padding:0.9in 0.85in; position:relative; z-index:1; }
  .cover a { color:${c.onAccent}; }
  .cover-top { display:flex; justify-content:space-between; align-items:flex-start; }
  .brandrow { display:flex; gap:14px; align-items:center; }
  .logo { width:52px; height:52px; border-radius:12px; background:${c.onAccent}; }
  .brandname { font-weight:800; font-size:17px; letter-spacing:-0.01em; }
  .tagline { font-size:9px; letter-spacing:0.16em; margin-top:5px; opacity:0.85; }
  .coverstamp { font-size:10px; letter-spacing:0.12em; text-align:right; opacity:0.9; line-height:1.7; }
  .kicker { font-size:12px; letter-spacing:0.28em; opacity:0.85; margin-bottom:22px; }
  .covertitle { font-size:58px; font-weight:800; letter-spacing:-0.03em; line-height:1.0; margin-bottom:26px; }
  .coverstats { display:flex; gap:34px; flex-wrap:wrap; }
  .covernotice { margin-top:26px; font-size:11.5px; line-height:1.5; max-width:62ch; opacity:0.85; }
  .coverdisc { font-size:10px; line-height:1.55; opacity:0.85; margin-top:28px; max-width:5.4in; }
  .covstatlab { font-size:9px; letter-spacing:0.12em; opacity:0.8; margin-bottom:6px; }
  .covstatval { font-size:26px; font-weight:800; letter-spacing:-0.01em; }

  /* section shell */
  /* Keep the section header with the content that follows it (never orphan it). */
  .eyebrow { font-size:11px; letter-spacing:0.22em; margin-bottom:10px; break-after:avoid; }
  .pagetitle { font-size:30px; font-weight:800; letter-spacing:-0.02em; margin-bottom:22px; color:${c.inkStrong}; break-after:avoid; }
  .seccontent > .stack > .field:first-child, .seccontent > .stack > *:first-child { break-before:avoid; }
  .seccontent { font-size:14px; }
  .seccontent p { font-size:14px; line-height:1.75; color:${c.ink}; margin:0 0 16px; text-align:justify; hyphens:auto; }
  .seccontent strong { color:${c.inkStrong}; }
  .mdh { font-weight:700; font-size:15.5px; color:${c.inkStrong}; margin:16px 0 8px; letter-spacing:-0.01em; }
  /* Block (not flex) with margin gaps → clean page fragmentation. */
  .stack > * + * { margin-top:16px; }
  .field { margin-bottom:2px; }
  .flabel { font-family:${t.fonts.mono}; font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:${c.muted}; margin-bottom:8px; }
  ul.bullets { margin:0 0 18px 0; padding-left:20px; }
  ul.bullets li { font-size:13.5px; line-height:1.75; color:${c.ink}; margin-bottom:18px; text-align:justify; padding-left:6px; }
  ul.bullets li:last-child { margin-bottom:0; }
  ul.bullets li::marker { color:${c.accent}; }

  /* metric tiles — individually bordered + flex-wrap so there are NEVER empty grid
     cells (a 3-col grid with 4 metrics left grey gaps). */
  .mtiles { display:flex; flex-wrap:wrap; gap:10px; margin:0 0 24px; break-inside:avoid; }
  .mtile { flex:1 1 150px; border:1px solid ${c.border}; border-radius:12px; padding:16px 18px; background:${c.page}; }
  .mlabel { font-family:${t.fonts.mono}; font-size:9px; letter-spacing:0.1em; color:${c.muted}; }
  .mval { font-size:22px; font-weight:800; margin-top:6px; letter-spacing:-0.01em; color:${c.inkStrong}; }

  /* risks */
  .risks { margin-bottom:20px; }
  .risks > * + * { margin-top:12px; }
  .riskrow { display:flex; align-items:flex-start; gap:16px; border:1px solid ${c.border}; border-radius:11px; padding:16px 20px; break-inside:avoid; }
  .sev { font-family:${t.fonts.mono}; font-size:10px; font-weight:700; border:1px solid; border-radius:5px; padding:3px 9px; flex:none; margin-top:2px; }
  .risktitle { font-size:14px; font-weight:700; color:${c.inkStrong}; }
  .riskdetail { font-size:12.5px; line-height:1.6; color:${c.muted}; margin-top:4px; }
  .riskdetail p { font-size:12.5px; line-height:1.6; margin:0 0 6px; text-align:justify; }

  /* cards / charts / tables */
  /* Large containers may split across a page; box-decoration-break makes each
     fragment render its own clean border/padding (a graceful "continued" look). */
  .card { border:1px solid ${c.border}; border-radius:14px; padding:24px 26px; margin-bottom:22px; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
  .card.p0 { padding:0; overflow:hidden; }
  .chart-title { font-size:14px; font-weight:700; color:${c.inkStrong}; margin-bottom:4px; }
  .chart-desc { font-size:12.5px; color:${c.muted}; line-height:1.5; margin-bottom:18px; text-align:justify; }
  .chart { display:flex; align-items:flex-end; gap:14px; height:150px; margin-bottom:20px; }
  .bar { flex:1; display:flex; flex-direction:column; align-items:center; gap:8px; height:100%; justify-content:flex-end; }
  .barval { font-family:${t.fonts.mono}; font-size:10px; color:${c.muted}; }
  .barfill { width:100%; max-width:54px; border-radius:6px 6px 0 0; }
  .barlab { font-family:${t.fonts.mono}; font-size:10px; color:${c.muted}; }
  table.ptable { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.ptable th { text-align:right; font-family:${t.fonts.mono}; font-size:9px; letter-spacing:0.08em; text-transform:uppercase; color:${c.muted}; padding:12px 14px; border-bottom:1px solid ${c.border}; }
  table.ptable th:first-child, table.ptable td:first-child { text-align:left; }
  table.ptable td { text-align:right; padding:11px 14px; border-bottom:1px solid ${c.border}; color:${c.ink}; }
  table.ptable tr:last-child td { border-bottom:0; }
  .ptable .tm { font-weight:600; color:${c.inkStrong}; }
  .ptable .mult { font-family:${t.fonts.mono}; color:${c.accent}; font-weight:700; }
  .note { font-size:11px; margin-top:8px; }

  /* sources */
  ul.sources { list-style:none; margin:0 0 16px; padding:0; column-count:2; column-gap:24px; }
  ul.sources li { font-size:11.5px; line-height:1.5; margin-bottom:7px; break-inside:avoid; }
  .arw { margin-right:5px; font-weight:700; }

  /* checklist */
  .checkcat { margin-bottom:18px; }
  ul.check { list-style:none; margin:0; padding:0; }
  ul.check li { display:flex; align-items:flex-start; gap:10px; font-size:13px; line-height:1.55; color:${c.ink}; margin-bottom:9px; }
  .cbox { width:14px; height:14px; border:1.5px solid; border-radius:4px; flex:none; margin-top:2px; }

  /* sentiment */
  .sentblock { margin-bottom:18px; }
  .sentbar { display:flex; height:10px; border-radius:5px; overflow:hidden; margin-top:8px; }
  .sentbar span { display:block; height:100%; }
  .sentlegend { display:flex; gap:18px; margin-top:10px; font-family:${t.fonts.mono}; font-size:10px; color:${c.muted}; }
  .sentlegend i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:5px; }
  .mentions > * + * { margin-top:12px; }
  .mention { background:${c.tint}; border-radius:12px; padding:16px 18px; break-inside:avoid; }
  .mention-head { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
  .mention-head .dot { width:8px; height:8px; border-radius:50%; flex:none; }
  .mention-head .plat { font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:${c.muted}; }
  .mention-head .topic { font-size:12px; font-weight:600; color:${c.inkStrong}; }
  .mention-body { font-size:12.5px; line-height:1.6; color:${c.ink}; text-align:justify; }
  .srclink { font-size:10.5px; display:inline-block; margin-top:8px; }

  /* deals */
  .deal { background:${c.tint}; border-radius:14px; padding:24px 26px; margin-bottom:16px; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
  .dealname { font-size:16px; font-weight:800; color:${c.inkStrong}; }
  .dloc { font-size:11px; margin-top:3px; }
  /* Individually-bordered tiles (no empty grey grid cells when there are <3). */
  .dtiles { display:flex; flex-wrap:wrap; gap:12px; margin:14px 0 6px; }
  .dtile { border:1px solid ${c.borderStrong}; border-radius:10px; padding:12px 18px; min-width:118px; }

  /* contents */
  ol.toc { list-style:none; margin:0 0 34px; padding:0; }
  ol.toc li { border-bottom:1px solid ${c.border}; }
  ol.toc li a { display:flex; gap:16px; align-items:baseline; padding:12px 0; font-size:16px; font-weight:600; color:${c.inkStrong}; text-decoration:none; }
  .tocn { color:${c.accent}; font-size:12px; }
  .mandate, .howto { background:${c.tint}; border-radius:14px; padding:22px 24px; margin-top:24px; break-inside:avoid; }
  .mrows { margin-top:12px; }
  .mrow { display:flex; justify-content:space-between; font-size:13px; margin-top:8px; }
  .mrow span { color:${c.muted}; }
  .mrow b { color:${c.inkStrong}; }
  .howto p { font-size:12.5px; line-height:1.65; color:${c.ink}; margin-top:10px; }
  code { font-family:${t.fonts.mono}; font-size:0.9em; background:${c.tint}; padding:1px 5px; border-radius:4px; }
  `;
}
