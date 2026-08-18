# G2-verify — group G2 (RETRIES / CHECKPOINT / PROMPT BUILDERS: `6264887`, `a68d656`, `49e71aa`) / VERIFIER · completeness

Setup: `npm ci` in my worktree, then `git checkout a11bafe` (the worktree was at `d1ac4dd` — the reviewed
commits were NOT in the tree; anyone measuring on `main` in this worktree measured the wrong checkout).
`packages/core/test/resolution.test.ts` does not exist; the file lives in `apps/api` and `apps/worker`.
**I ran `cd apps/api && npx vitest run test/resolution.test.ts` — 1 passed.** Core baseline at `a11bafe`:
622 passed / 16 skipped (638). API baseline: 214 passed / 6 skipped (220).

## Verdict

The engineering in all three commits holds: I ran **all twelve** of `6264887`'s named mutations plus the
Gemini split (13 runs) and every one goes red on the named files, and `a68d656`'s single mutation reds the
refute-A1 pin on a content assertion (the analyst's chart JSON inside the fence). The mechanisms reach
production: the exhausted-agent signature does land in `summary.warnings` and IS rendered on the admin's
JobDetail; `chart-refiner` really does get `context.current` with the analyst's charts in it (`dependsOn:
['chart-analyst']` puts it in a later wave). Where the batch does **not** hold is on completeness, in
exactly the three ways this repo keeps repeating. (1) **A guard that never reaches a screen**: the A1
shrink note — the whole "the admin can see it happened" claim — goes into `at.notes`, which `JobSummary`
drops, which no admin UI renders, and which `slimAgents()` **blanks in the checkpoint**, so on any job that
takes a second dispatch the note is gone from the delivered `trace.json` too (reproduced). (2) **A claim
in a commit message that is not true**: `49e71aa` says "verified … push `res.text` unstripped" — that
mutation reds a pin at exactly **one of the three** sites it changed; reverting the `gather` loop turn or
the schema-repair round leaves the entire 638-test core suite green. (3) **Assert the content, not the
shape**: three of the five assertions in A3's flagship `cutJson` test are tautologies created by the
` … [cut]` suffix the same commit added — the headline example (`"askingPrice":538` for $538,138) is
guarded by two regexes that can never fire. Plus: `docs/agents.md` still tells an operator the engine
degrades "on the **final** attempt", which `6264887` made false, and `6264887` touched no operator doc at
all.

## Findings (most severe first)

### F1 · The A1 shrink note — the fix's entire "the admin can see it happened" — is on no screen, and a re-dispatch deletes it — P1
- where: `packages/core/src/engine/research-engine.ts:577-583` (the note), `:423` `slimAgents()`
  (`notes: []`), `packages/core/src/engine/run-job.ts:513-515` (the summary's `agents` map drops `notes`),
  `apps/admin/src/api/types.ts:133-140` (`JobAgentSummary` has no `notes`),
  `apps/admin/src/pages/JobDetail.tsx:360-393` (agents table: Agent/Wave/Status/Duration/Tries/Cost).
- input / observed: 3-agent template; scout writes 3 listings, an `enriches: ['findings']` refiner hands
  back 1, a third agent's write fails so dispatch 1 returns `incomplete`; dispatch 2 resumes from the
  checkpoint and completes.
  - D1 `trace.agents[refiner].notes` = `["… Composing (findings).", "… rewrite of \"findings.listings\"
    returned 1 item(s) where the current version had 3; the previous version is in the analyst's trace
    output."]` ✔
  - `checkpoint.agentTraces[refiner].notes` = `[]`
  - D2 (delivered) `trace.agents[refiner].notes` = `[]`, `trace.status` = `completed`, report ships **1 of
    3 listings**, `meta.sections` = `[]`, `warnings` absent. Nothing anywhere records the drop.
- status: **reproduced** (scratch `packages/core/test/g2-notes.scratch.test.ts`, since deleted; the
  assertions are the four bullets above). The screen half is reasoned from the three files cited — the
  note is not in `JobSummary`, so it cannot be in any admin page; the only carrier is `trace.json`, which
  an admin must download as raw JSON (`ADMIN_ONLY_FILES`, `apps/api/src/index.ts:917`).
- refutation attempted: (a) *maybe the summary carries notes another way* — no: `run-job.ts:513` maps
  `{id, wave, status, durationMs, attempts, costUsd}` and nothing else. (b) *maybe the admin page renders
  the trace file* — `73a4e79` in this same batch **deleted** the dead admin trace viewer, so no. (c)
  *maybe a single-dispatch job is the only case that matters* — the a-legit pin
  (`a-legit.test.ts:391`) runs `runResearch` once with default `finalize`, so it only ever exercises the
  case where the note survives; D1's whole subject is the multi-dispatch job.
- fix sketch: keep the shrink note out of `notes` — push it to the engine's `warnings[]` (it already flows
  to `summary.warnings` → the admin alert), or add a `{key, status:'shrunk', before, after}` row to
  `meta.sections`. Naive fix cost: `warnings` currently means "a section degraded", and the sections notice
  the buyer reads is derived from `meta.sections` — an honest rewrite that dedups two listings must not
  start telling the buyer their report is degraded, so the new status needs its own (silent) buyer copy.

### F2 · `49e71aa`'s "push `res.text` unstripped" is verified at one of the three sites it changed; the `gather` loop turn is untested — P2
- where: `packages/core/src/engine/gather.ts:317` and `packages/core/src/engine/synthesize.ts:129`
  (both untested); only `synthesize.ts:116` (the JSON-parse repair round) is pinned, by
  `packages/core/test/red-team/a-attack.test.ts:415`.
- input / observed, full core suite (638 tests) per mutation:
  | mutation | result |
  |---|---|
  | `synthesize.ts:116` `stripFenceMarker(res.text)` → `res.text` (JSON repair round) | **RED** — a-attack:415 |
  | `synthesize.ts:129` `stripFenceMarker(res.text)` → `res.text` (schema repair round) | **GREEN** — 622 passed |
  | `gather.ts:317` `stripFenceMarker(res.text)` → `res.text` (every loop turn) | **GREEN** — 622 passed |
  The untested `gather` site is the higher-traffic one by orders of magnitude (one push per loop turn of
  every producer, vs one push only when a write returns invalid JSON), and it is the one whose threat model
  the repo takes seriously enough to have written a live probe for
  (`refute-A1.test.ts:194`, "does the model emit our marker?" — currently `describeLive`, skipped).
- status: **reproduced** (three full-suite runs, mutations reverted via `git checkout -- packages/core/src`).
- refutation attempted: I grepped for any other suite that could cover them (`apps/api`, `apps/worker`) —
  the code is `packages/core` only, and the core suite is the whole coverage. I also confirmed
  `a-attack.test.ts:415`'s stub returns `{"overview": "<<<…` (unterminated) on call 1, so it can only reach
  the `JSON.parse` catch, never the `safeParse` branch.
- fix sketch: two assertions in `a-attack.test.ts` — a stub whose first answer is *valid JSON, wrong
  schema* carrying the marker; and a `gather` run whose model turn echoes the marker, asserting the next
  turn's message array is marker-even. Nothing honest is lost (both are pure-mock).

### F3 · A3's `cutJson` test: three of five assertions cannot fail, including both that name the headline defect — P2
- where: `packages/core/test/red-team/a-legit.test.ts:482-511`, helper `trimmedExtract` at `:465-469`.
- input / observed: `trimmedExtract` returns `v.slice(v.indexOf('Extract: ')+9, -1)`, and `contextBlock`
  (`prompt.ts:381-386`) now ends every note with `` … [cut]] ``. So the returned string **always ends with
  `[cut]`**. Therefore:
  - `expect(extract.endsWith('}') || endsWith(',') || endsWith(']')).toBe(true)` — always true (`]` of `[cut]`);
  - `expect(e2).not.toMatch(/"askingPrice":538$/)` — can never match;
  - `expect(e2).not.toMatch(/\d$/)` — can never match.
  The whole second half of the test (the 27-char-pad fixture built specifically to reproduce
  `"askingPrice":538` for a $538,138 listing) asserts nothing that can go red. I ran the named mutation
  (`json.slice(0, share)` instead of `cutJson`) and the ONLY assertion that fires is
  `expect(extract).not.toMatch(/https?:\/\/[^"]*$/)` — the URL case. A regression that cut mid-number and
  never mid-URL would ship green.
