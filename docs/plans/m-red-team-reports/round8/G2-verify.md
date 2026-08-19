# G2-verify — DOSSIER + PROMPT builders / VERIFIER

Measured at `4b612426ebb97f9dd38f1561c047413ffd07390c` (worktree
`agent-afda71caeb7f46272`), after `npm ci`. Baseline `npm test`: **1071 passed, 0 failed, green** — but only
after symlinking `out/` from the main checkout into the worktree (679+215+22+145+4 = **1065** without it; the
six `out/*/trace.json`-gated red-team tests are the whole difference, so the brief's "~16 fewer" is really
six). Every mutation below was run alone, full `npm test`, reverted, `git status` clean before and after; the
final tree is clean and back at 1071.

## Verdict

The four commits do what they say, and the two headline measurements are real: I reproduced **0/12 → 12/12**
end to end by restoring the pre-fix ranking (`refiner: 0/12 shortlisted listings and 48/48 of its own results`
→ `12/12 … 36/48`), and I reproduced the Gemini census **exactly** (17 `minItems`, 2 `maxItems`, 5 `maxLength`,
zero `minimum`/`maximum`) and the **seven V8 parse kinds** exactly, from my own fixture. Eleven of the thirteen
claimed mutation counts are correct as written. What does not hold: (a) `d1dab19` fixes half of a rule and pins
only that half — **deleting the `FOCUS:` line from `buildAgentKickoff` outright leaves the suite at 1071/1071
green**, so nothing asserts that a producer's focus reaches any prompt, which is the premise the whole commit
rests on; (b) the new density test's own inline "mutation that reds this" is false, and its `ownVisible === 36`
is attributed to a reserve that is inert on that path (the commit message admits this in its footnote, so the
CODE comment and the COMMIT contradict each other); (c) its `afterEach` cleanup is a no-op-then-undo that
leaves the fixture corpus dirty; (d) three of the four commit messages carry a wrong suite number, and one
carries a wrong test delta. Nothing here changes what a buyer receives today.

## Findings (most severe first)

### F1 · Nothing asserts that a producer's `focus` reaches its prompt — the flagship could lose all eight live focus directives with the suite green — P1

- where: `packages/core/src/engine/prompt.ts:524` (the only render site);
  `packages/core/test/templates.test.ts:16-28` (the new test);
  `packages/core/src/templates/validate.ts:54-64`.
- input / observed: deleted the line
  `(agent.focus ? \`FOCUS: ${agent.focus}\n\` : '') +` from `buildAgentKickoff`, ran full `npm test`:
  **exit 0, 1071 passed, 0 failed.** Not one test in the repo notices that `focus` stopped being rendered
  anywhere.
- why it matters: `d1dab19`'s subject is "`focus` belongs to the research loop". It asserts the NEGATIVE half
  (no agent without a loop may declare one — pinned twice, both mutations verified below) and leaves the
  POSITIVE half — that an agent WITH a loop actually reads it — unpinned. Eight of the flagship's ten producers
  carry a live `focus` today: `deal-scout`'s marketplace list and its "cite the listing's OWN detail-page URL"
  rule, `community-analyst`'s subreddit/Trustpilot list, `compliance-analyst`'s DBPR/SBA list,
  `valuation-analyst`, `financial-analyst`, `market-refiner`, `deep-dive-refiner`, `competition-analyst`. That
  is precisely the R7-18 damage shape (a template sentence the model never reads), for eight agents instead of
  two, and the round-7 finding only surfaced because a human read the two prompts side by side.
- status: **reproduced** (one-line deletion, full suite, 1071/1071 green; reverted).
- refutation attempted: I checked whether some other suite covers it — `handoffs.test.ts:117,231`,
  `sites.test.ts:36,54` and `prompt-injection.test.ts:267` all call `buildAgentKickoff`, and none of their
  agents declares a `focus`; `grep -rn focus packages/core/test` returns only the four `templates.test.ts`
  lines. I also checked whether the new test is at least not vacuous — it is not: the Florida producers with a
  focus do enter its loop body, so it fails if a synthesizer gains one. It just never looks at the render.
