# Agents & the workflow

A research model's report is produced by a **workflow of specialized agents** —
each responsible for a couple of sections, running in parallel where their
dependencies allow. This replaces a single monolithic pipeline.

## `AgentSpec`

```ts
interface AgentSpec {
  id: string;                      // unique within the template
  role: 'producer' | 'synthesizer';
  objective: string;               // one-line goal (docs + progress)
  produces?: string[];             // section keys it authors
  enriches?: string[];             // section keys (produced upstream) it refines
  dependsOn?: string[];            // agent ids whose output it needs as context
  researchBudget?: number;         // web_search/fetch_page budget (producers)
  model?: string;                  // alias for synthesis   (default: config.llm.defaultSynthModel = 'pro')
  gatherModel?: string;            // alias for research loop (default: config.llm.defaultGatherModel = 'gather')
  focus?: string;                  // extra research/writing guidance
}
```

## Roles

- **producer** — runs a budgeted tool-calling research loop scoped to its
  sections (against the shared evidence store), then synthesizes them as JSON.
- **synthesizer** — no research; composes its sections purely from the outputs
  of `dependsOn` agents (e.g. the executive summary, final recommendations).

An agent can also **enrich** sections another agent produced: it receives the
current version + does its own research and returns improved versions that
overwrite the originals (e.g. a valuation agent adding implied multiples to each
deep-dive).

## Dependencies → waves → concurrency

The executor derives a DAG: an agent's dependencies are `dependsOn` **plus** the
producer of any section it `enriches`. It topo-sorts into **waves** (Kahn
layering) and runs each wave with a **bounded-concurrency pool**
(`config.llm.maxConcurrentAgents`, default **2** — a Vertex-quota guard; the
provider also retries 429s with exponential backoff). Cycles are rejected at load
time.

Inspect any model's waves with `npm run templates:check`.

## Per-agent model selection

Each agent picks its models by **alias** (never a concrete id):

- `model` — the model used for **structured synthesis** (the quality-critical
  output). Default alias `pro`.
- `gatherModel` — the model used for the **tool-calling research loop** (cheap,
  many turns). Default alias `gather` (flash).

Aliases resolve through the registry in `config.llm.models`
(`resolveModel(alias) → { provider, model }`), so you can point an agent at
Gemini Pro, Gemini Flash, or (once added) Claude, and mix providers within one
workflow. See [extending.md](extending.md) for adding a model/provider.

## Context passed to an agent

An agent receives, in its prompt:

- the shared **research brief**,
- its **section guidance** (what each of its sections must contain),
- **context** — the current JSON of the sections produced by its dependencies
  (read-only; "build on these, stay consistent"),
- for producers, the **evidence dossier** (search snippets + fetched pages).

The shared **system prompt** (template `basePrompt` + fenced client instructions)
is identical for every agent; per-agent focus rides in the user message.