- status: **reproduced** — mutation run (single failure, `expected '{"listings":[{"business":"D0 Coin
  Lau…' not to match /https?:\/\/[^"]*$/`); tautology proved by a 6-line scratch test feeding
  `trimmedExtract` a hand-built note ending `"askingPrice":538 … [cut]]` and asserting all three
  predicates give the "pass" answer. `cutJson` itself is CORRECT — I rendered a real 79k trimmed block and
  the extract ends `…"askingPrice":552152` with the next char a `,`, i.e. on a whole value.
- refutation attempted: maybe `trimmedExtract`'s `-1` is meant to strip `[cut]` too — it strips exactly one
  character, so no. Maybe the a-legit assertions run against the raw `Extract:` payload elsewhere — the
  helper is the only accessor and both call sites use it.
- fix sketch: `trimmedExtract` should return the payload with the ` … [cut]` sentinel removed
  (`v.slice(start, v.lastIndexOf(' … [cut]'))`), which makes all five assertions live at once. Nothing
  honest is lost; the `p.toContain(' … [cut]]')` assertion already covers the sentinel separately.

### F4 · `docs/agents.md` now describes a finalize rule the engine no longer follows, and `6264887` documented itself only in the backlog — P2
- where: `docs/agents.md:117-127`; `6264887` touched `docs/plans/deep-review.md` and nothing else
  (`git log --name-only d1ac4dd..a11bafe -- docs/`).
