# Handoff — the entry point

Last updated 2026-08-25. For whoever picks this up without the conversation that
produced it. (No sha here on purpose: an earlier version named `ec66323`, a commit
that never touched this file, two edits before the one that left it — round 10,
R10-33. `git log -1 -- docs/plans/handoff.md` is the honest version of that line.)

**Read § State, then § Open. In that order.** § State is what is true right now and it
was re-measured, not carried forward. § Open leads with four things only Javier can do,
because this session ended with the oldest of them — two DNS records — still open while
the product grew from one transactional mail to five.

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

## Starting cold — the commands, and two checks no test can do

```bash
npm ci                       # a fresh worktree has no node_modules and no vitest
npm test                     # 1444 passed, 0 failed — READ THE EXIT CODE, not this line
npm run typecheck            # must be clean; it catches what the suites cannot
npx tsx docs/plans/m-red-team-reports/k-census-2026-08-19/run.ts   # the §K census
```

**Two checks the suite cannot do, because jsdom has no layout engine and no pixels.**
Both need a running site and a real browser, and both found defects nothing else could
see:

```bash
npm run dev -w @agent-researcher/fbizlab              # in one shell, then:
node apps/fbizlab/scripts/check-hero-contrast.mjs     # or pass a live URL
```

`check-hero-contrast.mjs` measures the rendered pixels behind every hero text element
and composites the text's own alpha over them. It exits non-zero under WCAG AA. Run it
against production after any change to the hero, the photograph or the palette.

And **read the served bytes, not the rendered page**, whenever SEO is in question:
`curl -s https://floridabizlabs.com/sample | grep -c '<div id="root"></div>'` is the
difference between what a crawler sees and what you see.

`npm test` chains the five workspaces with `&&`. A red core suite means the other
four never run, so **count the RED, never the passed** — and when you measure a
mutation, run the workspaces that actually exercise the code, not just the first one
that goes red.

Nothing in the suites spends money: `packages/core/test/no-paid-calls.ts` throws on
a real paid call, Firestore and Cloud Storage are mocked, and `TEST_LLM=ollama`
points every alias at a local model. If a test of yours needs a model, that is the
only tier you may use.

---

## State, 2026-08-25

**`main` and `deploy-prod` are both `2755410`.** Working tree clean. Everything below
is released and was verified ON THE RUNNING SYSTEM, not read off a workflow.

**Released to prod 2026-08-25: 19 commits** (`9a81480..2755410`) — eleven of round 11's
findings, the three startup guards, and the `signRead` deletion. Both prod workflows
green, and then MEASURED against the live system rather than the run log:

`/health` **200** in 0.22s — which is the check that mattered this release, because
`ccb8c6e` gives the API three reasons to REFUSE to start and this proves none of them
fired in prod · `/plans` returns scout 30 / investor 120 / syndicate 240 at $29/$69/$129
· CORS 204 with a matching `allow-origin` for `floridabizlabs.com` and **no header at
all** for an unlisted origin · `/`, `/es`, `/sample`, `/privacy`, `/sitemap.xml`,
`/robots.txt` all 200 · `$29/$69/$129` present in the SERVED landing HTML, not only in
`plans.json` · `/sample` canonical still its own.

The preconditions for the new guards were checked BEFORE promoting, not after:
`TURNSTILE_SECRET_PROD` exists, `deploy.sh` sets `APP_ENV=production` explicitly, and
dev had already come up on Cloud Run with the identical code.

**Suite, MEASURED by EXIT CODE:** `npm test` → 0, `npm run typecheck` → 0,
**1444 passed** (870 core + 258 api + 24 worker + 267 fbizlab + 25 admin), 23 skipped.
Read the exit code, not the `Tests N passed` line.

**Prod is live and sellable**, and 2026-08-24/25 was the largest day of change since
the launch: 20 commits, four of which fixed things that were actively wrong in front
of paying customers. What follows is grouped by what it cost, not by when it happened.

### Two promises prod was making and not keeping — both fixed and RELEASED

