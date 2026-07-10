# Deployment & infrastructure

Everything runs in one GCP project (`sinuous-canto-497518-h7`, region
`us-central1`) across **two environments** — `dev` and `prod` — selected by `ENV`.
Every stateful resource is suffixed `agent-researcher-<env>-*`, so the two never
collide. Source: `infra/setup-gcp.sh`, `infra/deploy.sh`, `.github/workflows/`,
`Dockerfile.api`, `Dockerfile.worker`.

## Topology

- **API** — Cloud Run **Service**, `--allow-unauthenticated`, scale-to-0,
  512Mi/1cpu, max 4 instances.
- **Worker** — Cloud Run **Service**, `--no-allow-unauthenticated`,
  `--concurrency=1`, `--timeout=1800`, 1Gi/1cpu, min 0 / max
  `JOB_MAX_CONCURRENCY`. Invoked only by Cloud Tasks (OIDC).
- **Cloud Tasks queue** `agent-researcher-<env>-jobs` — gates concurrency
  (`max-concurrent-dispatches=JOB_MAX_CONCURRENCY`, `max-dispatches-per-second=1`,
  `max-attempts=3`, backoff 10s-300s).
- **Firestore** named DB `agent-researcher-<env>` (Native mode).
- **Cloud Storage** bucket `agent-researcher-<env>-reports` (uniform access).
- **Artifact Registry** repo `agent-researcher` (shared across envs).

Both containers are `node:22-slim` running TypeScript directly via `tsx`
(`node --import tsx …`), installing only production workspace deps.

## `infra/setup-gcp.sh` — one-time provisioning (per env)

`ENV=dev bash infra/setup-gcp.sh`. Idempotent-ish. It:

1. **Enables APIs**: cloudresourcemanager, serviceusage, iam, run, cloudbuild,
   artifactregistry, aiplatform, firestore, storage, cloudtasks, iamcredentials.
2. Creates the **Artifact Registry** repo (shared).
3. Creates the **Firestore** named DB (Native mode).
4. Creates **composite indexes** on collection groups `jobs` and `credit-ledger`:
   `(appId asc, userId asc, createdAt desc)` — for the report inbox
   (`listJobs`) and the credit ledger (`listTransactions`).
5. Enables the **TTL** policy on the `daily` collection group's `expireAt` field
   (auto-expire daily stats buckets after `STATS_RETENTION_DAYS`).
