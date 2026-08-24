# Handoff — the entry point

Last updated 2026-08-24. For whoever picks this up without the conversation that
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
npm test                     # 1375 passed, 0 failed — READ THE EXIT CODE, not this line
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

## State, 2026-08-24

**`main` is `9fc91fc`. `deploy-prod` is `7a638c7`.** Prod is two commits behind and
both are safe to be behind: a docs commit, and the Turnstile site-key change (whose
two repo variables are already set, so the next prod release picks it up with nothing
to do first).

**Suite, MEASURED at `9fc91fc` by EXIT CODE:** `npm test` → 0, `npm run typecheck` → 0,
**1375 passed** (856 core + 242 api + 24 worker + 228 fbizlab + 25 admin). Read the
exit code, not the `Tests N passed` line.

**PROD IS LIVE AND SELLABLE.** Released 2026-08-24 by `git push origin main:deploy-prod`,
which fires BOTH prod workflows (SPA and API+worker) behind `verify.yml`. Verified on
the running system, not on the workflow: `/health` 200, CORS 204 for
`https://floridabizlabs.com` and no header for an unlisted origin, `GET /plans` with
the three live packs, `floridabizlabs.com/{,sample,verify}` 200. **A real buyer account
was registered and verified on prod that day**, which is what proves Turnstile and the
Postmark mail actually work — see § Security for what that leaves open about email.

### What shipped 2026-08-22/24, and what it is owed

Three paid comprehensive runs ($3.5751, $3.3065, $2.9783 against a $8.7075 derived
ceiling) were made to produce a public sample, and they found more than they produced.
All of it is `deep-review.md` § "Field findings" as **F-1 … F-10**, with the measured
figures. In short:

| | what changed | where |
|---|---|---|
| F-1 | an enricher may not GROW a producer-owned set (`ReportSection.itemKeys`) — a refiner had invented a 7th listing profile that appeared nowhere else in the report. The FIRST fix was refuted by the next real run and the rule is now arithmetic | `templates/types.ts`, `engine/research-engine.ts` |
| F-2, F-8 | a citation shows its host, not 120 characters of query string, and the engine's `[S2]`/`[P3]` evidence tags never reach a reader. Fixed at the RENDER boundary, so it repairs reports already delivered | `pdf/report-html.ts` + `fbizlab/src/lib/safe-href.ts` (twins) |
| F-7 | the public sample published `meta.cost` — our unit economics — because a static copy never passes the API boundary that redacts it | `apps/fbizlab/scripts/build-sample.ts` |
| F-4, F-10 | three corpus tests were calibrated before the fixes they now measure; one flake took the gate down and the obvious repair made it blind | `test/red-team/refute-b1`, `refute-B2`, `d-legit`, `api/test/payments` |
| — | the public sample dossier at `/sample`, cut to a PREVIEW in the artifact (196 kB → 42 kB), linked from the landing's hero | `SampleReport.tsx`, `build-sample.ts` |
| — | every clean URL was served `max-age=3600`: a header rule matches the REQUEST path, and with `cleanUrls` + the SPA rewrite nothing a visitor asks for ends in `.html`. Every deploy took an hour to reach a returning visitor | both `firebase.json` |
| — | verifying an email now signs the person in instead of sending them to retype the password they just proved | `VerifyEmail.tsx` |
| — | the Turnstile site key is per-environment and the build REFUSES to produce a captcha-less bundle | `vite.config.ts`, both deploy workflows |

**None of it has been adversarially reviewed**, and neither has the 2026-08-20/21 batch
below it. Two of these are new public surface (`/sample`) or auth behaviour (verify
signs in), which is the class this repo's record says to weigh heaviest.

### The batch before it, also unreviewed (2026-08-20/21, `2a01ada..7a638c7`)

Rounds 1-10 are run and CLOSED (findings and stamps in `deep-review.md`). What came
after them is new behaviour, most of it touching money or prompts: the dispatch
deadline (C5, `91b5cfc`), buyer-facing 429 copy (`0bf39b3`), cost ceilings derived
from revenue (D1, `ef9f02a`/`041bd97`, essential 5 → 8 credits), open-ended modes
(`d7696f6`), the Stripe catalog write path (`d3f2d7d`, `87d51f9`, `021805a`,
`d3fa83d`), the admin economics screen (`2d5abd9`, `d120c1f`, `8475716`), the M-E1
prompt-echo redaction (`4950c8e`, `5fa80a7`), and link defusing + the catalog endpoint
(`c7da31d`, `c95bcfb`, `76323f8`).

