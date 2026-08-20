# G1-verify — the engine's gates and the tests that stand behind them / VERIFY

Measured at **`20f361b`** (`git rev-parse HEAD` = `20f361b531626ac0412475407e0a169f1d4c8570`), in my own
worktree, after `npm ci`. `apps/worker` `test/resolution.test.ts` passes, so `@agent-researcher/core` resolves
to THIS worktree. Clean-worktree baseline: **1162 passed, 0 failed** (751 core + 216 api + 22 worker + 166
fbizlab + 7 admin; 16 skipped core, 6 skipped api) — exactly the brief's number, so every red below is mine.
Mutations were run against `packages/core` + `apps/api` (nothing outside core imports `acceptProposals`,
`rankEvidence` or `urlsIn` — `apps/fbizlab/src/pages/NewReport.tsx:271` mentions `acceptProposals` in a comment
only — and both suites were run for every mutation anyway; api was 216/0 for all twelve). Two mutations were
run at earlier commits to re-check "0 red" and "stayed GREEN" claims; I returned to `20f361b` and
`git status --porcelain` is empty.

## Verdict

**The arithmetic holds; two of the prose universals do not, and one of the two gates reopens the hole it was
written to close.** All fourteen mutation counts I could re-run in `d77ffb3`, `2f5ab43` and `b18ea51` are
correct as stated, `d77ffb3`'s "deleting that branch measured 0 red" is correct at its parent, `5a7b844`'s
"the fixture passed with the ranking deleted, still printing 12/12" is correct at ITS parent, and
`b18ea51`'s census of the flagship's bounds (17 `minItems` / 2 `maxItems` / 5 `maxLength` / zero
`minimum`/`maximum`) is correct to the item. What does not hold: (1) the new basics anchor accepts
`«near the port»` as the evidence for `Portland, OR` — R8-26's own sentence, with a content word instead of an
article, created by the shared-prefix rule this commit added and pinned by nothing; (2) `5a7b844`'s mutation
table counts two of its three rows in one denominator and the third in another, so "2 red" and "1 red" are 4
and 2 suite-wide; (3) the `it()` title `2f5ab43` re-measured now carries the figures of a DIFFERENT test's run
(185k/137k where its own run prints 184.0k/135.9k) — the exact defect R9-9 was opened for; (4) "which every
producer reaches" is refuted by the repo's own honest denominator, in which the whole 15-agent run fetches 8
pages; and (5) the backlog and the round-10 brief both say `isEvidence` now applies to the basics field, and it
does not — the commit itself never claims that, so the record over-states its own fix.

## Findings (most severe first)

### F1 · `«near the port»` is now accepted as the buyer's own evidence for `Portland, OR` — the prefix rule reopens R8-26 for content words — P1
- where: `packages/core/src/moderation/enrich.ts:348` (`shares`), used by `quoteNames` at `:345-350`, gating
  the basics path at `:584`; the quote is stored unfiltered at `:592` and rendered next to the value by
  `apps/fbizlab/src/pages/NewReport.tsx` (`— «…»`).
- input / observed (real flagship template, `location` empty):
  ```
  note  'Laundromat near the port, budget 500k.'      model { location: { value: 'Portland, OR',  quote: 'near the port' } }
    → basics = {"location":"Portland, OR"}    quotes = {"location":"near the port"}
  note  'Looking for a laundromat near the lake, …'   model { location: { value: 'Lakeland, FL',  quote: 'near the lake' } }
    → basics = {"location":"Lakeland, FL"}    quotes = {"location":"near the lake"}
  note  'Laundromat with parking, budget 500k.'       model { location: { value: 'Park City, UT', quote: 'with parking' } }
    → basics = {"location":"Park City, UT"}   quotes = {"location":"with parking"}
  ```
- status: **reproduced.** Scratch test (`acceptProposals(florida, {industry,mode}, {basics:{location:{value,quote}}}, note)`),
  printed above verbatim. Before `d77ffb3` all three were REFUSED: the old rule was
  `flatten(quote).includes(valueToken)`, and `'near the port'` does not contain `portland`. This is a
  regression the commit created, not a case it inherited.
