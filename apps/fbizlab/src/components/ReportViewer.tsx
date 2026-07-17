import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

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

// ── Localised UI labels (report content itself is already in the report language) ──
type Lang = 'en' | 'es' | 'fr' | 'pt';
const RL: Record<Lang, Record<string, string>> = {
  en: { sections: 'Report sections', snapshot: 'Snapshot', aiReport: 'AI analysis report', dossier: 'Generated dossier', targets: 'Targets', priceRange: 'Price range', combinedRevenue: 'Combined revenue', combinedSde: 'Combined SDE', criteria: 'Mandate', revenue: 'Revenue', sde: 'SDE', asking: 'Asking', location: 'Location', industry: 'Industry', priceBand: 'Price band', revenueFloor: 'Min revenue', cashFlowFloor: 'Min cash flow', financingPreference: 'Financing', realEstatePreference: 'Real estate', business: 'Transaction', salePrice: 'Sale price', multiple: 'Multiple', mentions: 'Mentions', netSentiment: 'Net sentiment', sentimentDist: 'Sentiment distribution', positive: 'Positive', neutral: 'Neutral', negative: 'Negative' },
  es: { sections: 'Secciones', snapshot: 'Resumen', aiReport: 'Reporte de análisis IA', dossier: 'Dossier generado', targets: 'Objetivos', priceRange: 'Rango de precio', combinedRevenue: 'Ingresos combinados', combinedSde: 'SDE combinado', criteria: 'Mandato', revenue: 'Ingresos', sde: 'SDE', asking: 'Precio', location: 'Ubicación', industry: 'Industria', priceBand: 'Rango de precio', revenueFloor: 'Ingreso mín', cashFlowFloor: 'Flujo mín', financingPreference: 'Financiamiento', realEstatePreference: 'Inmueble', business: 'Transacción', salePrice: 'Precio de venta', multiple: 'Múltiplo', mentions: 'Menciones', netSentiment: 'Sentimiento neto', sentimentDist: 'Distribución de sentimiento', positive: 'Positivo', neutral: 'Neutral', negative: 'Negativo' },
  fr: { sections: 'Sections', snapshot: 'Aperçu', aiReport: 'Rapport d’analyse IA', dossier: 'Dossier généré', targets: 'Cibles', priceRange: 'Fourchette de prix', combinedRevenue: 'Revenu combiné', combinedSde: 'SDE combiné', criteria: 'Mandat', revenue: 'Revenu', sde: 'SDE', asking: 'Prix', location: 'Localisation', industry: 'Secteur', priceBand: 'Fourchette de prix', revenueFloor: 'Revenu min', cashFlowFloor: 'Cash-flow min', financingPreference: 'Financement', realEstatePreference: 'Immobilier', business: 'Transaction', salePrice: 'Prix de vente', multiple: 'Multiple', mentions: 'Mentions', netSentiment: 'Sentiment net', sentimentDist: 'Distribution du sentiment', positive: 'Positif', neutral: 'Neutre', negative: 'Négatif' },
  pt: { sections: 'Seções', snapshot: 'Resumo', aiReport: 'Relatório de análise IA', dossier: 'Dossiê gerado', targets: 'Alvos', priceRange: 'Faixa de preço', combinedRevenue: 'Receita combinada', combinedSde: 'SDE combinado', criteria: 'Mandato', revenue: 'Receita', sde: 'SDE', asking: 'Preço', location: 'Localização', industry: 'Setor', priceBand: 'Faixa de preço', revenueFloor: 'Receita mín', cashFlowFloor: 'Fluxo mín', financingPreference: 'Financiamento', realEstatePreference: 'Imóvel', business: 'Transação', salePrice: 'Preço de venda', multiple: 'Múltiplo', mentions: 'Menções', netSentiment: 'Sentimento líquido', sentimentDist: 'Distribuição de sentimento', positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo' },
};

// ── Charts ──
const PALETTE = ['#e65100', '#3d8b5a', '#2563a8', '#a06a00', '#8a5cf0', '#0e8a8a'];
const CHART_TYPES = new Set(['bar', 'line', 'pie', 'area']);
interface ChartSpec { type: 'bar' | 'line' | 'pie' | 'area'; title: string; description?: string; labels: string[]; series: Array<{ name: string; data: Array<number | null> }>; unit?: string; stacked?: boolean; }
function isChartSpec(v: unknown): v is ChartSpec {
  const o = v as ChartSpec | null;
  return !!o && typeof o === 'object' && !Array.isArray(o) && CHART_TYPES.has((o as ChartSpec).type) && Array.isArray(o.labels) && Array.isArray(o.series);
}
function fmtUnit(unit: string | undefined, v: number | null): string {
  if (v == null) return '';
  const s = Math.abs(v) >= 1000 ? abbr(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (unit === '$') return `$${s}`;
  if (unit === '%') return `${v}%`;
  return unit ? `${s}${unit}` : s;
}
function ChartSpecRender({ spec }: { spec: ChartSpec }) {
  const rows = spec.labels.map((label, i) => {
    const r: Record<string, unknown> = { label };
    spec.series.forEach((s) => { r[s.name] = s.data[i] ?? null; });
    return r;
  });
  const tick = (v: number) => fmtUnit(spec.unit, v);
  const legend = spec.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null;
  let chart: React.ReactNode;
  if (spec.type === 'pie') {
    const s0 = spec.series[0];
    const data = spec.labels.map((label, i) => ({ name: label, value: s0?.data[i] ?? 0 }));
    chart = (<PieChart><Pie data={data} dataKey="value" nameKey="name" outerRadius="80%" label={(e: { name: string }) => e.name}>{data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip formatter={(v: number) => fmtUnit(spec.unit, v)} /></PieChart>);
  } else if (spec.type === 'line' || spec.type === 'area') {
    const C = spec.type === 'line' ? LineChart : AreaChart;
    chart = (<C data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5dfd4" /><XAxis dataKey="label" fontSize={11} stroke="#6b6860" /><YAxis tickFormatter={tick} fontSize={11} width={54} stroke="#6b6860" /><Tooltip formatter={(v: number) => fmtUnit(spec.unit, v)} />{legend}{spec.series.map((s, i) => spec.type === 'line'
      ? <Line key={s.name} type="monotone" dataKey={s.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
      : <Area key={s.name} type="monotone" dataKey={s.name} stackId={spec.stacked ? '1' : undefined} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.22} />)}</C>);
  } else {
    chart = (<BarChart data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5dfd4" /><XAxis dataKey="label" fontSize={11} stroke="#6b6860" interval={0} angle={rows.length > 6 ? -20 : 0} textAnchor={rows.length > 6 ? 'end' : 'middle'} height={rows.length > 6 ? 56 : 30} /><YAxis tickFormatter={tick} fontSize={11} width={54} stroke="#6b6860" /><Tooltip formatter={(v: number) => fmtUnit(spec.unit, v)} />{legend}{spec.series.map((s, i) => <Bar key={s.name} dataKey={s.name} stackId={spec.stacked ? '1' : undefined} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />)}</BarChart>);
  }
  return (
    <div className="card" style={{ padding: 16, marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{spec.title}</div>
      {spec.description && <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{spec.description}</div>}
      <div style={{ height: 250 }}><ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer></div>
    </div>
  );
}

const MD = { a: (p: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p} target="_blank" rel="noopener noreferrer" /> };
const Prose = ({ md }: { md: string }) => <div className="prose"><Markdown remarkPlugins={[remarkGfm]} components={MD}>{md}</Markdown></div>;

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
const rowVal = (unit: string | undefined, v: number) => (unit === '%' ? `${v}%` : unit === 'x' ? `${v}x` : unit === '#' ? String(v) : money(v));

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
function ProjectionView({ t }: { t: Projection }) {
  const dollarRows = t.rows.filter((r) => (r.unit ?? '$') === '$');
  const spec: ChartSpec = { type: 'bar', title: '', labels: t.periods, series: (dollarRows.length ? dollarRows : t.rows).map((r) => ({ name: r.metric, data: r.values })), unit: (dollarRows.length ? '$' : t.rows[0]?.unit) };
  return (
    <div>
      <div className="rv-table-wrap"><table className="rv-table">
        <thead><tr><th /><>{t.periods.map((p, i) => <th key={i}>{p}</th>)}</></tr></thead>
        <tbody>{t.rows.map((r, i) => (
          <tr key={i}><td className="rv-table__m">{r.metric}</td><>{r.values.map((v, j) => <td key={j}>{v == null ? '—' : rowVal(r.unit, v)}</td>)}</></tr>
        ))}</tbody>
      </table></div>
      {t.note && <div className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>{t.note}</div>}
      {spec.series.length > 0 && <ChartSpecRender spec={spec} />}
    </div>
  );
}

/** A shortlisted / deep-dived business, rendered as a card with money tiles. */
function DealCard({ d, l }: { d: Obj; l: Record<string, string> }) {
  const tiles: Array<{ value: string; label: string }> = [];
  if (isNum(d.revenue)) tiles.push({ value: money(d.revenue), label: l.revenue! });
  if (isNum(d.cashFlowSde)) tiles.push({ value: money(d.cashFlowSde), label: l.sde! });
  if (isNum(d.askingPrice)) tiles.push({ value: money(d.askingPrice), label: l.asking! });
  const prose = ['overview', 'financials', 'impliedMultiple', 'includedAssets', 'leaseTerms', 'reasonForSale', 'growthOpportunities'] as const;
  const url = typeof d.sourceUrl === 'string' ? d.sourceUrl : undefined;
  return (
    <div className="rv-deal">
      <div className="between" style={{ alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{String(d.business ?? '')}</div>
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
            : <ul className="rv-bullets">{(d.risks as string[]).map((r, i) => <li key={i}><Markdown remarkPlugins={[remarkGfm]} components={MD}>{r}</Markdown></li>)}</ul>}
        </div>
      )}
      {url && <a className="mono accent" style={{ fontSize: 11, display: 'inline-block', marginTop: 10 }} href={url} target="_blank" rel="noreferrer">source ↗</a>}
    </div>
  );
}

// ── Sources → condensed ↗ link list ──
interface Source { url: string; label?: string; id?: number }
const isSourceList = (v: unknown): v is { items: Source[] } => !!v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items) && typeof ((v as { items: Source[] }).items[0]?.url) === 'string';
function SourceList({ items }: { items: Source[] }) {
  return <ul className="rv-sources">{items.map((s, i) => (
    <li key={i}><a href={s.url} target="_blank" rel="noreferrer"><span className="rv-src-arrow">↗</span>{s.label || s.url}</a></li>
  ))}</ul>;
}

// ── Checklist → checkbox-icon items ──
const isChecklist = (v: unknown): v is { categories: Array<{ category: string; items: string[] }> } => !!v && typeof v === 'object' && Array.isArray((v as { categories?: unknown }).categories) && Array.isArray((v as { categories: Array<{ items?: unknown }> }).categories[0]?.items);
function Checklist({ categories }: { categories: Array<{ category: string; items: string[] }> }) {
  return <div className="stack" style={{ gap: 20 }}>{categories.map((c, i) => (
    <div key={i}>
      <div className="rv-flabel">{c.category}</div>
      <ul className="rv-check">{c.items.map((it, j) => (
        <li key={j}><span className="rv-checkbox" /><span><Markdown remarkPlugins={[remarkGfm]} components={MD}>{it}</Markdown></span></li>
      ))}</ul>
    </div>
  ))}</div>;
}

// ── Comparable transactions → table ──
const isTransactions = (v: unknown): v is Obj[] => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && !!v[0] && 'description' in (v[0] as Obj) && ('multiple' in (v[0] as Obj) || 'salePrice' in (v[0] as Obj) || 'revenue' in (v[0] as Obj));
const multipleNum = (m: unknown): string | null => { const x = String(m ?? '').match(/([\d.]+)\s*x/i); return x ? `${x[1]}x` : null; };
const clip = (s: unknown, n = 64): string => { const t = String(s ?? '').replace(/[*_#]/g, ''); return t.length > n ? `${t.slice(0, n).trim()}…` : t; };
function TransactionsTable({ rows, l }: { rows: Obj[]; l: Record<string, string> }) {
  return (
    <div className="rv-table-wrap"><table className="rv-table">
      <thead><tr><th>{l.business}</th><th>{l.location}</th><th>{l.salePrice}</th><th>{l.revenue}</th><th>{l.multiple}</th></tr></thead>
      <tbody>{rows.map((r, i) => {
        const mult = multipleNum(r.multiple);
        return (
          <tr key={i}>
            <td className="rv-table__m rv-table__wrap">{clip(r.business ?? r.description)}</td>
            <td>{typeof r.location === 'string' ? r.location : '—'}</td>
            <td>{isNum(r.salePrice) ? money(r.salePrice) : '—'}</td>
            <td>{isNum(r.revenue) ? money(r.revenue) : '—'}</td>
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
        <div className="stack" style={{ gap: 12, marginTop: 16 }}>{mentions.map((m, i) => (
          <div key={i} className="rv-mention">
            <div className="between" style={{ alignItems: 'center' }}>
              <span className="mono muted" style={{ fontSize: 11 }}>{m.platform}</span>
              {m.sentiment && <span style={{ color: SENT[m.sentiment] ?? 'var(--muted)', fontSize: 12 }}>●</span>}
            </div>
            {m.topic && <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{m.topic}</div>}
            {m.summary && <Prose md={m.summary} />}
            {m.url && <a className="mono accent" style={{ fontSize: 11 }} href={m.url} target="_blank" rel="noreferrer">↗</a>}
          </div>
        ))}</div>
      )}
    </div>
  );
}

/** Generic value renderer for arbitrary nested report fields. */
function Value({ v, k, l }: { v: unknown; k?: string; l: Record<string, string> }) {
  if (v == null || v === '') return null;
  if (isChartSpec(v)) return <ChartSpecRender spec={v} />;
  if (typeof v === 'string') return <Prose md={v} />;
  if (typeof v === 'number') return <span>{fmtNumber(k, v)}</span>;
  if (typeof v === 'boolean') return <span>{v ? 'Yes' : 'No'}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (v.every(isRisk)) return <RiskList items={v as Risk[]} />;
    if (v.every(isMetric)) return <MetricTiles items={v as Metric[]} />;
    if (isTransactions(v)) return <TransactionsTable rows={v} l={l} />;
    if (v.every((x) => typeof x === 'string')) return <ul className="rv-bullets">{v.map((x, i) => <li key={i}><Markdown remarkPlugins={[remarkGfm]} components={MD}>{x as string}</Markdown></li>)}</ul>;
    return <div className="stack" style={{ gap: 10 }}>{v.map((x, i) => <div key={i} className="card" style={{ padding: 14 }}><ObjectFields o={x as Obj} l={l} /></div>)}</div>;
  }
  if (typeof v === 'object') {
    if (isSourceList(v)) return <SourceList items={v.items} />;
    if (isChecklist(v)) return <Checklist categories={v.categories} />;
    if (hasMentions(v)) return <CommunitySentiment v={v} l={l} />;
    if (isProjection(v)) return <ProjectionView t={v} />;
    return <ObjectFields o={v as Obj} l={l} />;
  }
  return null;
}

/** Object → labelled field blocks. */
function ObjectFields({ o, l }: { o: Obj; l: Record<string, string> }) {
  const entries = Object.entries(o).filter(([, val]) => val != null && val !== '');
  return (
    <div className="stack" style={{ gap: 12 }}>
      {entries.map(([k, val]) => (
        <div key={k}>
          <div className="rv-flabel">{humanizeKey(k)}</div>
          <Value v={val} k={k} l={l} />
        </div>
      ))}
    </div>
  );
}

/** Dispatch a whole section to the right presentation. */
function SectionBody({ v, l }: { v: unknown; l: Record<string, string> }) {
  if (Array.isArray(v)) {
    if (v.every(isChartSpec)) return <>{v.map((c, i) => <ChartSpecRender key={i} spec={c as ChartSpec} />)}</>;
    if (v.length && typeof v[0] === 'object' && v[0] && 'business' in (v[0] as Obj)) {
      return <div className="stack" style={{ gap: 14 }}>{(v as Obj[]).map((d, i) => <DealCard key={i} d={d} l={l} />)}</div>;
    }
    return <Value v={v} l={l} />;
  }
  return <Value v={v} l={l} />;
}

// ── Snapshot (right rail) ──
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

/**
 * Renders a report defensively: every section is drawn by FEATURE-DETECTING its
 * shape (isMetric/isRisk/isProjection/string/…), so it never fails across report
 * versions — old prose-only reports and new structured ones both render, and an
 * unknown future field just renders generically. `meta.schemaVersion`
 * ("<template>@<version>") is exposed (data-report-version) so components can
 * identify a report's version for analytics or explicit version branching later.
 */
export function ReportViewer({ report, sections, title, lang = 'en', meta }: {
  report: Obj; sections?: Array<{ key: string; title: string }>; title?: string; lang?: string; meta?: Obj;
}) {
  const l = RL[(lang as Lang)] ?? RL.en;
  const reportVersion = String(meta?.schemaVersion ?? '');
  const HIDE = new Set(['search_criteria']); // shown in the right rail instead
  const ordered = (sections?.length ? sections : Object.keys(report).map((k) => ({ key: k, title: humanizeKey(k) })))
    .filter((s) => report[s.key] != null && !HIDE.has(s.key));
  const pad = (i: number) => String(i + 1).padStart(2, '0');

  // Snapshot metrics from the deals.
  const deals = collectDeals(report);
  const prices = deals.map((d) => d.askingPrice).filter(isNum);
  const revenue = deals.map((d) => d.revenue).filter(isNum).reduce((a, b) => a + b, 0);
  const sde = deals.map((d) => d.cashFlowSde).filter(isNum).reduce((a, b) => a + b, 0);
  const snap: Array<{ value: string; label: string }> = [];
  if (deals.length) snap.push({ value: String(deals.length), label: l.targets! });
  if (prices.length) snap.push({ value: prices.length > 1 ? `${money(Math.min(...prices))}–${money(Math.max(...prices))}` : money(prices[0]!), label: l.priceRange! });
  if (revenue > 0) snap.push({ value: money(revenue), label: l.combinedRevenue! });
  if (sde > 0) snap.push({ value: money(sde), label: l.combinedSde! });

  const crit = report.search_criteria as Obj | undefined;
  const CRIT_KEYS = ['location', 'industry', 'priceBand', 'revenueFloor', 'cashFlowFloor', 'financingPreference', 'realEstatePreference'];
  const critRows = crit ? CRIT_KEYS.filter((k) => crit[k] != null && crit[k] !== '') : [];
  const metaLine = [crit?.location, crit?.industry].filter(Boolean).join(' · ');

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

        {ordered.map((s, i) => (
          <section key={s.key} id={`sec-${s.key}`} className="rv-sec">
            <h2 className="rv-sechead"><span className="rv-secnum">{pad(i)}</span>{s.title}</h2>
            <SectionBody v={report[s.key]} l={l} />
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
        {critRows.length > 0 && (
          <div className="rv-crit">
            <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 10 }}>{l.criteria}</div>
            {critRows.map((k) => (
              <div key={k} className="rv-crit__row">
                <span className="rv-crit__k">{l[k] ?? humanizeKey(k)}</span>
                <span className="rv-crit__v">{String(crit![k])}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
