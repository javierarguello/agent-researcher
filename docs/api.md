# API usage

Base: the Cloud Run **API service** (`agent-researcher-${ENV}-api`). Interactive
docs at `/docs` (Swagger UI), OpenAPI JSON at `/docs/json`. `/health` and `/docs`
are public; everything else needs an API key.

## Authentication

Send the app's API key as either header:

```
x-api-key: <key>
# or
Authorization: Bearer <key>
```

Keys resolve against the Firestore `apps` registry. `admin`-role keys can manage
apps and settings under `/admin/*`. (Auth is disabled when `APP_ENV=local`.)

## Endpoints

### `GET /templates` — list research models
```json
{ "templates": [ { "id": "florida-business-for-sale", "name": "…",
  "description": "…", "version": 1, "sections": [ { "key": "shortlist", "title": "…" } ] } ] }
```

### `GET /templates/:id` — one model + its schemas
Returns the manifest including `paramsSchema` (JSON Schema of accepted params)
and `reportSchema` (JSON Schema of the `report` object your consumer receives).

### `POST /research` — create a job
```jsonc
// body
{
  "appId": "…",          // must match the API key
  "userId": "…",         // UUID or email (rate-limit key)
  "template": "florida-business-for-sale",
  "params": { "industry": "laundromats", "location": "Miami-Dade County, FL",
              "askingPriceMax": 500000, "language": "es",
              "mode": "essential" }   // essential (~half cost) | comprehensive (full); default essential
}
```
Returns immediately (the worker runs asynchronously):
```json
{ "jobId": "…", "status": "queued" }
```
`429` when the per-app or per-user reports/hour limit is exceeded
(`{ scope, limit, used }` + `Retry-After`).

### `GET /research/:jobId` — poll a job
While running, returns an auto-generated `title` + `shortDescription` (for
dashboards), plus `progress` and a running `cost` (updated per agent/wave):
```json
{ "jobId": "…", "status": "running",
  "title": "Laundromats for Sale — Miami-Dade",
  "shortDescription": "Buy-side research on laundromats for sale in Miami-Dade under $500k.",
  "progress": { "phase": "deal-scout", "message": "Searched: …", "turnsUsed": 20, "sourcesFound": 73 },
  "cost": { "usd": 1.42, "llmUsd": 1.10, "searchUsd": 0.32, "inputTokens": 1200000, "outputTokens": 40000 } }
```
When `completed`/`failed` it also carries `summary` (metrics + `degradedSections`
+ `agentErrors`).
When `completed`, includes short-lived **signed download URLs** for the job files:
```json
{ "status": "completed", "files": [
  { "name": "report.json",   "url": "https://…", "contentType": "application/json", "expiresAt": "…" },
  { "name": "sources.json",  "url": "https://…" },
  { "name": "metadata.json", "url": "https://…" },
  { "name": "trace.json",    "url": "https://…" }
] }
```
When `failed`, `error` is set and `trace.json` is still available for diagnosis
(see [architecture.md](architecture.md) → tracing).

## The deliverable: `report.json`

A typed envelope `{ meta, report }`. `report`'s keys are the model's section keys
(see [models/florida-business-for-sale.md](models/florida-business-for-sale.md)).
`meta.schemaVersion` (`"<id>@<version>"`) is your **contract** — branch on it.

**Rendering note:** string fields are **Markdown** (`meta.contentFormat` =
`"markdown"`). If you render them in a browser, sanitize the Markdown (block raw
HTML/JS) — the content is model-generated over web text.

## Curl example

```bash
KEY=…; BASE=https://…
JOB=$(curl -s -X POST $BASE/research -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"appId":"app1","userId":"a@b.com","template":"florida-business-for-sale",
       "params":{"industry":"laundromats","location":"Miami-Dade County, FL","language":"es"}}' \
  | jq -r .jobId)
curl -s $BASE/research/$JOB -H "x-api-key: $KEY" | jq '.status, .progress'
```