## Going to prod — what is actually needed

**PROD IS RELEASED.** `main` was pushed to `deploy-prod` on 2026-08-24 (`297269a`),
which fires BOTH prod workflows; `Deploy fbizlab SPA (prod)` and `Deploy` (API +
worker) both went green behind `verify.yml`. Measured on the live site and API right
after, not read off the workflow: `floridabizlabs.com/` and `/sample` 200 with
`no-cache`, `/sample-dossier.json` 43,317 bytes (the preview — 18,034 before, which
was `index.html` coming back from the rewrite because the file did not exist), the
prod bundle references it, `/health` 200, a CORS preflight from
`https://floridabizlabs.com` 204 with the matching allow-origin while an unlisted
origin gets no header, and `GET /plans?appId=fbizlab` returns the three live packs
(20/80/160 credits).

What is released is the 14 commits below `d6ceb3d`, which include the field findings
F-1…F-10 in `deep-review.md` — the enricher guard (every report prod produces), both
render fixes (every report and every PDF, including ones already delivered), and the
Hosting cache headers that were making every deploy take an hour to arrive.

**All four launch blockers are now closed** — two by Javier in the consoles, one by
DNS that had already propagated, and the last two proven together by a real
registration on prod. The four are kept below with what closed each, because the
reasoning is what a later reader needs.

**Up and verified**

| What | Evidence |
|---|---|
| API `https://agent-researcher-prod-api-b74fjmzlha-uc.a.run.app` | `/health` 200 |
| worker, queue (18000s window), bucket, Firestore `agent-researcher-prod`, 9 indexes READY, both runtime SAs | `ENV=prod setup-gcp.sh`, re-read from gcloud |
| CORS | preflight from `https://floridabizlabs.com` → 204 + matching `allow-origin`; an unlisted origin gets no header |
| app docs seeded | `admin` (role admin, whitelist `miltonjaviera@gmail.com`) and `fbizlab` (`allowedTemplates`, `emailFrom`, `webUrl=https://floridabizlabs.com`), both under slug ids |
| OAuth client ids | dev's two clients REUSED (Javier's call). Doc and repo variable compared field by field — they match, which is what the `aud` check needs |
| admin SPA `https://agent-researcher-prod-admin.web.app` | deployed; bundle greps show the prod API URL, the admin client id, and `https://floridabizlabs.com` as the buyer-app link |
| custom domain `floridabizlabs.com` | A → 199.36.158.100 on both GoDaddy NS and four public resolvers, TXT `hosting-site=agent-researcher-prod-fbizlab`, TLS cert issued by Google Trust Services (16 min after the records landed) |
| consent screen | **In production**, external. The 100-user cap does NOT apply: the app requests no scopes at all (`google.accounts.id.initialize` with only a `client_id`), so it is basic sign-in |
| Stripe LIVE catalog | 3 packs, four languages, `templateId` on all three, `popular` on Investor. Ladder $1.4500 → $0.8625 → **$0.8063**/credit |
| derived credit floor | `creditFloorUsd = 0.80625` written by `syncCreditFloor` on its own, matching the code default. Ceilings: essential (8 cr) earns $6.45 → spends at most **$3.87**; comprehensive (18 cr) earns $14.51 → **$8.71**; the $20 global clamp sits above both |
| **the LIVE webhook, signature and all** | ten deliveries at 14:54-14:55 UTC on 2026-08-22, all **200**, zero 400 in 24h. A placeholder or mismatched secret returns 400 on every one — so `STRIPE_WEBHOOK_SECRET_PROD` is real. This was the last open unknown |

**The four, as of 2026-08-24 (re-measured, not carried over)**

1. **Authorized JavaScript origins.** Client `…-gm5p0a9a…` needs
   `https://floridabizlabs.com` + `https://agent-researcher-prod-fbizlab.web.app`;
   client `…-8js401r7…` needs `https://agent-researcher-prod-admin.web.app`. Without
   these nobody logs in — not the buyer, not the operator. **Unverifiable from a CLI:
   Google exposes no API for a Web client's origins. Ask, or try the login.**
