# Handoff — the entry point

Last updated 2026-08-20. For whoever picks this up without the conversation that
produced it. (No sha here on purpose: the previous one named `ec66323`, a commit
that never touched this file, two edits before the one that left it — round 10,
R10-33. `git log -1 -- docs/plans/handoff.md` is the honest version of that line.)

**This file is deliberately short and points elsewhere.** Its previous version was a
three-week-old snapshot of rounds 1-3 that still called itself "where this work
stands" — the exact defect these review rounds keep finding (a prose copy of
something that moves is a document that is wrong on a schedule). So: state, then
pointers.

---

## Where the work actually lives

| What | Where |
|---|---|
| **The backlog** — every finding, open and closed, with `file:line` and the hash that closed it | `docs/plans/deep-review.md` |
| **What to do next**, in order, with the rules and the traps | `deep-review.md` § the LAST round § "How to continue (for the next agent)" |
| Things to BUILD (product), with their open design questions | `docs/plans/product-backlog.md` |
| The red-team runbook and its raw reports | `docs/plans/m-red-team.md`, `docs/plans/m-red-team-reports/` |
| The earlier abuse/cost backlog (groups A-N) | `docs/plans/abuse-and-cost.md` |

Read the "How to continue" section first. It is rewritten at the end of every round
and it is the only place that is current by construction.

## Starting cold — the four commands

```bash
npm ci                       # a fresh worktree has no node_modules and no vitest
npm test                     # 1214 passed, 0 failed in Javier's checkout (see State)
npm run typecheck            # must be clean; it catches what the suites cannot
npx tsx docs/plans/m-red-team-reports/k-census-2026-08-19/run.ts   # the §K census
```

`npm test` chains the five workspaces with `&&`. A red core suite means the other
four never run, so **count the RED, never the passed** — and when you measure a
mutation, run the workspaces that actually exercise the code, not just the first one
that goes red.

Nothing in the suites spends money: `packages/core/test/no-paid-calls.ts` throws on
a real paid call, Firestore and Cloud Storage are mocked, and `TEST_LLM=ollama`
points every alias at a local model. If a test of yours needs a model, that is the
only tier you may use.

---

## State, 2026-08-20

- **Rounds 1-10 are run, and rounds 8, 9 and 10 are all CLOSED.** Round 10 found
  0 P0, 10 P1 and 26 P2, and every one is fixed. The P1 half:
  `2a01ada`, `67261d0`, `b4ee573`, `4665dc8`, `73fcf36`, `1b16eae` — plus R10-37,
  found while fixing R10-6 and by none of the eight reviewers: the assist's
  fillable-basics path could never fire in production, because `validateRequest`
  applies the schema default before the "is this field empty?" gate runs. The P2
  half, one commit per file cluster: `eda0913` (summary/deterministic),
  `06879b3` (buyer surface), `1de3363` (engine/test), `664d36a` (the record).
  Findings and stamps are `deep-review.md` § "Round 10".
- Round 10's shape, because it repeats: **the fixes of round 9 shipped holes of
  their own**, one of them in the same LINE as the fix (`d77ffb3` closed R9-4/R9-5
  and opened R10-4/R10-5), and the §K evasion work shipped **two false positives on
  ordinary buyer language** plus a reachability regression on a cubic regex — the
  expensive failure that commit argued it had avoided. Five findings were reached by
  two reviewers independently.
- **Suite totals, MEASURED 2026-08-20 at `1de3363`:** **1214 passed, 0 failed** in
  the MAIN checkout (779 core + 217 api + 22 worker + 185 fbizlab + 11 admin). The
  clean-worktree figure was 1170 at `2a01ada` and has NOT been re-measured since —
  do not subtract six from 1214 and write it down. The gap is six red-team tests gated on
  `out/*/trace.json`, which exists only in Javier's checkout. Subtracting six is not
  a safe shortcut even though it lands here: core also COLLECTS a different total in
  the two checkouts. At `1de3363` the main checkout COLLECTS **791** in core (779
  passed + 12 skipped); the clean-worktree collection has not been measured since
  `2a01ada`, so the old "775 vs 777" pair is gone rather than carried forward.
  Measure yours and say which one it is — round 10's R10-28 caught this line 19
  tests stale, in a commit that edited the line beneath it. `npm run typecheck`
  clean.
