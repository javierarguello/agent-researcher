# G1-verify — ENGINE (`8ff7312` evidence tiers, `8901f60` search density) / VERIFY

Measured at **`a37d5f57f2f4f9f042ba704a6dec96a7b7aa68da`** (the brief's own commit), in worktree
`.claude/worktrees/agent-a82f9e1841a782dc0`, after `npm ci`. `apps/worker` `test/resolution.test.ts` passes, so
`@agent-researcher/core` resolves inside this worktree and every mutation below was visible to its own run.
Clean-worktree baseline: **1109 passing** (708 core + 215 api + 22 worker + 158 fbizlab + 6 admin, 16 skipped in
core, 0 failed) — the brief's number, to the test. `npm run typecheck` clean. I did **not** symlink `out/`, so the
six trace-gated red-team tests never ran. Every mutation was run alone, reverted, and followed by a full
`npm test`; RED counted, never passed. `git status` is clean.

## Verdict

Both commits do what they say at the level that matters, and their mutation arithmetic is exact: **all five
revert-verify counts in `8ff7312` and the one in `8901f60` reproduce to the number**, including the disclosed
0-red line, and both suite totals are right once the six trace-gated tests are subtracted (I measured 1100 at
`8ff7312` and 1101 at `8901f60` in a clean worktree, i.e. exactly the claimed 1106/1107 minus 6). The re-measured
density figures — 47.5k, 4.58M, 172/157/15, 92 turns, 60.6k, 67.7k, $0.31/$0.69, $1.65, 2.86×, 12/~56k, and
54 / **893,430** with the breaker reverted — all reproduce to the character, and the new bounds are honest rather
than fitted: the control band is the same ±10% (43k/52k around 47,470) and the total ceiling actually *tightened*
in relative terms (4.5M over 3.94M was 14% headroom; 5M over 4.58M is 9.2%). What does not hold is the batch's
prose about scope. `8901f60`'s "nothing else in the suite prints a figure that moved" is false — **three test
titles in `d-legit.test.ts` carry figures that moved with the density and were left at their density-5 values**,
and a fourth title in the group's own `refute-b1.test.ts` still calls 5 results/query "production density" in the
same batch that pinned production at 8. And `8ff7312`'s two absolutes — "nothing an honest run relies on gets
worse" and the new comment's "37 URLs … which no research budget reaches" — are both false as written: the same
reclassification that lifts overlapping listings **evicts the writer's own fetched pages** (10/10 → 7/10 at
`MAX_PAGES`), and the reserve bites on the pages half at **8** fetched pages, not 37. Nothing here is a P0; the
fixes themselves are sound. What is wrong is the size of the claims made about them.

## Findings (most severe first)

### F1 · Three published figures in `d-legit.test.ts` moved with the density and were not re-measured, so the suite's titles now state numbers the suite itself disproves — P2

- where: `packages/core/test/red-team/d-legit.test.ts:408`, `:784`, `:817` (all last touched at `d6ecba6`, never
  since). The claim they falsify: `8901f60`'s "Nothing else in the suite prints a figure that moved (diffed the
  full core-suite stdout at 5 and at 8, line by line…)".
- input / observed: I ran the core suite alone with `--reporter=verbose` twice, once at HEAD and once with
  `RESULTS_PER_QUERY` forced back to 5, normalised out timings/timestamps and diffed. Three titles carry a value
  that differs between the two runs:

  | file:line | title says | measured at density **5** | measured at HEAD (density 8) |
  |---|---|---|---|
  | `:408` | `…234 loop calls / 79 of 92 turns; … 5.07M loop chars (2.4× plan-once)` | 234 calls, 78 turns, **5062.1k** | 234 calls, 78 turns, **5686.8k** (= 5.69M; 1.41× plan-once) |
  | `:784` | `checkpoint 174k chars here (7 pages, 137k report)` | 182.6k, **7 pages** | 185.2k, **8 pages** |
  | `:817` | `est. $1.31 vs $2.58 all-in: essential is ~51% of the cost` | $1.3048 vs **$2.5703**, 50.8% | $1.3143 vs **$2.6527**, 49.5% |

  `5.07M`, `7 pages` and `$2.58` were each correct (or correct to a cent) at density 5 and are wrong at HEAD —
  they moved *because of this commit*. `79 of 92 turns` (the body asserts `toBe(78)` and the table prints 78),
  `174k`, `2.4×` and the inline comment at `:797` ("would not change THIS honest run — 26 pages", the run carries
  8) were already stale before the batch; the density move made two of them worse.
