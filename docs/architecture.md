# Architecture

## Overview

```
web frontend ──POST /auth/session──▶ API   (verifies a Google id_token, returns a session JWT)
     │                                 │
     │  Authorization: Bearer <JWT>    │
     ▼                                 ▼
client ──POST /research──▶ API (Cloud Run Service, scale-to-0)
                             │ verify JWT (appId+userId from token), validate params,
                             │ rate-limit, CONSUME credits, record job (Firestore),
                             │ ENQUEUE a Cloud Task
                             ▼
                          Cloud Tasks queue  (maxConcurrentDispatches = global job cap, retries + backoff)
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
                             │ assemble { meta, report }, validate; on failure → REFUND credits
                             ▼
        GCS: researchs/{jobId}/report.json + sources.json + metadata.json + trace.json
        Firestore: job status + progress + running cost + summary; per-app stats
client ──GET /research/:jobId──▶ status + progress + signed download URLs
```

The API never runs research inline — it records the job and enqueues a task, so it
returns in milliseconds and scales to zero. All heavy work happens in the worker.

## Components

| Component | Runtime | Role |
|---|---|---|
| **API** (`apps/api`) | Cloud Run Service, `--allow-unauthenticated`, scale-to-0 | Auth, validation, credits gate, job intake, credits/billing endpoints, admin backoffice, Swagger docs. |
| **Worker** (`apps/worker`) | Cloud Run Service, `--no-allow-unauthenticated`, `--concurrency=1`, scale-to-0 | Runs one research job per `POST /run`. |
| **Core** (`packages/core`) | Library shared by both | Engine, templates, LLM registry, jobs/apps/credits/stats/settings/auth stores, storage, tools, config, observability. |
| **Cloud Tasks queue** | GCP | Gates concurrency (`maxConcurrentDispatches`), retries failed dispatches with backoff, dedups by task name = jobId. |
| **Firestore** (named DB per env) | GCP | Jobs, apps, rate-limits, settings, credit-ledger, credit-balances, app-stats, app-users. |
| **Cloud Storage** (bucket per env) | GCP | Per-job output objects under `researchs/{jobId}/`. |
| **Vertex AI** | GCP | Gemini models (via `@google/genai`, ADC auth). |
| **Stripe** | External | The credit-pack catalog (Prices) + hosted Checkout + webhooks. |

## Auth (BFF session tokens)

The API is the **backend-for-frontend authority**. A static web frontend does
Google Sign-In client-side, then `POST /auth/session { appId, provider:'google',
idToken }`. The API verifies the Google `id_token` against the app's
`googleClientId` and issues an **HS256 session JWT** carrying `{ email (sub),
appId, role }`. Every later request sends `Authorization: Bearer <JWT>`; **appId
and userId always come from the token, never the request body**.

- **Regular app** (`role: 'app'`) — any Google account can log in → `role: user`.
- **Admin app** (`role: 'admin'`) — only emails in the app doc's `adminEmails[]`
  whitelist may log in → `role: admin` (unlocks `/admin/*`).
- **Public paths** (no token): `/health`, `/docs`, `/auth/*`, `/credits/webhook`.
- **Local dev** (`APP_ENV=local`): auth is bypassed; identity comes from
  `x-app-id` / `x-user-id` / `x-role` headers (defaults `fbizlab` / `local@dev` /
  `user`).

Full detail: [auth.md](auth.md).

## Credits & billing