Round 11 found them; they had been live since the 2026-08-24 morning release.

1. **The dossier start mail promised refunds and failure notices.** Its footer said
   "if something goes wrong we return your credits, and you'll hear about it here", in
   four languages. Neither half was true: the only job mail fires on completion
   (`worker/src/index.ts`, guarded by `result.status === 'completed'`), and refunds are
   a human decision by design (`run-job.ts`, `credits/store.ts` both say so in
   comments). A buyer whose job held or failed did exactly what the mail said — closed
   everything — and then waited for a message that was never coming.
2. **The job screen told a HELD buyer to close the page**, and a test OF OURS pinned it
   there. A hold is an admin deciding, and one of the two decisions is REJECT, which
   sends nothing. `held` is the one live state whose likeliest end arrives nowhere but
   that page. The test asserting it read "a held job still gets it — it is live, and
   the wait is longer, not shorter": every clause true, and beside the point. Being
   live is not the test; having a mail waiting at the end of it is.

Fixed in `018dde1` with three more round-11 findings (see § Round 11 below).

### The SEO defect, which is the largest thing this repo has shipped past

An audit of the live site found that **every canonical, hreflang, `og:url`, `og:image`
and sitemap entry named `https://fbizlab.web.app` — a host that returns 404.** The
string `floridabizlabs` appeared ZERO times in the app's own source. A canonical is an
instruction to prefer another URL, and the URL being preferred did not exist.

On top of that, **seven public URLs served byte-identical homepage HTML**
(`md5(/) == md5(/sample) == md5(/privacy) == md5(/any-garbage-path)`), so the site's
entire crawlable surface was one page — and `/sample`, 34.5 kB of long-form copy and
the only page with enough substance to rank for anything but the brand name,
contributed nothing.

All of it fixed and live (`55c4c97`, `10527e7`, `a51e966`, `9a81480`). Full findings,
including what was measured as SOUND and what is deliberately NOT being done, in
`product-backlog.md` § P-14. The origin is now `SITE_URL` with **no fallback**, and the
build asserts on its own output — a wrong default is exactly what let this survive a
launch and two releases, because it looked like a working value.

### Everything else that shipped

| | what | where |
|---|---|---|
| P-10 | the job screen says the buyer may close it, and a start mail goes out with a link back | `6f272b5` |
| P-11 | a credit purchase leaves a receipt — ours, naming the CREDITS and the new balance, riding the grant's own idempotency | `6f272b5` |
| P-6 | the packs give **1.5× the credits** — Scout 20→30, Investor 80→120, Syndicate 160→240, prices unchanged. $/dossier fell $16.12 → $9.92 | dev AND prod catalogs, `ca85f6f` |
| P-13 | **anonymous** traffic counting, prod only — GA4 in cookieless consent mode | `f8772aa`, `1becfa0` |
| — | the hero photograph, the dashboard's cut-off primary action, and the credits FAQ that claimed 2–8 minutes against measured 17–20 | `37af52b`, `1346b31`, `b4d2664` |

### Verified live, 2026-08-25

`/health` 200 · CORS 204 for `floridabizlabs.com` and no header for an unlisted origin
· `/plans` returns 30/120/240 credits · `/`, `/es`, `/sample`, `/sitemap.xml`,
`/robots.txt` all 200 · canonicals on `floridabizlabs.com` · the ten sitemap URLs all
200 · `$29/$69/$129` and three `.card plan` in the SERVED HTML · `Organization` and
`Product`/`Offer` JSON-LD present, every marked price confirmed visible on the page ·
zero cookies and `gcs=G100` on every analytics ping · hero contrast clears WCAG AA at
seven widths.

**Google Search Console is connected**, verified by DNS TXT (durable — survives every
deploy, unlike an HTML tag a build would remove). The sitemap reads **Correcto**, 10
pages discovered.

### The DKIM that was there all along, and the check that missed it

**Mail DNS is complete as of 2026-08-25.** Measured against the authoritative
`ns45.domaincontrol.com` and confirmed identical on 8.8.8.8, 1.1.1.1 and 9.9.9.9:

