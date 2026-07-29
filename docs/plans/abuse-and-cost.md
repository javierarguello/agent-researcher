# Abuse & cost backlog — July 2026 adversarial review

Two adversarial reviews were run against the guard surface: one hunting for ways
to get past the limits, one hunting for ways to make us spend. This is everything
they found that is still open, plus what was already fixed, so the fixed items
don't get re-reported.

Every entry cites `file:line` and states how it was established. Line numbers
drift — treat them as a starting point, not gospel.

Groups A (cheap external denial-of-service) and B (cost visibility) are done;
what follows is C onward.

**Nothing open here is a door standing open.** The one finding that was — every
per-IP limit bypassable with a forged header — was confirmed against the running
dev API and is fixed (see *Closed*, below). What remains is serious debt: two
denial-of-service paths that cost an attacker nothing, an inability to see what
we spend, and several ways spend can run away.

---

## C. Spend can run away — 1-2 days

### C1 · Free-text `instructions` can make every section schema unsatisfiable
`open` · mechanism verified by reading the code; dollar figure is modelled, not measured

`instructions` (2,000 chars, `florida-business-for-sale.ts:29`) is concatenated
into the system prompt of **every** agent (`prompt.ts:51-66`). The template has 15
hard `.min(N)` array constraints — `risks_red_flags` `.min(8)`, `keyFindings`
`.min(6)`, `due_diligence_checklist` `.min(5)`.

An instruction that reads as a legitimate scoping request — *"keep every list to
at most two items; omit anything you cannot verify from two independent
sources"* — makes those schemas unsatisfiable. Every agent throws, every attempt
retries, every dispatch repeats. Then `research-engine.ts:343-350` degrades the
sections with placeholders that **do** satisfy the schema (`emptyFromJsonSchema`
honours `minItems`, `:613`), so the job finishes `completed` → **no refund**, with
`job.cost` ≈ $0.

Estimated ~$95 on an 18-credit job. Bounded today only by
`MAX_CONCURRENT_JOBS_PER_USER = 1` (`index.ts:658`) and 20 reports/hour.

Note this is **not** covered by the moderation or pre-flight layers: those guard
against injected *content*, and this is a semantically legitimate instruction that
breaks the *output schema*. Different problem, different fix.

### C2 · 24× retry amplification, and a retry re-runs work that succeeded
`open` · verified by reading the code

`agentMaxAttempts` (3) × `maxJobAttempts` (8) = 24 passes per agent, and each
retry re-runs the agent's **entire `gather` loop with a fresh budget**
(`research-engine.ts:283-306`) even when only the synthesis failed. Nothing
bounds total spend: a grep for `MAX_COST|costCap|budgetUsd|maxUsd|costLimit`
across `packages/core/src` and `apps/*/src` returns nothing.

### C3 · `gather` calls set no output cap and no thinking budget
`open` · verified by reading the code

`gather.ts:106-112` passes neither `maxOutputTokens` nor `thinkingBudget`, so each
of up to `2B+6` turns per agent can emit up to the model default, and thinking
tokens bill as output (`gemini-vertex.ts:90`). Moderation and enrich correctly set
`thinkingBudget: 0`; gather and synthesis do not.

### C4 · Two unbounded context growers
`open` · verified by reading the code

`gather.ts` never trims `messages`, so every search result and every 6,000-char
page stays in context for all later turns — input cost is **quadratic in the
budget**. `prompt.ts:97-103` `JSON.stringify`s all upstream sections with no size
cap, and `exec-summary-writer` depends on 12 agents.

(The evidence dossier itself *is* capped — `MAX_SNIPPETS = 48`, `MAX_PAGES = 14`,
`EXTRACT_CHAR_CAP = 6000`. That part is fine.)

### C5 · The 30-minute dispatch deadline is shorter than a real job
`open` · reasoned from config, not measured

Worker timeout 1800s (`infra/deploy.sh:62`), `dispatchDeadlineSeconds` 1800
(`config.ts:271`), agent concurrency 2. Wave 1 of the Florida model is 5 agents /
56 search turns. When Cloud Run kills the request, in-flight agents' spend is lost
**twice**: never added to `trace.cost`, and re-run from zero next dispatch.

Adjacent: a failed checkpoint upload only warns (`run-job.ts:119`), and an
unreadable checkpoint only warns and leaves `resume` undefined (`:86-88`) — a
corrupted checkpoint silently replays the entire job up to 8 times.

---

## D. Numbers someone has to choose — product decisions, not bugs

### D1 · `essential` costs ~60% more per credit than `comprehensive`
`open` · modelled

5 credits vs 18 implies essential is 28% of comprehensive; it is actually ~45%
(8 of 10 producers, 40 vs 92 search turns). Modelled at ~$0.39/credit vs
~$0.24/credit. If credits sell at one price, essential erodes margin faster.
Fix is re-pricing or trimming its budget — a decision, not a patch.

