# Rendering a model's params in a client UI

A research model ("template") describes its own inputs. Any client — the admin
backoffice (`apps/admin`) or a future **model-specific web app** — renders the
same way: fetch the model's manifest and generate a form from it. Adding a param
to a model then needs **zero UI code** (only optional presentation hints in the
template). This is the pattern to follow for every new client.

## The contract

`GET /templates` → `{ templates: TemplateManifest[] }` and `GET /templates/:id`
→ one `TemplateManifest`:

```jsonc
{
  "id": "florida-business-for-sale",
  "name": "…", "description": "…", "version": 1,
  "sections": [{ "key": "shortlist", "title": "Shortlist…" }, …],
  "paramsSchema": { /* JSON Schema (draft 2020-12), generated from the Zod schema */ },
  "paramsUi":     { /* optional presentation hints — see below */ },
  "reportSchema": { /* JSON Schema of the report envelope's `report` object */ }
}
```

- **`paramsSchema`** is the **source of truth** — the API re-validates every
  request against it (`POST /research { template, params }`), so the UI is free to
  be lenient; the server rejects anything invalid.
- **`paramsUi`** is purely cosmetic: layout, per-field help, and suggested values.
  Optional — without it the form still renders, one field per row.

## Generating the form (widget mapping)

Walk `paramsSchema.properties`; pick a control from each property's JSON-Schema
type (an `enum` wins regardless of type). Reference implementation:
`apps/admin/src/components/JsonSchemaForm.tsx`.

| JSON Schema | Control |
|---|---|
| `enum: [...]` | Select |
| `type: boolean` | Switch |
| `type: integer` / `number` | Number input (respects `minimum`) |
| `type: array` (items string) | Tags input (free entry + suggestions) |
| `type: string` **with suggestions** | Autocomplete (type **or** pick) |
| `type: string` (long, e.g. `instructions`) | Textarea |
| `type: string` | Text input |

Seed initial values from each property's `default` (`defaultsFor(schema)`).

## `paramsUi` — presentation hints

Declared on the template (`ResearchTemplate.paramsUi`) and echoed in the manifest.
Shape (`ParamsUi` in `packages/core/src/templates/types.ts`):

```ts
{
  // Condensed layout: rows of param keys rendered side-by-side. Keys not listed
  // are appended one-per-row in schema order.
  rows?: string[][];
  // Per-field hints, keyed by param name.
  fields?: Record<string, {
    help?: string;          // one-line explanation shown under the field
    suggestions?: string[]; // dropdown that STILL allows manual entry
    placeholder?: string;
    widget?: 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'tags' | 'autocomplete';
  }>;
  hidden?: string[];        // param keys to omit from the form
}
```

Example (from `florida-business-for-sale.ts`):

```ts
paramsUi: {
  rows: [
    ['industry', 'location'],
    ['askingPriceMin', 'askingPriceMax'],   // paired min/max on one line
    ['minRevenue', 'minCashFlow'],
    ['keywords'],
  ],
  fields: {
    industry: {
      help: 'Type of business to search for. Pick a suggestion or type your own.',
      placeholder: 'e.g. Laundromats',
      suggestions: ['Laundromats', 'Car washes', 'Restaurants', 'HVAC', …],
    },
    askingPriceMin: { help: 'Minimum asking price (USD). Leave blank for no floor.' },
  },
}
```

**Suggestions always allow manual entry** — a single-value string field renders as
an Autocomplete (type or pick); an array field renders as a Tags input whose
suggestions autocomplete but don't constrain. This is how "industry" offers common
verticals while still accepting anything.

## Submitting

`POST /research { template, params }` with the collected values (identity comes
from the session token, never the body). A `202 { jobId }` is returned; poll
`GET /research/:jobId` for status → signed download URLs on completion. See
[api-reference.md](api-reference.md).

## Building a model-specific web app

Reuse this exact flow: fetch the manifest, render with a generic
`JsonSchemaForm`, submit to `/research`, poll the job. Keep model-specific
knowledge (labels, suggestions, grouping) in the template's `paramsUi`, not in the
client — so the same UI serves every model and new params need no frontend change.
The admin's `NewJobModal` (`apps/admin/src/components/NewJobModal.tsx`) is the
canonical example.
