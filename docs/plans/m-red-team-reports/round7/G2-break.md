# G2-break — RETRIES / CHECKPOINT / PROMPT BUILDERS (`6264887`, `a68d656`, `49e71aa`) / BREAKER

Ran `npx vitest run test/resolution.test.ts` in this worktree — `packages/core` has no such file; `apps/worker/test/resolution.test.ts`
passes (1/1) after `npm ci`, so the checkout resolves. Worktree checked out at `a11bafe` (it was parked at `d1ac4dd`, i.e. BEFORE the
batch — that alone would have made every measurement worthless). All six group test files green on the unmutated tree
(`retry-waste`, `red-team/{d-attack,refute-D1,refute-A1,a-attack,a-legit}` = 61 passed / 6 skipped).

## Verdict

The three headline mechanisms do what the commit says: `gatheredAgentIds` really stops the loop being re-bought, the old-shape
checkpoint really resumes as before (I mutated it and the named test went red), the signature really is per-DISPATCH and survives
`approveHold`, and `current` really reaches `buildSynthesizerPrompt`. What the batch did not think through is what happens on the
dispatch it now finalizes early. `finalize-in-place` turns "the producer gets six more dispatches" into "the ENRICHER runs
best-effort over a section that does not exist" at dispatch 2 — and the report then ships that enricher's invention labelled
`unenriched`, whose buyer copy reads "This section was researched and written… Its content is complete and sourced as usual."
That is the one P0-shaped thing here (F1, reproduced). Second, D1's own two halves fight each other over the 60-page cap: a
`gathered` agent no longer re-fetches, so pages the checkpoint evicted are gone for good and the writer writes from evidence it
never gathered — the `Checkpoint.extracted` doc comment ("a cache miss, not a correctness problem", research-engine.ts:225) is
now false (F2, reproduced). Third, two of the batch's stated justifications do not hold: "two truncations are one failure" is
73.4% true, not true (F3, measured), and the Gemini forwarding cites the doc for `responseJsonSchema` while the provider only ever
sends `responseSchema` (F4). A3's `cutJson` still hands the model a truncated figure — by a new route, because it now *seeks*
commas and a thousands separator is a comma (F5, reproduced).

## Findings (most severe first)

### F1 · A refiner delivers a section its producer never wrote, and both the buyer and the admin are told the opposite — P1
- where: `packages/core/src/engine/research-engine.ts:687` (finalize-in-place) + `:761-784` (`delivered` / `kept` →
  `unenriched`); copy at `packages/core/src/jobs/report-copy.ts:78` and `packages/core/src/pdf/report-html.ts:202`.
  Production pair: `florida-business-for-sale.ts:892` `chart-analyst` produces `charts`, `:902` `chart-refiner`
  `enriches: ['charts'], dependsOn: ['chart-analyst', …]`.
- input / observed: a two-agent template (producer `analyst` produces `charts`, synthesizer `refiner` enriches `charts`,
  dependsOn analyst). The analyst's write returns `not json` on both dispatches; the refiner's write is valid.
  Dispatch 2: `writeFailures.analyst.dispatches = 2` → analyst exhausted → `retryable()` empty → `runWaves(true)` → the refiner
  runs best-effort with `current = {}` (contextFor returns nothing; the analyst never wrote) and invents the whole section.
  Observed: `trace.status = 'completed'`, `report.charts = [{ title: 'INVENTED BY THE REFINER', value: 42 }]`,
  `meta.sections = [{ key: 'charts', status: 'unenriched' }]`, and the admin warning
  `Degraded [none] from agent "analyst" … (kept, already written: charts)`.
  What the buyer reads for `unenriched`: *"One section of this dossier was researched and written, but the step that adds extra
  depth to it did not finish. Its content is complete and sourced as usual."* Every clause is false: nothing researched it,
  the depth pass is the ONLY thing that ran, and the content is sourced from nothing. `lost` (which suppresses the body in the
  PDF/viewer) is never reached, because `delivered` counts a done agent's `enriches` keys as delivered.
