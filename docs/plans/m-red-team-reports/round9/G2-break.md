# G2-break — templates, the quote gate and the provider (`1ab2a86`) / BREAK

Measured at **`a37d5f57f2f4f9f042ba704a6dec96a7b7aa68da`** (`git rev-parse HEAD` printed it). `npm test` from the
worktree root: **1109 passed, 0 failed (708 core + 215 api + 22 worker + 158 fbizlab + 6 admin), 16 skipped in
core** — the brief's clean-worktree number exactly. I did not symlink `out/`, so the six trace-gated red-team
tests did not run. All mutations below were run as a full `packages/core` suite (708 clean) and reverted;
`git status --porcelain` is empty and `git diff` is clean.

## Verdict

Two of the three fixes do less than the message says, and one of them costs an honest buyer something it did not
cost them before. **R8-20 (the validator) holds** — the four fields are read only inside the research loop, no
legitimate template shape is refused, and both halves red under mutation. **R8-26 does not hold.** The directive
tick gate is `length ≥ 8 OR contains a space`; the second branch re-admits exactly the class the commit set out to
refuse — `«de la»`, `«of the»`, `«en el»` pre-tick a directive today, reproduced — and that branch is pinned by no
test at all (deleting it is 0 red, while the test that claims to cover it asserts two quotes that are both ≥ 8
characters). The basic anchor is per-token by substring, so `{location: 'The Villages, FL', quote: 'the'}` is
accepted for a buyer who wrote Hialeah, with `«the»` printed as the evidence — R8-26's own example with the value
swapped. In the other direction the anchor now DROPS honest proposals that used to arrive: `St. Pete →
St. Petersburg, FL`, `Jax → Jacksonville, FL`, `Orléans → Orleans, FL`, and any value with no 3-character token,
and for a basic there is no unticked fallback — it vanishes. **R8-21 (the Gemini bound) is a defensible decision
implemented incompletely**: withholding `maxLength` removed the only channel that told the model any of the five
bounds, and `unit` (`.max(8)`, the tightest) carries no `.describe()` at all, so nothing anywhere now tells the
model it exists. One overshoot buys a second full structured call of the agent's whole slice; two lose the slice
(`schema:unit:too_big`, reproduced) — which is the failure mode the repo's own comment 250 lines away
(`research-engine.ts:1099`) says never to create with a schema length limit.

## Findings (most severe first)

### F1 · Any two-word fragment still pre-ticks a directive — `«de la»` ticks `riskAppetite`, and nothing pins the rule that lets it — P1
- where: `packages/core/src/moderation/enrich.ts:299` (`isEvidence`), used at `:504`
- input / observed:
  ```
  note:   'Busco una lavandería en Hialeah, uno de los negocios de la zona.'
  model:  { riskAppetite: { value: 'opportunistic', quote: 'de la' } }
  →  directives = {"riskAppetite":"opportunistic"}   quotes = {"riskAppetite":"de la"}
  ```
  English is the same: note `'I am looking at one of the laundromats in Hialeah.'`, quote `'of the'` →
  `quotes = {"riskAppetite":"of the"}`. `apps/fbizlab/src/pages/NewReport.tsx:183`
  (`out[k] = !!proposals.quotes?.[k]`) turns a present quote into a **pre-ticked** row, so the buyer submits a
  preference they never expressed unless they untick it.
  The gate measures LENGTH, not relevance, and the commit's own new test says so: it asserts
  `ok.quotes?.riskAppetite === 'lavandería'` — a laundromat is asserted as valid evidence for a *risk appetite*.
  `«una»` (3) is refused and `«de la»` (5) is accepted; the commit's stated reason for the threshold is that
  `una`, `the`, `for`, `sale` "appear in almost every note a buyer typed", and `de la` / `of the` / `en el` are in
  that same class.
  Mirror-image honest loss: a genuine one-word quote under 8 characters no longer ticks —
  `{ ownerInvolvement: 'absentee', quote: 'ausente' }` on `'Quiero un dueño ausente.'` gives
  `quotes = undefined`. Spanish, French and Portuguese carry meaning in 6–7 letter words (`ausente`, `riesgo`,
  `deuda`, `retiro`, `turnkey`) far more often than English does, so the threshold reads as a language penalty:
  the meaningless `de la` ticks, the exact word `ausente` does not.