- input / observed, three claims that are now false or incomplete for an operator:
  1. §3 "**On the final attempt**, any section still unfilled is degraded" — after `6264887`
     (`research-engine.ts:687-692`) a *non-final* dispatch degrades and delivers as soon as
     `retryable()` is empty. This is the single most operator-visible behaviour change in the commit
     (a job that used to sit `incomplete` for six more dispatches now completes degraded immediately)
     and it is documented nowhere an operator reads.
  2. §2 lists the checkpoint as "(`report` so far, gathered `sources`, `doneAgentIds`, `degraded`)" —
     it now also carries `extracted`, `handoffs`, `agentTraces`, `cost`, **`gatheredAgentIds`** and
     **`writeFailures`**. For a persisted shape a human inspects when deciding a HELD job, that list
     being wrong matters.
  3. Nothing names the two-dispatch give-up bound. `REPEATED_WRITE_FAILURE_DISPATCHES = 2`
     (`research-engine.ts:191`) is now a *harder* bound on a job's life than `MAX_JOB_ATTEMPTS` (8),
     which IS an env var documented in `docs/deployment.md:145`'s neighbourhood. An operator asking
     "why did this job give up at dispatch 2 when I set MAX_JOB_ATTEMPTS=8?" has nowhere to look.
- status: **reproduced** (read `docs/agents.md` at `a11bafe`; ran the git log to confirm the commit
  touched no operator doc).
- refutation attempted: `7a45269` in the same batch *does* touch `docs/agents.md`, so the file was in
  someone's hands — I re-read it at `a11bafe` and both stale claims are still there.
- fix sketch: one sentence in §3 ("…or earlier, as soon as no unfinished step can still be retried") and
  the two field names in §2. On the constant-vs-env question: leaving it a constant is the right call
  (it encodes a *semantic* rule about model determinism, not a capacity knob, and an operator raising it
  to 8 would restore the exact ×8 waste D1 removed) — but it should then be *named* in agents.md §1/§3
  the way `agentMaxAttempts` is.

