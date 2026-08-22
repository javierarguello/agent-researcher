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
- **`deploy.yml`** — on push to `deploy-prod`. Auths with a **service-account
  key** (`GCP_SA_KEY_PROD`), exactly like dev, then `deploy.sh` only (prod
  resources must be provisioned once manually with `ENV=prod setup-gcp.sh`). It
  read `WIF_PROVIDER_PROD` / `DEPLOY_SA_PROD` until 2026-08-21, and Workload
  Identity Federation had never been set up in this project — no pool, no
  provider, and no `WIF_PROVIDER_DEV` either — so the first prod deploy would
  have failed at the auth step. Both environments live in one GCP project under
  one owner account and differ only in resource names, so the deploy identity is
  the same shape as dev's. It passes the **whole** secret set, and it has to:
  `deploy.sh` deploys with `--set-env-vars`, which REPLACES the service
  environment, so a secret the workflow does not pass is **erased** from the
  running service. "Set it on the service" is not an option — the next deploy
  removes it. `deploy.sh` refuses a `prod` deploy whose `AUTH_JWT_SECRET`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` or `POSTMARK_SERVER_TOKEN` is
  empty, because each of those is a silent outage rather than a failed request
  (round 8, R8-1).

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

One endpoint per Stripe account (sandbox → the dev API, live → the prod API), each
with its own signing secret, and **nine specific events** — three that decide whether
a payment becomes credits and six that keep the catalog from serving 30-minute-old
prices. The list, what each one's absence breaks, and how to verify delivery instead
of assuming it: [credits.md](credits.md#the-webhook-endpoint--the-nine-events-and-what-breaks-without-each).

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

Its comma is why `deploy.sh` builds `--set-env-vars` with `^|^` and a `|`
delimiter. gcloud's default parse splits the whole flag on commas, so a value
containing one is torn in half and the piece without an `=` is rejected —
`Bad syntax for dict arg: [https://…-admin.web.app]`. It surfaced on the first
prod deploy (2026-08-21) and only there: dev leaves `CORS_ORIGINS_DEV` unset and
falls back to `*`. The script now refuses to deploy if any value contains a `|`.

### LLM
| Var | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `gemini-vertex` | Default provider (legacy/fallback). |
| `LLM_MODEL_FLASH` | `gemini-2.5-flash` | Concrete model for the `gather`/`flash` aliases. |
| `LLM_MODEL_PRO` | `gemini-2.5-pro` | Concrete model for the `pro` alias. |
| `LLM_DEFAULT_GATHER` | `gather` | Default research-loop alias. |
| `LLM_DEFAULT_SYNTH` | `pro` | Default synthesis alias. |
| `LLM_MAX_OUTPUT_TOKENS` | `32768` | Cap for structured JSON (avoid mid-JSON truncation). |
| `LLM_GATHER_MAX_OUTPUT_TOKENS` | `4096` | Cap per research turn. A turn emits a plan or a query; uncapped, each of `2×budget+6` turns could emit the model default. |
| `LLM_GATHER_THINKING_BUDGET` | `1024` | Thinking budget per research turn. Bounded, not zeroed — query planning is where reasoning pays. Billed as output. |
| `MAX_JOB_COST_USD` | `20` | Deployment-wide per-job spend ceiling, counted across all dispatches. A safety net against retry amplification, not a budget. A model can override it per mode (`modes[key].maxCostUsd`) — a cheap scan and a deep report should not share one number. A job that trips it is **held for an admin decision**, not failed and not refunded. `0` disables. |
| `LLM_MAX_CONCURRENT_AGENTS` | `2` | Max agents running per job (Vertex-quota guard). |
| `LLM_PROVIDER_<ALIAS>` | — | Per-alias provider override (`LLM_PROVIDER_FLASH=ollama`). Points just those calls elsewhere. |
| `OLLAMA_HOST` | `http://localhost:11434` | Local model server for the `ollama` provider (dev/testing only — see [local-llm.md](local-llm.md)). |
| `OLLAMA_TIMEOUT_MS` | `180000` | Per-call timeout; local models on CPU are slow. |

Prices per alias (`inPerM`/`outPerM`) are set in `config.llm.models` — edit there
when provider pricing changes (one place; drives cost accounting).

### Held jobs (the alert state)

A job that hits its cost ceiling, cannot store its report, or cannot be assembled is
**held**: paused, with the buyer's credits still consumed, waiting for an admin to
continue it (uncapped, from its checkpoint), refund it, top the buyer up, or close
it.

**There is no expiry and no scheduler.** Nothing resolves a hold but a person —
every refund is a decision someone made. The practical consequence is that the
admin's held-jobs list (`GET /admin/jobs?status=held`) is not a convenience, it is
the queue: a job nobody looks at waits forever, and so do the buyer's credits.

### Request review (moderation + pre-flight)
See [request-review.md](request-review.md).

| Var | Default | Purpose |
|---|---|---|
| `MODERATION_LLM` | `true` | LLM classifier on top of the deterministic pre-screen. `false` keeps the free rule-based screen only. |
| `VALIDATION_LLM` | `true` | The assisted half of the pre-flight review. `false` still returns the deterministic summary + findings. |
| `PREFLIGHT_ASSIST_ATTEMPTS` | `2` | Assisted reviews for one report being drafted. Past it the review is deterministic-only and generation proceeds — no wait. |
| `PREFLIGHT_ASSIST_USER_ATTEMPTS` | `30` | Backstop across all drafts per user in the window. Only this one triggers the cooldown. |
| `PREFLIGHT_COOLDOWN_HOURS` | `1,6,24,72` | Escalating pause each time the per-user backstop trips; generating pays one step back. |
| `PREFLIGHT_WINDOW_HOURS` | `8` | Sliding window after which the allowance counter restarts on its own. |

### Public-endpoint abuse limits + Turnstile (API only)
Unauthenticated routes have no session to meter and each costs money (Postmark
sends, password hashing), so they are capped per client IP and per target email.
`0` disables one limit.

| Var | Default | Purpose |
|---|---|---|
| `PUBLIC_BURST_PER_MINUTE` | `30` | In-process burst guard per IP, across all public routes. |
| `PUBLIC_REGISTER_PER_HOUR_IP` | `30` | Registrations per IP per hour. One office or CGNAT carrier is many people behind one address; the per-TARGET cap below is what stops mail-bombing. |
| `PUBLIC_LOGIN_PER_HOUR_IP` / `_EMAIL` | `30` / `10` | Login attempts per IP / per targeted account. |
| `PUBLIC_RESET_PER_HOUR_IP` / `_EMAIL` | `30` / `3` | Password-reset emails per IP / per target inbox. Same reasoning as registration: five per hour is five for a whole co-working floor, and the sixth person to forget their password is locked out with no other way in. |
| `PUBLIC_CONTACT_PER_HOUR_IP` | `30` | Contact-form submissions per IP. |
| `PUBLIC_TOKEN_PER_HOUR_IP` | `120` | Verify-email and reset-password link submissions per IP — **one bucket each**, not shared. Clicking the link in your own signup mail is the most ordinary thing a new customer does; at 30 shared, a run of resets behind one carrier NAT could tell every new signup that their link had expired. |
| `PUBLIC_PREFLIGHT_PER_HOUR_IP` / `PREFLIGHT_PER_HOUR_PER_USER` | `240` / `60` | Report previews per shared address / per person. The IP figure is deliberately 4× the user one: set equal, it always trips first and the per-user cap can never fire. |
| `PUBLIC_PLANS_PER_HOUR_IP` / `PLANS_PER_HOUR_PER_USER` | `60` / `60` | Pricing-catalog reads per IP / per user. |
| `CHECKOUT_PER_HOUR_PER_USER` | `20` | Stripe checkout sessions per user per hour. |
| `TRUSTED_PROXY_HOPS` | `0` | `X-Forwarded-For` entries added by infrastructure BEYOND the one holding the real peer. **0** when the API is reached directly on `*.run.app` (this deployment) — Cloud Run appends the peer, so the last entry is real. **1** behind a global external load balancer. Too high and every per-IP limit keys on a header the caller writes. |
| `TURNSTILE_SECRET` | — | Cloudflare Turnstile secret for the registered widget. **Empty disables the bot check entirely** — every guarded flow behaves exactly as before. Server-side only. |
| `TURNSTILE_SITE_KEY` | `0x4AAAAAAD_OEtqrL5B2NN6f` | Public site key. Ships in the HTML; the web app has the same default via `VITE_TURNSTILE_SITE_KEY`. |
| `TURNSTILE_FLOWS` | `register,login,password-reset,contact,research,preflight` | Which flows require a solved widget. A route binds to a flow name, so protecting or unprotecting one is a deploy-time decision. |
| `TURNSTILE_APPS` | `fbizlab` | Apps whose UI actually renders the widget. An app not listed is exempt — this is what keeps the admin SPA (and any headless consumer) from being locked out when the secret is set. |

**Turning Turnstile on** — the secret is the only thing that has to be stored,
and it follows the same path as every other backend secret (GitHub secret →
workflow env → `infra/deploy.sh` → Cloud Run `--set-env-vars`):

```bash
gh secret set TURNSTILE_SECRET_DEV    # dev API
gh secret set TURNSTILE_SECRET_PROD   # prod API
```

Nothing else is required. The site key is public and already compiled into the
web app, so `FBIZLAB_{DEV,PROD}_TURNSTILE_SITE_KEY` are optional GitHub
*variables* that only matter if you point an environment at a different widget.
A local `.env` is needed only to exercise the check while developing — leaving
`TURNSTILE_SECRET` empty keeps it off, which is the default everywhere.

Because it is off until the secret exists, the safe rollout is: deploy the code
first (no behaviour change), then set the secret when you want enforcement, and
`gh secret delete` to turn it back off without a code change.

### Search
| Var | Default | Purpose |
|---|---|---|
| `BRAVE_API_KEY` | — | Enables Brave (highest priority). |
| `TAVILY_API_KEY` | — | Enables Tavily search **and** page extraction. Extraction is Tavily-only: without this key `fetch_page` fails. |
| `SEARCH_COST_PER_CALL_USD` | `0.016` | Estimated USD per Tavily call, for cost accounting. Charged for `fetch_page` regardless of which backend serves `web_search`, because extraction is always Tavily. |
| `BRAVE_COST_PER_CALL_USD` | `0` | Estimated USD per Brave call. **Set it if you are on a paid Brave plan** — at 0 the job cost silently omits every search. |
| `RESEARCH_MAX_TURNS` | `16` | Default per-producer search/fetch budget when a template omits one. |

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
slate: default settings, a **Backoffice Admin** app (doc id **`admin`**,
`role: admin`), and the **FloridaBizLab** app (doc id **`fbizlab`**, `role: app`,
restricted to `allowedTemplates: ['florida-business-for-sale']`). Both use a
**slug doc id, never a UUID** — see [auth.md](auth.md#well-known-apps-use-a-slug-doc-id-never-a-uuid).
It prints both apiKeys once. Then, for real logins, configure each app:

```bash
# point the frontend's Google OAuth client at the app
npm run apps -- update --appId fbizlab --google-client-id <id>.apps.googleusercontent.com
# whitelist admin login emails on the admin app (doc id `admin`)
npm run apps -- update --appId admin --admin-emails "you@co.com"
# the From address and the origin email links are built from — REQUIRED, or
# /auth/register answers 500 and nobody can verify an email
npm run apps -- update --appId fbizlab \
  --email-from "FloridaBizLab <no-reply@floridabizlabs.com>" \
  --web-url https://agent-researcher-prod-fbizlab.web.app
```

**A new environment has no `reset:dev`.** That script refuses any `ENV` but `dev`,
so prod comes up with an empty Firestore and nothing seeds it:
`bash infra/seed-prod.sh --admin-emails "you@co.com" --confirm` creates both app
docs under their slug ids (never a UUID — `apps seed-admin` mints one, and the SPAs
are compiled against `admin` / `fbizlab`), and updates instead of recreating when a
doc already exists, because `createApp` writes with `.set()` and would mint a new
apiKey over the old doc. Its companion `infra/prod-secrets.sh` creates the `_PROD`
secrets and variables — `status` first, it prints what is missing.

For billing, create Stripe Prices tagged `metadata { appId: "fbizlab", planId:
"<planId>", credits: N }` (see [credits.md](credits.md)). Point Stripe's
webhook at `POST /credits/webhook` and set `STRIPE_WEBHOOK_SECRET`.

Manage apps/settings anytime with the CLI (`npm run apps -- <seed-admin|create|
list|update|get|delete|settings>`) or the `/admin/*` endpoints.

## Admin SPA (`apps/admin`) — Firebase Hosting

The admin backoffice is a **static SPA** (Vite + React + Mantine) that talks to
the API directly — no server. It's hosted on its own Firebase Hosting sites in
the same project (`sinuous-canto-497518-h7`), one per env (mirroring the
`agent-researcher-{dev,prod}-*` convention):

| Env | Hosting site | URL | Target | Builds against |
|---|---|---|---|---|
| dev | `agent-researcher-dev-admin` | https://agent-researcher-dev-admin.web.app | `admin-dev` | the dev API |
| prod | `agent-researcher-prod-admin` | https://agent-researcher-prod-admin.web.app | `admin-prod` | the prod API |

Both targets are mapped in `apps/admin/.firebaserc`. CI (`deploy-admin.yml`, push
to `main`) deploys **dev**; prod is deployed manually (`ADMIN_HOSTING_TARGET=admin-prod
bash infra/deploy-admin.sh`) once the prod API + site exist.

**Build-time config** (Vite `VITE_*`, baked into the bundle): `VITE_API_BASE_URL`
(the API's public URL) and `VITE_ADMIN_GOOGLE_CLIENT_ID` (the admin app's Google
OAuth client id). See `apps/admin/.env.example`.

**One-time setup** (owner account, miltonjaviera@gmail.com):

```bash
firebase login
firebase hosting:sites:create agent-researcher-dev-admin --project sinuous-canto-497518-h7
# targets admin-dev / admin-prod → sites are mapped in apps/admin/.firebaserc

# repo variables for CI (both are public — not secrets):
gh variable set ADMIN_API_BASE_URL     --body "$(gcloud run services describe agent-researcher-dev-api --region us-central1 --format='value(status.url)')"
gh variable set ADMIN_GOOGLE_CLIENT_ID --body "<id>.apps.googleusercontent.com"
```

Then, so login actually works:

1. **Google OAuth client** — create an OAuth 2.0 Web client in the GCP console;
   set its authorized JavaScript origins to the Hosting URL
   (`https://agent-researcher-dev-admin.web.app`) **and** `http://localhost:5173` (dev).
2. **Point the admin app at it** — `npm run apps -- update --appId admin
   --google-client-id <id>.apps.googleusercontent.com` and whitelist your email
   with `--admin-emails you@example.com`.
3. **CORS** — set the `CORS_ORIGINS_DEV` repo variable (consumed by
   `deploy-dev.yml`) to include the Hosting origin + `http://localhost:5173`, then
   redeploy the API. Dev defaults to `*`, so this only matters when locking down.

**Deploy** — on push to `main` touching `apps/admin/**`, `deploy-admin.yml` builds
and deploys automatically. Manually:

```bash
VITE_API_BASE_URL=https://…run.app VITE_ADMIN_GOOGLE_CLIENT_ID=…apps.googleusercontent.com \
  bash infra/deploy-admin.sh
```

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
