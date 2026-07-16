import { Accordion, Card, Stack, Text, TypographyStylesProvider } from '@mantine/core';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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

// --- value renderer ----------------------------------------------------------
/** Open every markdown link in a new tab. */
const mdComponents = {
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

function Value({ v, fieldKey }: { v: unknown; fieldKey?: string }) {
  if (v == null || v === '') return <Text c="dimmed" size="sm">—</Text>;
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
    return (
      <Stack gap="xs">
        {Object.entries(v as Record<string, unknown>).map(([k, val]) => (
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