### F5 · The redaction that keeps the new signature off the buyer's screen is untested — P2
- where: `apps/api/src/index.ts:1553-1558` (non-admin summary → `{notice, sections}` only).
- input / observed: `6264887` newly puts `the write failed the same way on 2 dispatches
  [schema:findings.listings.*.askingPrice:invalid_type]: StructuredOutputError: …` into
  `trace.warnings` → `summary.warnings`. One line of redaction keeps it from the buyer. I replaced the
  non-admin branch with `s` (hand the buyer the whole summary — `warnings`, `agentErrors`, and
  `agents[].costUsd`, i.e. our per-agent dollar spend) and ran the **entire** API suite:
  **214 passed / 6 skipped, green.**
- status: **reproduced** (mutation + full `apps/api` suite; reverted).
- refutation attempted: grepped `apps/api/test/**` for `warnings` — zero hits; `progress-payload.test.ts`
  pins the *progress* redaction thoroughly and stops there. `apps/core` cannot cover it (the redaction is
  in the route).
- fix sketch: one case in `apps/api/test/progress-payload.test.ts` — seed a job whose `summary.warnings`
  contains a sentinel and whose `summary.agents[0].costUsd` is nonzero, assert a buyer token gets
  `summary` = `{notice, sections}` exactly and an admin token gets both. Nothing honest is lost.

### F6 · `a68d656` hands the chart-refiner "NEVER drop an item"; the spec sentence that would have qualified it (`focus`) reaches no prompt at all — P2
- where: `packages/core/src/engine/prompt.ts:444` — `agent.focus` is rendered **only** by
  `buildAgentKickoff` (the producer research loop). `buildSynthesizerPrompt`, `buildProducerSynthPrompt`
  and `buildEnricherSynthPrompt` never render it. `templates/types.ts:67` documents the field as "Extra
  focus for this agent's research **+ writing**".
- input / observed: real Florida comprehensive run through the mock, capturing every structured prompt —
  for all ten agents that declare a `focus`, the string appears in **zero** write prompts. The two
  affected worst are `chart-analyst` and `chart-refiner`, which are `role: 'synthesizer'` and therefore
  have no research loop at all: their `focus` reaches nothing, ever. The chart-refiner's prompt contains
  `NEVER drop an item` (true) and does **not** contain `drop empty or misleading` (its own focus, false).
- status: **reproduced** (scratch `packages/core/test/g2-verify.scratch.test.ts`, since deleted; printed
  a per-agent table plus the two `chart` substring checks).
- refutation attempted: **the brief's suspected contradiction does not exist** — the model never reads the
  focus, so it never sees "drop empty or misleading ones" next to "NEVER drop an item". That is the
  honest answer to question 3. But the refutation *creates* the finding: `a68d656` is the commit that put
  a **"never drop"** instruction in front of the chart-refiner, and the template author's explicit
  counter-instruction is dead code, so the shipped prompt now says the opposite of the spec. Mitigation
  that keeps this at P2: the `charts` section's own `guidance`
  (`florida-business-for-sale.ts:750-756`) covers "never invent data" and "if there is not enough
  quantitative data, return an empty array", so most of `chart-analyst`'s focus is redundant; only
  `chart-refiner`'s "drop empty or misleading ones" is lost outright. And the A1 shrink note *does* fire
  for `charts` (`arrayFields` returns `[['charts', before, after]]` for an array section) — but see F1:
  nobody reads it.
- fix sketch: render `(agent.focus ? \`FOCUS: ${agent.focus}\n\` : '')` in the three write builders (it is
  already low-authority, our own text, above the fence), or delete `focus` from the two synthesizers and
  fold the sentence into the section guidance. Naive-fix cost: adding it to `buildEnricherSynthPrompt`
  puts a "drop" instruction next to "NEVER drop an item" for the refiners that DO enrich — the two have to
  be reconciled in one sentence, not stacked.