2. **Turnstile.** `TURNSTILE_SECRET_PROD` is set, so the check is ENFORCED for
   `fbizlab`, and a widget only works on hostnames registered in Cloudflare. Both
   prod hostnames have to be added or register/login/reset/contact all fail.
3. **Postmark.** `pm-bounces.floridabizlabs.com → pm.mtasv.net` exists, but no SPF at
   the apex and no DKIM at the usual selectors. If the sender is not verified,
   `/auth/register` answers 500 with nothing in the response explaining why.
4. **`www`.** A CNAME to the apex today, so it reaches Firebase with no certificate of
   its own — a full-page TLS warning. Either add it in Hosting with a redirect, or
   delete the CNAME so it simply does not resolve.

**Status of each, measured 2026-08-24:**

1. **Google origins — looks CLOSED.** On the live `floridabizlabs.com/login`, GIS
   initializes (`window.google.accounts.id` present) and the Google button iframe
   renders. An origin missing from the client's list makes GIS refuse at init and the
   button never appears. Strong evidence, not proof: the definitive test is one real
   sign-in.
2. **Turnstile — CLOSED.** Javier added both prod hostnames plus dev's; the widget's
   Site Key is `0x4AAAAAAD_OEtqrL5B2NN6f`, the same key all three bundles carry.
3. **Postmark — CLOSED.**

   Both were proven by the same fact, and it is the only kind of proof that counts
   here: **a real account was registered and verified on prod on 2026-08-24** —
   `user-credentials/fbizlab__miltonjaviera@yahoo.com.ar`, created 15:27:58 with
   `emailVerified: true`. Registering requires passing the enforced Turnstile check;
   verifying requires having received the Postmark mail. The DNS picture has not
   changed (no SPF at the apex, nothing at `pm._domainkey`), so Postmark is sending on
   a verified SENDER SIGNATURE rather than a verified domain — it works, and
   deliverability to strict inboxes is the thing still worth fixing, not signup.

   **A method note, because this file said the opposite for a day.** A headless probe
   logged `[Cloudflare Turnstile] Error: 600010` on dev AND prod and it was reported
   here as "Turnstile is broken, nobody can register". It proved nothing: `600xxx` is
   the challenge-EXECUTION family (not `110200`, "domain not allowed"), and headless
   Chrome with `--no-sandbox` is precisely the bot signature Turnstile exists to
   refuse. The instrument was the thing being measured. A bot-detection widget cannot
   be tested by a bot; the browser, or a real registration, is the only check.
4. **`www` — CLOSED.** `www.floridabizlabs.com` is a CNAME to the Hosting site and
   answers **301 over valid TLS**. The full-page certificate warning is gone.

**A defect in this section's own instructions**, found while running it: the command
below builds the DEFAULT branch, not the released one.

```bash
git push origin main:deploy-prod          # the release. Fires the SPA *and* the API.
gh workflow run "Deploy fbizlab SPA (prod)" --ref deploy-prod   # a re-bake, explicitly
```

`deploy-fbizlab-prod.yml` only forces `deploy-prod` when `github.event_name ==
schedule`; a `workflow_dispatch` without `--ref` runs on the default branch and
publishes whatever `main` happens to be. The comment beside the old command claimed
the opposite.

The build bakes the catalog into `dist/plans.json` and **fails on purpose** if any of
the four languages comes back empty. Then verify
`https://floridabizlabs.com/plans.json` carries 20/80/160 credits and 2/10/20
essential, and run the end-to-end: register → verification email → real purchase →
job → PDF.

**One config gap this release did not close:** the Turnstile SITE key is a hardcoded
literal in `apps/fbizlab/src/config.ts:10` and the `|| '0x4AAA…'` fallback of both
deploy workflows, and neither `FBIZLAB_DEV_TURNSTILE_SITE_KEY` nor
`FBIZLAB_PROD_TURNSTILE_SITE_KEY` exists. The SECRET half is per-environment. It works
today only because the literal happens to be the right key; rotate the widget and both
environments keep shipping the old one with nothing to say so.