- status: **reproduced** — `packages/core/test/g2-break.scratch.test.ts`, describe "the refiner delivers a section its producer
  never wrote". The three load-bearing assertions:
  ```ts
  expect(second.trace.status).toBe('completed');                                  // finalize-in-place
  expect(second.report.charts).toEqual([{ title: 'INVENTED BY THE REFINER', value: 42 }]);
  expect(second.meta.sections).toEqual([{ key: 'charts', status: 'unenriched' }]); // the false label
  ```
- refutation attempted: (a) *is it new?* No — the same end state was reachable at dispatch 8 before `6264887`. But D1 moves it
  from "after six more attempts to write the section honestly" to "on the second dispatch", and the whole point of the exhaustion
  rule is that this path is now the NORMAL end of a deterministic write failure, not the rare one. (b) *does `lost` win?* Only if
  the refiner is also pending — `lost` wins over `unenriched` for the SAME key (`:772`), but here the key is not lost at all,
  because the refiner is `done`. (c) *is `charts` special?* No: the same holds for `market_overview` (market-analyst /
  market-refiner) and for `deep_dives` (deal-scout / valuation-analyst + deep-dive-refiner) — every enricher pair in the flagship.
- fix sketch: build `delivered` from `produces` only, then add a done agent's `enriches` key **only if a producer of that key is
  also done**; otherwise mark it `lost` (or add a third status). Naive-fix cost: an honest refiner that reconstructed a real
  section from upstream figures would have its body replaced by the placeholder — so keep the body and change the LABEL
  (a `reconstructed` status whose copy says "no step researched this section directly").

### F2 · A `gathered` agent writes from a store its own pages were evicted from, and can no longer buy them back — P2
- where: `research-engine.ts:307` `CHECKPOINT_MAX_PAGES = 60`, `:428` `extracted: evidence.extracted.slice(-CHECKPOINT_MAX_PAGES)`,
  `:535` `research = { done: gathered.has(agent.id) … }`; the now-false claim is the doc at `:220-226`
  ("Oldest are dropped, so a re-dispatch may still re-fetch an old page — a cache miss, not a correctness problem").
- input / observed: a producer with a 70-turn budget fetches `p0…p69` (all `ok`), then its write fails.
  Dispatch 1: `gatheredAgentIds = ['scout']`, `checkpoint.extracted.length = 60`, `p0…p9` dropped; the dispatch-1 writer prompt
  DID contain p0's body. Dispatch 2 resumes: the note is `Reusing evidence already gathered`, `web.fetches === 0`, p0 is not in
  the store and **not in the writer's prompt**. Before D1 the loop re-ran and re-fetched it (a paid cache miss, but the right
  data); now the section is written from pages the agent never gathered and the ones it did gather are unrecoverable.
- status: **reproduced** — `test/g2-break.scratch.test.ts`, describe "a gathered agent writes from a store its own pages fell out
  of": `expect(first.checkpoint.extracted!.some(p => p.url === 'https://ex.com/p0')).toBe(false)` and
  `expect(prompts[0]).not.toContain('CHEAPEST-LISTING-538138')` on dispatch 2 with `web.fetches === 0`.
- refutation attempted: only 14 pages are rendered either way (`MAX_PAGES`), so the *volume* is unchanged — the loss is WHICH
  pages, and it is the agent's earliest fetches (usually its best listings) that go. Reachability: the flagship's comprehensive
  tier budgets 92 research turns across ten producers (`budgetScale: 1`), so a single dispatch is near the cap and a job that has
  already re-dispatched (exactly the D1 scenario, since every re-gathering agent appends more) passes it. Not reachable in the
  `light` tier (`budgetScale: 0.5`).