`POST /research` **consumes** the mode's credit cost up front (per `(appId,
userId)`); insufficient balance → `402`. If the job fails, the worker **refunds**
those credits (idempotent). Credits are bought via **Stripe hosted Checkout**; the
signature-verified webhook grants them. The plan catalog lives **entirely in
Stripe** (Prices with metadata `{ appId, planId,
credits }`) — nothing in Firestore. Full detail: [credits.md](credits.md).

## Scaling & concurrency

- **Intake** — the API is a Cloud Run Service; it accepts many concurrent
  requests and scales instances. Its per-request work is tiny (verify JWT +
  validate + credits + one Firestore write + one enqueue), so it is never the
  bottleneck.
- **Admission** — rate limits (reports/hour, per app AND per user) and the credits
  gate are checked **before** the job is recorded: over the limit → `429`, no
  credits → `402`, nothing enqueued; otherwise credits are consumed, the job is
  recorded and enqueued. (Both are skipped when `APP_ENV=local`.)
- **Execution throttle** — the **Cloud Tasks queue** dispatches at most
  `maxConcurrentDispatches` = `JOB_MAX_CONCURRENCY` (default **4**) tasks at once,
  to the worker Service (`--concurrency=1`, `--max-instances=JOB_MAX_CONCURRENCY`).
  So **at most N jobs run concurrently**; the rest wait in the queue and are
  dispatched as slots free. Failed dispatches retry with backoff (`--max-attempts=3`).
- **The real ceiling is Vertex quota.** Each job runs its agents at
  `maxConcurrentAgents` (default 2) concurrency, so total Vertex load ≈
  `N × 2 + retries`. Set `JOB_MAX_CONCURRENCY` to match the project's Vertex
  quota — raising throughput means raising the queue cap **and** the Vertex quota
  together. On a low-quota project keep N small (≈3-4); with raised quota, dozens.
- **Idempotent + at-least-once** — the enqueue is keyed by jobId (Cloud Tasks
  `ALREADY_EXISTS` → treated as success), and the `/run` handler acks
  already-finished jobs (`completed`/`failed`) instead of re-running them.

## The workflow executor (`packages/core/src/engine/research-engine.ts`)

`runResearch()` is a **generic executor** driven entirely by the template's data
— it has no per-template branches. Given a template it:

1. Resolves the public **mode** → internal config (budget scale, excluded
   sections, depth, param overrides like `targetCount`), producing an
   **effective template** (sections/agents for excluded keys are dropped) and
   **effective params**.
2. Builds the shared **system prompt** (base prompt + fenced client instructions)
   and the **research brief** from the effective params.
3. Creates one shared **evidence store**.
4. **Topo-sorts** the agents into waves (`planWaves` / Kahn layering). An agent's
   dependencies are its explicit `dependsOn` plus the producer of any section it
   `enriches`. Cycles throw.
5. Runs each wave with a **bounded-concurrency pool**
   (`config.llm.maxConcurrentAgents`, default 2) — a Vertex-quota guard.
6. Merges each agent's validated JSON slice into the `report` accumulator
   (producers set keys; enrichers overwrite them in place).
7. Fills **derived** sections (e.g. `sources`) deterministically from the
   evidence store.
8. Validates the whole `report` against the composed schema and returns
   `{ report, meta, sources, trace }`.

### Failure isolation & degraded sections

If an agent throws (after its provider retries), the executor catches it, fills
that agent's sections with a **schema-valid degraded placeholder**
(`emptyFromJsonSchema` walks the section's JSON Schema and puts the failure reason
into the first string field), records the key in `meta.degradedSections`, and
continues. One agent failing never loses the work of the others.

The **final** schema validation is a job-level check: if the assembled report
still fails (e.g. a derived section threw), the trace is marked `failed` and the
job is failed **and its credits refunded** — but the trace is still persisted for
diagnosis.

## Agents & the shared evidence store (`engine/gather.ts`)

A **producer** agent runs a budgeted tool-calling loop (`update_plan`,
`web_search`, `fetch_page`) scoped to its own sections, then synthesizes them via
`synthesizeStructured`. All agents read/write **one** `Evidence` store: a page
fetched by one agent is reused by another (no budget spent, no duplicate fetch),
and the final `sources` list is unified and de-duplicated. Producer budgets are
`researchBudget × depth.budgetScale` (min 2). The first turn `forceTools` is on,
so an agent must do real research before it can stop; up to 2 nudges push it if it
tries to conclude with zero evidence.

A **synthesizer** agent skips research and composes its sections purely from the
outputs of upstream agents (e.g. the executive summary).

See [agents.md](agents.md).

## Structured output (`engine/synthesize.ts` + the provider)

Section shapes are **Zod** schemas. `synthesizeStructured()`:

1. Converts the Zod schema to a standard JSON Schema via `z.toJSONSchema()`.
2. Passes it to the model as `responseSchema` (JSON mode) with
   `maxOutputTokens = config.llm.maxOutputTokens` (32768, so long JSON isn't
   truncated into invalid JSON).
3. Parses and **validates** the returned JSON with the same Zod schema (stripping
   any ```json fences first).
