# G1-verify — group G1 (research LOOP + DOSSIER: `f013cfe`, `1fa5d31`, `72d2777`) / VERIFIER · completeness

**Checkout note.** My worktree was handed to me at `d1ac4dd`, *before* the batch. I fast-forwarded it to
`a11bafe` (`git merge --ff-only a11bafe`), ran `npm ci`, and ran the sanity test —
`cd apps/api && npx vitest run test/resolution.test.ts` → **1 passed** (there is no
`packages/core/test/resolution.test.ts`). Every measurement below was taken at `a11bafe`; nothing measured at
`d1ac4dd` survives into this report. Baseline for `packages/core`: **64 files passed / 2 skipped, 622 passed /
16 skipped**. Tree is clean; every mutation was reverted and the suite re-verified green at the end.

## Verdict

**The mechanism is real and the verification claims are honest — all twelve named mutations red exactly the
number of tests the three messages claim (6, 1, 1, 1, 1, 1, 3 · 11, 1, 4 · 2, 1), and the loop numbers from the
real July traces reproduce to the digit (26 = 2·10+6 iterations, 22 plans / 4 cached / 0 searches, $0.382752,
571,813 input tokens, risk-analyst 16 plans / 0 turns, deal-scout 54 = 2·24+6, the honest refiner's literal
`P c P c P F` sequence, 199/174 sources, 8/11 pages, `searchUsd` exactly 0.88, 48 snippets in six 8-result
searches).** What does **not** hold is the *reach* half. Three things: (1) the flood the commit closes for
`update_plan` is wide open through `fetch_page` on a cached URL — 400 calls in one turn produce 400 notes and 410
progress writes, evict the admin's `Writing` note, and evict the commit's own new `Research loop ended` note,
**reproduced end-to-end**; (2) `gatherStop` — the field added because "nothing in the trace said so" — is dropped
from `JobSummary` and appears on no admin screen, so the admin table still shows the 0-turn plan-looper as
`ok · 1 try · $0.38`, identical to a 24-search agent; (3) the closing note is emitted as progress kind `stopped`,
which the buyer's SPA renders as **"Research for this step is complete."** — for `stalled` and `ceiling` too.
Two production constants (`FOREIGN_PER_DOMAIN_PAGES/SNIPPETS`) and one whole half of the plan breaker (the
`stopPlanning` instruction) are pinned by **zero** tests: I deleted each and the suite stayed green. Three
figures in `1fa5d31`'s message come from the `b-legit` fixture or a different run than the one they are attached
to.

---

## Findings (most severe first)

### F1 · The note/progress flood `f013cfe` closes for `update_plan` is wide open through `fetch_page` on a cached URL — 300/300 trace slots become spam, the admin loses the `Writing` note, the commit's own new `Research loop ended` note is evicted, and 410 Firestore progress writes fire — all free — P1

- **where:** `packages/core/src/engine/gather.ts:467` (the cached note, *not* coalesced) against
  `gather.ts:374-377` (the `planNoted` latch that fixes the sibling branch four lines up) and
  `packages/core/src/engine/research-engine.ts:902`
  (`if (trace.notes.length < MAX_NOTES) trace.notes.push(...)` — **keep-first**, so the *last* notes are the ones
  dropped).
- **input / observed:** one paid `fetch_page` to seed the store, then ONE model turn carrying 400
  `fetch_page` calls for the same (now cached) URL. The cached branch `continue`s before `turnsUsed += 1`, so
  every one is free.
  - Direct against `gather()`: `notes=402 cachedNotes=400 closingNoteAt=401 stop=done` — the closing note is
    note **401**.
  - End-to-end through `runResearch` (compactModel, `installMockProvider`):
    `stored notes=300 cached=298 hasWriting=false hasClosing=false progressLines=410 gatherStop=done`.
  - Both F2 invariants that `b-attack.test.ts:302-306` asserts for the plan path **fail** here verbatim:
    `expect(scout.notes.some(n => n.includes('Writing')))` → false; `expect(progress.length).toBeLessThan(50)`
    → 410.