| record | name | value | since |
|---|---|---|---|
| SPF | `@` | `v=spf1 include:spf.mtasv.net ~all` | 2026-08-25 |
| DKIM | `20260717155235pm._domainkey` | `k=rsa;p=MIGf…6wIDAQAB` | **2026-07-17** |
| Return-Path | `pm-bounces` | CNAME `pm.mtasv.net` | earlier |
| DMARC | `_dmarc` | `p=quarantine; adkim=r; aspf=r` | earlier |

The DKIM key is sound, not merely present: `p=` is **216 characters** (under GoDaddy's
255-char field limit, so it is not truncated — the usual way this record fails) and
`openssl rsa -pubin` parses it as a valid **1024-bit** RSA public key. `spf.mtasv.net`
resolves to four IPv4 ranges with `-all`.

**This file said DKIM was absent for weeks, and it was wrong.** Both this section's
predecessor and the § Open item were written from the same measurement:
`dig TXT pm._domainkey.floridabizlabs.com` → empty, therefore no DKIM. Postmark's
modern selector is a creation timestamp, and a 45-name sweep of plausible selectors
found nothing — the value is unguessable by construction.

**The signal was in the responses the whole time.** `pm._domainkey` returned
**NXDOMAIN** while `_domainkey` returned **NOERROR** with no answer. That pair is an
*empty non-terminal*: the parent node exists only because something is published
BELOW it. NOERROR-empty on `_domainkey` is positive evidence that a DKIM record
exists under some selector; NXDOMAIN on the selector you guessed is evidence about
your guess.

```bash
# the wrong check — proves a name, and reads as proving a class
dig +short TXT pm._domainkey.example.com

# the right one — asks whether ANY selector is published
dig _domainkey.example.com TXT +noall +comment | grep -o 'status: [A-Z]*'
#   NXDOMAIN → no DKIM anywhere.  NOERROR → a record exists; go read the provider for the selector.
```

This is **"a corpus proves a shape, never a class"** (round 10) in its DNS form: 45
selector names is a corpus, and absence across it is not absence. The general rule it
sharpens — **when a lookup is keyed by a name you had to guess, a negative result
measures the guess, not the world.** Ask the question that does not require the name.

**Still owed, and it is what actually settles this:** DNS records being correct is not
the same as mail being signed and aligned. Trigger a password reset for the prod
account `miltonjaviera@yahoo.com.ar` and read `Authentication-Results` on the raw
mail — `spf=pass`, `dkim=pass`, `dmarc=pass`, and `s=`/`d=` on the `DKIM-Signature`
confirming the selector above is the one Postmark actually signs with. Same principle
the Turnstile note below records: the running system is the instrument, not the DNS.


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

**Round 11 has now reviewed all of it** (2026-08-24) — and reviewed it THINLY, which is
not the same as cleared. Eight reviewers over 141 files by subsystem, 47 findings, 5
fixed; 25 of the survivors were never reproduced. See § Open → round 11 for what that
count is worth and what is still owed. Two of these are new public surface (`/sample`) or auth behaviour (verify
signs in), which is the class this repo's record says to weigh heaviest.

### The batch before it, reviewed by round 11 in the same thin pass (2026-08-20/21, `2a01ada..7a638c7`)

Rounds 1-10 are run and CLOSED (findings and stamps in `deep-review.md`). What came
after them is new behaviour, most of it touching money or prompts: the dispatch
deadline (C5, `91b5cfc`), buyer-facing 429 copy (`0bf39b3`), cost ceilings derived
from revenue (D1, `ef9f02a`/`041bd97`, essential 5 → 8 credits), open-ended modes
(`d7696f6`), the Stripe catalog write path (`d3f2d7d`, `87d51f9`, `021805a`,
`d3fa83d`), the admin economics screen (`2d5abd9`, `d120c1f`, `8475716`), the M-E1
prompt-echo redaction (`4950c8e`, `5fa80a7`), and link defusing + the catalog endpoint
(`c7da31d`, `c95bcfb`, `76323f8`).

