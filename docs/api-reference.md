# API reference

Base URL: the Cloud Run **API service** (`agent-researcher-<env>-api`). Interactive
docs at `/docs` (Swagger UI); OpenAPI JSON at `/docs/json`. Source:
`apps/api/src/index.ts`.

## Authentication summary

Send a **session JWT** (from `POST /auth/session`) as `Authorization: Bearer
<token>`. `appId` and `userId` are taken from the token, never the body. See
[auth.md](auth.md).

- **Public** (no token): `GET /health`, `/docs`, `POST /auth/session` (and any
  `/auth/*`), `POST /credits/webhook`.
- **User** (any valid token): templates, research, credits (own scope).
- **Admin** (token with `role: admin`): `/admin/*`, plus cross-app/user targeting
  on `/research`, `/credits/balance`, `/credits/transactions`.
- **Local dev** (`APP_ENV=local`): auth bypassed; identity from `x-app-id` /
  `x-user-id` / `x-role` headers; rate limits and credits gate skipped.

Common error envelope: `{ "error": "<message>", …extra }`.

---

## auth

### `POST /auth/session` — log in / sign up  · public
Verify a provider identity, return a session JWT.

Request:
```jsonc
{ "appId": "fbizlab", "provider": "google", "idToken": "<google id_token>" }
```
Response `200`:
```jsonc
{ "token": "<jwt>",
  "user": { "email": "a@b.com", "name": "Ada", "role": "user", "appId": "fbizlab" },
  "expiresInSeconds": 604800 }
```
Errors: `400` (missing `appId`/`provider`, app has no `googleClientId`, missing
`idToken`) · `401` (Google verification failed) · `403` (admin app: email not
whitelisted) · `404` (unknown/inactive app) · `501` (provider not enabled).

---

## templates

### `GET /templates` — list research models  · user
Query: `lang` (`en|es|fr|pt`, default `en`). Returns only the models the app is
allowed to use (scoped to `allowedTemplates`; admin apps see all). Each manifest
is self-contained — a client renders the whole form, texts, and credit cost from
it. See [model-ui.md](model-ui.md).
```jsonc
{ "templates": [ {
  "id": "florida-business-for-sale", "name": "…", "description": "…", "version": 1,
  "lang": "en",
  "sections":     [ { "key": "shortlist", "title": "Shortlist…" }, … ],
  "paramsSchema": { /* JSON Schema of accepted params (validate + build the form) */ },
  "paramsUi":     { /* rows, fields{help,suggestions,optionLabels,placeholder}, ranges, advanced, hidden */ },
  "modes":        [ { "key": "essential", "label": "Essential", "credits": 5 },
                    { "key": "comprehensive", "label": "Comprehensive", "credits": 18 } ],
  "addons":       [ { "key": "deck", "label": "Pitch deck (PDF)", "description": "…", "credits": 10 } ],
  "steps":        [ { "id": "planning", "label": "Planning", "description": "…" },
                    { "id": "deal-scout", "label": "Deal scout", "description": "…" }, … ],
  "reportSchema": { /* JSON Schema of the report object */ } } ] }
```
`modes[].credits` is the authoritative per-tier cost. Texts are localized to
`lang` (missing translations fall back to English). The internal `basePrompt` is
never exposed.

### `GET /templates/:id` — one model manifest  · user
Query: `lang` (as above). Returns the single manifest (same shape). `404` if
unknown; **`403` if the app isn't allowed to use this model**.

---

## research

### `POST /research` — create a research job  · user
Request (identity is NOT in the body):
```jsonc
{ "template": "florida-business-for-sale",
  "params": { "industry": "laundromats", "location": "Miami-Dade County, FL",
              "askingPriceMax": 500000, "language": "es",
              "mode": "essential" } }   // essential (~half cost) | comprehensive; default essential
```
Steps: validate → rate-limit (per app + per user) → **consume credits** for the
mode → record job → enqueue Cloud Task. Returns immediately:
```jsonc
{ "jobId": "…", "status": "queued" }   // 202
```
Errors:
- `400` — invalid template or params (`{ error: "Invalid params: …" }`).
- `429` — per-app or per-user reports/hour limit exceeded:
  `{ error, scope, limit, used }` + `Retry-After: 3600`.
- `402` — insufficient credits: `{ error: "Insufficient credits.", required, balance }`.
- `202` with `warning` — job recorded but enqueue failed; retry the request
  (credits already consumed for this jobId; a retried enqueue is idempotent).

Rate limits and the credits gate are **skipped** when `APP_ENV=local`.