- why it happens: `shares(a, b) = a === b || a.startsWith(b) || b.startsWith(a)`, applied to every 4+-letter
  word on both sides. The commit motivates it with ONE direction — an abbreviation the model expands,
  `pete → petersburg` — but the predicate is symmetric and unrestricted, so any 4-letter common noun a buyer
  types anchors any place name that begins with it. `port`, `lake`, `park`, `mont`, `spring`, `west` are all in
  the flagship's own vocabulary; Florida alone gives `Lakeland`, `Lake Worth`, `Port Charlotte`, `Parkland`,
  `Springfield`, `Westchase`.
- refutation attempted: (1) *Is the value bounded to Florida?* No — `location` is
  `z.string().trim().max(200)` (`florida-business-for-sale.ts:407`), so `Portland, OR` passes
  `paramsSchema.safeParse` and `sanitizeProposal`. (2) *Is it auto-applied?* No — a basic is always shown
  unticked and the buyer must click; that is why round 9 rated the sibling defect (R9-13, `«the»` →
  `The Villages, FL`) P2, and it is the reason I nearly did the same. I put this one higher because the false
  evidence is now a CONTENT word the buyer really typed rather than an article: "near the port" reads as
  corroboration in a way "«the»" never did, and the commit's stated invariant — "A quote is evidence for a
  VALUE only if it NAMES the value" (`enrich.ts:320`) — is false as implemented. (3) *Does the model plausibly
  do this?* `quote` is `required` in the response schema, so a model that guesses a location must produce some
  span of the note; the spans it will pick are exactly the topical ones. (4) *Is it pinned?* No: the two tests
  `d77ffb3` added pin only the good direction (`pete → petersburg`, `orléans → orleans`) and the
  three-letter refusals. Nothing asserts that a shared prefix must be an abbreviation of the value.
- fix sketch: require the shared prefix to be an ABBREVIATION rather than any common prefix — i.e. accept
  `q.length < v.length && v.startsWith(q)` only when the quote word is the shorter one AND the value word is
  the value's longest token (so `The Villages` must be anchored on `villages`, `St. Petersburg` on
  `petersburg`), and require an exact match otherwise. What an honest run loses if this is done naively: making
  `shares` exact again re-breaks `St. Pete` and re-opens R9-5, which is a vanished proposal, not an unticked
  one — so this must be measured against the R9-5 test, not just the new one.

### F2 · `5a7b844`'s mutation table counts two rows in one denominator and the third in another; "2 red" is 4 and "1 red" is 2 — P2
- where: commit message `5a7b844`, the "Re-measured, and both detections are back" table.
- claimed vs observed (whole `core` suite at `20f361b`, api unchanged):

  | mutation | claimed | observed suite-wide | observed in `refute-b1.test.ts` |
  |---|---|---|---|
  | `rankEvidence` → `evidence.slice(0, MAX_SNIPPETS)` | 2 red | **4 red** | 2 |
  | `take(touched, max)` emitted above `takeSpread(referenced, max)` | 1 red | **2 red** | 1 |
  | `const reserve = 0` | 2 red, "both UNIT" | 3 red (all unit) — and `2f5ab43` states "3 red (2 before this commit)", so 2 at that tree ✔ | 0 |

- status: **reproduced.** The two extra reds under row 1 are
  `evidence-ranking.test.ts` › "what a producer's dossier calls `referenced` … is the sections it is REWRITING"
  and › "the dossier a writer actually receives is diversity-first > …and the same for snippets"; the extra red
  under row 2 is › "fetched outranks everything, and referenced outranks touched". All three are byte-identical
  between `5a7b844` and `20f361b` (`git diff 5a7b844 HEAD -- packages/core/test/evidence-ranking.test.ts`
  touches only the R9-8 test and the `urlsIn` one), and `rankEvidence` itself changed only in comments, so the
  counts transfer to the commit's own tree — which I also measured directly: at `d77ffb3` (= `5a7b844^`) the
  same slice mutation is **3 red suite-wide, 1 in `refute-b1`**.
- refutation attempted: the only reading that makes row 1 = 2 is "reds in `refute-b1.test.ts`" — but under that
  reading row 3 is 0, not 2, and its own annotation ("both UNIT") is a statement about tests OUTSIDE that file.
  There is no single denominator under which all three numbers are right. The sibling commits in this batch
  (`d77ffb3`, `2f5ab43`) both say "Revert-verified, **full suite per mutation**, red counted" and both are
  correct under that reading; `5a7b844` is the one that omits the phrase and the one whose numbers do not fit it.
