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

### C6 · The one-in-flight job cap is advisory under a burst
`open (2026-07-30 review)` · established by reading the ordering; not reproduced,
because the in-memory Firestore mock does not model transaction contention

`index.ts` reads `inProgress` via plain `count()` aggregations before ANY write
that would make a job visible — the job document is created much later, after the
balance read, after the moderation call, after the rate-limit transaction. So N
concurrent (or even ~1s-apart) `POST /research` calls all read zero, all pass, and
all get distinct jobIds. The cap is not a lock.

This matters because C1's cost model rests on it: "bounded today only by
`MAX_CONCURRENT_JOBS_PER_USER = 1` and 20 reports/hour". Only the second bound is
real, and a job takes many minutes — so the documented worst case is reachable in
one burst rather than never. The credits are paid, so this is a spend-RATE bypass,
not theft.

Fix: claim the slot inside the transaction that already serializes the handler
(`checkRateLimits`), and release it on every terminal path — completion, failure,
and the enqueue failure now handled in E2. That release requirement is why it is
its own change and not a rider on a fix pass.

### C7 · The moderation classifier runs past the hourly cap under the same burst
`open (2026-07-30 review)` · established by reading the ordering

Same root cause as C6, cheaper consequence. The peek before the classifier is
explicitly non-atomic, so a burst that arrives while the counter reads 0 all pass
it, all pay for a billed `flash` call, and only then does the authoritative check
admit 20 and refuse the rest. Cents per burst, repeatable hourly per account.
Fixed as a by-product of C6: reserve before the model call, not after.

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

### ~~E1 · Admin user search by email is dead code~~
`NOT A BUG (ada33e8)` — the finding was wrong, three times over

Reported as `>= X AND < X`, an empty range that would make `GET /admin/users?q=…`
always return nothing. It is actually `>= X AND < X\uf8ff`: the upper bound carries
a private-use sentinel that renders as NOTHING in a terminal, so every reader —
including this document — saw an empty range that was never there. Pinned now by a
test, so the next reader gets an answer from the suite instead of from squinting.

### ~~E2 · A failed enqueue strands the account and the credits~~
`done (ada33e8)`

When `enqueueJob` threw, the job was already created and the credits already
consumed, and the 202 response told the SPA it had succeeded. Nothing could ever
clean it up: the worker is what refunds and fails a job, and the worker is exactly
what could not be reached. The job sat `queued` forever, counting against the
one-in-flight cap, so the user kept their spent credits AND was permanently 409'd
out of generating anything. Now refunded and marked failed inline, with a 503 that
says the credits were not spent.

---

## F. Where the guards still cost a legitimate user something
`open (2026-07-30 review)` — the blocking half of these was fixed in ada33e8; what
follows is what remains, and each one is a judgement call rather than a defect.

### F1 · A degraded report costs full price, and explains itself in developer English
The system is designed to degrade sections after exhausting retries, and a degraded
job finalizes as `completed` — so no refund path runs, and the buyer pays 18 credits
for a dossier with placeholder sections. The only explanation they get is
`trace.warnings`, rendered verbatim: `Degraded [risks_red_flags] from agent
"market-analyst" after exhausting retries…`, in English, to es/pt/fr customers.
Two decisions: a partial-refund policy, and localized copy for the user-facing
summary (keep the raw warnings admin-side).

### F2 · `registerPerHourPerIp = 5` counts an office, a co-working space or a
CGNAT carrier as one person
The per-email cap (3/h) is what stops mail-bombing one inbox; the per-IP cap mostly
catches shared egress. It is an env var, so raising it is a config change, not code.
Related: the 429 body is English-only and the login page renders it raw.

## Closed

### ~~B1 · Failed agent attempts discarded their cost~~
`done (8575b96, completed in 335a5e4, hardened in f873ade)`

Saving on every attempt widened a race that was already there: checkpoint writes
are last-writer-wins and a wave finishes several agents at once, so two overlapping
saves could land in the wrong order and the older snapshot would win — dropping a
finished agent, which the next dispatch then re-runs and pays for twice. Writes are
now serialized and coalesced. Two more from the same review: the retry backoff
happened *before* the attempt's spend was booked, so a sibling checkpointing during
the sleep persisted a total missing it (the backoff now runs after the charge); and
a resumed agent's replaced trace row dropped the prior dispatch's spend, leaving
`trace.cost` bigger than the sum of its agents with the difference attributed to
nobody. `synthesizeStructured` was also still returning a `cost` no caller read —
the second accumulator this whole item exists to remove, now gone from the type
rather than warned about in a comment.

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
`done (8575b96, corrected in 335a5e4, tested in f873ade)`

The first pass priced per PROVIDER, which made one case worse: `extractPages` is
Tavily-only, so with a Brave key set every genuinely-billed extraction was booked
at Brave's rate. Pricing is now per OPERATION. `BRAVE_COST_PER_CALL_USD` also
never reached Cloud Run — `deploy.sh` didn't pass it, so B2 was inert in
production — and an empty value would have parsed as 0, silently zeroing the
search cost.

Originally the price was chosen in `gather` (Tavily key present?) while the
provider was chosen in `web-search` (Brave first), so a Brave key meant Brave
served the traffic and the accounting charged nothing.

Both decisions now live in `searchCostPerCall(operation)`: a search is priced by
whichever backend `searchWeb` would pick (Brave → Tavily → free DuckDuckGo, with
`BRAVE_COST_PER_CALL_USD` for a paid tier), an extraction always at Tavily's rate,
and neither at all when the call cannot reach a backend — no Tavily key, or an
empty url. `canExtractPages()` is what tells `gather` the difference, so
`searchCalls` stays what it claims to be: calls that actually hit a backend.