### `GET /research` — list a user's jobs (report inbox)  · user
Query: `limit` (1-100, default 50). Admin only: `userId`, `appId` (default to the
token's). Returns newest-first summaries:
```jsonc
{ "jobs": [ { "jobId", "template", "title", "shortDescription", "status",
              "cost", "createdAt", "updatedAt", "finishedAt" } ] }
```

### `GET /research/:jobId` — poll a job  · user
Ownership: admins read any job; a regular user only their own (same `appId` +
email), else `403`. `404` if unknown.

While `queued`/`running`/`failed`:
```jsonc
{ "jobId", "appId", "userId", "template",
  "title": "Laundromats for Sale — Miami-Dade",
  "shortDescription": "Buy-side research on laundromats under $500k.",
  "status": "running",
  "progress": { "phase": "deal-scout", "message": "Searched: …",
                "turnsUsed": 20, "sourcesFound": 73, "updatedAt": "…" },
  // Map `progress.phase` → a localized label + description via the model
  // manifest's `steps` (GET /templates/:id) to explain the current phase.
  "cost": { "usd": 1.42, "llmUsd": 1.10, "searchUsd": 0.32,
            "inputTokens": 1200000, "outputTokens": 40000, "searchCalls": 40 },
  "summary": null, "createdAt", "updatedAt", "error": null }
```
When `completed`/`failed`, `summary` is populated (metrics + `degradedSections` +
`agentErrors`). When `completed`, the response also includes short-lived **signed
download URLs**:
```jsonc
{ …, "status": "completed", "finishedAt", "bucketPath": "researchs/<jobId>",
  "files": [
    { "name": "report.json",   "contentType": "application/json", "size": 91234,
      "url": "https://…", "expiresAt": "…" },
    { "name": "sources.json",  … }, { "name": "metadata.json", … },
    { "name": "trace.json", … } ] }
```

### `GET /research/:jobId/report` — structured report (for an in-app viewer)  · user
Returns the parsed `report.json` → `{ meta, report }` so a client can render the
report inline (proxied — no bucket CORS/signed-URL juggling). `report` is keyed by
section; values are Markdown strings or structured objects. Pair with the model
manifest's `sections` (titles + order). Owner or admin only. `409` until the job
is `completed`, `404` if unknown/missing.
When `failed`, `error` is set and `trace.json` remains available for diagnosis.

---

## credits

See [credits.md](credits.md) for semantics.

### `GET /credits/balance` — current balance  · user
Query (admin only): `userId`, `appId`. → `{ appId, userId, balance }`.

### `GET /credits/transactions` — credit ledger  · user
Query: `limit` (1-200, default 50); `type` (`purchase|consumption|refund|grant` —
e.g. only grants, for the credit audit); admin only `userId`, `appId`. →
`{ transactions: [ CreditLedgerEntry… ] }` newest-first. Each entry carries its
provenance: purchases → `paymentId`/`plan`/`amountUsd` (Stripe); manual grants →
`grantedBy` (admin) + `reason`; consumption/refund → `jobId`.

### `GET /credits/plans` — purchasable credit packs  · user
Returns the Stripe-defined packs for the caller's app (`metadata.appId == appId`).
`{ plans: [] }` if Stripe is not configured.
```jsonc
{ "plans": [ { "planId": "starter", "name": "Starter", "priceUsd": 10,
              "credits": 5, "priceId": "price_…" } ] }
```

### `POST /credits/checkout` — start a Stripe Checkout  · user
Request: `{ "planId": "starter", "successUrl": "https://…", "cancelUrl": "https://…" }`.
Resolves the plan by Price metadata `appId` + `planId`; creates a hosted Checkout
session with metadata `{ appId, userId, planId, credits }`.
```jsonc
{ "url": "https://checkout.stripe.com/…", "sessionId": "cs_…", "credits": 5 }
```
Errors: `503` (billing not configured) · `404` (unknown plan) · `400` (plan has no
`credits` metadata).

### `POST /credits/webhook` — Stripe webhook  · public (signature-verified)
Verifies the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET` (using the
raw body). On `checkout.session.completed`, records the purchase (idempotent by
payment id) and, the first time only, folds it into per-app stats. Always `200
{ received: true }` on success; `400` on missing/invalid signature.

---

## admin  · admin token required (`requireAdmin`)

### `POST /admin/credits/grant` — grant credits
Request: `{ "appId", "userId", "credits" (≥1), "reason" (required), "idempotencyKey"?,
"note"? }`. → `{ granted, applied, grantedBy, balance }`. **`grantedBy` is taken
from the admin token** (never the body) and `reason` is required — every manual
grant is attributed in the ledger for audit. Pass `idempotencyKey` to dedupe
double-clicks/retries (else each call is a new grant). Grant an admin their own
credits by targeting their own `appId`/`userId`.

### `GET /admin/stats` — cross-app dashboard aggregate
Query: `days` (1-365, default 30). → `{ totals, apps: [ rollup… ], daily: [ … ] }`.
`totals`/`apps` include reports, `reportsCompleted`, `reportsFailed` (= total error
count), `degradedReports`, `users`, `costUsd`, `revenueUsd`, `purchases`,
`creditsPurchased`, and `avgGenMs`/`genTimeMsMin`/`genTimeMsMax` (total generation
time). `daily` is the merged newest-first series across all apps.

### `GET /admin/users` — search users
Query: `appId`?, `q`? (email/userId prefix), `limit` (1-200, default 50). →
`{ users: [ { appId, userId, reports, costUsd, spentUsd, creditsPurchased,
firstSeenAt, lastSeenAt } … ] }` from the `app-users` rollup.

### `POST /admin/jobs/:jobId/retry` — re-run a failed job (manual retry)
Resets the job to `queued` with a fresh retry budget (attempts → 0, prior error
cleared) and re-dispatches it to the worker with a unique task name. Credits are
**not** re-charged (consumption is idempotent by jobId). → `202 { jobId, status }`.
`404` if unknown, `409` if the job is still `queued`/`running`.

### `GET /admin/jobs` — list/filter jobs across apps
Query: `appId`?, `userId`?, `status`? (`queued|running|completed|failed|incomplete`),
`template`?, `limit` (1-200, default 50). → `{ jobs: [ { jobId, appId, userId,
template, title, status, cost, attempts, createdAt, updatedAt, finishedAt } … ] }`
newest-first. Use `GET /research/:jobId` for full status/summary/download URLs.

### `GET /admin/pricing/:templateId` — a model's credit pricing
→ `{ templateId, modes: [ { key, defaultCredits, credits } ], addons, updatedAt }`.
`defaultCredits` = code/template default; `credits` = effective (Firestore override
applied). `404` if the model is unknown.

### `PUT /admin/pricing/:templateId` — set a model's credit pricing
Body: `{ modes?: { essential?, comprehensive? }, addons?: { <key>: n } }` (integers
≥1). Overrides the code default **without a deploy**; omit a mode to keep its
default. → same shape as GET. The override flows into the manifest `modes[].credits`
and what `POST /research` charges.

### `GET /admin/settings` — default rate limits
→ `{ settings: { appRateLimitPerHour, userRateLimitPerHour, updatedAt } }`.

### `PATCH /admin/settings` — update default rate limits
Body: `{ appRateLimitPerHour?, userRateLimitPerHour? }` (integer ≥1, or `null` =
unlimited). → `{ settings }`.

### `GET /admin/apps` — list apps
→ `{ apps: [ AppPublic… ] }` (apiKey masked to `apiKeyPreview`).

### `POST /admin/apps` — create an app
Body: `{ "name", "role"?: 'admin'|'app', "appId"?, "rateLimitPerHour"?,
"allowedTemplates"?, "googleClientId"?, "adminEmails"? }`. Returns `201 { app }`
including the **full apiKey once** (legacy secret; the live auth path is session
JWTs). `400` if `name` missing. Pass `appId` as a slug for well-known apps.

### `PATCH /admin/apps/:appId` — update an app
Body: `{ "name"?, "active"?, "rateLimitPerHour"? (`null` clears), "allowedTemplates"?,
"googleClientId"?, "adminEmails"? }`. → `{ app: AppPublic }`. `404` if unknown.

### `DELETE /admin/apps/:appId` — delete an app
Removes the app doc. `400` if it's the admin's own app, `404` if unknown, else
`200 { deleted }`.

---

## Other

### `GET /health` — liveness  · public
`{ ok: true }` (hidden from Swagger).

## The deliverable: `report.json`

A typed envelope `{ meta, report }`. `report`'s keys are the model's section keys
in template order. `meta.schemaVersion` (`"<id>@<version>"`) is your **contract** —
branch on it. See [research-models.md](research-models.md) and
[models/florida-business-for-sale.md](models/florida-business-for-sale.md).

**Rendering note:** string fields are **Markdown** (`meta.contentFormat =
"markdown"`) with inline `[label](url)` citations. If you render them in a browser,
sanitize (block raw HTML/JS) — content is model-generated over web text.

## Curl example

```bash
BASE=https://…; TOKEN=$(curl -s -X POST $BASE/auth/session -H 'content-type: application/json' \
  -d '{"appId":"fbizlab","provider":"google","idToken":"'"$GOOGLE_IDTOKEN"'"}' | jq -r .token)

JOB=$(curl -s -X POST $BASE/research -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"template":"florida-business-for-sale",
       "params":{"industry":"laundromats","location":"Miami-Dade County, FL","language":"es"}}' \
  | jq -r .jobId)

curl -s $BASE/research/$JOB -H "authorization: Bearer $TOKEN" | jq '.status, .progress'
```

Local dev (no JWT):
```bash
curl -s -X POST http://localhost:8080/research \
  -H 'x-app-id: fbizlab' -H 'x-user-id: me@dev' -H 'content-type: application/json' \
  -d '{"template":"florida-business-for-sale","params":{"industry":"laundromats"}}'
```
