/**
 * Builds a print-ready HTML document for a research report — the SHARED base used
 * by every app's PDF (the worker renders this HTML to PDF with headless Chromium).
 * Layout + structure live here and are app-agnostic; per-app branding comes from
 * the `PdfTheme`. It feature-detects the same structured blocks the on-screen
 * viewer does (metrics, risks, projections, sources, checklists, transactions,
 * community sentiment), so any report version renders without failing.
 */
import type { PdfTheme } from './theme.js';

type Obj = Record<string, unknown>;

export interface BuildReportHtmlInput {
  report: Obj;
  meta?: Obj;
  /** Ordered sections (key + localized title) from the template manifest. */
  sections?: Array<{ key: string; title: string }>;
  title?: string;
  /** Request params (for the mandate/criteria block). */
  params?: Obj;
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
const abbr = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const money = (n: number) => `$${abbr(n)}`;
function fmtNumber(key: string | undefined, n: number): string {
  const k = (key ?? '').toLowerCase();
  if (/year|count|targetcount|\bid\b/.test(k)) return String(n);
  return CURRENCY_RE.test(k) ? money(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function rowVal(unit: string | undefined, v: number): string {
  if (unit === '%') return `${v}%`;
  if (unit === 'x') return `${v}x`;
  if (unit === '#') return v.toLocaleString('en-US');
  return money(v);
}

/** Minimal, SAFE Markdown → HTML (escape first, then a few inline/block rules). */
function mdInline(s: string): string {
  let out = esc(s);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t, u) => `<a href="${esc(u)}">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}
function mdToHtml(md: string): string {
  const blocks = String(md ?? '').trim().split(/\n{2,}/);
  return blocks
    .map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${mdInline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${mdInline(lines.join(' '))}</p>`;
    })
    .join('');
}