- status: **reproduced** — `acceptProposals` driven directly against the flagship template (probe kept at
  `<scratchpad>/zz-g2break.test.ts`); and by mutation: deleting `|| /\s/.test(q.trim())` from line 299 leaves the
  core suite at **708 passed, 0 failed**. The second half of the shipped gate is pinned by nothing. The test that
  claims to cover it (`test/preflight-proposals.test.ts:169-176`) comments "in either shape: long enough to be
  evidence, or more than one word" and then asserts `'que se maneje sola'` (18 chars) and `'lavandería'` (10) —
  both pass on length alone, neither exercises the word-count branch.
- refutation attempted: (1) does the client really tick on a quote? Yes — `NewReport.tsx:183`, and basics are
  explicitly excluded there (`:185`), which is why this is the directive half and not the basic half. (2) Would a
  model really emit `de la`? `quote` is `required` in the response schema (`enrich.ts` `withQuote`), so a model
  that proposes without a literal quote must produce one; round 7 measured 9 of 10 notes getting a value in all 7
  directive fields with invented justification. That premise is unchanged by this commit. (3) Is `ausente` a real
  loss? It is only the tick, not the proposal — which is why this is P1 and not P0.
- fix sketch: require the quote to be a phrase in the sense the comment means — e.g. two words **and** ≥ 6
  characters, or one word ≥ 8 — and pin BOTH branches with a mutation-red test each. A naive tightening to
  "≥ 8 characters only" would silently un-tick honest short two-word evidence (`no debt`, `sin deuda` is 9 so it
  survives, `as-is` does not); state which side you are choosing and test it.