- status: **reproduced** — full core-suite stdout at 5 and at 8, line-by-line diff; console tables quoted above.
- refutation attempted: (a) Are these console *tables*, which the commit explicitly excuses as "they recompute"?
  No — they are the `it()` titles, which do not recompute; the tables underneath are what proves them wrong.
  (b) Is the whole diff really only tables? No: four `console.log` lines also moved and are not tables —
  `F1 buyer Sources: 5/5 → 8/8` (`b-attack.test.ts:227`), `F3 forged-stop: … sources=5 → 8` (`:434`),
  `dispatch 1: $0.0512 → $0.0516; dispatch 2 total: $0.0931 → $0.0941`, and
  `plan-spam+write-breaker: 17 loop calls / 60337 → 71036 chars … $0.0751 → $0.0764`. Those four are harmless
  (they interpolate live values and no title or comment hard-codes them) but they make the sentence inaccurate as
  written. (c) Do any of the three titles' assertions go red? No — every assertion in those tests is a bound or a
  count that survived; only the prose moved, which is exactly the failure mode the brief calls "assert the
  content, not the shape".
- fix sketch: re-measure the three titles (5.69M / 1.4× plan-once; `185k chars here (8 pages, 137k report)`;
  `$1.31 vs $2.65 … ~50%`), and while there fix `79` → `78` and the `26 pages` comment. Done naively — bumping
  only the numbers — the reader still cannot tell which of these are pinned and which are decoration; `:408`'s
  `5.07M` and `:784`'s `174k` are asserted by nothing at all, so the honest version says so.

### F2 · `8ff7312`'s "nothing an honest run relies on gets worse" is false: classifying `referenced` first grows the reserve and evicts the writer's OWN fetched pages — P2 (P1 if a real producer reaches it)

- where: `packages/core/src/engine/prompt.ts:270-281` (the comment) and `:285`
  (`const reserve = Math.min(referenced.length, Math.floor(max / 2))`); the same claim is in the commit message
  ("Nothing an honest run relies on gets worse — those items rank higher, never lower") and is contradicted by
  `:324` ("A writer's OWN fetches stay uncapped — it paid for those").
- input / observed: the *pages* call, `rankEvidence(items, MAX_PAGES=14, FOREIGN_PER_DOMAIN_PAGES=3, prefer)`,
  with 10 pages this loop fetched and 8 shortlisted pages that are BOTH `touched` and `referenced`:

  ```ts
  const own = list('mine.example', 10);          // prefer.fetched
  const shortlist = list('shortlist.example', 8); // prefer.touched AND prefer.referenced
  rankEvidence([...own, ...shortlist], 14, 3, {
    fetched: new Set(own.map(x => x.url)),
    touched: new Set(shortlist.map(x => x.url)),
    referenced: new Set(shortlist.map(x => x.url)),
  });
  ```

  - old classification (`touched` before `referenced`): **own 10/10**, shortlist 4/8 — `referenced` is empty, so
    `reserve = 0`.
  - HEAD (`referenced` first): **own 7/10**, shortlist 7/8 — `referenced.length` is now 8, so
    `reserve = min(8, 7) = 7` and `take(fetched, max - reserve)` stops at 7.

  Three full pages the agent paid to fetch leave the dossier. The overlapping items do rank higher, as claimed;
  what the claim misses is that promoting them *inflates the reserve*, and the reserve is subtracted from
  `fetched`, not from `rest`.
- status: **reproduced** at the unit level (scratch spec run against the real `rankEvidence`, once at HEAD and
  once with the classification order mutated back). **Reasoned** for production: it needs one agent with ≥8
  fetched pages in the store and ≥7 store pages that are both referenced and touched; the mock Florida run fetches
  8 pages across the *whole* job, so the fixture tier cannot exhibit it, but deal-scout's 24-turn budget and the
  July traces' "~46 iterations" make it reachable with a real backend.
- refutation attempted: (1) Is the eviction only re-ordering? No — `out` is capped at `max`, so at 14 slots the
  three own pages are absent, not late. (2) Does the snippets call save it? Only partly: at `MAX_SNIPPETS = 48`
  the same effect needs 37 fetched-and-in-store URLs (see F3), which no budget reaches — but the pages half is a
  different `max` and the comment does not distinguish them. (3) Is the trade wrong? Not necessarily — pushing a
  listing the writer was told to fill gaps in above a page it fetched itself may well be right. The finding is the
  *absolute*: the message and the source comment both say nothing gets worse, and something does.