// ── localized field labels (report content is already in its language) ──
type Lang = 'en' | 'es' | 'fr' | 'pt';
const RL: Record<Lang, Record<string, string>> = {
  en: { contents: 'Contents', index: 'Report index', mandate: 'Mandate', snapshot: 'Snapshot', business: 'Transaction', location: 'Location', salePrice: 'Sale price', revenue: 'Revenue', multiple: 'Multiple', sde: 'SDE', asking: 'Asking', mentions: 'Mentions', netSentiment: 'Net sentiment', sentimentDist: 'Sentiment distribution', positive: 'Positive', neutral: 'Neutral', negative: 'Negative', source: 'source', howToRead: 'How to read this report', howToReadBody: 'Sections are ordered from summary to detail. Figures in accent colour are AI estimates — verify against primary documents before acting.' },
  es: { contents: 'Contenido', index: 'Índice del reporte', mandate: 'Mandato', snapshot: 'Resumen', business: 'Transacción', location: 'Ubicación', salePrice: 'Precio de venta', revenue: 'Ingresos', multiple: 'Múltiplo', sde: 'SDE', asking: 'Precio', mentions: 'Menciones', netSentiment: 'Sentimiento neto', sentimentDist: 'Distribución de sentimiento', positive: 'Positivo', neutral: 'Neutral', negative: 'Negativo', source: 'fuente', howToRead: 'Cómo leer este reporte', howToReadBody: 'Las secciones van de resumen a detalle. Las cifras en color son estimaciones de IA — verifícalas con documentos primarios antes de actuar.' },
  fr: { contents: 'Sommaire', index: 'Index du rapport', mandate: 'Mandat', snapshot: 'Aperçu', business: 'Transaction', location: 'Localisation', salePrice: 'Prix de vente', revenue: 'Revenu', multiple: 'Multiple', sde: 'SDE', asking: 'Prix', mentions: 'Mentions', netSentiment: 'Sentiment net', sentimentDist: 'Distribution du sentiment', positive: 'Positif', neutral: 'Neutre', negative: 'Négatif', source: 'source', howToRead: 'Comment lire ce rapport', howToReadBody: 'Les sections vont du résumé au détail. Les chiffres en couleur sont des estimations IA — vérifiez-les avant d’agir.' },
  pt: { contents: 'Conteúdo', index: 'Índice do relatório', mandate: 'Mandato', snapshot: 'Resumo', business: 'Transação', location: 'Localização', salePrice: 'Preço de venda', revenue: 'Receita', multiple: 'Múltiplo', sde: 'SDE', asking: 'Preço', mentions: 'Menções', netSentiment: 'Sentimento líquido', sentimentDist: 'Distribuição de sentimento', positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo', source: 'fonte', howToRead: 'Como ler este relatório', howToReadBody: 'As seções vão do resumo ao detalhe. Números em cor são estimativas de IA — verifique antes de agir.' },
};

// ── structured-block detectors (mirror the on-screen viewer) ──
interface Metric { label: string; value: string; emphasis?: string; hint?: string | null }
interface Risk { severity: string; title: string; detail: string }
interface Projection { periods: string[]; rows: Array<{ metric: string; unit?: string; values: Array<number | null> }>; note?: string | null }
interface Source { url: string; label?: string }
interface Mention { platform?: string; url?: string; topic?: string; summary?: string; sentiment?: string }

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
      return `<div class="mcell"><div class="mlabel">${esc(m.label)}</div><div class="mval" style="color:${color}">${esc(m.value)}</div>${hint}</div>`;
    })
    .join('');
  return `<div class="mgrid">${cells}</div>`;
}
function riskRows(items: Risk[], t: PdfTheme): string {
  return `<div class="risks">${items
    .map((r) => {
      const c = SEV_COLOR(t, r.severity);
      return `<div class="riskrow"><span class="sev" style="color:${c};border-color:${c}">${esc(r.severity.toUpperCase())}</span><div><div class="risktitle">${esc(r.title)}</div><div class="riskdetail">${mdToHtml(r.detail)}</div></div></div>`;
    })
    .join('')}</div>`;
}
function barsHtml(labels: string[], values: Array<number | null>, unit: string | undefined, t: PdfTheme): string {
  const nums = values.filter((v): v is number => isNum(v));
  const max = nums.length ? Math.max(...nums) : 0;
  const bars = labels
    .map((lab, i) => {
      const v = values[i];
      const h = isNum(v) && max > 0 ? Math.max(4, Math.round((v / max) * 100)) : 0;
      const last = i === labels.length - 1;
      const barColor = last ? t.colors.accent : t.colors.borderStrong;
      const txt = isNum(v) ? (unit ? rowVal(unit, v) : abbr(v)) : '—';
      return `<div class="bar"><div class="barval">${esc(txt)}</div><div class="barfill" style="height:${h}%;background:${barColor}"></div><div class="barlab">${esc(lab)}</div></div>`;
    })
    .join('');
  return `<div class="chart">${bars}</div>`;
}
function projectionHtml(p: Projection, t: PdfTheme): string {
  const dollarRows = p.rows.filter((r) => (r.unit ?? '$') === '$');
  const chartRow = (dollarRows[0] ?? p.rows[0])!;
  const chart = barsHtml(p.periods, chartRow.values, chartRow.unit ?? '$', t);
  const head = `<tr><th></th>${p.periods.map((pd) => `<th>${esc(pd)}</th>`).join('')}</tr>`;
  const body = p.rows
    .map((r) => `<tr><td class="tm">${esc(r.metric)}</td>${r.values.map((v) => `<td>${v == null ? '—' : esc(rowVal(r.unit, v))}</td>`).join('')}</tr>`)
    .join('');
  const note = p.note ? `<div class="mono muted note">${esc(p.note)}</div>` : '';
  return `<div class="card">${chart}<table class="ptable"><thead>${head}</thead><tbody>${body}</tbody></table>${note}</div>`;
}
function sourceListHtml(items: Source[], t: PdfTheme): string {
  return `<ul class="sources">${items.map((s) => `<li><a href="${esc(s.url)}"><span class="arw" style="color:${t.colors.accent}">↗</span>${esc(s.label || s.url)}</a></li>`).join('')}</ul>`;
}
function checklistHtml(categories: Array<{ category: string; items: string[] }>, t: PdfTheme): string {
  return categories
    .map((c) => `<div class="checkcat"><div class="flabel">${esc(c.category)}</div><ul class="check">${c.items.map((it) => `<li><span class="cbox" style="border-color:${t.colors.accent}"></span><span>${mdInline(it)}</span></li>`).join('')}</ul></div>`)
    .join('');
}
function transactionsHtml(rows: Obj[], l: Record<string, string>): string {
  const head = `<tr><th>${esc(l.business)}</th><th>${esc(l.location)}</th><th>${esc(l.salePrice)}</th><th>${esc(l.revenue)}</th><th>${esc(l.multiple)}</th></tr>`;
  const body = rows
    .map((r) => {
      const mult = multipleNum(r.multiple);
      return `<tr><td class="tm">${esc(clip(r.business ?? r.description))}</td><td>${typeof r.location === 'string' ? esc(r.location) : '—'}</td><td>${isNum(r.salePrice) ? esc(money(r.salePrice)) : '—'}</td><td>${isNum(r.revenue) ? esc(money(r.revenue)) : '—'}</td><td class="mult">${mult ?? '—'}</td></tr>`;
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
  const tiles = `<div class="mgrid two"><div class="mcell"><div class="mlabel">${esc(l.mentions)}</div><div class="mval">${total}</div></div><div class="mcell"><div class="mlabel">${esc(l.netSentiment)}</div><div class="mval" style="color:${net >= 0 ? t.colors.positive : t.colors.negative}">${net >= 0 ? '+' : ''}${net}</div></div></div>`;
  const dist = total
    ? `<div class="sentblock"><div class="flabel">${esc(l.sentimentDist)}</div><div class="sentbar"><span style="width:${pct(c.positive)}%;background:${S.positive}"></span><span style="width:${pct(c.neutral)}%;background:${S.neutral}"></span><span style="width:${pct(c.negative)}%;background:${S.negative}"></span></div><div class="sentlegend"><span><i style="background:${S.positive}"></i>${esc(l.positive)} ${pct(c.positive)}%</span><span><i style="background:${S.neutral}"></i>${esc(l.neutral)} ${pct(c.neutral)}%</span><span><i style="background:${S.negative}"></i>${esc(l.negative)} ${pct(c.negative)}%</span></div></div>`
    : '';
  const overview = v.overview ? `<div class="sentblock">${mdToHtml(v.overview)}</div>` : '';
  const cards = mentions
    .map((m) => {
      const sc = S[m.sentiment ?? 'neutral'] ?? t.colors.muted;
      const src = m.url ? `<a class="mono srclink" href="${esc(m.url)}" style="color:${t.colors.accent}">↗ ${esc(l.source)}</a>` : '';
      return `<div class="mention"><div class="mention-head"><span class="dot" style="background:${sc}"></span><span class="mono plat">${esc(m.platform ?? '')}</span>${m.topic ? `<span class="topic">${esc(m.topic)}</span>` : ''}</div>${m.summary ? `<div class="mention-body">${mdInline(m.summary)}</div>` : ''}${src}</div>`;
    })
    .join('');
  return `${tiles}${dist}${overview}<div class="mentions">${cards}</div>`;
}
function dealCardHtml(d: Obj, l: Record<string, string>, t: PdfTheme): string {
  const tiles: Array<[string, string]> = [];
  if (isNum(d.revenue)) tiles.push([money(d.revenue), l.revenue!]);
  if (isNum(d.cashFlowSde)) tiles.push([money(d.cashFlowSde), l.sde!]);
  if (isNum(d.askingPrice)) tiles.push([money(d.askingPrice), l.asking!]);
  const tileHtml = tiles.length ? `<div class="mgrid">${tiles.map(([v, lab]) => `<div class="mcell"><div class="mlabel">${esc(lab)}</div><div class="mval">${esc(v)}</div></div>`).join('')}</div>` : '';
  const prose = (['overview', 'financials', 'impliedMultiple', 'includedAssets', 'leaseTerms', 'reasonForSale', 'growthOpportunities'] as const)
    .map((k) => (typeof d[k] === 'string' && d[k] ? `<div class="field"><div class="flabel">${esc(humanizeKey(k))}</div>${mdToHtml(d[k] as string)}</div>` : ''))
    .join('');
  const risks = Array.isArray(d.risks) && d.risks.length
    ? `<div class="field"><div class="flabel">${esc(humanizeKey('risks'))}</div>${(d.risks as unknown[]).every(isRisk) ? riskRows(d.risks as Risk[], t) : `<ul class="bullets">${(d.risks as string[]).map((r) => `<li>${mdInline(r)}</li>`).join('')}</ul>`}</div>`
    : '';
  const loc = typeof d.location === 'string' ? `<div class="mono muted dloc">${esc(d.location)}</div>` : '';
  const url = typeof d.sourceUrl === 'string' ? `<a class="mono srclink" href="${esc(d.sourceUrl)}" style="color:${t.colors.accent}">${esc(l.source)} ↗</a>` : '';
  return `<div class="deal"><div class="dealname">${esc(String(d.business ?? ''))}</div>${loc}${tileHtml}${prose}${risks}${url}</div>`;
}

// ── generic recursive value rendering ──
function valueHtml(v: unknown, k: string | undefined, l: Record<string, string>, t: PdfTheme): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return mdToHtml(v);
  if (typeof v === 'number') return `<span>${esc(fmtNumber(k, v))}</span>`;
  if (typeof v === 'boolean') return `<span>${v ? 'Yes' : 'No'}</span>`;
  if (Array.isArray(v)) {
    if (!v.length) return '';
    if (v.every(isRisk)) return riskRows(v as Risk[], t);
    if (v.every(isMetric)) return metricsGrid(v as Metric[], t);
    if (isTransactions(v)) return transactionsHtml(v, l);
    if (v.every((x) => typeof x === 'string')) return `<ul class="bullets">${v.map((x) => `<li>${mdInline(x as string)}</li>`).join('')}</ul>`;
    return `<div class="stack">${v.map((x) => `<div class="card">${objectFieldsHtml(x as Obj, l, t)}</div>`).join('')}</div>`;
  }
  if (typeof v === 'object') {
    if (isSourceList(v)) return sourceListHtml(v.items, t);
    if (isChecklist(v)) return checklistHtml(v.categories, t);
    if (hasMentions(v)) return sentimentHtml(v, l, t);
    if (isProjection(v)) return projectionHtml(v, t);
    return objectFieldsHtml(v as Obj, l, t);
  }
  return '';
}
function objectFieldsHtml(o: Obj, l: Record<string, string>, t: PdfTheme): string {
  // Defensive: an array may hold nulls or primitives — render those directly.
  if (!o || typeof o !== 'object') return valueHtml(o, undefined, l, t);
  return `<div class="stack">${Object.entries(o)
    .filter(([, val]) => val != null && val !== '')
    .map(([key, val]) => `<div class="field"><div class="flabel">${esc(humanizeKey(key))}</div>${valueHtml(val, key, l, t)}</div>`)
    .join('')}</div>`;
}
function sectionBodyHtml(v: unknown, l: Record<string, string>, t: PdfTheme): string {
  if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && 'business' in (v[0] as Obj)) {
    return `<div class="stack">${(v as Obj[]).map((d) => dealCardHtml(d, l, t)).join('')}</div>`;
  }
  return valueHtml(v, undefined, l, t);
}

