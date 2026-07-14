# Per-app analytics (stats)

A lightweight, **write-only** (for now) analytics layer that tracks each app's
usage directly in Firestore, so a dashboard can read the docs with no aggregation
job. Source: `packages/core/src/stats/store.ts`. Config:
`packages/core/src/config.ts` → `config.stats`.

Everything is maintained with atomic `FieldValue.increment`, so writes are
lock-free and a reader just reads the doc(s). Averages are stored as
**total + count** (avoid read-modify-write): `avgGenMs = genTimeMsTotal /
genCount`.

## Collections

| Path | Doc id | Grain | TTL |
|---|---|---|---|
| `app-stats/{appId}` | `appId` | All-time aggregate per app. | none |
| `app-stats/{appId}/daily/{yyyy-mm-dd}` | UTC date | One bucket per UTC day. | `retentionDays` (default 60) via `expireAt` |
| `app-users/{appId__userId}` | `<appId>__<userId>` | Per-(app,user) record. | none |

The `daily` subcollection carries an `expireAt` **Timestamp**; a Firestore TTL
policy on the `daily` collection group auto-deletes buckets after
`STATS_RETENTION_DAYS` days (set up in `infra/setup-gcp.sh`).

## What's tracked

### `app-stats/{appId}` (all-time) and each `daily/{date}` bucket

| Field | Written by | Meaning |
|---|---|---|
| `appId`, `updatedAt` | both | Identity + last write. |
| `date` | daily only | The bucket's UTC date. |
| `users` | report/purchase (first time a user is seen) | Distinct users all-time (app-stats only). |
| `newUsers` | first-seen | New distinct users that day (daily only). |
| `reports` | every finished report | Total reports attempted. |
| `reportsCompleted` / `reportsFailed` | per report | Split by outcome. `reportsFailed` = **total error count**. |
| `degradedReports` | per report | Reports delivered with ≥1 section degraded (partial success). |
| `reportsByTemplate.<templateId>` | per report | Count per template (nested map of counters). |
| `costUsd` | per report | Sum of report generation cost (LLM + search). |
| `genTimeMsTotal` / `genCount` | completed reports only | For `avgGenMs = genTimeMsTotal / genCount`. |
| `genTimeMsMin` / `genTimeMsMax` | completed reports only | Fastest / slowest total generation time (ms). |
| `revenueUsd` | per purchase | Sum of money paid. |
| `purchases` | per purchase | Count of purchases. |
| `creditsPurchased` | per purchase | Sum of credits bought. |

### `app-users/{appId__userId}` (per user)

`{ appId, userId, firstSeenAt, lastSeenAt, reports, costUsd, spentUsd,
creditsPurchased }` — a per-user rollup of reports/cost (reports) and revenue/
credits (purchases). `firstSeenAt` is set once; `lastSeenAt` on every activity.

## Who writes what, when

- **`recordReportStats(input)`** — called from `run-job.ts` after every job
  (completed **or** failed; best-effort, wrapped in try/catch so it never breaks
  the job). Input: `{ appId, userId, template, status, costUsd, durationMs,
  degraded? }`. It bumps `reports`, the outcome counter (`reportsFailed` is the
  running **total error count**), `costUsd`, `reportsByTemplate[template]`,
  `degradedReports` when `degraded`, and (only when completed)
  `genTimeMsTotal`/`genCount` plus a transactional `genTimeMsMin`/`genTimeMsMax`
  update (min/max can't be done with `FieldValue.increment`), across app-stats +
  the day's bucket + the user doc; and ensures the user is counted.
- **`recordPurchaseStats(input)`** — called from the Stripe **webhook** (only the
  first time a purchase is applied — idempotent with the ledger). Input:
  `{ appId, userId, amountUsd, credits }`. Bumps `revenueUsd`, `purchases`,
  `creditsPurchased` across app-stats + day + user.
- **`ensureUserSeen(appId, userId, date)`** — internal; the first time a
  `(app,user)` pair is seen it creates the `app-users` doc and increments `users`
  (all-time) + `newUsers` (that day). Transactional.

## Reading (convenience helpers)

The consuming API isn't built yet, but two read helpers exist:

- `getAppStats(appId)` → the all-time doc (or `null`).
- `getDailyStats(appId, days = 60)` → the last N `daily` buckets, newest first.
- `listAllAppStats()` → every app's all-time doc (admin dashboard).
- `getAdminStats(days = 30)` → cross-app aggregate: `{ totals, apps[], daily[] }`
  (global totals incl. errors=reportsFailed and avg/min/max gen time, per-app
  rollups, merged daily series). Powers `GET /admin/stats`.
- `queryUsers({ appId?, emailPrefix?, limit })` → users from `app-users` (powers
  `GET /admin/users`). Needs composite indexes: `(appId, userId)` for the prefix
  path, `(appId, lastSeenAt desc)` otherwise.

`getAppStats`/`getDailyStats` are plain reads; `getDailyStats` orders by
`date desc` (single-field index — no composite needed).

## Notes

- **Best-effort:** report stats failures are logged (`stats.report_failed`) and
  swallowed — analytics never fail a job.
- **UTC day boundaries** for daily buckets (`toISOString().slice(0,10)`).
- **Cost vs revenue:** `costUsd` is your LLM+search spend; `revenueUsd` is user
  payments — margin is `revenueUsd − costUsd` per app/day.
