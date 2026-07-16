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
  en: { sections: 'Report sections', snapshot: 'Snapshot', aiReport: 'AI analysis report', dossier: 'Generated dossier', targets: 'Targets', priceRange: 'Price range', combinedRevenue: 'Combined revenue', combinedSde: 'Combined SDE', criteria: 'Mandate', revenue: 'Revenue', sde: 'SDE', asking: 'Asking', location: 'Location', industry: 'Industry', priceBand: 'Price band', revenueFloor: 'Min revenue', cashFlowFloor: 'Min cash flow', financingPreference: 'Financing', realEstatePreference: 'Real estate' },
  es: { sections: 'Secciones', snapshot: 'Resumen', aiReport: 'Reporte de análisis IA', dossier: 'Dossier generado', targets: 'Objetivos', priceRange: 'Rango de precio', combinedRevenue: 'Ingresos combinados', combinedSde: 'SDE combinado', criteria: 'Mandato', revenue: 'Ingresos', sde: 'SDE', asking: 'Precio', location: 'Ubicación', industry: 'Industria', priceBand: 'Rango de precio', revenueFloor: 'Ingreso mín', cashFlowFloor: 'Flujo mín', financingPreference: 'Financiamiento', realEstatePreference: 'Inmueble' },
  fr: { sections: 'Sections', snapshot: 'Aperçu', aiReport: 'Rapport d’analyse IA', dossier: 'Dossier généré', targets: 'Cibles', priceRange: 'Fourchette de prix', combinedRevenue: 'Revenu combiné', combinedSde: 'SDE combiné', criteria: 'Mandat', revenue: 'Revenu', sde: 'SDE', asking: 'Prix', location: 'Localisation', industry: 'Secteur', priceBand: 'Fourchette de prix', revenueFloor: 'Revenu min', cashFlowFloor: 'Cash-flow min', financingPreference: 'Financement', realEstatePreference: 'Immobilier' },
  pt: { sections: 'Seções', snapshot: 'Resumo', aiReport: 'Relatório de análise IA', dossier: 'Dossiê gerado', targets: 'Alvos', priceRange: 'Faixa de preço', combinedRevenue: 'Receita combinada', combinedSde: 'SDE combinado', criteria: 'Mandato', revenue: 'Receita', sde: 'SDE', asking: 'Preço', location: 'Localização', industry: 'Setor', priceBand: 'Faixa de preço', revenueFloor: 'Receita mín', cashFlowFloor: 'Fluxo mín', financingPreference: 'Financiamento', realEstatePreference: 'Imóvel' },
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
          <ul className="rv-bullets">{(d.risks as string[]).map((r, i) => <li key={i}><Markdown remarkPlugins={[remarkGfm]} components={MD}>{r}</Markdown></li>)}</ul>
        </div>
      )}
      {url && <a className="mono accent" style={{ fontSize: 11, display: 'inline-block', marginTop: 10 }} href={url} target="_blank" rel="noreferrer">source ↗</a>}
    </div>
  );
}

/** Generic value renderer for arbitrary nested report fields. */
function Value({ v, k }: { v: unknown; k?: string }) {
  if (v == null || v === '') return null;
  if (isChartSpec(v)) return <ChartSpecRender spec={v} />;
  if (typeof v === 'string') return <Prose md={v} />;
  if (typeof v === 'number') return <span>{fmtNumber(k, v)}</span>;
  if (typeof v === 'boolean') return <span>{v ? 'Yes' : 'No'}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (v.every((x) => typeof x === 'string')) return <ul className="rv-bullets">{v.map((x, i) => <li key={i}><Markdown remarkPlugins={[remarkGfm]} components={MD}>{x as string}</Markdown></li>)}</ul>;
    return <div className="stack" style={{ gap: 10 }}>{v.map((x, i) => <div key={i} className="card" style={{ padding: 14 }}><ObjectFields o={x as Obj} /></div>)}</div>;
  }
  if (typeof v === 'object') return <ObjectFields o={v as Obj} />;
  return null;
}

/** Object → labelled field blocks. */
function ObjectFields({ o }: { o: Obj }) {
  const entries = Object.entries(o).filter(([, val]) => val != null && val !== '');
  return (
    <div className="stack" style={{ gap: 12 }}>
      {entries.map(([k, val]) => (
        <div key={k}>
          <div className="rv-flabel">{humanizeKey(k)}</div>
          <Value v={val} k={k} />
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
    return <Value v={v} />;
  }
  return <Value v={v} />;
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

export function ReportViewer({ report, sections, title, lang = 'en' }: {
  report: Obj; sections?: Array<{ key: string; title: string }>; title?: string; lang?: string;
}) {
  const l = RL[(lang as Lang)] ?? RL.en;
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
    <div className="rv">
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
