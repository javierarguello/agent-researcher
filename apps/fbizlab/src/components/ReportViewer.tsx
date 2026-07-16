import { useState } from 'react';
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
const CURRENCY_RE = /price|revenue|cash.?flow|sde|sale|amount|cost|ebitda|valuation|multiple|salary|rent|income/i;
const abbr = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));
function fmtNumber(key: string | undefined, n: number): string {
  const k = (key ?? '').toLowerCase();
  if (/year|count|targetcount|\bid\b/.test(k)) return String(n);
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return CURRENCY_RE.test(k) ? `$${s}` : s;
}

// --- chart specs ---
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
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{spec.title}</div>
      {spec.description && <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{spec.description}</div>}
      <div style={{ height: 250 }}><ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer></div>
    </div>
  );
}

const MD = { a: (p: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p} target="_blank" rel="noopener noreferrer" /> };

function Value({ v, fieldKey }: { v: unknown; fieldKey?: string }) {
  if (v == null || v === '') return <span className="muted">—</span>;
  if (isChartSpec(v)) return <ChartSpecRender spec={v} />;
  if (fieldKey === 'match' && typeof v === 'string') return <span className="badge" style={{ color: v === 'relaxed' ? 'var(--accent)' : 'var(--positive)' }}>{v}</span>;
  if (fieldKey === 'duplicateWarning' && typeof v === 'string') return <span className="risk" style={{ fontSize: 13.5 }}>⚠ {v}</span>;
  if (typeof v === 'string') return <div className="prose"><Markdown remarkPlugins={[remarkGfm]} components={MD}>{v}</Markdown></div>;
  if (typeof v === 'number') return <span>{fmtNumber(fieldKey, v)}</span>;
  if (typeof v === 'boolean') return <span>{v ? 'Yes' : 'No'}</span>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="muted">—</span>;
    if (v.every(isChartSpec)) return <>{v.map((it, i) => <Value key={i} v={it} />)}</>;
    return <div className="stack" style={{ gap: 10 }}>{v.map((it, i) => <div key={i} className="card" style={{ padding: 12 }}><Value v={it} /></div>)}</div>;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val !== null && val !== undefined && val !== '');
    return (
      <div className="stack" style={{ gap: 8 }}>
        {entries.map(([k, val]) => (
          <div key={k}><div className="field"><label>{humanizeKey(k)}</label></div><Value v={val} fieldKey={k} /></div>
        ))}
      </div>
    );
  }
  return null;
}

export function ReportViewer({ report, sections }: { report: Record<string, unknown>; sections?: Array<{ key: string; title: string }> }) {
  const ordered = sections?.length ? sections : Object.keys(report).map((k) => ({ key: k, title: humanizeKey(k) }));
  const present = ordered.filter((s) => report[s.key] !== undefined);
  const [open, setOpen] = useState<Set<string>>(new Set(present.length ? [present[0]!.key] : []));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div>
      {present.map((s) => (
        <div key={s.key} className="acc-item">
          <button className="acc-head" onClick={() => toggle(s.key)}>
            <span>{s.title}</span>
            <span className="muted">{open.has(s.key) ? '–' : '+'}</span>
          </button>
          {open.has(s.key) && <div className="acc-body"><Value v={report[s.key]} fieldKey={s.key} /></div>}
        </div>
      ))}
    </div>
  );
}
