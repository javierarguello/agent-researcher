# Research models

A **research model** (called a *template* in code) is one research vertical —
e.g. `florida-business-for-sale`. It is a single, self-contained data structure
(`ResearchTemplate`, in `packages/core/src/templates/`) that declares:

| Field | Purpose |
|---|---|
| `id`, `name`, `description` | Identity + client-facing metadata. |
| `version` | Report-schema version (integer). Bump only on a **breaking** section change. |
| `basePrompt` | Internal base system prompt (highest authority; never exposed verbatim). |
| `paramsSchema` | Zod schema validating the client's params. |
| `sections` | The report's **typed sections** (each with its own sub-schema). |
| `agents` | The **agent workflow** that fills the sections (see [agents.md](agents.md)). |
| `modes` | Per-mode cost/scope config for the public `mode` knob (optional). |
| `buildBrief` | Turns validated (effective) params into the shared research brief. |
| `instructionsField` | Optional param name carrying lower-authority client instructions. |

Source of truth for the shapes: `packages/core/src/templates/types.ts`.

## Sections & the incremental report schema

Each `ReportSection` owns a **Zod sub-schema**:

```ts
{ key: 'shortlist', title: 'Shortlist…', guidance: '…', schema: z.array(listing) }
```

| Field | Meaning |
|---|---|
| `key` | Stable machine key = the property name in `report`. |
| `title` | Human title (manifest / docs / UI). |
| `guidance` | What an agent must cover here — injected verbatim into that agent's prompt. |
| `schema` | Typed Zod shape this section contributes. |
| `derived` | If true, the engine fills it deterministically (no producing agent). |
| `derive({ sources, report })` | Builds a derived section's value from the accumulated evidence + report. |

The full report schema is the **composition** of every section's sub-schema
(`reportSchemaOf(template)` → `z.object({ [key]: schema, … })`). This is the
"incremental schema" — each agent builds only its slice
(`sectionSubsetSchema(template, keys)`) and the executor assembles the whole and
validates it.

- **String fields are Markdown.** Prose carries emphasis, lists, and inline source
  citations `[label](url)`. `meta.contentFormat` is `"markdown"`.
- **Data fields are typed.** Prices/counts are `number` (nullable when unknown —
  the JSON always has the key, with `null`), sentiments are enums, etc. Arrays can
  carry Zod minimums (e.g. `risks_red_flags` is `z.array(z.string()).min(8)`).
- **Derived sections** (`derived: true` + a `derive()` fn) are filled by the engine
  last, from the shared evidence store — e.g. `sources` maps every gathered URL to
  `{ id, url, label }`.

## Modes — the single public cost/scope knob

The public API exposes exactly one cost control: `mode` (`essential` |
`comprehensive`), added to `paramsSchema` via `modeParamSchema` (defaults to
`essential`, the cost-safe choice). A template maps each mode to internal config
(`ModeConfig`, `packages/core/src/mode.ts`):

| Field | Effect |
|---|---|
| `budgetScale` | Multiplies every producer's `researchBudget`. |
| `exclude` | Section keys NOT generated in this mode — their sections are dropped and agents that produce **only** excluded keys are skipped. |
| `depth` | Prose depth directive: `light` \| `standard` \| `deep` (see `depth.ts`). |
| `credits` | Credits this mode costs (default: essential 1, comprehensive 2). |
| `params` | Internal param overrides merged into params before `buildBrief` (e.g. `targetCount`). |

At run time `resolveMode` picks the config; the executor builds an **effective
template** (excluded sections/agents removed) and **effective params** (with the
mode's `params` merged), and derives a `DepthProfile` whose `budgetScale` comes
from the mode. `depth`/`targetCount` are therefore internal — the client only sees
`mode`. If a template omits `modes`, `DEFAULT_MODES` apply (essential = 0.5×
budget / light / 1 credit; comprehensive = 1× / standard / 2 credits).

## The output envelope

The deliverable `report.json` is `{ meta, report }`:

```json
{
  "meta": {
    "title": "…", "template": "florida-business-for-sale",
    "templateVersion": 1, "schemaVersion": "florida-business-for-sale@1",
    "jobId": "…", "language": "es",
    "mode": "essential", "depth": "light",
    "generatedAt": "…", "contentFormat": "markdown",
    "cost": { "usd": 1.9, "llmUsd": 1.6, "searchUsd": 0.3,
              "inputTokens": 1200000, "outputTokens": 45000, "searchCalls": 38 },
    "degradedSections": ["financial_analysis"]
  },
  "report": { "executive_summary": { … }, "shortlist": [ … ], … }
}
```

`report`'s keys are exactly the (effective) section keys, in the template's section
order. `meta.degradedSections` is present only if an agent failed and its sections
were filled with a schema-valid placeholder. `meta.cost` includes the auto-headline
cost folded in.

## Language

`params.language` (`en` | `es` | `fr` | `pt`, default `en`) sets the **output**
language for every prose/string field. Research/search always runs in **English**
(best recall); the report is written in the target language at synthesis time. JSON
keys, enums, proper nouns, and URLs are never translated.

## Auto-generated headline

Before the workflow runs, `generateHeadline` (cheap `flash`/gather tier) writes a
short `title` (≤8 words) + `shortDescription` (≤25 words) from the params, in the
target language, and stores them on the job doc — so a report list shows something
useful even while the job runs. Its cost is folded into the report total.

## Versioning & non-breaking evolution

The `schemaVersion` (`"<id>@<version>"`) is the **consumer contract**.

- **Additive within a version** — you may *add* sections/fields freely; never
  rename or remove existing keys, or change a field's type, under the same
  `version`.
- **Breaking change** — bump `version` (or register a parallel model), so apps
  pinned to the old schema keep working while new ones adopt the new one.
- Every template is checked by `validateTemplate` at load time and in CI
  (`npm run templates:check`), so a malformed change fails fast: it enforces unique
  section keys, exactly one producer per non-derived section, valid agent/section/
  model-alias references, `exclude` keys that exist, no self-enrichment, and an
  acyclic DAG.

See [extending.md](extending.md) for the concrete how-to.