### F2 · An honest buyer's normalised location now vanishes instead of being offered — `St. Pete`, `Jax`, `Orléans` — P1
- where: `packages/core/src/moderation/enrich.ts:313-317` (`quoteNames`), enforced at `:535` with `continue`
- input / observed (all four were ACCEPTED before this commit and are DROPPED after — verified by re-running the
  same probe with line 535 neutralised):
  ```
  note 'Laundromat in St. Pete, budget 500k.'      value 'St. Petersburg, FL'  quote 'St. Pete'   → null
  note 'Laundromat in St. Pete, budget 500k.'      value 'Saint Petersburg, FL' quote 'in St. Pete' → null
  note 'A car wash anywhere in Jax.'               value 'Jacksonville, FL'    quote 'in Jax'     → null
  note 'Je cherche une laverie à Orléans, FL.'     value 'Orleans, FL'         quote 'à Orléans'  → null
  note 'Quiero un negocio en LA, sin deuda.'       value 'LA'                  quote 'en LA'      → null
  note '東京で店を買いたい'                          value '東京'                quote '東京'        → null
  ```
  `flatten()` lowercases but does not strip diacritics, so the model's normal ASCII-normalisation (`Orléans` →
  `Orleans`, `Bogotá` → `Bogota`) breaks the anchor in the one direction a model actually normalises. The
  `t.length >= 3` filter drops every token of a two-letter or two-ideograph value, and `tokens.length > 0` then
  makes the guard refuse outright — a CJK city name has no surviving token at all.
  The severity is that for a BASIC there is **no unticked lane**: `continue` removes the proposal. The
  `QUOTE_TICK_MIN_LEN` doc-comment at `:293-296` advertises the fallback ("the proposal still stands, it is just
  shown unticked — which is the designed fallback") one screen above a guard that has no such fallback. A buyer
  who wrote "Jax" and relied on the assist now submits with `location` at its default `'State of Florida, USA'`
  (`florida-business-for-sale.ts:407`) — a statewide report instead of a Jacksonville one, for the same money.
- status: **reproduced** — probe at `<scratchpad>/zz-g2break2.test.ts`, run once at HEAD and once with `:535`
  replaced by a comment; the "before" column is the second run.
- refutation attempted: (1) Is `St. Pete → St. Petersburg, FL` a real model behaviour? It is the same
  normalisation the commit message relies on to justify per-token matching ("the model still gets to normalise
  `Hialeah` into `Hialeah, FL`"); `St. Pete` and `Jax` are the standard local shorthands in the flagship's own
  market. (2) Is the loss buyer-visible? No — that is the problem: a proposal that is refused is indistinguishable
  from a model that proposed nothing. (3) Does the API fill it another way? No; `applyProposals` never applies
  basics without `{basics:true}` and the form field simply stays empty.
- fix sketch: normalise both sides before comparing (NFD + strip combining marks, as the correction sanitizer
  already does elsewhere), match a value token as a PREFIX of a quote token as well as a substring (`pete` ↔
  `petersburg`), lower the token floor to 2, and when the anchor fails keep the proposal but drop the quote
  instead of dropping the row — i.e. give basics the same unticked lane the comment already promises. Naively
  dropping the anchor altogether re-opens F3 below.

### F3 · The anchor is a substring of one 3-character token, so `«the»` still buys a location the buyer never named — P2
- where: `packages/core/src/moderation/enrich.ts:313-317`; the quote is stored unfiltered at `:543`
- input / observed:
  ```
  note 'I want to buy the laundromat in Hialeah, budget 500k.'
  model { location: { value: 'The Villages, FL', quote: 'the' } }
  → basics = {"location":"The Villages, FL"}   quotes = {"location":"the"}

  note 'Busco una lavandería en Hialeah, uno de los negocios que quiero.'
  model { location: { value: 'Los Angeles, CA', quote: 'los' } }
  → basics = {"location":"Los Angeles, CA"}    quotes = {"location":"los"}
  ```
  That is R8-26's own sentence with the value swapped: a location from anywhere on earth, carried by a
  three-letter quote, shown to the buyer as the evidence for it (`NewReport.tsx:1153` renders `— «the»` next to
  the value). `isEvidence` is applied to directives only (`:504`); the basic path at `:543` stores whatever
  `verbatim` returned, so the ≥ 8 / two-word rule the commit describes does not reach the field it calls
  higher-bar. Any value containing a common 3+ letter token qualifies: `The Villages, FL` (a real Florida city),
  `Los Angeles, CA`, `New Smyrna Beach` via `«new»`, `San Juan` via `«san»`.
  Related, same line: the anchor does not bound the value to the place the buyer named. `Miami` →
  `Miami Beach, FL` and `Miami Gardens, FL`, `Hialeah` → `Hialeah Gardens, FL`, `Palm Beach` →
  `West Palm Beach County, FL` all pass — different municipalities, different search scope.
- status: **reproduced** (same probes). Also by mutation: relaxing the token floor from `>= 3` to `>= 1` leaves
  the core suite at **708 passed, 0 failed** — the floor that gives the anchor whatever strength it has is pinned
  by nothing.
- refutation attempted: a basic is never pre-ticked (`NewReport.tsx:177-178, 185`) and never rides in
  `proposedParams` (`preflight.ts:96` calls `applyProposals` without `{basics:true}`), so the buyer must click.
  That is what keeps this at P2 rather than at the P1 the commit's framing implies — but the false EVIDENCE is
  buyer-visible either way, and "«una» shown as the evidence for Orlando" was the sentence in the commit title.
- fix sketch: apply `isEvidence` to the basic quote as well (a 3-letter word is not evidence for anything), and
  require the matched token to be ≥ 4 characters or to be the value's longest token, so `The Villages` must be
  anchored on `villages`.

### F4 · The five chart bounds are now told to nobody, and `unit` (8 chars) has no description at all — P2
- where: `packages/core/src/llm/gemini-vertex.ts:288-303` (the withheld forward); `packages/core/src/templates/chart.ts:12-27`
- input / observed: `jsonSchemaToGemini(z.toJSONSchema(chartSchema))` now emits
  ```
  "title":  {"type":"STRING","description":"Chart title, in the report language."}
  "description": {"type":"STRING","description":"One-line caption explaining what the chart shows."}
  "labels": {"type":"ARRAY","minItems":"1","maxItems":"40","items":{"type":"STRING"}}
  "series": {... "name":{"type":"STRING"} ...}
  "unit":   {"type":"STRING"}
  ```
  Not one of the five bounds survives, and not one of the five is stated in prose either: `unit`'s only
  documentation of its 8-character limit and its `'$' / '%' / 'x' / 'yrs'` examples is a `//` JSDoc comment
  (`chart.ts:26`) that `z.toJSONSchema` never emits. The bound is now enforced exclusively by a Zod rejection
  after the fact, on the WHOLE agent slice — a chart is embedded in a section schema, and the section write is one
  structured call covering every section that agent owns plus its handoff.
  Measured against `synthesizeStructured` with a stub provider:
  - one over-long `unit` (`'millones de $'`, 13 chars) → **2 provider calls**, cost recorded twice
    (`[0.008, 0.008]` at 4k/4k tokens each), then the corrected value;
  - a model that repeats it → `StructuredOutputError: Structured output failed schema validation: unit: Too big:
    expected string to have <=8 characters`, signature `schema:unit:too_big`, after 2 calls — the agent's whole
    slice fails, retries, and degrades. That is a lost SECTION, not a truncated caption.
  This is precisely what `research-engine.ts:1099` already says in writing about the handoff field: "No `.max()`
  here on purpose. A length limit in the SCHEMA makes the model's verbosity a failure mode for the whole write:
  one over-long briefing and the agent's sections fail validation, retry, and eventually degrade. The limit is
  enforced where it belongs — on the way in, by cutting it." The chart bounds are now in exactly the position that
  comment forbids, and the commit's counter-argument ("a repair round we pay for and can see") is only half true:
  the repair round writes no log event and appears in no trace field — `grep -rn "repair" packages/core/src`
  returns only comments. The only trace is a larger dollar total, which is the same thing the commit calls the
  *invisible* failure.
  The argument also does not fit all five uniformly: "a caption cut mid-sentence" is a real risk for `title` (160)
  and `description` (500), but `unit` is a formatting token of at most 8 characters — there is no sentence in it
  to cut — and `labels[]` / `series[].name` are axis labels.
- status: **reproduced** for the schema output and the two cost measurements (probe at
  `<scratchpad>/zz-g2break3.test.ts`); **reasoned** for what a real Vertex decoder does, which the mock tier
  cannot answer — as the commit itself says.
- refutation attempted: (1) Does Zod really still enforce all five? Yes — verified by the `too_big` failure above
  and by `z.object({l: z.string().max(80)}).safeParse('x'.repeat(81))`. (2) Is `minLength`/`pattern` "dead for the
  flagship" as claimed? Yes — no `z.string().min(n)` and no `.regex()` in any section schema (`chart.ts`,
  `blocks.ts`, `florida-business-for-sale.ts`); the only string `.min(1)` is in `paramsSchema`, which is never a
  `responseSchema`. (3) Is any other schema sent to Gemini carrying a `maxLength`? No — the proposal, correction
  and moderation schemas declare none.
- fix sketch: keep the withholding for `title`/`description` if you want, but put every bound in `.describe()`
  where it costs nothing and the model reads it ("at most 8 characters, e.g. `$`, `%`, `x`, `yrs`") — `unit` has
  no description today at all. For `unit` specifically, the honest option is the one the handoff already uses:
  drop `.max(8)` from Zod and clip on the way in, so a verbose unit costs a truncation nobody misses instead of a
  repair round or a lost section. A naive re-forward of `maxLength` restores the silent-truncation risk the commit
  is right to be worried about for `description`.

### F5 · Two paragraphs of the same file now say opposite things about `maxLength`, and a test title asserts the version that is false — P2
- where: `packages/core/src/llm/gemini-vertex.ts:270-281` vs `:288-303`; `packages/core/test/red-team/d-attack.test.ts:374`
- input / observed: the pre-existing paragraph was left intact — "The string bounds ride along now… the `Schema`
  type we do send documents `minLength`/`maxLength`/`pattern` in the same voice as the four above… and `.max(80)`
  on a label was costing a repair round" — directly above the new one that says `maxLength` is deliberately not
  forwarded. A reader of the first paragraph concludes the opposite of the code. In the same commit the red-team
  test's assertion was inverted but its TITLE was not: `it('jsonSchemaToGemini forwards every bound the schema
  declares — array, number AND string — to the decoder')` now asserts, three lines down, that the one string
  bound the flagship actually uses is `toBeUndefined()`.
- status: **reproduced** (read at HEAD; the mutation run "forward `maxLength` again" reds exactly this test, and
  the failure line prints the false title).
- refutation attempted: neither is executable, so neither changes a buyer's report today. It is the standing
  lesson-2 shape the last eight rounds keep finding, in the file the next person will read before deciding
  whether to flip the forward back.
- fix sketch: fold the old paragraph into the new one (keep the `minItems` history, delete the sentence that says
  the string bounds ride along), and rename the test to "forwards the array and number bounds, and deliberately
  withholds `maxLength`".

### F6 · `types.ts` and the two authoring docs still tell a template author these fields are "ignored" on a synthesizer; they are now a throw at module load — P2
- where: `packages/core/src/templates/types.ts:94` and `:112-116`; `docs/agents.md:19-26`; `docs/extending.md:20-29`
- input / observed: `researchBudget` is documented as "Web-search/fetch budget for producers (ignored for
  synthesizers)" and `sites` as "Ignored for synthesizers (they don't search)" — both are now hard validation
  errors. `docs/agents.md` was updated for `focus` only ("`validateTemplate` refuses it on a synthesizer") and
  lists `researchBudget`/`gatherModel`/`sites` with no such note. `docs/extending.md:26-29` enumerates what
  "Validation rejects" and none of the four appear in the list. The consequence is not a warning:
  `registry.ts:13` calls `assertTemplatesValid` at module load, so a second template that follows the doc throws
  on import and the API and worker fail to boot. (`focus`'s own doc at `types.ts:103-109` WAS updated in the
  earlier commit — this one added three more fields and updated none of their docs.)
  Same line, minor: the guard fires on `!== undefined`, so `sites: []` or `researchBudget: 0` on a synthesizer —
  the shape a `agents.map(a => ({ researchBudget: 8, ...a }))` helper produces — errors with a message
  ("it becomes SUGGESTED SOURCES in the research kickoff") that is not true of an empty array.
- status: **reproduced** (read at HEAD; `registry.ts:13` throw path confirmed by reading
  `validate.ts:184-188`).
- refutation attempted: the flagship declares none of the four on a synthesizer (`validateTemplate(t)` returns
  `[]`), and `apps/admin` does not author templates — no template in the tree is broken today. This costs the
  NEXT template author a boot failure with the docs on their side, which is exactly the argument the commit makes
  for the guard ("a second template cannot repeat this").
- fix sketch: change both `types.ts` comments to "declaring it on a synthesizer is a validation error" and add the
  four to `docs/extending.md`'s rejection list and to `docs/agents.md`'s field table.

## Claims checked and TRUE (so nobody re-checks)

- **R8-20 refuses nothing legitimate.** `hasResearchLoop` is `role === 'producer'` and `AgentRole` has exactly two
  values, so "no research loop" is "synthesizer". All four fields are read only inside the loop:
  `research-engine.ts:1122` (`gatherModel`), `:1123` (`researchBudget`), `:1124` → `effectiveSites` at `:1236`
  (`sites`, whose only caller is `:1124`), and `focus` in the kickoff. `research-engine.ts:615` already omits
  `gatherModel` from the plan for a non-producer. Nothing in `apps/admin`, `apps/api` or `apps/fbizlab` constructs
  an `AgentSpec`. All 15 flagship agents (10 producers, 5 synthesizers) pass.
- **`minLength` and `pattern` are dead for the flagship.** No `z.string().min(n)` and no `.regex()` in any section
  schema; the string `.min(1)` in `florida-business-for-sale.ts:409` is `paramsSchema`, never sent to a model.
- **Zod still enforces all five `maxLength`s** after the forward was withdrawn (F4, measured).
- **The honest normalisation the message names does survive**: `Hialeah` → `Hialeah, FL` with quote
  `'lavandería en Hialeah'` is accepted, and so are one-word cities that are ≥ 3 characters (`Doral`, `Ocala`).
- **An inference with no literal quote still arrives unticked** — the designed lane is intact for directives.
- **`proposedParams` never carries a basic** (`preflight.ts:96`, `applyProposals` default `opts.basics`), so
  nothing in F2/F3 is auto-applied by a client that accepts everything.

## Commit-message audit (not my lens, but I ran them: claimed vs observed)

Every mutation the message lists reproduces, at the count and for the reason claimed. Full `packages/core` suite
per mutation, clean worktree baseline **708 passed / 0 failed**:

| mutation | claimed | observed | which test |
|---|---|---|---|
| the validator forgets `sites` | 1 red | **1 red** | `templates.test.ts` › "…and refuses the other three loop-only fields (R8-20)" |
| the validator forgets `focus` | 1 red | **1 red** | `templates.test.ts` › "the validator refuses one, and names the kind so the author knows why" — the original guard does still bite |
| tick threshold back to 3 characters | 1 red | **1 red** | `preflight-proposals.test.ts` › "a filler word is not evidence (R8-26)" |
| a basic accepts any verbatim quote | 1 red | **1 red** | `preflight-proposals.test.ts` › "refuses a location from anywhere on earth carried by a three-letter quote" |
| `maxLength` forwarded again | 1 red | **1 red** | `d-attack.test.ts` › the D1 bound test (whose title is now false — F5) |

Two mutations the message does NOT list, and should have, because they are 0 red (F1, F3):

| mutation | observed |
|---|---|
| drop `\|\| /\s/.test(q.trim())` from `isEvidence` (the two-word half of the shipped gate) | **0 red** — 708 passed |
| `quoteNames` token floor `>= 3` → `>= 1` | **0 red** — 708 passed |

Suite total: the message's "1113 passed (713 + 215 + 22 + 158 + 5)" is right. I checked out `1ab2a86` and measured
core in a clean worktree: **707 passed, 16 skipped**; 707 + 6 trace-gated = 713, and the previous commit
(`0250063`) claims 709 core, +4 for the four tests this commit adds. The chain is consistent, and "up from 1109"
compares main-checkout to main-checkout correctly — the collision with the brief's clean-worktree 1109 at the tip
is a coincidence, not an error.
