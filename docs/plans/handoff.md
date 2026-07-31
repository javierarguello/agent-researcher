# Handoff — where this work stands and what to do next

Written 2026-07-30, last updated at commit `d89f081`. For whoever picks this up without the
conversation that produced it. Read `docs/plans/abuse-and-cost.md` alongside this:
that file is the backlog (findings, open and closed, with `file:line`); this one is
the plan and the working agreements.

---

## 1. What the last few days were

Three rounds of adversarial review against the abuse/cost surface, each followed by
a fix pass. Groups A (cheap external denial-of-service) and B (cost visibility) are
closed, as is the security round. C1 and C3 — the runaway-spend pair — closed in
`d89f081`. What remains is the rest of group C, plus a handful of product decisions
and two operational chores.

Commits, newest first:

| commit | what |
|---|---|
| `d89f081` | C1 + C3: structured directives, `.min(1)` floors, per-job cost ceiling |
| `5ef93cb` | this handoff |
| `4227354` | backlog: third review round recorded |
| `aafb76b` | dead submit button, English-only errors, enqueue cleanup order |
| `39fe2b7` | pre-hijack: the verification-link variant, the missing recovery path, a registration race |
| `f80ac4e` | pre-screen rebuilt around precision, with a 53-string corpus as the test |
| `c45f679` | pre-hijack via Google merge, recipient-list mail-bomb, preview model guard |
| `ada33e8` | pre-screen strikes, captcha copy, stranded jobs |
| `f873ade` | one cost accumulator, ordered checkpoints, tests that bite |

Suites: **288 tests**, all green (`npm test` from the root runs core + api).
`npm run typecheck` is clean, `npm run templates:check` passes, and the fbizlab SPA
builds.

---

## 2. Done since: C1 + C3 (`d89f081`)

Closed, and worth reading before touching the template or the engine — the shape of
the fix is a constraint on what comes next.

**Structured directives.** A model declares directive fields in the template
(`packages/core/src/templates/directives.ts` is the mechanism; the Florida set is in
the template). One declaration produces three things so they cannot drift: the Zod
schema (strict — an undeclared key is a 400), the localized manifest block clients
render, and the prompt text the ENGINE writes in its own words. A client picks keys;
it never writes the sentence. Seven fields, reason-for-sale among them. Load-time
validation rejects a declaration `paramsSchema` does not accept, and any language
that labels a field but not all of its values.

The rule to keep: **a directive says what to weigh, never how much to return.** If a
proposed field would express a quantity, it is not a directive. That is written into
`docs/extending.md` too.

**The `.min(N)` floors are `.min(1)`.** The target count lives in the guidance and
the `describe()`. A test walks every section's JSON Schema so one stray `.min(6)`
cannot quietly restore the failure mode.

**`MAX_JOB_COST_USD`** (default $20). The sink carries the ceiling; `child()` scopes
one attempt so the job total stays in one accumulator, and `trace.cost` is now READ
from it rather than summed a second time. Seeded from the checkpoint — a
per-dispatch cap is 8× no cap. A job that trips it finalizes instead of
re-dispatching into the same wall.

**Refunds are manual. All of them (Javier, 2026-07-31).** A job that cannot finish
— cost ceiling, unstorable report, or a run that could not be assembled — goes to
the alert state (`held`): credits still consumed, checkpoint kept, report stats NOT
booked. An admin then has four moves and the job moves no other way: continue
(uncapped, from the checkpoint), refund & close, close without refund, or top the
buyer up via `/admin/credits/grant`.

There is **no expiry and no sweep** — an expiry that refunds is the automatic
refund this decision removes. A hold waits indefinitely, which makes
`GET /admin/jobs?status=held` the queue rather than a report. One exception,
upstream: an enqueue failure still refunds inline, because nothing ran.

**The ceiling is per model and mode** (`modes[key].maxCostUsd` → `MAX_JOB_COST_USD`).
This is a catalog; one global number is a safety net for one model and a wall for
another. `MAX_JOB_COST_USD` still defaults to $20, picked without a measured
per-job figure — the one number here still resting on a guess. `budgetStoppedReports`
rising means the ceiling is too low, not that anyone is abusing it.

