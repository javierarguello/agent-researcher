import { Accordion, Card, Stack, Text, TypographyStylesProvider } from '@mantine/core';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function humanizeKey(k: string): string {
  const s = k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Render any report value: strings as styled Markdown, arrays/objects structurally. */
function Value({ v }: { v: unknown }) {
  if (v == null || v === '') return <Text c="dimmed" size="sm">—</Text>;
  if (typeof v === 'string') {
    return (
      <TypographyStylesProvider>
        <Markdown remarkPlugins={[remarkGfm]}>{v}</Markdown>
      </TypographyStylesProvider>
    );
  }
  if (typeof v === 'number' || typeof v === 'boolean') return <Text>{String(v)}</Text>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <Text c="dimmed" size="sm">—</Text>;
    return (
      <Stack gap="sm">
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
            <Value v={val} />
          </div>
        ))}
      </Stack>
    );
  }
  return null;
}

/** Structured report viewer: sections (titles + order from the manifest) with
 *  styled Markdown / nested content. */
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
          <Accordion.Panel><Value v={report[s.key]} /></Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
