# agent-researcher

Deep-research API on GCP. Clients submit a research request against a supported
**template** ("model"); a long-running agent gathers web evidence and produces a
professional, structured **Markdown** report. Reports and assets land in Cloud
Storage; jobs are tracked in Firestore. The AI model is **pluggable** (Gemini via
Vertex today, Claude later — same `LlmProvider` interface).

First template: **`florida-business-for-sale`** — buy-side research on businesses
for sale in the State of Florida.

## Architecture

```
Client ──POST /research──▶ API (Cloud Run Service, scale-to-0)
                             │ create job in Firestore (status=queued)
                             │ trigger ──▶ Worker (Cloud Run Job, long timeout, scale-to-0)
Client ──GET /research/:id─▶ │                    │ research loop (plan + budgeted web search)
   (poll)                    │                    │ synthesize report.md
                             ▼                    ▼
                     Firestore: jobs      Cloud Storage: researchs/{jobId}/**
```

- **API** never runs research inline → returns in ms, scales to zero.
- **Worker** is a Cloud Run Job: runs one job to completion (long tasks), scales
  to zero (only runs when triggered).
- On poll, a completed job returns short-lived **V4 signed read URLs** for every
  file in `researchs/{jobId}/`.

All GCP resources are prefixed `agent-researcher-` inside the shared project
(`sinuous-canto-497518-h7`).

## Layout

```
packages/core/         research engine, LLM provider, tools, templates, storage, jobs
  src/llm/             LlmProvider interface + gemini-vertex (pluggable)
  src/tools/           web-search (Brave > Tavily > DuckDuckGo)
  src/engine/          agent loop + prompt composition + run-job orchestrator
  src/templates/       registry + florida-business-for-sale
  src/storage/         GCS upload + signed URLs
  src/jobs/            Firestore job store
apps/api/              Cloud Run Service (Fastify)
apps/worker/           Cloud Run Job entrypoint
infra/                 setup-gcp.sh, deploy.sh, cloudbuild.*.yaml
Dockerfile.api, Dockerfile.worker
```

## Local dev

```bash
npm install
cp .env.example .env            # fill BRAVE/TAVILY keys if you have them
gcloud auth application-default login   # ADC for Vertex

# Smoke-test the engine (no GCP writes):
npm run research:local -- --template florida-business-for-sale \
  --params '{"industry":"laundromats","location":"Miami-Dade County, FL","askingPriceMax":500000,"targetCount":3}'
```

## Environments

Two isolated environments, `dev` and `prod`, selected by the `ENV` var, both in
the shared GCP/Firebase project **`sinuous-canto-497518-h7`** (region
**`us-central1`**). Every stateful resource is suffixed with the env, so they
never collide. **This is the source of truth for resource names + URLs.**

| Resource | dev | prod |
| --- | --- | --- |
| API base URL (Cloud Run) | https://agent-researcher-dev-api-b74fjmzlha-uc.a.run.app | _(after prod deploy)_ |
| Admin SPA (Firebase Hosting) | https://agent-researcher-dev-admin.web.app | https://agent-researcher-prod-admin.web.app |
| Firestore database | `agent-researcher-dev` | `agent-researcher-prod` |
| GCS bucket | `agent-researcher-dev-reports` | `agent-researcher-prod-reports` |
| Cloud Run service (API) | `agent-researcher-dev-api` | `agent-researcher-prod-api` |
| Cloud Run service (worker) | `agent-researcher-dev-worker` | `agent-researcher-prod-worker` |
| Cloud Tasks queue | `agent-researcher-dev-jobs` | `agent-researcher-prod-jobs` |
| Firebase Hosting site | `agent-researcher-dev-admin` | `agent-researcher-prod-admin` |
| Service accounts | `agent-researcher-dev-{api,worker}@` | `agent-researcher-prod-{api,worker}@` |

**Well-known app doc ids** (Firestore `apps/{appId}`, slugs — never UUIDs):
`admin` (backoffice, role admin) and `fbizlab` (FloridaBizLab, role app). The
admin SPA lives in `apps/admin` — see [docs/deployment.md](docs/deployment.md#admin-spa-appsadmin--firebase-hosting)
for its Hosting + OAuth setup, and [docs/model-ui.md](docs/model-ui.md) for how a
client renders a model's params.

## Deploy

```bash
# One-time per env: APIs, Firestore DB, bucket, service accounts, IAM.
ENV=dev  bash infra/setup-gcp.sh
ENV=prod bash infra/setup-gcp.sh

# Seed the base admin app (prints its apiKey once) — needs Firestore access.
npm run apps -- seed-admin

# Build + deploy one env.
ENV=dev  TAVILY_API_KEY=... bash infra/deploy.sh
ENV=prod TAVILY_API_KEY=... bash infra/deploy.sh
```

### CI/CD (GitHub Actions)

`.github/workflows/deploy.yml`: push to **`main`** deploys **dev**; push to
**`deploy-prod`** deploys **prod**. Auth is via Workload Identity Federation.
Configure per-env GitHub secrets: `WIF_PROVIDER_{DEV,PROD}`,
`DEPLOY_SA_{DEV,PROD}`, `TAVILY_API_KEY_{DEV,PROD}` (see the workflow header for
the deploy SA roles).

## API

**Auth**: API key via `x-api-key: <key>` or `Authorization: Bearer <key>`. Keys
live in the Firestore **`apps`** collection (one doc per app: `apiKey`, `active`,
`role`, optional `rateLimitPerHour`). Auth is disabled when `APP_ENV=local`.
`/health` and `/docs` are always public. Manage apps with `npm run apps` (seed the
base admin app with `npm run apps -- seed-admin`).

**Rate limits**: enforced **per app** and **per user** (reports/hour). Defaults
live in the Firestore **`settings/general`** doc (`appRateLimitPerHour`,
`userRateLimitPerHour`); an app may override its own cap via its app doc's
`rateLimitPerHour`. Over either cap, `POST /research` returns **`429`** with
`{ scope: "app" | "user", limit, used }`. `null` = unlimited. Edit via
`PATCH /admin/settings` or `npm run apps -- settings set --app N --user N`.

**Docs**: interactive Swagger UI at `/docs`; OpenAPI JSON at `/docs/json`.

- `GET /templates` — list supported templates + their JSON-Schema params.
- `POST /research` — `{ "appId", "userId", "template", "params": { ... } }` →
  `202 { jobId, status }`. `appId` (string, e.g. a UUID) and `userId` (string,
  UUID or email) are **required** — they identify the caller and are the keys
  future rate-limiting will use.
- `GET /research/:jobId` — status + progress; when `completed`, includes signed
  read URLs for `report.md`, `executive-summary.md`, `sources.json`,
  `metadata.json`.
- `GET /admin/apps`, `POST /admin/apps`, `PATCH /admin/apps/:appId` — app
  management. `GET /admin/settings`, `PATCH /admin/settings` — default rate
  limits. All **require an admin-role API key** (for a future backoffice).

## Adding a model/provider

- **New research template**: add a file in `packages/core/src/templates/` and
  register it in `registry.ts`.
- **New AI provider (e.g. Claude)**: implement `LlmProvider` and wire it into
  `packages/core/src/llm/index.ts`. Nothing else changes.

## Prompt-injection guard

Each template has an internal **base prompt** (highest authority). Client
`instructions` are validated params, injected in a fenced, explicitly
lower-authority block that instructs the model to ignore any attempt to override
the base rules.