### F7 · The buyer's live line during finalize-in-place reads "Planning" over "Assembling the report." — P2
- where: `packages/core/src/engine/research-engine.ts:689` —
  `emit('planning', 'No unfinished step can still be retried…', 'assembling')`. Compare `:792`, the other
  assembling emit, which uses phase `'assembling'`.
- input / observed: `clientProgress` (`jobs/types.ts:125`) hands the buyer `{phase:'planning',
  kind:'assembling'}`. `apps/fbizlab/src/pages/JobView.tsx:47,75-78` renders the **phase** as the headline
  (`phaseLabel('planning')` = "Planning" / "Planning the research workflow.") and the **kind** as the line
  under it (`progress-copy.ts:33` = "Assembling the report."). So a job that has finished researching and
  is degrading tells the buyer it is planning.
- status: **reasoned** (traced emit → `clientProgress` → `JobView` → `phases.ts` / `progress-copy.ts`; not
  driven end-to-end through the SPA).
- refutation attempted: `emit('planning', …, 'wave')` at `:471` has the same phase/kind split and reads
  fine ("Planning" + "Starting the next group of analysts"), so the pattern itself isn't the bug — it is
  this one pairing, and the fix is one word. On honesty of the *kind*: `assembling` is defensible (it does
  run deferred steps then assemble), and the buyer gets the truthful `notice` from `meta.sections` at
  completion, so I did not raise this to P1.
- fix sketch: `emit('assembling', 'No unfinished step can still be retried…', 'assembling')`. Nothing is
  lost; the admin still gets the full sentence in `progress.message`.

### F8 · `MAX_SIGNATURE_CHARS` truncation can collapse two different schema failures into one — P2 (hygiene)
- where: `packages/core/src/engine/synthesize.ts:66-72` — `` `schema:${[...keys].sort().join(',')}`.slice(0, 1000) ``.
- input / observed: because the keys are **sorted**, two failures that share a large early-alphabet prefix
  (e.g. 60 issues under `findings.listings.*` plus, in one of them, an extra `market_overview:*` issue)
  can be byte-identical in the first 1,000 characters. `writeFailureAfter` then counts them as the same
  signature and the agent is given up on for a failure it has only seen once — the exact "too blunt" trap
  the design memo (`docs/plans/m-red-team-reports/REFUTE-D1.md`) set out to avoid.
- status: **reasoned** (no fixture; I did not construct a 1,000-char-prefix collision).
- refutation attempted: the de-dup `Set` makes 1,000 chars a lot of distinct `path:code` pairs (~25-40
  issues) — a Florida section is unlikely to produce that many, so this is narrow. It is also fail-*safe*
  in the money direction (it gives up earlier, not later); the cost is a section lost one dispatch too
  soon.
- fix sketch: hash the tail instead of dropping it — `keys.length > N ? \`schema:${n} issues:${sha1(all)}\``
  — or append the issue count to the truncated string.

## Claims checked and TRUE (so nobody re-checks)

- **`6264887`: "Verified by mutation, twelve … each red on the named tests."** TRUE, all twelve, plus the
  Gemini one split in two (13 runs against `d-attack` + `refute-D1` + `retry-waste` + `d-legit`). Table
  in the Tests section below. No test imports `REPEATED_WRITE_FAILURE_DISPATCHES`; the bound is asserted
  through literals in the warning strings and dispatch counts, which is why `2 → 3` reds five tests
  instead of zero — the "test reads the same constant the source reads" trap is genuinely avoided here.
- **"a checkpoint without the field resumes exactly as before (a literal old-shape fixture pins it)."**
  TRUE. `retry-waste.test.ts:382` builds the old shape field-by-field and asserts
  `not.toHaveProperty('gatheredAgentIds' | 'writeFailures')`; my "missing field = all gathered" mutation
  reds exactly that test and nothing else.
