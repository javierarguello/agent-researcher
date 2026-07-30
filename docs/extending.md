# Extending without breaking

Everything is registry-driven and validated at load time
(`npm run templates:check`, also run in CI). The rule of thumb: **add**, don't
mutate existing keys under the same version.

## Add a section to an existing model

1. Add a `ReportSection` to the template's `sections` (new `key`, `title`,
   `guidance`, `schema`). String fields = Markdown.
2. Assign it to an agent: add the key to some agent's `produces` (or create a new
   agent — below). A derived section instead sets `derived: true` + `derive()`.
3. `npm run templates:check` — confirms every non-derived section has exactly one
   producer and the schema still serializes.

This is **additive** → same `version`. Consumers that ignore the new key keep
working.

## Add an agent to a model

Add an `AgentSpec` to `agents`. Give it `produces` (and/or `enriches`),
`dependsOn`, a `role`, and optionally `model` / `gatherModel` aliases, a
`researchBudget`, and `sites` (additive suggested source domains — see
[agents.md](agents.md#suggested-sources-sites--additive-in-the-workflow-definition)).
The executor recomputes waves automatically. Validation
rejects: unknown section/agent refs, two agents producing the same section,
enriching a section nobody produces, self-enrichment, unknown model aliases, and
dependency cycles.

## Add a structured directive to a model

Directives are how a client says what it wants **without free prose**: a closed
vocabulary per field, declared once in the template and rendered by every client
from the manifest.

1. Add a `DirectiveField` to the template's field list: a `key`, a `kind`
   (`single` | `multi` | `boolean`), the `values` (machine keys — never
   translated), and `text` per language. `en` is required and is the fallback;
   each language must label **every** value, or validation fails.
2. Make sure the schema half exists: the params schema must include
   `directivesSchema(FIELDS)` under the same key the template's
   `directives.key` names. Load-time validation rejects a declaration
   `paramsSchema` does not accept — the two are one contract.
3. Add the key to `paramsUi.hidden` so a generic form builder skips the raw
   object; clients render the localized `directives` block instead.
4. `npm run templates:check`.

Additive → same `version`, and no client change: a new field (or a new language
for an old one) reaches every front-end through the manifest.

**What must never go in one.** A directive says what to *weigh* — a reason for
sale to prefer, a risk appetite, an aspect to go deeper on. It must never be able
to say how *much* to return. Item counts, section lists and "keep it short" are
exactly the instructions that made the report schemas unsatisfiable and burned a
job's whole budget failing to satisfy them (C1 in
[plans/abuse-and-cost.md](plans/abuse-and-cost.md)). If a proposed field would
express a quantity, it is not a directive.

## Give a model its own cost ceiling

Every job is capped in dollars (`MAX_JOB_COST_USD`), and a catalog cannot share one
number: a cheap scan and a deep multi-agent report have different normal costs, so a
ceiling that is a safety net for one is a wall for the other.

Declare it per mode, next to `budgetScale` and `credits`, where cost already lives:

```ts
modes: {
  comprehensive: { budgetScale: 1, depth: 'standard', credits: 18, maxCostUsd: 35 },
  essential:     { budgetScale: 0.5, depth: 'light',  credits: 5,  maxCostUsd: 12 },
}
```

Omit it and the deployment default applies. Set it from what the model ACTUALLY
costs — the admin dashboard's per-job `cost` and the `budgetStoppedReports` counter
are the evidence. A rising count means the ceiling is below real cost, not that
anyone is abusing it.

A job that trips its ceiling is **held** for an admin (approve → continue uncapped
from the checkpoint; reject → fail + refund), never silently degraded.

## Add a whole new research model

1. Create `packages/core/src/templates/<id>.ts` exporting a `ResearchTemplate`
   (`id`, `name`, `description`, `version: 1`, `basePrompt`, `paramsSchema`,
   `sections`, `agents`, `buildBrief`). Optionally add `paramsUi` (form layout,
   per-field help + suggestions) so clients render a good form with no UI change —
   see [model-ui.md](model-ui.md).
2. Register it in `templates/registry.ts` (`TEMPLATES` map).
3. Add its doc `docs/models/<id>.md`.
4. `npm run templates:check`.

Nothing else changes — the engine, API, and worker are generic. Existing models
are untouched.

## Modes — the public cost/scope knob

The public API exposes exactly one cost control: `mode`
(`essential` | `comprehensive`). Everything that drives cost (research budget,
which sections run, prose depth, internal params) is configured **per mode**,
generically, by each template.

To support it, add the shared param and declare `modes`:

```ts
import { modeParamSchema } from '../mode.js';
// paramsSchema:
mode: modeParamSchema,   // defaults to 'essential' (cost-safe)

// template:
modes: {
  comprehensive: { budgetScale: 1,   depth: 'standard', params: { targetCount: 6 } },
  essential:     { budgetScale: 0.5, depth: 'light', params: { targetCount: 3 },
                   exclude: ['financial_analysis', 'growth_playbook', /* … */] },
},
```

- `exclude` drops those sections **and skips agents** that produce only them →
  the big lever for cutting cost (~half).
- `budgetScale` multiplies every agent's `researchBudget`.
- `depth` picks the prose length directive (`src/depth.ts`, internal now).
- `params` are internal overrides merged before `buildBrief` (e.g. `targetCount`,
  which is no longer a public param).

Validation checks that `exclude` keys are real sections. If a template omits
`modes`, sane defaults apply (essential = 0.5× budget/light, comprehensive =
full). **Title + short description** are auto-generated (cheap flash call) for
every job — no template work needed.

## Add an LLM model or provider

- **New model, existing provider** — add an alias to `config.llm.models`, e.g.
  `'gemini-2.0-flash': { provider: 'gemini-vertex', model: 'gemini-2.0-flash' }`.
  Reference it per-agent via `model` / `gatherModel`. Nothing else changes.
- **New provider (e.g. Claude)** —
  1. Implement `LlmProvider` in `llm/<provider>.ts` (map tools + `responseSchema`
     to that provider's dialect; for Anthropic, structured output is a forced
     tool call with the JSON Schema as the tool `input_schema`).
  2. Add a `case` in `llm/models.ts` `instantiate()`.
  3. Add aliases in `config.llm.models` pointing at the new provider.
  Agents opt in by alias; every existing agent (still on `gather`/`pro`) is
  unaffected. One workflow can mix providers.

## Add an auth provider (e.g. email/password)

Login is provider-based and the verified-identity shape is provider-agnostic
(`Identity`), so a new provider doesn't touch anything past login.

1. Implement a verifier in `packages/core/src/auth/tokens.ts` returning an
   `Identity` (`{ provider, email, name?, emailVerified, sub? }`), e.g.
   `verifyPassword(email, password)` with `provider: 'password'`. `'password'` is
   already in the `IdentityProvider` type and the `/auth/session` request enum.
2. Add a branch to the provider dispatch in `POST /auth/session`
   (`apps/api/src/index.ts`) — it currently returns `501` for non-google.
3. Nothing else changes: you still `signSession({ email, appId, role, name })`,
   and the same app-doc / admin-whitelist / role logic applies. Every downstream
   handler only sees the session claims. See [auth.md](auth.md).

## Add a research model — modes & credits

A new model gets the public cost knob for free by adding `mode: modeParamSchema` to
its params and declaring `modes` (below). Each mode's `credits` sets what a report
costs (default essential 1 / comprehensive 2) — the credits system, Stripe plans,
consumption, and refunds are all shared and need no per-model work. See
[credits.md](credits.md).

## Making a breaking change

If you must rename/remove a section key or change a field's type:

- Bump the template `version` (→ new `schemaVersion` `"<id>@<version>"`), **or**
- register a parallel model so apps pinned to the old schema keep working.

Never silently change an existing key's meaning under the same version.

## Safety net

`validateTemplate()` (in `templates/validate.ts`) runs on registration and via
`npm run templates:check`. Wire that script into CI so a malformed template,
agent, or model reference fails the build instead of a live job.
