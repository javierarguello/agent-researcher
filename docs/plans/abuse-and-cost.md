# Abuse & cost backlog — July 2026 adversarial review

Two adversarial reviews were run against the guard surface: one hunting for ways
to get past the limits, one hunting for ways to make us spend. This is everything
they found that is still open, plus what was already fixed, so the fixed items
don't get re-reported.

Every entry cites `file:line` and states how it was established. Line numbers
drift — treat them as a starting point, not gospel.

Group A (cheap external denial-of-service) is done; what follows is B onward.

**Nothing open here is a door standing open.** The one finding that was — every
per-IP limit bypassable with a forged header — was confirmed against the running
dev API and is fixed (see *Closed*, below). What remains is serious debt: two
denial-of-service paths that cost an attacker nothing, an inability to see what
we spend, and several ways spend can run away.

---

## B. We cannot see what we spend — half a day, and it gates everything in C

### B1 · Failed agent attempts discard their cost
`open` · verified by reading the code

`research-engine.ts:291` adds cost to the trace **inside the `try`**. The `catch`
records the failure and drops the tokens (`:294-305`). Since an agent retries
`agentMaxAttempts` (3) times and a job re-dispatches up to `maxJobAttempts` (8),
a persistently-failing agent runs up to **24 full gather+synthesis passes** whose
cost is invisible.

Consequence beyond the money: `job.cost`, the admin dashboard and
`recordReportStats` (`run-job.ts:204-208`) show ≈$0 for the most expensive jobs in
the system. **Every cost number we have today is wrong**, which is why this comes
before anything in C — without it we cannot tell whether a fix helped.

Same class, smaller: a throw inside `gather` discards the whole loop's
accumulated cost (only returned at `gather.ts:217`); `synthesizeStructured`
attempt 1 is lost when attempt 2 throws (`synthesize.ts:50,61`); the headline call
is lost when it throws (`run-job.ts:73`).

### B2 · Brave searches are recorded as $0
`open` · verified by reading the code

`gather.ts:215` charges `costPerCallUsd` only `if (config.search.tavilyApiKey)`,
but `searchWeb` prefers Brave when `BRAVE_API_KEY` is set (`web-search.ts:16`) and
`infra/deploy.sh:49` passes it through. On a paid Brave tier, ~92 queries per
comprehensive job are billed by Brave and booked at zero.

### B3 · Pre-flight token usage never reaches an aggregate
`open` · verified by reading the code

`enrich.ts:136` captures usage, `apps/api/src/index.ts:951` puts it in a log line
and drops it. Moderation (`moderate.ts:112-127`) captures no usage at all. Both
are on the request path, on every preview and every generation.

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

### ~~A1 · `/plans` was an unauthenticated, unmetered Stripe amplifier~~
`done (ebda3cc)`

The cache could not help: empty results were deliberately not stored and an
unknown `appId` always produces one, so a fresh appId per request was a
guaranteed miss and a live Stripe call. Unknown and malformed appIds are now
refused before Stripe is touched, empty results get a short TTL instead of none,
and the route has a per-IP limit. `appId` is validated against the slug shape it
actually is rather than escaped, before reaching Stripe's search DSL.
`/credits/checkout` (two Stripe calls, no limit) got a per-user one.

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