- **status: reproduced.** Repro (port as `b-attack.test.ts` sibling of F2; I deleted mine after measuring):
  ```ts
  // one paid fetch of PAGE.url, then in ONE turn:
  toolCalls: Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, name: 'fetch_page', args: { url: PAGE.url } }))
  // then the two F2 invariants, unchanged:
  expect(scout.notes.some((n) => n.includes('Writing')), 'admin lost the "Writing" note').toBe(true);
  expect(progress.length, 'buyer progress channel flooded').toBeLessThan(50);
  ```
- **refutation attempted:** *"400 calls in one turn is unreachable"* — the repo's own
  `refute-B2.test.ts:317-334` makes that argument for `update_plan` and concedes the eviction **is** reachable
  sustained over a loop (324 > 299). The same arithmetic is *worse* for `fetch_page`: a minimal
  `fetch_page{"url":"https://attacker.test/cached-flood"}` is 54 chars ≈ 14 tokens → **292 calls in one
  4,096-token turn** (at the comment's stricter 3 chars/token, 227); with a short URL (`https://a.co/x`,
  34 chars ≈ 9 tokens) → **455**. And sustained is trivial: 6 cached fetches/turn × 54 iterations = 324 > 299.
  *"The same-URL cap already handles this"* — no: `MAX_SAME_URL_CACHED_READS` (`gather.ts:210`, applied at
  `:456`) replaces the **content** with `CACHED_STUB` from the third read on, but line **467** still emits a
  note for every call (`Declined to re-send a page already returned twice.`) and `note()` still writes progress.
  The author touched this exact branch and capped the bytes, not the notes.
- **fix sketch:** hoist the `planNoted` latch into a general per-turn latch — `let noted = new Set<string>()`
  reset each model turn, and skip `note()` when `noted.has(call.name)` for the free branches (`update_plan`,
  cached `fetch_page`). What an honest run loses: the second and later cached re-reads of a turn stop appearing
  as separate lines — visible in the trace as one `Reused N cached page(s).` per turn instead of N lines.

### F2 · `gatherStop` reaches no admin screen: it is dropped from `JobSummary`, and for a `held` job — the one an admin must judge — `trace.json` is not even listed — P1

- **where:** `packages/core/src/engine/run-job.ts:513-515` (field-by-field copy: `id, wave, status, durationMs,
  attempts, costUsd` — no `turnsUsed`, no `gatherStop`); `packages/core/src/jobs/types.ts:145` (the DTO
  enumerates the same six); `apps/admin/src/pages/JobDetail.tsx:361-393` (per-agent columns: Agent · Wave ·
  Status · Duration · Tries · Cost); `apps/api/src/index.ts:1594` (`if (job.status !== 'completed') return base;`
  — `files[]`, and therefore `trace.json`, only for completed jobs).
- **input / observed:** `f013cfe` justifies the field with *"an admin reading it could not tell a section written
  from research from one written from none."* After the fix the admin table renders the aa4b3edf
  deep-dive-refiner (22 plans, 4 cached re-reads, **0 searches**, $0.38) as `ok · 1 try · $0.38` — byte-identical
  to the deal-scout that made 21 real turns. The only rendered turn figure is the **job-wide** aggregate at
  `JobDetail.tsx:148`. The data exists only inside `trace.json`, reachable by hand through the Files card
  (`JobDetail.tsx:414`), which itself renders only when `job.status === 'completed'`.
  Compounding: the checkpoint slims `notes: []` (`research-engine.ts:424`), and a resumed dispatch restores those
  slimmed rows (`:408`), so on any **multi-dispatch** job the `Research loop ended: …` note for earlier agents is
  gone from the final `trace.json` too — `gatherStop` is then the only surviving signal, and it is the one that is
  never rendered.
- **status: reproduced** (grep + code read of the exact copy at `run-job.ts:513`; `grep gatherStop apps/admin/src`
  → no hits; `grep turnsUsed apps/admin/src` → only `JobDetail.tsx:148,167`, both job-level).
- **refutation attempted:** `run-local.ts:42` *does* stream the closing note (`[deal-scout] Research loop ended:
  budget (24/24 turns).`) and writes the full trace at `:49` — so the field reaches a developer at a terminal. It
  reaches no admin, and `run-local.ts` prints no per-agent summary at all (there is no loop over
  `out.trace.agents` in the file).