### D2 · Refunds are all-or-nothing, after the work is done
`open` · verified by reading the code

`refundOnFailure` (`run-job.ts:238-245`) refunds 100% whenever the job failed or
`runJob` threw — by which point the workflow has already run. The outer `catch`
covers `uploadJson('report.json')` at `:165`, so a transient GCS error after a
fully successful run returns every credit and we eat the entire cost. No partial
refund, no check on what was spent.

---

## E. Operational — small, and one of them hurts during an incident

### E1 · Admin user search by email is dead code
`open` · verified by reading the code

`packages/core/src/stats/store.ts:587`:
`q.where('userId','>=',prefix).where('userId','<',`${prefix}`)` — `>= X AND < X`
is an empty range, so `GET /admin/users?q=<email>` **always returns nothing**. The
upper bound needs `` `${prefix}` ``.

Why it matters more than it looks: when someone is abusing the system, this is how
you find them, and `POST /admin/users/block` needs an exact `userId` the UI can no
longer surface.

### E2 · A failed enqueue strands the account and the credits
`open` · verified by reading the code

`index.ts:825-836`: when `enqueueJob` throws, the job is already created and the
credits already consumed, and the response tells the user to retry. Retrying mints
a new jobId and consumes credits **again**, while the orphaned job sits `queued`
forever — counting toward `inProgress` and permanently 409-ing the user out of
generating anything. No reaper, and the refund path lives in the worker, which
never runs for that job.

---

## Closed

### ~~B1 · Failed agent attempts discarded their cost~~
`done (8575b96, completed in 04522f8)`

The first pass fixed it within a dispatch and left it broken across dispatches:
the checkpoint is the only carrier of cost between dispatches and was written
only after an agent SUCCEEDED, so a dispatch where the failing agent burned its
retries and nothing else finished saved nothing — the next dispatch resumed from
a stale total and `setJobCost` overwrote the real one. The recorded cost went
DOWN as the job spent more, hiding roughly 18 of the 24 passes. The checkpoint is
now saved after every attempt outcome. The headline call, the one paid call site
outside the engine, was also still unconverted and now takes the sink.

Cost was added to the trace inside the `try`, so the `catch` dropped it. With up
to 24 passes per agent (3 in-run retries × 8 dispatches), the most expensive jobs
in the system — the ones that retried and degraded — reported ≈$0.

Fixed by recording spend where it is incurred rather than where it is returned: a
`CostSink` is passed into `gather` and `synthesizeStructured`, every paid call
writes to it immediately, and the engine reads it on BOTH the success and the
failure path. `gather` also charges each search turn as it is spent instead of
totalling at the end, so a throw mid-loop can no longer erase the turns already
paid for. Covered by a test that fails with `expected 0 to be greater than 0` if
the failure-path accounting is removed.

### ~~B2 · Brave searches were recorded as $0~~
`done (8575b96, corrected in 04522f8)`

The first pass priced per PROVIDER, which made one case worse: `extractPages` is
Tavily-only, so with a Brave key set every genuinely-billed extraction was booked
at Brave's rate. Pricing is now per OPERATION. `BRAVE_COST_PER_CALL_USD` also
never reached Cloud Run — `deploy.sh` didn't pass it, so B2 was inert in
production — and an empty value would have parsed as 0, silently zeroing the
search cost.

The price was chosen in `gather` (Tavily key present?) while the provider was
chosen in `web-search` (Brave first). A Brave key meant Brave served the traffic
and the accounting charged nothing. Both decisions now live in one place,
`searchCostPerCall()`, derived from the same priority `searchWeb` uses, with
`BRAVE_COST_PER_CALL_USD` for a paid tier.

### ~~B3 · Pre-flight token usage never reached an aggregate~~
`done (8575b96, corrected in 04522f8)`

The first pass computed usage AFTER the JSON parse, inside a fail-open catch —
reproducing, in the two files it touched, the exact "cost lost on a throw" bug it
was fixing. A billed call whose answer was unusable was booked at zero, and those
are the calls worth seeing.

The assisted pass captured usage and logged it; moderation captured none at all.
Both now report tokens and dollars, and the API books them through
`recordRequestLlmCost` into app-stats, the daily buckets and the per-user record —
separately from job cost, so "what we spend before deciding to do any work" stays
a distinct number.


### ~~A1 · The Stripe catalog was an unmetered amplifier~~
`done (ebda3cc, completed in 7fe9211)`

The first pass metered `/plans` and left `/credits/plans` — the route the product
UI actually calls, uncached, unmetered, and hit on every mount and window focus
because its React Query hook had no `staleTime`. The meter went on the public
door while the busier one stayed open.

