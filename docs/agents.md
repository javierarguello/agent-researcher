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
  sites?: string[];                // suggested (ADDITIVE) source domains — unioned with the template's `sites`
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

## Suggested sources (`sites`) — additive, in the workflow definition

A model's workflow can name **preferred source domains** to steer research —
`ResearchTemplate.sites` (applies to every producer) and/or `AgentSpec.sites`
(that agent only). The effective set for a producer is the **union** of the two
(`effectiveSites(template, agent)`, deduped).

These are **additive suggestions, not a restriction**: the domains are surfaced
in the agent's kickoff prompt as `SUGGESTED SOURCES (additive — NOT a
restriction)`, telling it to prioritize them (e.g. a few `site:` queries) **in
addition to** open web search — never to limit itself to them. The `web_search`
backend stays fully open (no `include_domains` filter), so coverage only grows.
The chosen sites are also recorded in the agent's trace notes
(`Suggested sources (additive): …`).

```ts
// florida-business-for-sale.ts — the deal-scout producer
{ id: 'deal-scout', role: 'producer', produces: ['shortlist', 'deep_dives'],
  sites: ['bizbuysell.com', 'bizquest.com', 'loopnet.com', 'businessesforsale.com', …] }
```

Use bare hostnames (no scheme, no `www.`). This is distinct from the client-facing
`preferredSources` **param** some models expose (which rides in the brief); `sites`
is fixed in the model's definition.

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

## Resilience: retries, checkpoints & degradation

A report is **not all-or-nothing** — each step can keep trying until it gets API
access, and a section that ultimately can't be produced degrades without sinking
the rest. Two layers (`research-engine.ts` + `run-job.ts`):

1. **In-run agent retry (backoff).** Each agent is attempted up to
   `config.workflow.agentMaxAttempts` times with exponential backoff + jitter
   (`agentRetryBaseMs` … `agentRetryMaxMs`). `AgentTrace.attempts` counts them and
   the failing reason is appended to `notes`.
2. **Durable checkpoint / resume.** After every agent completes, the engine writes
   a `checkpoint.json` to GCS (`report` so far, gathered `sources`, `doneAgentIds`,
   `degraded`). If agents are still failing when the in-run attempts are spent and
   this isn't the final job attempt, the run returns **`incomplete`**; the worker
   replies `503` so **Cloud Tasks re-dispatches** it, and the next run resumes from
   the checkpoint (done agents are skipped, not re-run). This repeats up to
   `config.workflow.maxJobAttempts` (Cloud Tasks backoff between tries).
3. **Degrade & deliver the rest.** On the **final** attempt, any section still
   unfilled is degraded to a placeholder, a `warnings[]` entry is added to the job +
   trace (and `log.warn('job.degraded')` is emitted so you can investigate later),
   and the rest of the report is delivered normally. `report.meta.degradedSections`
   lists them; stats count the report as `degraded`.

The `checkpoint.json` is deleted once the job reaches a terminal state.

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
(`running`/`ok`/`failed`/`pending`), `wave`, `produces`/`enriches`, resolved model
aliases, `turnsUsed`, **`attempts`** (in-run retries) and **`durationMs`**
(per-agent wall-clock), per-agent `cost`, chronological `notes` (each
plan/search/fetch + retry reason, capped at 300), the `output` slice on success,
and the `error` stack on failure.

The **job summary** (`JobSummary`) rolls these up for quick review: total job
`attempts`, per-agent `agents[]` = `{ id, wave, status, durationMs, attempts,
costUsd }`, and `warnings[]` (degraded sections). The `JobTrace` itself carries the
**total** `durationMs`. See [architecture.md](architecture.md) → Observability and
[stats.md](stats.md) for the aggregate error/timing counters.