- **fix sketch:** add `turnsUsed: a.turnsUsed, gatherStop: a.gatherStop` to `run-job.ts:514` + the two DTOs, and
  one column in `JobDetail.tsx:368`. Naively done, an honest run loses nothing; the cost is one more field on
  every `JobSummary` document for jobs that are already storing six.

### F3 · A loop cut off after four plan-only turns with **zero** searches tells the buyer "Research for this step is complete." — twice — P2

- **where:** `packages/core/src/engine/gather.ts:336` (plan-breaker note, kind `stopped`) and `gather.ts:515`
  (closing note, kind `stopped`, for **every** stop including `stalled` and `ceiling`) →
  `apps/fbizlab/src/lib/progress-copy.ts:27`:
  `stopped: { en: 'Research for this step is complete.', … }`.
- **input / observed:** `runResearch` with a model that only ever calls `update_plan`. Captured `onProgress`
  stream, verbatim:
  ```
  {"phase":"scout","message":"Stopping research: 4 plan updates in a row with no search or fetch.","kind":"stopped"}
  {"phase":"scout","message":"Research loop ended: stalled (0/2 turns).","kind":"stopped"}
  ```
  `gatherStop = 'stalled'`, `turnsUsed = 0`. The API hands the buyer the kind and not the message
  (`clientProgress`), so the buyer's screen reads "Research for this step is complete." for a loop that searched
  nothing and was force-stopped. The English message on line 336 directly contradicts the kind it carries. The
  `ceiling` path does the same: kind `ceiling` ("Pausing this step for review.") at `gather.ts:295`, then kind
  `stopped` ("…is complete.") at `:515`.
- **status: reproduced** (progress stream above, from a scratch test since deleted).
- **refutation attempted:** the window is narrow — `writing` is emitted immediately after, so the false line is
  usually overwritten within milliseconds. That is what keeps this P2 rather than P1. But `setProgress` is
  best-effort and `.catch()`-swallowed (`run-job.ts:323`): if the `writing` write is the one that blips, the buyer
  sits on "complete" for the whole synthesis call. And the `ProgressKind` vocabulary has **no** value meaning
  "cut off", so no client can ever tell this buyer the truth. Round 5's lesson (`c583f08`, "the mail that
  announced an incomplete dossier as finished") is the same sentence in a different channel.
- **fix sketch:** emit the closing note as `stopped` only for `done`/`budget`; add a `cut_off` kind (or reuse
  `incomplete`) for `stalled`/`ceiling`, with copy like "This step stopped early; some research was not
  completed." An honest run loses nothing — `done`/`budget` are the honest stops.

### F4 · The production per-host dossier caps (3 pages / 8 snippets) are pinned by **zero** tests — P2

- **where:** `packages/core/src/engine/prompt.ts:169-170` (`FOREIGN_PER_DOMAIN_PAGES = 3`,
  `FOREIGN_PER_DOMAIN_SNIPPETS = 8`), used only at `prompt.ts:241,245`.
- **input / observed:** mutation **M13** — set both to `999` (i.e. disable diversity-first in production,
  leaving `rankEvidence` itself intact). Result: **64 files passed / 622 passed — zero red.**
- **status: reproduced.**
- **refutation attempted:** `evidence-ranking.test.ts` has four tests for the per-domain pass and mutation M10
  (removing the pass from `rankEvidence`) reds all four — but every one of them calls `rankEvidence(store, max,
  perDomain, …)` with its **own** `perDomain` literal. Nothing asserts through `buildDossier` /
  `buildProducerSynthPrompt`, so the wiring and the chosen values are untested. This is the mirror of standing
  lesson 1: the guard is tested, the production caller is not. (`MAX_SAME_URL_CACHED_READS` and
  `PLAN_TURNS_LIMIT` do **not** have this problem — M5 and M2 each red a test.)
- **fix sketch:** one assertion in `b-attack.test.ts` F1 on the rendered dossier — a store with 20 pages from one
  host and 2 honest hosts must put both honest hosts in the first four `[P#]` blocks of the prompt string.

