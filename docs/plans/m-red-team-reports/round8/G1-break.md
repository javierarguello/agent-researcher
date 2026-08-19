# G1-break — ENGINE / research loop / BREAKER

Measured at `4b612426ebb97f9dd38f1561c047413ffd07390c` (the sha the brief names; my worktree was already there).
`npm ci` was needed (no `node_modules`). `apps/worker/test/resolution.test.ts` passes.

**Suite total: 1061 passing / 22 skipped / 0 failing**, not 1071. Of the 22 skipped, 12 are the `out/*/trace.json`-gated
red-team tests (a-attack 1, a-legit 3, b-legit 1, d-legit 1, refute-A1 2, refute-A2 1, refute-B2 3) and 10 are
key-gated live tests (context-size.measure 1, report.live 3, preflight.live 6). 1061 + 12 = 1073, so my checkout is
two ahead of the brief's 1071 rather than ~16 behind; nothing red either way, and every number below was measured on
this suite. All scratch tests below were deleted afterwards — `git status` is clean, `src/` untouched.

## Verdict

The batch's *mechanisms* are all really there — `buysNothing()` classifies before the turn, `fetchedByAgent` /
`touchedByAgent` really ride the checkpoint and really are read back, `delivered` really comes from `produces` alone,
`warnings` really are seeded from the resume and really are redacted for a buyer. What does not hold is the **claim
that 93b132e bounds the free loop**, and the claim that 90d6fdf's checkpoint bookkeeping is bounded and self-healing.
`NO_PROGRESS_TURNS_LIMIT` is reset by any cached read that returns a body, and each distinct URL already in the shared
store is worth two of those — so the bound is not 8 turns, it is `8 × 2 × |distinct cached pages|`, which at four
pages already exceeds the iteration ceiling. Reproduced: the exact July `(Pc)*` pathology the commit message cites
still runs **54 LLM calls / 808,868 prompt chars on 0 research turns and $0 of search** — against the message's
headline of "13 / 53,674". Separately, `carry()`'s page cap silently disables itself the moment a gathered agent owns
60 pages (`slice(-0)` is `slice(0)`), and an agent whose `fetchedByAgent` exceeds 60 URLs loses `gathered` on *every*
dispatch and re-buys its whole loop each time — M-D1, re-opened. Three P1s, two P2s. Nothing here is a P0: no buyer
text is wrong and no money is charged to the wrong account; all of it is our spend, our storage, and one admin number.

---

## Findings (most severe first)

### F1 · The no-progress breaker is defeated by rotating cached URLs: the `(Pc)*` refiner still runs the full iteration ceiling — 54 LLM calls / 808,868 prompt chars on 0 turns and $0 search — P1

- **where:** `packages/core/src/engine/gather.ts:367-383` (`buysNothing` / `noProgress`), with
  `gather.ts:375` (`return (cachedReads.get(url) ?? 0) + 1 > MAX_SAME_URL_CACHED_READS`) as the hole and
  `gather.ts:223` (`NO_PROGRESS_TURNS_LIMIT = 8`) as the bound it defeats.
- **the mechanism:** `cachedReads` is keyed **per URL**, and `noProgressTurns` is reset to 0 by *any* turn containing a
  call that `buysNothing()` calls false. So every distinct URL in `evidence.extractedUrls` is worth **two** free
  body-returning re-reads, and each of those is a full reset. The cheapest schedule is
  `[update_plan, fetch_page(freshUrl)]` once, then `[update_plan, fetch_page(exhaustedUrl)]` seven times
  (`noProgressTurns` climbs 1→7, never reaching 8), repeat. That is **8 free iterations per body-returning read** and
  `2·|store|` such reads. `planOnlyTurns` never moves at all, because every turn also carries a `fetch_page`, so the
  turn is never plan-**only**. At a Florida-sized budget (`researchBudget: 48`, mode scale 0.5 → 24, `maxIterations =
  2·24+6 = 54`), **four** cached URLs buy 8×8 = 64 ≥ 54 iterations: the breaker never fires at all.