The pricing function got a test; its call site did not, and that is where the money
moves. Every engine test replaces `web-search.js` wholesale with a stub returning 0,
none of them ever issues `fetch_page`, and the fake-web fixture had already drifted —
its `searchCostPerCall` still took no `operation`. So the entire paid extract branch
ran in zero tests. `gather-pricing.test.ts` now drives it with two distinct nonzero
rates (each assertion verified by reverting the line it guards), and a contract test
fails when the fixture's signatures drift from the module it stands in for.

### ~~B3 · Pre-flight token usage never reached an aggregate~~
`done (8575b96, corrected in 335a5e4, given a reader in f873ade)`

The first pass computed usage AFTER the JSON parse, inside a fail-open catch —
reproducing, in the two files it touched, the exact "cost lost on a throw" bug it
was fixing. A billed call whose answer was unusable was booked at zero, and those
are the calls worth seeing.

The assisted pass captured usage and logged it; moderation captured none at all.
Both now report tokens and dollars, and the API books them through
`recordRequestLlmCost` into app-stats, the daily buckets and the per-user record —
separately from job cost, so "what we spend before deciding to do any work" stays
a distinct number.

Written but unread, until the follow-up review: nothing consumed `requestLlmUsd`, so
the admin dashboard's Cost KPI understated spend by exactly what this item made
visible. It now shows job + request-path spend, broken out in the hint (with a
sub-cent formatter, since `$0.00` is what per-call amounts round to). Both fail-soft
paths also log only the parser's complaint; they now log the output-token count and
a snippet, which is what distinguishes a truncated verdict from a model ignoring the
schema.


### ~~Pre-hijack: an unverified password survived the victim's Google sign-in~~
`done (c45f679)` — account takeover, reproduced end-to-end before fixing

`/auth/register` creates a credential for any address and proves nothing;
`upsertGoogleUser` then merged `emailVerified: true` onto it without touching
`passwordHash`. The password gate asks for exactly those two fields, so whoever
registered an address FIRST held a working password for it the moment the real
owner signed in with Google — their reports, their purchased credits. Sprayable
across a list of addresses, and it reached admin role too (blocked only by the
admin app record lacking `emailFrom`, which is an accident, not a control).

Observed: register 202 → attacker login 403 `email_unverified` → victim's Google
login 200 → attacker login 200.

Google proves the ADDRESS; it does not vouch for a password stapled to it. An
unverified credential is now discarded rather than inherited; a verified one is
kept, because that is how a legitimate dual-provider user works. The existing test
asserted `['google','password']` for exactly this case — the vulnerability written
down as an expectation.

### ~~`/auth/register` handed Postmark a caller-chosen recipient LIST~~
`done (c45f679)`

`normalizeEmail` splits on the last `@`, so a comma-separated string passed through
intact. Observed: `To: "a@evil.com,v1@victim.com,v2@victim.com"`. That mail-bombs
third parties from the verified `floridabizlabs.com` sender AND slips A3's
per-inbox cap, because the counter keys on the whole string so every permutation is
a fresh bucket. Sender reputation is the one thing here that cannot be rolled back.
Now one-address-only on register, reset and contact's Reply-To, plus a last check
inside `sendAppEmail` itself.

### ~~The pre-screen blocked paying customers, permanently~~
`done (ada33e8)`

Verified by running the real function: "a jailbreak themed room", "offices near the
county jail. Breakdown of revenue", "the owner will not do anything now", "the
startup ecosystem prompted growth", "disregard the rules of thumb" were all
`prompt_injection`. Causes: the squeezed form has no word boundaries by
construction (it strips every separator, including the ones between real words), so
"countyjailBREAKdown" matched; and several patterns were too loose — a missing `\b`
made "ecoSYSTEM PROMPTed" match, and bare "jailbreak" is an escape-room theme in a
product that researches escape rooms.

The punishment was worse than the rejection. Every rejection recorded a strike,
from the preview route too, and the SPA routes every generation through preview —
one click, one strike. Four across the LIFETIME of an account (they never decay)
meant a permanent block that also stops the user BUYING CREDITS, explained in an
English string the code labels "admin-facing". Strikes exist to stop repeated
BILLED classifier calls; the pre-screen makes none and costs nothing to refuse, so
only the classifier's verdicts earn one now.

### ~~Turnstile failures were reported as "your account is blocked"~~
`done (ada33e8)`

Tokens are single-use and expire in minutes, and the widget deliberately lets the
form through when its script is blocked — so a captcha 403 is an expected outcome
for an ordinary user on a slow form or a second tab. It landed on the block branch
in generation and on the "verify your email" branch in login (complete with a
resend button that mails another verification for an unrelated problem), in the
wrong language. Both now match `captcha_failed` first, with localized copy.

The "generate anyway" fallback could never work either: `submit()` ran inside the
catch while the token reset sat in the `finally`, which runs after — so it always
replayed a token siteverify had already consumed, and landed on that same false
"blocked" message. Same shape as the backoff bug in f873ade.

### ~~`/research/preflight` skipped the `allowedTemplates` check~~
`done (c45f679)` — the one route missing the guard `/research` and
`GET /templates/:id` both apply, so a preview returned a disallowed model's plan,
its issue vocabulary, and an assisted pass against it.

### ~~A1 · The Stripe catalog was an unmetered amplifier~~
`done (ebda3cc, completed in 6776b63)`

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
`done (24e87e5, corrected in c39f806)`

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