### F5 · Half the plan breaker — the `stopPlanning` instruction handed back to the model — is pinned by no test, and the comment that claims it asserts something else — P2

- **where:** `packages/core/src/engine/gather.ts:362-367` (the `response.stopPlanning` / `response.message`
  block); `packages/core/test/red-team/refute-B2.test.ts:240-241`.
- **input / observed:** mutation **M15** — `if (planOnly && planOnlyTurns >= PLAN_TURNS_BEFORE_NUDGE) {` →
  `if (false) {`, deleting the whole instruction. Result: **622 passed — zero red.** The commit claims *"on the
  third the plan result says stop planning AND the next call is no longer forced"*; only the second half is
  verified (M3/M14 each red one test). In `refute-B2.test.ts` the comment on line 240 reads
  `// The nudge came first: on the third plan-only turn the plan result said stop planning.` and the assertion
  below it is `expect(notes.filter((n) => n.startsWith('Plan updated')).length).toBeLessThanOrEqual(...)` — a
  count of *notes*, which says nothing about the tool response. Standing lesson 2, exactly.
- **status: reproduced.**
- **fix sketch:** in the `Replay`-based test, capture `opts.messages` on call 4 and assert the last
  `update_plan` tool result carries `stopPlanning: true`. Nothing honest is lost.

### F6 · `refute-B2.test.ts`'s title states "~150 calls (≈27 tokens each)"; the test computes and prints **227 (≈18 tokens each)** — P2

- **where:** `packages/core/test/red-team/refute-B2.test.ts:318` (title) vs `:322-324` (computation).
- **input / observed:** ran the test; its own `console.log` prints
  `minimal update_plan call: 70 chars ≈ 18 tokens → ≤ 227 calls per 4,096-token turn`. The assertions are
  `< 300` and `< 400` — both true at 227 — so the title's numbers are load-bearing for a reader and checked by
  nothing. 4096/27 = 151, so the title was written at ~2.6 chars/token while the code uses 4.
- **status: reproduced.**
- **fix sketch:** put the computed figure in the title, or assert `maxCallsPerTurn` against a literal.

### F7 · Three figures in `1fa5d31`'s message are attributed to "the two real July runs" but come from the `b-legit` fixture or from a different run than the number beside them — P2