- fix sketch: either size the reserve from the referenced items that are NOT already `fetched`/`touched`
  (`referenced.filter(x => !prefer.touched?.has(x.url)).length`), or state the trade honestly in the comment. A
  naive `reserve = Math.min(referenced.length, Math.floor(max / 4))` fixes the pages case and silently weakens the
  R8-6 protection the reserve was built for (a host cited repeatedly taking 24 of 48 snippets) — the two halves
  want different reserves and share one constant.

### F3 · The corrected comment's "37 URLs … which no research budget reaches" is right for one call site and wrong for the other — P2

- where: `packages/core/test/red-team/refute-b1.test.ts:309-315` — the comment `8ff7312` added *specifically to
  replace a false claim* about the reserve.
- input / observed: `reserve = min(referenced.length, floor(max/2))` and the reserve bites when
  `fetched.length > max - reserve`. Measured against the real function:
  - snippets, `max = 48`, referenced = 12 (this fixture's shortlist): 36 fetched → 12/12 either way; **37** fetched
    → 12/12 with the reserve, 11/12 with `reserve = 0`. **The stated 37 is exactly right here.**
  - snippets, `max = 48`, referenced = **24**: 24 fetched → 24/24 either way; **25** fetched → 24/24 with the
    reserve, 23/24 without. So 37 is not the threshold, it is *this fixture's* threshold; the general one is
    `48 - min(referenced, 24) + 1`, i.e. as low as 25.
  - **pages, `max = MAX_PAGES = 14`, referenced = 7: the threshold is 8 fetched pages** — 7 fetched → 7/7 either
    way; 8 fetched → 7/7 with the reserve, 6/7 without; 14 fetched → 7/7 with, **0/7** without.
  `rankEvidence` is called twice from `buildDossier` (`prompt.ts:333` snippets, `:337` pages). The comment's
  "which no research budget reaches" is a statement about the 48-slot call only; on the 14-slot call every
  producer with a normal fetch budget reaches it.
- status: **reproduced** (scratch spec, three-way: HEAD vs `const reserve = 0`, printing the rendered counts).
- refutation attempted: I first assumed 37 was simply wrong and tried to find a smaller snippet threshold with 12
  referenced — there is none; 36 changes nothing and 37 changes exactly one slot, so the arithmetic the commit
  message states is correct for the case it was computed on. The defect is the generalisation ("no research budget
  reaches"), not the number.
- fix sketch: say "37 for the 48-snippet call with a 12-item shortlist; **8** for the 14-page call" and note that
  the pages half is the one an honest run reaches — which also makes F2 visible. Naively adding an end-to-end pin
  for the pages case costs a new fixture that fetches 8+ pages in one agent, which is not free.

### F4 · The same batch pins production density at 8 and leaves a sibling test titled "production density (5 fresh results per query)" — P2

- where: `packages/core/test/red-team/refute-b1.test.ts:119` vs `packages/core/test/red-team-harness.test.ts:110`
  ("returns as many results per query as production does — 8, not 5"), both in this batch's blast radius.
- input / observed: the first `refute-b1` block is titled
  `B1 refute · the SNIPPET half at production density (5 fresh results per query)`. Its printed line
  (`valuation: 15 own search results, 15 rendered as [S]…`) does **not** move between densities — the `Searcher`
  mock issues queries that only 5 corpus lots can match, so the number 5 is a property of that corpus, not of
  `RESULTS_PER_QUERY`. The title nonetheless asserts that 5 *is* production density, which the harness pin added
  30 lines away in `8901f60` now denies.
- status: **reproduced** (the line is byte-identical in the density-5 and density-8 stdout; the title is what is
  wrong, not the measurement).
- refutation attempted: I checked whether the block sets its own density — it does not call
  `__setResultsPerQuery` at all, so at HEAD it runs at 8 and still prints 15/15, confirming the 5 in the title is
  corpus-shaped. So the test is fine and only its title lies.
- fix sketch: "the SNIPPET half: a wave-2 producer whose three searches return 5 fresh lots each". Renaming it
  loses nothing; leaving it means the next reader has two titles in one file that disagree about what production
  does.

### F5 · `8901f60` corrected `54 / 838,702` "where it is written" in the test but not in `deep-review.md`, where it is recorded as verified — P2

- where: `docs/plans/deep-review.md:1784`, in the living "### Checked and TRUE by round 8 (do not re-check)"
  section: "The end-to-end figures 54 / 838,702 → 13 / 53,674 reproduce to the character".
- input / observed: with `NO_PROGRESS_TURNS_LIMIT = 9999` at HEAD, `b-attack.test.ts` F5 prints
  `F5 loop calls: 54, turnsUsed: 2, total loop chars: 893430, first: 1387, last: 31687` — the commit's own new
  number. At HEAD without the mutation it prints `12 … 55928`. So neither half of the doc's pair reproduces any
  more: 838,702 was made stale by *this commit* (which updated the figure in `b-attack.test.ts:550` and in its own
  message but not here), and 13 / 53,674 was already a round-7-era figure. The line is in a section headed "do not
  re-check", which is precisely how a wrong count survives.
- status: **reproduced** (the 893,430 run; and `git blame` puts line 1784 at `585b660`, before `8901f60`).
- refutation attempted: is that section a frozen historical record, like the `roundN/` reports? It is written in
  the present tense ("reproduce to the character") and lives in the backlog document the next round is told to
  read, not in a snapshot — unlike `docs/plans/m-red-team-reports/D-legit.md`, which carries the same stale set
  (42.0k, 3.94M, $0.26, $1.63, 49.4k, 67.4k, "total < 4.5M") but has been written once and never updated, so I do
  not count it.
- fix sketch: one clause — "54 / 893,430 → 12 / 55,928 at production density (R8-30); the round-7 figures were
  54 / 838,702 → 13 / 53,674". Naively deleting the sentence loses the record that the guard was verified at all.

## Claims checked and TRUE (so nobody re-checks)

`8ff7312`
- `urlsIn` walks the value: `urlsIn({ body: 'See https://…/9182\nNext line.' })` yields exactly
  `{https://acme-brokers.com/listing/9182}`, size 1; the `"`/`\t`/real-backslash trio behaves as the new test
  asserts. Reverting to `JSON.stringify(value)` reds it (1 red).
- `referenced` is classified before `touched` in `prompt.ts:279-280`; the reserve line is unchanged at `:285`.
- The fixture's `nextLot` is 5, the "never overlap" line is gone, and the printed measurement is **44/48** at HEAD
  — the claimed new value, to the slot. With the tier emitted last it prints **8/12**, exactly as the new title
  says. The old assertion was `toBe(36)`, so the claimed 36/48 → 44/48 move is right on both sides.
- The `afterEach` now captures the restorer at set time (`const restoreExtras = __setExtraPages(LOTS)`), matching
  the first block in the file; reverting it is genuinely unobservable (0 red, see the audit).
- The `WeakSet` guard is real (`visit` marks before recursing) and keys are scanned (`scan(k)` in the object
  branch), as the message says.

`8901f60`
- `RESULTS_PER_QUERY` is 8; `__setResultsPerQuery` still exists and the second `refute-b1` block still calls it.
- Obedient control: **47,470** loop chars at HEAD (title 47.5k ✓), **41,996** at density 5 (the claimed 42.0k ✓),
  4 turns / 10 loop calls unchanged at both. Bounds 43k/52k are −9.4%/+9.5% around the measurement — the same
  ±10% band the old 38k/46k gave around 41,996.
- Florida denominator at HEAD: **172** generate = **157** loop + **15** writes, **92** turns, loop 4030.5k +
  write 546.9k = **4577.5k**, largest loop request **60.6k**, largest write **67.7k**, est. **$0.3114 / $0.6873**,
  engine search **$1.6540** — every figure in the new title, to the printed digit. `at bound` is empty for all ten
  producers at both densities, so "the run's SHAPE is unchanged" holds. deal-scout's largest request is
  60.6k / 18.1k = **3.35×** the 8-turn agent's, matching the comment's "~3.3× at production density".
- D1: write chars **47,658 vs control 16,682 = 2.86×** at HEAD (**42,582 vs 15,196 = 2.80×** at density 5) — both
  the new and the superseded figure reproduce.
- b-attack F5 at HEAD: **12 calls / 55,928 chars** (~56k ✓). With `NO_PROGRESS_TURNS_LIMIT = 9999`:
  **54 calls / 893,430 chars**, first 1,387, last 31,687 = **22.85× ≈ 23×** — the claimed number to the character.
- The harness pin exists at `red-team-harness.test.ts:110` and asserts `searchWeb(...)` returns 8.
- The "under 5M" ceiling is not padding: 4.58M against 5M is 9.2% headroom, *less* than the 14.3% the old 3.94M
  had against 4.5M. The message is also right that the ceiling no longer detects the density (at 5 the total is
  3886.9k, still under both bounds) — which is why the harness pin is the real detector.
- Both commits' `npm run typecheck` claim: clean at HEAD.

## Commit-message audit (verifiers only): every count I re-ran, claimed vs observed

Every row is one mutation, applied alone, `grep`-confirmed after substitution, followed by a full `npm test` from
the worktree root at `a37d5f5`; RED counted. Every mutation was reverted and `git status` verified clean before
the next.

| # | Commit | Claim | Claimed | Observed | Verdict |
|---|---|---|---|---|---|
| M1 | `8ff7312` | `urlsIn` back over the serialization | 1 red | **1 red** — `evidence-ranking.test.ts` › "finds a bare URL at the end of a line, and a JSON escape is not part of it (R8-18)" | ✅ exact |
| M2 | `8ff7312` | `touched` classified before `referenced` | 1 red (unit; e2e cannot see it) | **1 red** — `evidence-ranking.test.ts` › "a URL the writer's own loop also saw… (R8-19)". `refute-b1` stayed green, as stated | ✅ exact, including the parenthetical |
| M3 | `8ff7312` | `touched` emitted above `referenced` | 2 red (unit + the density e2e) | **2 red** — `evidence-ranking.test.ts` › "fetched outranks everything, and referenced outranks touched…" + `refute-b1.test.ts` › the density e2e, which printed `refiner: 8/12 … 44/48` | ✅ exact, and it confirms the "8 of 12" figure in the title |
| M4 | `8ff7312` | `const reserve = 0` | 2 red, both in `evidence-ranking` | **2 red**, both in `evidence-ranking.test.ts` ("a URL the writer's own loop also saw…" and "the referenced tier holds back slots its own fetches cannot take…"); `refute-b1` green and still printing 12/12 | ✅ exact — the point of the corrected comment stands |
| M5 | `8ff7312` | the `afterEach` restore fix | **disclosed 0 red** | **0 red** — 1109 passing with the old `__setExtraPages([])()` teardown restored | ✅ the disclosure is honest |
| M6 | `8901f60` | default density back to 5 | 2 red — the harness pin and the obedient control's lower bound | **2 red** — `red-team-harness.test.ts` › "returns as many results per query as production does — 8, not 5" (`expected […5 items] to have a length of 8`) and `d-legit.test.ts` › the obedient control (`expected 41996 to be greater than 43000`) | ✅ exact, including *which* bound |
| M7 | `8901f60` | `NO_PROGRESS_TURNS_LIMIT = 9999` → 54 calls / 893,430 chars, last 23× first | 54 / 893,430 / 23× | **54 / 893,430**, first 1,387, last 31,687 (= 22.85×) | ✅ exact to the character |

Suite totals — I ran `npm test` in this clean worktree at each commit:

| Checkout | Message claims (main) | Clean-worktree measured | Consistent? |
|---|---|---|---|
| `62b5e61` (the predecessor `8ff7312` quotes) | 1104 | **1098** = 699 + 215 + 22 + 157 + 5 | ✅ 1104 − 6 |
| `8ff7312` | 1106 = 707 + 215 + 22 + 157 + 5 | **1100** = 701 + 215 + 22 + 157 + 5 | ✅ 1106 − 6, and the per-workspace split matches (core 707 − 6 = 701) |
| `8901f60` | 1107 = 708 + 215 + 22 + 157 + 5 | **1101** = 702 + 215 + 22 + 157 + 5 | ✅ 1107 − 6, split matches |
| `a37d5f5` (this brief) | — | **1109** = 708 + 215 + 22 + 158 + 6 | ✅ the brief's number |

Both totals are right, both "up from" deltas are right, and both "Clean clone: 6 fewer" caveats are right. The
one claim in the two messages that my re-measurement does **not** support is `8901f60`'s "Nothing else in the
suite prints a figure that moved" — see F1 (three stale titles) and F4; and four non-table `console.log` lines
also moved, so the parenthetical "the remaining differences are console tables" is inaccurate even where it is
harmless. `8ff7312`'s "Nothing an honest run relies on gets worse" (F2) and its new comment's "which no research
budget reaches" (F3) are the other two claims that do not survive.