**A trap this cost us a rebuild to learn:** the public landing does NOT read the API.
Its pricing comes from `plans.json`, baked at build time by
`apps/fbizlab/scripts/fetch-plans.mjs`. A Stripe edit shows up on the site only after
a rebuild (a nightly cron — dev 06:20 UTC, prod 07:20 UTC — or `workflow_dispatch`).
The webhook busting the API cache in ~4 seconds is a different path: it serves the
authenticated SPA, not the landing.

One GCP project, one owner account, one Artifact Registry repo (images tagged
`:dev` / `:prod`). Everything else is named `agent-researcher-prod-*` by
`setup-gcp.sh` and `deploy.sh`, so prod is dev with a different suffix — including
the permissions, which are the same project-level grants to a second pair of
runtime SAs.

**Steps 1-8 below are all DONE** (2026-08-21/22). They stay written down because the
next environment repeats them in this exact order, several cannot be brought forward,
and three of them only look obvious in hindsight:

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
   URL that does not exist until the service does. The URL is PREDICTABLE, though —
   the Cloud Run hash is per project+region, so prod's is dev's with the service
   name swapped, and it came out exactly as predicted.
   The first attempt FAILED here, and it is worth knowing why: `deploy.sh` built one
   comma-delimited `--set-env-vars`, and `CORS_ORIGINS` with two origins contains a
   comma, so gcloud split the value and rejected the half without an `=`. The worker
   deployed and the API did not — half an environment, the public half missing. Dev
   never hit it because `CORS_ORIGINS_DEV` is unset and falls back to `*`. Fixed in
   `46c5c81` (custom delimiter `^|^`, plus a guard that refuses a value containing
   one). Nothing in the suite executes `deploy.sh`, so this one is pinned by a guard,
   not by a test.
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

## Security — what is open, 2026-08-24

Re-measured rather than carried over; the abuse/cost backlog was stale for two items
(C5 and D1 are done and were not struck through). Ordered by what bites first.

1. **The domain's mail fails DMARC, and it is OUR mail being quarantined.** Measured
   with `dig` on `floridabizlabs.com`: `DMARC v=DMARC1; p=quarantine` **exists**, and
   **SPF and DKIM are both absent** (`pm._domainkey` empty, no apex TXT). DMARC passes
   on SPF *or* DKIM alignment; with neither, Postmark's mail fails it and a receiver
   honouring the policy quarantines it. The verification mail does arrive — a prod
   account was verified — but the mail a signup DEPENDS on is landing in spam by
   policy. Closes with two DNS records: Postmark's DKIM TXT and an SPF including
   `spf.mtasv.net`. **Javier — DNS.**
2. **`publicAccessPrevention` is `inherited`, not `enforced`, on both buckets.**
   Nothing is public today and that was verified against the live project (uniform
   bucket-level access on, no `allUsers`/`allAuthenticatedUsers`, only the worker
   `objectAdmin` and the API `objectViewer`). But that is a current fact, not a
   property: one wrong binding reopens it. One command per bucket. **Javier — prod
   infra.**
3. **`signRead` / `signJobFiles` are still exported from core and called by nobody**
   (`packages/core/src/index.ts`; the only other references are test mocks). They are
   the mechanism the authenticated proxy replaced — URLs straight to the raw objects —
   left loaded for whoever reaches for the obvious helper. Deleting them is a small
   commit and nothing calls them.
4. **E3's unblock script is still not run, and its approval no longer covers the
   case.** `abuse-and-cost.md` § E3: approved 2026-07-31 *"because there is no
   production data yet"*. There is now. Anyone who accumulated four pre-screen
   rejections — which by the fix's own reasoning should never have earned a strike —
   is blocked, including from buying credits, and nothing identifies them. Dry run
   first (`npm run unblock:moderation`), read it, then `-- --confirm`. **Needs a fresh
   decision from Javier now that prod holds real accounts.**
5. **Nothing in the last two batches has been adversarially reviewed** — see § State.
   On this repo's record that is where the next defects are, and round 11's scope has
   grown accordingly.

