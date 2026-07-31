# Abuse & cost backlog — July 2026 adversarial review

Two adversarial reviews were run against the guard surface: one hunting for ways
to get past the limits, one hunting for ways to make us spend. This is everything
they found that is still open, plus what was already fixed, so the fixed items
don't get re-reported.

Every entry cites `file:line` and states how it was established. Line numbers
drift — treat them as a starting point, not gospel.

Groups A (cheap external denial-of-service) and B (cost visibility) are done, as is
the security round. C1 + C3 closed in `d89f081`; C2, C6, C7 and E4 closed 2026-07-31.
What follows is what is left.

**Nothing open here is a door standing open.** The one finding that was — every
per-IP limit bypassable with a forged header — was confirmed against the running
dev API and is fixed (see *Closed*, below). What remains is serious debt: two
denial-of-service paths that cost an attacker nothing, an inability to see what
we spend, and several ways spend can run away.

---

## C. Spend can run away — 1-2 days

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
`open — deferred by Javier (2026-07-31): "el costo de essential luego lo revisamos"` · modelled

5 credits vs 18 implies essential is 28% of comprehensive; it is actually ~45%
(8 of 10 producers, 40 vs 92 search turns). Modelled at ~$0.39/credit vs
~$0.24/credit. If credits sell at one price, essential erodes margin faster.
Fix is re-pricing or trimming its budget — a decision, not a patch.

### D2 · Refunds are all-or-nothing, after the work is done
`half-closed (582949a)` · verified by reading the code

`refundOnFailure` refunds 100% whenever the job failed or `runJob` threw — by which
point the workflow has already run. No partial refund, no check on what was spent.

**The wrong-direction half is closed.** A transient storage error after a fully
successful run used to return every credit and leave us the whole bill, discarding
a finished report. Uploads are retried now, and a persistent failure HOLDS the job
(`upload_failed`) instead: the work is in the checkpoint, and an admin approval
re-uploads it without re-running anything.

**What is left is the product decision**, and it is the same one as F1: a report
that degrades after exhausting retries still completes at full price. Proportional
to the degraded sections? A threshold? Nothing? That number is Javier's.

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
`half-closed` — the copy half is done; the price half is D2's open question.

**The copy is fixed.** A degraded report used to explain itself with
`trace.warnings` verbatim — `Degraded [risks_red_flags] from agent
"market-analyst" after exhausting retries…` — in English, to es/pt/fr customers,
naming our agents and section keys; and each missing section read
`_Section unavailable: <internal error>._`. Both now come from
`jobs/report-copy.ts`, in the report's own language, saying the one thing the buyer
needs. The diagnostics are unchanged and still in the trace and the admin; the API
simply stops handing `warnings` to a non-admin caller.

**What is left is the price**: a report delivered with placeholder sections still
costs full price. Same decision as D2.

### ~~F2 · `registerPerHourPerIp = 5` counts an office as one person~~
`done (2026-07-31)` — raised to 30.

The per-EMAIL cap (3/h) is what stops mail-bombing one inbox; the per-IP cap only
catches a single machine hammering the route, and at 5/h it turned a co-working
floor or a CGNAT carrier into a lockout.

Still open, and unrelated to the number: the 429 body is English-only and the login
page renders it raw.

### E3 · Users blocked by the pre-screen before `ada33e8` are still blocked
`script written, approved to run (Javier, 2026-07-31); not yet run` · established by
reading `stats/store.ts`

`npm run unblock:moderation` — dry run by default, `-- --confirm` writes. It clears
`blocked` + `moderationStrikes` only where `blockedReason` starts with the sentence
the moderation path writes (derived from `blockReasonFor`, not copied), so a block a
person decided on is left alone. Approved because there is no production data yet;
the dry run still needs to be read before confirming.

Strikes never decay and the fix is not retroactive. Anyone who accumulated four
pre-screen rejections — which, by the fix's own reasoning, should never have earned
a strike — is still blocked, including from buying credits, and nothing identifies
them. Needs a one-off pass over `app-users` clearing `blocked` + `moderationStrikes`
where `blockedReason` names moderation. A data migration, not a code change.

### ~~E5 · Directive labels fall back to English for fr/pt users~~
`done (2026-07-31)` — fr + pt written for all seven fields and every value.