**The SPA renders the directives** (`apps/fbizlab/src/pages/NewReport.tsx`, section
04) entirely from the manifest — no field names, no option labels, no translations
in the client. A new field or a new language needs no front-end deploy.

Still open from group C, in order:

- **C2's real multiplier** — a retry re-runs the agent's ENTIRE `gather` loop with a
  fresh budget even when only the synthesis failed. The ceiling bounds the damage
  now; the waste is still there. Cache the evidence for the retry and re-run only
  synthesis.
- **C4** — `gather` never trims `messages`, so input cost is quadratic in the
  budget; `prompt.ts` `JSON.stringify`s all upstream sections with no size cap.
- **C5** — the 30-minute dispatch deadline is shorter than a real job.

## 3. Do this next

C6 + C7 + E4 are **closed** (2026-07-31): the one-in-flight cap is a claim taken in
a transaction as the first gate in the handler, released through the job document
on every terminal path. What is left, in order:

- **C2's real multiplier** — a retry re-runs the agent's ENTIRE `gather` loop with
  a fresh budget even when only the synthesis failed. The ceiling bounds the damage;
  the waste is still there. Cache the evidence for the retry and re-run only synthesis.
- **C4** — `gather` never trims `messages`, so input cost is quadratic in the
  budget; `prompt.ts` `JSON.stringify`s all upstream sections with no size cap.
- **C5** — the 30-minute dispatch deadline is shorter than a real job, and a
  corrupted checkpoint silently replays the whole job up to 8 times while only
  warning.

Rules that now constrain this area, each with a test in
`apps/api/test/job-slots.test.ts`:
- An admin claims no slot and is not rate-limited — those are limits.
- Every job pays credits, admins included: a credit is what the report costs, and
  it comes off the balance of whoever the job belongs to. An admin tops up first.
- An admin resuming a parked job takes the slot by FORCE.
- Every path that ends without a running job releases the slot — a leak locks the
  buyer out permanently, which is E2's exact shape.

## 4. Owner decisions, not bugs

These need a person, not a patch. Do not "fix" them unilaterally.

- **D1** — `essential` costs ~60% more per credit than `comprehensive` (5 credits
  vs 18 implies 28%; it is really ~45%). Re-price, or trim its budget.
- **D2 / F1** — a degraded report costs full price. The system is *designed* to
  degrade after exhausting retries, and a degraded job finalizes `completed`, so no
  refund path runs. Also, the only explanation the buyer gets is `trace.warnings`
  rendered verbatim: `Degraded [risks_red_flags] from agent "market-analyst"…`, in
  English, to es/pt/fr customers. Two decisions: partial-refund policy, and
  localized user-facing copy (keep the raw warnings admin-side).
- **F2** — `registerPerHourPerIp = 5` counts an office, a co-working space or a
  CGNAT carrier as one person. It is an env var. The per-email cap (3/h) is what
  actually stops mail-bombing one inbox.

## 5. Operational chore — needs production data, ask first

**E3.** Users blocked by the pre-screen *before* `ada33e8` are still blocked.
Strikes never decay and the fix is not retroactive, so anyone who accumulated four
rejections that — by the fix's own reasoning — should never have earned a strike is
still locked out, including from buying credits. Needs a one-off pass over
`app-users` clearing `blocked` + `moderationStrikes` where `blockedReason` names
moderation. Write it with a dry-run and get explicit approval before running it.

---

## 6. How to work in this repo

### Running things
- `npm test` from the root — core + api, fully mocked, no network, no Docker.
- `npm run typecheck` — all workspaces. **Tests are not typechecked** (`tsconfig`
  includes `src/**` only), which is why mock drift is caught by a runtime contract
  test in `packages/core/test/search-pricing.test.ts` instead of by the compiler.
