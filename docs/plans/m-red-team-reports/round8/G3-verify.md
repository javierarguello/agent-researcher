# G3-verify — what the BUYER sees and types (`apps/fbizlab`) / VERIFIER

Measured at `4b612426ebb97f9dd38f1561c047413ffd07390c` in my own worktree
(`.claude/worktrees/agent-afd1f126baac99091`), `npm ci` from scratch.

Baseline: **1065 passing** with a bare checkout, **1071 passing** after symlinking Javier's `out/` into
the worktree root (`ln -s <repo>/out out`) — the six red-team tests gated on `out/*/trace.json` are the
whole difference, exactly as the brief says. Every number below was taken against the 1071 baseline.
`git diff` and `git status` are clean at the end of the run (the `out` symlink removed).

## Verdict

The batch's claim for this group holds. I re-ran **41 of the ~51 mutations** the ten commit messages
state (the other ten name identifiers three later commits deleted); **31 reproduced the claimed count
exactly**, eight reproduced a HIGHER count than claimed (tests added by later commits in the same
batch — the claim was true when written), one reproduced LOWER for a reason the batch itself created,
and one is unreproducible because the mechanism it names no longer exists. Nothing in this group is a
P0 or a P1: the money path, the lost-input path and the two cross-package pins all bite for the reasons
their commits give. The CI claim is TRUE and I verified it the hard way. The findings below are five
P2s: one buyer-facing copy defect that was fixed in one of its three copies and left in the other two
(including the PDF), one test-file leak that makes a "control" test a cascade rather than independent
evidence, one pin whose title claims more than its assertion, one dead test left behind by a
superseded design with a comment naming code that no longer exists, and one over-claim about what a
verified quote proves.

What is TRUE and worth stating plainly, because it is the substance of the batch:

- The preview key really does include the notes, trimmed and clipped as `runPreflight` sends them, and
  really does exclude the directive block — a chip click does not spend an assisted attempt, and a
  rewritten sentence does.
- A basic (`location`) really does require a verbatim quote, really does start unticked, and really is
  left out of `applyProposals` unless asked for. All three are independently pinned.
- The draft really carries `{params, freeText}` and really reads the old bare-params shape, and the
  test really drives the buy-credits button rather than writing the draft by hand.
- `PROGRESS_KINDS` really is a cross-package pin: adding `'summarizing'` to core turns two fbizlab
  tests red without touching either package's own suite.
- `LEGACY_SHAPES` really is consumed by both copies of `normalizeSectionStatuses`: drifting either one
  reds the other's suite.
- `1ce4893`'s measured evidence for `SOURCE_LABEL_MAX = 160` is exactly right. I recomputed it over
  both runs in `out/*/sources.json`: 373 rows, p50 59, p90 90, max 167, one row over the cap.

## Findings (most severe first)

### F1 · The French and Portuguese buyer still reads "la passe" / "a passagem" in the web viewer and in the PDF they keep — the fix landed in one of the three copies, and the test only reads that one — P2

