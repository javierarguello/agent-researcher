# Architecture

## Overview

```
client ──POST /research──▶ API (Cloud Run Service, scale-to-0)
                             │ validates, records job in Firestore, triggers worker
                             ▼
                          Worker (Cloud Run Job, scale-to-0, long timeout)
                             │ runJob → runResearch (the workflow executor)
                             ▼
        ┌────────────────────────────────────────────────────┐
        │  Agent workflow (per research model)                │
        │   wave 1 (parallel, capped) → wave 2 → … → wave N   │
        │   shared evidence store (dedup search + fetch)      │
        │   each agent returns a validated JSON slice         │
        └────────────────────────────────────────────────────┘
                             │ assemble { meta, report }, validate
                             ▼
                     GCS: researchs/{jobId}/report.json + sources.json + metadata.json
                     Firestore: job status + per-agent progress
client ──GET /research/:jobId──▶ status + signed download URLs
```

The API never runs research inline — it only records the job and triggers the
worker, so it returns in milliseconds and scales to zero.

## The workflow executor (`packages/core/src/engine/research-engine.ts`)

`runResearch()` is a **generic executor** driven entirely by the template's data
— it has no per-template branches. Given a template it:

1. Builds the shared **system prompt** (base prompt + fenced client
   instructions) and the **research brief** from the params.
2. Creates one shared **evidence store**.
3. **Topo-sorts** the agents into waves (`planWaves`). An agent's dependencies
   are its explicit `dependsOn` plus the producer of any section it `enriches`.
4. Runs each wave with a **bounded-concurrency pool**
   (`config.llm.maxConcurrentAgents`, default 2) — a Vertex-quota guard.
5. Merges each agent's validated JSON slice into the `report` accumulator
   (producers set keys; enrichers overwrite them).
6. Fills **derived** sections (e.g. `sources`) deterministically from the
   evidence store.
7. Validates the whole `report` against the composed schema and returns
   `{ meta, report, sources }`.

### Failure isolation

If an agent throws (after its own retries), the executor catches it, fills that
agent's sections with a **schema-valid degraded placeholder**, records the key in
`meta.degradedSections`, and continues. One agent failing never loses the work of
the others.

## Agents & the shared evidence store (`engine/gather.ts`)

A **producer** agent runs a budgeted tool-calling loop (`update_plan`,
`web_search`, `fetch_page`) scoped to its own sections, then synthesizes them.
All agents read/write **one** `Evidence` store: a page fetched by one agent is
reused by another (no budget spent, no duplicate fetch), and the final `sources`
list is unified and de-duplicated.

A **synthesizer** agent skips research and composes its sections purely from the
outputs of upstream agents (e.g. the executive summary).

## Structured output (`engine/synthesize.ts` + the provider)

Section shapes are **Zod** schemas. `synthesizeStructured()`:

1. Converts the Zod schema to a standard JSON Schema via `z.toJSONSchema()`.
2. Passes it to the model as `responseSchema` (JSON mode).
3. Parses and **validates** the returned JSON with the same Zod schema.
4. On a parse/validation failure, runs **one repair round** feeding the errors
   back, then throws if still invalid.

Each provider adapts the standard JSON Schema to its own dialect. The Gemini
provider (`llm/gemini-vertex.ts`) normalizes it to Gemini's controlled-generation
subset: `anyOf:[T,null]` → `nullable`, enums, arrays, `$ref` resolution, and it
strips unsupported keywords. `maxOutputTokens` is set high to avoid truncating
long JSON into invalid JSON.

## Model registry & providers (`llm/models.ts`, `config.ts`)

Agents reference a model **alias** (`gather`, `pro`, later `claude-sonnet`),
never a concrete model id. `resolveModel(alias)` maps it to `{ provider, model }`
via `config.llm.models`; provider instances are memoized, so one workflow can mix
providers. See [agents.md](agents.md) and [extending.md](extending.md).

## Observability: tracing & logging

Every job is fully diagnosable.

- **`trace.json`** (in GCS, per job) — a `JobTrace`: the brief, the waves, and one
  `AgentTrace` per agent with its `status` (`ok`/`failed`), model aliases,
  `turnsUsed`, chronological `notes` (each search/fetch), its **output slice**,
  and any `error` (stack). It is uploaded **incrementally after each wave**, so a
  mid-run crash still leaves a record, and again at the end — **including on
  failure** (`markFailed` persists it too).
- **Cloud Logging** — `run-job.ts` emits one **structured JSON log line per step**
  via `obs/log.ts`, bound to **jobId + appId + userId** (also as indexed
  `logging.googleapis.com/labels`). Events: `job.start`, `step` (every agent
  note/search), `agent.ok` / `agent.failed` (per agent, with error), and
  `job.completed` / `job.failed`. The API logs `job.created` / `job.queued`.
  Filter a whole run in Cloud Logging with e.g. `labels.jobId="…"` or
  `jsonPayload.appId="…"`.

A failed run therefore leaves: the Firestore job (`status:failed` + `error`),
`trace.json` (which agent failed, its notes and error), and the correlated Cloud
Logging stream — enough to diagnose without reproducing.

## Storage, jobs, environments

- **GCS** per job (`researchs/{jobId}/`): `report.json` (the deliverable —
  `{ meta, report }`), `sources.json`, `metadata.json`.
- **Firestore** tracks the job: status, and `progress` updated per agent/wave.
- **Two environments** (`dev`/`prod`) selected by `ENV`; every stateful resource
  is suffixed per environment. Local runs use `.env` with `APP_ENV=local`
  (auth off). See the project memory / infra scripts for provisioning.
