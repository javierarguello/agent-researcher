# Rendering a model's params in a client UI

A research model ("template") describes its own inputs. Any client — the admin
backoffice (`apps/admin`) or a future **model-specific web app** — renders the
same way: fetch the model's manifest and generate a form from it. Adding a param
to a model then needs **zero UI code** (only optional presentation hints in the
template). This is the pattern to follow for every new client.

## The contract

`GET /templates?lang=<code>` → `{ templates: TemplateManifest[] }` and
`GET /templates/:id?lang=<code>` → one `TemplateManifest`. The list is **scoped to
the app's `allowedTemplates`** (admin apps see all); `/:id` returns `403` if the
app isn't allowed to use that model. Texts are localized to `lang` (default `en`).

```jsonc
{
  "id": "florida-business-for-sale",
  "name": "…", "description": "…", "version": 1,
  "lang": "es",                                  // the language these texts are in
  "sections": [{ "key": "shortlist", "title": "Lista…" }, …],
  "paramsSchema": { /* JSON Schema (draft 2020-12), generated from the Zod schema */ },
  "paramsUi":     { /* optional presentation hints — see below */ },
  "modes": [ { "key": "essential", "label": "Esencial", "credits": 1 },   // report tiers + price
             { "key": "comprehensive", "label": "Completo", "credits": 2 } ],
  "reportSchema": { /* JSON Schema of the report envelope's `report` object */ }
}
```

Everything a client needs is here: the form (`paramsSchema` + `paramsUi`), the
report tiers and their credit cost (`modes`), the report structure
(`sections`/`reportSchema`), and all display texts — in one language.

- **`paramsSchema`** is the **source of truth** — the API re-validates every
  request against it (`POST /research { template, params }`), so the UI is free to
  be lenient; the server rejects anything invalid.
- **Bound every field** (security, assume hostile clients). In the template's Zod
  schema, cap each string with `.max()`, each array with `.max()` items (and a
  `.max()` per item), and each number with a ceiling — so a client can't bloat the
  LLM prompt or the report cost. These bounds surface in the JSON Schema
  (`maxLength` / `maxItems` / `maximum`), and the generated form mirrors them
  (input `maxLength`, `maxTags`, number `max`). The API also enforces a global
  512 KB body limit and length caps on every other endpoint's fields.
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

## Report tiers (`modes`) + enum labels

- **`modes`** is the list of report tiers to pick from — `{ key, label, credits }`.
  Render the picker from it (e.g. "Completo · 2 credits") and bind the choice to
  the `mode` param. The credit cost is authoritative: it's what `POST /research`
  charges. Never hardcode tier names or prices.
- **`paramsUi.fields[key].optionLabels`** maps an enum's raw values to display
  labels — e.g. the `language` param's options render as English/Español/… The
  default is in `paramsSchema.properties.<key>.default`.

## Localization (`lang`)

Pass `?lang=en|es|fr|pt` to `/templates` (default `en`) to get **all** manifest
texts in one language: `name`, `description`, section `title`s, `modes[].label`,
and `paramsUi.fields[*].help`/`placeholder`. Any string a model hasn't translated
falls back to English; an unsupported `lang` is rejected (`400`).

A template supplies translations via `ResearchTemplate.i18n` (keyed by language
code); its own English fields are the base. `optionLabels` for a language picker
use native names (Español, Français…), which read the same in any UI language.

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

**Hand-off to an AI agent:** the interactive OpenAPI spec at `<api>/docs` is
written to be self-sufficient for a coding agent, and
`.claude/skills/agent-researcher-frontend/SKILL.md` is a ready-to-share skill that
teaches an agent to build a frontend against this API end-to-end.