## Going to prod — what is actually needed

**PROD IS RELEASED and has been re-released many times since.** Current state is in
§ State above, which is the section to trust; this one is the RUNBOOK for standing a
new environment up, kept because the next one repeats these steps in this order and
several of them cannot be brought forward.

**The release command, and the `--ref` that is load-bearing:**

```bash
git push origin main:deploy-prod                                 # fires BOTH prod workflows
gh workflow run "Deploy fbizlab SPA (prod)" --ref deploy-prod    # a re-bake, explicitly
```

A `workflow_dispatch` WITHOUT `--ref` runs on the default branch and publishes whatever
`main` happens to be — `deploy-fbizlab-prod.yml` only forces `deploy-prod` when the
event is `schedule`. A re-bake is needed whenever the Stripe catalog changes, because
the landing's prices come from `plans.json`, baked at BUILD time.

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
   the apex and no DKIM *at the usual selectors* — the qualifier that turned out to
   matter; see § "The DKIM that was there all along". If the sender is not verified,
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
   verifying requires having received the Postmark mail. The DNS picture as read that day looked
   unchanged (no SPF at the apex, nothing at `pm._domainkey`), and the conclusion drawn
   from it — that Postmark was sending on a SENDER SIGNATURE rather than a verified
   domain — **was wrong**. DKIM was already published under a different selector; only
   SPF was actually missing. Corrected 2026-08-25, § below.

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
`https://floridabizlabs.com/plans.json` agrees with the LIVE Stripe catalog — which is
the authority, not this file: `curl "…/plans?appId=fbizlab"` is the check, and as of
2026-08-25 it is 30/120/240 credits. Then run the end-to-end: register → verification
email → real purchase → job → PDF.

**And re-read the SERVED html, not just `plans.json`.** Since 2026-08-25 the prices are
baked into the landing markup and mirrored in `Product`/`Offer` JSON-LD; a catalog edit
that reaches `plans.json` but not the HTML means the rebuild did not run, and the
structured data is then claiming a price the page does not show — which is the one
thing Google issues manual actions over.

**A config gap this release did not close, and `9fc91fc` did** — this paragraph said
the opposite for a day, which is the defect it describes happening to itself. The
Turnstile SITE key WAS a hardcoded literal in `apps/fbizlab/src/config.ts` and in the
`|| '0x4AAA…'` fallback of both deploy workflows, with neither repo variable defined,
so every environment shipped the same widget and a rotation would have broken both
silently. It now comes from `VITE_TURNSTILE_SITE_KEY`, both workflows pass
`FBIZLAB_{DEV,PROD}_TURNSTILE_SITE_KEY`, and the build REFUSES to produce a
captcha-less bundle. `deploy-prod` is behind that commit, so PROD still ships the
literal until the next release — which is safe, because the literal is the right key.

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

## Security — what is open, RE-MEASURED 2026-08-25

Every item below was measured again today rather than carried over. Ordered by what
bites first.

1. **~~The domain's mail fails DMARC~~ — CLOSED in DNS 2026-08-25.** SPF, DKIM,
   Return-Path and DMARC are all present, aligned and propagated. See § "The DKIM
   that was there all along" below for what closed it and for the measurement error
   that kept this item open for weeks. What is NOT yet measured is the only thing
   that settles it: `Authentication-Results` on a mail the product actually sent.
2. **`publicAccessPrevention` is `inherited`, not `enforced`, on both buckets.**
   Nothing is public today and that was verified against the live project (uniform
   bucket-level access on, no `allUsers`/`allAuthenticatedUsers`, only the worker
   `objectAdmin` and the API `objectViewer`). But that is a current fact, not a
   property: one wrong binding reopens it. One command per bucket. **Javier — prod
   infra.**
