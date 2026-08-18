# G1-break — the research LOOP and the DOSSIER (`f013cfe` B2, `1fa5d31` B1, `72d2777` onTurn) / BREAKER

Worktree moved to `a11bafe` (it started at `d1ac4dd`, i.e. *before* the batch — worth telling the other seven).
Ran `apps/api/test/resolution.test.ts` — **passes** (there is no `packages/core/test/resolution.test.ts` at this
commit; the two that exist are `apps/api` and `apps/worker`). Full core suite at `a11bafe`: 627 passed / 16 skipped.
All measurements below were run in this worktree; `src/` is unmodified (mutations reverted, `git status` = only my
scratch dir `packages/core/test/g1/`).

## Verdict

The plan breaker is real and correctly calibrated (I confirmed against the two real July traces in `out/`: the
honest maximum run of plan-only turns is **2**, the limit is 4, and both pathological runs die at iteration 12 and 4
instead of 26 and 16). `stalled→budget` is right and its sibling test is honest. But the two headline *bounding*
claims do not survive contact: adding **one free cached re-read per turn** dodges the plan breaker completely and
still buys 54 LLM calls / 975k prompt chars for zero turns and zero evidence — and the same-URL cap does not stop
that loop "growing", it only shaves 38% off it (1.57M → 0.97M chars; the last request is still 32k). On B1 the
direction of the fix is right but the tier weights are wrong for production: at Brave/Tavily density (8 results per
query, not the fixture's 5) any agent with ≥6 searches fills all 48 snippet slots with its *own* results, so the
`referenced` tier — the mechanism the commit says is "how the refiner finds the scout's listing pages without a
re-read" — is structurally unreachable for the exact agent it names. I reproduced a wave-2 enricher going from 12/12
to **0/12** of the listings it was handed. And the claim "a resumed agent … falls back to the referenced tier and
store order — the same as today, never worse" is false: it falls back to the *diversity-first* foreign pass, which
on a legitimately marketplace-heavy store swaps 8 of 48 snippets away from the marketplace. `72d2777`'s `onTurn` is
correct within a dispatch (no double count — the post-loop line is an assignment, not `+=`), but it silently
inverted a documented invariant 400 lines above it and left the comment saying the opposite.

---

## Findings (most severe first)

### F1 · At production search density the wave-2/3 enricher sees ZERO of the listings it is handed to enrich — the tier the commit built for exactly that case is unreachable — P1

- **where:** `packages/core/src/engine/prompt.ts:241` (`rankEvidence(evidence, MAX_SNIPPETS=48, …)`) and
  `prompt.ts:200-215` (tier order `fetched → touched → referenced → rest`), reached from
  `research-engine.ts:988` (`buildEnricherSynthPrompt`) / `research-engine.ts:1000` (`buildProducerSynthPrompt`).
- **input / observed:** `touched` is *every URL a search returned to this loop*. Brave (`tools/web-search.ts:66`,
  `count=8`) and Tavily (`:85`, `max_results: 8`) both return 8 per query. So a producer with ≥6 searches has ≥48
  touched URLs and tiers 1+2 alone fill `MAX_SNIPPETS`. On the Florida flagship (`budgetScale: 1`) that is
  **7 of 10 producers**: deal-scout 24 → ~192, deep-dive-refiner 10 → ~80, valuation-analyst 10 → ~80,
  market/competition/compliance/community 8 → ~64, financial 6 → 48 exactly. Their dossiers are 100% own; the
  foreign and referenced tiers render nothing.
  Reproduced end-to-end (`packages/core/test/g1/b1-density.test.ts` + `g1/fake-web8.ts`, an 8-results/query web):
  wave-1 scout does 12 searches + 12 listing fetches and writes a shortlist of 12 `sourceUrl`s; wave-2 `refiner`
  (`enriches: ['shortlist']`) does 10 searches + 2 fetches. Store: 184 sources / 24 pages. Its writer prompt:

  | | listing snippets rendered | listing pages rendered |
  |---|---|---|
  | now (`rankEvidence`) | **0 / 12** | 4 / 12 |
  | before (`evidence.slice(0, 48)`) | **12 / 12** | 4 / 12 |

  Its 48 `[S]` slots are its own 48 fresh results; the 12 `sourceUrl`s of the shortlist it is *rewriting* are in
  tier 3 and never reached. Note the page half: 8 of its 14 `[P]` slots went to reddit pages a **peer** fetched,
  purely because its own search happened to *return* those URLs — `touched` (an unread SERP row) outranks
  `referenced` (a URL the writer is told to fill gaps in).
- **status:** reproduced (`cd packages/core && npx vitest run test/g1/b1-density.test.ts`).
- **refutation attempted:** (a) *Is 8/query real?* Yes — both configured backends hard-code 8; only the fixture
  returns 5 (`test/fixtures/fake-web.ts:256`). (b) *Was it better before?* For the enricher, yes: the scout is
  wave 1, so its results are the head of the store and `slice(0,48)` handed the refiner exactly those. (c) *Does
  the refiner still have the URLs?* It has them in `current` as bare `sourceUrl`s with no title/snippet/page —
  which is why the commit added the referenced tier in the first place. (d) *Synthesizers?* Unaffected as claimed —
  `buildSynthesizerPrompt` never calls `buildDossier`, so exec-summary/valuation writers are untouched. Confirmed.
- **fix sketch:** reserve a floor for the lower tiers — e.g. cap tiers 1+2 at `max - referenced.size` (or a fixed
  `Math.min(max*0.75, …)`) before appending `referenced` and `rest`. *Naive-fix cost:* an honest deal-scout with
  192 own results loses ~12 of its own listing snippets to a floor it may not need; the floor should be sized by
  `referenced.size`, not a constant.

### F2 · One extra free tool call per turn dodges the plan breaker entirely: 54 LLM calls, 975k prompt chars, zero turns, zero evidence — and the same-URL cap does not "stop it growing" — P1

- **where:** `packages/core/src/engine/gather.ts:322-323`
  (`const planOnly = res.toolCalls.length > 0 && res.toolCalls.every((c) => c.name === 'update_plan')`),
  `gather.ts:210` (`MAX_SAME_URL_CACHED_READS = 2`), and the commit claim *"the loop still runs, but it stops
  growing"*.
- **input / observed:** measured with `packages/core/test/g1/b2-breaker.test.ts` (budget 24 → `maxIterations = 54`,
  one 6,000-char page pre-seeded in the shared store, plan of 30 steps):

  | script per turn | LLM calls | total prompt chars | first req | **last req** | turns | stop | notes |
  |---|---|---|---|---|---|---|---|
  | A `[update_plan]` | **4** | 10,624 | 29 | 3,907 | 0 | stalled | 5 |
  | B `[update_plan, fetch_page(cached)]` | **54** | **974,761** | 29 | **32,298** | 0 | stalled | 109 |
  | C `[update_plan, web_search]` | 54 | 836,250 | 29 | 27,205 | 24 | budget | 79 |
  | D 100 `update_plan` in ONE turn | 4 | 143,599 | 29 | 81,631 | 0 | stalled | 5 |

  B is the *same* attack as A with one free, budget-free call appended. It costs 13.5× A's calls and 92× A's
  prompt volume, buys nothing, and ends `stalled` with a note that says "Research loop ended: stalled (0/24 turns)"
  — not "someone spun me 54 times". Lifting `MAX_SAME_URL_CACHED_READS` to `Infinity` (mutation, reverted) gives
  1,569,348 chars: the cap is a **38% discount, not a bound**. The per-request size still grows monotonically
  (29 → 32,298), so "stops growing" is not true; what stopped is the *page-body* term, not the conversation term.
- **status:** reproduced (both runs, including the mutation).
- **refutation attempted:** Is B reachable? It is the shape of the real pathological run the commit itself cites —
  `out/local-aa4b3edf` deep-dive-refiner is literally `PcPcPcPc` + 18 `P` (I extracted the note sequences from both
  July traces). The breaker catches it only because the four `c`s happen to come *first*; a page that says
  "re-read me, then revise your plan" produces `(Pc)*` and is not caught at all. Also note B emits **109 progress
  notes** against the 300-note cap for a loop that researched nothing.
- **fix sketch:** count a turn as "no progress" when it spent no budget and returned no new URL (plan ∪ cached-stub
  ∪ refused call), not only when it is plan-only. *Naive-fix cost:* the honest `P c P c P F` refiner
  (`out/local-4837f6e3` deep-dive-refiner, verified) has **five** consecutive free calls before its one paid fetch —
  a plain free-call breaker at 4 cuts it, which is exactly what the commit says it avoided. The counter has to
  reset on a *new* URL, not on any free call.

### F3 · "A resumed agent … falls back to the referenced tier and store order — the same as today, never worse" is not true — P2

- **where:** `packages/core/src/engine/prompt.ts:216-232` (the diversity-first foreign pass) vs the `1fa5d31`
  commit message. A resumed agent takes `research = { done: gathered.has(id), touched: new Set(), fetched: new Set() }`
  (`research-engine.ts:533`) and never runs a loop, so both preference sets are empty and *everything* is the
  foreign tier — which is no longer store order.
- **input / observed:** `packages/core/test/g1/b1-resumed.test.ts`. A July-shaped store (190 sources, 7 hosts,
  90% one marketplace) with empty `fetched`/`touched`/`referenced`:
  - before (`slice(0,48)`): 43 of 48 marketplace listings
  - now (`rankEvidence(…, 48, 8, {})`): **35** of 48 — 8 listings displaced by other hosts, and the pair is not
    identical (`identical: false`).
  A resumed deal-scout writing its shortlist loses 8 marketplace snippets to diversity it did not ask for.
- **status:** reproduced.
- **refutation attempted:** The shipped unit test *"a store that is legitimately 90% one marketplace still fills
  every slot"* (`evidence-ranking.test.ts:64`) is calibrated with **48 items and `max = 48`** — the cap can't bite,
  so the test proves length, not selection. For a store larger than the cap, order *is* volume, and the "the cap
  decides ORDER, never volume" line in the commit is only true when nothing is cut.
- **fix sketch:** skip the diversity pass when `prefer` is empty/absent (`if (!prefer) return items.slice(0, max)`),
  which makes the commit's "same as today" sentence true. *Naive-fix cost:* the poisoned-farm defence
  (`b-attack.test.ts` F1) then does nothing for a resumed agent — the farm-crowding case would need the pass kept
  whenever the store is cross-agent, i.e. always, so this is a real trade rather than a free win.

### F4 · `72d2777` inverted a documented invariant and left the comment stating the opposite; the job summary's `turnsUsed` still disagrees with `searchCalls` on every re-dispatch — P2

- **where:** `research-engine.ts:940` (`trace.turnsUsed = turnsBefore + gres.turns`) vs `research-engine.ts:501-504`,
  written two commits earlier and still present verbatim: *"an agent resuming on evidence it gathered last dispatch
  … **A loop that does run again overwrites both**."* It no longer overwrites `turnsUsed` (it adds); it still
  overwrites `gatherStop`. The comment is now half false.
- **input / observed:** `packages/core/test/g1/d2-turns.test.ts` — two dispatches, an agent whose loop spends one
  turn then plan-loops (breaker → `stalled`, budget left → not reusable) and whose write fails on dispatch 1:

  | | agent row `turnsUsed` | rows sum | job `turnsUsed` | `cost.searchCalls` |
  |---|---|---|---|---|
  | dispatch 1 | 1 | 1 | 1 | 1 |
  | dispatch 2 | **2** | 2 | **1** | **2** |

  `counter` is `{ turns: 0 }` at `research-engine.ts:359` and is never seeded from `resume`, while `jobSpend` **is**
  (`:394`). So the exact symptom the commit names — *"`searchCalls` 5, `turnsUsed` 4 in the job summary"* — is
  still there on any resumed job (now off by a whole dispatch), and the per-agent rows the admin sees no longer sum
  to the "Search turns" figure above them (`apps/admin/src/pages/JobDetail.tsx:148`, fed by
  `run-job.ts:565 turnsUsed: output.turnsUsed`). Same for the live progress line: `emit()` reports `counter.turns`,
  so the buyer's turn count restarts at 0 on every re-dispatch.
- **status:** reproduced. I also checked the double-count the brief asked about: **there is none** —
  `trace.turnsUsed = turnsBefore + gres.turns` is an assignment over the value `onTurn` advanced, and
  `counter.turns += gres.turns` was removed, so within a dispatch the row and the counter agree exactly.
- **refutation attempted:** Could the carry be intentional and the summary the thing that's wrong? Yes, and that is
  the better reading — which is why this is filed as "the fix is half-applied and its own comment now lies", not as
  a wrong number in the row.
- **fix sketch:** seed `counter.turns` from `resume.agentTraces.reduce((n,a)=>n+a.turnsUsed,0)` and update the
  `:501-504` comment to say *adds*. *Naive-fix cost:* the live progress `turnsUsed` then jumps by the whole prior
  dispatch the moment a re-dispatch starts — correct, but a client rendering it as "turns so far this run" changes
  meaning.

### F5 · The third re-read of a cached page can leave the loop with no copy of it at all; "the text is already in the conversation twice" is only true if nothing else was fetched — P2

- **where:** `gather.ts:454-456` (`content = reads > MAX_SAME_URL_CACHED_READS ? CACHED_STUB : …`) interacting with
  `trimOldPages` (`gather.ts:164-177`, `KEEP_FULL_PAGES = 2`).
- **input / observed (reasoned, from the two functions):** `trimOldPages` keeps full bodies only for the **last two
  `fetch_page` tool results of any kind**. For a refiner doing `F(a) c(x) c(x) F(b) c(x)` the fetch results are
  `[F(a), c(x)₁, c(x)₂, F(b), c(x)₃]`; the last two are `F(b)` and `c(x)₃ = CACHED_STUB`, so `c(x)₁`/`c(x)₂` are
  `PAGE_STUB` and page *x* is **entirely absent** from the loop's context while the tool result tells the model
  "it is in your evidence". The commit's justification ("the text is already in the conversation twice") holds only
  when no other page was fetched in between. Real exposure: `out/local-4837f6e3`'s valuation-analyst
  (`PSPSPSFPSPSPSPccSPcSc`) and deal-scout (6 cached re-reads) both interleave `c` with `F`/`S`. Whether they
  re-read the *same* URL is unknowable from the trace, because neither the old note (`Reused cached page.`) nor the
  new one (`Declined to re-send a page already returned twice.`) names the URL.
- **status:** reasoned (mechanism read off both functions; the `c`-interleaving is from the real traces).
- **refutation attempted:** the page is still in the *dossier* (and now in the `fetched` top tier, so it renders) —
  so the write-up is fine; what is lost is the loop's ability to reason from it when choosing the next query, which
  is what a refiner re-opening a listing is doing.
- **fix sketch:** exempt the cached URL from `trimOldPages` while `cachedReads.get(url) > MAX`, or put the URL in
  the stub text. *Naive-fix cost:* exempting it re-opens the growth path F2 measures.

### F6 · `urlsIn` mangles any URL containing a closing paren, so the pages a writer *cites* are the ones the referenced tier can't match — P2

- **where:** `prompt.ts:186` — `/https?:\/\/[^\s"'<>)\]]+/g`.
- **input / observed:** `urlsIn({ a: 'see https://en.wikipedia.org/wiki/Hialeah,_Florida_(city) and …' })` returns
  `https://en.wikipedia.org/wiki/Hialeah,_Florida_(city` — a string that equals no stored `url`, so that source
  never enters the referenced tier (`packages/core/test/g1/urlsin.test.ts`). The shipped test
  (`evidence-ranking.test.ts:88-101`) *asserts the mangled prefix* and calls it "the price of a regex over JSON".
  Excluding `)` is required for markdown `[x](url)`; the cost lands on exactly the Wikipedia/parenthesised URLs a
  Florida report cites for place names.
- **status:** reproduced.
- **fix sketch:** accept a trailing `)` when the match has more `(` than `)`. *Naive-fix cost:* markdown link
  targets then swallow the closing paren, which is worse (it breaks the common case to fix the rare one) — so this
  is a "know it, don't fix it" unless the tier is made reachable (F1) first.

---

## Claims checked and TRUE (so nobody re-checks)

- **"Honest max is 2 [plan-only turns] in a row across eighteen real agent-runs."** Verified directly against
  `out/local-aa4b3edf` and `out/local-4837f6e3`: I reduced every producer's notes to a `P/S/F/c` sequence. The
  longest run of `P` in any honest run is **2** (`compliance-analyst PSPSPSPSPPSPSP`, `deal-scout …PSPPSP…`,
  `risk-analyst 4837 PPSP`). The two pathological ones are `risk-analyst aa4b = 16×P` and
  `deep-dive-refiner aa4b = PcPcPcPc + 18×P`. `PLAN_TURNS_LIMIT = 4` has a margin of 2.
- **"The honest refiner's `P c P c P F` is untouched — a free-call breaker would have cut it."** True: that is
  literally `out/local-4837f6e3`'s deep-dive-refiner (`PcPcPFP`); `planOnlyTurns` never exceeds 1.
- **The refute-B2 replay sequences are faithful to the traces.** `PSPFFFPSPFFFPccSPFPSPSPcPFPcPSPPSPcPSPSPSPPSPPcSPSSPSS`
  and `PcPcPcPc`+18`P` and `16×P` all match the note streams exactly.
- **"Writes ONE 'Plan updated' note per model turn."** True — case D above: 100 plan calls in one turn → 1 note
  (4 iterations → 5 notes total including the closing one).
- **No `functionCall` without its `functionResponse` is ever sent.** The `PLAN_TURNS_LIMIT` `break`
  (`gather.ts:326-332`) does leave `messages` ending on a model turn with unanswered tool calls, but `messages` is
  a fresh array literal built at the single production call site (`research-engine.ts:936`), is not returned, not
  checkpointed (`snapshot()` at `:424` carries report/sources/extracted/traces only), and `gather` is called from
  exactly one place in `src/`. It is discarded. `trimOldPlans`' own preservation of the call (with `steps: []`) is
  the correct handling for the turns that *do* stay.
- **Gemini + `forceTools: false` really is mode AUTO, and the model can still plan.** `gemini-vertex.ts:64-66` adds
  `toolConfig.functionCallingConfig.mode = ANY` **only** when `forceTools`; `tools` are still passed either way, so
  after the third plan-only turn the model is free to answer *or* to plan again — which is why
  `PLAN_TURNS_LIMIT` is needed as the second half. Both halves are present.
- **`stalled → budget` and the new sibling test.** `retry-waste.test.ts` "reuses a loop that spent its whole
  allowance…" does prove what its name says: it drives the loop to `maxTurns` then to `maxIterations`, asserts
  `gatherStop === 'budget'`, asserts `Reusing evidence already gathered` appears and that `Researching` appears
  exactly **once** (i.e. the second attempt really did not re-buy). Its partner was correctly re-shaped to
  "budget left" and asserts `stalled`. Both assert content.
- **"Verified by mutation: store order again → 11 red across four files."** Exact. I replaced `rankEvidence`'s body
  with `return items.slice(0, max)` and got **11 failed / 4 files** (evidence-ranking ×7, b-attack ×2, b-legit ×1,
  refute-b1 ×1). Reverted.
- **`urlsIn` cost is a non-issue.** 34,075-char `current` → **0.054 ms** per call, once per synthesis prompt.

---

## Tests: content vs shape, and the mutations I ran

| mutation (all reverted) | result |
|---|---|
| `rankEvidence` → `items.slice(0, max)` | 11 red / 4 files — **matches the commit's claim exactly** |
| snippet half only: `buildDossier`'s `ranked` → `evidence.slice(0, MAX_SNIPPETS)` | **1 red** (`refute-b1` only) |
| page half only: `pages` → `extracted.filter(ok).slice(0, MAX_PAGES)` | 3 red (`b-attack` ×2, `b-legit` ×1) |
| `MAX_SAME_URL_CACHED_READS` → `Infinity` | (measurement) prompt chars 974,761 → 1,569,348 on script B |

- **Vacuous / unreachable-scenario:** `b-legit.test.ts:474` — *"…and the snippet half too: every own result URL is
  in the own dossier"*. The `FloridaHonest` fixture produces a store of **47 sources** against `MAX_SNIPPETS = 48`,
  and records at most **12** own snippets for any agent (deal-scout). The assertion cannot fail whatever
  `buildDossier` does — and I proved it: with the snippet ranking replaced by `evidence.slice(0, 48)` the test
  **stayed green**. The commit's own headline is that the real store held **174–199** sources. The page half of the
  same test is real (store 45 pages > 14) and does red.
- **Cap-equals-store shape test:** `evidence-ranking.test.ts:64` "a store that is legitimately 90% one marketplace
  still fills every slot" — 48 items, `max = 48`. It asserts `toHaveLength(48)`, which is true for any
  implementation that doesn't drop items. The property it is named for (volume preserved when the store *exceeds*
  the cap) is the one that fails; see F3.
- **Density calibration:** `refute-b1.test.ts` is the only guard on the snippet half and is built on 5 results per
  query and 3 searches (15 own results, "the remaining 33 slots go to wave 1's results" — asserted at `:151`). At
  the 8/query both production backends use, that assertion's premise disappears. Porting it to 8/query is the
  single highest-value test change here.
- **Reproductions (portable, in this worktree, uncommitted):**
  - `packages/core/test/g1/fake-web8.ts` — an 8-results/query fake web (the production density).
  - `packages/core/test/g1/b1-density.test.ts` — F1, full `runResearch`; the enricher's 0/12.
  - `packages/core/test/g1/b1-resumed.test.ts` — F3, 43 → 35 on a resumed agent.
  - `packages/core/test/g1/b2-breaker.test.ts` — F2, the four loop scripts and their call/char counts.
  - `packages/core/test/g1/d2-turns.test.ts` — F4, the two-dispatch row-vs-summary table.