// ── snapshot (cover) ──
function collectDeals(report: Obj): Obj[] {
  const src = [...((report.shortlist as Obj[]) ?? []), ...((report.deep_dives as Obj[]) ?? [])];
  const byName = new Map<string, Obj>();
  for (const d of src) {
    const name = String(d.business ?? Math.random());
    const cur = byName.get(name) ?? {};
    for (const [k, val] of Object.entries(d)) if (val != null && cur[k] == null) cur[k] = val;
    byName.set(name, cur);
  }
  return [...byName.values()];
}

/** Build the full print HTML document for a report. */
export function buildReportHtml(input: BuildReportHtmlInput): string {
  const { report, theme: t } = input;
  const lang = (['en', 'es', 'fr', 'pt'].includes(input.lang ?? '') ? input.lang : 'en') as Lang;
  const l = RL[lang];
  const pad = (i: number) => String(i + 1).padStart(2, '0');
  const HIDE = new Set(['search_criteria']);
  const ordered = (input.sections?.length ? input.sections : Object.keys(report).map((k) => ({ key: k, title: humanizeKey(k) })))
    .filter((s) => report[s.key] != null && !HIDE.has(s.key));

  // Cover snapshot from deals.
  const deals = collectDeals(report);
  const prices = deals.map((d) => d.askingPrice).filter(isNum);
  const revenue = deals.map((d) => d.revenue).filter(isNum).reduce((a, b) => a + b, 0);
  const sde = deals.map((d) => d.cashFlowSde).filter(isNum).reduce((a, b) => a + b, 0);
  const snap: Array<[string, string]> = [];
  if (deals.length) snap.push([String(deals.length), 'Targets']);
  if (prices.length) snap.push([prices.length > 1 ? `${money(Math.min(...prices))}–${money(Math.max(...prices))}` : money(prices[0]!), 'Price range']);
  if (revenue > 0) snap.push([money(revenue), 'Combined revenue']);
  if (sde > 0) snap.push([money(sde), 'Combined SDE']);

  const date = input.generatedAt ? new Date(input.generatedAt) : undefined;
  const dateStr = date ? date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '';
  const yearStr = date ? String(date.getFullYear()) : '';
  const dossierId = `${t.dossierPrefix}-${yearStr}`;

  const mandate = input.params ?? (report.search_criteria as Obj | undefined);
  const mandateRows = mandate
    ? Object.entries(mandate)
        .filter(([k, v]) => v != null && v !== '' && !/^(mode|language|instructions)$/.test(k) && !(Array.isArray(v) && v.length === 0))
        .slice(0, 8)
        .map(([k, v]) => `<div class="mrow"><span>${esc(humanizeKey(k))}</span><b>${esc(Array.isArray(v) ? v.join(', ') : isNum(v) ? fmtNumber(k, v) : v)}</b></div>`)
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
      <div class="mono kicker">AI ANALYSIS REPORT</div>
      <h1 class="covertitle">${esc(input.title ?? t.brand)}</h1>
      ${snap.length ? `<div class="coverstats">${snap.map(([v, lab]) => `<div><div class="mono covstatlab">${esc(lab.toUpperCase())}</div><div class="covstatval">${esc(v)}</div></div>`).join('')}</div>` : ''}
    </div>
  </section>`;

  const contents = `
  <section class="pg">
    <div class="body">
      <div class="mono eyebrow muted">${esc((l.contents ?? '').toUpperCase())}</div>
      <h2 class="pagetitle">${esc(l.index)}</h2>
      <ol class="toc">${ordered.map((s, i) => `<li><span class="mono tocn">${pad(i)}</span><span>${esc(s.title)}</span></li>`).join('')}</ol>
      ${mandateRows ? `<div class="mandate"><div class="mono flabel muted">${esc((l.mandate ?? '').toUpperCase())}</div><div class="mrows">${mandateRows}</div></div>` : ''}
      <div class="howto"><div class="mono flabel muted">${esc((l.howToRead ?? '').toUpperCase())}</div><p>${esc(l.howToReadBody)}</p></div>
    </div>
  </section>`;

  const sectionsHtml = ordered
    .map((s, i) => `
  <section class="pg">
    <div class="body">
      <div class="mono eyebrow accent">${pad(i)} · ${esc(s.title.toUpperCase())}</div>
      <h2 class="pagetitle">${esc(s.title)}</h2>
      <div class="seccontent">${sectionBodyHtml(report[s.key], l, t)}</div>
    </div>
  </section>`)
    .join('');

  const runfoot = `<div class="runfoot"><span>${esc(t.brand.toUpperCase())}</span><span>${esc(dossierId)}</span></div>`;

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">
<style>@import url('${t.fonts.fontImport}');</style>
<style>${css(t)}</style>
</head><body>${runfoot}${cover}${contents}${sectionsHtml}</body></html>`;
}

