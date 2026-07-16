import { Accordion, Badge, Card, Stack, Text, TypographyStylesProvider } from '@mantine/core';
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

// --- number formatting -------------------------------------------------------
const CURRENCY_RE = /price|revenue|cash.?flow|sde|sale|amount|cost|ebitda|valuation|multiple|salary|rent|income/i;
const abbr = (n: number) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n);

function fmtNumber(key: string | undefined, n: number): string {
  const k = (key ?? '').toLowerCase();
  if (/year|count|targetcount|\bid\b/.test(k)) return String(n);
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return CURRENCY_RE.test(k) ? `$${s}` : s;
}

// --- chart detection ---------------------------------------------------------
const LABEL_KEYS = ['business', 'name', 'description', 'metric', 'platform', 'title', 'category', 'competitor'];

interface ChartData {
  data: Array<{ label: string; value: number }>;
  currency: boolean;
}
function chartFor(arr: unknown[]): ChartData | null {
  if (arr.length < 2 || arr.length > 30) return null;
  if (!arr.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return null;
  const objs = arr as Record<string, unknown>[];
  const keys = Object.keys(objs[0] ?? {});
  const labelKey = LABEL_KEYS.find((k) => keys.includes(k)) ?? keys.find((k) => typeof objs[0]?.[k] === 'string');
  if (!labelKey) return null;
  const numKeys = keys.filter((k) => objs.some((o) => typeof o[k] === 'number' && Number.isFinite(o[k] as number)));
  if (!numKeys.length) return null;
  const valueKey = numKeys.find((k) => CURRENCY_RE.test(k)) ?? numKeys[0]!;
  const data = objs
    .map((o) => ({ label: String(o[labelKey] ?? '—').slice(0, 40), value: typeof o[valueKey] === 'number' ? (o[valueKey] as number) : NaN }))
    .filter((d) => Number.isFinite(d.value) && d.value > 0);
  if (data.length < 2) return null;
  return { data, currency: CURRENCY_RE.test(valueKey) };
}

function SectionChart({ data, currency }: ChartData) {
  return (
    <div style={{ height: Math.max(120, data.length * 34), marginBottom: 12 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" tickFormatter={(v) => (currency ? `$${abbr(v)}` : abbr(v))} fontSize={11} stroke="var(--mantine-color-dimmed)" />
          <YAxis type="category" dataKey="label" width={150} fontSize={11} stroke="var(--mantine-color-dimmed)" />
          <Tooltip formatter={(v: number) => (currency ? `$${v.toLocaleString('en-US')}` : v.toLocaleString('en-US'))} />
          <Bar dataKey="value" fill="var(--mantine-color-violet-6)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- agent-authored chart specs ---------------------------------------------
const PALETTE = [
  'var(--mantine-color-violet-6)', 'var(--mantine-color-teal-6)', 'var(--mantine-color-blue-6)',
  'var(--mantine-color-orange-6)', 'var(--mantine-color-grape-6)', 'var(--mantine-color-cyan-6)',
];
const CHART_TYPES = new Set(['bar', 'line', 'pie', 'area']);

interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'area';
  title: string;
  description?: string;
  labels: string[];
  series: Array<{ name: string; data: Array<number | null> }>;
  unit?: string;
  stacked?: boolean;
}
function isChartSpec(v: unknown): v is ChartSpec {
  const o = v as ChartSpec | null;
  return !!o && typeof o === 'object' && !Array.isArray(o) && CHART_TYPES.has((o as ChartSpec).type)
    && Array.isArray(o.labels) && Array.isArray(o.series);
}
function fmtUnit(unit: string | undefined, v: number | null): string {
  if (v == null) return '';
  const s = Math.abs(v) >= 1000 ? abbr(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (unit === '$') return `$${s}`;
  if (unit === '%') return `${v}%`;
  return unit ? `${s}${unit}` : s;
}

/** Render an agent-authored chart (bar/line/pie/area). */
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
    const pieData = spec.labels.map((label, i) => ({ name: label, value: s0?.data[i] ?? 0 }));
    chart = (
      <PieChart>
        <Pie data={pieData} dataKey="value" nameKey="name" outerRadius="80%" label={(e: { name: string }) => e.name}>
          {pieData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => fmtUnit(spec.unit, v)} />
      </PieChart>
    );
  } else if (spec.type === 'line') {
    chart = (
      <LineChart data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-default-border)" />
        <XAxis dataKey="label" fontSize={11} />
        <YAxis tickFormatter={tick} fontSize={11} width={56} />
        <Tooltip formatter={(v: number) => fmtUnit(spec.unit, v)} />
        {legend}
        {spec.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />)}
      </LineChart>
    );
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-default-border)" />
        <XAxis dataKey="label" fontSize={11} />
        <YAxis tickFormatter={tick} fontSize={11} width={56} />
        <Tooltip formatter={(v: number) => fmtUnit(spec.unit, v)} />
        {legend}
        {spec.series.map((s, i) => <Area key={s.name} type="monotone" dataKey={s.name} stackId={spec.stacked ? '1' : undefined} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.25} />)}
      </AreaChart>
    );
  } else {
    chart = (
      <BarChart data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-default-border)" />
        <XAxis dataKey="label" fontSize={11} interval={0} angle={rows.length > 6 ? -20 : 0} textAnchor={rows.length > 6 ? 'end' : 'middle'} height={rows.length > 6 ? 60 : 30} />
        <YAxis tickFormatter={tick} fontSize={11} width={56} />
        <Tooltip formatter={(v: number) => fmtUnit(spec.unit, v)} />
        {legend}
        {spec.series.map((s, i) => <Bar key={s.name} dataKey={s.name} stackId={spec.stacked ? '1' : undefined} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />)}
      </BarChart>
    );
  }

  return (
    <Card withBorder padding="md" radius="sm">
      <Text fw={600} size="sm">{spec.title}</Text>
      {spec.description && <Text size="xs" c="dimmed" mb="xs">{spec.description}</Text>}
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    </Card>
  );
}

