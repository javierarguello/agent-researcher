# Product backlog

Things to BUILD, as opposed to things that are broken. Same conventions as the rest
of `docs/plans`: each item names the value and the cost, cites `file:line` for
everything it claims about the code today, and says what was verified by reading vs
what is still a hypothesis. Product decisions — numbers and scope someone has to
choose — are called out as such.

---

## P-1 · A dossier that compares TWO scenarios (locations, or industries) — `open`

**Asked for by Javier, 2026-08-18.** Today a request is one scenario: one
`location`, one `industry` (`packages/core/src/templates/florida-business-for-sale.ts:419`
— both are single strings in `paramsSchema`), and the whole report is written about
that one. A buyer choosing between Hialeah and Coral Gables, or between laundromats
and car washes, has to buy two dossiers and compare them by hand — and the two are
not comparable: they were researched by different runs, with different evidence,
different shortlists and no shared yardstick.

**What to build:** one dossier that researches TWO scenarios and says how they
differ. **Maximum two** — that bound is the point of the item, not a simplification:
the research budget, the evidence store and the report all scale with it, and three
scenarios is a different product (a screener), not a bigger version of this one.

**What it touches** (verified by reading, not built):
- `paramsSchema` — a second scenario has to be expressible without breaking the
  single-scenario request, and `validateRequest` now rejects retired keys but still
  strips unknown ones (`packages/core/src/index.ts:231`).
- The DAG (`florida-business-for-sale.ts:65`+): the producers are per-scenario
  (deal-scout, market-analyst, …) and would run twice; the synthesizers
  (exec-summary, charts) are the ones that would gain the comparison. Whether that
  is two sub-DAGs plus a comparison wave, or one DAG whose agents take a scenario
  argument, is the design question.
- Evidence: the store is shared across agents (`engine/prompt.ts` dossier tiers), so
  scenario A's results are visible to scenario B's writer. That is wrong for a
  comparison and is exactly what the `fetched`/`touched` tiers already know how to
  separate.
- Cost: ~2× the research turns. That is a MODE and a credit price, not a free
  option — `modes` (`florida-business-for-sale.ts`, `credits`) and the per-job cost
  ceiling both need a number.
- Report: a comparison section (side-by-side figures, a recommendation between the
  two) plus per-scenario sections, and the PDF/viewer have to render both without
  reading as one report printed twice.

**Product decisions, unresolved:** whether the two scenarios vary ONE axis at a time
(two locations, same industry — the clean case) or any two full parameter sets; the
credit price; whether `essential` may be compared at all or comparison is
`comprehensive`-only.

**Not started.** No code exists for this.

---

## P-2 · No location given → RECOMMEND where in Florida to look — `open`

**Asked for by Javier, 2026-08-18.** `location` is not required: it defaults to
`'State of Florida, USA'` (`packages/core/src/templates/florida-business-for-sale.ts:407`,
verified by reading). So a buyer who skips it gets a state-wide dossier — the
analysts search all of Florida, the shortlist is whatever the market happened to
surface, and nothing in the report tells them WHERE the opportunity actually is.
The only thing that fires today is a soft pre-flight finding
(`no_narrowing_filter`, `florida-preflight.ts` rules, `severity: 'info'`) saying a
narrower area gives sharper matches — advice the buyer cannot act on, because they
do not know which area.