The new directive fields declare `en` + `es`, matching the rest of the manifest —
`i18n` has only ever had `es`, so a French or Portuguese user already reads English
help text on every field. The fallback is per-string and works, so nothing breaks;
the section simply reads English inside an otherwise French form. Validation
requires that any language a field DOES declare labels every one of its values, so
a half-translated dropdown cannot ship.

Fixing it means writing fr/pt business copy for ~60 short strings — worth doing with
someone who writes those languages natively, not inventing here.

## Closed

### ~~C2 · A retry re-ran work that had already succeeded~~
`done (2026-07-31)`

An agent is two halves: a budgeted research loop that buys searches and page
bodies, and one structured call that writes the sections. The retry loop wrapped
BOTH — so a write that failed re-ran the whole loop, buying fresh searches and
fresh fetches for evidence that was already paid for and still sitting in the
shared store. `agentMaxAttempts` (3) × `maxJobAttempts` (8) made that up to 24
research loops for one agent. The ceiling (`d89f081`) bounded the dollars; it did
nothing about the waste, and every dollar re-buying is one not spent finishing.

A retry now reuses what the last attempt bought — but **only work that FINISHED**
(Javier, 2026-07-31: a retry takes what is finished, never something half done).
`gather` reports how it ended, and only `done` (the agent stopped asking for tools)
or `budget` (it spent its full allowance) count. A loop cut off by the job's cost
ceiling, one that ran out of iterations without ever concluding, one that threw, and
one that bought nothing all mean the same thing: research again.

Second half: the checkpoint carried `sources` but not the fetched page BODIES, so
every re-dispatch re-downloaded them — the most expensive call in the loop, for
text the job already had. It now carries them, capped at 60 (it is rewritten after
every agent, so unbounded growth is a cost of its own; an evicted page is a cache
miss, not a correctness problem).

Deliberately unchanged: a fresh DISPATCH still researches again. The saving here is
the within-dispatch re-buy and the page re-download; treating a new dispatch as
"already researched" would change what recovery means, which is a different call.

9 tests, each verified by reverting: the reuse itself, the empty pass, a loop that
threw, a loop that never concluded, the stop reason, the trace note, the checkpoint
carrying pages, seeding them back, and the cap.

