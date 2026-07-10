# End-to-end flows

Sequence walkthroughs of the main paths, with the exact functions/files involved.
See [architecture.md](architecture.md) for the big picture.

## (a) User login

```
Frontend                       API (apps/api)                 Core / Google
   │  Google Sign-In (client)                                     │
   │  → google id_token                                           │
   │                                                              │
   │ POST /auth/session {appId, provider:'google', idToken}       │
   │ ───────────────────────────▶                                 │
   │                    getApp(appId)  ──────────▶ Firestore apps/{appId}
   │                    verifyGoogleIdToken(idToken, googleClientId) ─▶ Google
   │                    (admin app? email ∈ adminEmails → role admin) │
   │                    signSession({email, appId, role, name})   │
   │ ◀─────────────────  { token, user, expiresInSeconds }        │
   │ store token; send `Authorization: Bearer <token>` thereafter │
```

- Unknown/inactive app → `404`; bad id_token → `401`; admin app + non-whitelisted
  email → `403`; non-google provider → `501`.
- On every later request the `jwtAuth` hook verifies the token and loads the app
  doc; `appId` + `userId` (=email) come from the token. See [auth.md](auth.md).

## (b) Generate a report end-to-end

```
Client            API                         Cloud Tasks     Worker                     GCP
  │ POST /research {template, params}                                                     │
  │ ───────────▶                                                                          │
  │        validateRequest(body)  ── invalid → 400                                        │
  │        appId,userId ← token                                                           │
  │        checkRateLimits([app,user]) ── over → 429 (nothing enqueued)                   │
  │        resolveMode → creditsForMode                                                   │
  │        consumeCredits(appId,userId,cost,jobId) ── low → 402                           │
  │        createJob(jobId, status=queued)  ───────────────────────────────▶ Firestore jobs/{jobId}
  │        enqueueJob(jobId)  ─────────────▶ task (name=jobId, OIDC)                       │
  │ ◀── 202 {jobId, status:queued}                                                        │
  │                                          │ push POST /run {jobId} (≤ N in flight)      │
  │                                          │ ───────────────────────────▶                │
  │                                                        getJob; if done → ack 200 skip  │
  │                                                        runJob(input):                  │
  │                                                          markRunning                   │
  │                                                          generateHeadline → setJobHeadline
  │                                                          runResearch(template,params): │
  │                                                            resolveMode → effective tmpl│
  │                                                            build system prompt + brief │
  │                                                            waves = topoSort(agents)    │
  │                                                            for each wave (≤2 parallel):│
  │                                                              producer: gather() loop   │
  │                                                                update_plan/web_search/ │
  │                                                                fetch_page → Evidence   │──▶ Brave/Tavily/DDG
  │                                                                synthesizeStructured    │──▶ Vertex (Gemini)
  │                                                              merge slice into report   │
  │                                                              (fail → degraded section) │
  │                                                            derive `sources`            │
  │                                                            validate report schema      │
  │                                                            onTrace after each wave:    │
  │                                                              upload trace.json          │──▶ GCS
  │                                                              setJobCost (running total) │──▶ Firestore
  │                                                            onProgress → setProgress + log
  │                                                          upload report.json/sources.json/
  │                                                            metadata.json/trace.json     │──▶ GCS
  │                                                          setJobSummary                  │──▶ Firestore
  │                                                          recordReportStats              │──▶ Firestore stats
  │                                                          markCompleted(files)           │
  │                                          │ ◀── 200 {status}                             │
  │ GET /research/:jobId (poll) ─────────▶                                                 │
  │        running → {status,progress,cost,title,…}                                        │
  │        completed → + signed URLs (signJobFiles, 60min)                                 │
```

Key points:
- **The API returns in ms** — it never runs research. Everything after `202`
  happens in the worker.
- **`report.json`** = `{ meta, report }`; `report` keys are the (effective)
  section keys. See [research-models.md](research-models.md).
- **Progress** is written per agent note/wave to `job.progress`; **cost** is a
  running total updated per wave; **title/shortDescription** appear early (headline
  step) so the inbox has something to show while running.
- **Trace** is uploaded after every wave (survives a crash) and again at the end.

## (c) Buy credits (checkout → webhook → grant)

```
Frontend           API                        Stripe                      Core
  │ GET /credits/plans ───────▶ listStripePlans(appId) ─▶ prices.search(metadata.app==appId)
  │ ◀── {plans:[{planId,priceUsd,credits,…}]}                                   │
  │                                                                             │
  │ POST /credits/checkout {planId, successUrl, cancelUrl}                      │
  │ ───────────▶ resolveStripePlan(appId,planId)  ─▶ prices.list(lookup_key=appId_planId)
  │              checkout.sessions.create(                                      │
  │                 metadata={appId,userId,planId,credits})  ─▶ Stripe          │
  │ ◀── {url, sessionId, credits}                                              │
  │ redirect user to url ───────────────────────▶ Stripe hosted Checkout       │
  │                                    user pays                                │
  │                                                                             │
  │                          Stripe ── POST /credits/webhook (signed) ─────────▶│
  │                          constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)│
  │                          event = checkout.session.completed                 │
  │                          recordPurchase(paymentId) → ledger+balance (idempotent)
  │                          if applied: recordPurchaseStats(...)               │
  │                          ◀── 200 {received:true}                            │
```

- The plan **catalog lives entirely in Stripe** (Prices + `lookup_key`/metadata),
  never Firestore.
- `recordPurchase` is idempotent (`purchase_<paymentId>`); stats are folded in
  **only** the first time an event applies — safe under Stripe's at-least-once
  webhooks. See [credits.md](credits.md).

## (d) Refund on failure

```
Worker  runJob → runResearch                                     Core credits
   │  final schema validation fails  OR  engine throws            │
   │  ── trace.status = failed / catch(error) ──                  │
   │  refundOnFailure(input):                                     │
   │    refundForJob(appId,userId,jobId,'job failed') ──────────▶ transaction:
   │       consume_<jobId> exists && refund_<jobId> absent?       │
   │         → write refund_<jobId>, balance += consumed credits  │
   │         → return true (log credits.refunded)                 │
   │       else → false (no-op)                                   │
   │  markFailed(jobId, error, [files])   (trace.json kept)       │
   │  ◀── worker acks 200 (deterministic failure ⇒ don't re-run)  │
```

- The user is refunded exactly what `consumeCredits` took for that `jobId`;
  successful jobs are never refunded.
- Idempotent (`refund_<jobId>`) and a no-op when nothing was consumed (e.g. local
  runs where the credits gate is skipped).
- Per-agent failures are handled **inside** `runResearch` (degraded section, job
  still completes) and do **not** trigger a refund — only a job-level failure does.
