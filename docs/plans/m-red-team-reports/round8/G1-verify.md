# G1-verify — ENGINE + research loop / VERIFIER

Measured at `4b612426ebb97f9dd38f1561c047413ffd07390c` (`git rev-parse HEAD` in my worktree
`/Users/javier/Documents/src.nosync/personal/agent-researcher/.claude/worktrees/agent-a8b4582776db9f569`,
no checkout needed). `npm ci` was required — `node_modules` did not resolve. Baseline `npm test`:
**1065 passed / 12+6 skipped / 0 failed**, six short of the brief's 1071 because a worktree has no
`out/` (six red-team tests are gated on `out/*/trace.json`). I symlinked the repo's `out/` into the
worktree; baseline then reads **1071 passed, 0 failed**, exactly the brief's number, and every count
below is against that. The symlink is untracked and removed; `git diff` is clean and nothing is
committed.

## Verdict

Twenty-five of the twenty-six mutation counts these five commits claim are **exactly right** — I
re-ran every one, alone, with a full `npm test` after each. The end-to-end figures are right to the
character (54 LLM calls / 838,702 prompt chars → 13 / 53,674, reproduced by setting
`NO_PROGRESS_TURNS_LIMIT = 9999` and by the shipped code). The breaker (`93b132e`) and the
`reconstructed` state (`c9065e3`) hold in production, including their migration edges. But three of
the four "a field now reaches the right place" commits ship something that is not what the message
says: `90d6fdf`'s page-cap rewrite **bypasses the 60-page cap entirely** the moment gathered agents
own 60 or more pages, and inverts its own preference (foreign pages kept in full, the agent's own
oldest dropped); `6780c94`'s admin table **deleted the `Tries` cell while adding a `Research`
header**, so every value after Duration renders one column to the left and the retry count is gone
from the screen — the exact "a field the engine writes that no admin page can read" class that commit
exists to close; and `90d6fdf`'s fourth mutation count ("a resumed writer forgets its own pages — 1
red") is **0 red**, because the test it names cannot tell `fetched` from `touched`. `R7-13`'s fix
also seeds the job turn counter from `cost.searchCalls`, which counts *billed backend calls*, so a
turn that reached no backend is still forgotten on resume and the per-agent rows still do not sum.

## Findings (most severe first)

### F1 · a resumed job's `checkpoint.json` carries every page it ever fetched — the 60-page cap stops applying — P1

- where: `packages/core/src/engine/research-engine.ts:520` (in `carry()`, added by `90d6fdf`)

  ```ts
  const keep = new Set([...mine.slice(-CHECKPOINT_MAX_PAGES), ...rest.slice(-Math.max(0, CHECKPOINT_MAX_PAGES - mine.length))]);
  ```

  When `mine.length >= CHECKPOINT_MAX_PAGES` the second term is `rest.slice(-0)`. `-0` is `0`, so
  `slice(-0)` is `slice(0)` — **the whole array**, not none of it.

