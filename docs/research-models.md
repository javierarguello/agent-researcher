# Research models

A **research model** (called a *template* in code) is one research vertical —
e.g. `florida-business-for-sale`. It is a single, self-contained data structure
(`ResearchTemplate`, in `packages/core/src/templates/`) that declares:

| Field | Purpose |
|---|---|
| `id`, `name`, `description` | Identity + client-facing metadata. |
| `version` | Report-schema version. Bump only on a **breaking** section change. |
| `basePrompt` | Internal system prompt (highest authority; never exposed verbatim). |
| `paramsSchema` | Zod schema validating the client's params. |
| `sections` | The report's **typed sections** (each with its own sub-schema). |
| `agents` | The **agent workflow** that fills the sections (see [agents.md](agents.md)). |
| `buildBrief` | Turns validated params into the shared research brief. |
| `instructionsField` | Optional param carrying lower-authority client instructions. |

## Sections & the incremental report schema

Each `ReportSection` owns a **Zod sub-schema**:

```ts
{ key: 'shortlist', title: 'Shortlist…', guidance: '…', schema: z.array(listing) }
```

The full report schema is the **composition** of every section's sub-schema
(`reportSchemaOf(template)` → `z.object({ [key]: schema, … })`). This is the
"incremental schema" — each agent builds only its slice, and the executor
assembles the whole. A single agent's expected output is
`sectionSubsetSchema(template, agent’s keys)`.

- **String fields are Markdown.** Prose carries emphasis, lists, and inline
  source citations `[label](url)`. `meta.contentFormat` is `"markdown"`.
- **Data fields are typed.** Prices/counts are `number` (nullable when unknown —
  the JSON always has the key, with `null`), sentiments are enums, etc.
- **Derived sections** (`derived: true` + a `derive()` fn) are filled by the
  engine, not an agent — e.g. `sources` is built from the evidence store.

## The output envelope

The deliverable `report.json` is:

```json
{
  "meta": {
    "title": "…", "template": "florida-business-for-sale",
    "templateVersion": 1, "schemaVersion": "florida-business-for-sale@1",
    "jobId": "…", "language": "es", "generatedAt": "…",
    "contentFormat": "markdown", "degradedSections": []
  },
  "report": { "executive_summary": { … }, "shortlist": [ … ], … }
}
```

`report`'s keys are exactly the section keys, in the template's section order.

## Versioning & non-breaking evolution

The `schemaVersion` (`"<id>@<version>"`) is the **consumer contract**.

- **Additive within a version** — you may *add* sections/fields freely; never
  rename or remove existing keys under the same `version`.
- **Breaking change** — bump `version` (or register a parallel model), so apps
  pinned to the old schema keep working while new ones adopt the new one.
- Every template is checked by `validateTemplate` at load time and in CI
  (`npm run templates:check`), so a malformed change fails fast.

See [extending.md](extending.md) for the concrete how-to.
