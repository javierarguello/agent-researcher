# G1-break — the engine's gates and the tests that stand behind them / BREAK

Measured at **`20f361b`** (`git rev-parse HEAD` = `20f361b531626ac0412475407e0a169f1d4c8570`), in my own worktree
after `npm ci`. `apps/worker` `resolution.test.ts` passes, so `@agent-researcher/core` resolves locally and my
mutations were visible to my own runs. Clean-worktree baseline `npm test`: **1162 passed, 0 failed**
(751 core + 216 api + 22 worker + 166 fbizlab + 7 admin), 16 skipped in core and 6 in api — the brief's number,
exactly. `git diff` and `git status` are clean at the time of writing; every mutation below was reverted from a
`.bak` copy and re-verified with `git diff --quiet`.

## Verdict

Three of the four commits hold up: `b18ea51`'s bounds work is correct in every detail I could re-measure (the
flagship's schema census is *exactly* 17 `minItems` / 2 `maxItems` / 5 `maxLength` / 0 everything else, and all
five `maxLength`s really are chart copy), `2f5ab43`'s three mutation counts are right, and `5a7b844`'s fixture
really did gain the store-order detection it says it gained. **`d77ffb3` did not.** It is a fix that closed the
hole round 9 named and opened two more in the same line, both of them the *same class* of hole — the class R8-26
and R9-13 exist to close — and both measured refused by the code it replaced. `«mobile home park»` now buys
`Homestead, FL` for a buyer who wrote Hialeah, and `«busco»` now pre-ticks a directive the buyer never asked for,
while `«low risk»` and `«cash flow»` — which the buyer literally typed — lost the tick they used to get. The
commit's stated principle, *"function words in the four languages this product speaks are almost all four letters
or fewer … a property of the languages rather than a threshold someone picked"*, is the false-universal shape the
brief told me to hunt, and it is false in all four languages at once. Separately, R9-8's corrected threshold is
still wrong (it is a function of `referenced.length`, not a constant, and its floor is 25 not 37) and R9-11's
replacement assertion `.sort()`s both sides, so the "in store order" it claims to pin is pinned by nothing —
reversing the entire `referenced` tier is **0 red across all 1162 tests**.

## Findings (most severe first)

### F1 · A four-letter prefix of a word the buyer typed now buys a different real Florida city, with the buyer's own words shown as the evidence — P1

- **where:** `packages/core/src/moderation/enrich.ts:345-350` (`quoteNames`), specifically
  `const shares = (a: string, b: string) => a === b || a.startsWith(b) || b.startsWith(a);`
  Rendered at `apps/fbizlab/src/pages/NewReport.tsx:1188` as `— «{quote}»` beside the proposed value.
