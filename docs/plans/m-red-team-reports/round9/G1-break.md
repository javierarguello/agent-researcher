# G1-break — the ENGINE (`8ff7312` evidence tiers, `8901f60` search density) / BREAK

Measured at `a37d5f57f2f4f9f042ba704a6dec96a7b7aa68da` in my own worktree.
`npm ci` + `npm test` from the worktree root: **1109 passed, 0 failed** (708 core + 215 api + 22 worker +
158 fbizlab + 6 admin), 16 skipped in core — the brief's clean-worktree number, so `out/*/trace.json` is
absent and the six trace-gated tests did not run. I did not symlink `out/`.
Every mutation below was run as `npx vitest run` in `packages/core` (a red core suite is what `npm test`
stops on), and `git diff` / `git status --porcelain` are empty at the time of writing.

## Verdict

The two *source* changes are sound. `urlsIn` walking the value is strictly better than walking the
serialization — I diffed the old and new implementations over 22 section shapes and found **no case where the
new walk collects a URL the old one did not deserve to collect**; every difference is the escape artefact the
commit describes, plus two robustness wins (a cycle and a `BigInt` no longer throw). Classifying `referenced`
before `touched` is right, and both source mutations red the tests the commit says they red, for the stated
reason. What did NOT survive is the *test* half of `8ff7312`. Changing the density fixture's `nextLot` from
20 to 5 made the refiner's own results overlap the shortlist — and, as a side effect nobody measured, it made
the store's insertion order already equal to the answer. **The end-to-end test that stands behind the whole
evidence-tier feature now passes with `rankEvidence` deleted from the snippet dossier**; at `nextLot = 20` it
did not. That is a fix that removed the only end-to-end detection the tier had, and it is F1. Beyond that,
three claims in the commit and in the test's own title/comments are false as written, and one of them
(`8901f60`'s claim that only three published figures moved) leaves a stale test-behaviour description in a
report doc. `8901f60`'s two asserted re-measurements and its 2-red revert both reproduce exactly.

## Findings (most severe first)

### F1 · `nextLot` 20 → 5 makes the density e2e — the only end-to-end pin on the evidence tiers — green with `rankEvidence` removed entirely — P1

- where: `packages/core/test/red-team/refute-b1.test.ts:238` (`private nextLot = 5;`), assertions at
  `:302` (`expect(own.length).toBe(48)`), `:319` (`referencedVisible === 12`) and `:322`
  (`expect(ownVisible).toBe(44)`); the ranking it is supposed to stand behind is
  `packages/core/src/engine/prompt.ts:333` (`rankEvidence(evidence, MAX_SNIPPETS, …)` inside `buildDossier`).
- input / observed: with `nextLot = 5` the scout's six searches put lots 1..48 into the store first, and the
  refiner's six searches return lots 5..52 — only lots 49..52 are new. I instrumented the test to print the
  store:

  ```
  STORE: 52 sources; shortlist-in-first-48=12; refiner-own-in-first-48=44
  ```

  The naive store-order head of 48 therefore contains **all 12** shortlisted listings and **44** of the
  refiner's own 48 results — i.e. exactly the two numbers the test asserts. Replacing the snippet ranking with
  a plain slice:

  ```ts
  // packages/core/src/engine/prompt.ts:333
  const ranked = evidence.slice(0, MAX_SNIPPETS);   // was rankEvidence(evidence, MAX_SNIPPETS, …, prefer)
  ```

  leaves the density test **GREEN**, still printing `refiner: 12/12 shortlisted listings and 44/48 of its own
  results rendered as [S]`. (The sibling block at `:119`, whose comment already names this mutation, goes red —
  so the mutation is real and applied.) The same mutation against the pre-commit fixture (`git checkout
  8ff7312^ -- packages/core/test/red-team/refute-b1.test.ts`, `nextLot = 20`) reds BOTH blocks: the refiner
  printed `12/12 … and 29/48` against its asserted 36. So the detection existed before `8ff7312` and was
  removed by it.
- status: **reproduced** — three runs of `npx vitest run test/red-team/refute-b1.test.ts`: HEAD fixture +
  ranking dropped → 1 failed / 1 passed (the density test passed); `8ff7312^` fixture + ranking dropped →
  2 failed; HEAD unmutated → 2 passed. Store figures from a temporary `console.log` in the test, reverted.
- refutation attempted: (a) maybe the test never claimed to detect "no ranking at all" — but the comment at
  `:317-321` says "What this proves is the ORDER", and the pre-commit version *did* detect it; the ability was
  lost silently, unmeasured, in a commit whose stated purpose was to make the fixture more production-shaped.
  (b) Maybe the tier-order mutation is the only one that matters — but it is precisely because the store head
  already holds the answer that this fixture is no longer a *density* fixture: the R7-2 premise is "the
  agent's own SERP rows are FRESH and flood the store past the 48". At `nextLot = 20` the refiner contributed
  48 fresh sources and the store was 67; at `nextLot = 5` it contributes 4 and the store is 52. (c) I checked
  the test still detects something: emitting `touched` above `referenced` reds it (12 → 8), so it is not dead —
  it is narrower than its own comment says.
- fix sketch: keep the overlap (it is the right production shape) but stop the scout's store head from being
  the answer — e.g. let the scout search lots 1..48 as now, shortlist twelve lots **from the far end**
  (`SHORTLISTED = lots 41..52`) so the shortlist is not wholly inside the first 48, and have the refiner search
  `nextLot = 45` so eight of its results overlap. Then re-measure `referencedVisible` / `ownVisible` and put
  the true numbers in. What an honest run loses if done naively: raising `nextLot` back to 20 restores the
  detection but re-excludes R8-19's shape, which is what round 8 correctly complained about — the fixture needs
  BOTH the overlap and a shortlist that store order does not hand over for free.

### F2 · Two statements about which listings the refiner searches are false, one of them in a test title — P2

- where: `packages/core/test/red-team/refute-b1.test.ts:233` ("The refiner's searches return the FIRST EIGHT
  listings it was handed") and `:276` (the test title's "… with the tier last: 8 of 12, **and only the eight it
  happened to search up**"); the same sentence is in `8ff7312`'s message ("The refiner's searches now return the
  first eight listings it was handed").
- input / observed: `nextLot = 5` and eight per search means the refiner's first query returns lots **5..12** —
  the *last* eight of the twelve, not the first eight. And with the tier emitted last, the eight that render
  are lots **1..8**, of which it searched up only four. Instrumented print under the emission mutation:

  ```
  refiner: 8/12 shortlisted listings and 44/48 of its own results rendered as [S]
  WHICH-SHORTLISTED-RENDER: 1,2,3,4,5,6,7,8,-,-,-,- | refiner searched lots: 5,6,7,8,9,10,11,12,13,14
  ```

  So "only the eight it happened to search up" is exactly backwards: the eight that survive are the eight it
  did NOT go looking for, and four of the eight it did search up are the ones dropped.
- status: **reproduced** (mutation `take(touched, max)` moved above `takeSpread(referenced, max)` in
  `prompt.ts:325-327`, plus a temporary `console.log` in the test; both reverted).
- refutation attempted: I checked whether "first eight" could mean "the first eight of its own results" — it
  cannot; the sentence is "the first eight listings **it was handed**", and the twelve it was handed are
  `SHORTLISTED = lotUrl(1..12)`. I also checked the 8/12 number itself: correct and reproducible.
- fix sketch: "the LAST eight of the twelve listings it was handed", and drop the "only the eight it happened
  to search up" clause (or replace it with "and they are the eight the shortlist happens to list first").

### F3 · The density test's second assertion (`ownVisible === 44`) is invariant under every mutation it is offered as evidence for — P2

- where: `packages/core/test/red-team/refute-b1.test.ts:318-322`, comment "What this proves is the ORDER".
- input / observed: `ownVisible` is 44 at HEAD; 44 with `touched` classified before `referenced`; 44 with
  `const reserve = 0`; 44 with `touched` emitted above `referenced`; and 44 with `rankEvidence` deleted (F1).
  Only `referencedVisible` ever moves. The assertion pins the arithmetic of the fixture, not a property of the
  ranker. The comment two lines above it does say "what it does not prove is which tier an overlapping url
  landed in", so the file is half-aware of this — but "What this proves is the ORDER" is attached to the one
  assertion that proves no order at all.
- status: **reproduced** for the emission mutation and for the ranking-dropped mutation (both printed 44);
  **reasoned** (and consistent with the commit's own "e2e cannot see it") for the classification mutation.
- refutation attempted: I looked for any tier arrangement that changes it. Because the refiner's own 48 results
  are lots 5..52 and the store's first 48 are lots 1..48, any ordering that fills 48 slots from
  {referenced ∪ touched} yields 44 of them; only an arrangement that leaves own results out entirely could move
  it, and no tier order does that.
- fix sketch: assert the composition instead of the count — e.g. that the first 12 rendered snippets are the
  twelve shortlisted URLs, which is the ORDER property and dies under both the emission mutation and F1's.

### F4 · `8ff7312`'s "Nothing an honest run relies on gets worse" is contradicted by the commit's own new unit test — P2

- where: `packages/core/src/engine/prompt.ts:275` (the comment) and `:319`
  (`take(fetched, max - reserve)`); demonstrated by `packages/core/test/evidence-ranking.test.ts:68-86`.
- input / observed: moving an item from `touched` into `referenced` grows `reserve = Math.min(referenced.length,
  Math.floor(max / 2))` (`prompt.ts:285`), and `fetched` is served `max - reserve` first. The new R8-19 test is
  itself the demonstration: 48 own **fetched** results plus 12 shortlisted-and-touched. Old classification →
  reserve 0 → all **48** own render. New classification → reserve 12 → **36** own render and 12 own fetched
  results are pushed out of the dossier (`:85` asserts exactly 36). The moved items rank higher, as claimed;
  the writer's own paid-for evidence ranks lower, which the sentence denies.
- status: **reproduced at unit level** (the assertion at `:85` is the number), **bounded as unreachable today**:
  I instrumented `rankEvidence` to log whenever `fetched.length + referenced.length > max` with a non-empty
  referenced set, and ran the whole core suite. Only three hits, all from `evidence-ranking.test.ts`; **no
  end-to-end fixture reaches it**, including the flagship Florida comprehensive run (whose largest fetcher,
  `deal-scout`, has 12 own pages but an empty `current`, and whose two refiners have 2 and 5 own pages against a
  reserve of at most 7 of 14). Instrumentation reverted.
- refutation attempted: I first suspected this was P1 for the PAGE half, since `b-legit` prints
  `store: 45 pages` against `MAX_PAGES = 14` — the page cap really does bind. It does not bite today only
  because no agent is both a heavy fetcher and an enricher: it needs `own fetched pages > 14 - reserve`, i.e. an
  enricher fetching 8+ pages while holding 7+ referenced pages. `deep-dive-refiner` (budget 10, fetched 5) is
  two fetches away from it.
- fix sketch: correct the sentence — "the moved items rank higher; the cost is that the reserve grows with
  them, so an agent that both fetched more than `max - reserve` pages and was handed referenced ones gives up
  the overflow". If the behaviour itself is unwanted, cap the reserve by what `fetched` does not need
  (`Math.min(referenced.length, Math.floor(max / 2), Math.max(0, max - fetched.length))`) — but note that
  weakens R7-2's guarantee exactly where R7-2 was about.

### F5 · A test title still calls 5 results per query "production density", in the file whose sibling block says production density is 8 — P2

- where: `packages/core/test/red-team/refute-b1.test.ts:119` —
  `describeMock('B1 refute · the SNIPPET half at production density (5 fresh results per query)', …)`, with the
  fixture's own comment at `:44-48` ("Brave-like: 5 FRESH results per query"). `:275` in the same file reads
  "at production density (8 results per query)", and `8901f60` establishes that Brave asks `count=8` and Tavily
  `max_results: 8`.
- input / observed: the block still gets exactly 5 results per query after the default moved to 8 — its queries
  carry five private tags and only five corpus pages score above zero, so `slice(0, RESULTS_PER_QUERY)` is not
  binding. `expect(out.sources.length).toBe(75)` still passes, which is how I confirmed it. The behaviour is
  fine; the label "production density" is the thing R8-30 exists to say is false.
- status: **reproduced** (the block is green and `sources.length === 75` at density 8).
- refutation attempted: the file header at `:9-10` hedges with "~5-8 fresh results per query", so the file is
  not uniformly wrong — but the `describe` title a failure report prints says 5 IS production.
- fix sketch: retitle to "the SNIPPET half with a sparse corpus (5 matching pages per query)".

### F6 · The new `urlsIn` test pins a backslash INTO the URL, so a doubly-escaped section still loses its listing — P2

- where: `packages/core/test/evidence-ranking.test.ts:208-209`
  (`urlsIn({ … c: 'https://c.example/z\\path' })` asserted to yield `'https://c.example/z\\path'`);
  the class it depends on is `prompt.ts:214` (`/https?:\/\/[^\s"'<>)\]]+/g` — `\` is not excluded).
- input / observed: a backslash cannot legally appear in a URL (RFC 3986 excludes it; browsers rewrite it to
  `/`), so any match containing one matches nothing in the store — the exact failure mode R8-18 was about. The
  case that still fails is the doubly-escaped one, which is what a model that JSON-escapes its own output
  produces: `urlsIn({ body: 'https://a.com/1\\nhttps://b.com/2' })` (a real backslash, then `n`) returns the
  single string `https://a.com/1\nhttps://b.com/2` — both listings lost. Adding `\\` to the exclusion class
  fixes it and costs nothing real, but the new test now *asserts* the opposite.
- status: **reproduced** with a standalone script running both the old and new implementations side by side
  (scratchpad `urlsin-diff.mjs`, 22 shapes).
- refutation attempted: the comment argues "a REAL backslash in the string stays part of the match — it is a
  character the section contains". True as description; but the set is consumed only as a membership test
  against store URLs (`prefer.referenced.has(it.url)`), and no store URL can contain a backslash, so the
  decision can only ever produce a miss. I could not construct a case where keeping the backslash helps.
- fix sketch: `/https?:\/\/[^\s"'<>)\]\\]+/g`, and flip the third expectation to `'https://c.example/z'`.

### F7 · `8901f60`'s "corrected where they are written" left a report doc describing the old bounds — P2

- where: `docs/plans/m-red-team-reports/D-legit.md:73-74` (and the table rows at `:11-12`).
- input / observed: `:73` says the obedient control "pins turns 4 / loop calls 10 / **loop chars 38–46k**" —
  the bounds are now 43–52k (`d-legit.test.ts:329-330`). `:74` says the flagship denominator is
  "**169 calls** … **3.94M chars** … asserts … **total < 4.5M chars**" — it is now 172 calls, 4.58M, and
  `< 5_000_000` (`d-legit.test.ts:399`). These are not historical measurements in prose; they are descriptions
  of what the live tests assert, and they now describe assertions that no longer exist.
  `docs/plans/m-red-team.md:176` likewise still divides by "10 / 42.0k control".
- status: **reproduced** (grep + the current test source and the current run's printed table).
- refutation attempted: the brief warns that a figure disagreeing with an older commit message is not
  automatically a defect, and `deep-review.md:1532-1534` explicitly says figures moved on purpose. That covers
  the *measurements*; it does not cover a sentence that states the current bound of a current assertion.
- fix sketch: update the two "asserts …" clauses in `D-legit.md:73-74` (38–46k → 43–52k; 4.5M → 5M;
  169 → 172 calls, 3.94M → 4.58M), or mark the file "measured at density 5, superseded by R8-30".

## Claims checked and TRUE (so nobody re-checks)

- **`urlsIn` walks the value correctly and collects nothing extra.** I ran the pre-`8ff7312` and post-`8ff7312`
  implementations side by side over 22 section shapes (bare URL at end of line, markdown link, `sourceUrl`
  object, parens in path, tab, real backslash, non-ASCII, URL inside real quotes, URL as an object KEY, deep
  nesting, adjacent array strings, numbers/booleans/null/undefined, `Date`, HTML `href`, `#frag` with an
  apostrophe, cycle, `BigInt`). Every difference is the escape artefact the commit describes or a robustness
  win (`JSON.stringify` threw `TypeError` on the cycle and on the `BigInt`; the walk does not). **No shape
  where the new walk produces a URL it should not.** Scanning object keys matches the old serialization's
  behaviour, and the `WeakSet` is a visited-set on a value that is idempotent to re-visit, so it cannot lose a
  URL from a shared (non-cyclic) sub-object.
- **`referenced` before `touched` is the right classification** and the reserve growth is the only side effect;
  the moved items never rank lower.
- **44/48 is correct** and is what the test prints at HEAD.
- **"with the tier last: 8 of 12" is reproducible** (the count, not the clause after it — see F2).
- **`8901f60`'s re-measurements reproduce exactly** in my worktree: obedient control 47,470 loop chars (title
  says 47.5k, bounds 43k/52k); Florida comprehensive `172 calls / 157 loop / 92 turns / 15 writes / 4030.5k +
  546.9k = 4577.5k / largest loop 60.6k / largest write 67.7k / $0.3114 + $0.6873 LLM / $1.6540 search` —
  every figure in the re-written title; D1 `write chars 47658 vs control 16682 (2.86×)` → "2.9×";
  B-attack F5 `12 loop calls / 55,928 chars` → "12 and ~56k".
- **`__setResultsPerQuery(5)` still works** and the sparse-corpus escape hatch is intact.

## Mutations run (mine, not the verifier's audit — I ran them to check the tests pin what they claim)

| mutation | commit claims | I observed | reds for the stated reason? |
| --- | --- | --- | --- |
| `urlsIn` back over `JSON.stringify` (`prompt.ts:211`) | 1 red | **1 red** — `evidence-ranking > urlsIn … (R8-18)` | yes |
| `touched` classified before `referenced` (`prompt.ts:277-279`) | 1 red, unit only, "e2e cannot see it" | **1 red** — `evidence-ranking > … (R8-19)`; density e2e green | yes, and the e2e blindness is real |
| `touched` emitted above `referenced` (`prompt.ts:325-327`) | 2 red (unit + density e2e) | **2 red** — `evidence-ranking > fetched outranks everything…` and the density e2e (prints 8/12) | yes |
| `const reserve = 0` (`prompt.ts:285`) | 2 red, both unit | **2 red** — both in `evidence-ranking`; density e2e green | yes |
| `RESULTS_PER_QUERY` 8 → 5 (`fake-web.ts:259`) | 2 red — harness pin + obedient control lower bound | **2 red** — `red-team-harness > returns as many results per query as production does` and `d-legit > 1 · honest baseline…` | yes |
| **`rankEvidence` dropped for snippets** (`prompt.ts:333`) — mine, not the commit's | (the sibling block at `:119` names it) | **density e2e GREEN**, sibling block red | **no — this is F1** |