3. **~~`signRead` / `signJobFiles`~~ — DELETED `f72496f`** (2026-08-25), along with
   `SignedFile` and the four test-mock stubs that were the only thing referencing
   them. `signReadToken` (`auth/tokens.ts`) is a different thing, is used in
   production, and is untouched. The comment left in `storage/gcs.ts` says where to
   go instead, because the next person to want read-without-a-session will want a
   scoped token the proxy verifies rather than a URL that answers to whoever holds
   it.

   **New, same family (`ccb8c6e`): the API now REFUSES TO START** on three
   configurations that used to be caught by a default and a log line —
   `APP_ENV=local` on a deployed service (`K_SERVICE` set, so auth, `requireAdmin`,
   the captcha, the credit checks and the rate limits would all be off in front of
   the public); `APP_ENV=local` with a `sk_live_` Stripe key (a laptop that can write
   the real catalog); and `TURNSTILE_FLOWS` declaring a captcha with no
   `TURNSTILE_SECRET`, which silently unguards every flow it names.

   **Know this before an incident:** the third one means that if
   `TURNSTILE_SECRET_PROD` is ever cleared or rotated to empty, the API will not come
   up rather than serve without a captcha. That is the intended trade — an empty
   `TURNSTILE_FLOWS` is the supported way to say a deployment runs without one — but
   it turns a silent degradation into an outage, which is a choice somebody should
   have made knowingly. `apps/api/src/startup-guards.ts`.
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

## Open — what Javier owes, what a decision blocks, and what nobody is blocked on

Three headings, not two. The first is new because this session ended with four items
that no agent can do and that are worth more than anything in the other two.

### ON JAVIER — nobody can do these, and the first one costs money every day

1. **~~SPF and DKIM in DNS~~ — CLOSED in DNS 2026-08-25**, the oldest item on this
   list. All four records are now present and propagated (verified against the
   authoritative `ns45.domaincontrol.com` and 8.8.8.8 / 1.1.1.1 / 9.9.9.9):
   `v=spf1 include:spf.mtasv.net ~all` at the apex (added today), DKIM at
   **`20260717155235pm._domainkey`** (there since 2026-07-17 — see below),
   `pm-bounces` → `pm.mtasv.net`, and `DMARC p=quarantine; adkim=r; aspf=r`.
   Postmark's Return-Path is a SUBDOMAIN of the `From` domain and `aspf=r` is relaxed
   alignment, so SPF alone should now carry DMARC. **One thing is still owed and it
   is the only one that proves this**: read `Authentication-Results` on a real
   product mail (trigger a password reset for the prod account
   `miltonjaviera@yahoo.com.ar`) and confirm `spf=pass`, `dkim=pass`, `dmarc=pass`.
   DNS records being correct is not the same as mail being signed.
