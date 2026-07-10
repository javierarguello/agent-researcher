# Agents & the workflow

A research model's report is produced by a **workflow (DAG) of specialized
agents** — each responsible for a couple of sections, running in parallel where
their dependencies allow. This replaces a single monolithic pipeline. Source:
`packages/core/src/engine/research-engine.ts`, `gather.ts`, `synthesize.ts`,
`prompt.ts`.

## `AgentSpec`

```ts
interface AgentSpec {
  id: string;                      // unique within the template
  role: 'producer' | 'synthesizer';
  objective: string;               // one-line goal (docs + progress + prompt)
  produces?: string[];             // section keys it authors from scratch
  enriches?: string[];             // section keys (produced upstream) it refines in place
  dependsOn?: string[];            // agent ids whose section output it needs as read-only context
  researchBudget?: number;         // web_search/fetch_page budget (producers only; default config.search.maxTurns)
  model?: string;                  // alias for synthesis   (default: config.llm.defaultSynthModel = 'pro')
  gatherModel?: string;            // alias for research loop (default: config.llm.defaultGatherModel = 'gather')
  focus?: string;                  // extra research/writing guidance (e.g. which sources to prefer)
}
```

## Roles

- **producer** — runs a budgeted tool-calling research loop scoped to its sections
  (against the shared evidence store), then synthesizes them as validated JSON.
- **synthesizer** — no research; composes its sections purely from the outputs of
  its `dependsOn` agents (e.g. the executive summary, final recommendations). It
  must not introduce facts absent from that context.

An agent can also **enrich** sections another agent produced: it receives the
current version + does its own research and returns improved versions that
overwrite the originals (e.g. a valuation agent adding implied multiples to each
deep-dive). If an agent's owned keys are *entirely* `enriches` (all already in the
report), it uses the **enricher** synthesis prompt (improve the current version);
otherwise it uses the **producer** prompt (write from scratch + evidence).

## The producer research loop (`gather.ts`)

A budgeted tool-calling loop over three tools:

| Tool | Purpose |
|---|---|
| `update_plan` | Create/revise the research plan (called first, then as it learns). Free. |
| `web_search` | One focused query → results (title, snippet, url). Spends one budget turn. |
| `fetch_page` | Fetch ONE page's full text (details snippets omit). Spends one budget turn. A page already fetched by any agent is reused (cached, **no** turn spent). |

- The **effective budget** = `round(researchBudget × depth.budgetScale)`, min 2.
  Depth's `budgetScale` comes from the resolved mode.
- The first turn `forceTools` is on (Gemini function-calling mode `ANY`), so an
  agent must do real research before it can conclude; up to 2 nudges push it if it
  tries to stop with zero evidence. The loop caps total iterations at
  `maxTurns × 2 + 6`.
- Every search result URL is added to the shared `Evidence.sources` (deduped);
  every successfully fetched page to `Evidence.extracted` (deduped). Search runs in
  **English** regardless of report language.
- Search backend priority: **Brave > Tavily > DuckDuckGo** (`tools/web-search.ts`).
  `fetch_page` requires Tavily; only Tavily calls are billed for cost accounting.

## Structured synthesis (`synthesize.ts`)

The agent's sections are turned into a single JSON object via
`synthesizeStructured`: the section subset schema → JSON Schema → `responseSchema`
(JSON mode, high `maxOutputTokens`), parsed and Zod-validated, with **one repair
round** on failure. Temperature defaults to 0.3.

## Dependencies → waves → concurrency

The executor derives the DAG: an agent's dependencies are `dependsOn` **plus** the
producer of any section it `enriches`. It topo-sorts into **waves** (Kahn
layering) and runs each wave with a **bounded-concurrency pool**
(`config.llm.maxConcurrentAgents`, default **2** — a Vertex-quota guard; the Gemini
provider also retries 429/500/503 with exponential backoff). Cycles are rejected at
load time and re-checked at run time.

Inspect any model's sections + agents + waves with `npm run templates:check`.

## Per-agent model selection

Each agent picks its models by **alias** (never a concrete id):

- `model` — the model for **structured synthesis** (quality-critical output).
  Default alias `pro`.
- `gatherModel` — the model for the **tool-calling research loop** (cheap, many
  turns). Default alias `gather` (flash). Only meaningful for producers.

Aliases resolve through the registry in `config.llm.models`
(`resolveModel(alias) → { provider, model, inPerM, outPerM }`), so you can point an
agent at Gemini Pro, Gemini Flash, or (once added) Claude, and mix providers within
one workflow. See [extending.md](extending.md) for adding a model/provider.

## Context passed to an agent

An agent receives, in its prompt:

- the shared **research brief** (`buildBrief(effectiveParams)`),
- its **section guidance** (each section's `guidance` text),
- **context** — the current JSON of the sections produced by its dependency agents
  (read-only; "build on these, stay consistent, don't contradict"),
- for producers, the **evidence dossier** — up to 48 search snippets (`[S#]`) + up
  to 14 fetched full pages (`[P#]`), instructed to cite real URLs inline.

The shared **system prompt** (`buildSystemPrompt`) is identical for every agent:
the template `basePrompt` plus, if the template sets `instructionsField`, the
client's instructions fenced as **lower-authority** input that cannot override the
base rules. Per-agent `focus` rides in the user message.

## Per-agent trace

Each agent's run is recorded as an `AgentTrace` in `trace.json`: `status`
(`running`/`ok`/`failed`), `wave`, `produces`/`enriches`, resolved model aliases,
`turnsUsed`, per-agent `cost`, chronological `notes` (each plan/search/fetch,
capped at 300), the `output` slice on success, and the `error` stack on failure.
See [architecture.md](architecture.md) → Observability.