- fix sketch: restate the table as suite counts (4 / 2 / 3 at HEAD) or label the column
  "red in `refute-b1.test.ts`" and move "both UNIT" into prose. Nothing in the code changes.

### F3 · The `it()` title R9-9 re-measured now carries a different test's figures — 185k/137k where its own run prints 184.0k/135.9k — P2
- where: `packages/core/test/red-team/d-legit.test.ts:784` — "checkpoint **185k** chars here (8 pages,
  **137k** report)".
- input / observed: `npx vitest run test/red-team/d-legit.test.ts`, the test's own `console.table`:
  ```
  § 6 (this test, replan: true)   sources 8 │ checkpoint bytes '184.0k' │ pages 8 │ report chars '135.9k'
  § 2 (plan once, a DIFFERENT run) …        │ checkpoint bytes '184.6k' │ pages 8 │ report chars '137.1k'
  ```
  `k(n) = (n/1000).toFixed(1)`, so `bytes ∈ [183_950, 184_049]` and `report ∈ [135_850, 135_949]`. The title's
  185k and 137k are §2's numbers rounded, not §6's. Deterministic across two runs.
- status: **reproduced** (whole file, then `-t 'checkpoint 185k'` alone; identical both times).
- refutation attempted: (1) *chars vs bytes?* The test measures `JSON.stringify(checkpoint).length` — chars, the
  same quantity the title names. (2) *Was 185k right before?* The pre-fix title said "174k chars here (7 pages,
  137k report)"; `2f5ab43` corrected `174k → 185k` and `7 → 8`. So the correction replaced one stale number
  with another test's number, and left `137k` — which is §2's — untouched, in the very commit whose subject is
  "five claims of mine the round measured and found wrong". (3) *Does the commit message admit it?* No: the
  message lists `5.07M → 5.69M`, `2.4× → 1.4×`, `"7 pages" → 8`, `$2.58 → $2.65`, `~51% → ~50%`, `79 → 78` and
  the 26-pages comment. The `174k → 185k` edit is in the diff and in no sentence of the message.
- fix sketch: `checkpoint 184k chars here (8 pages, 136k report)`, and the general rule the batch keeps
  re-learning — a figure in an `it()` title must be read off the table that test itself prints, never off the
  neighbouring one.