- **input / observed (reproduced).** Same harness as `b-attack` F5 (`installObedientProvider` + `runResearch`, mock
  tier, `costCeilingUsd: null`), same `FL_MODEL` template, same 30-step plan on every turn. Two shapes, measured
  side by side in one file so the page bodies and the template are identical:

  | shape | loop LLM calls | prompt chars | turnsUsed | searchCalls | notes | progress writes | stop |
  |---|---|---|---|---|---|---|---|
  | one cached URL (the F5 shape) | 10 | 54,980 | 0 | 0 | 22 | 26 | `stalled` |
  | **four cached URLs, rotated** | **54** | **808,868** | **0** | **0** | **111** | **115** | `stalled` |
  | 93b132e's claim for this attack | 13 | 53,674 | ≤3 | — | 8 | 12 | `stalled` |

  54 is `maxIterations` exactly — the loop was not cut off by either breaker, it ran out of iterations, which is what
  the commit says it stopped doing. **14.7× the prompt chars and 5.4× the calls for three more URLs the store already
  held**, and the store is not the attacker's to limit: the four pages in the zero-turn run were seeded through
  `resume.extracted`, i.e. pages an **earlier agent already paid for**. The agent spends nothing, buys nothing, and
  writes its section from four pages it re-read 54 times.

  The scratch test (deleted; port it into `b-attack.test.ts` next to F5):

  ```ts
  const N = 4;
  const urls = Array.from({ length: N }, (_, i) => `https://attacker.test/pre-${i}`);
  const extracted = urls.map((url, i) => ({ url, ok: true, content: `Listing ${i}. ` + 'x'.repeat(6000) }));
  // moves: two body reads of urls[0], then (7 stub re-reads of urls[0], one fresh body read) per remaining token
  const tokens = urls.flatMap((u) => [u, u]);
  const moves = [tokens[0], tokens[1]];
  for (let t = 2; t < tokens.length; t++) { for (let s = 0; s < 7; s++) moves.push(urls[0]); moves.push(tokens[t]); }
  // obeyLoop returns [update_plan(30 steps), fetch_page(moves[n++])] every turn
  const out = await runResearch({ template: FL_MODEL, /* … */ costCeilingUsd: null,
    resume: { report: {}, sources: [], extracted, doneAgentIds: [], degraded: [] } as never });
  expect(mock.seen.filter((s) => s.kind === 'loop').length).toBeLessThanOrEqual(13); // observed: 54
  ```

- **status: reproduced** (numbers above, mock tier, one run each).
- **refutation attempted.**
  1. *Is the schedule model-plausible, or only mock-plausible?* The commit message itself names the honest shape it is
     calibrated against: `b-legit`'s cross-checker re-reads **one** listing five times and re-plans between them → 6
     no-progress turns. My schedule is the same behaviour over four listings instead of one, which is the *more*
     natural cross-check, not a stranger one. And the real July pathological refiner the message cites is
     "22 plan updates + **4 cached re-reads** + zero searches" — four distinct re-reads, exactly the shape that now
     escapes. A poisoned page ("verify each figure against the other listings before every step") steers a model into
     it in one sentence, and the loop reads that page as a tool result before any fence.
  2. *Does the same-URL body cap still bound the growth?* No — that is what the commit message itself concluded
     ("a 38% discount, not a bound"); what grows is the conversation. `trimOldPages`/`trimOldPlans` keep the *request*
     linear in the turn index, so the total is quadratic and 54 turns costs ~800k chars whatever the pages are.
  3. *Does the plan breaker catch it?* No. `planOnlyTurns` requires `every(c => c.name === 'update_plan')`; one
     `fetch_page` per turn keeps it at 0 permanently. That is R7-3's original dodge, still open through the other door.
  4. *Is the damage bounded by the cost ceiling instead?* Only in dollars, and only for a job that has one — the
     ceiling is per JOB, so one agent burning 54 gather calls takes the ceiling away from the agents that would have
     done real research. In the run above `turnsUsed` stayed 0 and `gatherStop` was `stalled`, so the admin can see it;
     the money is still gone.
- **fix sketch.** Make a cached read reset the counter only when it is *new to this loop*: track a per-loop
  `Set<string>` of URLs already returned in full and treat a repeat as `buysNothing`, i.e. move the reset from
  "returned a body" to "returned a body I had not been given before". Equivalently: keep a single loop-wide budget of
  body-returning cached reads (`MAX_SAME_URL_CACHED_READS × K`) rather than a per-URL one.
  **What an honest run loses if done naively:** the `b-legit` cross-checker re-reads ONE listing five times; a rule of
  "a repeat never resets" leaves it with 6 no-progress turns in a row (unchanged, still under 8) — safe. But the honest
  `P c P c P F` refiner (`out/local-4837f6e3`) re-reads *distinct* pages and would still reset on each first read, so
  it survives too. The naive fix that DOES break honest runs is lowering `NO_PROGRESS_TURNS_LIMIT`: the commit already
  measured that 4 cuts `b-legit` mid-loop with paid research queued.

### F2 · The checkpoint page cap silently turns itself off once a gathered agent owns 60 pages: `rest.slice(-0)` keeps every page in the store — P1

- **where:** `packages/core/src/engine/research-engine.ts:520`
  ```ts
  const keep = new Set([...mine.slice(-CHECKPOINT_MAX_PAGES), ...rest.slice(-Math.max(0, CHECKPOINT_MAX_PAGES - mine.length))]);
  ```
  When `mine.length >= CHECKPOINT_MAX_PAGES` the second argument is `-0`, and `Array.prototype.slice(-0)` is
  `slice(0)` — **the whole array**, not none of it. (`node -e "console.log([1,2,3].slice(-0))"` → `[1,2,3]`.)
- **input / observed (reproduced).** `resume` with 60 pages owned by a gathered `scout` (`gatheredAgentIds: ['scout']`,
  `fetchedByAgent: { scout: <those 60 urls> }`) and 200 foreign pages, 6,000 chars of body each:

  ```
  CAP:     carried 260 pages (cap is 60), checkpoint JSON 1,577,727 bytes
  CONTROL (59 owned, same 200 foreign): carried 60 pages
  ```

  One page of `mine` is the difference between a 60-page checkpoint and one carrying the entire store. The checkpoint
  is re-uploaded **after every agent** (`saveCheckpoint()` at `research-engine.ts:795`) and a job gets up to eight
  dispatches, so this is a per-agent 1.5 MB upload that grows monotonically with the store for the rest of the job.
- **status: reproduced** (scratch test, deleted; the assertion is `expect(out.checkpoint.extracted!.length)
  .toBeLessThanOrEqual(60)` — observed 260).
- **refutation attempted.**
  1. *Is `mine.length >= 60` reachable?* `owned` is the union of `fetchedByAgent[id]` over **all** gathered agents
     (`research-engine.ts:515`), and `fetchedByAgent` counts cached re-reads as well as paid fetches
     (`gather.ts:518`) — including reads the loop was *refused* (see F4). Three or four gathered producers on a
     24-turn budget clear 60 without anything unusual happening; the F1 attack guarantees it in one agent.
  2. *Does the existing test cover it?* No, and this is standing lesson 2 exactly. `retry-waste.test.ts:310` ("bounds
     what it carries, so the checkpoint cannot grow without limit") passes **no gathered agent**, so `mine` is empty
     and the broken branch is unreachable. `retry-waste.test.ts:447` ("keep2") does have `mine.length = 80`, but its
     fixture makes *all* 80 pages owned, so `rest` is empty and `slice(-0)` on `[]` is harmless — and it only asserts
     `gatheredAgentIds`, never the page count. The bound is never asserted with `mine ≥ 60` and a non-empty `rest`.
  3. *Is a 1.5 MB checkpoint actually a problem?* It is a GCS object (`uploadJson(CHECKPOINT, cp)`), so there is no
     hard document limit — the cost is the repeated upload and the fact that the doc for `CHECKPOINT_MAX_PAGES` says
     "the checkpoint is re-uploaded after every agent", which is precisely why the cap exists.
- **fix sketch:** `const room = Math.max(0, CHECKPOINT_MAX_PAGES - mine.length); ... rest.slice(rest.length - room)`
  — or `room ? rest.slice(-room) : []`. Nothing honest loses anything: the intended semantics are already "60 total,
  own pages first".

### F3 · An agent whose `fetchedByAgent` exceeds 60 URLs loses `gathered` on EVERY dispatch and re-buys its whole loop each time — M-D1 re-opened — P1

- **where:** `research-engine.ts:513-524` (`carry()`'s `gatheredIds` filter) together with
  `research-engine.ts:764` (`fetchedByAgent[agent.id]` is written with **no** bound) and `gather.ts:516-519`
  (`fetched.add(url)` fires for a cached re-read, *before* the "already returned twice" refusal at `gather.ts:522`).
- **the mechanism:** `gatheredIds` keeps an agent only if **every** URL in `fetchedByAgent[id]` survived the page cap.
  Since the cap is 60 and `fetchedByAgent[id]` has no cap at all, an agent with 61+ recorded URLs can never satisfy it
  — and `fetchedByAgent[id]` is never trimmed, so it never recovers. The commit's stated trade ("paying twice beats
  writing from someone else's research") is not paying twice; it is paying on all eight dispatches.
- **input / observed (reproduced).** 80 pages, `gatheredAgentIds: ['scout']`, `fetchedByAgent: { scout: all 80 }`,
  `doneAgentIds: []` (the M-D1 situation: the write keeps failing), each dispatch fed the previous checkpoint:

  ```
  dispatch 1: searches=0 fetches=0 gathered=[] carriedPages=60 fetchedByAgent.scout=80
  dispatch 2: searches=2 fetches=0 gathered=[] carriedPages=60 fetchedByAgent.scout=80
  dispatch 3: searches=2 fetches=0 gathered=[] carriedPages=60 fetchedByAgent.scout=80
  ```

  `gatheredAgentIds` is empty forever, `fetchedByAgent.scout` stays at 80 forever, and from dispatch 2 on the loop runs
  and buys again on every dispatch. (Dispatch 1 shows 0 searches only because the *incoming* checkpoint still said
  gathered; the outgoing one no longer does, and it never says so again.)
- **status: reproduced.**
- **refutation attempted.**
  1. *Is this not the designed behaviour?* The designed behaviour is one re-buy, after which the agent's own pages fit
     and it becomes gathered again. It never does, because the thing that disqualifies it (`fetchedByAgent`) is
     unbounded while the thing that must accommodate it (`extracted`) is capped at 60. There is no state in which a
     61-URL agent is gathered.
  2. *Is 61 URLs reachable for one agent?* Paid fetches alone cap at `researchBudget` (24 on the flagship), so this
     needs cached re-reads — and `fetched.add(url)` at `gather.ts:518` fires for **every** cached re-read of a URL in
     the shared store, including the ones the loop is about to refuse with `CACHED_STUB`. A refiner running over a
     store an earlier wave filled reaches 61 by asking; the F1 attack reaches it deliberately.
  3. *Does F2 mask it?* Partly, and confusingly: when all the agent's pages are owned and `rest` is empty (my fixture),
     the cap does bite and it loses `gathered`. In the mixed case F2 keeps everything, so the drop is only of the 20
     *oldest owned* pages — the agent still loses `gathered`, and the checkpoint is 260 pages. Both bugs fire together.
- **fix sketch:** bound `fetchedByAgent[id]` the way `touchedByAgent` is bounded, at `min(MAX_SEEN_PER_AGENT,
  CHECKPOINT_MAX_PAGES)`, and record only URLs whose body was actually returned (not the refused re-reads) — a page the
  loop was told "do not fetch it again" is not evidence that agent gathered. **What an honest run loses if done
  naively:** trimming to the *newest* 60 would un-gather any agent whose oldest fetches got trimmed, i.e. the same
  loop; the trim has to be paired with "an agent is un-gathered only when a page it actually READ was dropped".

### F4 · `output.turnsUsed` goes BACKWARDS on a resume — the counter is seeded from `cost.searchCalls`, which is not the turn count — P2

- **where:** `research-engine.ts:437` — `const counter = { turns: input.resume?.cost?.searchCalls ?? 0 };`
- **the mechanism:** `searchCalls` is *billed backend calls*; `turnsUsed` is *turns of the allowance*. They diverge on
  the fetch branch, deliberately (`gather.ts:542-544`): `turnsUsed += 1; if (url && canExtractPages()) charge(...)`.
  So a `fetch_page` with an empty/whitespace URL, **or any fetch at all in a deployment without `TAVILY_API_KEY`**
  (documented as optional — `docs/deployment.md:222-223`: Brave for search, "without this key `fetch_page` fails"),
  spends a turn and books no `searchCall`. On the next dispatch the job's counter is seeded low by exactly that many.
- **input / observed (reproduced).** `compactModel`, a scripted loop making `fetch_page({ url: '   ' })`:
  ```
  DISPATCH 1: out.turnsUsed=2, sum(agent.turnsUsed)=2, cost.searchCalls=0
  DISPATCH 2: out.turnsUsed=0, sum(agent.turnsUsed)=2, cost.searchCalls=0
  ```
  This is R7-13's symptom verbatim — "the admin's per-agent rows stopped summing to the Search turns figure above
  them, and the buyer's live count restarted at zero mid-job" — reproduced at HEAD, after the commit that closed it.
  `at.turnsUsed` is carried exactly (`research-engine.ts:615`), the job counter is not.
- **status: reproduced.**
- **refutation attempted.** In the normal production configuration (Tavily key set, non-empty URLs) the two are equal
  turn-for-turn, which is why this is P2 and not P1: it is a wrong admin number and a wrong buyer-visible turn count,
  never wrong money. But the empty-URL case is entirely model-controlled — `String(args.url ?? '').trim()` — and the
  no-Tavily deployment is a supported, documented one where **every** fetch turn is uncounted after a resume.
- **fix sketch:** carry the turn count as its own checkpoint field (`Checkpoint.turnsUsed`), seeded and written
  alongside `cost`, instead of inferring it from a cost field that deliberately means something else. Cheap and exact;
  absent on old checkpoints → fall back to `cost.searchCalls`, which is what happens today.

### F5 · The free-branch note flood is 10× the commit's figure under the same attack — P2

- **where:** `gather.ts:420-422, 573-583` (one note per free branch per model turn).
- **observed:** 93b132e claims "300 notes / 298 cached / 410 progress writes → 8 / 2 / 12". Under F1's rotation the
  same agent produces **111 notes and 115 progress writes** (2 per turn × 54 turns: one `plan`, one `cached`). The
  R7-29 defect proper — eviction of the `Writing` and `Research loop ended` notes past `MAX_NOTES = 300` — does **not**
  recur (111 < 300), and the closing note is present. What does not hold is the "12 progress writes" figure: 115
  Firestore progress writes for an agent that bought nothing.
- **status: reproduced** (same run as F1).
- **refutation attempted:** the per-turn cap is genuinely doing its job — without it this run would be ~110 cached
  notes *plus* the per-call flood. The number is a consequence of F1 (54 turns instead of 13), not an independent
  defect; fixing F1 fixes it. Recorded so the commit message's figure is not read as a bound.

---

## Claims checked and TRUE (so nobody re-checks)

- **`buysNothing()` really is evaluated before the calls run** (`gather.ts:367-383`), before any turn is spent or any
  body returned, and it really does cover all four branches the message lists: `update_plan`, a `web_search` past the
  allowance or past `MAX_SEARCH_FAILURES`, a `fetch_page` past the allowance or past `MAX_SAME_URL_CACHED_READS`, and
  an unknown tool. A turn with **zero** tool calls does not count as no-progress, but it also cannot be used as a free
  reset: the zero-call branch (`gather.ts:398-413`) either nudges (bounded at `nudges < 2`, and only while
  `turnsUsed === 0`) or ends the loop.
- **A cached read that returns a body is progress, deliberately**, and that is what keeps the honest `P c P c P F`
  refiner alive — confirmed; it is also exactly what F1 exploits. Both are true at once.
- **`gatheredAgentIds` / `fetchedByAgent` / `touchedByAgent` / `warnings` are genuinely absent-tolerant.** A checkpoint
  written before today (`{...}` with none of the four) resumes with newest-pages-only, no preference, no carried
  warnings, and the run is unchanged. `refute-small.test.ts` writes the old shape out as a literal, which is the right
  way to pin it.
- **A resumed writer really does rank its own pages and results first again**: `research.fetched` is seeded from
  `fetchedByAgent[id]` and `research.touched` from `touchedByAgent[id] ∪ fetchedByAgent[id]`
  (`research-engine.ts:648-650`), and both are read by the dossier tiers.
- **`touchedByAgent` is bounded** at `MAX_SEEN_PER_AGENT = 300`, newest-first (`research-engine.ts:767`).
  `fetchedByAgent` (`:764`) is **not** — the commit message's "bounded at 300 URLs per agent" reads as covering both.
  That is the mechanism of F3; noting it here so the message's wording is not taken as a pin.
- **`delivered` really is built from `produces` alone** (`research-engine.ts:918-922`), and `reconstructed` really is
  reachable only for a key some done *enricher* wrote while its producer did not finish. I tried to fabricate a
  friendlier label and could not: `validate.ts:100` refuses a template where an `enriches` key has no producer, so an
  enricher-only key (which would slip through unlabelled) cannot exist; `mode.exclude` filters sections and
  produces/enriches with the same set, so it cannot orphan a key either; `mark()`'s `RANK` only upgrades. The one
  residue is **reasoned, not reproduced and probably unreachable**: `degraded` is carried across dispatches and
  `mark()` never downgrades, so a status set on one dispatch survives even if a later dispatch genuinely produces the
  section — but every path that calls `mark()` is on the terminal finalize pass, so I could not construct a second
  dispatch that reaches it. Worth one sentence in a comment, not a finding.
- **`warnings` do not reach the buyer, on any of the three surfaces.** `apps/api/src/index.ts:1553-1558` strips the
  summary down to `notice` + `sections` for a non-admin; `metadata.json` and `trace.json` (which carry them) are in
  `ADMIN_ONLY_FILES` (`index.ts:917`); and the buyer's in-report copy is `report-copy.ts`'s localized `SECTION_NOTE`,
  not `trace.warnings`. `warnings` also does not feed `meta.sections`, so the degraded-delivery KPI is untouched — as
  the commit claims.
- **`warnings` neither duplicate nor grow without bound.** I tried three duplication routes and none reaches: the
  shrink warning is pushed only on the attempt that then sets `done`, so the agent cannot run again on a later
  dispatch; the ceiling warning and the `Degraded [...]` warnings are pushed only on the terminal finalize pass; and a
  superseded dispatch's checkpoint save is skipped (`run-job.ts:291-296`), so its warnings are never persisted to be
  re-pushed. The count is bounded by (agents + shrunk fields + 1).
- **`turnsUsed`/`gatherStop` reach `JobSummary` and render correctly for the case they exist for.**
  `run-job.ts:519-521` omits `turnsUsed` when it is `0` (falsy), which looked like a hole — but the renderer
  (`apps/admin/src/pages/JobDetail.tsx:50-63`) does `turnsUsed ?? 0` and only falls back to `—` when **both** are
  absent, so the 0-turn `stalled` refiner does render "0 turns" in orange with a `stalled` badge, and a synthesizer
  (no loop, no `gatherStop`) still renders `—`. The claim holds.

## Commit-message audit

I am the breaker lens, so this is only what I re-measured in passing.

| commit | claim | observed |
|---|---|---|
| `93b132e` | "`[update_plan, fetch_page(cached)]` on repeat: 54 / 838,702 → **13 / 53,674**" | True **only for a single URL**. Same attack over four URLs the store already holds: **54 / 808,868**, `turnsUsed 0`, `stop: stalled`. The pinned figure is a property of the fixture (one page), not of the guard. |
| `93b132e` | "The note flood: 300 / 298 / 410 → **8 / 2 / 12**" | 111 notes / 115 progress writes under the four-URL rotation. The `MAX_NOTES` eviction really is gone (111 < 300); the "12 progress writes" figure is not a bound. |
| `93b132e` | "the most free-and-useless turns in a row an honest persona reaches is 6" | Consistent with `b-legit.test.ts:213-231` (five re-reads of `LISTINGS[0]`, reads 3-5 stubbed, re-planning between). The calibration is honest; the bound it produces is the problem. |
| `93b132e` | "`refute-B2` deal-scout: 54 → 52 iterations, `turns: 24`, `stop: budget`" | Passing in a green suite; not independently re-derived. |
| `90d6fdf` | "Suite 1056 → 1061, MEASURED" | I measure 1061 passing at HEAD, so the arithmetic through `a84878d`/`6780c94` (→ 1071 in Javier's checkout, which counts 12 trace-gated tests I skip, minus the 10 key-gated live ones) is off by two somewhere in the chain. Flagging the discrepancy, not attributing it. |
| `90d6fdf` | "`fetchedByAgent` absent … resumes exactly as it did, and there is a test that says so" | True (`refute-small.test.ts` writes the old shape as a literal). |
| `a84878d` | "`touchedByAgent` joins `fetchedByAgent` in the checkpoint (bounded at 300 URLs per agent)" | Only `touchedByAgent` is bounded (`:767`). `fetchedByAgent` (`:764`) has no bound, which is the mechanism of F3. |
| `a84878d` | "the unit test that was supposed to cover this could not fail — 48 items with `max = 48`" | Correct, and the same shape recurs: `retry-waste.test.ts:310` asserts the checkpoint page cap with **no gathered agent**, so the branch F2 breaks is unreachable from that fixture. |
| `6780c94` | "`warnings` is admin-only (the API redacts it for a buyer)" | True on all three surfaces (summary, files, report copy). |
