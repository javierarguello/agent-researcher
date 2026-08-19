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
  researchBudget?: number;         // web_search/fetch_page budget (default config.search.maxTurns)
  model?: string;                  // alias for synthesis   (default: config.llm.defaultSynthModel = 'pro')
  gatherModel?: string;            // alias for research loop (default: config.llm.defaultGatherModel = 'gather')
  focus?: string;                  // extra RESEARCH guidance (which sources to prefer)
                                   // Writing guidance goes in the section's `guidance`.
  sites?: string[];                // suggested (ADDITIVE) source domains — unioned with the template's `sites`
}
```

**Four of those are loop-only, and declaring one on an agent with no research loop
is a validation ERROR — not a field that is ignored:** `focus`, `sites`,
`researchBudget` and `gatherModel`. Only a producer has a loop, and each of them is
read only inside it, so on a synthesizer they are a sentence the model never sees —
`sites` in particular becomes "SUGGESTED SOURCES" in the kickoff, so it looks obeyed
and is not. `assertTemplatesValid` runs at module load, so a template that declares
one fails the BOOT of the API and the worker, not a request (round 8 R8-20; the docs
said "ignored for synthesizers" until round 9, R9-15). What a synthesizer needs to
be told belongs in the `guidance` of the section it writes.

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
- Two breakers end a loop that is going nowhere, because the iteration cap alone
  let a plan-loop bill `2×budget+6` model calls for zero searches: **4 plan-only
  turns in a row**, and **8 turns in a row that buy nothing** — a plan update, a
  call we are about to refuse, or a re-read of a page whose body we will not send
  again. Anything that spends a turn, or hands the model a page body it has not
  been given twice, resets both. On the third such turn the plan result also tells
  the model to stop planning and `forceTools` is dropped, so it can say it is ready.
- A loop that ends this way reports `gatherStop: 'stalled'` **when its turn
  allowance was not spent**, and the buyer's live line reads `cut_off` ("stopped
  early"), never `stopped` ("research complete"). A loop that spent the allowance
  and then stalled is reclassified `budget` and closes `stopped`: once there are no
  turns left every call buys nothing, so the breaker fires by construction, and only
  a loop cut off with budget LEFT is half-done (`gather.ts`, the `stalled` +
  `turnsUsed >= maxTurns` branch).
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

Use bare hostnames (no scheme, no `www.`). `sites` is fixed in the model's
definition; there is no client-facing param for it any more.

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
   a `checkpoint.json` to GCS: the `report` so far, the shared `sources` and page
   bodies (`extracted`, capped — a `gathered` agent's own pages are kept first, and
   an agent whose pages could not all be kept loses `gathered` so it re-buys them),
   `doneAgentIds`, `gatheredAgentIds`, `fetchedByAgent`, `touchedByAgent`,
   `agentTraces`, `handoffs`, `degraded`, `warnings`, `writeFailures`, `turnsUsed`
   and the accumulated `cost` — **read the `Checkpoint` type for the current list**.
   This sentence went stale one commit after it was written, and the commit that
   corrected it left out `turnsUsed`, which had been in the type for fourteen
   commits (round 9, R9-25). A prose copy of a type is a list that is wrong on a
   schedule; the pointer is the part to trust. If agents are still
   failing when the in-run attempts are spent and this isn't the final job attempt,
   the run returns **`incomplete`**; the worker replies `503` so **Cloud Tasks
   re-dispatches** it, and the next run resumes from the checkpoint (done agents are
   skipped, not re-run). This repeats up to `config.workflow.maxJobAttempts`.
   Every field added since the first version is optional: a checkpoint written
   before it existed resumes exactly as it did.
3. **Degrade & deliver the rest.** A write that fails the SAME way on two dispatches
   is given up on (`writeFailures`, one signature per dispatch), and when nothing
   left is retryable the dispatch finalizes IN PLACE rather than paying for six more
   that would each reach the same conclusion. Any section still unfilled is degraded
   to a placeholder, a `warnings[]` entry is added to the job +
   trace (and `log.warn('job.degraded')` is emitted so you can investigate later),
   and the rest of the report is delivered normally. `report.meta.sections` lists
   them as `{ key, status: 'lost' }`; stats count the report as `degraded`.
4. **Deliver a shallow section as shallow.** A section a producer wrote and a
   refiner never deepened is recorded as `{ key, status: 'unenriched' }`. Its
   content is real and is rendered as usual — only the buyer's notice differs.
   A section NO producer delivered, written by an enricher on the finalize pass, is
   `{ key, status: 'reconstructed' }`: the body stays (an enricher with other
   finished dependencies writes from real sections) and the copy says nothing
   researched it directly. Statuses other than `lost` are NOT counted as a degraded
   delivery.

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
- the **handoffs** of its dependencies — what each earlier step reported, in its own
  words (see below),
- **context** — the JSON of the sections its dependencies produced, read-only and
  bounded (see below),
- for producers, the **evidence dossier** — up to 48 search snippets (`[S#]`) + up
  to 14 fetched full pages (`[P#]`), instructed to cite real URLs inline.

### Handoffs — what one step tells the next

Every agent writes a short briefing for the steps that follow, **in the same call
that writes its sections** (`_handoff`, stripped before the slice is merged — it is
a message between steps, never a report section). No extra model call, and it is
written by whoever did the work rather than by something reading its output
afterwards.

Handoffs and raw sections are **additive**, because they carry different things: a
handoff is what the agent thought mattered, the sections carry the FIGURES that
prose loses and that the chart and financial agents cannot work without.

Where each goes:

| | handoffs | raw sections |
|---|---|---|
| research loop (`buildAgentKickoff`) | ✅ | ❌ |
| the write (synthesis prompts) | ✅ | ✅, bounded |

The research loop gets no raw sections at all. It decides what to SEARCH FOR next
and it re-sends its whole prompt on every turn, so carrying the sections meant
paying for them once per turn to inform a decision that only needs to know what is
already covered. Measured on a comprehensive report, that re-sending was **68% of
the job's entire input**.

The write gets both, with the raw half sharing a **total** budget
(`MAX_CONTEXT_CHARS`) across all dependencies, split evenly and each cut with a
marker saying where the rest lives. Bounding the total rather than each section is
the point: almost no single section is oversized, and the exec-summary writer
depends on twelve of them.

Handoffs are carried in the checkpoint, so a resumed dispatch does not hand its
later steps an empty summary of work its predecessors already did. A handoff that
runs long is **cut, never rejected** — a length limit in the schema would make a
model's verbosity a validation failure for the agent's whole write.

**Anything an agent will REWRITE is exempt from all of this** and arrives whole, in
the loop as well as the write (`currentBlock`). An agent that both produces and
enriches is schema-forced to re-emit the enriched section and its output REPLACES
what is in the report — so a trimmed copy does not weaken the rewrite, it deletes
whatever fell past the cut, permanently, with the job completing green.

Measured effect on one comprehensive report: total input 2,304k → 1,336k
characters (−42%), and the largest single call 114k → 65k. See
`packages/core/test/context-size.measure.test.ts` (`MEASURE=1`).

**Residual risk, observed against a real 3B model:** a small model can write a
degenerate handoff (one run answered with two bare markdown links). The design
absorbs it at the WRITE, where the raw sections still travel — but a producer's
research loop sees handoffs only, so a degenerate one from a dependency leaves that
loop under-informed. The schema description now argues against exactly that shape.
Worth re-checking on a stronger model before assuming it is theoretical.

The shared **system prompt** (`buildSystemPrompt`) is identical for every agent:
the template `basePrompt` plus the client's **structured directives** (a closed
vocabulary the template declares — every word ours). There is deliberately no
free-text block: the buyer's own words never reach a prompt. They fill the
directives and the keywords through the preflight assist (`/research/preflight`
with `freeText`), as proposals the buyer accepts, one field at a time and only
where it can quote them. Per-agent `focus` rides in the research KICKOFF's user
message — and nowhere else, so an agent without a loop cannot be told one.

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
