# G4-verify — `4ba3bd4` + `8d2df52` + `79fa632` / VERIFY

Measured at **`a37d5f5`** (the brief's own commit), in my own worktree, `npm ci` first, `apps/worker
test/resolution.test.ts` green (so `@agent-researcher/core` resolves to THIS checkout). Clean-worktree
baseline `npm test` = **1109 passed, 0 failed** (708 core + 215 api + 22 worker + 158 fbizlab + 6 admin;
16 skipped in core, 6 in api) — the brief's number exactly. For the suite-total and historical-span
checks I symlinked `out/` from the main checkout (as the brief allows) and say so at each row; with it,
the same checkout counts **1115 (714 + 215 + 22 + 158 + 6)**, i.e. the "clean clone: 6 fewer" constant is
right and all six are core. The symlink was removed before finishing; `git status` and `git diff` are clean
and HEAD is still `a37d5f5`.

## Verdict

The measurable half of this group is unusually honest. **Every one of the nine mutation counts across
`4ba3bd4` and `8d2df52` reproduces exactly** — including both halves of the two "before" claims that are
the whole point of `8d2df52` (the pre-fix resumed-writer fixture really does measure 0 red for its own
test under the same source mutation, and the pre-fix `rate-limit-copy` really does cascade to 2), and
including the disclosed **0 red** for the snapshot aliasing. All three suite totals (1115, 1106, 1115) are
right in the checkout each names. Of the record corrections `79fa632` publishes, three of four are right:
the re-measured P2 span **1035 → 1062** is correct to the commit, `929e8dd`'s "2 red" really is 3, and
`93b132e`'s cached-note figure really is **296**. What does not hold is the *prose*, and it fails in the
same shape the commit set out to fix — a stated REASON that is not the code's. Five claims are false or
incomplete: `renderPlan` does **not** append the directive clause on every path ("a template cannot forget
it" is not the invariant the code has, and the fall-through prints `directives: [object Object]` in its
place); `snapshot()` does **not** copy its arrays — `sources`, `report`, `writeFailures` and `cost` are
still the live ones; `local-llm.md`'s new ADC paragraph names the wrong first Firestore read; the
corrected checkpoint field list is still missing `turnsUsed`; and the new `validateRequest` comment
asserts a worker-side `paramsSchema` re-validation that does not exist. Plus one number: `b-legit` reaches
**5**, not 4. Nothing here reaches a buyer today — one template ships and it has a `describePlan` — so
everything is P2, but F1 becomes P1 the day a second template is registered.

## Findings (most severe first)

### F1 · `renderPlan` appends the directive clause only on the `describePlan` branch — the "a template cannot forget it" invariant is not the one the code has, and the fall-through prints `directives: [object Object]` on the last screen before payment — P2 (P1 the day a second template lands)
- where: `packages/core/src/moderation/deterministic.ts:100-113` (the clause is inside `if (template.preflight?.describePlan) { try { … } }`); the generic renderer at `:107-112` never calls `planDirectives`. `packages/core/src/templates/validate.ts` says nothing about `preflight`/`describePlan`, so nothing forces a template to have one.
- claim under test (`4ba3bd4`): *"The clause is appended in `renderPlan`, NOT in the model's `describePlan`, so a template cannot forget it: every model's summary is now a function of the params actually being submitted."*
- input / observed (scratch test, `packages/core/test/`, deleted after measuring):
  ```
  const noDescribe = { ...tpl, preflight: { ...tpl.preflight, describePlan: undefined } };
  renderPlan(noDescribe, params({ directives: { ownerInvolvement: 'absentee', reasonForSale: ['owner_retiring'] } }),
             { lang: 'en', modeLabel: 'Essential' })
  ```
  ```
  A_WITH_DESCRIBEPLAN:      …Preferences you set: Reason for sale: Owner retiring; Owner involvement: Absentee — a manager runs it.
  B_NO_DESCRIBEPLAN:        We'll run "Florida Businesses for Sale — Buy-Side Research" (Essential) — location: Miami-Dade County, FL; industry: laundromats; directives: [object Object].
  C_THROWING_DESCRIBEPLAN:  (identical to B)
  ```
  So a template without `describePlan` — and the shipped one if its `describePlan` ever throws, which is
  exactly what the `catch` exists for — loses every directive from the pre-payment summary and emits
  `directives: [object Object]` for the same field. Both assertions (`not.toContain('Owner involvement')`)
  passed.
- status: **reproduced** (3/3 green in the scratch test; `A` shows the shipped path is fine).
- refutation attempted: (a) is there a second template? No — `TEMPLATES` in `registry.ts` holds only
  `florida-business-for-sale`, and it has a `describePlan`, so **no buyer is affected today**. (b) Can
  Florida's `describePlan` throw? It is written defensively (`str`/`num`/`list` typeof guards), so
  realistically no. (c) Is `[object Object]` new? No — the generic renderer's `String(v)` predates this
  commit. What `4ba3bd4` adds is the *claim* that the clause is now unforgettable, and `registerTemplate`
  is a public export.
- fix sketch: hoist `planDirectives` out of the `if`/`try` — compute `const dirs = planDirectives(...)`
  once and append it to both return paths; and exclude the directives key from the generic renderer's
  `Object.entries(params)` loop so it is rendered by `planDirectives` or not at all. Done naively (append
  to the fallback only) an honest run loses nothing, but the `[object Object]` stays and the buyer would
  then read the same preferences twice.

### F2 · `snapshot()` still hands out the live `sources`, `report`, `writeFailures` and `cost` — the claim "copies its arrays and maps" is broader than the change — P2
- where: `packages/core/src/engine/research-engine.ts:548-566`. Copied: `extracted`, `doneAgentIds`,
  `gatheredAgentIds`, `fetchedByAgent`, `touchedByAgent`, `handoffs`, `degraded`, `warnings`,
  `agentTraces`. **Not** copied: `report` (the live object, written per section), `sources:
  evidence.sources` (the live array — pushed at `:456` on resume and throughout every agent's loop),
  `writeFailures` (mutated at `:816-821`), `cost: trace.cost`.
- claim under test (`4ba3bd4`): *"And `snapshot()` copies its arrays and maps instead of handing out the
  live ones."* `sources` is the largest array on the checkpoint and it is still aliased.
- status: **reasoned** (read at `a37d5f5`; the mutation that reverts the copies that WERE made measures
  0 red, reproduced, so no test distinguishes any of this either way).
- refutation attempted: is `evidence.sources` really pushed after a snapshot is taken? Yes — `snapshot()`
  runs after every agent and `:456`/the loop keep appending, so a snapshot held across an agent boundary
  grows. The commit's own defence ("every caller serializes the checkpoint immediately") applies equally
  to `sources`, which is precisely why the incomplete copy is invisible — and why the sentence, taken at
  face value by the next caller the commit is worried about, is the dangerous half.
- fix sketch: `sources: [...evidence.sources]`, `report: { ...report }`, `writeFailures: {
  ...writeFailures }`, `cost: { ...trace.cost }` — or say in the comment which fields are deliberately
  left live. An honest run loses one shallow copy per agent of an array that is already being
  JSON-serialized on the same tick.

### F3 · `local-llm.md`'s new ADC paragraph names the wrong first Firestore read — P2
- where: `docs/local-llm.md:70-74`: *"The API's rate meter reads Firestore before `validateRequest` runs,
  so without ADC every request in §3 returns `500`…"*
- input / observed: both §3 curls hit `POST /research/preflight`. `isPublic()`
  (`apps/api/src/auth.ts:59-64`) does not list `/research`, so the `jwtAuth` **onRequest** hook runs
  first, and its `APP_ENV=local` branch does `req.appRecord = await getApp(appId)`
  (`apps/api/src/auth.ts:82`) — an unguarded `apps().doc(appId).get()`
  (`packages/core/src/apps/store.ts:88-91`). That is the first Firestore read, and it happens before the
  route handler, therefore before `publicLimit` (`apps/api/src/index.ts:1371`) and before
  `validateRequest` (`:1378`).
- status: **reasoned** (call order read end to end; not run without ADC — the rules bar me from a live
  GCP call, and the conclusion is not in dispute). The rate meter *would* also 500: `PREFLIGHT_LIMIT.perIp
  = config.publicLimits.preflightPerHourPerIp` defaults to 240 (`config.ts:176`), so `checkRateLimits`
  opens a Firestore transaction (`store.ts:179`). It is simply not the first one.
- refutation attempted: could `getApp` be cached or fail-soft? No — `auth.ts`'s `cached()` wrapper is used
  for the credential revocation check, not for this branch, and `getApp` has no try/catch.
- fix sketch: "the auth hook loads the app record from Firestore before any route code runs (`auth.ts`,
  the `APP_ENV=local` branch), and the rate meter reads it again". What the current sentence costs: a
  reader who sets `PUBLIC_PREFLIGHT_PER_HOUR_IP=0` to dodge the meter still gets the same 500.

### F4 · the corrected checkpoint field list is still incomplete — `turnsUsed` is missing — P2
- where: `docs/agents.md:136-139` lists `report`, `sources`, `extracted`, `doneAgentIds`,
  `gatheredAgentIds`, `fetchedByAgent`, `touchedByAgent`, `agentTraces`, `handoffs`, `degraded`,
  `warnings`, `writeFailures`, `cost` — thirteen. `Checkpoint` (`research-engine.ts:225-324`) has
  fourteen: `turnsUsed?: number`.
- input / observed: `snapshot()` writes it (`:565 turnsUsed: counter.turns`) and resume reads it
  (`:449 const counter = { turns: input.resume?.turnsUsed ?? input.resume?.cost?.searchCalls ?? 0 }`) —
  it is the job's cross-dispatch turn accounting, not decoration. It was added by `7d2e7b8`, **14 commits
  before** `79fa632`, so it was already stale when the stale list was corrected. The commit's own diagnosis
  ("a prose copy of a type goes stale by the end of the batch that writes it") is right and the fix
  reproduces the defect on the third field.
- status: **reproduced** (field-by-field diff of the doc list against the type at `79fa632`).
- refutation attempted: does the hedge cover it? The sentence now ends "read the `Checkpoint` type for the
  current list", which bounds the damage — but the commit message states the list "now names both", not
  "is now complete", and the list is still presented as the list.
- fix sketch: add `turnsUsed`, or delete the enumeration entirely and keep only the pointer to the type,
  which is what the appended sentence already argues for.

### F5 · the new `validateRequest` comment asserts a worker-side `paramsSchema` re-validation that does not exist — P2
- where: `packages/core/src/index.ts:246`: *"…and the worker re-validates through `paramsSchema` rather
  than through this function, so an admin retry of an old job is unaffected."*
- input / observed: `git grep paramsSchema` over `apps/worker/src` and `packages/core/src/{engine,jobs}`
  returns **nothing**. `apps/worker/src/index.ts:80-86` calls `runJob({ …, params: job.params })`
  verbatim, and `run-job.ts`'s only `parse` is `JSON.parse(raw)` for the checkpoint (`:173`). The only
  `paramsSchema.safeParse` on this path is inside `validateRequest` itself (`index.ts:277`).
- status: **reproduced** (grep + read of both call sites).
- refutation attempted: is the CONCLUSION still true? Yes — `POST /admin/jobs/:jobId/retry`
  (`apps/api/src/index.ts:2422-2470`) re-dispatches the stored job and never calls `validateRequest`, and
  the admin's new-job modal really does build from `defaultsFor(schema)`
  (`apps/admin/src/components/NewJobModal.tsx:25`). So an admin retry of an old job is indeed unaffected —
  because nothing re-validates it at all, which is a different and slightly less comfortable fact than the
  one written.
- fix sketch: "…and the worker does not re-validate at all: it hands `job.params` to `runJob` as stored,
  so an admin retry never reaches this function."

### F6 · the published correction "`b-legit`… reaches 4" is itself off by one: it reaches 5 — P2
- where: `docs/plans/deep-review.md:1351-1357` and the same sentence in `8d2df52` / `79fa632`:
  *"the persona that reaches the honest 6-turn maximum is `d-legit`, not `b-legit` (which reaches 4)"*.
- input / observed: instrumented `gather.ts` with a per-loop max of `noProgressTurns` (the counter
  `NO_PROGRESS_TURNS_LIMIT` bounds — the exact quantity `93b132e` calls "free-and-useless turns in a row")
  and ran each red-team file. Histogram of the per-loop maximum:
  ```
  b-legit    46×1  47×2  3×3  2×4  2×5      → max 5
  d-legit   100×1  11×4  2×6                → max 6
  b-attack   13×1  1×7  1×8                 → max 8   (attack, not honest)
  refute-B2   1×1  3×3  1×4  4×8            → max 8   (attack)
  ```
  The two 5s come from `b-legit`'s *"a revise-once-per-result researcher that cross-checks 5 pages…"* —
  the very persona `93b132e` attributed the 6 to. It runs `withRereads(budget, 4)` and `withRereads(budget,
  5)` for budgets 8 and 24, giving 4, 5, 4, 5: the correction picked the 4-re-read half of a pair whose
  other half is 5. The two 6s come from `d-legit`'s *"a diligent agent on budget 10 that re-plans every
  step and re-opens 6 cached listings…"*, so the substantive half of the correction (**6 belongs to
  `d-legit`**) is right.
- status: **reproduced** (instrumentation reverted; `git diff` clean).
- refutation attempted: wrong metric? `NO_PROGRESS_TURNS_LIMIT` is the "general bound is 8" the sentence
  is about, and `noProgressTurns` is what it compares against (`gather.ts:399,411`), so this is the
  counter, not a proxy. Wrong checkout? Measured at `a37d5f5`; `gather.ts` has moved since `93b132e`, so I
  state the checkout rather than claim the 2026-08-18 number was wrong.
- fix sketch: "…not `b-legit`, whose cross-checker reaches 5 (4 with four re-reads, 5 with five)".

### F7 · `8d2df52`'s message welds two unrelated corrections into one sentence — P2 hygiene
- where: `8d2df52`, last paragraph: *"`929e8dd`'s '2 red' is 3, and the honest 6-turn maximum belongs to
  `d-legit`, not `b-legit` (296 cached notes, not 298)."*
- input / observed: the 296/298 figure is `93b132e`'s cached-note count from the R7-29 flood measurement
  ("300 notes / 298 cached / 410 progress writes"). It has nothing to do with which persona reaches the
  turn maximum, and `93b132e` is not named in the sentence. `79fa632` states the two separately and
  correctly ("`929e8dd`'s '2 red' is 3, the honest 6-turn maximum belongs to `d-legit` …, and `93b132e`'s
  cached-note figure is 296, not 298"). So the two commits recording the *same* correction disagree about
  what it is a correction to.
- status: **reproduced** (both messages read; `93b132e`'s message read).
- fix sketch: nothing to do in code — but this is the fourth round in a row where a carried record went
  wrong in transit, and the mechanism here is a parenthesis attached to the wrong clause.

### F8 · `planDirectives`'s comment over-claims "every word here is a label from the manifest" — P2 hygiene
- where: `packages/core/src/moderation/deterministic.ts:134-141` and the commit message ("every word is a
  manifest label in the buyer's language, the same strings the form showed them").
- input / observed: `PREFS_LEAD` ("Preferences you set:" / "Preferencias que indicaste:" / …) and
  `PREFS_YESNO` ("yes"/"no", "sí"/"no", …) are hardcoded in `deterministic.ts:116-128`, not manifest
  labels; and `const label = (raw) => text.valueLabels?.[raw] ?? raw` falls back to the raw enum token, so
  a directive option with no `valueLabels` entry prints `financial_distress` on the buyer's confirm screen.
- status: **reasoned** (read; the shipped Florida manifest labels every option, so no buyer sees a raw
  token today).
- refutation attempted: the load-bearing property is "no *user-authored* text", and that still holds
  absolutely. Only the "every word is a manifest label" phrasing is wrong.

## Claims checked and TRUE (so nobody re-checks)

- **All five of `4ba3bd4`'s revert-verify counts**, each alone, each a full `npm test`: 1 / 1 / 1 / 1 / **0**.
  The 0-red for the snapshot aliasing is real and the disclosure is accurate. Details in the audit table.
- **All four of `8d2df52`'s counts, and both "before" halves.** In particular: rebuilding the pre-fix
  `retry-waste.test.ts` fixture from `8d2df52^` and applying the *same* source mutation
  (`fetched: new Set<string>()`) leaves *"a RESUMED writer still ranks the pages it paid for first (R7-31
  F9)"* **green** — the "0 for this test before" is exactly right. And the pre-fix `rate-limit-copy.test.tsx`
  with one forced failure inserted really does take its own control down with it: **2 red**, vs **1 red**
  at HEAD.
- **A stalled loop with its allowance spent reports `budget` and closes `stopped`.**
  `gather.ts:610 if (stop === 'stalled' && turnsUsed >= maxTurns) stop = 'budget';` and `:618` fires the
  note with kind `stopped` for `done || budget`. `agents.md`'s corrected sentence matches the code.
- **A fill passes neither gate 3 (+40 expansion) nor gate 4 (similarity ≥ 0.55).** The fill path
  (`enrich.ts:526-545`, the `basics` loop) never touches `maxLengthFor` or `similarity` — those live only
  in `acceptCorrections` (`:218-219`), which `continue`s on an empty `from` and so can never see a fill.
  Every one of `request-review.md`'s four new fill bullets holds: empty-field check (`:529`), `verbatim`
  + `quoteNames` (`:533-536`), raw-value `maxLength` then `sanitizeProposal` (`:539-541`), `paramsSchema`
  re-validation (`:542`). "It then reaches the buyer UNTICKED, always" is pinned in the SPA:
  `NewReport.tsx:185 out['basic:' + f] = false`.
- **P-3's four hashes are the right ones, in the right order, all on `main`:** `16e7014`(37) → `2bf0b97`(35)
  → `c0805a7`(34) → `3397da8`(32), positions counted back from `main`'s tip; `3397da8` is indeed
  *"feat(spa): one section, two ways — the box or the fields, never both"*, the title of the entry.
  `a84878d` (R7-12, the `touchedByAgent` fix) and `e3e8e3b` (R7-27's docs pass) are both real and both
  ancestors.
- **The re-measured P2 span 1035 → 1062 is right to the commit** (see the audit table for the four
  measurements).
- **`93b132e`'s cached-note figure is 296, not 298** — measured, see the audit table.
- **`929e8dd`'s "2 red" is 3** — measured at `929e8dd` against its own baseline, see the audit table.
- **The honest 6-turn maximum belongs to `d-legit`** — measured; only the `b-legit` parenthetical is wrong
  (F6).
- **`79fa632`'s own pinned claim**, "removing `instructions` from `RETIRED_PARAMS` measures 2 red" — 2 red,
  both in *"a request from a bundle older than the deploy"*.
- **`79fa632` changes no behaviour.** Its only non-doc file is `packages/core/src/index.ts` and the diff is
  entirely inside one block comment.
- **R8-25's mechanism is verifiable from the code as it stands** — see the next section.
- **"A request with no directives reads exactly as it did"** — `planDirectives` returns `''` when the spec,
  the set or the parts are empty, and the moderation test pins the two renderings equal.
- **`AgentTrace.kind` reaches the screen through both hops** — the core write (`run-job.ts:523`) and the
  admin cell (`JobDetail.tsx:50-57`) each measure 1 red alone, so neither half is unpinned.
- **The `kind?: string` addition is backwards-safe**: optional on both `JobSummary.agents[]`
  (`jobs/types.ts:200`) and the admin's `JobAgentSummary` (`api/types.ts:145`), and the cell falls back to
  `—` when absent, so a summary written before the field renders as it always did.

### On R8-25's "No mutation reds it alone" — verifiable in part, unfalsifiable as stated

The universal quantifier ("*no* mutation") is not checkable — it ranges over every possible edit. The three
checkable parts are:

1. *"Its stated mutation, drop `setDirOpen(true)` from `editDir`, named a call that no longer exists."*
   **TRUE**: `git grep setDirOpen|dirExpanded` over `apps/fbizlab` at `a37d5f5` returns exactly one hit —
   the new comment recording the deletion. Nothing in `src/` has either name.
2. *"at HEAD `editDir` only clears the `fromNotes` tag while visibility hangs on `picking` — so clearing a
   chip cannot close anything."* **TRUE by inspection**: `editDir` (`NewReport.tsx:448-456`) calls
   `setDir` and prunes `fromNotes`, and nothing else; `picking = assistOff ? !notesOpen : way === 'pick'`
   (`:440`) reads neither `dirVals` nor anything `editDir` writes.
3. *"the two that touch it red it at its FIRST line, because the fields are not on screen at all."*
   **Checkable, and I checked it** by restoring the deleted test from `8d2df52^` and running the two named
   mutations. Restored and unmutated it **passes** (0 red in `new-report.test.tsx`) — so a green test was
   deleted, not a broken one. With `setWay('pick')` dropped from the keep-proposals branch it fails with
   `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name
   "Sunshine"`, alongside 6 others; with `way` initialised to `'pick'` it fails the same way, alongside 29
   others. So "reds it at its first line" is right in substance — though strictly it dies on its *third*
   statement, the first one that touches a chip; the two lines above it (`toProposals`, click "back") run
   fine.

Verdict on the claim: the *supporting* facts are all true and the deletion is defensible (the test asserts
nothing the neighbours do not), but "No mutation reds it alone" is an unfalsifiable form of words and should
have been written as what was actually measured — "the two mutations that reach it kill it in setup".

## Commit-message audit (verifiers only): every count I re-ran, claimed vs observed

Every row below is a full `npm test` from the worktree root at `a37d5f5` unless the row says otherwise;
red counted, not passed. `git status` clean between rows (asserted at the end of each runner script).

### `4ba3bd4`

| # | mutation | claimed | observed | verdict |
|---|---|---|---|---|
| 1 | plan summary drops the directive clause (`deterministic.ts:102` → the bare `describePlan().trim()`) | 1 red | **1** — *"states the preferences that steer the shortlist … (R8-36)"* | ✅ |
| 2 | shrink warning loses its timestamp (`research-engine.ts:740`) | 1 red | **1** — *"…and the note reaches a screen: it is a WARNING…"* | ✅ |
| 3 | summary row drops `kind` (`run-job.ts:528`) | 1 red | **1** — *"carries what each agent's loop did into the summary the admin page reads"* | ✅ |
| 4 | Research cell ignores `kind` (`JobDetail.tsx:54-56`) | 1 red | **1**, in the ADMIN suite — *"says WHY an agent has no turns — it is a writer (R8-27)"*; core/api/worker/fbizlab all green above it, which is the cross-package hop the message claims | ✅ |
| 5 | `snapshot()` aliases its arrays again (`research-engine.ts:555-563`) | **0 red**, disclosed | **0** — full suite green | ✅ (see F2 for what the sentence beside it over-claims) |
| 6 | suite total | 1115 = 714+215+22+158+6, main checkout; clean clone 6 fewer | **1115** with `out/` symlinked (714+215+22+158+6); **1109** without | ✅ |

### `8d2df52`

| # | mutation | claimed | observed | verdict |
|---|---|---|---|---|
| 7 | resumed `fetched` seed emptied (`research-engine.ts:676`) | 4 red | **4** — the R7-31 F9 test plus three R8-3 ones | ✅ |
| 8 | …the same mutation against the **pre-fix fixture** (`retry-waste.test.ts` restored from `8d2df52^`) | "0 for this test before" | **0 for that test** — *"a RESUMED writer still ranks the pages it paid for first (R7-31 F9)"* stays GREEN; 3 red total, all from the R8-3 neighbours | ✅ (control: pre-fix fixture unmutated = 0 red) |
| 9 | resumed `touched` seed emptied (`research-engine.ts:675`) | 2 red | **2** — R7-31 F9 and R7-12 | ✅ |
| 10 | one kind loses its `es` line (`progress-copy.ts`, `researching`) | 1 red, in `progress-copy` and NOT the pin | **1** — *"progressLine > every kind has a line in every language, and no language borrows English"*; `progress-kind-pin` green | ✅ |
| 11 | unrelated forced failure above the config restore, at HEAD | 1 red | **1** — only the mutated test | ✅ |
| 12 | …the same insertion into the **pre-fix** `rate-limit-copy.test.tsx` (`8d2df52^`) | "was 2 — the cascade" | **2** — the mutated test **and** *"control: the configured build still offers the Google button"* | ✅ |
| 13 | suite total | 1106 = 708+215+22+156+5, main checkout | **1106** measured at `8d2df52` with `out/` symlinked (708+215+22+156+5), 0 failed | ✅ |
| 14 | "`929e8dd`'s '2 red' is 3" | 3 | **3** — see row 18 | ✅ |
| 15 | "the honest 6-turn maximum belongs to `d-legit`, not `b-legit` (296 cached notes, not 298)" | — | the 296/298 figure is `93b132e`'s cached-note count, not a turn maximum — two corrections welded into one sentence | ❌ F7 |

### `79fa632`

| # | claim | claimed | observed | verdict |
|---|---|---|---|---|
| 16 | removing `instructions` from `RETIRED_PARAMS` | 2 red | **2** — both in *"a request from a bundle older than the deploy"* | ✅ |
| 17 | P2 span, re-measured | 1035 → 1062 | `3397da8` (parent of the first P2 commit `1ce4893`) = **1035** (659+214+22+136+4); `b72de29` (last of the six listed) = **1062** (678+215+22+143+4). Also: `1ce4893` = 1043, `e3e8e3b` = 1068, `a84878d` = 1071. All with `out/` symlinked | ✅ |
| 18 | "1029 belongs to `16e7014`" | 1029 | **1029** (659+214+22+130+4) | ✅ |
| 19 | "…four commits before the first P2 commit" | four | **six** by `git log` (`050e0b9`, `2bf0b97`, `c0805a7`, `40e848c`, `3397da8` sit between `16e7014` and `1ce4893`); four only if the two docs commits are not counted | ⚠️ imprecise, not a defect |
| 20 | "`929e8dd`'s '2 red' is 3" | 3 | **3**, measured **at `929e8dd`**: fbizlab baseline 5 red (the gitignored-env failures `60c92a0` later fixed), mutated 8 — the three added are exactly `929e8dd`'s own tests. At `a37d5f5` the same mutation is **4**, because `c5c037e` added a fourth test (R8-10) that covers it | ✅ (state the checkout) |
| 21 | "`93b132e`'s cached-note figure is 296, not 298" | 296 | **296** — restoring the per-call note in the cached branch and dropping the per-turn block, `b-attack` prints `R7-29 stored notes: 300 (cached: 296); progress lines: 410`. The other two figures in the same line of `93b132e` (300 notes, 410 progress writes) are right | ✅ |
| 22 | "the honest 6-turn maximum belongs to `d-legit`" | d-legit | **d-legit reaches 6** (its budget-10 re-plan-every-step agent) | ✅ |
| 23 | "…not `b-legit`, which reaches 4" | 4 | **`b-legit` reaches 5** (its cross-checker: 4 with four re-reads, 5 with five) | ❌ F6 |
| 24 | P-3's chain `16e7014 → 2bf0b97 → c0805a7 → 3397da8` | all on main, that order | ✅ positions 37/35/34/32 back from `main`'s tip, i.e. correct chronological order, all ancestors | ✅ |
| 25 | `a84878d` = R7-12, `e3e8e3b` = R7-27 | both on main | ✅ both resolve; `a84878d` is the `touchedByAgent` fix the R7-12 entry describes, `e3e8e3b` the round-7 docs pass | ✅ |
| 26 | suite total | 1115, unchanged | **1115** with `out/` symlinked at `a37d5f5` (docs-only above `79fa632`), 0 failed | ✅ |
| 27 | "a loop that spent its allowance and then stalled is reclassified `budget` and closes `stopped`" | — | ✅ `gather.ts:610` and `:618` | ✅ |
| 28 | "`agents.md`'s checkpoint field list … now names both" | complete | names both, but the list is **still missing `turnsUsed`** (in the type since `7d2e7b8`, written by `snapshot()`, read on resume) | ❌ F4 |
| 29 | "a fill passes neither gate 3 (+40 expansion) nor gate 4 (similarity ≥ 0.55)" | — | ✅ neither is reachable from the `basics` path | ✅ |
| 30 | "the rate meter reads Firestore before `validateRequest`" | — | the conclusion (ADC required) holds; the first Firestore read is `getApp` in the `APP_ENV=local` auth hook, before the handler | ❌ F3 |
| 31 | "the worker re-validates through `paramsSchema` rather than through this function" | — | no `paramsSchema` reference exists in `apps/worker/src` or in the engine; the worker passes `job.params` through unvalidated | ❌ F5 |
| 32 | "the admin's new-job modal builds params from the schema defaults" and "an admin retry of an old job is unaffected" | — | ✅ `NewJobModal.tsx:25 setParams(defaultsFor(schema))`; `POST /admin/jobs/:jobId/retry` re-dispatches the stored job and never calls `validateRequest` | ✅ |
