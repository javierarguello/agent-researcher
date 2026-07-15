import { Autocomplete, Group, NumberInput, Select, Stack, Switch, TagsInput, Textarea, TextInput } from '@mantine/core';
import type { ParamsUi } from '../api/types';

export interface JsonProp {
  type?: string;
  enum?: string[];
  default?: unknown;
  items?: { type?: string };
  minimum?: number;
  maximum?: number;
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

  function field(key: string) {
    const prop = schema.properties?.[key];
    if (!prop) return null;
    const f = ui?.fields?.[key];
    const label = humanize(key);
    const description = f?.help ?? prop.description;
    const placeholder = f?.placeholder;
    const isRequired = required.has(key) && prop.default === undefined;
    const widget = f?.widget;
    const common = { key, label, description, placeholder };

    if (prop.enum || widget === 'select') {
      return <Select {...common} data={prop.enum ?? f?.suggestions ?? []} value={(value[key] as string) ?? null} onChange={(v) => set(key, v)} required={isRequired} />;
    }
    if (prop.type === 'boolean' || widget === 'switch') {
      return <Switch key={key} label={label} description={description} checked={Boolean(value[key])} onChange={(e) => set(key, e.currentTarget.checked)} />;
    }
    if (prop.type === 'integer' || prop.type === 'number' || widget === 'number') {
      return <NumberInput {...common} min={prop.minimum} value={(value[key] as number) ?? ''} onChange={(v) => set(key, typeof v === 'number' ? v : undefined)} required={isRequired} />;
    }
    if (prop.type === 'array' || widget === 'tags') {
      return <TagsInput {...common} data={f?.suggestions ?? []} value={(value[key] as string[]) ?? []} onChange={(v) => set(key, v)} />;
    }
    if (widget === 'textarea' || key.toLowerCase().includes('instruction')) {
      return <Textarea {...common} value={(value[key] as string) ?? ''} onChange={(e) => set(key, e.currentTarget.value)} autosize minRows={2} />;
    }
    // String — suggestions render a free-text autocomplete (type or pick).
    if (f?.suggestions?.length || widget === 'autocomplete') {
      return <Autocomplete {...common} data={f?.suggestions ?? []} value={(value[key] as string) ?? ''} onChange={(v) => set(key, v)} required={isRequired} />;
    }
    return <TextInput {...common} value={(value[key] as string) ?? ''} onChange={(e) => set(key, e.currentTarget.value)} required={isRequired} />;
  }

  return (
    <Stack gap="sm">
      {layout(schema, ui).map((row, i) => (
        <Group key={i} grow align="flex-start" gap="sm" wrap="nowrap">
          {row.map((key) => field(key))}
        </Group>
      ))}
    </Stack>
  );
}
