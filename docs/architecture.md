# Architecture

## Overview

```
client ──POST /research──▶ API (Cloud Run Service, scale-to-0)
                             │ validates + rate-limit, records job (Firestore), ENQUEUES a Cloud Task
                             ▼
                          Cloud Tasks queue  (maxConcurrentDispatches = global job cap, retries)
                             │ HTTP push (OIDC) — at most N in flight
                             ▼
                          Worker (Cloud Run Service, scale-to-0, concurrency=1, private)
                             │ POST /run → runJob → runResearch (the workflow executor)
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

The API never runs research inline — it records the job and enqueues a task, so
it returns in milliseconds and scales to zero.

## Scaling & concurrency

- **Intake** — the API is a Cloud Run Service; it accepts many concurrent
  requests and scales instances. Its per-request work is tiny (validate + one
  Firestore write + one enqueue), so it is never the bottleneck.
- **Admission** — rate limits (reports/hour, per app AND per user) are checked
  **before** the job is recorded: over the limit → `429`, nothing enqueued;
  under → job recorded + enqueued.
- **Execution throttle** — the **Cloud Tasks queue** dispatches at most
  `maxConcurrentDispatches` = `JOB_MAX_CONCURRENCY` (default **4**) tasks at once,
  to the worker Service (`--concurrency=1`, `--max-instances=JOB_MAX_CONCURRENCY`).
  So **at most N jobs run concurrently**; the rest wait in the queue and are
  dispatched as slots free. Failed dispatches retry with backoff.
- **The real ceiling is Vertex quota.** Each job runs its agents at
  `maxConcurrentAgents` (2) concurrency, so total Vertex load ≈ `N × 2 + retries`.
  Set `JOB_MAX_CONCURRENCY` to match the project's Vertex quota — raising
  throughput means raising the queue cap **and** the Vertex quota together. On
  this low-quota project keep N small (≈3-4); with raised quota, dozens.
- Idempotent + at-least-once: the enqueue is keyed by jobId (dedup), and the
  `/run` handler acks already-finished jobs instead of re-running them.

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

### Cost accounting

Each LLM call returns token usage; combined with per-model prices in the registry
(`config.llm.models[...].inPerM/outPerM`) this gives an **exact LLM cost**.
Web-search cost is an **estimate** (Tavily calls × `config.search.costPerCallUsd`).
Cost accumulates **per agent** (in `trace.json` → `agents[].cost`) and into a
**running job total** (`trace.cost`), updated as each agent finishes, and is
copied to `report.json` `meta.cost` and `metadata.json`. Every `agent.ok` /
`job.completed` Cloud Logging line carries `costUsd` + token counts. `Cost` =
`{ usd, llmUsd, searchUsd, inputTokens, outputTokens, searchCalls }`. Swap the
prices in `config.llm.models` when a provider's pricing changes — one place.

## Storage, jobs, environments

- **GCS** per job (`researchs/{jobId}/`): `report.json` (the deliverable —
  `{ meta, report }`), `sources.json`, `metadata.json`.
- **Firestore** tracks the job: status, and `progress` updated per agent/wave.
- **Two environments** (`dev`/`prod`) selected by `ENV`; every stateful resource
  is suffixed per environment. Local runs use `.env` with `APP_ENV=local`
  (auth off). See the project memory / infra scripts for provisioning.