- **input / observed** (all through the production entry `acceptProposals(florida, …)`, `location` is the
  flagship's only `fillable`, `maxLength` 200):

  | buyer's note (free text) | model's `basics.location` | model's `quote` | HEAD | at `d77ffb3^` |
  |---|---|---|---|---|
  | `Looking for a mobile home park business, budget 500k, in Hialeah.` | `Homestead, FL` | `mobile home park` | **accepted, quoted** | refused |
  | `I have a plan to buy a laundromat in Hialeah this year.` | `Plantation, FL` | `a plan to buy` | **accepted, quoted** | refused |
  | `A laundromat near the lake, in Hialeah, budget 500k.` | `Lakeland, FL` | `near the lake` | **accepted, quoted** | refused |
  | `Mobile home park operator in Hialeah.` | `Parkland, FL` | `home park` | **accepted, quoted** | refused |
  | `Laundromat with good water pressure in Hialeah.` | `Waterford, FL` | `good water` | **accepted, quoted** | refused |

  `home` → `homestead`, `plan` → `plantation`, `lake` → `lakeland`, `park` → `parkland`, `water` → `waterford`.
  Every one is a real Florida city, none of them the one the buyer named, and each arrives with the buyer's own
  phrase rendered as the evidence for it.
- **status: reproduced.** Probe at
  `<scratchpad>/round10/g1-break/probe.test.ts`, run as `packages/core/test/zz-g1break-probe.test.ts` (deleted
  afterwards). Then re-run with `packages/core/src/moderation/enrich.ts` replaced by
  `git show d77ffb3^:…/enrich.ts` — all five flip to `basic=undefined quote=undefined`. So this is a hole
  **`d77ffb3` opened**, not one it inherited: the old rule required the *whole* value token to appear in the
  quote (`q.includes(t)`), which no four-letter prefix satisfies.
- **refutation attempted:**
  1. *"R9-13 raised the floor to four letters on both sides, so this is guarded."* No — with `startsWith`, four
     letters is the length of the **shared prefix**, not of the matched word. `«home»` is four letters and
     `homestead` is nine; only the first four are compared. The floor and the prefix rule cancel each other for
     every value word longer than four letters, which is nearly all of them.
  2. *"basics are never applied automatically."* True and it is why this is P1 and not P0: `preflight.ts:110`
     builds `proposedParams` with `applyProposals(…)` and **no** `{ basics: true }`, and
     `NewReport.tsx:185` starts every `basic:` row unticked. The damage needs a buyer tick. But the row is
     presented *with* their own words as the justification, which is the entire reason R8-26 was filed —
     "«una» was shown as the evidence for Orlando" is this same sentence with the strings changed.
  3. *"a model would never do this."* The gate exists because a model does. R8-26's original was
     `{ value: 'Orlando, FL', quote: 'una' }` from a real run.
  4. *"the flagship is Florida-only so a wrong city is still in scope."* It is 30 miles and a different county;
     the field's own comment says "these say what will be searched at all, so a guess is worse here than an
     omission".
- **fix sketch:** require the prefix to be a *large fraction* of the longer word rather than four characters —
  e.g. `shares = (a,b) => a === b || (Math.min(a.length,b.length) >= ANCHOR_WORD_LEN && Math.max(a.length,b.length) <= Math.min(a.length,b.length) + 3 && (a.startsWith(b) || b.startsWith(a)))`.
  `pete`/`petersburg` (4 vs 10) is what the prefix rule was added for and it does **not** survive that bound, so
  the honest cost is real: either accept that `St. Pete` is anchored by the *rest* of the quote (in the shipped
  test the quote is `in St. Pete` and `petersburg` shares no other word, so it would go back to vanishing), or
  add an explicit abbreviation allowance (`st.` + prefix) rather than a general one. A naive tightening loses
  R9-5's case; a naive loosening is what shipped.

### F2 · The new tick rule is looser than the rule it replaced for single 5-7 letter function words, and tighter for the two-short-word phrases this product's buyers actually type — P1

- **where:** `packages/core/src/moderation/enrich.ts:308-310`
  (`const CONTENT_WORD_LEN = 5;` … `isEvidence = (q) => words(q).some((w) => w.length >= CONTENT_WORD_LEN)`),
  consumed at `apps/fbizlab/src/pages/NewReport.tsx:183`
  (`out[k] = !!proposals.quotes?.[k]` — a quoted directive is **pre-ticked**) and folded into the submitted
  request through `pickAccepted` → `applyProposals`.
- **input / observed, half (a) — now ticks, did not before.** Twelve single words, each copied verbatim out of
  a plausible note, each attached to `riskAppetite: 'opportunistic'` (a directive the buyer never expressed):

  `busco`, `quiero`, `aunque`, `porque`, `about`, `there`, `maybe`, `would`, `quand`, `parce`, `quando`, `sobre`
  — **all twelve keep the quote at HEAD and are therefore pre-ticked; all twelve were refused at `d77ffb3^`**
  (5-7 characters, no space, so the old `len >= 8 || /\s/` bar rejected them). `«busco»` is the first word of a
  Spanish buyer's note and `«about»` of an English one.
- **input / observed, half (b) — no longer ticks, did before.** Note:
  `I want low risk, good cash flow, no debt, a turn key laundromat. … Busy area, long lease, high rent is fine.`
  Quotes `low risk`, `cash flow`, `no debt`, `turn key`, `high rent`, `busy area` — literally what the buyer
  typed, and the core vocabulary of a business-for-sale product — **all lose their quote at HEAD** (every word
  ≤ 4 letters) and arrive unticked *and with no «…» shown at all*, because `NewReport.tsx:1146` only renders the
  quote when one survived. At `d77ffb3^` all six ticked.
- **status: reproduced.** `<scratchpad>/round10/g1-break/probe.test.ts` and `probe4.test.ts`, each run at HEAD
  and again against `d77ffb3^`'s `enrich.ts`.
- **the false claim, exactly as the brief describes the shape** — `enrich.ts:301-303` and the commit message:
  *"Function words in the four languages this product speaks are almost all four letters or fewer … content
  words are almost all five or more. That is a property of the languages rather than a threshold someone picked,
  which is why it holds in all four at once."* Counter-list, all ≥ 5 and all function words:
  es `porque cuando aunque donde sobre hasta entre desde según mismo` ·
  pt `porque quando sobre entre desde muito` ·
  fr `comme aussi quand parce depuis plutôt` ·
  en `about there these those which where would could should because`.
  And the converse, all ≤ 4 and all content words in this domain: `cash flow risk debt rent lease turn key busy
  area sale loan`.
- **refutation attempted:**
  1. *"it is still a net tightening — `de la` is gone."* `de la` is gone and that is a real gain. But the change
     is not monotone: it is a **swap** of one admitted class for another, and both directions were left
     unmeasured. The commit's own revert-verification only ran mutations in the direction of the fix; nothing in
     the suite asserts that a 5-7 letter single word is refused, because the pre-existing R8-26 test uses `una`
     (3) and the new R9-4 test uses `de la` / `de los` / `una` — all under the old *and* new bar.
  2. *"a directive is only a preference, not the scope."* It is pre-ticked, it goes into `proposedParams`, and
     it changes the research the buyer pays for. R8-26 was filed at exactly this severity.
  3. *"maybe the model never emits a bare function word as a quote."* R8-26's real-run example was `una`.
- **fix sketch:** keep the ≥5-letter content-word test as the *shape* test and add a small closed stop-list of
  the ≥5-letter function words in the four languages (the list above is ~30 entries), so `deuda` and `riesgo`
  still tick; and add "or two or more words of ≥3 letters" as a second admitting branch so `cash flow` and
  `low risk` come back. What an honest run loses if this is done naively: bumping `CONTENT_WORD_LEN` to 6 kills
  `deuda`, which is the exact Spanish word R9-4 was filed to admit; restoring `|| /\s/` re-admits `de la`.

### F3 · R9-8 replaced a wrong threshold with another wrong threshold: the snippet call's floor is 25, not 37, and it is not a constant — P2

- **where:** `packages/core/src/engine/prompt.ts:285-287`, repeated verbatim at
  `packages/core/test/red-team/refute-b1.test.ts:355-357` and in `2f5ab43`'s commit message:
  *"The SNIPPET call needs 37 fetched-and-in-store urls to feel that, which no budget reaches."*
- **input / observed:** the loss condition is `fetched.length > max - reserve` with
  `reserve = min(referenced.length, floor(max/2))`, i.e. **`fetched ≥ 49 − min(referenced, 24)`** for the
  snippet call. Scanned across `referenced.length`:

  | `referenced.length` | 8 | 12 | 16 | 20 | **24** | 30 | 48 |
  |---|---|---|---|---|---|---|---|
  | first `fetched` that loses an own snippet | 41 | **37** | 33 | 29 | **25** | 25 | 25 |

  37 is the value at `referenced = 12` only. The floor is **25**, and `referenced = 24` is not hypothetical —
  it is the figure R8-6 measured and that the docstring twelve lines above quotes: *"a host cited repeatedly in
  the sections a writer is handed took 24 of 48 snippets"*. The PAGES row of the same scan is 11 / 8 / 8 / 8 for
  `referenced` = 4 / 7 / 8 / 12, so the "8" was given as a floor while the "37" was given as a point estimate
  dressed as one. And "which no budget reaches" does not survive `research-engine.ts:809`, which warns that an
  agent *"fetched N pages, more than the 60 a checkpoint carries"* — the engine explicitly expects fetch counts
  above 60, let alone 25.
- **status: reproduced.** `<scratchpad>/round10/g1-break/probe2.test.ts` (scan + a
  `expect(kept).toBe(24)` counterexample at 25 own + 24 referenced, max 48, distinct hosts so `perDomain` never
  defers).
- **refutation attempted:** (a) *"the reserve is only released, not lost — `take(fetched, max)` runs again three
  lines later."* It does, but by then `takeSpread(referenced, max)` has filled the dossier to `max`; the second
  `take` is a no-op whenever `referenced ≥ reserve`, which is always. Measured: 24 of 25 own snippets kept.
  (b) *"25 fetched-and-in-store snippet urls is unreachable."* `fetched` is per-agent and bounded at 60 by
  `CHECKPOINT_MAX_PAGES`, with a warning path for exceeding it. (c) *"the sentence is about a trade being
  acceptable, not about a number."* That is precisely why it matters: "which no budget reaches" is the entire
  argument for leaving the behaviour unchanged.
- **fix sketch:** state the formula, not a number — `fetched > max − min(referenced, ⌊max/2⌋)`, "so 8 for the
  14-slot PAGES call at 7+ referenced, and 25 for the 48-slot SNIPPET call at 24+ referenced, which R8-6
  measured". No behaviour change; the trade may well still be the right one, but it should be argued against the
  floor.

### F4 · R9-11's replacement assertion sorts both sides, so the "in store order" it claims to pin is pinned by nothing — P2

- **where:** `packages/core/test/red-team/refute-b1.test.ts:361-365`
  `expect(ref.snippets.slice(0, 12).sort()).toEqual([...SHORTLISTED].sort());`
  under a comment reading *"the twelve reserved slots are the twelve shortlisted urls, **in store order**. A
  count can be reached by more than one arrangement; **this cannot**"*, and `2f5ab43`'s message: *"the density
  test now asserts the twelve reserved slots ARE the twelve shortlisted urls, **in order**"*.
- **input / observed:** `.sort()` on both operands makes it a **set** comparison. Mutation
  `takeSpread(referenced, max)` → `takeSpread([...referenced].reverse(), max)` in
  `packages/core/src/engine/prompt.ts:346` — the emission order of the entire `referenced` tier reversed —
  measured **0 red**: core `751 passed | 16 skipped`, full `npm test` **1162 passed, 0 failed**, unchanged from
  baseline.
- **status: reproduced** (full-suite run under the mutation, then reverted; `git diff --quiet` verified).
- **refutation attempted:** (a) *"composition is still stronger than a count, which is what R9-11 asked for."*
  Agreed, and I am not claiming R9-11 achieved nothing — it did close the count-invariance. The finding is that
  the comment and the commit message both say **order**, twice, and the assertion cannot see order. That is the
  same defect one level down: a sentence claiming more than the assertion below it. (b) *"tier order is pinned
  elsewhere."* It is — `take(touched)` above `takeSpread(referenced)` is 2 red. Order *within* the referenced
  tier, which `rankEvidence`'s own docstring calls out as the design (`prompt.ts:245`, "each tier in store
  order"), is not pinned by anything in 1162 tests. (c) *"maybe the sort is needed because the twelve arrive in
  a host-interleaved order."* All twelve `SHORTLISTED` urls are the same host, `takeSpread` preserves store
  order among them, and store order is lot 37…48 ascending — which is also lexicographic, so
  `expect(ref.snippets.slice(0, 12)).toEqual(SHORTLISTED)` would pass as written today.
- **fix sketch:** drop both `.sort()` calls. Verified: with the reversal mutation applied and the sorts removed
  the assertion fails, and it passes unmutated.

### F5 · Two of `5a7b844`'s three mutation counts are understated, and a "measured" red count it wrote is now stale in the file `2f5ab43` edited — P2

- **where:** `5a7b844`'s commit message table, and `packages/core/test/red-team/refute-b1.test.ts:351-352`.
- **claimed vs observed** (full core suite per mutation, reverted from a `.bak` between each):

  | mutation | claimed | observed at `20f361b` | the extra red tests |
  |---|---|---|---|
  | `rankEvidence` dropped from the snippet dossier (`evidence.slice(0, MAX_SNIPPETS)`) | 2 red | **4 red** | `evidence-ranking > … is the sections it is REWRITING`, `evidence-ranking > …and the same for snippets`, `refute-b1 > … a wave-2 producer that searched 3×` |
  | `touched` emitted above `referenced` | 1 red | **2 red** | `evidence-ranking > fetched outranks everything, and referenced outranks touched` |

  All three "extra" tests exist verbatim at `5a7b844` itself (`git show 5a7b844:…` confirms), so the
  undercount is not an artifact of later commits. The *printed figures* in the same table are all exactly right:
  HEAD 12/12 and 44/48; ranking dropped **0/12, 40/48**; `touched` above `referenced` **8/12, 44/48**.
- Separately, `refute-b1.test.ts:351-352` still reads *"NOT `const reserve = 0` — measured, full suite: **2 red,
  both in `evidence-ranking.test.ts`**"*. At HEAD it is **3 red** — `2f5ab43` added
  `evidence-ranking > the reserve is paid for by the writer's OWN pages…` and updated its own commit message
  ("3 red (2 before this commit)") but not this sentence, in a file it edited five lines below in the same
  commit. This is R9-9's finding — a figure that moved and a title/comment that did not — recurring inside the
  commit that fixed R9-9.
- **status: reproduced** (13 mutations run, script at `<scratchpad>/round10/g1-break/mutate.sh`).
- **refutation attempted:** *"'2 red' may have meant 2 red in the fixture."* The table's sibling row says
  "1 red" for a mutation that reds exactly one test in that fixture and one elsewhere, and the standing
  convention in every commit in this batch is "Revert-verified, **full suite** per mutation, red counted". Under
  either reading one of the two rows is wrong.
- **fix sketch:** restate as 4 and 2, and change the in-file sentence to "3 red, all in
  `evidence-ranking.test.ts`".

## Claims checked and TRUE (so nobody re-checks)

- **`b18ea51`'s schema census is exact.** Walking every flagship section schema through `z.toJSONSchema`:
  **17 `minItems`, 2 `maxItems`, 5 `maxLength`, 0 `minimum`, 0 `maximum`, 0 `minLength`, 0 `pattern`** —
  the numbers in `gemini-vertex.ts:283-285` to the digit. All five `maxLength`s are
  `charts.items.*` (`title` 160, `description` 500, `labels[]` 80, `series[].name` 80, `unit` 8), so
  "every `maxLength` in the flagship is buyer-visible chart copy" is TRUE, and `minLength`/`pattern` really are
  dead for the flagship today. Reproduced (`probe3.test.ts`).
- **`.describe()` reaches the model at every nesting level**, including array items and nested object
  properties — `jsonSchemaToGemini` copies `base.description` before recursing (`gemini-vertex.ts:256`) and the
  d-attack assertions read `chart.properties.labels.items.description` and
  `chart.properties.series.items.properties.name.description`. Both new assertions are pinned: dropping the
  bound from `unit`'s describe is **1 red**, from `description`'s is **1 red** — as claimed.
- **`maxLength` is genuinely still withheld** and Zod still rejects an 81-character label. Unchanged by
  `b18ea51`.
- **R9-15's doc claim holds.** `assertTemplatesValid` is called at module load
  (`packages/core/src/templates/registry.ts:13`), and `validate.ts:67-80` rejects all four of `focus`, `sites`,
  `researchBudget`, `gatherModel` on any agent where `hasResearchLoop(a)` is false — so "a validation ERROR that
  fails the boot, not a field that is ignored" is accurate for both `types.ts` comments.
- **R9-8's PAGES arithmetic is right.** 10 own + 8 referenced at `max = 14`, `perDomain = 3` gives **7 own +
  7 referenced**, and the pre-`8ff7312` classification gives **10 own + 4 referenced**. 8 is the correct floor
  for the pages call. Reproduced.
- **R9-12 is right and is pinned.** Restoring `\` inside the URL character class is **1 red**, and
  `urlsIn('https://a.example/1\\nhttps://b.example/2')` really does recover both listings.
- **`d77ffb3`'s five mutation counts are all correct**: `|| /\s/` branch back → 1, `CONTENT_WORD_LEN` 5→3 → 2,
  `ANCHOR_WORD_LEN` 4→3 → 1, shared-prefix dropped → 1, accents no longer folded → 1. (The rule they pin is the
  one F1 and F2 attack; the *pins* are real.)
- **`2f5ab43`'s three mutation counts are all correct**: backslash back → 1 red, `referenced` classified after
  `touched` → 3 red, reserve removed → 3 red.
- **`5a7b844`'s three-wave fixture does what it says.** Store positions: the peer's 48 results (lots 49-96) take
  store places 1-48, the scout's lots 1-48 take 49-96, so `SHORTLISTED` (lots 37-48) sits at **85-96** and the
  naive "render the store's first 48" contains none of them. Confirmed by the mutation printing **0/12**.
- **`verbatim()` stays literal.** `fold()` is reachable only through `words()`, which is used by `isEvidence`
  and `quoteNames`; `verbatim()` still uses `flatten()`, so an accented quote is quoted back to the buyer as
  typed.
- **`proposedParams` does not carry basics.** `preflight.ts:110` calls `applyProposals` without
  `{ basics: true }`, so an "accept everything" client cannot apply a `location` it never rendered. This is what
  caps F1 at P1.
- **The clean-worktree total is 1162**, as the brief states.

## Commit-message audit — every count re-run, claimed vs observed

Full core suite per mutation (`packages/core && npx vitest run`), reverted from a `.bak` copy between each and
`git diff --quiet` verified; the one 0-red result was additionally re-run as a full `npm test`.

| commit | mutation | claimed | observed |
|---|---|---|---|
| `d77ffb3` | `\|\| /\s/.test(q.trim())` restored to `isEvidence` | 1 red | **1** ✓ |
| `d77ffb3` | `CONTENT_WORD_LEN` 5 → 3 | 2 red | **2** ✓ |
| `d77ffb3` | `ANCHOR_WORD_LEN` 4 → 3 | 1 red | **1** ✓ |
| `d77ffb3` | `shares` → `a === b` (prefix dropped) | 1 red | **1** ✓ |
| `d77ffb3` | `fold` → `flatten` (accents not folded) | 1 red | **1** ✓ |
| `5a7b844` | `rankEvidence` dropped from the snippet dossier | 2 red | **4** ✗ (F5) |
| `5a7b844` | prints `0/12, 40/48` under that mutation | 0/12, 40/48 | **0/12, 40/48** ✓ |
| `5a7b844` | `touched` emitted above `referenced` | 1 red | **2** ✗ (F5) |
| `5a7b844` | prints `8/12, 44/48` under that mutation | 8/12, 44/48 | **8/12, 44/48** ✓ |
| `5a7b844` | HEAD prints `12/12, 44/48` | 12/12, 44/48 | **12/12, 44/48** ✓ |
| `5a7b844`/`2f5ab43` | `const reserve = 0` | 2 red (in-file) / 3 red (msg) | **3** — msg ✓, in-file comment stale (F5) |
| `2f5ab43` | backslash back inside the URL class | 1 red | **1** ✓ |
| `2f5ab43` | `referenced` classified after `touched` | 3 red | **3** ✓ |
| `2f5ab43` | R9-8 figures: 10 own + 8 ref → 7 + 7; old → 10 + 4 | 7/7 vs 10/4 | **7/7 vs 10/4** ✓ |
| `2f5ab43` | "the PAGES call reaches it at 8" | 8 | **8** ✓ (floor) |
| `2f5ab43` | "the SNIPPET call needs 37 … which no budget reaches" | 37 | **25** ✗ (F3) |
| `b18ea51` | `unit` loses its bound from `.describe()` | 1 red | **1** ✓ |
| `b18ea51` | `description` loses its bound | 1 red | **1** ✓ |
| `b18ea51` | flagship census 17/2/5/0/0 | 17/2/5/0/0 | **17/2/5/0/0** ✓ |
| *(mine)* | `takeSpread([...referenced].reverse(), max)` | — | **0 red / 1162 passed** (F4) |

Suite totals in the commit messages (`1133`, `1136`) are main-checkout numbers from before six further commits
and I did not attempt to reproduce them; the brief's own clean-worktree figure of **1162** at `20f361b` I did
reproduce exactly.