- `TEST_LLM=ollama npm test` — the same suites against a local model
  (`docker-compose.local.yml`; `LOCAL_LLM_MODEL` picks the model). Live tests assert
  invariants, not exact answers. `TEST_MODERATION_LLM=1` additionally turns the
  classifier on there.
- All internet-touching tools are mocked with a corpus rich enough to build a real
  report: `packages/core/test/fixtures/fake-web.ts`.

### Non-negotiable: verify every test by reverting the fix
This was learned the hard way — **four separate times** a test in this repo passed
against the code it was supposed to be guarding. Two of them were subtle:
- one read the *returned* checkpoint (always built) instead of the *persisted* one;
- one probed an invariant with a *symmetric* doubling, which the invariant
  legitimately tolerates.

And in the most recent round, a test asserting a registration race passed against
the vulnerable code because the route's own earlier `409` fired first and the test
never reached the line it meant to exercise.

`d89f081` added a fifth, with a different shape: the revert produced **no failure at
all**. Removing the engine's pre-attempt budget check changed nothing, because
`gather` and the post-gather guard already stopped the spending — so the suite could
not tell "the guard works" from "the guard is absent". The test was measuring the
wrong thing (provider calls) and now measures what only that guard buys: the agents
did not TRY (`attempts === 0`, no retries, no backoff). **A revert that changes
nothing is a finding, not a pass.**

So: after writing a test, revert the fix, watch it fail, restore. Every time. The
commits above do this and say so.

### Other conventions that came from real mistakes
- **Never `git commit --amend` after recording a commit hash** in a doc. Three
  backlog entries once pointed at hashes that no longer existed. Use a follow-up
  commit.
- **Empty-string env vars are not absent.** `Number(process.env.X ?? '0.016')`
  yields 0 for `FOO=`, and `import.meta.env.X ?? default` yields `''`. Use the
  `float()`/`int()` helpers in `config.ts` and `||` in the SPA.
- **A test that encodes the bug is worse than no test.** Two were found asserting
  the vulnerable behaviour as if it were the contract (`['google','password']` after
  a Google merge; a `TRUSTED_PROXY_HOPS` assumption). When a fix makes a test fail,
  check whether the test was wrong before changing the code.
- **U+F8FF renders as nothing** — and it is load-bearing, as the upper bound of
  the admin email-prefix search in `stats/store.ts`. Three reviewers in a row (an
  earlier version of the backlog included) read the query as `>= X AND < X`, an
  empty range, because the sentinel after `${prefix}` is invisible in a terminal.
  They reported a bug that never existed. It is pinned by a test now — when a
  range query looks broken, dump the code points before believing your eyes.
- Adversarial review rounds were run with `fable` subagents, two at a time, with
  **deliberately opposed lenses**: one hunting for ways to abuse the system, one
  hunting for legitimate users the guards block. The second lens found more real
  problems than the first. Tell them to cite `file:line`, to say how they
  established each claim, and to try to refute their own findings first.

### Design principles this codebase now holds
- **The pre-screen is graded on precision, not recall.** It rejects on its own with
  a hard 422 and is the only layer running when the classifier is off, failing open,
  or skipped on a preview — while a miss reaches an engine that already fences
  client text as low-authority. Its test is a corpus in BOTH directions
  (`packages/core/test/moderation.test.ts`): 28 legitimate strings, 25 attacks.
  **Grow both lists together** — tuning against one direction is how two regressions
  shipped.
- **Strikes are for billed calls.** Only the LLM classifier's verdicts earn one; the
  free deterministic layer refuses without punishing.
- **The sink is the only cost accumulator** (`packages/core/src/cost.ts`). Nothing
  returns a cost total; a second accumulator is how spend gets double-counted or
  lost. This is enforced by the types now, not by comments.
- **No model-authored string is ever rendered or persisted.** The classifier answers
  in a closed enum; every user-facing word comes from `moderation/copy.ts`. The
  admin-facing block reason and the user-facing one are deliberately different
  strings.
- **Money follows the real call.** Search is priced per *operation*, and nothing is
  booked for a call that never reached a backend (`canExtractPages()`).