// --- value renderer ----------------------------------------------------------
/** Open every markdown link in a new tab. */
const mdComponents = {
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

function Value({ v, fieldKey }: { v: unknown; fieldKey?: string }) {
  if (v == null || v === '') return <Text c="dimmed" size="sm">—</Text>;
  if (isChartSpec(v)) return <ChartSpecRender spec={v} />;
  // A "match" field (strict vs relaxed criteria) renders as a badge.
  if (fieldKey === 'match' && typeof v === 'string') {
    return <Badge size="sm" variant="light" color={v === 'relaxed' ? 'orange' : 'teal'} tt="none">{v}</Badge>;
  }
  // A possible-duplicate warning stands out.
  if (fieldKey === 'duplicateWarning' && typeof v === 'string') {
    return <Text size="sm" c="orange">⚠ {v}</Text>;
  }
  if (typeof v === 'string') {
    return (
      <TypographyStylesProvider>
        <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{v}</Markdown>
      </TypographyStylesProvider>
    );
  }
  if (typeof v === 'number') return <Text>{fmtNumber(fieldKey, v)}</Text>;
  if (typeof v === 'boolean') return <Text>{v ? 'Yes' : 'No'}</Text>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <Text c="dimmed" size="sm">—</Text>;
    // Agent-authored charts render as charts (each already has its own Card).
    if (v.every(isChartSpec)) {
      return <Stack gap="sm">{v.map((item, i) => <Value key={i} v={item} />)}</Stack>;
    }
    const chart = chartFor(v);
    return (
      <Stack gap="sm">
        {chart && <SectionChart {...chart} />}
        {v.map((item, i) => (
          <Card key={i} withBorder padding="sm" radius="sm"><Value v={item} /></Card>
        ))}
      </Stack>
    );
  }
  if (typeof v === 'object') {
    // Hide empty optional fields (null / '') to keep the report clean.
    const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val !== null && val !== undefined && val !== '');
    return (
      <Stack gap="xs">
        {entries.map(([k, val]) => (
          <div key={k}>
            <Text fw={600} size="sm" c="dimmed">{humanizeKey(k)}</Text>
            <Value v={val} fieldKey={k} />
          </div>
        ))}
      </Stack>
    );
  }
  return null;
}

/** Structured report viewer: sections (titles + order from the manifest) with
 *  styled Markdown, formatted figures, and charts derived from numeric arrays. */
export function ReportViewer({
  report,
  sections,
}: {
  report: Record<string, unknown>;
  sections?: Array<{ key: string; title: string }>;
}) {
  const ordered = sections?.length
    ? sections
    : Object.keys(report).map((k) => ({ key: k, title: humanizeKey(k) }));
  const present = ordered.filter((s) => report[s.key] !== undefined);

  return (
    <Accordion multiple defaultValue={present.length ? [present[0]!.key] : []} variant="separated">
      {present.map((s) => (
        <Accordion.Item key={s.key} value={s.key}>
          <Accordion.Control><Text fw={600}>{s.title}</Text></Accordion.Control>
          <Accordion.Panel><Value v={report[s.key]} fieldKey={s.key} /></Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