- fix sketch: one assertion in `templates.test.ts`, next to the existing pair —
  `expect(buildAgentKickoff({ agent: dealScout, brief: 'b', sections: [], maxTurns: 4, handoffs: {} }))
  .toContain(dealScout.focus!)`. An honest run loses nothing; done naively (asserting the literal string
  `FOCUS:` rather than the template's own text) it becomes a test of our formatting instead of a test that this
  template's sentence arrives, which is the failure mode R7-18 was.

### F2 · The density test's own "mutation that reds this" is false, and its 36-of-48 assertion is attributed to a mechanism it does not exercise — P2

- where: `packages/core/test/red-team/refute-b1.test.ts:283-290`.
- input / observed: the comment reads *"Mutation that reds this: drop the `referenced` reserve in
  `rankEvidence` (`const reserve = 0`), or put `touched` back above `referenced`."* With
  `const reserve = 0;` the test **passes** and still prints
  `refiner: 12/12 shortlisted listings and 36/48 of its own results rendered as [S]`; the only red in the whole
  suite is the unit test in `evidence-ranking.test.ts`. Only the second half of the comment (`touched` above
  `referenced`) is true. The reason: the `Density` provider's refiner never calls `fetch_page`, so its `fetched`
  set is empty, the reserve is `min(12, 24)` slots that nothing was competing for, and `ownVisible === 36` is
  just `48 − 12` falling out of tier ORDER. The line above it — *"the reserve is sized by the referenced set,
  not a constant, so the other 36 slots are still its own"* — names a mechanism this test cannot see.
- status: **reproduced** (mutation `m1`; the density test's stdout captured under the mutation).
- refutation attempted: the commit message is honest about exactly this ("the end-to-end enricher has no fetches
  of its own, so the ORDER alone carries it there … the reserve … is pinned by the unit test"), so this is not a
  false claim in the commit — it is a false claim in the code that outlives the commit, and it is the one a
  future editor will read when deciding whether the reserve is still load-bearing.
- fix sketch: correct the comment to name the ordering as the mutation, and either drop the reserve sentence or
  give the fixture's refiner one `fetch_page` per turn so the reserve is genuinely exercised end to end. Done
  naively (just deleting the comment) the repo loses the record that the reserve has no end-to-end pin at all.

### F3 · The density test's `afterEach` restores the fixture corpus to the polluted value instead of clearing it — P2

- where: `packages/core/test/red-team/refute-b1.test.ts:272-277` vs the correct pattern at line 121.
- input / observed:
  ```ts
  const restoreDensity = __setResultsPerQuery(8);
  restore = () => { restoreDensity(); __setExtraPages([])(); };
  __setExtraPages(LOTS);
  ```
  `__setExtraPages(p)` (`test/fixtures/fake-web.ts:219-226`) captures the PREVIOUS value and returns a restorer
  to it. At `afterEach` time the previous value is `LOTS`, so `__setExtraPages([])()` sets the corpus to `[]`
  and immediately puts the 120 lot pages back. The intended "clear the extras" never happens. (`restoreDensity()`
  is correct: `RESULTS_PER_QUERY` really does go back to 5.)
- status: **reproduced** (read of the fixture's semantics + the call order; no observable damage today because
  this is the last test in the file and vitest isolates module state per file).
- refutation attempted: I checked whether anything after it in the file could see the leak — nothing does, and
  the file's other block runs earlier. So this is latent, not live. It is still the exact trap the first test in
  the same file avoids by writing `restore = __setExtraPages(LOTS)`.
- fix sketch: `const restoreExtras = __setExtraPages(LOTS); restore = () => { restoreDensity(); restoreExtras(); };`

### F4 · `AgentTrace.kind` reaches no admin screen, which is the reason the commit gives for adding it — P2

- where: `packages/core/src/engine/research-engine.ts:112-116,560` (written);
  `apps/admin/src/pages/JobDetail.tsx:391-425` (the Agents table).
- input / observed: `d1dab19` says "`AgentTrace.kind` (additive, absent on older traces) **so an admin can see
  why an agent has no turns: it is a writer**". The admin Agents table is built from `JobSummary.agents`
  (`{id, wave, status, durationMs, attempts, turnsUsed, gatherStop, costUsd}`), which has no `kind`; `grep -rn
  kind apps/admin/src` finds only `failureKind`. An admin sees `kind` only by downloading the raw `trace.json`.
- status: **reproduced** (grep + read of the rendering code).
- refutation attempted: the trace IS admin-reachable (the API refuses it to the owner but serves it to an
  admin), so the sentence is not false about the DATA — it is false about the screen, which is what "an admin
  can see" reads as in this repo, and which is where `turnsUsed`/`gatherStop` from the same batch did land.
- fix sketch: add `kind` to `JobSummary.agents[]` and render it beside the id, or reword the commit/backlog
  entry to "in the trace". The additive/optional typing is already correct for old traces.

### F5 · The fixture's default is still 5 results per query, so every end-to-end test but one still measures at non-production density — P2

- where: `packages/core/test/fixtures/fake-web.ts:255` (`let RESULTS_PER_QUERY = 5;`).
- input / observed: I flipped the default to `8` and ran the full suite: **exactly 2 tests red**, both printed
  measurement pins (`1 · honest baseline on the red-team model …` and `2 · Florida comprehensive, honest &
  diligent — the denominator`). Nothing else in 1071 depends on 5.
- status: **reproduced** (mutation `m14`).
- why it is worth saying: the commit's own diagnosis is "the 5/8 gap is what hid this: every test passed while
  the tier rendered nothing in production", and the fix makes the number settable for ONE test while leaving the
  gap as the default for all the others. The cost of closing it is re-measuring two printed pins.
- fix sketch: default to 8, update the two pins' printed numbers, and keep `__setResultsPerQuery(5)` for any
  test that genuinely wants the sparse corpus. Done naively — flipping the default and editing the two pins to
  whatever the new run prints without reading them — you lose the pins' value, which is that a human noticed the
  number changed.

## Claims checked and TRUE (so nobody re-checks)

Dossier / `6fde120`:

- **0 of 12 → 12 of 12, end to end.** Restored the pre-fix ranking (`[...fetched, ...touched, ...referenced]
  .slice(0, max)`) in `prompt.ts` and ran `refute-b1.test.ts`: `refiner: 0/12 shortlisted listings and 48/48 of
  its own results rendered as [S]`, test red. At HEAD: `12/12 … 36/48`. Both numbers exact.
- **"36 of its 48 slots stay its own, and 24 is the most it could ever lose."** `MAX_SNIPPETS = 48`
  (`prompt.ts:86`), `reserve = Math.min(referenced.length, Math.floor(max / 2))` → 12 with 12 referenced (36
  own), capped at 24. The unit test's `many` case (40 referenced) observes exactly 24 own. Arithmetic and test
  both hold. (Unstated: for the PAGES dossier `max = 14`, so the same rule can hold back 7 of 14 page slots.)
- **`reserve` is sized by the referenced items PRESENT IN THE STORE, not by the set's size** — the commit says
  "sized by the referenced SET". The code (`referenced.length`) is the safer of the two and cannot shrink a
  dossier for URLs that were never gathered. Message imprecise, code right.
- **Production density is 8.** `tools/web-search.ts:66` `url.searchParams.set('count', '8')` (Brave),
  `:85` `max_results: 8` (Tavily). The keyless DuckDuckGo fallback is a third backend the "both backends"
  phrasing skips; it does not change the finding.
- **"7 of the flagship's 10 producers are over that density."** Florida has exactly 10 `role: 'producer'`
  agents with `researchBudget` 8, 8, 24, 8, 8, 10, 6, 5, 5, 10. Strictly more than 6 searches (>48 results):
  **7**. Exact under that reading. (`researchBudget` is a TURN budget, so 7 is an upper bound on how many
  actually search six times — the claim is a modelling statement, not a measurement, and it is not overstated.)
- The `rankEvidence` `take()` rewrite is dedup-correct: `seen` is keyed on the item object and the `rest` tier
  is disjoint from the other three by the `else if` chain, so nothing renders twice.

Prompt / `7772772`:

- The three formerly-tautological assertions in `a-legit.test.ts` are real now: replacing `cutJson` with
  `json.slice(0, share)` reds `cuts at a VALUE boundary…` (4 red in total). With the sentinel stripped, "ends at
  a boundary" is a genuine assertion; "does not end in a digit" and "does not end inside a URL" are logically
  implied by it, which matches the commit's own claim that only **one** of the three "had to be re-earned".
- The `[cut mid-value]` note reaches a real caller: `a-attack.test.ts:433` asserts the new suffix on the
  single-huge-string path, and it reds under `whole: true`.

Gemini / `b72de29`:

- **The census is exact.** Walking all 18 Florida section schemas through `z.toJSONSchema`: `{ minItems: 17,
  maxLength: 5, maxItems: 2 }`, zero `minimum`, zero `maximum` (also zero `minLength`, zero `pattern`). The five
  `maxLength`s are all in `charts`: `title` 160, `description` 500, `labels[]` **80**, `series[].name` 80,
  `unit` 8 — so "`.max(80)` on a chart label was costing a repair round" is about a bound that really exists.
- **"Seven V8 kinds" is exact.** I built my own realistic listing section and truncated it at every offset in
  the last 80%: **7** distinct kinds at 5,658 / 8,489 / 20,530 chars alike (`Unterminated string in JSON` 88.7%,
  `Expected ',' or '}' after property value` 4.4%, `Unexpected end of JSON input` 2.6%, `Expected ':' after
  property name` 1.7%, `Expected double-quoted property name` 1.5%, `Expected ',' or ']' after array element`
  1.0%, `Expected property name or '}'` 0.1%).
- **"73.4%" is fixture-dependent and not independently reproducible; the direction is right.** My section gives
  **78.6–79.0%** same-kind collision (`Σ p²`) — i.e. the counter resets on ~1 dispatch in 5 rather than ~1 in 4.
  The figure is a property of the string/number ratio of whichever section was measured, and no test pins it, so
  it cannot be checked without the original fixture. The argument it supports (the kind distinguishes cut points,
  not model behaviours) does not depend on the exact percentage.
- **The `responseSchema` vs `responseJsonSchema` reasoning is correct, verified against the installed SDK.**
  `node_modules/@google/genai/dist/node/index.mjs:14910` `maybeMoveToResponseJsonSchem` moves the schema only
  `if (Object.keys(params.config.responseSchema).includes('$schema'))`; `jsonSchemaToGemini`
  (`gemini-vertex.ts:239-305`) builds `out` from a whitelist and never emits `$schema`; the provider passes
  `responseSchema:` at `gemini-vertex.ts:60`. And `Schema` types the string bounds as
  `maxLength?: string` / `minLength?: string` / `pattern?: string` (`genai.d.ts:9686,9694,9702`) — the code sends
  `String(...)` for the two numeric ones and the raw string for `pattern`, which matches.
- **The refute-D1 "same-bucket pair" really is the pin the commit says it is.** Under the restored kind-keeping
  signature, `'Unterminated string in JSON at position 512'` → `json:Unterminated string in JSON` and
  `"Expected ',' or '}' after property value in JSON at position 9000"` → a different bucket, so the new pair
  fails even if someone find-and-replaces every `json:parse` literal back. Verified by mutation.

Templates / `d1dab19`:

- **`agent.focus` is rendered by `buildAgentKickoff` and by nothing else** — `grep -rn focus
  packages/core/src/engine/prompt.ts` returns exactly one render site (`:524`), and `buildAgentKickoff` is called
  from one place (`research-engine.ts:1106`) inside the `hasResearchLoop(agent)` branch. The premise is true; see
  F1 for the fact that it is unasserted.
- **The `focus` test is not vacuous** — the Florida producers with a `focus` do enter its loop body, and it reds
  if a synthesizer gains one (which would red the "every template validates" test too, hence 2 red, which is why
  the message's "1 red" mutation must be the validator one — and it is).
- **The folded chart guidance really reaches the prompt.** `templates.test.ts:31-52` builds the actual
  `buildEnricherSynthPrompt` for `chart-refiner` and asserts both sentences are in the SAME string — the
  engine's "NEVER drop an item because you have nothing to add to it" and the section's "Drop a chart ONLY when
  it is empty or its numbers are not in the report". Content, not shape, and it reds when the guidance loses the
  sentences.
- **Both "measured 0 red at first" covers really bite.** For `7772772`'s third mutation the cover is
  `uses a boundary wherever it falls…` (its fixture `{note:'short', body:'z'.repeat(60_000)}` asserts the exact
  extract `'{"note":"short",'`), and it is the SOLE red under the restored `at > max / 2` guard. For `d1dab19`'s
  second the cover is `what a synthesizer must know reaches the prompt it actually gets`, and it is the SOLE red
  when the guidance is stripped. Neither cover is a shape assertion.
- Not from these four commits, but checked because they exercise the same `rankEvidence`: the three
  `buildProducerSynthPrompt` tests at `evidence-ranking.test.ts:175-197` (added by `a84878d`/`90a355f`) assert
  real host orderings and `toHaveLength(14)` against a 22-page fixture — the bound is reachable and none of them
  reads a constant the source reads.

## Commit-message audit (verifiers only): every count I re-ran, claimed vs observed

Mutations — each applied alone, full `npm test` from the root, then reverted:

| # | commit | mutation | claimed | observed | |
|---|---|---|---|---|---|
| m1 | `6fde120` | `const reserve = 0` | 1 red | **1 red** (`evidence-ranking` only; the density test still passes and prints 12/12) | OK |
| m2 | `6fde120` | `take(touched)` moved above `take(referenced)` | 2 red | **2 red** (`refute-b1` density + `evidence-ranking` order) | OK |
| m3 | `6fde120` | `const reserve = referenced.length` (uncapped) | 1 red | **1 red** (`evidence-ranking`) | OK |
| m4 | `6fde120` | `__setResultsPerQuery` forced back to 5 | 1 red | **1 red** (`refute-b1` density) | OK |
| m5 | `7772772` | `cutJson` takes the last `,`/`}`/`]` anywhere | 1 red | **1 red** (`does not cut a figure written in PROSE either`) | OK |
| m6 | `7772772` | `whole: true` unconditionally | 2 red | **2 red** (`a-attack` seams + `…the note says the cut is mid-value`) | OK |
| m7 | `7772772` | the `at > max / 2` guard restored | 1 red | **1 red** (`uses a boundary wherever it falls`) | OK |
| m8 | `7772772` | `toolCalls` pushed back unstripped | 1 red | **1 red** (`strips the marker from a tool call's arguments`) | OK |
| m9 | `d1dab19` | the validator stops refusing a `focus` | 1 red | **1 red** (`the validator refuses one, and names the kind`) | OK |
| m10 | `d1dab19` | the rewrite rules removed from the `charts` guidance | 1 red | **1 red** (`what a synthesizer must know reaches the prompt`) | OK |
| m11 | `b72de29` | `jsonFailureSignature` keeps the parser's kind | "updates 5 assertions; the pin is the new same-bucket pair" | **3 tests red**, **7 assertion lines** would need updating (4 in `retry-waste`, 3 in `refute-D1`); 5 is the count of the literal `json:Unexpected token`. The "pin" half is TRUE (verified above) | loose |
| m12 | `b72de29` | drop the `maxLength` forward | 1 red | **1 red** (`jsonSchemaToGemini forwards every bound…`) | OK |
| m13 | `b72de29` | non-admin gets the whole `summary` | 1 red | **1 red** (`hands the buyer the notice and the section states`) | OK |

Extra mutations I ran that no message claims:

| m14 | fixture default `RESULTS_PER_QUERY = 8` | — | **2 red**, both printed measurement pins (F5) |
| m15 | `cutJson` → raw `json.slice(0, share)` | — | **4 red**; confirms `a-legit`'s re-earned assertions are no longer tautologies |
| m16 | delete the `FOCUS:` line from `buildAgentKickoff` | — | **0 red, 1071 passed** (F1) |

Suite totals — I checked out each commit and its parent in my worktree and ran the full `npm test` (`out/`
symlinked, so the trace-gated tests ran):

| commit | claimed | observed | |
|---|---|---|---|
| `6fde120` | "+3 tests (988 → 991)" | parent `93b132e` core **638** → `6fde120` core **640** = **+2**, not +3. Absolute: `638+214+22+111+4 = 989` before, `991` after (the fbizlab 111 pass in Javier's checkout; 5 of them fail in a clean worktree until `60c92a0`). **The after-number 991 is right; "988" and "+3" are wrong — the true delta is +2.** Cross-checked by counting collected tests: `evidence-ranking` 8 → 9 and `refute-b1` 3 → 4 (its `it.each(runs)` is 2 of those 3). | **WRONG** |
| `7772772` | "Suite 1052 → 1056, MEASURED" | parent `2c346de` core **666** → **670** = +4; full run at `7772772` = **1056** exactly. | **RIGHT** |
| `b72de29` | "Suite 1061 → 1063, MEASURED" | parent `90d6fdf` = **1061** exactly; `b72de29` = **1062**. The commit added exactly one test (`security.test.ts`, the redaction); the `d-attack`, `refute-D1` and `retry-waste` changes are all edits to existing tests. **"1063" is wrong — it is 1062, +1 not +2.** | **WRONG** |
| `d1dab19` | "Suite 1063 → 1066, MEASURED" | parent `326cf1b` = **1062**; `d1dab19` = **1065**. Delta +3 is right; **both absolute numbers are one high** — inherited from `b72de29`'s wrong after-number. | **WRONG (delta right)** |

So of the four messages in my group: `7772772` is exactly right on every number; `6fde120` overstates its test
delta by one and its before-total by one; `b72de29` overstates its after-total by one; `d1dab19` carries both
absolute totals one high while its delta is correct. Every mutation count in the group is correct except
`b72de29`'s loose "5 assertions" (3 tests / 7 assertion lines).

Other measured figures re-run: 0/12 → 12/12 **exact**; 36/48 and 24-max **exact**; Brave 8 / Tavily 8 **exact**;
7 of 10 producers **exact** (under "more than six searches"); the census 17/2/5/0/0 **exact**; seven V8 kinds
**exact**; 73.4% **not reproducible from the description** (my own realistic section: 78.6–79.0%), direction and
order of magnitude confirmed.
