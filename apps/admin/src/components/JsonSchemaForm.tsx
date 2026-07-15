import { Autocomplete, Group, NumberInput, Select, Stack, Switch, TagsInput, Text, Textarea, TextInput } from '@mantine/core';
import type { ParamsUi } from '../api/types';

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

/** Ordered rows of field keys: ui.rows first, then any remaining (non-hidden) keys. */
function layout(schema: JsonSchema, ui?: ParamsUi): string[][] {
  const all = Object.keys(schema.properties ?? {});
  const hidden = new Set(ui?.hidden ?? []);
  const rows = (ui?.rows ?? []).map((r) => r.filter((k) => !hidden.has(k) && all.includes(k)));
  const placed = new Set(rows.flat());
  const rest = all.filter((k) => !placed.has(k) && !hidden.has(k)).map((k) => [k]);
  return [...rows, ...rest].filter((r) => r.length > 0);
}

/** A form generated from a template's params JSON-Schema + optional UI hints. */
export function JsonSchemaForm({
  schema,
  ui,
  value,
  onChange,
}: {
  schema: JsonSchema;
  ui?: ParamsUi;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const required = new Set(schema.required ?? []);

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
      return <Select {...common} data={prop.enum ?? f?.suggestions ?? []} value={(value[key] as string) ?? null} onChange={(v) => set(key, v)} required={isRequired} />;
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

  return (
    <Stack gap="sm">
      {layout(schema, ui).map((row, i) => (
        <Group key={i} grow align="flex-start" gap="sm" wrap="nowrap">
          {row.map((key) => cell(key))}
        </Group>
      ))}
    </Stack>
  );
}