- **"the record survives `approveHold`, so an approval no longer re-buys the same failure uncapped."**
  TRUE. `run-job.ts:174` `JSON.parse(raw) as Checkpoint` — whole object, no field whitelist, so
  `writeFailures` survives; `firestore.ts:300-337` `approveHold` never touches `checkpoint.json`. Pinned
  end-to-end by `d-attack.test.ts:445` (`again.filter(l => l.kind === 'loop').length === 0` after the
  approval, `warnings` matching `/"scout".*failed the same way on 2 dispatches/`), and my
  "gathered.has → false" / "empty gathered set" / "run exhausted agents" mutations all red that test.
- **The exhausted-agent signature reaches `summary.warnings` and the admin's screen.**
  TRUE. `research-engine.ts:844-846` `agentReason` → `:786` `warnings.push` → `trace.warnings` →
  `run-job.ts:524` `summary.warnings` → `apps/api/src/index.ts:1553` (admin gets `s` whole) →
  `apps/admin/src/pages/JobDetail.tsx:355-359` "Warnings — review what happened". Non-admins get only
  `{notice, sections}` — correct (though see F5: untested).
- **`a68d656`: `chart-refiner`'s `context.current` really does contain the analyst's charts.**
  TRUE. `dependsOn: ['chart-analyst', …]` (`florida-business-for-sale.ts:906`) → `topoSortAgents` puts it
  in a strictly later wave → `report.charts` is written → `contextFor` (`research-engine.ts:1088-1092`)
  moves owned keys into `current`. `refute-A1.test.ts:38` asserts the *content*
  (`block).toContain('"title": "PZ-CHART-FROM-ANALYST"')` inside the fence, marker count 2), and it is
  non-vacuous (it first proves the analyst wrote the sentinel and that the refiner's output replaced it).
  My `current: context.current` mutation reds it.
- **`49e71aa`: the trim note claims "the briefings above cover it" only when there are briefings.**
  TRUE. `notes` at `prompt.ts:330` is `Object.entries(handoffs).filter(([,v]) => v?.trim())` — the same
  list, in the same scope, gating the same block at `:334`. Mutation (drop the `notes.length ?` guard)
  reds `a-legit.test.ts:512`, which asserts both the absence of the phrase and the presence of
  `'This section is complete in the report. Extract:'`.
- **The rendered trim block is well-formed.** TRUE, and structurally guaranteed: the note is a JSON
  *string value* inside `JSON.stringify(trimmed, null, 2)`, and `a-legit`'s `producedSections` helper
  `JSON.parse`s the fenced block on every one of those tests — a malformed render would throw. I rendered
  a real 79k-char case and parsed it: `[Trimmed to fit: 78,994 characters, … Extract: {"listings":[… ,
  "askingPrice":552152 … [cut]]` — brackets balanced, cut on a whole value.
- **`splitHandoff` by code point, and the cap interpolated once.** TRUE. `research-engine.ts:997-1000`
  uses `Array.from(text)`; mutation back to `text.slice` reds a-legit's emoji test. The `describe()` at
  `research-engine.ts:894` interpolates `` `Under ${MAX_HANDOFF_CHARS} ` `` — the number appears once,
  imported from `prompt.ts:293`, not hardcoded twice.
- **The signature leaks no buyer or page content.** TRUE by construction: schema → Zod `path:code` (schema
  paths, indices `*`); JSON → parser kind with ` at position N…` and the whole `Unexpected token …` tail
  stripped. Node's `Expected ',' or '}' after property value in JSON at position 39973` reduces to the
  kind alone (verified against a real truncated extract).

## Tests: content vs shape, and every mutation I ran