Now: the landing doesn't call the API at all. The catalog is fetched from Stripe
at build time (`apps/fbizlab/scripts/fetch-plans.mjs`) and baked into
`dist/plans.json`, re-baked by a daily schedule per environment — dev's build
reads the dev API and therefore dev/sandbox Stripe. The authenticated route is
cached on the same key as the public one and metered **per user**, so a heavy
client slows only itself. `/plans` also got its own burst window, so a busy
read-only route can no longer exhaust the shared one and 429 sign-in for everyone
behind a NAT.

The scheduled prod run builds the released ref, not the default branch, and skips
itself cleanly until that ref exists — a nightly cron on `main` would otherwise
ship unreleased code to production every night.

<details><summary>Original entry</summary>

The cache could not help: empty results were deliberately not stored and an
unknown `appId` always produces one, so a fresh appId per request was a
guaranteed miss and a live Stripe call. Unknown and malformed appIds are now
refused before Stripe is touched, empty results get a short TTL instead of none,
and the route has a per-IP limit. `appId` is validated against the slug shape it
actually is rather than escaped, before reaching Stripe's search DSL.
`/credits/checkout` (two Stripe calls, no limit) got a per-user one.
</details>

### ~~A2 · The app-wide hourly counter was spent before the caller paid~~
`done (24e87e5, corrected in 1630bdb)`

`checkRateLimits` check-and-increments, and it ran before moderation and credits —
so a request that died later still spent a slot in the bucket every customer of
that app draws from.

The first attempt split it into a read-only peek plus a later increment, and that
was wrong in a way worth recording: **the transaction was doing two jobs.** It
counted, and — because contended Firestore transactions on the same document
serialize — it was also the only thing serializing the handler. Replacing it with
a plain read removed that, so a simultaneous burst all read "0 used" and all
passed, turning both this cap and the per-user concurrency cap into advisory ones.
The commit message claimed the overshoot was "bounded by in-flight requests"; in
fact the attacker chooses how many are in flight.

The corrected shape keeps the atomic check and moves it *later* — after the
balance read and after moderation — so the requests that used to spend the shared
bucket for free never reach it, while the serialization is intact. The peek stays
in front as a cheap early rejection that writes nothing, so an over-limit caller
doesn't pay for a moderation call on the way to a 429.

Residual, accepted: a request that passes the check and then loses a race at
`consumeCredits` spends a slot. That costs the caller credits they actually had,
so it is not a lever.

### ~~A3 · `/auth/register` had no per-target-email cap~~
`done (ebda3cc)`

Capped per target inbox as well as per IP, on the normalized address so dots and
+tags cannot split the bucket.


### ~~Every per-IP limit was bypassable with a forged `X-Forwarded-For`~~
`done (0d4bb99)` · confirmed exploitable against the running dev API, then
confirmed fixed the same way

`TRUSTED_PROXY_HOPS` defaulted to 1 (the load-balancer shape) while the API is
reached directly on `*.run.app`, so the index landed on a caller-written entry.
Measured before: 35 requests with a rotating header drew 0 rejections, 35 from the
real IP hit the cap at exactly 30. Measured after: 40 rotating requests, 40
rejections. The unit test had encoded the assumption instead of checking it; it
now pins both topologies, and it caught a second fail-open (a chain shorter than
the expected hops was clamped to index 0, handing the key to the caller).

### ~~`verify-email` / `reset-password` tokens worked as full sessions~~
`done (0d4bb99)`

`jwtAuth` only ever restricted `report-read`, so a 24h verification link was 24h
of unrestricted API access. Any scope the hook doesn't explicitly handle is now
refused.

### ~~Google sign-in ignored `email_verified`~~
`done (0d4bb99)`

`verifyGoogleIdToken` computed it and the route dropped it — an id_token naming an
unverified address minted a session for it and stamped the victim's record
verified. Now refused before anything is written. The Google identity is also
normalized like the password one, closing the block-evasion-by-login-button hole.

---

## Checked and found sound

Recorded so the next review doesn't re-litigate them:

- `checkRateLimits` atomicity — read-all / compare-all / write-all in one
  Firestore transaction; `>=` is the right comparison.
- The assisted-review allowance — refused attempts write nothing, so retrying an
  exhausted draft is free and cannot advance the per-user backstop. Rotating
  `draftId` buys 2 assists per id but every allowed claim increments the backstop.
- The credit ledger — idempotent by deterministic id, no double-spend, no
  double-refund, no negative balance.
- Cost knobs are not user-reachable: `depth` comes from `mode.config`, and mode
  config overrides user params, so `essential` cannot be steered into
  `comprehensive` budgets.
- The search budget is decremented on every path including errors; a model that
  refuses to stop is capped at `2B+6` iterations.
- No LLM or paid-search call is reachable unauthenticated.
- PDF rendering is deduped by Cloud Tasks task name; polling cannot fan out.
