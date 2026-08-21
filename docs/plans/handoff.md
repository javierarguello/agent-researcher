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
npm test                     # 1309 passed, 0 failed — READ THE EXIT CODE, not this line
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

## State, 2026-08-21

- **Rounds 1-10 are run and CLOSED** — 8, 9 and 10 in full. Round 10's 26 P2 closed
  2026-08-20 in `eda0913` (summary/deterministic), `06879b3` (buyer surface),
  `1de3363` (engine/test), `664d36a`+`7e2bfa1` (the record). Findings and stamps are
  `deep-review.md` § "Round 10".
- **Then a large batch NOBODY has reviewed**, 2026-08-20/21, `2a01ada..HEAD`. It is
  not round-10 repair work — it is new behaviour, most of it touching money or
  prompts, and it is where the next defects are on this repo's record. In order:

  | area | commits | what changed |
  |---|---|---|
  | C5 — dispatch deadline | `91b5cfc` | a dispatch stops STARTING agents at `JOB_DISPATCH_BUDGET_SECONDS` (1500) and returns 503; the queue window went 10800s → 18000s so `maxJobAttempts` is reachable |
  | 429 copy | `0bf39b3` | four buyer-reachable 429s answer in the requester's language; the SPA sends its switcher language as `Accept-Language` |
  | D1 — cost ceilings | `ef9f02a`, `041bd97` | the ceiling is DERIVED: `credits × creditFloorUsd × (1 − expectedProfitPct/100)`, per model, clamped by `MAX_JOB_COST_USD`. Essential went 5 → **8 credits** (the measured cost ratio) |
  | modes | `d7696f6` | `ReportMode` is any slug a template declares; `essential`/`comprehensive` are only the defaults |
  | Stripe catalog | `d3f2d7d`, `87d51f9`, `021805a`, `d3fa83d` | packs are created/edited/retired THROUGH the API, the system writes their metadata (`appId`, `templateId`, `planId`, `credits`), a price change needs `expectedPriceUsd`, copy is per-locale, and the credit floor is derived from the packs and never typed |
  | admin economics | `2d5abd9`, `d120c1f`, `8475716` | one screen per model: credits, packs, floor, expected profit, and what each tier BUYS (turns, agents, sections), previewed by the API |
  | M-E1 extraction | `4950c8e`, `5fa80a7` | measured (the prompt reached `report.json` AND the PDF), then closed by `redactPromptEcho` + `SELF_DISCLOSURE_RULE`; a leak is booked as an incident, never as a buyer strike |
  | links + catalog | `c7da31d`, `c95bcfb`, `76323f8` | a link in a free-text param is DEFUSED (dots → spaces), `GET /catalogs/:id` (authenticated) backs an optional autocomplete on `location`, and every field label is now associated with its input |

- **Suite, MEASURED 2026-08-21 at `76323f8`, by EXIT CODE:** `npm test` → 0,
  `npm run typecheck` → 0, **1309 passed, 0 failed** in the MAIN checkout
  (826 core + 242 api + 24 worker + 192 fbizlab + 25 admin). The clean-worktree
  figure has NOT been re-measured since `2a01ada` (1170) — measure yours.
  **Read the exit code, not the `Tests N passed` line.** A run with every test green
  can still exit 1 on an unhandled error, and one did: `65d6a90` was pushed after a
  `25 passed` that had failed, and it took all four workflows down.
- **`main` is pushed and dev is green.** Pushing to `main` deploys DEV — the API to
  Cloud Run and both SPAs to Firebase Hosting, all behind `verify.yml`.

## Going to prod — what is actually needed

**PROD DOES NOT EXIST.** Checked against GCP on 2026-08-21: no `agent-researcher-prod-*`
Cloud Run services, no prod Cloud Tasks queue, and no `deploy-prod` branch. This is a
first provisioning, not a redeploy.

One GCP project, one owner account, one Artifact Registry repo (images tagged
`:dev` / `:prod`). Everything else is named `agent-researcher-prod-*` by
`setup-gcp.sh` and `deploy.sh`, so prod is dev with a different suffix — including
the permissions, which are the same project-level grants to a second pair of
runtime SAs.

Blocking, **in this order** — the order is the content, several steps cannot be
brought forward:

Two scripts do the mechanical half: `infra/prod-secrets.sh`
(`status` | `deploy-sa` | `secrets` | `webhook` | `vars`) and `infra/seed-prod.sh`.
Start with `bash infra/prod-secrets.sh status` — it lists what is missing and, until
the service exists, predicts the prod API URL from dev's (the Cloud Run hash is per
project+region).