- fix sketch: keep pages whose URL is in `evidence.extracted` for an agent listed in `gatheredAgentIds` (or drop `gathered` for an
  agent whose pages were evicted, so its loop re-runs). Naive fix ("raise the cap") re-inflates checkpoint.json, which is
  re-uploaded after every agent.

### F3 · "Two truncations are one failure" is 73% true; a maxOutputTokens-truncated write escapes the bound ~27% of the time — P2
- where: `packages/core/src/engine/synthesize.ts:66-73` `jsonFailureSignature`; claim in `6264887`'s message ("for a parse failure
  the parser's kind without position or excerpt (two truncations are one failure)") and in the class doc at `synthesize.ts:41-42`.
- input / observed: I checked the four V8 messages the brief names — `Unexpected token 'o', "not json" is not valid JSON` →
  `json:Unexpected token`; `Unterminated string in JSON at position 512` → `json:Unterminated string in JSON`;
  `Expected ',' or '}' after property value in JSON at position 9000 (line 1 column 9001)` →
  `json:Expected ',' or '}' after property value in JSON`; `Unexpected end of JSON input` → itself. The position IS stripped
  (the claim's narrow form holds), but two truncations at different lengths produce **different kinds**, not one.
  Measured on a realistic listing-section JSON (12 listings + overview, 5,378 chars), truncating at every offset in the last 80%:
  85.3% `Unterminated string in JSON`, 6.5% `Expected ',' or '}' after property value`, 3.0% `Unexpected end of JSON input`,
  2.2% `Expected ':' after property name`, 1.9% `Expected double-quoted property name`, 0.8% `Expected ',' or ']' after array
  element`, 0.3% `Expected property name or '}'` → **P(two independent truncations share a signature) = 73.4%**. So a model
  whose section simply does not fit in `maxOutputTokens = 32768` — the deterministic failure most likely to repeat — resets the
  counter on ~1 dispatch in 4. Expected dispatches to exhaustion ≈ 2.4 instead of 2; each extra dispatch is
  `agentMaxAttempts × 2` structured calls of up to 32k output (d-attack's own arithmetic: ~$0.33/call).
- status: **reproduced** (measurement script, node v22.22.0, faithful copy of `jsonFailureSignature`):
  `/private/tmp/…/scratchpad/sigtest.mjs`.
- refutation attempted: the tail is short — P(no consecutive match across all 8 dispatches) = 0.266⁷ ≈ 1e-5 — so the bound is
  not defeated, only loosened by ~$1–3 per job on average. And the *attacker's* dodge is not available: a poisoned page cannot
  choose which parse error the model makes, only that it makes one. Hence P2, not P1. The cited pin
  (`refute-D1.test.ts:147`) chooses two cuts (150, 160) that both land inside a string — a true assertion about a
  cherry-picked pair, not about "two truncations".
- fix sketch: collapse every `JSON.parse` message to one bucket (`json:parse`) — the parser's kind carries no more information
  about the MODEL than the position does. Honest cost: none that I can find; the kind never distinguishes two different model
  behaviours, only two different cut points.

### F4 · The Gemini forwarding is justified by the docs for a field the provider never sends — P2
- where: `packages/core/src/llm/gemini-vertex.ts:263-277` (comment + the four forwards) and `6264887`'s point 3
  ("`@google/genai` 1.52's `responseJsonSchema` honours exactly those… the doc does not list [minLength/maxLength/pattern] as
  honoured"). The provider sends `responseSchema`, at `gemini-vertex.ts:60`.
- input / observed, from this worktree's `node_modules/@google/genai@1.52.0`:
  - `dist/index.mjs:17476 maybeMoveToResponseJsonSchem` moves `config.responseSchema` → `responseJsonSchema` **only if the object
    has a `$schema` key**. `jsonSchemaToGemini` builds `out` from scratch and never emits `$schema`, so our value stays on the
    `responseSchema` path.
  - `dist/index.mjs:3132 processJsonSchema` (via `tSchema`) passes `minItems`/`maxItems`/`minimum`/`maximum` through verbatim, so
    the wire format is right for that path (`Schema.minItems?: string` at `genai.d.ts:9692` — the int64-as-string forwarding is
    correct).
  - The list quoted in the code comment is `GenerateContentConfig.responseJsonSchema`'s doc (`genai.d.ts:4551-4566`). The `Schema`
    type we DO send documents `minLength`/`maxLength`/`pattern` in exactly the same voice as `minItems`/`maximum`
    (`genai.d.ts:9685-9705`). So the reason given for withholding three bounds is evidence about a different field.
  - Measured over the real Florida section schemas: 17 `minItems`, 2 `maxItems`, 5 `maxLength`, and **zero `minimum`/`maximum`**
    (`test/g2-bounds.scratch.test.ts`). The commit's "14 of ~17 Zod-only Florida bounds" is 19 of 24, and the
    `minimum`/`maximum` half of the change is dead code for the flagship today.
- status: **reasoned** for "would `maxLength` be honoured" (Google's public Schema doc did not fetch); **reproduced** for the
  routing (`$schema` absent → `responseSchema`), for the pass-through, and for the bound census.
- refutation attempted: the four forwarded fields are honoured on both paths, so nothing *shipped* is wrong — this is a false
  justification, not a false behaviour, and it is the reason three real bounds (`.max(80)` on labels) still cost a repair round.
- fix sketch: either forward `minLength`/`maxLength`/`pattern` too (same `Schema` type, same path) or re-word the comment to say
  "we have not verified them on the `responseSchema` path".

### F5 · `cutJson` does not know about string boundaries: the `$538,138 → $538` defect it names is still reachable — P2
- where: `packages/core/src/engine/prompt.ts:397-401`, used at `:376` under the heading "Use these for exact figures".
- input / observed (faithful copy of `cutJson`, `/private/tmp/…/scratchpad/cutjson.mjs`):
  1. *the guard falls through*: `max = 500`, a short first field then one long value → last `,` at 237 ≤ 250, so
     `at > max/2` is false and the RAW cut is returned, landing mid-number:
     `…9999999999999999999999999999999999999999`. The exact `"askingPrice":538` shape A3 says it fixed.
  2. *the common case*: the last comma before the budget is a thousands separator inside prose.
     `JSON.stringify({overview: '…roughly 240 operators, and the median asking price is $538,138 across the twelve listings…'})`
     with `max = 150` → the extract ends **`…the median asking price is $538`**. `cutJson` now actively SEEKS commas, and a
     thousands separator is a comma, so the fix introduced a small attraction to precisely this failure.
- status: **reproduced** (script output above).
- refutation attempted: the *structural* case the commit names (`"askingPrice":538138,`) IS fixed — the cut lands on the
  separator comma and keeps the whole number. Frequency of case 2: on the shipped `samples/Florida Biz Labs Report.html`,
  4 of 733 commas are thousands separators (~0.5% per trimmed dependency; the exec-summary writer trims a dozen). Case 1 needs
  a section whose only value boundary is in the first half of the share — real for a section that is one long markdown string,
  which is most of them at `share = 500` (the floor). Also confirmed NOT a bug: the trailing `]` in `… [cut]]` closes the
  `[Trimmed to fit: …` bracket opened in the same string; the model sees one balanced label.
- fix sketch: scan for the last boundary that is not inside a JSON string (track quote/escape state), and fall back to the last
  boundary at ANY position rather than the raw cut. Honest cost: a section with one huge string still gets a raw cut — but say
  so in the note ("cut mid-value") instead of implying a whole value.

### F6 · A4 strips the model's text but not the model's tool ARGS — P2
- where: `packages/core/src/engine/gather.ts:327` `messages.push({ role: 'model', text: stripFenceMarker(res.text), toolCalls: res.toolCalls })`.
- input / observed: `res.toolCalls[].args` (the `update_plan` steps, the `web_search` query) are model text written after reading
  fetched pages and are pushed back unstripped, then re-sent on every later turn of the loop (only superseded plans are stubbed,
  `trimOldPlans` at `:224`). A page that gets the model to write the marker into a plan step puts it in every subsequent request
  of that loop. The codebase's own standard is stricter than this: search results are JSON-encoded by the provider too and are
  still stripped (`gather.ts:245-250`, "an accident, not a guarantee, and it says nothing about the marker").
- status: **reasoned** (no reproduction: it needs a model that copies an instruction into a plan step).
- refutation attempted: the commit's wording ("pushed the model's own TEXT back… unstripped") is literally true, and args ride
  inside a `functionCall` part rather than in prose, which is weaker than a fence inversion. So: incomplete, not false.
- fix sketch: strip the marker from string leaves of `res.toolCalls[].args` in the same push.

## Claims checked and TRUE (so nobody re-checks)

- **"A checkpoint without the field resumes exactly as before (a literal old-shape fixture pins it)"** — TRUE and the fixture is
  honest: `retry-waste.test.ts:382-414` builds `old` as a literal object listing only the pre-D1 fields (not a new checkpoint with
  fields deleted) and asserts `not.toHaveProperty('gatheredAgentIds'|'writeFailures')`. **Mutation I ran**:
  `gathered = new Set(resume?.gatheredAgentIds ?? [])` → `?? (resume ? all agent ids : [])` — that test and only that test goes
  red, on `expect(web.searches).toBeGreaterThan(0)`. Restored; `git diff src/` clean. `run-job.ts:174` `JSON.parse(raw) as
  Checkpoint` does no coercion, but every new field is read with `?? []` / `?? {}`, so an old object is safe.
- **`REPEATED_WRITE_FAILURE_DISPATCHES` is per DISPATCH, not per attempt** — TRUE. `writeFailureAfter` is called once per agent
  after the whole attempt loop (`research-engine.ts:637`), from `lastWriteFailure` (the last attempt's error). Three attempts in
  one dispatch = 1. Pinned by content at `retry-waste.test.ts:421-424` (`attempts === config.workflow.agentMaxAttempts` alongside
  `dispatches: 1`). **Mutation I ran**: `2 → 3` reds 5 tests across `retry-waste` and `d-attack`, including the two named ones.
- **"The record survives `approveHold`, so an approval no longer re-buys the same failure uncapped"** — TRUE. `approveHold`
  (`jobs/firestore.ts:300`) writes only the job document (`attempts: 0`, `budgetOverride`, clears `error`/`finishedAt`/`progress`);
  `writeFailures` lives in `checkpoint.json`, which the approval deliberately keeps. Proven in-engine at
  `retry-waste.test.ts:437-444`: a third dispatch resuming from the exhausted checkpoint makes **zero** provider calls and the
  scout's row is the checkpoint's. And `held` IS still reached when everything is exhausted AND the ceiling is hit: the
  finalize-in-place block is guarded by `!jobSpend.budget().exceeded` (`:687`) and the `budgetStopped && pending.length` return
  comes after (`:722`). (Worth noting, not a finding: such a hold can only ever end in the same degraded report, and
  `approveHold` grants `budgetOverride` for a run that will spend nothing.)
- **A schema signature that alternates fields never repeats** — TRUE and bounded: a model that breaks `askingPrice` on one
  dispatch and `revenue` on the next resets the count every time, so it runs the full `maxJobAttempts`. That is the pre-D1
  behaviour and is still bounded by the ceiling; nothing regressed.
- **`retryable()` does not finalize too early** — TRUE for the cases I could construct. An agent whose dep failed TRANSIENTLY
  is in the set (no signature ⇒ not exhausted), so `retryable()` is non-empty and the dispatch returns `incomplete`. An agent
  cannot be run twice in one dispatch by the extra `runWaves(true)`: to reach the early finalize it must have been dropped from
  the set, which requires a pending dep, which means `!depsReady` in pass 1, which means it was deferred (`status: 'pending'`)
  and never charged. Deleting from a `Set` while `for…of`-iterating it is safe here (the outer fixpoint loop re-runs).
- **`run-job` expects nothing that the early finalize breaks** — TRUE. The engine now returns `completed` where it used to return
  `incomplete`; `run-job.ts:380` only reacts to `incomplete`, and `attempts`/`setJobAttempts` are computed before the run.
- **a68d656 reaches production** — TRUE. `research-engine.ts:989` passes `current: context.current` to `buildSynthesizerPrompt`,
  and `contextFor` (`:1090-1092`) fills `current` from `ownedKeys` = produces + enriches, so the flagship's `chart-refiner`
  (`enriches: ['charts']`) gets the analyst's charts whole and fenced. The block is empty for a produce-only synthesizer.
- **The marker cannot ride into `report.json`** — TRUE in practice, though nothing strips the writer's OUTPUT. Every inbound
  path strips (`gather.ts:248-250, 456, 494`) and every re-entry into a prompt goes through `untrusted()`
  (`prompt.ts:266, 312, 349, 382, 422`), so the model would have to invent the marker unprompted. No fix needed; a strip on the
  way to `report.json` would be belt-and-braces.
- **`arrayFields` reads the pre-rewrite value** — TRUE, and the concurrency hazard is unreachable in the flagship: no wave holds
  two agents that own the same key (`valuation-analyst`→`deep-dive-refiner` and `chart-analyst`→`chart-refiner` are
  dependency-ordered, and `market-refiner` depends on `market-analyst`). A template with two same-wave enrichers of one key would
  compare against a peer's value; it would only mis-write a trace note.

## Tests: content vs shape, and the mutations I ran

- `retry-waste.test.ts:382` (migration) — **content**; the fixture is a literal old shape, not a mutated new one. Mutation
  (missing field ⇒ all gathered) → red, for the stated reason. Ran it.
- `retry-waste.test.ts:417` (second identical failure) — **content**: asserts the status, the section status, the warning string
  including the signature, and `mock.calls === 0` on a third dispatch. Mutation `2 → 3` → red. Ran it.
- `retry-waste.test.ts:310` ("bounds what it carries") — **shape/tautology-adjacent**: `expect(extracted.length)
  .toBeLessThanOrEqual(60)` with a hard-coded 60 that mirrors the source constant, and it asserts only the CAP, never which
  pages survive or what the eviction costs (F2 is exactly what it does not look at).
- `red-team/refute-D1.test.ts:147` (truncation variant) — **true but narrow**: both chosen cuts (150, 160) land inside a string,
  so it pins the position strip, not the "two truncations are one failure" claim it is titled for (F3: 73.4%).
- `red-team/d-attack.test.ts:395` ("a Zod `.min(1)` array and a `.max(5000000)` number reach the Gemini schema **exactly as the
  section declares them**", comment: "The Florida shapes, as the engine sends them") — **misleading scenario**: the schema is
  invented inside the test. The real Florida section schemas contain 17 `minItems`, 2 `maxItems`, 5 `maxLength` and **zero**
  `minimum`/`maximum` (measured, `test/g2-bounds.scratch.test.ts`), so the `maximum: 5_000_000` half asserts a shape the flagship
  never sends. The sibling test at `:374` is honest (it declares its own schema and says so).
- `red-team/d-attack.test.ts:333` (two dispatches, not `MAX_JOB_ATTEMPTS`) — **content**: counts structured calls per dispatch and
  asserts the lost section. Red under the `2 → 3` mutation.

Scratch files left in the worktree (uncommitted, not for merge): `packages/core/test/g2-break.scratch.test.ts`,
`packages/core/test/g2-bounds.scratch.test.ts`; scripts in `…/scratchpad/{sigtest.mjs,cutjson.mjs}`. `src/` is unmodified
(`git diff --stat src/` empty after both mutations were reverted).