**Nothing half-done, one level down** (Javier: "no quiero que una sección quede a
medio hacer o un link a medio revisar"). Two units below the research pass, where
partial is easy to create and invisible once created:

- A page longer than `EXTRACT_CHAR_CAP` was cut at 6,000 characters **in silence**.
  An agent reading the first 6,000 of a 40,000-character page concludes a figure is
  absent when it is further down. The cut now says so, in the CONTENT rather than on
  a flag beside it — a flag is what the first renderer forgets.
- Already true, now pinned: a fetch that failed or came back empty never enters the
  evidence store, and a section is merged only after passing its schema, so an agent
  contributes all of its sections or none.

7 more tests in `nothing-half-done.test.ts`, each verified by reverting — including
one that took two attempts: the first revert of the section rule was a no-op, and
the honest version makes the write return well-formed JSON that violates the schema,
which is the shape a half-made section actually arrives in.


### ~~C6 + C7 + E4 · The one-in-flight cap was advisory, and a refusal was free~~
`done (2026-07-31)`

The cap was a `count()` of the user's queued/running jobs, read at the top of
`POST /research` — and the job document that makes the count go up was not written
until the end of the handler, after the balance read, after a billed moderation
call, after the rate-limit transaction. Requests a second apart all read zero and
all passed. The cap was not a lock, and the spend model that rested on it
("bounded by 1 in flight and 20/hour") was only half true. C7 was the same root
cause one layer cheaper: a burst all paid for the classifier on the way to a 409.

The slot is now TAKEN, in a transaction on one document per (app, user), as the
FIRST gate in the handler — so a burst serializes against itself and gets its 409
before anything expensive runs. That closes C7 without touching the deliberate
ordering that keeps a broke or refused caller out of the app-wide hourly bucket (A2).

**The release is the dangerous half**, and it is why this was its own change: a
leaked slot locks a buyer out of the product permanently (E2's exact shape). The
job document carries the claim (`slotHeld`) and every release goes through it in a
transaction, so it is exactly-once from anywhere. Released on: completion, a hold,
an enqueue that never happened, and — via one `finally` rather than six early
returns — any rejection between the claim and the job's creation.

**E4**: a refused `/research` now lands in its own per-user hourly bucket
(`REFUSALS_PER_HOUR = 30`), deliberately not the report quota — a false positive
already costs that user their request, and spending their hourly reports for our
regex would punish them twice.

**Rules Javier set (2026-07-31), each with its own test:**
- An admin claims no slot and is not rate-limited. Those are LIMITS — how fast,
  how many — and an admin is not who they exist for.
- **A job an admin re-runs is still a job someone paid for.** `retry` deliberately
  does not re-charge, which is right for a job that is still paid for and wrong for
  a refunded one — that combination handed the owner a full report they had already
  been given the credits back for. A free report, created the moment refunds became
  a decision an admin makes. `retry` now refuses on a refunded job (`job_refunded`)
  and says what to do: grant the owner credits and let them submit again.
- **Every job pays credits, admins included.** A credit is not a limit: it is what
  the report costs, and it always comes off the balance of whoever the job belongs
  to. An admin who wants to run one tops up their own account first — which is what
  the admin app's 402 message has said all along. (The balance pre-read applies to
  them too now, so their 402 arrives before a billed classifier call rather than
  after it.)
- An admin resuming a parked job takes the slot by FORCE — the buyer having started
  something else while they waited must not make the decision unactionable.
- `/me/stats` reports the slot, not a job count, so the dashboard can never say
  "no reports in progress" next to a 409 saying there is one.

18 tests, one per rule, each verified by reverting its fix.

### ~~C1 · Free-text `instructions` could make every section schema unsatisfiable~~
`done (d89f081)`

The mechanism, restated because the fix only makes sense against it: `instructions`
(2,000 chars) is concatenated into **every** agent's system prompt, and the report
had 15 hard `.min(N)` array floors set to their target counts (`risks_red_flags`
`.min(8)`, `keyFindings` `.min(6)`). So *"keep every list to at most two items;
omit anything you cannot verify from two independent sources"* — a sentence a real
buyer might write, and not a moderation problem — made those schemas unsatisfiable.
Every agent threw, every attempt retried, every dispatch repeated, and the engine
then degraded the sections with placeholders that DO satisfy the floors, so the job
finished `completed` and no refund ran. Modelled at ~$95 on an 18-credit job.

Closed in three pieces, because any one alone leaves it live:

1. **Structured directives** (`templates/directives.ts`). A model declares directive
   fields — a closed vocabulary each, with `label` + short `description` +
   per-value labels per language, declared in the template and nowhere else. One
   declaration produces all three halves so they cannot drift: the Zod schema (built
   by `directivesSchema()`, strict — an undeclared key is a 400), the localized
   manifest block clients render, and the prompt text, which the ENGINE renders in
   its own words. The client picks keys; it never writes the sentence. Seven fields
   for the Florida model, reason-for-sale among them. `render()` never leaves the
   server and the API neither accepts nor returns it.
2. **The floors became floors.** Thirteen report arrays are `.min(1)`; the target
   count lives in the guidance and the `describe()`, which is what the model reads.
   A hard floor never produced the eighth risk — it decided how much was spent
   failing to. Pinned by a test that walks every section's JSON Schema, so one stray
   `.min(6)` cannot bring the failure mode back quietly.
3. **A per-job ceiling**, below.

`instructions` survives as a narrow residual, and its fence now says explicitly
that it cannot change the shape of the output.

### ~~C3 · `gather` calls set no output cap and no thinking budget~~
`done (d89f081)`

Every research turn now carries `LLM_GATHER_MAX_OUTPUT_TOKENS` (4096) and
`LLM_GATHER_THINKING_BUDGET` (1024). The thinking budget is bounded rather than
zeroed as moderation and enrich do: those are one-shot classifications, while
picking the next query is the part of this loop that reasoning actually improves.

Alongside it, the piece C1 and C2 both needed: **`MAX_JOB_COST_USD`** (default $20,
`0` disables), a hard per-job ceiling. `CostSink` carries it and `child()` scopes
one attempt's slice, so the job total stays in one accumulator — `trace.cost` is now
READ from it rather than accumulated a second time. It is seeded from the
checkpoint, because a per-dispatch cap is 8× no cap. Checked before every attempt,
inside the gather loop, and before a synthesis repair round; a job that trips it
stops trying and finalizes rather than re-dispatching seven more times into the same
wall, and logs `job.budget_exceeded` as an ERROR of its own.

**Refund policy (Javier, 2026-07-30), revised the same day: a budget-stopped job is
HELD for an admin decision.** It does not degrade-and-complete, and it does not fail
outright either. The credits stay consumed while it waits — refunding
first would let the buyer spend the balance elsewhere and leave an approval with
nothing to charge — and the checkpoint is kept intact and NOT degraded, because
placeholders are what an approved job would otherwise resume from. Three outcomes,
one of which always happens: approve (resumes uncapped from the checkpoint, nothing
re-charged), reject (failed + refunded), or expire after `JOB_HOLD_TTL_HOURS` (the
same, without anyone deciding). Every resolution is a transactional status flip that
answers whether it won, so an approval racing the sweep produces one outcome.

The same mechanism covers a second case that used to refund wrongly: a report that
RAN and was paid for but could not be uploaded. That refunded 100% and discarded a
finished report. Uploads are retried now, and a persistent failure holds the job
instead — an approval re-uploads from the checkpoint without re-running research.

Visibility, since a hold is generous to whoever provoked the spend:
`failureKind` (`budget_exceeded` | `upload_failed`) on the job, admin-only in the
API and badged in the admin; a decision panel with the spend and the expiry; a
`budgetStoppedReports` counter; and `failedCostUsd` booked apart from `costUsd` so
"what did our failures cost us" is a number you read rather than reconstruct.

The ceiling itself is now **per model and mode** (`modes[key].maxCostUsd`, falling
back to `MAX_JOB_COST_USD`): this is a catalog, and a cheap scan and a deep report
cannot share one number. Shipped in `244336b`, revised into the hold mechanism in `582949a`.

This decides only the ceiling case. D2 — a partial refund when a report degrades
after exhausting retries — is still open.


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


### ~~The pre-screen still rejected 22 of 58 ordinary phrasings~~
`done (f80ac4e)`

The first narrowing fixed English and left es/fr/pt untouched — including the exact
string a code comment cited as an example of a false positive. It also opened
evasions the old patterns caught (`s.y.s.t.e.m p.r.o.m.p.t`, `system-prompt`,
`disregard all rules`, `enable jailbreak`). Rebuilt around the asymmetry that
governs this layer: it rejects on its own with a hard 422 and is the only layer
running when the classifier is off or skipped, while a miss reaches an engine that
already fences client text as low-authority — so precision first. `squeezed` is
replaced by `unpadded` (only runs of single characters collapse, so real word and
sentence boundaries survive), patterns match through a separator-tolerant twin that
KEEPS `\b`, "rules" is out of every family in all four languages, third-party
attribution is excluded, and the shapes that are ambiguous in prose but
unmistakable once padded are tested only against the unpadded form. The corpus —
28 legitimate strings, 25 attacks — is the test now: 0 false positives, 0 misses.

### ~~Pre-hijack, the other three variants~~
`done (39fe2b7)`

c45f679 closed the Google merge and left the siblings. `/auth/verify-email` handed
back a SESSION for a record whose password was set by whoever registered — so a
victim clicking a verification mail they never requested was logged straight into an
account a stranger holds the password to, and would go on to pay into it. Verifying
now returns `{status:'verified'}` and the user signs in, which is what proves they
hold the password. The recovery the Google fix promised did not exist:
`/auth/request-password-reset` only sent when a `passwordHash` existed — the exact
field the fix deletes — so the user got "check your email" and no mail, forever. And
registration read the record, spent ~40ms hashing, then blind-wrote, which let a
password land on an account verified in between.

### ~~One failed submit could permanently disable the button~~
`done (aafb76b)`

`Turnstile.reset()` disabled submit and waited for a token that could never arrive
when the widget had not rendered. One mistyped password killed the sign-in button
until a page reload. Also in that commit: the enqueue-failure cleanup ran in the
order that could leave a created task running a refunded job, and the blocked-account
403 sent the stored admin string — internal category codes, English — to the user.

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