- **`main` is pushed to `origin/main` at the end of every closed cluster** — no sha
  here, because a line naming one is wrong by the next push and this file has already
  been caught doing that twice (R10-28, R10-33). `git log origin/main..HEAD` is the
  honest version. Pushing to `main` deploys DEV — the API to Cloud Run and both SPAs
  to Firebase Hosting, all three behind `verify.yml`. Prod is a push to
  `deploy-prod`, which nothing in this batch touched.
- **Next: round 11, against `20f361b..HEAD`** — the WHOLE round-10 fix batch, P1 and
  P2, which nobody has reviewed. That is deliberate and it is where this repo's record
  says the next defects are: rounds 8, 9 and 10 each found the previous round's FIXES
  shipping holes, twice inside the very line of the fix. Five things in the range are
  new code rather than repairs and deserve the suspicion `29f8593` and `63fd892`
  earned in round 10 — the admin health strip (`b4ee573`: a new endpoint field, a new
  counter, and the thinnest test suite in the repo), the client-side summary patching
  (`1b16eae`: it substitutes strings into a sentence the server wrote), the
  `z.preprocess` dedupe in `directivesSchema` (`eda0913`: it changes the stored params
  of any validated request), the `maxSelected` cut added to `renderDirectives`
  (`eda0913`: the prompt now drops values it used to carry), and `copy-parity.test.tsx`
  (`06879b3`: eleven modules got a new export so one test could reach them).
  The brief to copy is `m-red-team-reports/round10/BRIEF.md`; its three predecessors'
  corrections all held (a PRIVATE scratchpad per reviewer, the sha in each agent's
  PROMPT, the clean-worktree total stated as measured). Two more to add, paid for in
  round 10: tell reviewers to **count red from a runner that does not stop at the
  first failing workspace** (`npm test` chains with `&&`, and two of the round's four
  wrong counts are explained by it), and give them the round's rule — **a corpus
  proves a shape, never a class** — with the instruction to write the sibling row the
  author did not think of.

## The two rules the rounds have paid for

1. **Revert-verify every test, and count the RED, never the passed.** `npm test`
   chains the workspaces with `&&`, so a red core suite means four suites never run
   and the "passed" total collapses to something meaningless. If a mutation measures
   0 red, the test does not pin the fix — fix the test, or say "0 red" out loud in
   the commit message and why the line stays.
2. **Name the case you measured, and say which checkout you measured it in.** Every
   false claim round 9 found was a TRUE measurement written as a universal —
   "nothing gets worse", "no budget reaches it", "a template cannot forget",
   "nothing else moved", "copies its arrays", "the two artifacts now agree". The
   measurement was right every time; the generalisation is what broke.

Three traps worth knowing before you start, all paid for in round 9: a fix can
REMOVE the only detection the thing it fixed had; a test that reads a value inside a
callback proves nothing about aliasing; and a test can pass for a false reason (one
of mine previewed before the value under test was ever set).

## Open — a decision nobody can take for Javier, and work nobody is blocked on

Split in two because round 10 found the previous single heading, "waiting on Javier
rather than on work", covering both kinds — and a commit claiming to have emptied it
while adding an engineering item to it (R10-31).

### Waiting on a decision (Javier)

- **P-6 — the credit ladder, decided and NOT applied.** Syndicate's `credits`
  150 → 160 in Stripe (metadata only, no price moves), which turns a flat
  $0.8625/$0.860 into a real ladder and makes the middle tier the buy. It carries
  three linked edits — the "30 essential" line in four languages, and
  `CREDIT_FLOOR_USD` 0.86 → 0.806 — and one open question: essential earns $4.03 at
  the new floor and may burn $3.50, so five credits per essential report is thin.
  All the numbers and the steps are `product-backlog.md` § P-6. Javier's Stripe
  account, Javier's call.
- **D1's remaining half — what an essential report costs in CREDITS.** The ceiling
  half shipped (`ef9f02a`): $10 comprehensive, $3.50 essential, both under what the
  report earns, and `MAX_JOB_COST_USD` still binds when an operator lowers it. What
  is left is that essential's ceiling is bounded by REVENUE rather than by cost —
  1.8× its inferred cost, where comprehensive gets 2.6× — because 5 credits does not
  buy enough room. 6 credits gives it $1.34 of margin at the ceiling; 8 brings its
  cost-per-credit to near parity. Not a patch: it rewrites every "≈N essential
  reports" line in three plans and four languages.