- where:
  - fixed + comment claiming the fix: `packages/core/src/jobs/report-copy.ts:73-91`
    ("The French said `la passe` and the Portuguese `a passagem`, which are a sports pass and a
    passageway. `l'étape` and `a etapa` are what a person would say.")
  - the pin, which only reads that copy: `packages/core/test/section-status.test.ts:128-136`
    (`expect(sectionsNotice('fr', [{ status: 'unenriched' }])).not.toMatch(/\bla passe\b/)`)
  - still wrong, buyer's screen: `apps/fbizlab/src/components/ReportViewer.tsx:67` (`fr`),
    `:68` (`pt`) — `unenrichedSection`
  - still wrong, the PDF: `packages/core/src/pdf/report-html.ts:207` (`fr`), `:208` (`pt`) —
    `unenrichedSection`
- input / observed: `grep -rn "la passe\|a passagem" apps packages` returns five hits. One is the core
  comment saying the words are wrong; one is the core test asserting they are gone; two are the web
  viewer's `fr`/`pt` `unenrichedSection`; one is the PDF's. (The fifth pair, in
  `florida-business-for-sale.ts`, is a chart-refiner step label — separate string, same wording.)
  The same sentence exists three times and the batch fixed one:
  - core notice fr: `…l’étape qui lui ajoute de la profondeur n’a pas abouti.`
  - viewer + PDF fr: `…la passe qui lui ajoute de la profondeur n’a pas abouti.`
  - core notice pt: `…a etapa que lhe acrescenta profundidade não foi concluída.`
  - viewer + PDF pt: `…a passagem que lhe acrescenta profundidade não foi concluída.`
  The English and Spanish diverge the same way (`the step` vs `the pass`; `la etapa` vs `la pasada`),
  so it is not only fr/pt: the notice at the top of the report and the line under the section say the
  same thing in different words in all four languages.
- status: reproduced (grep + reading all four language tables in all three files; the core test at
  `section-status.test.ts:133` passes, which is why nothing caught it).
- refutation attempted: I checked whether the viewer/PDF strings are dead — they are not:
  `ReportViewer.tsx:540` and `report-html.ts:638` render `unenrichedSection` whenever a section carries
  `status: 'unenriched'`, and `apps/fbizlab/test/section-status-parity.test.tsx` asserts the English
  form of exactly that line is on screen. I also checked whether `sectionsNotice` is the only thing a
  buyer sees — it is not; the viewer prints its line under the section body, and the PDF prints it into
  the artifact the buyer downloads and forwards.
- fix sketch: move the three `unenrichedSection`/`reconstructedSection`/`degradedSection` tables to one
  place, or — since the SPA deliberately does not depend on core — extend
  `packages/core/test/fixtures/legacy-section-shapes.ts` with a second exported table of the three
  sentences in four languages and assert it from all three suites, the way `LEGACY_SHAPES` already
  pins the coercion. Done naively (just editing the two files) an honest run loses nothing, but the
  next divergence is unpinned again: the value here is the shared fixture, not the two-word edit.

### F2 · `rate-limit-copy.test.tsx` restores a module-level config inline, so the "control" test fails as a cascade rather than as independent evidence — P2

- where: `apps/fbizlab/test/rate-limit-copy.test.tsx:270-295` — `const had = config.googleClientId;
  config.googleClientId = ''; … config.googleClientId = had;` with the restore as the last statement
  of the test body, not in a `finally` or an `afterEach`.
- input / observed: I inserted one unrelated forced failure (`expect(1, 'unrelated forced
  failure').toBe(2)`) immediately after the `about 3 minutes` assertion in the first test, and ran the
  fbizlab suite:

  ```
  === LEAK probe : RED=2
     × a build with Google sign-in not configured > does not put an environment variable name …
     × a build with Google sign-in not configured > control: the configured build still offers the Google button
  ```

  The control fails because `config.googleClientId` was never restored. Reverted.
- status: reproduced (as above).
- refutation attempted: I checked whether the control could be failing for its own reason — it cannot:
  with `googleClientId` restored the control passes, and under the `60c92a0-M3` mutation ("the Google
  button renders without a client id") the control passes precisely because the mutation makes
  `.auth-gbtn` render unconditionally. So the second red under `60c92a0`'s "the page sets the env-var
  error again 2 red" is this cascade, not a second independent assertion. The mutation's real
  independent coverage is 1.
- fix sketch: `let had: string; beforeEach(() => { had = config.googleClientId; }); afterEach(() => {
  config.googleClientId = had; });`. An honest run loses one of the two reds `60c92a0` reports.

### F3 · The cross-package pin's title says "in every language it offers"; its assertion cannot see a missing language — P2

- where: `apps/fbizlab/test/progress-kind-pin.test.tsx:23-31`; the fallback that defeats it is
  `apps/fbizlab/src/lib/progress-copy.ts:52` — `const base = copy[lang] ?? copy.en;`
- input / observed: I deleted the `es` entry from one kind (`fetched`) in `progress-copy.ts` and ran
  the fbizlab suite:

  ```
  === PIN drop the es line for one kind : RED=1
     × progressLine > every kind has a line in every language, and no language borrows English
  ```

  The pin test — the one whose name promises the property — stayed GREEN, because `progressLine`
  returns the English sentence and the pin only checks for `null`. The property is caught next door,
  by `progress-copy.test.tsx:18-25` (`expect(new Set(lines).size).toBe(LANGS.length)`).
- status: reproduced (as above).
- refutation attempted: I checked the pin does bite for the thing it was actually built for. It does:
  adding `'summarizing'` to `PROGRESS_KINDS` in core reds two fbizlab tests (the pin and the
  progress-copy one), which is the R7-6 direction and the point of the commit. And `Copy = Record<Lang,
  string>` makes a missing language a typecheck failure, so this is a title/assertion mismatch, not an
  open hole. Also checked the second pin test (`does not silently fall back to the internal key`):
  mutating `if (!copy) return null` to `return progress.kind` reds 2 tests, so that one is real.
- fix sketch: either rename the pin's first test to what it asserts ("covers every kind the engine
  has"), or make it read the table directly instead of going through `progressLine`'s fallback. An
  honest run loses nothing — the coverage already exists one file over.

### F4 · A test whose stated mechanism was deleted three commits later, and four comments instructing a reader to mutate code that no longer exists — P2

- where: `apps/fbizlab/test/new-report.test.tsx:700-712` (`does not snap shut when the buyer clears
  the last thing the notes filled`), plus the comments at `:317`, `:689`, `:705`, `:732`.
- input / observed: `grep -rn "setDirOpen\|dirExpanded" apps/fbizlab/src apps/fbizlab/test` returns
  four hits, all in test comments and none in `src/`. `3397da8` replaced the collapse state
  (`dirOpen`/`dirExpanded`) with the `way: 'write' | 'pick'` toggle; `2bf0b97`'s entire commit — "+1
  test (1030 → 1031). Mutation, MEASURED: drop `setDirOpen(true)` from `editDir` → 1 red" — names a
  call that is gone. At HEAD `editDir` (`NewReport.tsx:425-433`) only clears the `fromNotes` tag; the
  section's visibility does not depend on `dirVals` at all, so clearing a chip cannot close anything.
  The test it added survives with a comment that describes a mutation nobody can perform.
  It is also fully subsumed: it went red under exactly one of my 41 mutations
  (`3397da8-M5`, dropping `setWay('pick')`), together with three other tests, and it fails there at the
  *first* line (`getByRole('button', { name: 'Sunshine' })` — the fields are not on screen), i.e. for a
  reason unrelated to snapping shut. No mutation reds it alone.
- status: reproduced (grep; plus the full 41-mutation matrix below — it appears only in `3397da8-M5`
  and `16e7014-M4`, always alongside tests that assert the same thing more directly).
- refutation attempted: I looked for any code path at HEAD that could still close the section under an
  edit. `picking = way === 'pick' || assistOff` (`NewReport.tsx:412`) and `editDir` touches neither, so
  there is none. I also ran `--sequence.shuffle` on the file (34 tests) and on the whole suite; both
  green, so the test is not load-bearing for ordering either.
- fix sketch: delete the test and fix the three "Mutation that reds this: `dirExpanded`…" comments to
  name `way`/`setWay`. An honest run loses one test from the count and no coverage.

### F5 · "verified verbatim on the server — is theirs" claims more than `verbatim()` establishes: a quote proves the words are the buyer's, not that they support the value — and a quoted value arrives ticked AND written onto the form — P2

- where: `packages/core/src/moderation/enrich.ts:300-305` (`verbatim`), `:472-476` (the quote gates the
  default), `apps/fbizlab/src/pages/NewReport.tsx:183` (`out[k] = !!proposals.quotes?.[k]`) and
  `:637-650` (a ticked proposal is written into `params[dirKey]` before the buyer has clicked
  anything). The claim is in `38bfc53`'s message ("A directive the API could quote — the buyer's own
  words, verified verbatim on the server — is theirs") and repeated in the code comment at
  `NewReport.tsx:170-176`.
- input / observed: scratch test against the real Florida template
  (`packages/core/test/zz-g3v-scratch.test.ts`, since deleted):

  ```ts
  const notes = 'quiero un negocio de bajo riesgo, que se maneje sola';
  acceptProposals(florida, base, {
    directives: { riskAppetite: { value: 'opportunistic', quote: 'bajo riesgo' } },
    keywords: [],
  }, notes);
  // → {"directives":{"riskAppetite":"opportunistic"},"keywords":[],
  //    "quotes":{"riskAppetite":"bajo riesgo"}}
  ```

  The value is the opposite of what the buyer wrote; the quote is the buyer's real words; the API
  returns it as quoted, so `defaultAccepted` ticks it and `runPreflight` writes `opportunistic` onto
  the form before the buyer sees the dialog. Round 7 measured this shape at 2 of 10 real notes
  ("low risk" → `financial_distress`).
- status: reproduced (scratch test above, run against `getTemplate('florida-business-for-sale')`).
- refutation attempted: the design's defence is visibility, and it is real — the modal row shows
  `Risk appetite: Opportunistic — «bajo riesgo»` and the form shows `✎ from your notes — «bajo riesgo»`
  next to the chip, one click from being changed. That is why this is P2 and not P1, and it is Javier's
  recorded decision. What is not true is the framing: `verbatim()` is a substring test
  (`flatten(text).includes(flatten(q))`) and establishes provenance, not support. It is stated
  correctly for BASICS ("an inference is worse than an omission") and overstated for directives, which
  the same message says "decide which listings get shortlisted".
- fix sketch: none required for behaviour. If it is worth tightening, the cheap version is to require
  that the quote and the value co-occur in the model's answer *and* that the field's option label or a
  declared synonym appears in the quoted span — but that reintroduces exactly the "throws away the good
  half" cost the commit argues against, so the honest fix is to correct the two claims to say what the
  quote proves.

## Claims checked and TRUE (so nobody re-checks)

- **The CI claim (`60c92a0`), verified the hard way.** My worktree had no `.env.local` at all (it is
  gitignored, so a fresh worktree never gets one). Full root `npm test`: **1071 passing**. I then
  copied Javier's `apps/fbizlab/.env.local` in and re-ran the full root suite: **1071 passing**,
  identical file-by-file. So the suite neither needs the file nor is changed by it — `vitest.config.ts`'s
  `env` block wins either way. The gating mutation (delete the `env` block with no `.env.local` present)
  reds exactly one test, and it is the control the message names.
- **`PROGRESS_KINDS` is a real cross-package pin.** Added `'summerizing'`-style extra kind
  (`'summarizing'`) to `packages/core/src/jobs/types.ts:110`, ran the fbizlab suite: 2 red
  (`progress-kind-pin.test.tsx` and `progress-copy.test.tsx`), reverted, green.
- **`LEGACY_SHAPES` really pins both copies.** Drifting the fbizlab copy
  (`section-status.ts:41`, unknown status → `unenriched` instead of `lost`) reds 2 fbizlab parity
  cases; drifting core's copy (adding `partially_enriched` to `KNOWN`) reds the matching core case.
  The failures are the `$why` rows of the shared table in both suites, so the fixture is genuinely
  consumed by both and not shadowed.
- **No two progress kinds read the same, in any of the four languages.** Checked programmatically over
  `PROGRESS_KINDS × LANGS` via `progressLine`: zero duplicate strings. `cut_off` vs `stopped` and
  `cached` vs `fetched` are each separately asserted in `progress-copy.test.tsx`.
- **The Spanish table in `NewReport.tsx` is consistent tuteo.** The one voseo string `c0805a7` reports
  replacing (`'O elegilas vos'`) is gone; the rest of the new copy is `Elígelos tú mismo`, `Describe lo
  que buscas`, `Marca lo que reconozcas`, `revísalos y cambia lo que quieras`, `Un campo que tocas pasa
  a ser tuyo`, `Elige tus preferencias a mano`. No voseo imperative or `vos` pronoun anywhere in
  `apps/fbizlab/src` (French `vos` hits are the possessive).
- **No language borrows English in the new `NewReport.tsx` copy.** Machine-compared all 88 string keys
  across the four blocks: the only identical en/other pair is `mode.fr = 'Mode'`, which is the French
  word. `report-copy.ts` (`REBUILT_ONE`/`REBUILT_MANY`), `phases.ts` (`held`, four languages, label +
  description), `progress-copy.ts` (`cut_off`, `cached`) and `ReportViewer.tsx`/`report-html.ts`
  (`reconstructedSection`) are all genuinely translated and distinct per language — see F1 for the one
  place two of the three copies disagree with the third.
- **`held` says something true.** `held`'s progress line ("Nothing more is being spent, and we will get
  back to you") matches `run-job.ts:405-411` and `:447-453`, which set the progress and return without
  further work; `heldNotice` really is deleted and `progress.message` is English and admin-side.
  The step description (`phases.ts`) is deliberately a different sentence from the progress line, and
  `job-view.test.tsx` asserts both appear.
- **`cut_off` says something true.** `gather.ts:598` maps `done|budget → stopped` and everything else
  (`stalled`, `ceiling`) → `cut_off`; the plan-only and no-progress breakers emit `cut_off` directly
  (`:390`, `:394`). I checked the one boundary that could make `stopped` a lie — `gather.ts:591`
  relabelling `stalled → budget` when `turnsUsed >= maxTurns` — and it cannot fire for the case the
  commit is about: `turnsUsed` is incremented only by `web_search` and `fetch_page` (`:469`, `:542`), so
  a loop force-stopped with zero searches has `turnsUsed === 0` and stays `cut_off`. The relabel only
  catches a loop that spent its whole allowance and then plan-looped, which is the documented case.
- **`new-report.test.tsx` has no residual dependence on the old `mockClear` leakage.** `--sequence.shuffle`
  on that file (34 tests) and on the whole fbizlab suite (145): green every run. The two
  `mockRejectedValue` tests and the `mockResolvedValueOnce` tests are all isolated by the new
  `mockReset()` + re-installed default. (`hooks.createJob` still uses `mockClear`, which is correct —
  no test overrides its implementation.)
- **`1ce4893`'s measured evidence is exact.** Recomputed over `out/*/sources.json`: 373 rows, p50 59
  code points, p90 90, max 167, exactly one row above `SOURCE_LABEL_MAX = 160`. The message says
  "p90 90, max 167, one row clipped". True.
- **The money path.** `submit()` builds from `cleanParams()` and applies corrections field by field
  (`NewReport.tsx:711-713`); `correctedParams` is never submitted wholesale; `proposedParams` is not
  read by this client at all; only the ticked subset is merged, and `chosen.directives` is forced to
  `{}` because the form already holds them. A 429 on the preview does not become an order
  (`:682-691`), and the control that a 5xx still generates is present. All four are independently
  pinned — I mutated each and got red.

## Commit-message audit (verifier) — every count I re-ran, claimed vs observed

Method: one mutation at a time in my worktree, revert, `git diff` clean between each. Scope `fb` =
`npx vitest run` in `apps/fbizlab` (equivalent for SPA-only mutations, since `npm test` is `vitest run`
with no typecheck); scope `all` = full root `npm test`. Note that root `npm test` chains workspaces with
`&&`, so a core failure short-circuits before fbizlab runs — for core mutations I confirmed the red was
inside the workspace that reports it.

| commit | mutation (as the message names it) | claimed | observed @HEAD | note |
|---|---|---|---|---|
| `38bfc53` | quote taken on trust (no verbatim check) | 1 | **1** | ✔ |
| `38bfc53` | everything pre-ticked again | 2 | **4** | grew — later commits added two tests that read the tick defaults |
| `38bfc53` | basics pre-ticked | 2 | **2** | ✔ |
| `38bfc53` | a basic needs no quote | 1 | **1** | ✔ |
| `38bfc53` | location not fillable | 1 | **1** | ✔ |
| `38bfc53` | applyProposals applies basics by default | 1 | **1** | ✔ |
| `38bfc53` | summary folds the proposals back in | 1 | **1** | ✔ (red is in `apps/api`) |
| `38bfc53` | the ticked subset ignored on submit | 3 | **2** | **shrank** — `16e7014` moved directives onto the form, so `chosen.directives` is always `{}` and the third red moved to the `defaultAccepted` tests |
| `929e8dd` | preview key ignores the notes again | 2 | **3** | grew |
| `929e8dd` | useless preflight submits the stale review | 1 | **1** | ✔ — the one the message says first measured 0 red; it bites now |
| `929e8dd` | retired params stripped again | 2 | **2** | ✔ |
| `929e8dd` | retired check runs after the schema | 1 | **1** | ✔ (moved the whole block below the `safeParse`) |
| `f33ecce` | no legacy-phase coercion in clientProgress | 1 | **1** | ✔ |
| `f33ecce` | coerce EVERY phase into a kind | 2 | **2** | ✔ |
| `f33ecce` | held is not a lifecycle phase again | 1 | **1** | ✔ |
| `f33ecce` | core grows a kind no client knows | 1 | **2** | grew — `2c346de` made `progress-copy.test.tsx` read `PROGRESS_KINDS` too. **The pin bites.** |
| `f33ecce` | inbox falls back to the internal key | 1 | **1** | ✔ |
| `16e7014` | preferences open by default (both sections at once) | 1 | — | superseded by `3397da8`; see its row below |
| `16e7014` | the block ignores what it holds | 2 | — | superseded (`dirExpanded` deleted) |
| `16e7014` | no fallback when the assist is off | 1 | **2** | grew (same mutation as `3397da8`'s fourth) |
| `16e7014` | the directive block back in the preview key | 7 | **9** | grew |
| `16e7014` | proposals stay in the modal, never reach the form | 3 | **3** | ✔ |
| `16e7014` | a hand edit keeps the "from your notes" tag | 1 | **1** | ✔ |
| `16e7014` | the corrected snapshot submitted wholesale again | 1 | **1** | ✔ |
| `16e7014` | the notes box never folds | 2 | — | superseded (the fold became the toggle) |
| `c0805a7` | explanation back in the 10px uppercase strip | 1 | **1** | ✔ (approximated as `.nr-lead` → `.nr-hint`, which is what the test reads) |
| `c0805a7` | a collapsed section renders nothing (the bug) | 1 | — | superseded (no collapsed state) |
| `c0805a7` | one static lead whatever the state | 2 | **2** | ✔ |
| `c0805a7` | no counter | 2 | **2** | ✔ |
| `c0805a7` | the form never says the assist was off | 1 | **1** | ✔ |
| `3397da8` | both inputs on screen at once again | 14 | **12** / 4 | 12 for the faithful form (render both branches **and** drop the toggle); 4 for the conservative form (render both, keep the toggle). Direction and magnitude hold; the exact 14 is not reproducible at HEAD |
| `3397da8` | the notes are dropped when switching to the fields | 1 | **2** | grew |
| `3397da8` | the box still offered when the assist is spent | 1 | **1** | ✔ — the one the message says first measured 0 red; it bites now |
| `3397da8` | the fields not forced when the assist is off | 1 | **2** | grew |
| `3397da8` | a filled review does not show what it produced | 4 | **4** | ✔ |
| `3397da8` | the lead never changes with the state | 2 | **2** | ✔ |
| `2bf0b97` | drop `setDirOpen(true)` from `editDir` | 1 | **n/a** | **not reproducible** — `setDirOpen` was deleted by `3397da8`. See F4 |
| `0497861` | the draft drops the notes again | 1 | **1** | ✔ — the one the message says first measured 0 red until the test clicked the button; it bites through the button now |
| `0497861` | an old draft read as the new shape | 1 | **1** | ✔ |
| `0497861` | the keyword instruction loses the rule | 1 | **1** | ✔ |
| `2c346de` | every loop exit is `stopped` again | 1 | **1** | ✔ |
| `2c346de` | the plan breaker calls itself complete | 1 | **1** | ✔ |
| `2c346de` | detail clipped by UTF-16 unit again | 1 | **1** | ✔ |
| `2c346de` | the finalize pass says planning | 1 | **1** | ✔ |
| `2c346de` | the live line back to the UI language | 1 | **1** | ✔ |
| `2c346de` | `cached` claims a re-read again | 1 | **1** | ✔ |
| `1ce4893` | proseUrl accepts scheme-less urls again | 2 | **2** | ✔ (`/^[^:]*$/` restored as an alternative) |
| `1ce4893` | the PDF drops `tel:` again | 1 | **1** | ✔ |
| `1ce4893` | the tooltip carries the raw label again | 2 | **2** | ✔ |
| `1ce4893` | the PDF's source-label clip lifted | 2 | **2** | ✔ |
| `1ce4893` | the web copy of the clip lifted | 2 | **2** | ✔ |
| `60c92a0` | suite has no env, `.env.local` moved away | 1 | **1** | ✔ — and the red is the control test, exactly as the message explains |
| `60c92a0` | the page sets the env-var error again | 2 | **2** | number matches, but **one of the two is a cascade** from the un-restored `config.googleClientId` — see F2. Independent coverage is 1 |
| `60c92a0` | the Google button renders without a client id | 1 | **1** | ✔ |

Additional pin mutations I ran that no commit message claims, to check the pins bite:

| pin | mutation | observed |
|---|---|---|
| `progress-kind-pin.test.tsx` | `progressLine` returns the kind instead of `null` for an unknown kind | **2 red** |
| `progress-kind-pin.test.tsx` | delete the `es` line for one kind | **1 red — and it is NOT the pin.** See F3 |
| `section-status-parity.test.tsx` | fbizlab copy: unknown status → `unenriched` | **2 red** (fbizlab) |
| `packages/core/test/section-status.test.ts` | core copy: `partially_enriched` added to `KNOWN` | **1 red** (core) |
| `rate-limit-copy.test.tsx` | forced unrelated failure in the first Google test | **2 red** (the cascade of F2) |

Suite totals I did not re-measure: the per-commit "1000 → 1008", "1023 → 1025", … figures in the ten
messages. Verifying them needs a checkout per commit, which the brief rules out for my worktree. What I
did verify is the endpoint the whole chain claims — the batch's final total — and it is right: **1071**
in this checkout with `out/`, **1065** without, and the six-test gap is exactly the `out/*/trace.json`
gate. `2c346de`'s own correction of `1ce4893`'s and `90a355f`'s counts (1044→1043, 1049→1046) is
consistent with that arithmetic.