### F4 · "which every producer reaches" — the repo's own honest denominator fetches 8 pages for the WHOLE 15-agent run — P2
- where: `packages/core/test/evidence-ranking.test.ts:122` ("it reaches it at EIGHT — which every producer
  reaches") and `5a7b844`'s message ("the 14-slot PAGES call reaches it at **8**, which every producer does").
- input / observed: to feel the reserve in the PAGES call an agent needs **8 urls of its own in `prefer.fetched`
  that are also in the `extracted` store** (`reserve = min(referenced.length, floor(14/2)) = 7`; `fetched` is
  served `max - reserve = 7` first). The honest comprehensive denominator prints, for the entire run:
  `sources 8 │ pages fetched 8` (`d-legit.test.ts:380`, §2) and `pages carried 8` (§6) — 8 extracted pages
  shared by 15 agents, 10 of them producers. No producer can hold 8 of its own unless it fetched all 8 of them.
- status: **reproduced** for the fixture figure (ran `d-legit`); **reasoned** for the universal — the claim
  quantifies over producers and one counterexample per run is enough, and the fixture supplies ten.
- refutation attempted: (1) *Is `fetched` per-agent?* Yes — `research-engine.ts:681`,
  `fetched: new Set(fetchedByAgent[agent.id] ?? [])`. (2) *Is the fixture too thin to be evidence?* It is the
  document the batch itself uses as the denominator, and `2f5ab43` corrected a neighbouring comment for the
  opposite error — "a comment claiming the run carries 26 pages — it carries 8". The same commit therefore
  states, four files apart, that the honest run carries 8 pages in total and that every producer reaches 8 of
  its own. Both cannot be true. (3) *Does it matter?* The universal errs on the cautious side (it over-states
  how often the trade bites), so nothing a buyer receives is wrong — but it is the sentence a future round will
  cite when deciding whether to cap the reserve, and it is the exact "true measurement written as a universal"
  shape round 9 was punished for. The number 8 itself is right; only "every producer" is not.
- fix sketch: "…reaches it at EIGHT — reachable by a producer that fetches eight pages of its own, which the
  honest comprehensive fixture never does (8 extracted pages across 15 agents); the SNIPPET call's 37 is out of
  reach for any budget the flagship ships." Say what was measured, not what is assumed about production.

### F5 · The record says `isEvidence` now applies to the basics field. It does not, and the commit never claimed it did — P2
- where: `docs/plans/deep-review.md:2043-2047` (R9-13 stamped **done `d77ffb3`**, with the sentence
  "`isEvidence` is applied to directives only, not to the field the code calls higher-bar" left standing as part
  of the closed finding) and `docs/plans/m-red-team-reports/round10/BRIEF.md:48-50` ("`isEvidence` now applies to
  the higher-bar field too").
- input / observed: `enrich.ts:553` — directives: `if (said && isEvidence(said)) quotes[f.key] = said;`.
  `enrich.ts:592` — basics: `quotes[f.field] = said;`, with no `isEvidence` anywhere on the path. Behaviourally:
  quote `pete` (4 letters, `isEvidence` false) against value `St. Petersburg, FL` is accepted and `«pete»` is
  stored as the displayed evidence.
- status: **reproduced** (the `St. Pete` case is `preflight-proposals.test.ts`'s own new test; `isEvidence`'s
  absence on that path is a grep).
- refutation attempted: is it a bug or a decision? A **decision**, and a defensible one — `d77ffb3`'s message
  states the asymmetry explicitly ("an anchor is corroborated by matching the value, a tick stands alone, and
  `Pete` is four letters"), and G2-break F3's fix sketch had two halves of which only the second was taken. The
  commit is honest. The RECORD is not: the backlog stamps the finding closed with the un-taken half quoted
  inside it, and the round-10 brief promotes that half to a statement of fact for eight reviewers. This is the
  round-9 shape one level up — a true fix written up as a wider one.
- fix sketch: in the R9-13 entry, mark the `isEvidence`-on-basics half as **declined, with reason** (the anchor
  is the basics gate; `ANCHOR_WORD_LEN = 4` is deliberately one below `CONTENT_WORD_LEN = 5`), and drop the
  clause from the brief. Note this overlaps G4's group (the record) — I report it because it is a claim about my
  group's code.

### F6 · A six-digit budget is a "content word": `«500000»` pre-ticks a directive — P2
- where: `packages/core/src/moderation/enrich.ts:308-310`. `words()` splits on `[^\p{L}\p{N}]+`, so `\p{N}`
  runs count toward `CONTENT_WORD_LEN`.
- input / observed:
  ```
  note 'Busco una lavandería, presupuesto 500000, algo tranquilo.'
  model { riskAppetite: { value: 'opportunistic', quote: '500000' } }
    → directives = {"riskAppetite":"opportunistic"}   quotes = {"riskAppetite":"500000"}   ← TICKED
  quote '500k'               → not ticked (4 chars)
  quote 'presupuesto 500000' → ticked
  ```
- status: **reproduced** (same scratch harness as F1).
- refutation attempted: the commit's rule is stated three times — "a quote must contain a **word of five
  letters or more**", "Function words … are almost all four **letters** or fewer; content **words** are almost
  all five or more", "A quote is evidence when it contains a WORD" — and the linguistic argument that justifies
  the threshold (function words are short, content words are long) says nothing about digits. A price is in
  every note a buyer types, which is precisely the `de la` / `una` class the rule exists to refuse; it is a
  smaller hole only because a model must choose the number as its span. I could not find any test that pins
  digit behaviour either way, so this is unpinned as well as unintended.
- fix sketch: `words()` for the TICK gate should count `\p{L}` only (`isEvidence` over
  `fold(s).split(/[^\p{L}]+/u)`); the ANCHOR gate should keep `\p{N}`, because a value like
  `Highway 27 corridor` legitimately anchors on a number. What a naive fix loses: sharing one `words()` between
  both gates is what makes the two thresholds readable side by side, so split it deliberately and say why.

## Claims checked and TRUE (so nobody re-checks)

- **`d77ffb3`, all five mutation counts** — 1 / 2 / 1 / 1 / 1, each landing on exactly the test the commit says
  pins it. Table in the audit below.
- **`d77ffb3`: "That branch was pinned by NOTHING: deleting it measured 0 red."** Re-run at `c1397a9`
  (= `d77ffb3^`) with `isEvidence` reduced to `q.trim().length >= QUOTE_TICK_MIN_LEN`: core **720 passed, 0
  failed, 16 skipped**. Confirmed.
- **`d77ffb3`: the two thresholds are applied on both sides.** `quoteNames` filters quote words AND value words
  at `>= ANCHOR_WORD_LEN` (`:346-347`); `verbatim()` still uses `flatten`, not `fold`, so what is quoted back to
  the buyer keeps its accents (`«à Orléans»` is stored verbatim while comparing folded) — checked by reading the
  stored `quotes.location` in the R9-5 test, which asserts the accented form.
- **`5a7b844`: "replace `rankEvidence(evidence, MAX_SNIPPETS, …)` with `evidence.slice(0, 48)` and the test
  stayed GREEN, still printing 12/12."** Re-run at `d77ffb3` (= `5a7b844^`): the density test passes and prints
  `refiner: 12/12 shortlisted listings and 44/48 of its own results rendered as [S]`, while the sparse-corpus
  test in the same file reds. Exactly as claimed.
- **`5a7b844`: "The reserve still has no end-to-end pin."** `const reserve = 0` at `20f361b` reds 3 tests, all
  three in `evidence-ranking.test.ts`; `refute-b1.test.ts` stays green. Confirmed, and the comment still says so.
- **`2f5ab43`: all three mutation counts** — 1 / 3 / 3, suite-wide, as stated ("3 red (2 before this commit)"
  for the reserve is consistent with `5a7b844`'s 2).
- **`2f5ab43`: the reserve arithmetic in the new test.** `reserve = min(8, floor(14/2)) = 7`, `fetched` served
  `14 − 7 = 7` of its 10; the "old classification" arm gives 10 own + 4 referenced. Both asserted, both hold,
  and the numbers in the comment match the code at `prompt.ts:306`.
- **`2f5ab43`: every d-legit figure except the checkpoint title (F3).** Observed: 234 loop calls ✔,
  **78** of 92 turns ✔, 8 of 10 producers STALLED ✔, `5686.8k` loop chars = 5.69M ✔, 5686.8/4030.5 = **1.41×**
  plan-once ✔, `$0.9987 + $1.6540 = $2.6527` → $2.65 ✔, `$0.5763 + $0.7380 = $1.3143` → $1.31 ✔,
  1.3143/2.6527 = **49.5%** → "~50%" ✔, 8 pages ✔.
- **`2f5ab43`: `urlsIn` excluding `\`.** Both new expectations hold, and the R9-12 reasoning is sound — a store
  url cannot contain a backslash, so a match that keeps one can only miss.
- **`b18ea51`: both mutation counts** — 1 / 1, each landing on the renamed bounds test.
- **`b18ea51`: "the five `maxLength`s".** Walked every section schema of the shipped flagship through
  `z.toJSONSchema` and counted: **`{"minItems":17,"maxLength":5,"maxItems":2}`, zero `minimum`/`maximum`** —
  exactly the figures in `gemini-vertex.ts` and `d-attack.test.ts`. All five `maxLength` are chart fields
  (`title` 160, `description` 500, `labels.items` 80, `series.items.name` 80, `unit` 8) and all five now carry
  their bound in `description`, so "Every bound is stated in its own `.describe()` now" is TRUE for everything
  that ships.
- **`b18ea51` R9-15: "they have been a validation ERROR since R8-20, and `assertTemplatesValid` runs at module
  load."** `validate.ts:67-80` rejects all four of `focus` / `sites` / `researchBudget` / `gatherModel` when
  `!hasResearchLoop(a)`, `hasResearchLoop = a.role === 'producer'` (`types.ts:60-62`), and
  `registry.ts:13` calls `assertTemplatesValid` at module scope — so it fails the boot, not the request.
  `docs/agents.md`, `docs/extending.md` and both `types.ts` field comments now say all four.
- **Suite totals in all four messages are arithmetically consistent**: 729+216+22+160+6 = 1133 (`d77ffb3`,
  `5a7b844`); 731+216+22+161+6 = 1136 (`2f5ab43`, `b18ea51`).

Minor, not raised as a finding: `b18ea51` says "The title says what it asserts", and the new title —
"forwards the array and number bounds to the decoder, and withholds `maxLength` on purpose" — is now narrower
than the test, which also asserts that a string `pattern` IS forwarded and that five chart descriptions carry
their bounds. Claiming less than you assert is the safe direction of R9-16's error, so I note it and leave it.

## Commit-message audit (verifiers only): every count re-run, claimed vs observed

All rows measured at `20f361b` over `packages/core` + `apps/api` unless a tree is named. Baseline for those two
suites: 751 / 216 passed, 0 failed.

| # | commit | mutation | claimed | observed | verdict |
|---|---|---|---|---|---|
| 1 | `d77ffb3` | `isEvidence` regains `\|\| /\s/.test(q.trim())` | 1 red | 1 red (`R9-4` two-word fragment) | ✔ |
| 2 | `d77ffb3` | `CONTENT_WORD_LEN` 5 → 3 | 2 red | 2 red (R8-26 filler + R9-4) | ✔ |
| 3 | `d77ffb3` | `ANCHOR_WORD_LEN` 4 → 3 | 1 red | 1 red (R9-13 three-letter anchor) | ✔ |
| 4 | `d77ffb3` | `shares` → `a === b` (prefix dropped) | 1 red | 1 red (R9-5 normalisation) | ✔ |
| 5 | `d77ffb3` | `fold` → `flatten` (accents kept) | 1 red | 1 red (R9-5 normalisation) | ✔ |
| 6 | `d77ffb3` | at `c1397a9`: delete the space branch | **0 red** | 0 red (core 720 passed) | ✔ |
| 7 | `5a7b844` | `rankEvidence` → `evidence.slice(0, MAX_SNIPPETS)` | 2 red | **4 red** suite-wide (2 in `refute-b1`); 3 suite-wide at `5a7b844^` | ✘ F2 |
| 8 | `5a7b844` | `take(touched)` emitted above `takeSpread(referenced)` | 1 red | **2 red** suite-wide (1 in `refute-b1`) | ✘ F2 |
| 9 | `5a7b844` | `const reserve = 0` | 2 red, both UNIT | 3 red at HEAD, all unit, 0 e2e (= 2 at that tree per `2f5ab43`) | ✔ |
| 10 | `5a7b844` | at `d77ffb3`: same as #7, density test stays GREEN at 12/12 | GREEN, 12/12 | GREEN, prints `12/12 shortlisted … 44/48 of its own` | ✔ |
| 11 | `2f5ab43` | `\\` back inside the `urlsIn` character class | 1 red | 1 red (R8-18 escape test) | ✔ |
| 12 | `2f5ab43` | `referenced` classified after `touched` | 3 red | 3 red (2 unit + the density e2e) | ✔ |
| 13 | `2f5ab43` | `const reserve = 0` | 3 red (2 before) | 3 red | ✔ |
| 14 | `b18ea51` | `unit` loses "at most 8 characters" from `.describe()` | 1 red | 1 red (the bounds test) | ✔ |
| 15 | `b18ea51` | `description` loses "At most 500 characters" | 1 red | 1 red (the bounds test) | ✔ |

Measured figures re-run (not mutations):

| commit | figure | claimed | observed | verdict |
|---|---|---|---|---|
| `2f5ab43` | d-legit re-plan loop calls / turns | 234 / 78 of 92 | 234 / 78 of 92 | ✔ |
| `2f5ab43` | re-plan loop chars, × plan-once | 5.69M, 1.4× | 5686.8k, 5686.8/4030.5 = 1.41× | ✔ |
| `2f5ab43` | stalled producers | 8 of 10 | 8 | ✔ |
| `2f5ab43` | comprehensive vs essential all-in | $2.65 vs $1.31, ~50% | $2.6527 vs $1.3143, 49.5% | ✔ |
| `2f5ab43` | §6 checkpoint title | 185k chars, 8 pages, 137k report | **184.0k**, 8 pages, **135.9k** (185k/137k are §2's) | ✘ F3 |
| `5a7b844` | PAGES-call threshold | 8, "which every producer does" | 8 ✔; "every producer" refuted by the fixture's 8 pages per 15-agent run | ✘ F4 |
| `2f5ab43` | reserve for the R9-8 test | `min(8, 7) = 7` → 7 own + 7 referenced; old = 10 + 4 | as asserted, holds | ✔ |
| `b18ea51` | flagship section bounds | 17 `minItems`, 2 `maxItems`, 5 `maxLength`, 0 `minimum`/`maximum` | identical, to the item | ✔ |
| all four | suite totals | 1133 = 729+216+22+160+6; 1136 = 731+216+22+161+6 | arithmetic consistent; clean-worktree baseline at HEAD is 1162 as the brief predicts | ✔ |
