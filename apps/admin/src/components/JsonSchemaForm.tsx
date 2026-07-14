import { NumberInput, Select, Stack, Switch, TagsInput, Textarea, TextInput } from '@mantine/core';

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

/** A form generated from a template's params JSON-Schema (Zod → JSON Schema). */
export function JsonSchemaForm({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const required = new Set(schema.required ?? []);
  const props = Object.entries(schema.properties ?? {});

  return (
    <Stack>
      {props.map(([key, prop]) => {
        const label = humanize(key);
        // Fields with a default are effectively optional in the form.
        const isRequired = required.has(key) && prop.default === undefined;

        if (prop.enum) {
          return (
            <Select
              key={key}
              label={label}
              description={prop.description}
              data={prop.enum}
              value={(value[key] as string) ?? null}
              onChange={(v) => set(key, v)}
              required={isRequired}
            />
          );
        }
        if (prop.type === 'boolean') {
          return (
            <Switch
              key={key}
              label={label}
              description={prop.description}
              checked={Boolean(value[key])}
              onChange={(e) => set(key, e.currentTarget.checked)}
            />
          );
        }
        if (prop.type === 'integer' || prop.type === 'number') {
          return (
            <NumberInput
              key={key}
              label={label}
              description={prop.description}
              min={prop.minimum}
              value={(value[key] as number) ?? ''}
              onChange={(v) => set(key, typeof v === 'number' ? v : undefined)}
              required={isRequired}
            />
          );
        }
        if (prop.type === 'array') {
          return (
            <TagsInput
              key={key}
              label={label}
              description={prop.description}
              value={(value[key] as string[]) ?? []}
              onChange={(v) => set(key, v)}
            />
          );
        }
        // string — long free-text (instructions) gets a textarea.
        if (key.toLowerCase().includes('instruction')) {
          return (
            <Textarea
              key={key}
              label={label}
              description={prop.description}
              value={(value[key] as string) ?? ''}
              onChange={(e) => set(key, e.currentTarget.value)}
              autosize
              minRows={2}
            />
          );
        }
        return (
          <TextInput
            key={key}
            label={label}
            description={prop.description}
            value={(value[key] as string) ?? ''}
            onChange={(e) => set(key, e.currentTarget.value)}
            required={isRequired}
          />
        );
      })}
    </Stack>
  );
}