- input / observed: `runResearch` resumed with 100 extracted pages, `gatheredAgentIds: ['scout']`,
  `fetchedByAgent: { scout: <first 60 urls> }` → `checkpoint.extracted.length === 100` (cap is 60).
  Control at 59 owned pages → 60, correct. At 70 owned of 100:
  `total=90 own=60/70 foreign=30/30 gathered=[]` — i.e. the cap is blown (90 > 60) **and** all 30
  foreign pages are kept while ten of the agent's own oldest are dropped, so it also loses `gathered`
  and re-buys them. That is the precise inverse of the rule the commit states ("Its pages are kept
  ahead of everyone else's now, and if they still do not fit it loses `gathered`").

- status: **reproduced**. Scratch test (portable as-is into
  `packages/core/test/retry-waste.test.ts`, alongside the R7-11 block; it uses that file's existing
  `installMockProvider` / `compactModel` / `params()` and web-search mock):

  ```ts
  it('carries at most 60 pages when a gathered agent owns 60 of 100', async () => {
    const pages = Array.from({ length: 100 }, (_, i) => ({ url: `https://x/${i}`, ok: true, content: `PAGE-${i}` }));
    installMockProvider();
    const out = await runResearch({
      template: compactModel, params: params(), jobId: 'cap60', generatedAt: 't',
      resume: {
        report: {}, sources: [], extracted: pages, doneAgentIds: [], degraded: [],
        gatheredAgentIds: ['scout'],
        fetchedByAgent: { scout: pages.slice(0, 60).map((p) => p.url) },
      } as never,
    });
    expect((out.checkpoint.extracted ?? []).length).toBeLessThanOrEqual(60); // observed: 100
  });
  ```

  `node -e "console.log([1,2,3,4,5].slice(-Math.max(0,3-3)))"` prints `[1,2,3,4,5]`.

- refutation attempted: (a) is `mine.length >= 60` reachable? `owned` is the **union over all
  gathered agents**, not one agent, and `d-legit § 6`'s own honest comprehensive figure is 92 turns
  across 10 producers with a real bound of "60 pages × 6k" — so a Florida comprehensive job that
  re-dispatches after most producers are `gathered` is squarely in this branch, not an edge. (b) Is
  the existing test supposed to catch it? `retry-waste.test.ts`'s "its own pages survive the
  checkpoint cap" does assert `toBeLessThanOrEqual(60)`, but its fixture uses **10** owned pages, so
  the branch never runs; its sibling uses **80 owned of 80**, where `rest` is empty and `slice(-0)`
  returns nothing. Both fixtures sit exactly outside the only region where the bug exists — the same
  shape as the 48-items/`max = 48` case `a84878d` itself calls out. (c) `checkpoint.json` is written
  to GCS, so nothing hard-fails; the cost is store size and the re-seeded `evidence.extracted` on
  every one of up to 8 dispatches.

- fix sketch: `const room = Math.max(0, CHECKPOINT_MAX_PAGES - mine.length); const keep = new Set([...mine.slice(-CHECKPOINT_MAX_PAGES), ...(room ? rest.slice(-room) : [])]);`
  What an honest run loses if done naively: nothing — but note the second half of the observation
  stands on its own. Once `mine.length > 60` the current code drops the agent's *own* oldest pages
  first while keeping *foreign* ones, so the fix should also decide deliberately which gathered agent
  gives up `gathered` rather than letting store order decide it.

### F2 · the admin agents table lost a cell: `Tries` shows the loop, `Research` shows the cost, `Cost` is blank, and the retry count is gone — P1

- where: `apps/admin/src/pages/JobDetail.tsx:402` (`<Table.Th>Research</Table.Th>` added) vs
  `:415-419` — `6780c94` **replaced** the `Tries` `<Table.Td>` with the `Research` one instead of
  adding it. Header row: 7 `<Th>`; body row: 6 `<Td>`.

- input / observed: rendering `JobDetail` with
  `summary.agents = [{ id: 'deal-scout', wave: 1, status: 'ok', durationMs: 1000, attempts: 4, costUsd: 0.38, turnsUsed: 21, gatherStop: 'budget' }]`:

  ```
  HEADERS ["Agent","Wave","Status","Duration","Tries","Research","Cost"]
  CELLS   ["deal-scout…","1","ok","1.0s","21 turnsbudget","$0.38"]
  ```

  So an admin reads `21 turns · budget` under **Tries**, `$0.38` under **Research**, nothing under
  **Cost**, and `attempts: 4` is rendered nowhere. On a job that was re-dispatched four times, the
  retry count — the first thing a hold decision looks at — silently vanished.

- status: **reproduced**. Scratch test (portable into `apps/admin/test/job-detail-sections.test.tsx`,
  which already has the `state.agents` mock this needs):

  ```ts
  const table = document.querySelectorAll('table')[0]!;
  const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
  const cells = [...table.querySelector('tbody tr')!.querySelectorAll('td')].map((td) => td.textContent);
  expect(cells.length, 'a body row must have one cell per header').toBe(headers.length); // observed 6 vs 7
  expect(cells[headers.indexOf('Tries')], 'the Tries column shows the attempt count').toBe('4');
  ```

- refutation attempted: I checked whether Mantine's `<Table>` reflows a short row — it does not; the
  DOM is what is above and the browser left-aligns the remaining cells under the earlier headers. I
  also checked whether the commit's own test could see it: it asserts only
  `screen.getByText('21 turns')` / `'budget'` / `'0 turns'` / `'stalled'` / `'—'`, i.e. presence, never
  placement and never `attempts` — so the test is green on a broken table. That is "assert the
  content, not the shape" failing in its mirror form: content asserted, position not.

- fix sketch: restore the `Tries` cell before the Research cell —
  `<Table.Td ta="right"><Mono size="sm" c={a.attempts > 1 ? 'yellow' : undefined}>{a.attempts}</Mono></Table.Td>` —
  and add the `cells.length === headers.length` assertion above so a future column cannot do this
  again. Nothing honest is lost.

### F3 · `90d6fdf`'s "a resumed writer forgets its own pages 1 red" is 0 red — the test cannot tell `fetched` from `touched` — P2

- where: `packages/core/src/engine/research-engine.ts:650`; test
  `packages/core/test/retry-waste.test.ts` — "a RESUMED writer still ranks the pages it paid for
  first (R7-31 F9)", whose comment names the mutation: *"Mutation that reds this: seed `fetched` with
  an empty set again."*

- input / observed: `fetched: new Set<string>()` alone → full `npm test` = **1071 passed, 0 failed**.
  Emptying **both** seeds (`touched` and `fetched`) → 2 red. The test asserts only that the URL lands
  at `[P1]`; `rankEvidence` (`packages/core/src/engine/prompt.ts:259-262`) takes the `touched` tier
  immediately after `fetched`, and `touched` is seeded from the same `fetchedByAgent` map — so the
  page is first either way.

- status: **reproduced** (0 red at HEAD). That the same was true at `90d6fdf` itself is **reasoned**:
  that commit introduced both the test and `touched: new Set<string>(fetchedByAgent[agent.id] ?? [])`
  in the same diff, so the fallback existed when the count was recorded.

- refutation attempted: I checked whether `MAX_PAGES` or the per-host cap could separate the tiers in
  that fixture — all 20 pages share one host and the fixture is below the cap, so no. The claim the
  test *does* prove (a resumed writer's own evidence beats store order) is real; only the named
  mutation is dead.

- fix sketch: give the tiers different observable consequences — put ≥ `MAX_PAGES` preferred URLs in
  `touchedByAgent` and one in `fetchedByAgent`, and assert the `fetched` one is `[P1]` while a
  `touched` one is not. Cheap, and it makes both named mutations bite.

### F4 · the resumed turn counter is seeded from BILLED calls, so the per-agent rows still do not sum — P2

- where: `packages/core/src/engine/research-engine.ts:437` —
  `const counter = { turns: input.resume?.cost?.searchCalls ?? 0 };`

  `turnsUsed` increments on every `web_search`/`fetch_page` that gets past the guards
  (`gather.ts:469`, `:542`), but the charge that raises `searchCalls` is conditional:
  `if (url && canExtractPages()) charge(...)` (`gather.ts:544`). A `fetch_page` with an empty/missing
  `url`, or **any** `fetch_page` in a deployment without `TAVILY_API_KEY` (documented as optional —
  `docs/deployment.md:223`, `infra/deploy.sh:36`), spends a turn and books no call.

- input / observed: a scout that emits `fetch_page` with `args: {}` on its first two loop turns, then
  behaves:

  ```
  DISPATCH1 turnsUsed=4 searchCalls=2 agentTurns=2+2+0
  DISPATCH2 job turnsUsed=6 sum(agent rows)=8 searchCalls=6
  ```

  On dispatch 2 the job reports 6 turns while the per-agent rows an admin reads sum to 8 — which is
  verbatim the symptom R7-13 and this commit set out to remove ("the admin's per-agent rows stopped
  summing to the 'Search turns' figure above them").

- status: **reproduced** (scratch test in `packages/core/test`, `MockLlmProvider` subclass returning
  `{ name: 'fetch_page', args: {} }` for the first two loop turns; `redTeamModel`, fake-web mock).

- refutation attempted: the shipped pin
  (`refute-small.test.ts` — "a RESUMED dispatch keeps counting where the job left off") asserts
  `second.turnsUsed === second.trace.cost.searchCalls`. That is the *proxy* the code uses, not the
  property the message claims, so it is green in exactly this case. I also checked whether the mock
  tier hides it: no — `canExtractPages` is mocked `true` in `retry-waste.test.ts`, and the divergence
  above happens with it true, purely from the `url &&` guard.

- fix sketch: carry the count itself — add `turnsUsed?: number` to `Checkpoint` (written from
  `counter.turns`, absent on old checkpoints, falling back to `cost.searchCalls` exactly as today) —
  and change the pin to `second.turnsUsed === sum(second.trace.agents.map(a => a.turnsUsed))`, which
  is the sentence the message makes. Naive alternative to avoid: counting the unbilled fetch as a
  search call, which would invent spend the repo deliberately refuses to invent (`gather.ts:540`).

### F5 · a browser holding the pre-`c9065e3` fbizlab bundle SUPPRESSES a `reconstructed` section and tells the buyer everything else was researched as usual — P2

- where: `apps/fbizlab/src/lib/section-status.ts:22` (`KNOWN`), consumed by
  `apps/fbizlab/src/components/ReportViewer.tsx:466` — an unknown status coerces to `lost`, and
  `lost` is the one status whose **body is suppressed** and replaced with
  *"We could not complete this section for this report. Everything else below was researched and
  written as usual."*

- input / observed: this is exactly mutation M19 below (`fbizlab KNOWN` without `reconstructed`),
  which reds three tests, two of them **"renders the body"** and **"does not claim the section was
  researched"**. That mutation *is* the old bundle. So for the window in which a cached bundle is
  live: the buyer's on-screen dossier hides a section that has real content, under a sentence that is
  false, while the PDF of the same report — rendered server-side by current code — shows the section
  plus its honest `reconstructedSection` line. Two artefacts of one purchase disagree.

- status: **reproduced** (via the M19 mutation, which is byte-equivalent to the old bundle's `KNOWN`).

- refutation attempted: (1) the admin SPA is safe — `JobDetail.tsx:374-378` renders the raw status
  with `?? 'unknown status — read the engine trace'`, never coercing. (2) The core/PDF/email path is
  safe — always current code. (3) `929e8dd` "a stale bundle is told to reload" is triggered by a
  `validateRequest` 400 on the *submit* path, not by the report viewer, so it does not cover this. (4)
  The opposite direction — today's reader on a document written before — is genuinely safe and
  tested (`LEGACY_SHAPES`, both copies). So the defect is one-directional and time-bounded, which is
  why it is P2 and not higher.

- fix sketch: nothing to change in the writer; what is wrong is the commit's stated reasoning, that
  coercing to `lost` "is the safe direction". For `lost` it is; for `reconstructed`, whose entire
  design point (stated three times in the same commit) is *the body stays*, `unenriched` would lose
  less — or the coercion could keep the body and drop only the label. If this is left as is, the
  reasoning in `section-status.ts` should say so honestly rather than claim safety.

### F6 · two figures in `93b132e`'s message do not reproduce — P2

- **the honest persona.** The message says the general bound of 8 is calibrated because "the most
  free-and-useless turns in a row an honest persona reaches is 6 — **`b-legit`'s cross-checker** that
  re-reads ONE listing five times". I instrumented `noProgressTurns` and measured the maximum run per
  file: **`b-legit` reaches 4**, `a-legit` 1, `c-legit` 1, **`d-legit` reaches 6** — and the run of 6
  belongs to `d-legit § 3`, *"a diligent agent on budget 10 that re-plans every step and re-opens 6
  cached listings ends STALLED at 26 iterations"*. The **number 6 is right**; the persona named is
  not. Confirmed independently by bisecting the limit: at 7 no honest test reds, at 6 no honest test
  reds either (the run of 6 is the loop's last six iterations, so cutting there costs nothing), at 5
  the `d-legit` test reds, at 4 the `b-legit` one reds too. So the real honest margin is larger than
  the message implies — but the message's own supporting claim ("a limit of 4 cut it mid-loop … it
  showed up as a red test") **is true**: at 4 the two honest tests go red.
- **the note flood.** "300 notes / 298 cached / 410 progress writes → 8 / 2 / 12". Measured with
  `93b132e^`'s `gather.ts` restored: **300 notes / 296 cached / 410 progress**. After: 8 / 2 / 12,
  exact. `298` should be `296`.
- status: **reproduced** both.
- fix sketch: correct the two lines in `docs/plans/deep-review.md`'s round-8 entry (the commit is
  already on `main`).

## Claims checked and TRUE (so nobody re-checks)

- **The end-to-end cost figure is exact.** `b-attack` F5 logs `13 / 53,674` at HEAD; setting
  `NO_PROGRESS_TURNS_LIMIT = 9999` (the revert the test's own comment names) logs
  `54 / 838,702`, first request 1,387 chars, last 30,607 — i.e. the claimed 22× before and 5× after.
- **The note flood after the fix** is 8 notes / 2 cached / 12 progress writes, as claimed.
- **`refute-B2` deal-scout: 54 → 52 iterations, `turns: 24`, `stop: 'budget'`, reusable.** Verified
  in the shipped test and by `gather.ts:591` (`stalled` + `turnsUsed >= maxTurns` → `budget`).
- **The `(Pc)*` bound of 12 iterations is reachable, not decorative** — the `Pc`-alternating fixture
  runs 27 pairs and stops at call 12, and the honest `PcPcPFP` counter-example still runs all 8 and
  ends `done` with 1 paid turn. Both bite: they red under two different mutations (M2/M3).
- **`a-legit`'s "the note reaches a screen" test is real.** It drives two genuine dispatches, the
  first ending `incomplete`, seeds nothing, and separately asserts that
  `checkpoint.agentTraces[refiner].notes` is `[]` (i.e. that `slimAgents()` really does blank the
  note the warning replaces). All four `warnings` mutations red it, individually.
- **`warnings` is admin-only in production.** `apps/api/src/index.ts:1552-1558` — a non-admin gets
  `{ notice?, sections? }` only. And `warnings` does not feed `meta.sections`, so an honest dedup does
  not tell a buyer their dossier is incomplete: `section-status.test.ts` asserts
  `second.meta.sections === []` on the delivering dispatch.
- **"A 24-turn loop is shown ~192 results"** — both backends request 8 results per search
  (`web-search.ts:66` Brave `count=8`, `:85` Tavily `max_results: 8`), so 24 × 8 = 192. `MAX_SEEN_PER_AGENT = 300`
  is therefore a real per-agent bound (reached only across dispatches), not an unreachable one.
- **`Checkpoint` is `JSON.parse(raw) as Checkpoint`** (`run-job.ts:173`) — no schema, no strict
  key rejection. So for `warnings`, `fetchedByAgent` and `touchedByAgent`, both directions are
  structurally safe: an OLD reader silently ignores the new keys (it loses the record, which is the
  pre-fix behaviour, not a wrong one), and TODAY's reader on an OLD document takes `?? []` / `?? {}`.
  The "resumes exactly as it did" claim is real and pinned by *"a checkpoint from before the field
  resumes exactly as it did — newest pages, no preference"*, which asserts both the ≤ 60 cap and that
  the oldest page is gone.
- **`AgentTrace.kind` is write-only today.** Set at `research-engine.ts:584`, optional at `:116`,
  read by nothing in `run-job.ts`, the API or either SPA. Safe in both directions; nothing to migrate.
- **`meta.sections` → today's reader on old data** is fine: `normalizeSectionStatuses` reads
  `meta.sections` then legacy `degradedSections`, an unknown status coerces to `lost`, and the shared
  `LEGACY_SHAPES` fixture is exercised by both the core and the fbizlab parity suites. (The *other*
  direction is F5.)
- **The `reconstructed` tests bite for the stated reason, including the naive fix.** I ran the
  unnamed control mutation — dropping `&& !rebuilt.has(key)` from the `lost` filter, i.e. the "just
  mark it lost" fix the commit argues against — and it reds 3, among them *"keeps the body: the
  enricher may have built it from real upstream sections"*. That test is not decorative.
- **`evidence-ranking`'s replacement for the 48-items/`max = 48` test does bite.** 190 items against
  `max = 48`, `perDomain = 8`: the majority host takes 8 in the diversity pass + 24 from the deferred
  pass = 32, inside the asserted `> 20 && < 45`. The bound is reachable in both directions.
- **`retry-waste`'s "records what a loop was SHOWN"** does NOT seed `touchedByAgent` in its resume —
  it runs a fresh dispatch and reads the checkpoint, so it proves the write, which is what the
  commit's own "measured 0 red at first" note says it fixed. Confirmed: mutation M12 reds it.
- **Test-count deltas match.** `c9065e3` "+12" = 10 added `it(` + 1 `LEGACY_SHAPES` case consumed by
  `it.each` in two suites. `93b132e` +2, `90d6fdf` +5, `a84878d` +3, `6780c94` +3 all match their
  files. Final suite total is 1071.

## Commit-message audit (verifiers only): every count re-run, claimed vs observed

Each mutation applied alone to a clean tree, full `npm test` after each, tree reverted between.

### `93b132e` — the free-branch breaker

| mutation (as the message names it) | claimed | observed | tests that went red |
|---|---|---|---|
| breaker looks at plan-only turns again (the dodge) — `noProgress` = `every(c => c.name === 'update_plan')` | 3 red | **3 red** ✓ | b-attack F5; refute-B2 `(Pc)*`; refute-B2 deal-scout |
| `NO_PROGRESS_TURNS_LIMIT` past the bound — `= 9` | 3 red | **3 red** ✓ | same three |
| a stubbed cached read counts as progress — cached branch of `buysNothing` → `false` | 2 red | **2 red** ✓ | b-attack F5; refute-B2 `(Pc)*` |
| a refused call counts as progress — `web_search`/over-budget `fetch_page` → `false` | 1 red | **1 red** ✓ | refute-B2 deal-scout |
| note per cached call again (the flood) — `await note(...)` back inside the loop | 1 red | **1 red** ✓ | b-attack F2 (400 cached re-reads) |
| plan breaker removed (`f013cfe`'s) — drop the `planOnlyTurns >= PLAN_TURNS_LIMIT` block | 1 red | **1 red** ✓ | refute-B2 "the two real plan-loops" |

Extra bisection (not claimed, run to check the calibration): limit `7` → 4 red, none honest; `6` → 5
red, none honest; `5` → 6 red incl. `d-legit § 3`; `4` → 7 red incl. `b-legit § 1` **and**
`d-legit § 3`. Instrumented maxima: `b-legit` 4, `a-legit` 1, `c-legit` 1, `d-legit` **6**. See F6.

Measured figures: `13 / 53,674` ✓ and `54 / 838,702` ✓ (both to the character);
`8 / 2 / 12` after ✓; `300 / 298 / 410` before → **`300 / 296 / 410`** (see F6).

### `90d6fdf` — a finished loop's evidence + the turn counter

| mutation | claimed | observed | tests that went red |
|---|---|---|---|
| newest pages win again — `keep = new Set(evidence.extracted.slice(-CHECKPOINT_MAX_PAGES))` | 1 red | **1 red** ✓ | "its own pages survive the checkpoint cap" |
| an agent stays gathered with pages dropped — `gatheredIds = [...gathered]` | 1 red | **1 red** ✓ | "when they cannot all be kept, it loses `gathered`" |
| the turn counter restarts each dispatch — `const counter = { turns: 0 }` | 1 red | **1 red** ✓ | refute-small D2 "a RESUMED dispatch keeps counting" |
| **a resumed writer forgets its own pages** — `fetched: new Set<string>()` | 1 red | **0 red** ✗ | — (see F3; both seeds emptied → 2 red) |

`Suite 1056 → 1061` = +5 tests, matches the diff.

### `a84878d` — `touchedByAgent`

| mutation | claimed | observed | tests that went red |
|---|---|---|---|
| a resumed loop forgets what it was shown — `touched` seeded from `fetchedByAgent` alone | 1 red | **1 red** ✓ | "a RESUMED writer keeps the SNIPPETS its loop was shown" |
| nothing is recorded as seen — drop the `touchedByAgent[...] = …` write | 1 red | **1 red** ✓ | "records what a loop was SHOWN" |

`Suite 1068 → 1071` ✓ (+3, and 1071 is what I measure at HEAD).

### `c9065e3` — `reconstructed`

| mutation | claimed | observed | tests that went red |
|---|---|---|---|
| `delivered` from `ownedKeys` again (the bug) | 2 red | **2 red** ✓ | "is not labelled unenriched"; "tells the admin which agent never delivered it" |
| label it `unenriched` | 1 red | **1 red** ✓ | "is not labelled unenriched" |
| drop the notice sentence | 2 red | **2 red** ✓ | both "the notice for a reconstructed section" tests |
| drop the PDF per-section line | 1 red | **1 red** ✓ | "a reconstructed section in the PDF" |
| core `KNOWN` without `reconstructed` | 2 red | **2 red** ✓ | PDF test; `LEGACY_SHAPES` "reconstructed passes through" |
| drop the viewer line | 1 red | **1 red** ✓ | fbizlab "does not claim the section was researched" |
| fbizlab `KNOWN` without `reconstructed` | 3 red | **3 red** ✓ | fbizlab ×2 + the parity `LEGACY_SHAPES` case |
| admin reuses the `shallow` row | 1 red | **1 red** ✓ | admin "does not call a rebuilt section a shallow one" |

Also verified the message's self-correction: the PDF assertion now matches
`/researches this section did not finish/`, text unique to the per-section line, and it does red.
Unclaimed control run: the naive `lost` fix reds 3, including "keeps the body".

### `6780c94` — `warnings` + `turnsUsed`/`gatherStop` on the summary

| mutation | claimed | observed | tests that went red |
|---|---|---|---|
| shrink line is a note only (no warning) | 1 red | **1 red** ✓ | a-legit "and the note reaches a screen" |
| warnings do not ride the checkpoint | 1 red | **1 red** ✓ | same |
| warnings not seeded from resume | 1 red | **1 red** ✓ | same |
| warnings only reach the trace at the end | 1 red | **1 red** ✓ | same |
| summary drops `turnsUsed`/`gatherStop` | 1 red | **1 red** ✓ | run-job "carries what each agent's loop did into the summary" |
| admin table drops the Research column | 1 red | **1 red** ✓ | admin "tells a step that researched nothing from one that did" |

All four `warnings` mutations red the **same single test**. Each is individually caught, so the counts
are honest — but one test is the whole guard for four separate mechanisms, and it is the test that
would have to be extended for F2's kind of regression to be caught (it asserts presence of text, not
column position, and never `attempts`).

**Totals: 26 mutations claimed across the five commits, 26 re-run, 25 exact, 1 wrong (0 red where 1
was claimed). Two "measured" numbers wrong (a persona attribution and `298` vs `296`); every other
measured figure reproduces exactly.**
