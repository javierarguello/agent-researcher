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

---

## State, 2026-08-20

- **Rounds 1-10 are run. Rounds 8 and 9 are fully closed. Round 10 is OPEN**: it
  found 0 P0, 10 P1 and 26 P2, of which **three P1 are fixed** (`2a01ada`) and
  everything else is not. Its findings, its order of work and the reasoning for that
  order are `deep-review.md` § "Round 10" → "How to continue".
- Round 10's shape, because it repeats: **the fixes of round 9 shipped holes of
  their own**, one of them in the same LINE as the fix (`d77ffb3` closed R9-4/R9-5
  and opened R10-4/R10-5), and the §K evasion work shipped **two false positives on
  ordinary buyer language** plus a reachability regression on a cubic regex — the
  expensive failure that commit argued it had avoided. Five findings were reached by
  two reviewers independently.
- **Suite totals, both MEASURED 2026-08-20 at `2a01ada`** — not one derived from the
  other: **1176 passed, 0 failed** in the MAIN checkout (765 core + 216 api + 22
  worker + 166 fbizlab + 7 admin) and **1170 passed, 0 failed** in a fresh worktree
  (759 core, same four others). The gap is six red-team tests gated on
  `out/*/trace.json`, which exists only in Javier's checkout. Subtracting six is not
  a safe shortcut even though it lands here: core also COLLECTS a different total in
  the two checkouts (775 vs 777). Measure yours and say which one it is — round 10's
  R10-28 caught this line 19 tests stale, in a commit that edited the line beneath
  it. `npm run typecheck` clean.
- **Next is the round-10 fix batch, then round 11** against `20f361b..HEAD`. The
  brief to copy is `m-red-team-reports/round10/BRIEF.md`; its three predecessors'
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

- **D1 essential pricing** and the **`MAX_JOB_COST_USD` default of $20** against a
  ~$2.6 honest comprehensive job — both are numbers someone has to choose, not
  patches.
- The four product items' open design questions (P-1, P-2, P-4, P-5 in
  `product-backlog.md`); each names its own.

### Open work, nobody blocked

- **The round-10 fix batch** — 7 open P1 and 26 P2. Start at `deep-review.md`
  § "Round 10" → "How to continue"; it is ordered and says why.
- **The alert on the moderation fail-open.** §K's own follow-up, and round 10
  promoted it: R10-10 reproduced two shipping paths on which the classifier does not
  run at all (`MODERATION_LLM=false`, which is independent of `VALIDATION_LLM`; and
  any admin caller, on both routes). The §K decision ASSUMES the classifier is
  running and nothing checks that it is.
- C5's dispatch deadline (unmeasured), E3's unblock script (needs Javier's
  credentials for the dry run), N2 Stripe clawback, M-A2 (FENCE_RE near-misses,
  gated on frontier-tier evidence).

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
undo a mutation while other uncommitted work lives in it.
