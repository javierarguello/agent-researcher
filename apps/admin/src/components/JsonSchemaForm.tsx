import { Accordion, Autocomplete, Group, NumberInput, RangeSlider, Select, Stack, Switch, TagsInput, Text, Textarea, TextInput } from '@mantine/core';
import type { ModeInfo, ParamRangeUi, ParamsUi } from '../api/types';

export interface JsonProp {
  type?: string;
  enum?: string[];
  default?: unknown;
  items?: { type?: string; maxLength?: number };
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  description?: string;
}
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonProp>;
  required?: string[];
}

/** "askingPriceMin" → "Asking price min". */
function humanize(key: string): string {
  const words = key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Seed a value object from a JSON-Schema's declared defaults. */
export function defaultsFor(schema: JsonSchema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
    if (prop.default !== undefined) out[key] = prop.default;
  }
  return out;
}

/** Ordered rows of field keys: ui.rows first, then any remaining keys. `omit`
 *  (hidden + advanced) are excluded from both. */
function layout(schema: JsonSchema, ui: ParamsUi | undefined, omit: Set<string>): string[][] {
  const all = Object.keys(schema.properties ?? {});
  const rows = (ui?.rows ?? []).map((r) => r.filter((k) => !omit.has(k) && all.includes(k)));
  const placed = new Set(rows.flat());
  const rest = all.filter((k) => !placed.has(k) && !omit.has(k)).map((k) => [k]);
  return [...rows, ...rest].filter((r) => r.length > 0);
}

/** A form generated from a template's params JSON-Schema + optional UI hints. */
export function JsonSchemaForm({
  schema,
  ui,
  modes,
  value,
  onChange,
}: {
  schema: JsonSchema;
  ui?: ParamsUi;
  modes?: ModeInfo[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const required = new Set(schema.required ?? []);
  const creditWord = (n: number) => `${n} credit${n > 1 ? 's' : ''}`;

  // The control itself, WITHOUT any description (help is rendered separately,
  // below the input, so variable-height help never misaligns a two-column row).
  function control(key: string) {
    const prop = schema.properties?.[key]!;
    const f = ui?.fields?.[key];
    const label = humanize(key);
    const placeholder = f?.placeholder;
    const isRequired = required.has(key) && prop.default === undefined;
    const widget = f?.widget;
    const common = { label, placeholder };
    const maxLength = prop.maxLength;

    if (prop.enum || widget === 'select') {
      const opts = prop.enum ?? f?.suggestions ?? [];
      // If this enum is the report tier, show each option with its credit cost.
      const isMode = modes && prop.enum && prop.enum.every((v) => modes.some((m) => m.key === v));
      const data = isMode
        ? modes!.map((m) => ({ value: m.key, label: `${m.label} · ${creditWord(m.credits)}` }))
        : opts.map((v) => ({ value: v, label: f?.optionLabels?.[v] ?? v }));
      return <Select {...common} data={data} value={(value[key] as string) ?? null} onChange={(v) => set(key, v)} required={isRequired} />;
    }
    if (prop.type === 'boolean' || widget === 'switch') {
      return <Switch mt={6} label={label} checked={Boolean(value[key])} onChange={(e) => set(key, e.currentTarget.checked)} />;
    }
    if (prop.type === 'integer' || prop.type === 'number' || widget === 'number') {
      return <NumberInput {...common} min={prop.minimum ?? 0} max={prop.maximum} allowNegative={(prop.minimum ?? 0) < 0} value={(value[key] as number) ?? ''} onChange={(v) => set(key, typeof v === 'number' ? v : undefined)} required={isRequired} />;
    }
    if (prop.type === 'array' || widget === 'tags') {
      const itemMax = prop.items?.maxLength;
      return <TagsInput {...common} data={f?.suggestions ?? []} maxTags={prop.maxItems} value={(value[key] as string[]) ?? []} onChange={(v) => set(key, itemMax ? v.map((t) => t.slice(0, itemMax)) : v)} />;
    }
    if (widget === 'textarea' || key.toLowerCase().includes('instruction')) {
      return <Textarea {...common} maxLength={maxLength} value={(value[key] as string) ?? ''} onChange={(e) => set(key, e.currentTarget.value)} autosize minRows={2} />;
    }
    if (f?.suggestions?.length || widget === 'autocomplete') {
      return <Autocomplete {...common} data={f?.suggestions ?? []} maxLength={maxLength} value={(value[key] as string) ?? ''} onChange={(v) => set(key, maxLength ? v.slice(0, maxLength) : v)} required={isRequired} />;
    }
    return <TextInput {...common} maxLength={maxLength} value={(value[key] as string) ?? ''} onChange={(e) => set(key, e.currentTarget.value)} required={isRequired} />;
  }

  // One cell = label+input (via control) with the help text pinned BELOW it.
  function cell(key: string) {
    const prop = schema.properties?.[key];
    if (!prop) return <div key={key} />;
    const help = ui?.fields?.[key]?.help ?? prop.description;
    return (
      <Stack key={key} gap={4} style={{ flex: 1 }}>
        {control(key)}
        {help && <Text size="xs" c="dimmed">{help}</Text>}
      </Stack>
    );
  }

  // A min/max pair rendered as one range slider (extremes clear the bound).
  function rangeField(r: ParamRangeUi) {
    const fmt = (n: number) => `${r.prefix ?? ''}${n.toLocaleString('en-US')}`;
    const lo = (value[r.minKey] as number) ?? r.min;
    const hi = (value[r.maxKey] as number) ?? r.max;
    return (
      <div key={r.minKey}>
        <Group justify="space-between" mb={2}>
          <Text size="sm" fw={500}>{r.label}</Text>
          <Text size="xs" c="dimmed">{fmt(lo)} – {hi >= r.max ? `${fmt(r.max)}+` : fmt(hi)}</Text>
        </Group>
        <RangeSlider
          min={r.min}
          max={r.max}
          step={r.step}
          value={[lo, hi]}
          label={fmt}
          onChange={([a, b]) =>
            onChange({ ...value, [r.minKey]: a <= r.min ? undefined : a, [r.maxKey]: b >= r.max ? undefined : b })
          }
          mt="xs"
          mb="lg"
        />
      </div>
    );
  }

  const ranges = ui?.ranges ?? [];
  const rangeKeys = new Set(ranges.flatMap((r) => [r.minKey, r.maxKey]));
  const advancedKeys = (ui?.advanced ?? []).filter((k) => schema.properties?.[k]);
  const omit = new Set([...(ui?.hidden ?? []), ...advancedKeys]);

  return (
    <Stack gap="sm">
      {layout(schema, ui, omit).map((row, i) => {
        // A row that is exactly a range's min/max pair renders as one slider.
        const r = ranges.find((rg) => row.includes(rg.minKey) && row.includes(rg.maxKey));
        if (r) return <div key={i}>{rangeField(r)}</div>;
        const keys = row.filter((k) => !rangeKeys.has(k));
        if (!keys.length) return null;
        return (
          <Group key={i} grow align="flex-start" gap="sm" wrap="nowrap">
            {keys.map((key) => cell(key))}
          </Group>
        );
      })}

      {advancedKeys.length > 0 && (
        <Accordion variant="separated" defaultValue={null} mt="xs">
          <Accordion.Item value="advanced">
            <Accordion.Control>Advanced</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">{advancedKeys.map((key) => cell(key))}</Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Stack>
  );
}