4. On a parse/validation failure, runs **one repair round** feeding the errors
   back, then throws if still invalid.

Each provider adapts the standard JSON Schema to its own dialect. The Gemini
provider (`llm/gemini-vertex.ts`) normalizes it to Gemini's controlled-generation
subset: `anyOf:[T,null]` / `type:[T,'null']` → `nullable`, `$ref` resolution,
enums, arrays, and it drops unsupported keywords. Structured output and
tool-calling are mutually exclusive on Gemini, so they are never requested in the
same call.

## Model registry & providers (`llm/models.ts`, `config.ts`)

Agents reference a model **alias** (`gather`/`flash`, `pro`, later
`claude-sonnet`), never a concrete model id. `resolveModel(alias)` maps it to
`{ provider, model, inPerM, outPerM }` via `config.llm.models`; provider instances
are memoized, so one workflow can mix providers. Auth to Vertex is **ADC** (the
attached service account on Cloud Run, or `gcloud auth application-default login`
locally) — no API keys or JSON key files. See [extending.md](extending.md).

## Observability: tracing & logging

Every job is fully diagnosable.

- **`trace.json`** (in GCS, per job) — a `JobTrace`: the brief, the waves, and one
  `AgentTrace` per agent with its `status` (`ok`/`failed`), model aliases,
  `turnsUsed`, chronological `notes` (each search/fetch, capped at 300), its
  **output slice**, and any `error` (stack). It is uploaded **incrementally after
  each wave**, so a mid-run crash still leaves a record, and again at the end —
  **including on failure** (`markFailed` persists it too).
- **Cloud Logging** — `run-job.ts` emits one **structured JSON log line per step**
  via `obs/log.ts`, bound to **jobId + appId + userId** (also as indexed
  `logging.googleapis.com/labels`). Events include: `job.start`, `job.headline`,
  `step` (every agent note/search), `agent.ok` / `agent.failed` (per agent, with
  error + cost), `job.completed` / `job.failed`, and `credits.refunded`. The API
  logs `auth.login`, `job.created`, `credits.consumed`, `job.queued`,
  `credits.purchased`. Filter a whole run with e.g. `labels.jobId="…"` or
  `jsonPayload.appId="…"`.

A failed run therefore leaves: the Firestore job (`status:failed` + `error` +
`summary.agentErrors`), `trace.json` (which agent failed, its notes and error),
and the correlated Cloud Logging stream — enough to diagnose without reproducing.

### Cost accounting (`cost.ts`)

Each LLM call returns token usage (Gemini counts thinking tokens as output);
combined with per-model prices in the registry
(`config.llm.models[...].inPerM/outPerM`) this gives an **exact LLM cost**.
Web-search cost is an **estimate** — one billed call per spent research turn ×
`config.search.costPerCallUsd`, only when a Tavily key is set (Brave/DDG treated
as free). Cost accumulates **per agent** (`trace.agents[].cost`) and into a
**running job total** (`trace.cost`), updated as each agent finishes, plus the
one-time **headline** cost. It is written to the job doc (`cost`, updated per
wave), `report.json` `meta.cost`, and `metadata.json`, and folded into per-app
stats. `Cost = { usd, llmUsd, searchUsd, inputTokens, outputTokens, searchCalls }`.

## Storage, jobs, environments

- **GCS** per job (`researchs/{jobId}/`): `report.json` (the deliverable —
  `{ meta, report }`), `sources.json`, `metadata.json`, `trace.json`. Downloads
  are short-lived **V4 signed URLs** minted on poll (default 60 min).
- **Firestore** tracks the job: `status`, `progress` (updated per agent/wave),
  running `cost`, auto-generated `title`/`shortDescription`, and a denormalized
  `summary` (metrics + `degradedSections` + `agentErrors`) on completion/failure.
- **Two environments** (`dev`/`prod`) selected by `ENV`; every stateful resource
  is suffixed per environment (`agent-researcher-<env>-*`). Local runs use `.env`
  with `APP_ENV=local`. See [deployment.md](deployment.md).