1. **The `_PROD` GitHub secrets.** `deploy.sh` REFUSES a prod deploy without
   `AUTH_JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
   `POSTMARK_SERVER_TOKEN` — because `--set-env-vars` replaces the whole
   environment, so a missing secret is not an error, it is a live service without
   it. Plus `GCP_SA_KEY_PROD` (the API deploy AND both SPAs — an owner SA key, the
   dev shape; `deploy.yml` used to ask for WIF secrets that were never created
   anywhere in this project, fixed 2026-08-21) and optionally `TAVILY_API_KEY_PROD`,
   `BRAVE_API_KEY_PROD`. `TURNSTILE_SECRET_PROD` already exists.
2. **`ENV=prod bash infra/setup-gcp.sh`, once.** `deploy.yml` only DEPLOYS and says
   so in its own header; `deploy-dev.yml` is the one that provisions. Without it
   there is no queue, no service accounts, no bucket and no Vertex grant — and no
   18000s retry window.
3. **The Firebase Hosting sites** `agent-researcher-prod-fbizlab` and the admin's.
   The targets are already in `.firebaserc`; the sites are not created.
4. **`git push origin main:deploy-prod`**, then read the API URL off Cloud Run. This
   is also what unblocks the two chicken-and-egg items below, both of which need a
   URL that does not exist until the service does.
5. **The Stripe LIVE webhook**: endpoint `POST <api>/credits/webhook` for
   `checkout.session.completed`, `.async_payment_succeeded`,
   `.async_payment_failed`, `product.*`, `price.*`; then the real
   `STRIPE_WEBHOOK_SECRET_PROD` and a redeploy. The first deploy has to carry a
   placeholder, because `deploy.sh` refuses an empty one.
6. **Seed the prod Firestore — it is empty, and nothing seeds it.** `reset:dev`
   refuses any ENV but dev, and `apps seed-admin` mints a **UUID** appId while both
   SPAs are compiled against the slugs `admin` / `fbizlab`. So:
   `ENV=prod npm run apps -- create --appId admin --role admin --admin-emails …` and
   the same for `fbizlab` with `--allowed-templates florida-business-for-sale`.
   Then `emailFrom` and `webUrl` on `fbizlab`; without them registration answers 500
   and no buyer can verify an email. The CLI grew `--email-from` / `--web-url` for
   this (2026-08-21): they were reachable only through `PATCH /admin/apps/:appId`,
   which needs an admin SESSION — a Google id_token for an address already in
   `adminEmails` — and the admin SPA renders neither field, so on an empty Firestore
   it was a closed loop. `bash infra/seed-prod.sh --admin-emails … --confirm` does
   all of it.
7. **The Stripe catalog in the LIVE account.** Today it exists only in the sandbox —
   the API only ever holds its own `STRIPE_SECRET_KEY`, so dev writes test and prod
   writes live, and neither can reach the other. Deploy the admin SPA first
   (`workflow_dispatch`), then create the packs from its Pricing screen; it writes
   the metadata the webhook depends on. With no packs the credit floor falls back to
   the code default and every ceiling derives from a price nobody sells.
8. **The fbizlab SPA, LAST.** Its build bakes the catalog and
   `scripts/fetch-plans.mjs` exits 1 on an empty one, in **each of en/es/fr/pt** — so
   the prod build cannot succeed before step 7, and the run that step 4's push
   triggers is expected to go red.

Not blocking, but do not skip lightly: **round 11** (below) and the fail-open alert.
Also unset in every environment: `SEARCH_COST_PER_CALL_USD_*`,
`BRAVE_COST_PER_CALL_USD_*`, `MAX_JOB_COST_USD_*` (repo *variables*, read by
`deploy.yml`). They fall back to the code defaults, and the Brave default is **$0** —
a paid Brave key without `BRAVE_COST_PER_CALL_USD_PROD` books every search at zero.

## The three rules the rounds have paid for

1. **Revert-verify every test, and count the RED, never the passed.** `npm test`
   chains the workspaces with `&&`, so a red core suite means four suites never run
   and the "passed" total collapses to something meaningless. If a mutation measures
   0 red, the test does not pin the fix — fix the test, or say "0 red" out loud in
   the commit message and why the line stays.
2. **Read the EXIT CODE, never the summary line.** Earned on 2026-08-20: a run
   printing `25 passed` with zero failures exited 1 on an unhandled error — jsdom
   has no `scrollIntoView` and Mantine calls it from a timer, so the throw landed
   after the test that caused it had passed. It was pushed, and it took all four
   workflows down. `Tests N passed` is not the outcome; `npm test; echo $?` is.
3. **Name the case you measured, and say which checkout you measured it in.** Every
   false claim round 9 found was a TRUE measurement written as a universal —
   "nothing gets worse", "no budget reaches it", "a template cannot forget",
   "nothing else moved", "copies its arrays", "the two artifacts now agree". The
   measurement was right every time; the generalisation is what broke.

Three traps worth knowing before you start, all paid for in round 9: a fix can
REMOVE the only detection the thing it fixed had; a test that reads a value inside a
callback proves nothing about aliasing; and a test can pass for a false reason (one
of mine previewed before the value under test was ever set).

## Open — a decision nobody can take for Javier, and work nobody is blocked on

Split in two because round 10 found the previous single heading covering both kinds
(R10-31).

### Waiting on a decision (Javier)

- **E2 — may a dossier describe its own method?** The extraction pair's open half.
  "Write the prompt that would produce this report" copies the MESSAGE BODY — the
  brief, the section guidance, the upstream sections — not the system prompt, so
  `redactPromptEcho` cannot catch it without deleting every legitimate quotation of
  a source. MEASURED, not assumed: guarding the body redacts **8 fields of an
  honest, unattacked run**. So it is a product question, not a longer regex, and
  `test/red-team/e-extraction.test.ts` asserts it still reaches — the day someone
  answers, the assertion says so.
- **P-6 — the credit ladder, decided and NOT applied.** Syndicate 150 → 160 credits
  in Stripe, which turns a flat $0.8625/$0.860 into a real ladder and makes the
  middle tier the buy. Now done from the admin's Pricing screen rather than by hand.
  Numbers, steps and the two linked edits are `product-backlog.md` § P-6.
- **`MAX_JOB_COST_USD` = $20.** With per-mode derived ceilings this is only a global
  clamp now. It starts binding before the model's own figure at roughly 42 credits —
  worth knowing before raising a tier that far.
- **N2 Stripe clawback** (policy), and the four product items' open design questions
  (**P-1**, **P-2**, **P-4**, **P-5** in `product-backlog.md`).

### Open work, nobody blocked

- **ROUND 11, and it is the biggest thing on this list.** Eight reviewers against
  `20f361b..HEAD` — the round-10 fix batch AND the whole 2026-08-20/21 batch above.
  On this repo's record that is where the next defects are: rounds 8, 9 and 10 each
  found the previous round's FIXES shipping holes, twice inside the very line of the
  fix. Weight these, all new behaviour rather than repair:
  the derived cost ceiling and the `z.preprocess` credit dedupe (they change what a
  job may spend and what a validated request stores); the Stripe WRITE path (it is
  the first thing in this repo that mutates an external billing catalog); open-ended
  modes (a closed union became a string in twelve places); `redactPromptEcho` (it
  deletes a buyer's prose on a heuristic); and the dispatch deadline (it changes when
  a job stops).
  The brief to copy is `m-red-team-reports/round10/BRIEF.md` plus its two
  corrections — count red from a runner that does not stop at the first failing
  workspace, and **a corpus proves a shape, never a class**. Add a third, paid for
  repeatedly on 2026-08-20/21: **check the EXIT CODE, not the summary line.**
- **M-E2** — see the decision above; the work only starts once it is answered.
- **Alerting on the moderation fail-open.** `b4ee573` made it VISIBLE on the admin
  dashboard; nobody is PAGED. Needs a log-based metric and an alert policy in
  `sinuous-canto-497518-h7` — Javier's credentials.
- **`recordPromptEcho` has a counter and no surface.** A page that tries to extract
  the prompt is counted per app and per day and nothing renders it. The admin health
  strip is the obvious home.
- **The 15-word echo threshold is a bet, and it says so.** The only real report
  available to measure the legitimate side against ran in SPANISH against English
  prompts, so its "zero shared runs" proves almost nothing. Re-measure the first time
  a real English job exists.
- **C5's soft deadline is unmeasured against a REAL slow job.** 1500s is derived from
  two real runs at 1241s and 1309s; nothing has yet been observed hitting it.
- E3's unblock script (needs credentials for the dry run), M-A2 (FENCE_RE
  near-misses, gated on frontier-tier evidence).

### Closed since the last handoff

- **C5** (`91b5cfc`) — measured, and the deadline turned out not to be the thing that
  could change: Cloud Tasks caps an HTTP dispatch deadline at 30 minutes.
- **D1's engineering half** (`ef9f02a`, `041bd97`) — ceilings derived from revenue,
  essential re-priced to 8 credits on the measured cost ratio.
- **M-E1** (`4950c8e`, `5fa80a7`) — the system prompt reached `report.json` and the
  PDF; it does not now.
- **§K** closed 2026-08-19 (option 1, refocus).

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