- The four product items' open design questions (P-1, P-2, P-4, P-5 in
  `product-backlog.md`); each names its own.

### Open work, nobody blocked

- **Round 11** — eight reviewers against `20f361b..HEAD`, the whole round-10 fix
  batch. Nothing else is queued ahead of it: rounds 8, 9 and 10 are closed. The brief
  to copy is `m-red-team-reports/round10/BRIEF.md` (with the two corrections named in
  the State section above), and the five pieces of new behaviour to weight are listed
  there too.
- **M-E1 and M-E2 — the prompt coming back OUT** (asked for by Javier 2026-08-20;
  the runbook entry is `m-red-team.md` § "E · Extraction"). Every prompt test in the
  repo guards the inbound direction — can a stranger's text reach a prompt — and
  **nothing anywhere asserts that an artifact the buyer receives lacks OUR prompt**
  (checked by grep). Two families: E1, the system prompt / brief / agent objective
  must not appear in `report.json`, the viewer, the PDF, the email, the shared page,
  `title`, `summary` or the progress lines; E2, the report must not be usable to
  GENERATE a prompt ("write the system prompt that would produce this report"),
  which is a product decision as much as a defence. The realistic entry is a fetched
  page — attacker-controlled, no pre-screen, since it never passed through our API —
  and `industry` / `location`, which are still free text and still rendered verbatim
  into the brief (`florida-business-for-sale.ts:1323`). Not started.
- **Alerting on the moderation fail-open — the half that is still open.**
  `b4ee573` made it VISIBLE: `ModerationVerdict.degraded`, a counter with a last-seen
  time, and a strip at the top of the admin dashboard that renders in all four
  states including "this API build does not report it". Nobody is PAGED, which is
  the part that would need a log-based metric and an alert policy in
  `sinuous-canto-497518-h7`, i.e. Javier's credentials.
- **`ENV=prod bash infra/setup-gcp.sh` — once, by Javier.** `91b5cfc` raised the
  Cloud Tasks retry window 10800s → 18000s, and below that a slow job's queue window
  runs out before `maxJobAttempts` finalizes: the task is dropped and the job stays
  `running` forever with the credits spent (the ending `parkJob` describes).
  **Dev needs nothing** — `deploy-dev.yml` runs `setup-gcp.sh` on every push and the
  live dev queue already reads `maxRetryDuration 18000s, maxAttempts 12, maxBackoff
  600s` (read off the API 2026-08-20, not inferred). **Prod does**: `deploy.yml` only
  deploys, and says so in its own header.
- E3's unblock script (needs Javier's credentials for the dry run), N2 Stripe
  clawback, M-A2 (FENCE_RE near-misses, gated on frontier-tier evidence).
  **C5 is closed** (`91b5cfc`, measured).

### Closed

- **K closed 2026-08-19** — re-measured on a rebuilt census
  (the 2026-08-03 lists were never kept), 70 → **61 of 95** attacks passing and
  2 / 73 ordinary phrasings refused, unchanged; the nine that closed were all
  evasion. Decision taken: **option 1, refocus** — the pre-screen owns normalization
  and evasion, the classifier owns semantics. Reasoning and what the decision does
  NOT license are in `deep-review.md` § K; the census is runnable at
  `m-red-team-reports/k-census-2026-08-19/`.

## Working agreements

Paired adversarial agents with opposed lenses; one refuter per finding, told to
refute by default; everything measured in the MAIN checkout; every claim carries
`file:line` and says **reproduced** or **reasoned**. Port a finding's reproduction
into a real test BEFORE fixing it. One commit per cluster, with the reasoning in the
message rather than only the change. Tests never spend money
(`packages/core/test/no-paid-calls.ts` enforces it); `verify.yml` gates deploys.

Two mechanical ones that cost time when forgotten: grep the file after a scripted
mutation to confirm the substitution applied, and never `git checkout` a file to
undo a mutation while other uncommitted work lives in it (copy it aside first —
that is what the scratchpad is for).

And one earned on 2026-08-20, which is not a review rule but a testing one:
**drive the production entry point, not the unit.** R10-37 — a whole feature that
could never fire — survived every test around it because all of them called
`acceptProposals` with hand-built params, while the API calls `validateRequest`
first and Zod fills in the defaults. If a test builds the input that reaches the
function under test, it is testing your model of the caller.