2. **Google Search Console — read Páginas → Indexación.** The sitemap is submitted and
   reads *Correcto*, 10 pages discovered (2026-08-25). **Discovered is not indexed.**
   That screen answers the question the SEO audit opened — whether the dead canonical
   kept the site out of the index entirely — and it GATES the last open SEO item
   (baking `/sample`'s body, § P-9). Nobody has looked. Give it days, then look.
3. **Google Signals must be OFF** on the GA4 property (Admin → Data collection).
   Consent mode denies its inputs, but the switch is a console setting outside the
   repo, and "anonymous" is a claim the privacy notice now makes in four languages.
4. **`publicAccessPrevention` → `enforced`** on both buckets. Nothing is public today
   (verified: uniform bucket-level access on, no `allUsers`), but that is a current
   fact rather than a property. One command per bucket.

### Waiting on a decision (Javier), where the work only starts once he answers

- **E2 — may a dossier describe its own method?** "Write the prompt that would produce
  this report" copies the MESSAGE BODY — brief, section guidance, upstream sections —
  not the system prompt, so `redactPromptEcho` cannot catch it without deleting every
  legitimate quotation of a source. MEASURED: guarding the body redacts **8 fields of
  an honest, unattacked run**. A product question, not a longer regex.
  `test/red-team/e-extraction.test.ts` asserts it still reaches, so the day someone
  answers, the assertion says so.
- **E3's unblock script has still not been run**, and its approval no longer covers the
  case: approved 2026-07-31 *"because there is no production data yet"*. There is now.
  Anyone who accumulated four pre-screen rejections is blocked, including from buying
  credits, and nothing identifies them. Dry run (`npm run unblock:moderation`), read
  it, then `-- --confirm`.
- **N2 Stripe clawback** (policy), and the open design questions inside **P-1**,
  **P-2**, **P-4**, **P-5**, **P-12** in `product-backlog.md`.
- **`MAX_JOB_COST_USD` = $20** is now only a global clamp; it starts binding before the
  per-mode ceiling at roughly 42 credits.
- **Scout still buys ONE comprehensive dossier for $29.** 1.5× moved it 20→30 credits
  and its headline only went from "2 essential" to "3 essential". At **36** it buys
  **two**, and at $0.8056/cr it stays far above the new $0.5375 floor — so it would
  cost nothing in ceiling. Raised, unanswered.

### Open work, nobody blocked

- **ROUND 11 IS NOT CLOSED, and this is the biggest item on the list.** It ran
  2026-08-24 (`deep-review.md` § "Round 11"): eight subsystem reviewers over
  `20f361b..HEAD`, 141 non-docs files, each followed by one adversary. **47 findings,
  40 survived, 7 killed, 5 fixed in `018dde1`.**

  **Read that 40 with the discount the section leads with.** A 15% kill rate is LOW for
  a round instructed to default to refuted, and **only 15 of the survivors are
  reproduced — 25 are reasoned**. Those 25 are leads, not facts. Do not fix from one.

  **11 of the 35 are CLOSED** (2026-08-25), one commit each — the four reproduced P1
  first, then six more taken money-first: `d14e752` echo-book-1 · `019c8ae`
  enricher-swap-1 · `30c56eb` seed-1 · `23f78fc` confirm-sentence-1 · `d5df321`
  money-2 · `ac0e479` postmark-await-1 + email-hang-1 · `594e5ff` render-1 ·
  `96a751c` ceiling-profit-invert-3 · `907ee95` webhook-500-loop-1 · `000e20a`
  mod-jailbreak-leet-2. `npm test` exit 0, **1468 passed** (baseline 1444), typecheck
  exit 0, §K census re-run and unchanged.

  **24 open: 5 reproduced, 19 reasoned.** Take the five reproduced first —
  `money-5` + `ceiling-unpinned-1` are the same family (the worker's ceiling wiring
  is pinned by nothing: discard the live pricing doc and 51 tests stay green), then
  `vite-guard-env-1`, `vite-1`, `burst-429-lang-1`. **Do not trust a hand-count of
  what is left**; `deep-review.md` § "WHERE THIS STANDS" carries a command that
  counts them from the findings themselves, because a hand-count in this same
  session was wrong.

  **The rule this batch earned, and it is the one to carry: a reproduced finding
  proves the DEFECT, never the REPAIR.** Five of the eleven had a remedy that was
  wrong, incomplete or unnecessary — including one ("these two cannot be separated")
  that BOTH the finder and its adversary accepted and that measuring disproved in
  ten minutes. Full list, with the corollaries, in `deep-review.md`.

  Two more worth carrying up here: **`timeout` is not a command on macOS** (two
  "the mutation hangs the suite" readings were that error swallowed by a grep — check
  the measuring command's exit code too), and **the Ollama tier is up and worth
  using** (`TEST_LLM=ollama`): any finding whose severity rests on "the classifier
  would catch it" is an unmeasured claim, and the one time it was run, it was wrong.

  **Two of the four were reproduced in their CLAIM and wrong in their REMEDY**, which
  is the thing to carry into the rest of the round. `echo-book-1` asked for
  `promptEchoes` on the Checkpoint — that would double-book, since every dispatch is
  its own `runJob`. `confirm-sentence-1`'s obvious fix reproduces the defect one layer
  down, because `proposedParams` omits opt-in basics. **A reproduced finding proves
  the defect, never the repair.** Two tests of ours also turned out to be pinning the
  defect (`warnings).toEqual([])` on the retitle case; R10-6's fixture echoing a raw
  default) — the third round running to find one.

  What is owed, in order: **reproduce-or-kill the 25 reasoned findings**; then
  **re-run `prompt` and `spa`**, which are large slices that came back thin —
  `prompt` covers `redactPromptEcho` and the whole moderation stack in 26 files and
  returned three findings.

  **The method correction this round paid for:** one adversary per SLICE is too weak.
  By the tenth finding it has already agreed nine times, and agreeing is cheaper than
  reproducing. Spend the budget on **one refuter per finding**, even at the cost of
  fewer finders.

- **Bake `/sample`'s body** — `product-backlog.md` § P-9, confirmed and half fixed. Its
  HEAD is correct now (own canonical, own title), so a JS-executing crawler indexes it
  properly; the 34.5 kB of body copy is still absent from the served bytes. Doing it
  means a static renderer for the whole report shape, which is `ReportViewer` in
  another language. **Gated on ON-JAVIER item 2** — if the site is not in the index at
  all, this buys nothing yet.
- **Re-encode the hero photograph** to WebP/AVIF: 299,337 B baseline JPEG at 1457×720,
  no `srcset`, and it is the LCP element on desktop. One command, ~100 kB.
- **P-12** — the progress card shows ONE step and never says how far along a run is.
  The obstacle is not display: `buildSteps` calls `planWaves(t).flat()`, so agents that
  run in PARALLEL are emitted one after another and "step 5 of 11" would read as
  sequential progress for concurrent work. Nothing records that a step FINISHED either.
- **Alerting on the moderation fail-open.** `b4ee573` made it visible on the admin
  dashboard; nobody is PAGED. Needs a log-based metric and an alert policy.
- **`recordPromptEcho` has a counter and no surface.** The admin health strip is the
  obvious home.
- **F-5** — the deep-dive refiner rewrites a listing's `sourceUrl`, and not always to a
  listing: in `out/local-52835003` it replaced four of six, two with a different host
  and one with a SEARCH page. A buyer gets "source ↗" beside figures that does not open
  the listing they came from.
- **F-3** — a query cap must clear ≥512 characters, not the 300 the test assumed.
  **F-6** — the consecutive-plan breaker floor moved from 3 to 4.
- **The 15-word echo threshold is a bet**, and the only real report available to
  measure the legitimate side against ran in SPANISH against English prompts.
  Re-measure the first time a real English job exists.
- **C5's soft deadline is unmeasured against a REAL slow job.** 1500s derived from runs
  at 1241s and 1309s; nothing has been observed hitting it.
- **`signRead` / `signJobFiles` are exported from core and called by nobody** — the
  mechanism the authenticated proxy replaced. Deleting them is a small commit.
- **Never set in any environment:** `SEARCH_COST_PER_CALL_USD_*`,
  `BRAVE_COST_PER_CALL_USD_*`, `MAX_JOB_COST_USD_*` (repo *variables*). They fall back
  to code defaults, and the **Brave default is $0** — a paid Brave key without
  `BRAVE_COST_PER_CALL_USD_PROD` books every search at zero.
- **M-A2** (FENCE_RE near-misses, gated on frontier-tier evidence).

### Closed since the last handoff

**2026-08-24/25 — twenty commits.** Everything in § State above, plus the five round-11
fixes. Four of them were things actively wrong in front of paying customers, and
**none of the four was found by review**: two by round 11, one by screenshotting a
page at 375px, and one by loading production in a real browser. That is the pattern
worth carrying: this repo's reviews are strong, and the defects that reached customers
were still found by USING the thing.

The four:
- the start mail promising refunds nothing sends (round 11)
- the `held` job screen sending a buyer away (round 11, and a test of ours pinned it)
- the dashboard's primary action sliced 56px off a 375px phone (screenshot)
- every landing page view counted TWICE, because gtag fires its own `page_view`
  alongside the route effect (real browser, against production)

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