function css(t: PdfTheme): string {
  const c = t.colors;
  return `
  @page { size: letter; margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:${c.page}; }
  body { font-family:${t.fonts.body}; color:${c.ink}; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .mono { font-family:${t.fonts.mono}; }
  .muted { color:${c.muted}; }
  .accent { color:${c.accent}; }
  a { color:${c.accent}; text-decoration:none; word-break:break-word; }
  /* Block layout (NOT flex) so long sections fragment across pages cleanly — a
     flex column + auto-margin footer orphans section headers under Chrome's
     print pagination. Running footer is drawn per printed page via .runfoot. */
  .pg { min-height:11in; background:${c.page}; }
  .pg + .pg { break-before:page; }
  .body { padding:0.72in 0.78in 0.62in; }
  /* Fixed → repeated by Chrome on every printed page. Hidden over the cover. */
  .runfoot { position:fixed; bottom:0.34in; left:0.78in; right:0.78in; display:flex; justify-content:space-between; align-items:center; padding-top:10px; border-top:1px solid ${c.border}; font-family:${t.fonts.mono}; font-size:8.5px; letter-spacing:0.1em; color:${c.muted}; }

  /* cover */
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
  .covstatlab { font-size:9px; letter-spacing:0.12em; opacity:0.8; margin-bottom:6px; }
  .covstatval { font-size:26px; font-weight:800; letter-spacing:-0.01em; }

  /* section shell */
  /* Keep the section header with the content that follows it (never orphan it). */
  .eyebrow { font-size:11px; letter-spacing:0.22em; margin-bottom:10px; break-after:avoid; }
  .pagetitle { font-size:30px; font-weight:800; letter-spacing:-0.02em; margin-bottom:22px; color:${c.inkStrong}; break-after:avoid; }
  .seccontent > .stack > .field:first-child, .seccontent > .stack > *:first-child { break-before:avoid; }
  .seccontent { font-size:14px; }
  .seccontent p { font-size:14px; line-height:1.75; color:${c.ink}; margin:0 0 16px; max-width:6.2in; }
  .seccontent strong { color:${c.inkStrong}; }
  .stack { display:flex; flex-direction:column; gap:16px; }
  .field { margin-bottom:4px; }
  .flabel { font-family:${t.fonts.mono}; font-size:9.5px; letter-spacing:0.1em; text-transform:uppercase; color:${c.muted}; margin-bottom:8px; }
  ul.bullets { margin:0 0 16px 0; padding-left:18px; }
  ul.bullets li { font-size:13.5px; line-height:1.65; color:${c.ink}; margin-bottom:8px; }

  /* metric grid */
  .mgrid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:1px; background:${c.border}; border:1px solid ${c.border}; border-radius:14px; overflow:hidden; margin:0 0 24px; break-inside:avoid; }
  .mgrid.two { grid-template-columns:1fr 1fr; }
  .mcell { background:${c.page}; padding:18px 20px; }
  .mlabel { font-family:${t.fonts.mono}; font-size:9px; letter-spacing:0.1em; color:${c.muted}; }
  .mval { font-size:22px; font-weight:800; margin-top:6px; letter-spacing:-0.01em; color:${c.inkStrong}; }

  /* risks */
  .risks { display:flex; flex-direction:column; gap:12px; margin-bottom:20px; }
  .riskrow { display:flex; align-items:flex-start; gap:16px; border:1px solid ${c.border}; border-radius:11px; padding:16px 20px; break-inside:avoid; }
  .sev { font-family:${t.fonts.mono}; font-size:10px; font-weight:700; border:1px solid; border-radius:5px; padding:3px 9px; flex:none; margin-top:2px; }
  .risktitle { font-size:14px; font-weight:700; color:${c.inkStrong}; }
  .riskdetail { font-size:12.5px; line-height:1.6; color:${c.muted}; margin-top:4px; }
  .riskdetail p { font-size:12.5px; line-height:1.6; margin:0 0 6px; }

  /* cards / charts / tables */
  /* Large containers may split across a page (a huge deal/prose card taller than
     the space under a header must NOT jump to the next page and orphan it). */
  .card { border:1px solid ${c.border}; border-radius:14px; padding:24px 26px; margin-bottom:22px; }
  .card.p0 { padding:0; overflow:hidden; }
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
  .mentions { display:flex; flex-direction:column; gap:12px; }
  .mention { background:${c.tint}; border-radius:12px; padding:16px 18px; break-inside:avoid; }
  .mention-head { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
  .mention-head .dot { width:8px; height:8px; border-radius:50%; flex:none; }
  .mention-head .plat { font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:${c.muted}; }
  .mention-head .topic { font-size:12px; font-weight:600; color:${c.inkStrong}; }
  .mention-body { font-size:12.5px; line-height:1.6; color:${c.ink}; }
  .srclink { font-size:10.5px; display:inline-block; margin-top:8px; }

  /* deals */
  .deal { background:${c.tint}; border-radius:14px; padding:24px 26px; margin-bottom:16px; }
  .dealname { font-size:16px; font-weight:800; color:${c.inkStrong}; }
  .dloc { font-size:11px; margin-top:3px; }
  .deal .mgrid { margin-top:14px; background:${c.border}; }
  .deal .mcell { background:${c.tint}; }

  /* contents */
  ol.toc { list-style:none; margin:0 0 34px; padding:0; }
  ol.toc li { display:flex; gap:16px; align-items:baseline; padding:12px 0; border-bottom:1px solid ${c.border}; font-size:16px; font-weight:600; color:${c.inkStrong}; }
  .tocn { color:${c.accent}; font-size:12px; }
  .mandate, .howto { background:${c.tint}; border-radius:14px; padding:22px 24px; margin-top:24px; }
  .mrows { display:flex; flex-direction:column; gap:8px; margin-top:12px; }
  .mrow { display:flex; justify-content:space-between; font-size:13px; }
  .mrow span { color:${c.muted}; }
  .mrow b { color:${c.inkStrong}; }
  .howto p { font-size:12.5px; line-height:1.65; color:${c.ink}; margin-top:10px; }
  code { font-family:${t.fonts.mono}; font-size:0.9em; background:${c.tint}; padding:1px 5px; border-radius:4px; }
  `;
}