**Content-asserting (good):** `d-attack.test.ts:445` (D3 — counts ledger entries by kind, asserts zero
loop calls after approval and the exact warning text); `retry-waste.test.ts:359/382/417/447/465` (asserts
the "Reusing evidence already gathered" note and the *absence* of "Researching (", the literal old-shape
fixture, the signature counts); `refute-A1.test.ts:38` (the analyst's sentinel inside the refiner's fence,
with the non-vacuity proof); `a-legit.test.ts:391` (the exact shrink-note string, plus the analyst's six
still recoverable in the trace); `a-legit.test.ts:512` (asserts the phrase's absence AND the replacement
sentence's presence).

**Shape / tautology:** `a-legit.test.ts:482` — three of five assertions cannot fail (F3), including both
that name A3's headline defect; the test's title ("never ends inside a **figure** or a URL") claims more
than the one live assertion delivers.

**Untested code shipped in the batch:** `gather.ts:317` and `synthesize.ts:129` marker strips (F2); the
C5 "No tables and no images" clause in `MARKDOWN_DIRECTIVE` (`prompt.ts:53-54`) — I deleted the clause and
ran the full core suite: **622 passed, green**; `apps/api/src/index.ts:1553` non-admin summary redaction
(F5).

### `6264887` — twelve mutations, run against `d-attack` + `refute-D1` + `retry-waste` + `d-legit` (44 tests + 1 skipped baseline, all green)

| # | mutation (file:site) | red tests | verdict |
|---|---|---|---|
| M1 | `research-engine.ts:533` `gathered.has(agent.id)` → `false` | 3 | RED |
| M2 | `research-engine.ts:191` `= 2` → `= 3` | 5 | RED |
| M3 | `research-engine.ts:208` `writeFailureAfter`: record every failure incl. provider errors | 1 (`a transient failure has no signature`) | RED |
| M4 | `synthesize.ts:jsonFailureSignature` return `json:${message}` (keep position) | 3 | RED |
| M5 | `synthesize.ts:schemaFailureSignature` drop the `number → '*'` collapse | 2 | RED |
| M6a | `gemini-vertex.ts` drop `minItems`/`maxItems` forwarding | 2 | RED |
| M6b | `gemini-vertex.ts` drop `minimum`/`maximum` forwarding | 2 | RED |
| M7 | `research-engine.ts:430` `gatheredAgentIds: [...gathered]` → `[]` | 4 | RED |
| M8 | `research-engine.ts:469` drop `&& !exhausted(a.id)` | 5 | RED |
| M9 | `research-engine.ts:687` `if (false && …)` (never finalize early) | 5 | RED |
| M10 | `research-engine.ts:352` missing field → all agent ids | 1 (the old-shape fixture) | RED |
| M11 | `research-engine.ts:844` warning without `[${failure.signature}]` | 3 | RED |
| M12 | `research-engine.ts:504` drop `at.turnsUsed = trace.agents[prior]!.turnsUsed ?? 0` | 2 | RED |

### `a68d656` + `49e71aa` — run against `a-attack` + `a-legit` + `refute-A1` + `handoffs` (46 tests + 6 skipped baseline, green); the two GREEN rows re-run against the full 638-test core suite

| mutation | red tests | verdict |
|---|---|---|
| `prompt.ts:550` render `current` raw (old `"""` block) | 7 | RED |
| `prompt.ts:384` `json.slice(0, share)` instead of `cutJson` | 1 (URL assertion only — F3) | RED, partly |
| `synthesize.ts:116` push `res.text` unstripped (JSON repair) | 1 | RED |
| `synthesize.ts:129` push `res.text` unstripped (schema repair) | **0 / 638** | **GREEN — F2** |
| `gather.ts:317` push `res.text` unstripped (every loop turn) | **0 / 638** | **GREEN — F2** |
| `research-engine.ts:570-582` drop the shrink note | 1 | RED |
| `prompt.ts:384` drop the `notes.length ?` guard | 1 | RED |
| `research-engine.ts:793` drop `current: context.current` (a68d656) | 1 | RED |
| `research-engine.ts:997` `splitHandoff` back to UTF-16 `slice` | 1 | RED |
| `prompt.ts:53` drop "No tables and no images" (C5) | **0 / 638** | **GREEN** |
| `apps/api/src/index.ts:1558` hand non-admins the whole summary | **0 / 220** | **GREEN — F5** |

All mutations reverted (`git checkout -- packages/core/src`, `git checkout -- apps/api/src/index.ts`);
scratch tests deleted; `git status --porcelain` clean; final core run 622 passed / 16 skipped.
