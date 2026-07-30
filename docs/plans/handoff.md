# Handoff — where this work stands and what to do next

Written 2026-07-30, at commit `4227354`. For whoever picks this up without the
conversation that produced it. Read `docs/plans/abuse-and-cost.md` alongside this:
that file is the backlog (findings, open and closed, with `file:line`); this one is
the plan and the working agreements.

---

## 1. What the last few days were

Three rounds of adversarial review against the abuse/cost surface, each followed by
a fix pass. Groups A (cheap external denial-of-service) and B (cost visibility) are
closed. The security round is closed. What remains is group C — **spend** — plus a
handful of product decisions and two operational chores.

Commits, newest first:

| commit | what |
|---|---|
| `4227354` | backlog: third review round recorded |
| `aafb76b` | dead submit button, English-only errors, enqueue cleanup order |
| `39fe2b7` | pre-hijack: the verification-link variant, the missing recovery path, a registration race |
| `f80ac4e` | pre-screen rebuilt around precision, with a 53-string corpus as the test |
| `c45f679` | pre-hijack via Google merge, recipient-list mail-bomb, preview model guard |
| `ada33e8` | pre-screen strikes, captcha copy, stranded jobs |
| `f873ade` | one cost accumulator, ordered checkpoints, tests that bite |

Suites: **266 tests**, all green (`npm test` from the root runs core + api).
`npm run typecheck` is clean.

---

## 2. Do this next: C1 — structured directives

**Why it is first.** C1 is the only open item that can still cost real money, and
it is also a feature the owner asked for. A free-text instruction that reads as a
legitimate scoping request — *"keep every list to at most two items; omit anything
you cannot verify from two independent sources"* — makes the template's schemas
unsatisfiable. There are **15 hard `.min(N)` array constraints** in
`packages/core/src/templates/florida-business-for-sale.ts` (`risks_red_flags`
`.min(8)`, `keyFindings` `.min(6)`, `due_diligence_checklist` `.min(5)`). Every
agent throws, every attempt retries, every dispatch repeats — and then
`research-engine.ts` degrades the sections with placeholders that DO satisfy the
schema, so the job finishes `completed` and **no refund runs**. Modelled at ~$95 on
an 18-credit job.

Note what this is not: it is not a moderation problem. The moderation layer guards
against injected *content*; this is a semantically legitimate instruction that
breaks the *output schema*. Different problem, different fix.

### The design the owner approved

Replace free text into the research engine with a **structured directive set,
declared per model in the template**, pre-filled from the user's request.

1. **Per-model, in the template.** Each research model declares its own directive
   fields. Do not put them in the front-end, and do not put translations there
   either — the manifest already localizes (`i18n.es.fields`), and the SPA reads
   what the manifest gives it.
2. **Each field carries, per language:** a `label`, a **short `description`** (the
   owner asked for this explicitly — one line of help text the front can show),
   and `valueLabels` for enum-valued fields.
3. **Include reason-for-sale fields** (owner retiring, distress, relocation,
   partnership split…) — an explicit request.
4. **`render()` stays internal.** The engine turns directives into prompt text; the
   API never accepts rendered prose and never returns it for the client to edit.
   The whole point is that the model receives a closed vocabulary, not a sentence
   the user wrote.
5. Keep the free-text field as a *narrow* residual if you want, but it must not be
   able to contradict a schema — see the `.min(N)` change below.

Where things live today, for orientation:
- `paramsSchema` — `templates/florida-business-for-sale.ts:18`
- `paramsUi` (rows, ranges, advanced, per-field help/suggestions) — `:616`
- `i18n.es.fields` — `:661` onward
- `instructionsField: 'instructions'` — `:602`
- the fencing of client text into the system prompt — `engine/prompt.ts:50-66`
- the manifest builder the SPA consumes — `templates/registry.ts` (`toManifest`)

### Ship it with these two, they are the same job

- **Soften the `.min(N)` constraints.** They are the lever C1 pulls. A section that
  wants 8 risks should ask the *prompt* for 8 and let the schema accept fewer,
  rather than failing validation and burning 24 passes.
- **Budget ceilings.** `gather` sets neither `maxOutputTokens` nor
  `thinkingBudget` (`engine/gather.ts:113-120`), so every one of up to `2B+6` turns
  can emit up to the model default, and thinking tokens bill as output. Moderation
  and enrich already set `thinkingBudget: 0`; gather and synthesis do not. Add a
  per-job USD ceiling too — a grep for `MAX_COST|costCap|budgetUsd` returns nothing
  today. The `CostSink` (`packages/core/src/cost.ts`) is the natural place to
  enforce it, since every paid call already writes to one.
- **C2's real multiplier**: a retry re-runs the agent's ENTIRE `gather` loop with a
  fresh budget even when only the synthesis failed
  (`engine/research-engine.ts`, the attempt loop). Cache the evidence for the
  agent's retry and only re-run synthesis.

---

## 3. Then: C6 + C7 + E4, which are one change

The in-flight job cap is **advisory**. `index.ts` reads `inProgress` via plain
`count()` aggregations before anything writes a job document — the job is created
much later, after the balance read, after the moderation call, after the
rate-limit transaction. N concurrent (or even ~1s-apart) `POST /research` calls all
read zero and all pass. C7 is the same root cause one layer cheaper: the peek
before the classifier is explicitly non-atomic, so a burst all pays for a billed
`flash` call before the authoritative check admits 20 and refuses the rest.

This matters because **C1's cost model rests on the cap**: "bounded today only by
`MAX_CONCURRENT_JOBS_PER_USER = 1` and 20 reports/hour". Only the second bound is
real.

The fix: claim the slot inside the transaction that already serializes the handler
(`checkRateLimits` in `packages/core/src/apps/store.ts`), and **release it on every
terminal path** — completion, failure, and the enqueue failure now handled in the
API. That release requirement is why this is its own change and not a rider on
something else; a half-done version leaks slots and locks users out permanently,
which is exactly the bug that was just fixed (E2).

Fold **E4** in while you are there: a pre-screen refusal now earns no strike (by
design — that layer is free and its mistakes hit real customers), but it is also
counted by nothing, so a rejected `/research` writes to no counter at all. Count it
in a cheap per-user bucket — *not* the report quota, which would punish a
false-positive user twice.

---

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