**Checked and found sound on 2026-08-24, so do not re-check without new evidence:**
every path that serves a stored object (only `/research/:jobId/report` and
`/research/:jobId/files/:name`; both redact `report.json` for non-admins,
`trace.json`/`metadata.json` are `ADMIN_ONLY_FILES` and 404 for a buyer,
`checkpoint.json` is never in `job.files`), `sources.json` (buyer-reachable and
`{title,url,snippet}` only — no economics, no prompts, no agent ids), and the buckets
themselves.

**A method rule this cost a wrong public claim to learn:** a bot-detection widget
cannot be tested by a bot. A headless probe logged Turnstile `600010` on dev and prod
and it was written up here as "Turnstile is broken, nobody can register". `600xxx` is
the challenge-EXECUTION family, not `110200` "domain not allowed", and headless Chrome
with `--no-sandbox` is exactly the signature Turnstile exists to refuse. The
instrument was the thing being measured. Use a real browser, or a real registration.

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
  `20f361b..HEAD` — the round-10 fix batch, the whole 2026-08-20/21 batch, AND the
  2026-08-22/24 one (F-1 … F-10, the public `/sample` surface, and the verify screen
  now signing people in — new public surface and changed auth behaviour, which this
  repo's record says to weigh heaviest).
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
- **F-3 — a query cap must clear ≥512 characters**, not the 300 the test used to
  assume. The longest honest query over five real runs is 256, and it is the
  deal-scout's `site:` chain over the eight marketplaces the TEMPLATE declares — so
  the honest maximum moves whenever a site is added. Nothing caps query length today.
- **F-5 — the deep-dive refiner rewrites a listing's `sourceUrl`**, and not always to
  a listing: in `out/local-52835003` it replaced four of six, two with a different
  host and one with a SEARCH page. The template tells the SCOUT to cite the listing's
  own detail page and says nothing to the refiner, whose URLs are the ones that ship.
  A buyer gets a "source ↗" beside figures that does not open the listing they came
  from.
- **F-6 — the consecutive-plan breaker floor moved from 3 to 4.** The July pair said
  no honest agent ever emitted 3 plans in a row; the August runs do, in agents that go
  on to spend turns. Free-call floor stays ≥6. The zero-turn plan-loops that motivated
  M-B2 do not appear in any August run — first production evidence that they are gone.
- **The two GCS hardening items and the mail records** — see § Security, 1-3.
- E3's unblock script (needs credentials for the dry run), M-A2 (FENCE_RE
  near-misses, gated on frontier-tier evidence).

### Closed since the last handoff

**The 2026-08-21/22 launch batch** — five defects found by DOING the release rather
than by reviewing it, which is worth noting on a repo that reviews everything:

- **`deploy.yml` authenticated with WIF that never existed** in this project — no
  pool, no provider, not even a `WIF_PROVIDER_DEV` to copy. The first prod deploy
  would have died at the auth step, before any guard it protects. Now a key, like
  dev (`40c2432`).
- **A `CORS_ORIGINS` with two origins could not be deployed at all** (`46c5c81`).
  One comma-delimited `--set-env-vars` cannot express a value containing a comma;
  gcloud split it and rejected the half with no `=`. REPRODUCED on the first prod
  deploy: the worker came up, the API did not. Dev never hit it because
  `CORS_ORIGINS_DEV` is unset and falls back to `*`. Fixed with the `^|^` delimiter
  plus a guard. **0 red** — nothing in the suite executes `deploy.sh`.
- **`emailFrom` and `webUrl` had no reachable surface** on an empty Firestore: no CLI
  flags, no field in the admin SPA, and the one route that carries them needs an
  admin SESSION whose whitelist lives in the doc you are trying to create. Closed by
  `--email-from` / `--web-url` on the CLI, with `main()` refactored to an exported
  `run(argv)` so tests drive the real commands (`86b49ef`, +4 tests, revert-verified
  4 red).
- **The pricing page overstated what every pack buys.** Essential went 5 → 8 credits
  in `ef9f02a` and the marketing copy never followed, so all three plans promised
  60-100% more essential reports than the credits cover. P-6's own instructions
  repeated the stale arithmetic. Corrected in the backlog (`5c41368`) and in the
  sandbox catalog; the LIVE catalog was created with the right numbers from the
  start.
- **The admin SPA linked prod jobs to the DEV app** — `VITE_APP_URL_PATTERN` defaults
  to the dev pattern and the prod workflow never passed it (`40c2432`).

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