**What to build:** treat "no location" as its own supported case rather than as a
missing field. The dossier should come back with a RECOMMENDATION of where to
look — the two or three Florida markets that fit the buyer's industry, budget and
filters, with the evidence for why (listing density, price levels, demographics,
competition), and the shortlist ordered by it. Always inside Florida
(`basePrompt`: *"Stay within the State of Florida unless the criteria explicitly
say otherwise"*, `florida-business-for-sale.ts:954`).

**Design questions, open:**
- Is this a section that only appears when `location` is the default (a
  `where_to_look` section, derived or agent-written), or a first WAVE that picks
  the markets and hands them to the existing producers as their scope? The second
  is better research and changes the DAG; the first is additive and cheap.
- If it is a wave, its output narrows every later agent's search — which is close
  to the buyer having typed a location, and should probably be shown back to them
  in the report ("we focused on Hialeah, Kendall and Fort Myers, because…").
- Interaction with P-1: "compare two locations" and "recommend a location" are the
  same machinery seen from two ends.
- Interaction with the assist: the "in your own words" box can FILL an empty
  location when the buyer's text names one (`fillable`, `florida-preflight.ts:150`).
  **Corrected 2026-08-20:** this line said "can now", and until `73fcf36` it could
  not — `validateRequest` applies the schema default, so `location` was never empty
  by the time the gate ran and no basic was ever proposed (round 10, R10-37). It
  works now, which makes this item's premise sharper rather than weaker: the assist
  can narrow a location the buyer's PROSE names, and this item is still the case
  where nobody named one anywhere.

**Not started.** No code exists for this.

---

## P-4 · The mode belongs in the right-hand card, where the price is — `open`

**Asked for by Javier, 2026-08-19**, with a screenshot of the current page. Today
the mode is section **02** of the form — two wide `modecard` buttons carrying the
label, the credit price and a one-line description
(`apps/fbizlab/src/pages/NewReport.tsx:842-855`) — while the right-hand sticky card
shows the mode as a read-only ROW (`:1001`) above `COST · 5 credits` and the
GENERATE button (`:1009-1030`). So the thing that sets the price is a screen away
from the price, and the card that adds up the order cannot change it.

**What to build:** move the mode SELECTION into the summary card, the way a checkout
lets you pick a plan or tick add-ons next to the running total — pick it where you
see what it costs. The reference Javier gave is a checkout's add-on/mode selector.

**What it touches** (read, not built):
- `NewReport.tsx` section 02 (`:842-864`) — the mode picker leaves it; the report
  LANGUAGE toggle currently lives in the same section and would be left alone in a
  renamed 02, or moved with it. That is a decision, not a detail: language does not
  change the price, so it may not belong next to the total.
- The summary card (`:994-1030`) — `nr-sumrows`' mode row becomes a control. It is
  the same `modes` array (`credits` per mode) that already feeds `cost` at `:359`.
- `nr-summary` / `nr-sumcard` / `modecards` / `modecard` CSS — the two wide cards do
  not fit a ~300px column; this needs a compact form (stacked rows with the price on
  the right, or a segmented control) that still shows each mode's price before the
  buyer commits, since that is the whole point of moving it.
- **The mobile path, which is where the real work is.** The summary card is
  `{!isMobile && (…)}` (`:993`): on a phone it does not render AT ALL, and the
  confirm dialog is what reviews everything. So moving the picker into that card
  DELETES the mode picker on mobile unless the mobile flow gets its own home for it
  — a step in the wizard, or a persistent bottom bar with the total. Javier's
  "responsive todo" is this.
- The confirm dialog and the pre-flight summary already state the mode; both read
  from the params, so neither changes.

**Product decisions, unresolved:** whether the language toggle travels with the mode
or stays in the form; what the mobile home for the picker is (wizard step vs sticky
bottom bar); whether the compact picker keeps the one-line description of each mode
or only its name and price.

**Not started.** No code exists for this.

---

## P-5 · Documentation the BUYER can read, inside the app — `open`

**Asked for by Javier, 2026-08-19.** A couple of pages, behind the login, that
explain the model: what each param actually does to the search, what comes out at
the end and how, and what the two tiers differ in. Today none of that is readable
by the person paying for it — the form's help texts are one line each and appear
only next to the field, and everything longer lives in `docs/`, which is written for
whoever is extending the code.

**What exists to build on** (verified by reading):
- The manifest already carries, per field and in FOUR languages, a `label`, a
  `help` line, a `placeholder` and suggestion chips
  (`florida-business-for-sale.ts:1059` for `paramsUi`, `:1109` for `i18n`), and the
  SPA already renders forms from it (`docs/model-ui.md`). A docs page that DERIVES
  from the manifest inherits every new param and every translation for free.
- The report's shape is equally declared: `sections`
  (`florida-business-for-sale.ts:504`) with a title and notes per section, `modes`
  with the credit price per tier, and `DIRECTIVE_FIELDS` with the closed
  vocabularies. "What comes out" is a rendering of `sections`, not new prose.
- `docs/models/florida-business-for-sale.md` covers much of the same ground for a
  developer, and is the warning as much as the head start: its params table still
  lists `keywords` as client input, which since `29f8593` is a hard error
  (`packages/core/src/index.ts:285`). A second hand-written copy of a moving thing
  drifts the same way — this is the defect the review rounds keep finding.

**What to build:** two or three pages, in the SPA, behind auth:
1. **The inputs** — every param, what it does to the research (not what it is),
   what happens when it is left empty, and which ones cost money to change. Derived
   from `paramsUi` + `i18n`, with a longer body per field kept next to the field's
   declaration so it moves with it.
2. **What you get** — the sections in the order they appear, what each is written
   from, how long it takes, and what a degraded section means when one is missing
   (the `sectionsNotice` copy the buyer already sees is the seam to explain).
3. **Essential vs comprehensive** — the two tiers side by side with their credit
   prices, read from `modes`.

**Product decisions, unresolved:**
- **Generated or written?** Deriving from the manifest is the anti-drift answer and
  the reason the manifest exists; prose that explains WHY a param matters is not in
  the manifest and would have to live somewhere new (a `docs` block per field in the
  template, or MDX per model with a test that pins it against the manifest's keys).
- **Behind the login or public?** Javier asked for internal, for authenticated
  users. The same pages are the strongest thing this product could show a stranger,
  so this is a real choice, not a default.
- **Which languages.** The app runs in four; a page that exists only in English
  inside a Spanish form is worse than a link. If the body prose is hand-written,
  four languages is the recurring cost.
- **A sample report.** The clearest possible answer to "what comes out" is one real
  dossier. It needs an anonymised fixture and a decision about hosting it.

**Not started.** No code exists for this.

---

## P-6 · A credit ladder where buying more is cheaper, and the MIDDLE is the buy — `applied 2026-08-24, dev AND prod`

**Asked for by Javier, 2026-08-20**, alongside the per-mode cost ceiling (D1's
engineering half, shipped in `ef9f02a`). Two goals in his words: buying more credits
should be *"un poquito más barato"*, and *"lo ideal es que compren siempre la opción
intermedia, que sería la recomendada"*.

**What is wrong today.** Read off `GET /plans?appId=fbizlab` on 2026-08-20:

| plan | price | credits | $/credit |
|---|---|---|---|
| Scout | $29 | 20 | $1.450 |
| Investor (`popular`) | $69 | 80 | $0.8625 |
| Syndicate | $129 | 150 | $0.860 |

It is not a ladder. Investor and Syndicate are the same price per credit — 0.3%
apart — so the top tier asks for **$60 more cash and returns nothing per credit**.
The whole discount is spent on one step (Scout → Investor, −40.5%) and then
saturates. Nobody has a reason to go up, and the middle is not a sweet spot; it is
just where the curve flattened.

**The change: `credits` only, no price moves.**

| plan | price | credits | $/credit | step |
|---|---|---|---|---|
| Scout | $29 | 20 | $1.450 | — |
| Investor (`popular`) | $69 | 80 | $0.8625 | **−40.5%** |
| Syndicate | $129 | **160** (was 150) | **$0.806** | **−6.5%** |

Monotonic and DECELERATING, which is the shape that makes the middle the buy: the
big drop is already banked by Investor, and Syndicate asks $60 more for a further
6.5%. That is the "un poquito más barato" exactly.

Only Product **metadata** moves — no new Price objects, nothing already purchased is
touched, and no code changes: nothing about plans is hardcoded in this repo (checked
by grep; the SPA renders whatever `/plans` returns, and price/credits/`popular`/`sub`
/`features` are all Stripe Product metadata, `apps/api/src/stripe.ts`).

**What must move WITH it, or the page lies — and it already does.** CORRECTED
2026-08-22: this paragraph used to say Syndicate's "≈8 comprehensive or 30 essential"
becomes 8 and **32**. That arithmetic assumed essential costs 5 credits, which stopped
being true in `ef9f02a`/`041bd97` (D1 re-priced it to **8** on the measured cost
ratio) and the marketing copy was never touched. Read off the live sandbox catalog on
2026-08-22, all three plans overstate what a pack buys:

| plan | `features` says | true at essential = 8 cr |
|---|---|---|
| Scout (20 cr) | ≈1 comprehensive or **4** essential | ≈1 comprehensive or **2** essential |
| Investor (80 cr) | ≈4 comprehensive or **16** essential | ≈4 comprehensive or **10** essential |
| Syndicate (160 cr) | ≈8 comprehensive or **30** essential | ≈8 comprehensive or **20** essential |

The comprehensive figures are right (18 credits: 20/18→1, 80/18→4, 160/18→8). Every
essential figure is inflated 60-100%. Each string exists in four languages —
`features`, `features_es`, `features_fr`, `features_pt`, pipe-separated — so this is
twelve edits, not one, and it is a claim made to a buyer about what their money buys.

This is the defect class the review rounds keep finding: a number copied into prose
stops tracking the value it was copied from. Nothing recomputes these strings, and
nothing tests them against `modes[key].credits`.

**The linked consequence, and it is the reason this is a decision rather than a
config edit.** `CREDIT_FLOOR_USD` (`packages/core/src/mode.ts`) is the cheapest a
credit is ever sold for, and `mode-ceiling.test.ts` uses it to assert that no job may
be allowed to cost more than the report it produced earned. Applying this ladder
lowers the floor **$0.86 → $0.806**, which tightens the essential mode:

| | earns at the floor | ceiling | margin at the ceiling |
|---|---|---|---|
| Essential (5 cr) | $4.03 (was $4.30) | $3.50 | **$0.53** |
| Comprehensive (18 cr) | $14.51 (was $15.48) | $10 | $4.51 |

Still not a loss, which is the property that matters — but essential's worst case is
now half a dollar. **Update `CREDIT_FLOOR_USD` in the same change**; the test fails
loudly if a ceiling ever crosses it, which is the direction that loses money.

**The open decision, with the numbers.** Essential is structurally thin: it costs
~$1.92 (inferred — no real run) and earns $4.03, a 52% margin against
comprehensive's 73%, and its ceiling is bounded by revenue rather than by cost.
Raising an essential report from **5 to 6 credits** takes it to $4.84 at the floor
and $1.34 of margin at the ceiling; 8 credits brings its cost-per-credit to near
parity with comprehensive. That is a change to `modes.essential.credits`
(`florida-business-for-sale.ts`, overridable per model in Firestore via
`/admin/pricing`) and it rewrites every "≈N essential reports" line in all three
plans and four languages. **Not taken.**

**Steps.** In PROD there is no migration at all — the catalog is being created from
scratch (2026-08-22), so the packs are simply created with these numbers:

1. Syndicate: `credits` **160**, price unchanged at $129.
2. The essential counts in all three plans, in four languages each: 4→2, 16→10,
   30→20. Twelve strings.
3. `CREDIT_FLOOR_USD` — **already done**: `config.ts:385` is 0.806 and its docstring
   says it anticipates this change. The floor is also DERIVED at runtime now
   (`syncCreditFloor`, `apps/api/src/index.ts:2834`, `min(priceUsd/credits)` over the
   model's packs), so creating Syndicate at 160/$129 derives exactly 0.806 and the
   stored value agrees with the default.
4. `npm test` — `mode-ceiling.test.ts` proves no ceiling crossed the floor. In the
   SANDBOX (where the old numbers are live) bust the plans cache or wait out
   `PUBLIC_TTL_MS`.

**Open, and it is small:** whether to apply the same to the sandbox so dev and prod
tell the buyer the same thing. Leaving dev wrong means the next person to read a
pricing page reads the wrong one.

---

### Applied 2026-08-24 — and then re-credited 1.5x on top of it

Javier: *"me parece caro lo que cobramos para los créditos que damos, ¿qué margen
tenemos para dar más créditos por cada plan?"* The ladder question and the margin
question turned out to be the same question, because of a coupling nobody had looked
at from this direction.

**The measurement.** Gross margin per comprehensive dossier was **75-86%** depending
on the pack (72-82% net of Stripe), against the three paid runs ever measured
($2.98 / $3.31 / $3.58). A buyer was paying **$16.12-$29.00 per report**. There was
a lot of room.

**But the margin is not what bounds this — the CEILING is.** `resolveModeCeiling` is
`credits x creditFloorUsd x (1 - expectedProfitPct/100)`, and `creditFloorUsd` is
`min(priceUsd / credits)` across the whole catalog. So **giving more credits lowers
what a job is allowed to spend**, automatically and with no deploy — which is D1's
design working exactly as intended and pulling the wrong way here. A job over the
ceiling does not fail; it parks as `held` and waits for an admin.

Modelled against the measured cost, this is the whole decision:

| x credits | ceiling (comp) | ceiling used | $/report at the top pack | gross margin |
|---:|---:|---:|---:|---:|
| 1.00x (before) | $8.71 | 41% | $16.12 | 75% |
| 1.25x | $6.97 | 51% | $11.73 | 69% |
| **1.50x (applied)** | **$5.81** | **62%** | **$9.92** | **63%** |
| 1.75x | $4.98 | 72% | $8.60 | 57% |
| 2.00x | $4.35 | **82%** | $7.59 | 51% |

1.5x was taken: the buyer's price per dossier drops **38%** and the ceiling still has
room for a run heavier than any of the three measured. At 2x a single heavier run
parks a paying customer's job.

**What was written**, through `PUT /admin/plans` — the API's own route, not the
Stripe SDK, so the credit-floor sync, the cache bust and the `plan.saved` log all
happened as they do from the Pricing screen:

| pack | price | credits | $/cr | now promises |
|---|---:|---:|---:|---|
| Scout | $29 | 20 -> **30** | $0.9667 | ~1 comprehensive or 3 essential |
| Investor | $69 | 80 -> **120** | $0.5750 | ~6 comprehensive or 15 essential |
| Syndicate | $129 | 160 -> **240** | $0.5375 | ~13 comprehensive or 30 essential |

Verified on both live systems: floor `$0.5375` **stored** (not the code default),
ceilings **$5.8050** comprehensive / **$2.5800** essential, and both landings
re-baked — `plans.json` is built from the catalog at BUILD time, so a Stripe edit
reaches the public page only on a rebuild. Dev and prod carry identical numbers.

**Two things done deliberately, both of which have bitten this repo before:**

- **The report counts were DERIVED from the mode credits, not typed.** Essential went
  5 -> 8 once and the marketing copy did not follow, so every pack promised 60-100%
  more essential reports than the credits covered. The script reads `modes.essential`
  and `modes.comprehensive` and computes the line.
- **The full per-locale copy was read back and re-sent.** `upsertStripePlan` now
  clears marketing keys it is not given (round 11, money-1, fixed the same day), so
  passing only `en` would have silently deleted es/fr/pt.

### Still open on this

- **Scout barely moved and it is the pack where "expensive" bites hardest.** At 30
  credits it still buys ONE comprehensive ($29 for one report); the headline only
  went from "2 essential" to "3 essential". At **36** it buys **two**, and at
  $0.8056/cr it stays far above the new $0.5375 floor — so it would cost nothing in
  ceiling. Raised with Javier, unanswered.
- **`essential`'s ceiling is now TIGHTER than comprehensive's** — 68% used versus
  62% — and essential's cost was never measured: the $1.75 comes from the template's
  own "~49% of comprehensive" ratio, not from a run. This is the number to watch.
- **`EXPECTED_PROFIT_PCT = 40` has never been touched.** Lowering it to 25 widens
  every ceiling by 25% without moving a price or a credit, and it is the right dial
  if more credits are wanted later — better than pushing the floor down blind.
- **Balances already bought are unaffected.** Someone who bought Syndicate before
  today holds 160; the same $129 now grants 240. Nearly theoretical at current
  volume, but it is an `admin/credits/grant` if anyone asks.

---

## P-7 · Edit the catalog in sandbox, publish it to live from the admin — `open`

**Asked for by Javier, 2026-08-21**, while creating the first LIVE packs by hand:
a tab in the admin's Pricing screen showing the SANDBOX catalog, editable there and
promotable to live with a button — and the same screen in the DEV admin able to edit
but never to publish.

**What blocks it today, and it is one line.** `apps/api/src/stripe.ts:16-20` builds a
single client from `config.stripe.secretKey`. A deployment holds exactly one key:
dev's is `sk_test_`, prod's is `sk_live_` (verified on the running services,
2026-08-21). So the prod admin cannot *see* the sandbox catalog — not a UI decision,
the API has nothing to ask with.

**The key already exists.** It is `STRIPE_SECRET_KEY_DEV`; nothing has to be created
in Stripe. What does not exist is its presence in prod — a GitHub secret only reaches
the workflow that names it, and `deploy.yml` passes only `STRIPE_SECRET_KEY_PROD`.

### Option A — a sandbox tab in the prod admin

1. `deploy.yml` passes `STRIPE_SANDBOX_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY_DEV }}`
   for prod; `deploy.sh` adds it to the API block **and to the `|`-delimiter guard**.
2. `stripe()` becomes `stripe(mode)` with two cached clients. Nine call sites today:
   `products.search` x2, `products.create`, `prices.create`, `products.update` x4,
   `products.retrieve` (`stripe.ts:143-303`), plus `checkout.sessions.create` and
   `webhooks.constructEvent` in `apps/api/src/index.ts`.
3. **The mode is accepted ONLY on catalog endpoints.** Checkout and the webhook never
   take it. This is the whole risk of the feature: a checkout created with the test
   client is a buyer who pays and never gets credits, and the webhook verifying a
   signature against the wrong account is the same failure from the other end. Pin it
   with tests before the tab exists, not after.
4. `POST /admin/plans/:planId/publish` upserts the live product by
   `metadata.appId + planId` — the key `resolveStripePlan` already identifies packs
   by. Prices are immutable in Stripe, so publishing a price change creates a Price
   and repoints `default_price`, exactly as `stripe.ts:278` already does.
5. It must carry the existing `expectedPriceUsd` guard: publishing IS a live price
   change, and the caller has to state the figure it believes it is replacing.

**The dev restriction falls out for free, and better than a permission.** The dev API
holds no live key, so `publish` cannot work there even if someone calls the endpoint
by hand. The UI hides the button when the API reports no live catalog configured —
capability, not a flag a client could ignore.

### Option B — export/import, no second key

Dev exports the catalog as JSON, prod imports it through the same upsert and the same
price guard. No live tab, no test credential in prod, most of the value.

### What to weigh

- Prod would store a test credential. The blast radius if it leaks is nil (test
  data), but it is one more secret to rotate — and reusing the `_DEV` secret means a
  dev-key rotation breaks prod's tab **silently**: the deploy still succeeds and the
  symptom is an empty tab or a 401 from Stripe. Alias it and say so in the workflow
  header.
- **Publishing moves more than prices.** The credit floor is derived from the live
  packs and every per-mode cost ceiling derives from the floor, so the button changes
  what a job may SPEND. The Pricing screen already previews that; the publish flow
  should show the preview for the post-publish state, not the current one.

**Not needed to launch** (noted 2026-08-21, mid first release): packs are created
directly in prod from the same form. This earns its place the first time editing
four-language copy twice in two environments is the actual annoyance.

---

## P-8 · The admin says which environment it is driving — `open`

**Asked for by Javier, 2026-08-22.** Nothing in the admin says whether it is dev or
prod. The header is `agent-researcher` plus a grape `admin` badge and the operator's
email (`apps/admin/src/components/Layout.tsx:31`, verified by reading); the two
deployments differ only in the URL bar
(`agent-researcher-dev-admin.web.app` vs `-prod-admin`, README § Environments) and in
one build-time value, `VITE_API_BASE_URL` (`apps/admin/src/config.ts:3`).

**Why it is worth building:** the admin is where the irreversible things happen —
`/pricing` writes the per-model credit overrides that DERIVE every job's cost ceiling
(`packages/core/src/credits/pricing.ts:97`), the catalog screens create, re-price and
retire live Stripe products (P-7), and users can be granted credits. "Which database
and which Stripe account is this?" is a safety question, and today it is answered by
reading the URL bar.

**What to build, in order of how much it is worth:**
1. **A badge that says the environment**, beside the `admin` one, coloured so dev and
   prod cannot be mistaken for each other at a glance.
2. **A link to the other environment**, so hopping dev↔prod is deliberate rather than
   a hand-edited URL.
3. **A mismatch warning** — see the product decision below.

**Product decision, unresolved — where the badge gets its answer.** Two sources, and
they are not equivalent:
- *Build time* (`import.meta.env`, a new `VITE_ENV` or one derived from the API URL):
  free, but it states what the bundle was BUILT for. A prod bundle deployed to the dev
  site — or a local `npm run dev` pointed at the prod API by an `.env` — says the
  comforting thing while the writes land somewhere else.
- *Runtime* (the API answers): honest, because what matters is which Firestore and
  which Stripe the click reaches, and only the API knows. `config.env` exists
  (`packages/core/src/config.ts:49`) but is exposed by no endpoint — `/health` returns
  `{ ok: true }` and nothing more (`apps/api/src/index.ts:267`), so this is a small
  API change plus one more field on a response the admin already makes.

The runtime answer is the one that cannot lie, and it makes (3) possible: badge what
the API said, and shout when the build disagrees with it. Whether `/health` grows the
field or it rides the admin session response is the open call; `/health` is
unauthenticated, so anything added there is public.

**Not started.** No code exists for this.

---

## P-9 · The public sample dossier is client-rendered, so a crawler may see nothing — `confirmed 2026-08-24; head fixed, body still open`

**Raised while building it, 2026-08-23.** `/sample` renders a real dossier from
`public/sample-dossier.json` (`apps/fbizlab/src/pages/SampleReport.tsx`), and `App`
marks it `index, follow` — correctly: it is the one page that shows what the product
actually produces, and it is now the destination of the hero's "see a sample summary"
and of the "Inside a summary" section.

But the landing's SEO comes from `scripts/prerender-seo.mjs`, which emits one static
HTML file per language with a localized `<head>` and JSON-LD, and it knows nothing
about this route: a request to `/sample` serves `index.html`, so a crawler that does
not run JS sees the ENGLISH LANDING'S title and description over an empty body, and
one that does run JS sees a dossier with the landing's `<head>`.

**What to build:** the sample's own `<head>` (title, description, canonical,
og:image) and, if it is worth it, a prerendered body. The body is the expensive half
and the decision: the report is 196 kB of JSON and prerendering it means shipping a
second copy as HTML. The `<head>` alone is cheap and gets most of the value.

**Product decision, unresolved:** whether the sample is a marketing PAGE (prerender
the executive summary and the shortlist, let the rest hydrate) or a demo behind a
link (head only, leave it out of `sitemap.xml`). It is currently NOT in the sitemap,
which is the honest state for a page whose content a crawler may not see.

**Not started.**

---

### Confirmed, and half fixed — 2026-08-24

An SEO audit measured it rather than suspecting it. Raw `curl` of `/sample` was
**byte-identical** to the landing; rendered in Chrome it was **34,536 characters**
of copy against the landing's 5,529, under an `<h1>Florida Businesses for Sale —
Buy-Side Research</h1>`. Six times the landing's content, and the only page on the
site with enough substance to rank for anything but the brand name.

It was invisible twice over. A crawler that does not run JS saw the homepage. A
crawler that DOES run JS saw the content — under the homepage's `<title>` and a
canonical pointing at `https://fbizlab.web.app/`, a host that 404s.

**Fixed (`55c4c97`, `10527e7`):** `/sample` is prerendered with its own canonical,
title, description and og/twitter tags, and it is in the sitemap. Google executes JS,
so the page is now indexable under the right identity — which is most of the value.

**Still open, and it is a real project rather than a patch:** the 34.5 kB of body copy
is still absent from the served bytes. The landing has `landing-static.mjs` to bake
its content; the dossier has no equivalent, and writing one means a static renderer
for the whole report shape — sections, tables, charts, citations — which is
`ReportViewer` in another language. The data is not the obstacle
(`public/sample-dossier.json`, 43 kB, already static); the renderer is.

Worth doing only if `/sample` shows crawl activity once the canonical fix takes
effect. Check Search Console first — measuring before building is the whole point.

---

## P-10 · A dossier makes the buyer watch a screen, and nothing says they don't have to — `done (both halves)`

**Asked for by Javier, 2026-08-24**, looking at `/app/jobs/:id` on a running
comprehensive job.

A comprehensive run takes ~20 minutes (three measured: 18, 20 and 17 min,
`out/local-*`). The screen polls and shows the live agent, and it says **nothing**
about what happens if you close it — `JobView`'s copy table is status labels and
nothing else (`apps/fbizlab/src/pages/JobView.tsx:19-22`, verified by reading). So the
buyer's reasonable model is "if I close this, I lose it", and they sit and watch a
progress line for twenty minutes.

They do not have to: **the completion email already exists.** The worker sends
`reportReadyTemplate` with a deep link to the job the moment it finishes
(`apps/worker/src/index.ts:35`), in the report's language, and it carries the
degraded-sections notice when there is one.

**What to build, smallest first:**
1. **Say it on the screen.** One line under the status while the job is live
   (`JobView.tsx:46` already computes `live`): we will email you when it is ready,
   you can close this. Copy in four languages, into `copy-parity.test.tsx`'s tables.
2. **An email when the dossier STARTS**, not only when it ends — so the buyer has a
   thread in their inbox from the beginning, and a link back.

**Two things to settle before either is written:**

- **Do not promise mail we do not send.** The worker sends nothing unless the app doc
  has BOTH `emailFrom` and `webUrl` (`apps/worker/src/index.ts:22`, an early return).
  `fbizlab` has both today, but the SPA cannot see them — it knows an `appId`, not the
  app document. Either the manifest/session grows a `notifies: true` flag the screen
  can read, or the line ships as a claim that is true for one app by coincidence.
- **Is the start email worth its noise?** It arrives ~1 second after a click the buyer
  just made, on the screen they are still looking at. Its value is the thread and the
  link back for later; its cost is a second message per job. If (1) lands well, (2)
  may be redundant — the honest order is (1), then ask.

**And a dependency that outranks both** (see `handoff.md` § Security): the domain's
mail currently fails DMARC — `p=quarantine` with SPF and DKIM both absent — so
transactional mail is being quarantined by policy. Adding two more emails before those
two DNS records exist multiplies the "it never arrived" surface rather than removing
the wait.

---

### Built, 2026-08-24 — both halves, on Javier's call

He took (2) as well rather than waiting to see whether (1) was enough: the thread in
the inbox is the point, and it has to exist from the beginning to be a thread.

**Both open questions were answered by building them, not by assuming:**

- **"Do not promise mail we do not send"** is now a fact carried on the JOB.
  `POST /research` reads the app record ONCE at creation and stores
  `ResearchJob.notify` from **the sender's own condition** — `emailFrom` AND
  `webUrl`, both, which is exactly what `notifyReportReady` returns early on. The
  API publishes it as `notify` on `GET /research/:jobId` and `JobView` gates the
  sentence on it. `job.notify === true`, so every job in prod that predates the field
  reads FALSE and the screen simply says nothing — silence costs a buyer a wait, a
  wrong promise costs them a dossier they believe is being mailed to them.
  Not computed per poll: that screen polls for twenty minutes, and this is a fact
  about the job, decided when the buyer pressed the button.
- **The sentence itself**, in four languages (`JobView.T.closeOk`, so
  `copy-parity.test.tsx` covers it for free). Javier's wording: *"you can relax and
  close this page"* — "Puedes cerrar esta página con tranquilidad: te avisamos por
  correo apenas tu dossier esté listo."
- **The start mail** is `reportStartedTemplate`, sent from the API once the job is
  QUEUED — so it never announces a dossier that failed to enqueue and was refunded
  three lines earlier. It carries **the link back to the job**, in the HTML and in the
  text part, which is what makes closing the tab free.
  In the **report's** language (`paramsLang(validated.params)`), not the UI's, so the
  two mails about one dossier do not arrive in two languages.
  It names **no duration**: the three measured comprehensive runs were 18/20/17
  minutes, `essential` is a different job, and no template declares an estimate — a
  test asserts no figure appears in any language.
  It is best-effort and cannot take the 202 down; a dead Postmark costs the mail and
  not the job, with the credits still spent on a job that is really queued.

Tests: `apps/api/test/notifications.test.ts` (13), `packages/core/test/email-language.test.ts`
(the two new mails folded into the existing per-language loops, plus their own block),
`apps/fbizlab/test/job-view.test.tsx` (+5). **Thirteen mutations revert-verified, all
red** — including one that measured **0 red** on the first attempt and was rewritten:
see P-11's note, the same test.

**Still owed, and it is not code:** the DMARC records. See `handoff.md` § Security 1.
Everything above is a mail into a `p=quarantine` domain with no SPF and no DKIM.

---

## P-11 · Buying credits leaves no receipt — `done (ours, not Stripe's)`

**Asked for by Javier, 2026-08-24.** The Stripe webhook grants the credits and sends
nothing: `checkout.session.completed` / `async_payment_succeeded` land at
`apps/api/src/index.ts:2063`, the metadata is read and `grantCredits` runs, and there
is no `sendAppEmail` anywhere in that block (verified by reading — the file's only
three send sites are verify-email, password reset and contact, at `:484`, `:626` and
`:748`). So the only trace of a purchase a buyer keeps is their card statement and
whatever Stripe itself decides to send.

**What to build:** a confirmation on a successful grant — what was bought, how many
credits, the new balance, and a link into `/app/credits`. The ledger already holds
everything it needs (`credits/ledger`, idempotent per event), and the app doc has the
sender.

**Product decision, unresolved — ours or Stripe's.** Stripe can send its own receipt
(Dashboard → Customer emails), which costs no code and looks like Stripe. Ours can
name the CREDITS rather than the charge, link into the app and carry the balance,
which is what the buyer actually wants to know. They are not exclusive; sending both
is the one option that is clearly wrong.

**Where the care goes if it is ours:** the webhook is retried by Stripe, so the send
belongs behind the same idempotency the grant uses, or a retried event mails the buyer
twice for one purchase. The grant is already idempotent per event id; the mail has to
ride the same key, not a second one.

Same DMARC dependency as P-10: a receipt that lands in spam is worse than no receipt,
because this one a buyer goes looking for.

---

### Built, 2026-08-24 — OURS, decided by Javier

Stripe's own receipt names the charge; ours names the CREDITS, which is the thing the
buyer opens the app to check. `creditsPurchasedTemplate`, four languages: the pack, the
credits added, what was paid, the **new balance**, and a button into `/app/credits`.
Stripe's Customer-emails receipt stays OFF — sending both was the one option that was
clearly wrong.

**Where the care went, and both halves were the ones flagged in advance:**

- **It rides `res.applied`.** `recordPurchase` is idempotent by `paymentId`; Stripe
  delivers at least once and retries for days. The mail sits INSIDE the same
  `if (res.applied)` that guards the analytics fold, so a redelivery grants nothing and
  mails nothing. A buyer holding two receipts for one purchase reasonably concludes
  they were charged twice. `balance` comes out of the grant's own transaction, so it is
  the balance this purchase produced — not a re-read a concurrent job may have spent
  against.
- **It cannot throw.** `sendPurchaseReceipt` catches everything and logs
  `credits.receipt_failed`. A throw here is a 500 that Stripe retries for days and can
  disable the endpoint — which would stop EVERY other customer's credits from landing
  over one mail outage. Postmark being down costs one receipt.
- **The webhook has no request to read a language from** — it is Stripe calling us,
  possibly hours later for a delayed payment method. So `POST /credits/checkout` now
  writes `lang` (from `errorLang(req)`, which is the buyer's switcher: the SPA sets
  `accept-language` from it on every call) and `planName` into the SESSION metadata.
  Without those the receipt is English and names no pack.
- **The pack name is escaped.** It is typed by a person into the admin's Pricing form,
  travels through Stripe metadata, and lands in HTML built by string concatenation.
  `shell()` grew a `rows` block that takes PLAIN TEXT and escapes both halves itself,
  rather than trusting callers.

Tests in `apps/api/test/notifications.test.ts` and `packages/core/test/email-language.test.ts`.

**One test failed its own revert-verify and was rewritten**, which is the rule working:
"drops the amount line rather than printing $0.00" only passed `amount: undefined`,
while the guard it existed for is `> 0` — mutating `amount != null && amount > 0` down
to `amount != null` measured **0 red**. Zero is not hypothetical: `/credits/checkout`
sets `allow_promotion_codes: true`, so a 100%-off coupon produces a real paid session
with `amount_total: 0`. The test now covers missing AND zero, plus a control that the
row does appear when there is a total. Both mutations now measure 1 red.

**Still owed, and it is not code:** the DMARC records — `handoff.md` § Security 1. This
is the mail a buyer goes looking for, so it is the worst one to leave in a spam folder.

---

## P-12 · The progress card shows ONE step and never says how far along you are — `open`

**Asked for by Javier, 2026-08-24**, looking at `/app/jobs/:id` mid-run: the card
names the agent currently working (`Deep dive refiner`, its objective, and one live
line — "Reading a source in full.") and nothing else. There is no sense of *seven of
eleven*, no list of what is done, no list of what is left. Wanted: the steps done and
the steps remaining, or at least the remaining ones.

**What already exists, verified by reading:**

- The manifest publishes the **ordered step list** — `buildSteps`
  (`packages/core/src/templates/registry.ts:66`): `planning`, then every agent in
  `planWaves(t).flat()` order, then `assembling` / `done`, then the non-linear ones.
  `JobView.tsx:47` already fetches it and builds `stepsById`.
- `job.progress.phase` says which step is live, and `clientProgress` gives the kind of
  work (and a search's query) in the reader's language.

So the *list* is already on the client. What is missing is the ability to say where in
it we are — and that is not a display problem.

**Why it is not just a UI change — three real obstacles:**

1. **The step list is FLATTENED, so it is not a line.** `buildSteps` calls
   `planWaves(t).flat()`: agents that run **in parallel** are emitted one after
   another and the wave boundaries are thrown away. "Step 5 of 11" over a flat list
   reads as sequential progress for work that is concurrent — three agents in one wave
   would all be "the current step", and the number would jump by three at once. Either
   the manifest keeps the waves (`steps` grows a `wave` index, or becomes
   `StepInfo[][]`) or the count is a lie in exactly the runs that take longest.
2. **`LIFECYCLE_OTHER` is in the same array and is not part of the sequence** —
   `incomplete`, `failed`, `held` are appended for label LOOKUP
   (`templates/phases.ts:20`, and the comment there says so). Any naive
   `indexOf(currentPhase) / steps.length` counts three phases that never run.
3. **Nothing records that a step FINISHED.** `job.progress` is a single current
   phase, not a history. Marking earlier steps done by their position in the flat
   list is (1) again; doing it honestly means the engine writing a completed-step
   record — which is the "todos los modelos informan el progreso con más detalle"
   half of the ask, and it is per-template work, not one patch.

**What to settle before building:**

- **Done+remaining, or remaining only?** Remaining-only needs no history — it is
  derivable from the wave the current phase sits in — so it is dramatically cheaper
  and may be all the reassurance the wait needs. Done+remaining needs obstacle 3.
- **Is a step count what the buyer wants, or is it TIME?** "4 of 11" over waves of
  unequal length does not mean 36%; the deep-dive refiner alone is a large share of a
  comprehensive run. A step list that implies a fraction it does not have is worse
  than the single line there now.
- **How much does it matter once P-10 lands?** P-10's whole point is that the buyer
  does not have to watch. If they close the tab, this card is not being read.

**Depends on P-10** for exactly that reason: build the "you can close this" line
first, then measure whether anyone still sits on this screen.

**Not started.**

---

## P-13 · Nobody knows how many people visit — `done (anonymous half); distinct-user counting still open`

**Asked for by Javier, 2026-08-24.** Add Google Analytics so we can measure traffic.

**What exists today: nothing.** Grepped — no `gtag`, no GTM, no Plausible, PostHog,
Mixpanel or Umami anywhere in `apps/fbizlab`. The system has good FIRST-PARTY
numbers about people who already signed up (`recordPurchaseStats`, `/me/stats`, the
admin dashboard: users, purchases, revenue, credits) and **zero** about the step
before that. We cannot answer how many people saw the landing, what fraction reached
`/sample`, or where any of them came from — which is exactly the number that says
whether the product has a demand problem or a conversion problem.

**Technically it is small.** Neither Hosting target sets a `Content-Security-Policy`
(`apps/fbizlab/firebase.json` sends only `Cache-Control`), so a third-party script
tag is not blocked by anything today. The measurement id would follow the pattern
every other build-time value already uses — a repo variable per environment
(`FBIZLAB_{DEV,PROD}_GA_ID`) read in `vite.config.ts`, never a literal, and dev must
not report into prod's property.

### The thing that makes it NOT small

**The Privacy Notice currently promises the opposite, in four languages.**
`apps/fbizlab/src/pages/Legal.tsx` § "What we store":

> "We store your account email (and name, if you provide one) and the research
> summaries you generate. **That's it.** We don't build advertising profiles,
> **track you across the web**, or sell or share your data."

GA4 sets a first-party identifier and sends behavioural data to Google; with Google
Signals or ads features on, "track you across the web" is a plain description of
what it does. Shipping the tag without rewriting that paragraph makes the privacy
page false — and this repo spent 2026-08-24 fixing three separate instances of
exactly that (the start mail's refund promise, the `held` close-page line, the
credits FAQ's "2–8 minutes"). The notice is `Updated July 2026` and that date has to
move with it.

**So the work is, in order:**

1. **Decide what we are willing to promise.** The current paragraph is a real
   selling point on a page about handing an AI your acquisition thesis. Three honest
   shapes, and it is a product decision, not an engineering one:
   - **GA4 with ads features and Signals OFF.** Cheapest to reconcile: the notice
     changes from "we don't track" to "we count visits", advertising profiles stay
     truthfully denied. Still Google, still a third-party identifier, still needs the
     paragraph rewritten in four languages.
   - **A cookieless analytics product** (Plausible, Fathom, Umami). Keeps the notice
     almost as it stands, no consent banner, costs money, and gives less than GA.
   - **GA4 as it comes.** Most data, and the notice loses a paragraph the brand is
     currently making a point of.
2. **Consent, and whether we need a banner.** The landing ships in en/es/fr/pt — the
   last two are not decoration, they are the EU and Brazil. A consent gate is the
   difference between "add a script tag" and "add a UI, a stored preference, and a
   path where analytics never loads at all".
3. **Only then the tag itself**, and the SPA half nobody remembers: this is a client
   -routed app behind `cleanUrls` + the `**` rewrite, so one `page_view` fires at
   load and every subsequent route change fires none unless something sends it. The
   landing is also PRERENDERED (`scripts/prerender-seo.mjs`), so `/`, `/sample` and
   the legal pages are real documents and the rest is not.
4. **Decide whether it runs inside `/app` at all.** Measuring the logged-in product
   means associating page views with people who have paid us, which is a different
   promise from counting anonymous visitors to a marketing page. The cheap and
   defensible first version is public pages only.

**A cheaper thing worth pricing first:** Firebase Hosting already logs every request,
and the API already writes structured events to Cloud Logging in the same project.
A log-based count of landing requests answers "is anyone arriving?" with no third
party, no consent question and no privacy rewrite — it just cannot tell you where
they came from. If the real question is "is the traffic there at all", that is a
dashboard, not a dependency.

---

### Built 2026-08-24 — the ANONYMOUS shape, which is why the privacy notice survived

Javier asked for Firebase Analytics, then for it to be **anonymous**, then asked the
question that decides everything: *"¿con esto podemos saber si el tráfico es de
distintos users o el mismo?"* The answer is no, and he kept it anyway. That trade is
the whole entry.

`setConsent({ analytics_storage: 'denied', ad_storage: 'denied', ad_user_data:
'denied', ad_personalization: 'denied' })`, called **before** the SDK is handed a
config — GA4 cookieless mode. No `_ga` cookie, no persisted client id, nothing that
follows a person between sessions or sites. The ordering is the feature, not a
detail: consent applied after `getAnalytics` is consent applied after the first
cookie is already written, and a test asserts the order rather than the call.

**Because it is cookieless, the promise this item was written to protect never had to
change.** The notice still says "we don't build advertising profiles, track you
across the web, or sell or rent your data" — and that is TRUE of cookieless pings. A
"Counting visits" section was ADDED in four languages saying what runs, that nothing
is written to the device, and that there is nothing to opt out of because nothing is
stored. Privacy pages' `Updated` moved to August; terms and support did not change
and kept July. **No consent banner is required**, which is the other thing cookieless
bought.

**The path GA sees is a security control.** `/verify?token=…` and `/reset?token=…`
carry single-purpose auth tokens and `/report/:jobId?rt=…` carries the share token
that IS its authorization — the stock page-view snippet sends `pathname + search` and
would have put live credentials in Google's logs. Query strings are dropped whole (a
deny-list is one new `?foo=` from leaking) and path ids become the route's shape.

**Prod only, by absence.** Nothing initializes without
`VITE_FIREBASE_MEASUREMENT_ID`; only `deploy-fbizlab-prod.yml` passes it, so dev,
local builds and the entire suite report nowhere because the id is not in the bundle.
Measured: SDK in lazy chunks (~80 kB raw), main bundle **+2.3 kB**.

Firebase Web App `fbizlab-prod` (`1:468953338236:web:b58d2535fe7e223da114f9`),
measurement id `G-S0RDNZWJRL`; the project already had Google Analytics enabled.
Seven `FBIZLAB_PROD_FIREBASE_*` repo variables; dev has none, deliberately.

### What is STILL open, and it is the question that was asked

**Distinct users.** Cookieless means GA cannot tell 300 visits by 300 people from 300
visits by 3 — GA4 only *models* users, and modelling needs traffic thresholds this
site is nowhere near, so it will show nothing. Volume, referrer, geo and device all
work; "how many people" does not.

Three ways forward, in the order they were put to Javier:

- **Leave it (chosen).** Enough for "is anyone arriving, and from where".
- **Grant `analytics_storage`.** One line of code, and then: a cookie, a privacy
  paragraph rewritten in four languages, and — because the landing ships in fr/pt,
  which is the EU and Brazil — a consent banner, which is a UI, a stored preference
  and a path where analytics never loads. Not a toggle, a feature.
- **Count distinct IPs from Hosting logs.** Firebase already logs every request in
  the same GCP project. Distinct-IP-per-day is a rough but honest proxy that touches
  no device, needs no consent and changes no copy. Wrong at the margins (NAT, mobile)
  and decisive at the order of magnitude, which is the actual question today. Not
  built.

**One thing the code cannot enforce, written here instead: Google Signals must stay
OFF on the GA4 property.** Consent mode denies its inputs, but the switch is a
console setting outside the repo.

---

## P-14 · SEO — what the audit found, what shipped, and what is left — `partly done`

An SEO audit of the live site, 2026-08-24. Its three P0 findings were one story: **the
site's crawlable surface was a single page, and that page instructed Google to prefer
a URL that does not exist.**

### Shipped (`55c4c97`, `10527e7`)

| | what it was | evidence |
|---|---|---|
| Canonical / hreflang / og / sitemap | all named `https://fbizlab.web.app` | that host returns **404**; the string `floridabizlabs` appeared **zero times** in `src`, `public`, `index.html`, `scripts` or `package.json` |
| Seven public URLs | byte-identical to the homepage | `md5(/) == md5(/sample) == md5(/privacy) == md5(/any-garbage-path)` |
| `/sample` | the site's only long-form page, unindexable | see § P-9 |
| `/es` `/fr` `/pt` | orphans — nothing linked to them | switcher was `<button>`, static header had no switcher, sitemap and hreflang named the dead host |
| `/report/*` `/verify` `/reset` | served `index, follow` | their `noindex` is applied by React after mount and never reaches the bytes |
| Hero photograph | undiscoverable until hydration | `landing-static.mjs` emitted `section.container`, `Landing.tsx` emits `section.hero-shot`; the photo is a CSS background on the class that was missing. Fetch at 2780 ms, paint at 5218 ms on throttled mobile |
| dev | fully crawlable duplicate of the marketing site | same robots.txt, and it canonicalized to the dead host too |

The origin is now `SITE_URL` with **no fallback** — a wrong default is exactly what let
this survive a launch and two releases, because it looked like a working value — and
the build asserts on its own output (no `__SITE__` token left, no trace of the dead
host in the twelve emitted files).

### Open, in the order worth doing

1. **Check Google Search Console.** Nobody has. It is the only way to know whether the
   dead canonical kept `floridabizlabs.com` out of the index entirely, and it is the
   measurement that says whether any of the rest is urgent. Needs Javier's access.
2. **Bake `/sample`'s body** for crawlers that do not execute JS — § P-9. Gate it on
   (1): if the page is being crawled and indexed now, this buys a lot; if the site is
   not in the index at all, it buys nothing yet.
3. **`Product`/`Offer` JSON-LD for the three credit packs**, and it has a prerequisite
   that is the actual work: the prices are fetched client-side from `/plans.json` and
   are **not in the served HTML** (`grep -c '\$29\|CREDITS'` → 0). Marking up prices a
   crawler cannot see in the page is precisely the kind of structured data not to add.
   Prerender the pricing block first. `Organization` JSON-LD is honest today and is one
   block in `index.html`.
4. **Per-route title/description for the private app** is NOT needed — those routes are
   disallowed, so their titles have no SEO value.
5. **Re-encode the hero photograph** to WebP/AVIF: 299,337 B baseline JPEG at 1457×720,
   no `srcset`. One command, ~100 kB saved on the LCP element.

### Deliberately NOT doing

- **Soft 404s.** Garbage paths return 200 with the landing (`App.tsx`'s `path="*"`
  redirect). The audit recommended no action and that is right: no user-generated URL
  space, no external links to broken paths, and a correct canonical consolidates them
  onto `/` anyway.
- **`<img>` instead of a CSS background for the hero**, to reach Google Images. It is a
  generic Florida street scene, not product imagery anyone searches for.
- **`Review` / `AggregateRating` / `BreadcrumbList`** — the site has no reviews and no
  breadcrumb hierarchy. Markup for content that does not exist is a penalty waiting.

### Measured and sound — do not re-check without new evidence

Redirects (http→https, www→apex, `/index.html`→`/`, `/es.html`→`/es`, all 301);
Brotli on HTML; TTFB 112 ms throttled; immutable caching on `/assets/**`; one `<h1>`
per page; copy is real indexable text, not images; `alt` attributes correct; CLS
0.042; the hreflang SET is complete and reciprocal with `x-default` (only the host was
wrong); `FAQPage` JSON-LD is legitimate — its visible text really is in the served
HTML.

---

## P-3 · Two ways to say what you want: the box, or the fields — not both at once — `done (16e7014 → 2bf0b97 → c0805a7 → 3397da8)`

**Asked for by Javier, 2026-08-19, looking at the deployed form.** Sections 04
("Your preferences", seven directive rows of chips) and 05 ("In your own words")
both sit open on the page, one under the other. They are two ways to fill the SAME
seven params — 05 exists only to fill 04 (`7a45269`) — so the form asks the buyer
to do the same job twice, and the second one is a wall of ~30 chips before they
know whether the product is any good.

**The shape (Javier's, and the one to build):** the box is the way in; the fields
are what it produced, and stay editable by hand afterwards.

1. Section 05 is primary; 04 starts collapsed behind "prefer to pick them
   yourself?" — visible from the first render, not only on error.
2. On validate, the accepted proposals land in the FORM's directive state, not
   only in the confirm dialog: 04 opens showing exactly what was filled, each field
   marked with the words that filled it (`proposals.quotes`, already carried).
3. The buyer edits any of them by hand from there. The precedence rule already
   supports this: `acceptProposals` skips a field the buyer set
   (`enrich.ts`, `if (current[f.key] !== undefined) continue`), so a later
   re-validation cannot clobber a hand-picked value.
4. The confirm dialog goes back to being a REVIEW (summary, issues, corrections)
   instead of the place where seven preferences are decided — which today is at the
   moment of spending credits, the worst moment to meet a new vocabulary.

**Constraints, verified in the code:**
- The assist is not always available: `PreflightOutcome.assist.state` is
  `off_disabled | off_no_credits | off_cooldown | off_attempts`, and there are two
  free attempts per draft. Prompt-first MUST fall back to the fields whenever the
  assist is off, or a buyer with no attempts left has no way to express a
  preference at all.
- Mobile is a wizard: 04 and 05 are separate steps (`stepOf(2)`, `stepOf(3)`,
  `WIZARD_STEPS = 4` in `NewReport.tsx`). Collapsing them changes the step count.
- The form is manifest-driven, so this is an SPA decision, not a Florida one —
  another model with directives gets the same behaviour for free.
- Whatever is not rendered must not be silently sent, and whatever the buyer typed
  must not be silently dropped: that is the R7-7 class of defect (input given,
  charged for, never used).

**Decided (Javier, 2026-08-19):** the box stays VISIBLE but collapsed, with the text
still in it. The dialog keeps listing the proposals with their per-field ticks —
ticking there is what writes them onto the form, so the two views are one state, not
two.

**Refined in `c0805a7` (option B of a frontend review).** Collapsing 04 left a bare
header with a 10px link — "a section that failed to load", in Javier's words. The
review found the real cause: the RESULT sat above its CAUSE (and, on a phone, a whole
wizard step before it), and the sentence explaining the whole flow was passed to
`SecHead`'s `right` slot, styled `nr-hint` — mono, 10px, uppercase, right-aligned.
Fine for three words; decoration for forty. So: the box is section 04, the
preferences are 05, the explanation is a `.nr-lead` paragraph, the empty state names
what will land there and offers a real button, a `n/7` counter shows there is
something inside without opening it, and the lead changes with the state (empty →
filled → assist off). Canvas of the three options considered:
https://claude.ai/code/artifact/4d732a3e-ab48-4d9e-ac29-9d66c0f97520

**Built in `16e7014`, finished in `3397da8`.** The stamp used to name `16e7014`
alone, which is the commit that collapses section 04 behind a link — the "never both
at once" that titles this entry is `3397da8` ("one section, two ways — the box or
the fields, never both"), with `2bf0b97` fixing the block that closed under the
buyer's cursor and `c0805a7` in between (round 8, R8-31). Two things the design
walked into, both found by building it
rather than by reading: the preview key had to stop including the directive block
(or every chip click would spend an assisted attempt re-approving a value we
proposed), and `correctedParams` had to be applied field by field (or accepting a
typo fix at the end would silently revert every edit made after validating).
