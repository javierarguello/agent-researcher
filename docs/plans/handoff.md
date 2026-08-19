# Handoff — the entry point

Last updated 2026-08-19 at `ec66323`. For whoever picks this up without the
conversation that produced it.

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

---

## State, 2026-08-19

- **Rounds 1-9 are run. Rounds 8 and 9 are fully closed** — every P0, P1 and P2 has
  a commit. Round 9 found 1 P0, 6 P1 and 20 P2 against round 8's own fix batch;
  four of the seven P0/P1 were defects in the previous round's fixes, one of them a
  security regression (a poisoned Markdown image became a live link in the PDF).
- `npm test` from the root: **1149 passed, 0 failed**. A clean clone counts **6**
  fewer — the red-team tests gated on `out/*/trace.json`, which only exists in
  Javier's checkout. `npm run typecheck` clean.
- **Next is round 10**, against `79fa632..HEAD` — which now also carries `63fd892`
  (the §K evasion fix) and `1644897` (P-5 + two `keywords` doc corrections), neither
  of them reviewed by anyone. The brief to copy is
  `m-red-team-reports/round9/BRIEF.md`; both of its corrections worked and should
  stay — a PRIVATE scratchpad per reviewer, and the sha in each agent's PROMPT
  rather than in the brief (a brief cannot name its own commit). Tell the reviewers
  that `29f8593` is in range and is the one change none of them has seen.

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

## Open, and waiting on Javier rather than on work

- **K is no longer here. It closed 2026-08-19** — re-measured on a rebuilt census
  (the 2026-08-03 lists were never kept), 70 → **61 of 95** attacks passing and
  2 / 73 ordinary phrasings refused, unchanged; the nine that closed were all
  evasion. Decision taken: **option 1, refocus** — the pre-screen owns normalization
  and evasion, the classifier owns semantics. Reasoning and what the decision does
  NOT license are in `deep-review.md` § K; the census is runnable at
  `m-red-team-reports/k-census-2026-08-19/`.
- **Product, none started**: P-1 (one dossier comparing two scenarios), P-2
  (recommend where in Florida when no location is given), P-4 (move the mode
  selector into the right-hand summary card — the real work is mobile, where that
  card does not render at all), P-5 (a couple of pages inside the app that explain
  the params and the report to the buyer — asked for 2026-08-19). Each carries its
  own open design questions.
- Smaller: **an alert on the moderation fail-open** (`moderation.llm_failed` /
  `moderation.unparsable` are WARNINGs nobody watches, and `MODERATION_LLM=false`
  has no signal at all — the one configuration in which the pre-screen is really the
  only layer; §K's own follow-up, and the highest-yield item left on that layer),
  C5's dispatch deadline (unmeasured), D1 essential pricing, the
  `MAX_JOB_COST_USD` default of $20 against a ~$2.6 honest comprehensive job, E3's
  unblock script (needs Javier's credentials for the dry run), N2 Stripe clawback,
  M-A2 (FENCE_RE near-misses, gated on frontier-tier evidence).

## Working agreements

Paired adversarial agents with opposed lenses; one refuter per finding, told to
refute by default; everything measured in the MAIN checkout; every claim carries
`file:line` and says **reproduced** or **reasoned**. Port a finding's reproduction
into a real test BEFORE fixing it. One commit per cluster, with the reasoning in the
message rather than only the change. Tests never spend money
(`packages/core/test/no-paid-calls.ts` enforces it); `verify.yml` gates deploys.

Two mechanical ones that cost time when forgotten: grep the file after a scripted
mutation to confirm the substitution applied, and never `git checkout` a file to
undo a mutation while other uncommitted work lives in it.