- **where:** commit message `1fa5d31` (and `f013cfe`'s `$1.19`); source of truth
  `out/local-4837f6e3/` and `out/local-aa4b3edf/`.
- **input / observed** (recomputed from the traces; `4837f6e3` carries **no cost data at all**, so every dollar
  figure must come from `aa4b3edf`):
  | claim | computed |
  |---|---|
  | "the deep-dive-refiner saw 0 of the 5 pages it fetched, the deal-scout 3 of 12" | not production: the real refiner fetched **1** page (4837f6e3) / **0** (aa4b3edf), the deal-scout **6** / **7**. 5 and 12 are the **`b-legit.test.ts` simulation** (verified by running it). |
  | "on the Florida flagship with 80 honest listings" | `packages/core/test/red-team/b-legit.test.ts:66` `honestListings(80)` — a fixture, not a run |
  | "~22 marketplace listings … ~$0.22 of $0.88" | `$0.88` = `cost.searchUsd` of aa4b3edf, **exact**. Marketplace sources past index 48: **20** (aa4b3edf) / **34** (4837f6e3). `$0.22` has no derivation in aa4b3edf (its wave-2/3 producer searches = 7 → $0.112); the only exact match, $0.224 = 14 searches, is in the **other** run. |
  | "the honest deal-scout that spent 24/24 turns … ($1.19)" (`f013cfe`) | the 24/24-turn scout is **4837f6e3** (which has no cost data); `1.190481` is **aa4b3edf**'s scout, which ran **21/24 turns, 45 iterations**. |
- **status: reproduced** (recomputed from `trace.json`/`sources.json`; `b-legit`'s printed table re-run).
- **refutation attempted:** the message *does* say the page half "is latent (the store reached 8–11 pages in
  production)" before the flagship sentence, which is an honest hedge — 8 and 11 verify exactly. So this is
  imprecision in attribution, not invention. Every *loop* number in `f013cfe` is exact.
- **fix sketch:** in the message, mark the flagship figures "(simulated, `b-legit`)" and drop `$1.19`/`$0.22`
  or name their run.

### F8 · `docs/agents.md` now describes a loop that no longer exists — P2

- **where:** `docs/agents.md:54-57` ("The first turn `forceTools` is on … The loop caps total iterations at
  `maxTurns × 2 + 6`" — `forceTools` is now `turnsUsed === 0 && planOnlyTurns < PLAN_TURNS_BEFORE_NUDGE`, and the
  breaker at `gather.ts:331-337` is a second exit the doc never mentions); `:48` (`update_plan` … "Free." —
  now bounded at 4 consecutive and superseded plans stubbed); `:50` (`fetch_page` "A page already fetched by any
  agent is reused (cached, **no** turn spent)" — now stubbed from the third read); `:159-160` (the dossier as
  insertion-order truncation — now tiered by `rankEvidence`); `:225-230` (an explicit `AgentTrace` field list
  that omits `gatherStop`). `grep -n 'gatherStop\|stalled\|rankEvidence' docs/agents.md` → no hits.
- **status: reproduced** (grep + read).

### F9 · `touched`/`fetched` are per-dispatch only, so the own-first dossier is off in exactly the case `D1` optimized — P2

- **where:** `packages/core/src/engine/research-engine.ts:533`
  (`const research = { done: gathered.has(agent.id), touched: new Set(), fetched: new Set() }` — `done` is
  restored from the checkpoint, the Sets are always fresh) vs `:430` (`gatheredAgentIds` is the only thing
  persisted).
- **observed / status: reasoned from code + proven for the in-run case.** The **in-run** retry path is correct
  and I proved it: `research` is built once per agent at `:533`, *outside* the `for (let attempt = …)` loop at
  `:541`, and passed by reference to `runAgent` on every attempt — so on attempt 2 with `research.done === true`
  (no new loop) the Sets still carry attempt 1's URLs into `buildProducerSynthPrompt`/`buildEnricherSynthPrompt`
  (`:968-969`, `:982-983`). Across a **re-dispatch** they are empty, so an agent that gathered in dispatch 1 and
  writes in dispatch 2 (the flaky-write case `6264887` exists to make cheap) falls back to referenced-tier +
  store order. The commit discloses this ("A resumed agent … falls back to the referenced tier and store order —
  the same as today, never worse"), which is true; it is a reach gap, not a false claim.
- **fix sketch:** persist `touchedByAgent`/`fetchedByAgent` in the checkpoint next to `gatheredAgentIds`.

### F10 · Every new bound is a hardcoded module constant, and even the *existing* gather knobs are not wired into the deploy — P2

- **where:** `gather.ts:196-197,210` (`PLAN_TURNS_BEFORE_NUDGE`, `PLAN_TURNS_LIMIT`,
  `MAX_SAME_URL_CACHED_READS`), `prompt.ts:169-170` (`FOREIGN_PER_DOMAIN_*`), against
  `packages/core/src/config.ts:313-321` (`LLM_GATHER_MAX_OUTPUT_TOKENS`, `LLM_GATHER_THINKING_BUDGET`) and
  `infra/deploy.sh:53`.
- **observed:** `config.ts` has exactly the pattern these would fit (`int('…', default)`), so adding them is
  cheap. But `grep 'LLM_\|GATHER' infra/deploy.sh` → **nothing**: `COMMON_ENV` passes only
  `ENV, GCP_PROJECT_ID, GCP_LOCATION, RESEARCH_BUCKET, FIRESTORE_DATABASE, RESEARCH_MAX_TURNS, BRAVE_API_KEY,
  TAVILY_API_KEY, SEARCH_COST_PER_CALL_USD, BRAVE_COST_PER_CALL_USD, POSTMARK_SERVER_TOKEN`. So
  `LLM_GATHER_THINKING_BUDGET` — which `docs/deployment.md:144` documents as deployable — runs on its code
  default in production today. **Verdict on the "should they be in config.ts" question: mostly noise for the new
  constants** (they are safety bounds, not tuning dials, and a bad value is a money bug); the *real* finding is
  that the documented knob is not wired. Report it as a doc/deploy mismatch, not as a demand for four more env
  vars.

---

## Claims checked and TRUE (so nobody re-checks)

**`f013cfe` — all seven "verified by mutation" counts are exact.** Each: edit, full `packages/core` suite,
revert.

| # | mutation (mine) | claimed red | observed red |
|---|---|---|---|
| M1 | delete `if (stop === 'stalled' && turnsUsed >= maxTurns) stop = 'budget';` (`gather.ts:511`) | 6 | **6** (b-legit ×2, d-attack, retry-waste, d-legit, refute-B2) |
| M2 | `PLAN_TURNS_LIMIT = 4` → `9999` | 1 | **1** |
| M3 | `forceTools: turnsUsed === 0` (drop the plan clause) | 1 | **1** |
| M4 | `if (!planNoted)` → `if (true)` (note every plan call) | 1 | **1** (b-attack F2) |
| M5 | `MAX_SAME_URL_CACHED_READS = 999999` | 1 | **1** (d-attack D2) |
| M6 | comment out `trimOldPlans(messages)` | 1 | **1** |
| M7 | comment out `trace.gatherStop = gres.stop` | 3 | **3** (b-legit, retry-waste ×2) |

**`1fa5d31` — all three exact.** M8 `rankEvidence` → `items.slice(0, max)`: **11 red across 4 files**
(evidence-ranking ×7, b-legit, b-attack ×2, refute-b1) — claimed 11/4. M9 drop both
`fetched: ctx.research.fetched` lines: **1 red** — claimed 1. M10 drop the per-host `deferred` pass: **4 red** —
claimed 4.

**`72d2777` — both exact.** M11 restore `counter.turns += gres.turns; trace.turnsUsed = gres.turns` and remove
`onTurn`: **2 red** (d-legit "a 503 in the LOOP … turnsUsed 5 = searchCalls 5", refute-small "D2 · turnsUsed
accounting"). M12 `sampleFromSchema` ignores `maxLength`: **1 red** (refute-small D3).

**Numbers recomputed from `out/*/trace.json` (all exact unless noted in F7):**
- deep-dive-refiner (aa4b3edf): **22** plans, **4** cached, **0** searches, **26 iterations = 2·10+6** exactly,
  `usd 0.382752` (≈$0.38), `inputTokens 571813` (≈572k). ✓
- risk-analyst (aa4b3edf): **16** plans, **turnsUsed 0**, 16 = 2·5+6 exactly. ✓
- deal-scout (4837f6e3): **24 turns + 24 plans + 6 cached = 54 = 2·24+6** exactly. ✓
- "honest max is 2 plan-only turns in a row across eighteen real agent-runs": there are **20** producer runs with
  a loop; the two pathological ones excluded leaves **18**. Max run of consecutive `Plan updated` notes over
  those 18 is **2** (distribution: 10 agents max-1, 8 agents max-2, **0** at 3 or 4, 2 at 16/18 — both
  pathological). The pre-fix traces note *per plan call*, so a run of k notes is a strict **upper bound** on
  consecutive plan-only *turns* — which is the load-bearing direction: no honest run can trip
  `PLAN_TURNS_BEFORE_NUDGE=3`, with a two-step margin. ✓
- "the honest refiner's `P c P c P F`": 4837f6e3's deep-dive-refiner, literal note sequence `P c P c P F P`. ✓
- "wave 1 consumed the 48 in six searches": 8 results/call (Brave `count=8` / Tavily `max_results=8`); the store's
  first 48 are six contiguous 8-item topical blocks in both runs (zero dedupe loss). ✓
- "the store held 174–199 sources" → **199** / **174**. "8–11 pages in production" → **8** / **11**. ✓
- "$0.88 search spend" → `cost.searchUsd = 0.88` = 55 calls × $0.016, exact (aa4b3edf). ✓
- `MAX_SNIPPETS = 48` / `MAX_PAGES = 14` (`prompt.ts:86-87`), `maxIterations = maxTurns*2+6` (`gather.ts:264`)
  unchanged, as claimed. ✓

**Threading, checked by code read:**
- Both producer paths get `touched/fetched` (`research-engine.ts:968-969` enricher-style rewrite,
  `:982-983` producer) — nothing else calls `buildDossier` (`prompt.ts:501,544` are the only two call sites).
- **The chart/synthesizer path has no dossier and did not regress**: 3 of the 13 trace agents are synthesizers
  with no loop, and `buildDossier` is not reachable from them.
- **`buildAgentKickoff` gets `current` but no dossier** — correct, and unchanged by `1fa5d31`.
- **In-run retry keeps attempt 1's `touched/fetched`** — proven: `research` is constructed at
  `research-engine.ts:533`, outside the attempt loop at `:541`, and passed by reference. (Cross-dispatch, see F9.)
- **`gatherStop` is carried forward for a resumed agent** (`research-engine.ts:505`) so a resumed row does not
  read as "0 turns, no stop".
- **`a11bafe`'s claim "cite the commits that are actually on main" holds**: all **33** distinct short hashes in
  `docs/plans/deep-review.md` (71 sites) and `docs/plans/m-red-team.md` (10 sites) resolve to real commits, all
  33 are ancestors of `a11bafe`, and each subject matches the description the doc attaches to it. Zero wrong,
  zero unreachable.

## Tests: content vs shape, and the mutations I ran

**Assert content (good):**
- `refute-B2.test.ts` replays the *literal* P/S/F/c strings from `out/local-4837f6e3` and `out/local-aa4b3edf`
  through today's `gather` and asserts iterations, turns, stop, and the note text. `PLAN_TURNS_LIMIT` is pinned
  by the **literal** `/Stopping research: 4 plan updates in a row/` (`:238`) and by
  `expect(p.calls).toBeLessThanOrEqual(seq.indexOf('PPPP') + 4)` — not by importing the constant. No tautology.
- `retry-waste.test.ts:204,238` — full `runResearch` runs; asserts `attempts`, `gatherStop`, the presence/absence
  of `reusing evidence already gathered`, and `Researching` occurring once vs twice. Title matches assertion; the
  new sibling ("reuses a loop that spent its whole allowance") is a genuinely different scenario from the one it
  replaced.
- `b-legit.test.ts` — rewritten pins state the old value in the test name and name the reverting mutation
  (`stop: 'budget', reusable: true` where it used to be `'stalled', false`). Honest.
- `evidence-ranking.test.ts` — 8 real ordering assertions on `rankEvidence`; the tier-order test, the
  90%-one-marketplace test and the `www.`/malformed-URL test all assert exact output arrays. **But** every one
  passes its own `perDomain`, so the production constants are unpinned — F4.
- `progress-kinds.test.ts` — `KINDS` is a hand-written literal set, not imported from `types.ts`, so it is not a
  tautology. It does **not** assert anything about `stopped` (only `starting`/`wave`/`researching`/`writing`/
  `composing`/`assembling`/`done`), which is why F3 slipped through.
- `context-size.measure.test.ts` now asserts `meta.sections` is empty rather than status alone — the D3 claim
  holds (M12).

**Shape / claims wider than the assertion:**
- `refute-B2.test.ts:240` — comment claims the `stopPlanning` nudge fired; the assertion counts `Plan updated`
  notes. The nudge itself is unpinned (F5, M15 green).
- `refute-B2.test.ts:318` — title's "~150 calls (≈27 tokens each)" vs the 227/≈18 the same test prints (F6).
- `evidence-ranking.test.ts` per-domain block — pins the function, not the caller (F4, M13 green).

**Extra mutations I ran beyond the twelve claimed** (all reverted; suite re-verified 622 green):
- **M13** `FOREIGN_PER_DOMAIN_PAGES/SNIPPETS = 999` → **0 red**.
- **M14** `PLAN_TURNS_BEFORE_NUDGE = 999` → **1 red** (the `forceTools` test only).
- **M15** `if (planOnly && planOnlyTurns >= PLAN_TURNS_BEFORE_NUDGE)` → `if (false)` → **0 red**.