6. Creates the **Storage** bucket.
7. Creates the **Cloud Tasks queue** with the concurrency caps above.
8. Creates two **service accounts** and binds roles:
   - **Worker SA** (`…-worker`): `roles/aiplatform.user` (Vertex),
     `roles/datastore.user` (Firestore), `storage.objectAdmin` on the bucket,
     and `iam.serviceAccountTokenCreator` **on itself** (to sign V4 URLs / mint
     tokens without a private key).
   - **API SA** (`…-api`): `roles/datastore.user`, `storage.objectViewer` on the
     bucket, `iam.serviceAccountTokenCreator` on itself (sign download URLs),
     `roles/run.developer` + `serviceAccountUser` on the worker SA (deploy/act as),
     `roles/cloudtasks.enqueuer`, and `serviceAccountUser` on **itself** (to mint
     the task's OIDC token as itself).

> Note on indexes: `getDailyStats` (order by `date desc`) and single-`where`
> queries use single-field indexes Firestore creates automatically; only the two
> `(appId,userId,createdAt)` composites are declared here.

## `infra/deploy.sh` — build + deploy (per env)

`ENV=dev TAVILY_API_KEY=… … bash infra/deploy.sh`. It:

1. Builds the **worker** image (Cloud Build) and deploys the worker Service
   (private, concurrency 1, timeout 1800). Reads back its URL.
2. Grants the API SA `roles/run.invoker` on the worker Service.
3. Builds the **API** image and deploys the API Service with all env vars,
   including `WORKER_SERVICE_URL`, the queue/task settings, Stripe, auth, and CORS.

The worker gets `COMMON_ENV`; the API additionally gets the worker URL, tasks
config (`TASKS_QUEUE`, `TASKS_REGION`, `TASKS_INVOKER_SA` = the API SA),
`JOB_MAX_CONCURRENCY`, `STRIPE_*`, `AUTH_JWT_SECRET`, `CORS_ORIGINS`, and
`APP_ENV=production`.

## CI: GitHub Actions

- **`deploy-dev.yml`** — on push to `main` (or manual). Auths via a **service-
  account key** secret (`GCP_SA_KEY_DEV`), runs `setup-gcp.sh` (creates resources
  if missing), then `deploy.sh`. Passes secrets `TAVILY_API_KEY_DEV`,
  `STRIPE_SECRET_KEY_DEV`, `STRIPE_WEBHOOK_SECRET_DEV`, `AUTH_JWT_SECRET_DEV`, and
  var `CORS_ORIGINS_DEV`.
- **`deploy.yml`** — on push to `deploy-prod`. Auths via **Workload Identity
  Federation** (`WIF_PROVIDER_PROD` / `DEPLOY_SA_PROD`), then `deploy.sh` only
  (prod resources must be provisioned once manually with `ENV=prod
  setup-gcp.sh`). Only passes `TAVILY_API_KEY_PROD` in the shown workflow — set
  the other prod secrets (Stripe/auth) on the service or extend the workflow.

## Environment variables (from `config.ts`)

Every value has a default (import never throws). Grouped as in `config.ts`.

### Core / GCP
| Var | Default | Purpose |
|---|---|---|
| `ENV` | `dev` | Environment name; suffixes every resource. |
| `GCP_PROJECT_ID` | `sinuous-canto-497518-h7` | GCP project. |
| `GCP_LOCATION` | `us-central1` | Region for Vertex/Run/etc. |
| `FIRESTORE_DATABASE` | `agent-researcher-<env>` | Named Firestore DB. |

### Storage
| Var | Default | Purpose |
|---|---|---|
| `RESEARCH_BUCKET` | `agent-researcher-<env>-reports` | Output bucket. |
| `SIGNED_URL_TTL_MINUTES` | `60` | Lifetime of signed download URLs. |
| (fixed) `storage.rootPrefix` | `researchs` | Object prefix `researchs/{jobId}/`. |

### Firestore collections
| Var | Default |
|---|---|
| `JOBS_COLLECTION` | `jobs` |
| `APPS_COLLECTION` | `apps` |
| `RATE_LIMITS_COLLECTION` | `rate-limits` |
| `SETTINGS_COLLECTION` | `settings` (general doc id `general`) |
| `CREDITS_LEDGER_COLLECTION` | `credit-ledger` |
| `CREDITS_BALANCES_COLLECTION` | `credit-balances` |
| `APP_STATS_COLLECTION` | `app-stats` (+ `daily` subcollection) |
| `APP_USERS_COLLECTION` | `app-users` |
| `STATS_RETENTION_DAYS` | `60` | Daily-bucket TTL. |

### Stripe (billing)
| Var | Default | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | — | Stripe API key. Unset → billing endpoints disabled (`/plans` empty, `/checkout` 503). |
| `STRIPE_WEBHOOK_SECRET` | — | Verifies `/credits/webhook` signatures. Required for purchases to grant. |

### Auth
| Var | Default | Purpose |
|---|---|---|
| `AUTH_JWT_SECRET` | — | HS256 secret for signing/verifying session JWTs. **Required** in any non-local deploy. |
| `AUTH_JWT_ISSUER` | `agent-researcher` | JWT `iss`. |
| `AUTH_JWT_TTL_SECONDS` | `604800` (7d) | Session lifetime. |

### CORS
| Var | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins for web frontends (`*` in dev). |

### LLM
| Var | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `gemini-vertex` | Default provider (legacy/fallback). |
| `LLM_MODEL_FLASH` | `gemini-2.5-flash` | Concrete model for the `gather`/`flash` aliases. |
| `LLM_MODEL_PRO` | `gemini-2.5-pro` | Concrete model for the `pro` alias. |
| `LLM_DEFAULT_GATHER` | `gather` | Default research-loop alias. |
| `LLM_DEFAULT_SYNTH` | `pro` | Default synthesis alias. |
| `LLM_MAX_OUTPUT_TOKENS` | `32768` | Cap for structured JSON (avoid mid-JSON truncation). |
| `LLM_MAX_CONCURRENT_AGENTS` | `2` | Max agents running per job (Vertex-quota guard). |

Prices per alias (`inPerM`/`outPerM`) are set in `config.llm.models` — edit there
when provider pricing changes (one place; drives cost accounting).

### Search
| Var | Default | Purpose |
|---|---|---|
| `BRAVE_API_KEY` | — | Enables Brave (highest priority). |
| `TAVILY_API_KEY` | — | Enables Tavily search **and** page extraction; only Tavily calls are billed. |
| `RESEARCH_MAX_TURNS` | `16` | Default per-producer search/fetch budget when a template omits one. |
| `SEARCH_COST_PER_CALL_USD` | `0.016` | Estimated cost per Tavily call for accounting. |

Without any key, search falls back to keyless **DuckDuckGo** and `fetch_page` is
unavailable.

### Worker / Tasks (API only)
| Var | Default | Purpose |
|---|---|---|
| `WORKER_SERVICE_NAME` | `agent-researcher-<env>-worker` | Worker Service name. |
| `WORKER_REGION` | `us-central1` | Worker region. |
| `WORKER_SERVICE_URL` | — | Full worker URL (set by `deploy.sh` after the worker deploys). Enqueue requires it. |
| (fixed) `worker.runPath` | `/run` | Endpoint the queue POSTs to. |
| `TASKS_QUEUE` | `agent-researcher-<env>-jobs` | Cloud Tasks queue. |
| `TASKS_REGION` | `us-central1` | Queue region. |
| `TASKS_INVOKER_SA` | — | SA the task mints an OIDC token as (the API SA; needs run.invoker on the worker). Required to enqueue. |
| `TASKS_DISPATCH_DEADLINE` | `1800` | Per-task dispatch deadline (≥ worker timeout; Cloud Tasks max 1800s). |
| `JOB_MAX_CONCURRENCY` | `4` | Global cap on concurrent jobs = queue `max-concurrent-dispatches` = worker `max-instances`. |

### Server
| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Listen port (both services). |
| `LOG_LEVEL` | `info` | Fastify log level. |
| `APP_ENV` | `production` | `local` bypasses auth + rate limits + credits (dev headers). Anything else enforces them. |

## The apps: `fbizlab` and admin

`npm run reset:dev -- --confirm` (DEV only) wipes all test data and seeds a clean
slate: default settings, a **Backoffice Admin** app (`role: admin`), and the
**FloridaBizLab** app with fixed doc id **`fbizlab`** (`role: app`). It prints both
apiKeys once. Then, for real logins, configure each app:

```bash
# point the frontend's Google OAuth client at the app
npm run apps -- update --appId fbizlab --google-client-id <id>.apps.googleusercontent.com
# whitelist admin login emails on the admin app
npm run apps -- update --appId <adminAppId> --admin-emails "you@co.com"
```

For billing, create Stripe Prices tagged `metadata { app: "fbizlab", credits: N }`
with `lookup_key "fbizlab_<planId>"` (see [credits.md](credits.md)). Point Stripe's
webhook at `POST /credits/webhook` and set `STRIPE_WEBHOOK_SECRET`.

Manage apps/settings anytime with the CLI (`npm run apps -- <seed-admin|create|
list|update|get|settings>`) or the `/admin/*` endpoints.

## Local development

```bash
gcloud auth application-default login          # ADC for Vertex + Firestore
# .env: ENV=dev, APP_ENV=local, TAVILY_API_KEY=…, (GCP_PROJECT_ID if not default)
npm run research:local -- --template florida-business-for-sale \
  --params '{"industry":"laundromats","location":"Miami-Dade County, FL","mode":"essential"}'
# or the full API/worker:
npm run dev:api        # API on :8080 with APP_ENV=local (auth off, dev headers)
npm run run:worker     # worker on :8080
npm run templates:check
```

With `APP_ENV=local` the credits gate and rate limits are skipped and identity
comes from `x-app-id`/`x-user-id`/`x-role` headers.
