# G3-verify — PROGRESS contract + RENDERERS (`9850bdf` C3, `73a4e79` C1, `245811f` C5, `f74f7b0` C2/C4/C6) / VERIFIER · completeness

Setup note: my worktree was handed to me at `d1ac4dd` (the BASE of the batch), not at `a11bafe`. I reset it to
`a11bafe` and ran `npm ci` there. The brief's sanity command (`packages/core && npx vitest run
test/resolution.test.ts`) does not exist — the resolution guards live in `apps/api/test/` and `apps/worker/test/`.
I ran `apps/api/test/resolution.test.ts` (1 passed) and `packages/core` (622 passed / 16 skipped), so my
measurements are of my own checkout.

## Verdict

The mechanism of all four commits is real and reaches production. `clientProgress` is on both API paths, `img: () =>
null` + `urlTransform={proseUrl}` are on **every** `<Markdown>` site in the SPA (4/4), the dead admin viewer and its
three deps are gone, every link-emitting path in the PDF goes through `mdInline`/`mdToHtml`, and `safeHref` is on all
six raw-href sites. What does **not** hold is the *completeness* half. Three things are missing for the progress
contract to be production-safe: (1) the SPA's `ProgressKind` is a hand-written COPY of the core union and **nothing
pins them** — adding a kind in `packages/core` typechecks in every package and the buyer's live line silently
disappears; this is the "seven language lists" defect one week later, and `language-lists.test.ts` is the pattern that
was not applied (**F1**). (2) The held sentence now exists in two files and has **already drifted in `en` and `es` on
the day it shipped** (**F2**). (3) The one buyer screen that was not touched — the Reports inbox — still prints the
raw phase key `held`, in English, for every parked job (**F4**), and JobView renders its step label in the report's
language and the line under it in the UI's (**F3**). Separately, the PDF's 160-code-point source clip is completely
unguarded (delete it and 638 core tests stay green, **F5**), four of the ten mutation counts in the commit messages
are wrong (**F6**), and the `≤130` figure the clip is justified with is false in the real corpus — max 167 (**F7**).

Nothing here is a P0: no buyer gets wrong money, wrong data, or an executing href. The batch's security claims all
survived my attempts to break them (see "Claims checked and TRUE").

## Findings (most severe first)

### F1 · A progress kind added to the engine ships to the buyer as a BLANK line, and no build or test says so — P1
- where: `packages/core/src/jobs/types.ts:79-99` (core union) vs `apps/fbizlab/src/api/types.ts:78-80` (a hand-written
  copy) and `apps/fbizlab/src/lib/progress-copy.ts:17` (`Record<ProgressKind, Copy>` keyed off the **copy**).
- input / observed: added `| 'summarizing'` to the core `ProgressKind` union. `packages/core`, `apps/api` and
  `apps/fbizlab` **all** typecheck clean (`tsc --noEmit`, exit 0 ×3), all suites stay green. In production the engine
  emits `kind:'summarizing'`, `clientProgress` forwards it, and `progressLine` hits `if (!copy) return null` →
  `JobView.tsx:81` renders **nothing** under the step label. The commit's claim "a missing kind or language is a build
  failure" is true only *inside* the SPA's private copy; the direction that actually happens (engine grows a kind) is
  invisible. Positive control: deleting `fr` from one `progress-copy.ts` entry **does** fail the build
  (`TS2741: Property 'fr' is missing`), so the language half of the claim holds.
- status: **reproduced** (both the mutation-is-silent run and the positive control).
- refutation attempted: is `packages/core/test/progress-kinds.test.ts` the pin? No — its `KINDS` set is a fourth
  hand-written copy; it catches *the engine emitting a kind not in the set*, not *the SPA missing one the engine has*.
  `apps/fbizlab/test/progress-copy.test.tsx`'s `KINDS` array is a fifth copy, same blindness. Would a shipped SPA even
  see the new kind? Yes — the SPA is a separately-deployed static bundle, so a new engine kind reaches an old bundle
  before any rebuild.
- reproduction, verified red under the mutation and green at HEAD (`apps/fbizlab/test/progress-kind-pin.test.tsx`):
  ```ts
  const src = readFileSync(coreTypes(), 'utf8');                       // packages/core/src/jobs/types.ts
  const CORE = [...src.match(/export type ProgressKind =([\s\S]*?);/)![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const missing = CORE.filter((k) => LANGS.some((l) => progressLine({ kind: k as ProgressKind }, l) == null));
  expect(missing, `no localized progress line for: ${missing.join(', ')}`).toEqual([]);
  // with `| 'summarizing'` in core → "no localized progress line for: summarizing: expected [ 'summarizing' ] to deeply equal []"
  ```
- fix sketch: in core, `export const PROGRESS_KINDS = [...] as const; export type ProgressKind = typeof
  PROGRESS_KINDS[number];` and land the pin above (the SPA test already reaches across into `packages/core/src` in
  `apps/fbizlab/test/languages.test.tsx`). Naive-fix cost: none for honest runs — but do **not** "fix" it by making
  `progressLine` fall back to the phase string, which would reintroduce the English internal key this commit removed.

### F2 · The held sentence is written twice and has already drifted in two of four languages — P2
- where: `packages/core/src/jobs/report-copy.ts:115-120` (`HELD_NOTICE`) vs
  `apps/fbizlab/src/lib/progress-copy.ts:33` (`held`).
- input / observed:
  - en core `…and we will **come** back to you.` / en SPA `…and we will **get** back to you.`
  - es core `No se **está gastando** nada más y **volvemos contigo**.` / es SPA `No se **gasta** nada más y **te
    avisaremos**.`
  - fr and pt are byte-identical.
  Two sources of one line, diverged in the same commit that created the second one. Worse, `heldNotice`'s own docblock
  still reads *"The progress line a buyer sees on a parked job … It is rendered raw by the client"* — after `9850bdf`
  that is false: `heldNotice()` output now lands in `message`, which the API strips for every non-admin. It is
  localized copy that only admins can read.
- status: **reproduced** (string diff of the two tables; `clientProgress` drops `message`, pinned by
  `apps/api/test/hold-e2e.test.ts:246`).
- refutation attempted: does any other consumer still render `heldNotice` to a buyer? Grepped: its only callers are
  `run-job.ts:405,447` (both into `progress.message`). No email template carries progress. So no — the core copy is
  buyer-facing nowhere.
- fix sketch: delete `HELD_NOTICE`/`heldNotice` and have `run-job` write a fixed English `message` for the trace, or
  keep one table and have the SPA import it; either way one source. Naively deleting the core copy would break the
  admin-side assertion in `hold-e2e.test.ts` that the admin sees `/pausa|paused/i` — keep an English admin sentence.
- while reading the four languages as a native would: `fr` `searched` with no detail renders `Recherche de…`, which is
  a dangling preposition ("Search of…"); `Recherche…` or `Recherche en cours…` reads. French typography also wants
  « » rather than “ ”. In `pt`, `researching` = `Pesquisando.` and `searched` (no detail) = `Pesquisando…` are the same
  word — the two states are indistinguishable. es/pt/fr copy is otherwise natural and none borrows English (pinned by
  `progress-copy.test.tsx`'s `new Set(lines).size === LANGS.length`).

### F3 · The live card shows its step label and its progress line in two different languages — P2
- where: `apps/fbizlab/src/pages/JobView.tsx:47` (`step` from `useTemplate(..., reportLang)`) vs `:80`
  (`progressLine(job.progress, lang)`).
- input / observed: a dossier bought in Spanish (`params.language='es'`) read with the switcher on English. The card
  renders `Investigando el mercado` (manifest → `reportLang`) with `Writing this section.` (→ UI `lang`) directly
  underneath. Ten lines below, the comment on `<RequestParams … lang={reportLang}>` says this exact mixing —
  *"Switching the switcher mid-wait rendered the two halves in different languages"* — is a defect the repo already
  ruled on and fixed for that card.
- status: **reproduced**:
  ```tsx
  showJob({ status: 'running', progress: { phase: 'research', kind: 'writing', updatedAt: 't' } }, /*report*/ 'es', /*ui*/ 'en');
  expect(screen.getByText('Investigando el mercado')).toBeTruthy();
  expect(screen.queryByText('Writing this section.')).toBeNull();  // ← red: "expected <p class="muted mono" …> to be null"
  ```
  The three cited tests never separate the two: `showJob(data, lang)` in `red-team-c-legit.test.tsx:30-32` sets
  `params.language` **and** `fbizlab_lang` from the same argument.
- refutation attempted: maybe the UI language is the right one and the step label is the bug? Possible, but they
  cannot both be right, and the manifest fetch is deliberately `reportLang` (with a comment). Either way the assertion
  "they agree" is the one nobody wrote.
- fix sketch: `progressLine(job.progress, LANGS.includes(reportLang as Lang) ? (reportLang as Lang) : lang)` and add
  the mixed-language case to `showJob`.

### F4 · The Reports inbox prints the internal key `held`, in English, on every parked job — and never renders `kind` — P2
- where: `apps/fbizlab/src/pages/Reports.tsx:193` — `{stepMap[j.progress.phase] ?? j.progress.phase}`, with
  `LIVE = ['queued','running','held']` (`:68`).
- input / observed: `stepMap` is built from the manifest's `steps[]`. I printed them:
  `["planning","market-analyst",…,"exec-summary-writer","assembling","done","incomplete","failed"]` — there is **no**
  `held` step (`packages/core/src/templates/phases.ts:9-12`: `LIFECYCLE_OTHER = ['incomplete','failed']`), while
  `run-job.ts:405,447` writes `phase:'held'`. So a Spanish buyer whose job is parked sees a row badged `En revisión`
  with the word `held` under it. This is the eighteenth English internal line the commit's "17 of 17 lines in English"
  fix did not reach — on the screen the buyer lands on, not the one they have to open. The inbox also never calls
  `progressLine`, so `kind`/`detail` are shipped to it (`clientProgress` on the list path, pinned by
  `progress-payload.test.ts`'s "the inbox list carries the same shape per job") and dropped on the floor.
- status: **reproduced** (manifest step ids printed via `toManifest(getTemplate('florida-business-for-sale')!, 'es')`;
  `held`/`incomplete` phases read from `run-job.ts`). Pre-existing before this batch, but squarely inside the claim it
  makes.
- refutation attempted: is `phase:'held'` reachable while `status==='held'`? Yes — that is exactly the pair
  `hold-e2e.test.ts` builds, and `approveJob` deletes `progress` only on *approve*, so it persists for the whole review
  window.
- fix sketch: add `held` to `LIFECYCLE_OTHER` with its four labels in `phases.ts`, and drop the `?? j.progress.phase`
  fallback (render nothing rather than a key). Naive alternative — rendering `progressLine` in the inbox — would put
  the search query on the list page too, which is a wider blast radius than this needs.

### F5 · The PDF's 160-code-point source-label clip is asserted by nothing — P2
- where: `packages/core/src/pdf/report-html.ts:311` (`const SOURCE_LABEL_MAX = 160`).
- input / observed: `SOURCE_LABEL_MAX = 100_000` → **638 core tests pass, 0 red**. The only test of the clip is
  `apps/fbizlab/test/red-team-refute-C1C2.test.tsx:116` ("a 5,000-char title is clipped to 160 code points"), i.e. the
  *web* copy. The commit says the title is clipped "in both renderers"; only one renderer can prove it. (The `host —`
  half of the PDF change *is* guarded: replacing `sourceLabel(s)` with `s.label || s.url` reds exactly 1 test, as
  claimed.)
- status: **reproduced**.
- refutation attempted: is the clip load-bearing in the PDF? Yes — a 5,000-char `<title>` from the red team's page is
  one `<li>` in the Sources section of a printed dossier. And the two implementations of `sourceLabel` are already
  duplicated across packages, so this is the copy most likely to drift.
- fix sketch: one line in `packages/core/test/red-team/refute-C1C2.test.ts` asserting the printed `<li>` for a
  5,000-char label is `≤ 160 + host + 3` code points and ends in `…`.

### F6 · Four of the ten mutation counts in the four commit messages are wrong — P2
- where: the commit bodies of `9850bdf`, `245811f`, `f74f7b0`.
- observed (each mutation run in my worktree at `a11bafe`, then reverted; fbizlab baseline is 5 pre-existing reds in
  `rate-limit-copy.test.tsx`, subtracted below):

  | commit | claim | observed | verdict |
  |---|---|---|---|
  | C3 | handing buyers `message` again → **5** API red | **6** (5 × `progress-payload`, + `hold-e2e` "stops telling the buyer it is paused") | ✗ |
  | C3 | sending `detail` for every kind → **3** red | **2** (1 api `progress-payload`, 1 core `clientProgress`) | ✗ |
  | C3 | dropping the SPA render → **3** red | **3** | ✓ |
  | C1 | dropping `img: () => null` → **6** viewer | **6** | ✓ |
  | C1 | dropping the PDF strip line → the PDF test | **1** | ✓ |
  | C5 | `esc(u)` back → **3** red | **2** (`c-legit` "escaped ONCE", `refute-c5c6` "same address") | ✗ |
  | C5 | numbered branch removed → **4** red | **3** | ✗ |
  | C5 | `\d+` in the list regex → **1** red | **1** | ✓ |
  | C4 | `esc(d.sourceUrl)` again → **1** | **1** | ✓ |
  | C2 | `s.label \|\| s.url` → **1** | **1** | ✓ |
  | C6 | stripping the title again → **2** red | **3** (+ `report-ready-notice` "does not let the notice reach the markup unchecked") | ✗ |
  | C4 | dropping `urlTransform` → **1** | **1** | ✓ |
- status: **reproduced** (12 mutation runs).
- refutation attempted: were the counts right at each commit and drifted since? For C3's "5", the sixth red is the
  `hold-e2e` assertion **rewritten in that same commit** (`git show 9850bdf -- apps/api/test/hold-e2e.test.ts`), so it
  was 6 then too. For C5's "3", only two of the five tests added by `245811f` touch `&` at all — the `mailto:` and
  balanced-paren tests carry no ampersand. For C6's "2", the third red is in `report-ready-notice.test.ts`, which
  `f74f7b0` itself edited. The counts were not measured the way the messages say.
- fix sketch: none in code — but these numbers are the batch's evidence, and four of ten being wrong means a reader
  cannot use them to tell a real guard from a missing one.

### F7 · "real listing titles: ≤130" is not what the real reports contain — P2
- where: the justification for `SOURCE_LABEL_MAX = 160` in `report-html.ts:311` and `lib/safe-href.ts:22`, and the
  commit body of `f74f7b0`.
- input / observed, measured over `out/local-4837f6e3/report.json` and `out/local-aa4b3edf/report.json`
  (`report.sources.items[].label`, 199 + 174 = 373 real rows):
  - `local-4837f6e3`: max **127**, p90 90, 0 over 130.
  - `local-aa4b3edf`: max **167**, p90 92, **4 over 130**, **1 over 160** — i.e. one real row today is clipped.
    The 167 is `Fla. Admin. Code Ann. R. 62-660.801 - General Permit for a Wastewater Disposal System for a Laundromat
    | State Regulations | US Law | LII / Legal Information Institute`.
  - source URLs failing `safeHref` (non `http(s)`/`mailto`): **0 / 373** — the claim's premise holds exactly.
  - host redundancy: **176 / 373 (47 %)** of rows already carry the host's registrable name inside the title. Real
    top-20 rows read `ibisworld.com — Laundromats in the US Industry Analysis, 2026 - IBISWorld`,
    `businessbroker.net — Florida Laundromats for Sale - BusinessBroker.net`,
    `smb.co — SMB.co Blog | Small Business Buying & Selling Insights`,
    `linkedin.com — … posted on the topic | LinkedIn`.
- status: **reproduced** (script over the two real reports in the main checkout, read-only).
- refutation attempted: does the clip harm the honest 167-char row? It cuts at the last `|` group ("… | LII / Legal
  Informa…"), so the identifying half survives — the clip is right, the *number quoted to justify it* is wrong, and 160
  is a near-no-op (0.3 % of real rows) rather than the "well above the real maximum" the message implies.
- fix sketch (the dedupe rule, if wanted): drop the `host — ` prefix when
  `norm(title).includes(norm(host.split('.')[0]))` with `norm = s => s.toLowerCase().replace(/[^a-z0-9]/g,'')` —
  that is the rule that turns the four rows above back into plain titles while leaving
  `polarismarketresearch.com — Coin Operated Laundries Market Size…` (host nowhere in the title, which is the whole
  point of C2) untouched. Do **not** drop the host when the title merely *resembles* an institution's name — that is
  precisely the red team's `Florida Department of Business Regulation — Official … Registry` case.

### F8 · `docs/api-reference.md` never documents the inbox's `progress` at all — P2
- where: `docs/api-reference.md:114-118` (`GET /research` response example).
- input / observed: the list example is
  `{ "jobs": [ { "jobId", "template", "title", "shortDescription", "status", "cost", "createdAt", "updatedAt",
  "finishedAt" } ] }` — no `progress`, no `mode`, no `creditsSpent`, all three of which `apps/api/src/index.ts:1478-1496`
  actually sends; and `cost` is listed unqualified although it is admin-only two paragraphs later. The commit says "the
  inbox list the same" and "docs/api-reference.md … updated", but the endpoint whose payload changed is the one the
  doc still describes wrongly. A frontend built from this doc (the SKILL's stated purpose) would not know the inbox can
  show a live step.
- status: **reproduced** (doc vs handler read side by side).
- fix sketch: add `"progress": { "phase", "kind", "detail?", "updatedAt" }`, `"mode"`, `"creditsSpent"` to the list
  example and mark `cost` admin-only there.

### Out-of-group note (not mine to own, but it invalidates the batch's green counts)
`apps/fbizlab` is **red at `a11bafe`** in a fresh `npm ci` worktree: 5 failures in `test/rate-limit-copy.test.tsx`
(`Unable to find an element with the text: /about 3 minutes/`). I checked out `d1ac4dd` for `apps/fbizlab` and it is
red there too (5 failed / 10 passed), so it predates this batch (the Turnstile commits `dce92e4`/`0ed066e` are in the
base). But every commit in the batch claims a total green count (`956`, `933`, `962`), and none of those runs can have
included this file. Group G1/G4 or whoever owns the auth screens should look.

## Claims checked and TRUE (so nobody re-checks)

- **C3 "the API hands a non-admin `{phase, kind, detail?, updatedAt}` — never `message` … the inbox list the same"** —
  true on both paths: `apps/api/src/index.ts:1493` (list) and `:1551` (detail) both call `clientProgress`, and
  `apps/api/test/progress-payload.test.ts` asserts the exact object with `toEqual` (not `toMatchObject`) on all five
  cases, plus `expect(JSON.stringify(row.progress)).not.toContain('Searched:')`. Content, not shape.
- **C3 "detail clipped to 120 and only when `kind === 'searched'`"** — true; `PROGRESS_DETAIL_MAX = 120`, both
  conditions in `clientProgress` (`types.ts:126`), and both are individually mutation-covered.
- **C3 "a progress document written before `kind` existed serves phase and updatedAt alone"** — true and tested
  (`progress-payload.test.ts` p4, `clientProgress` core test). `run-job.ts:320` always writes `kind` going forward, and
  `approveJob` (`firestore.ts:331`) deletes `progress` so a resumed job cannot keep the held line.
- **C3 "every emit in the engine and every note in the loop is tagged"** — true: I enumerated every `emit(`/`note(`
  site in `research-engine.ts` and `gather.ts`; all 19 kinds are reachable and no site is untagged. The union, the SPA
  union, `docs/api-reference.md` and `SKILL.md` list **identical** 19-item vocabularies (diffed programmatically).
- **C3 docs** — the buyer example in `docs/api-reference.md:144` no longer carries `turnsUsed`/`sourcesFound`
  (they are named only as admin-additional at `:142-143`), the non-admin `summary` description (`notice`/`sections`,
  no `warnings`) matches `index.ts:1556-1558`, and `SKILL.md:141-153` describes the shape, the closed vocabulary, the
  `searched`-only `detail`, "no `message` for a non-admin" and the old-document case.
- **C3 progress reaches only two screens** — `ReadReport.tsx` has no `progress` (confirmed by grep); no email template
  carries progress (`verifyEmail`/`reportReady`/`resetPassword` only); there is no push. So JobView + Reports is the
  complete surface, and F3/F4 are the whole remainder.
- **C1 "`img: () => null` … on the production pages"** — every `<Markdown` in `apps/fbizlab/src` (4 sites:
  `ReportViewer.tsx:136` `Prose`, `:237` deal-card risk bullets, `:263` checklist items, `:363` string-array bullets)
  passes `components={MD}` **and** `urlTransform={proseUrl}`. No `dangerouslySetInnerHTML` anywhere in
  `apps/fbizlab/src` or `apps/admin/src`. **No hole.**
- **C1 "the dead admin viewer is deleted"** — `apps/admin/src/components/` no longer contains `ReportViewer.tsx`, no
  file in `apps/admin` references it, and `react-markdown`/`recharts`/`remark-gfm` are gone from
  `apps/admin/package.json`.
- **C1/C5 "no prose path bypasses `mdInline`" in the PDF** — checked every model-prose site in `report-html.ts`:
  `riskRows` → `mdToHtml(r.detail)` (`:249`), `checklistHtml` → `mdInline(it)` (`:349`), `objectFieldsHtml` →
  `mdToHtml(v)` (`:401`), string risks → `mdInline` (`:404`), `valueHtml` → `mdToHtml`/`mdInline` (`:414,:424`),
  mention summary → `mdInline` (`:383`), sentiment overview → `mdToHtml` (`:378`). Everything else that is model text
  (`r.title`, metric `label`/`value`/`hint`, chart `title`/`description`, `p.note`, listing `business`, `d.location`,
  `m.topic`) is `esc()`-only and emits **no anchor**, so there is no path that runs the link rule without the image
  strip. Cosmetic only: literal `**bold**` / `![a](u)` would show as text in those short labels.
- **C5's balanced-paren link rule does not re-open the image beacon** — I specifically probed the one interaction the
  two regexes have (the strip is `[^\s)]*`, the link rule now accepts `\([^\s()]*\)`):
  `![Bubbles Express verified photo](https://beacon.attacker.test/p_(x).gif?ref=PZ-IMG)` → no `<img`, no `<a`, and
  `beacon.attacker.test` **absent** from the output (residue text `.gif?ref=PZ-IMG)` only); `![call now](mailto:…)`
  → removed entirely. Reproduced with a scratch test through `buildReportHtml`.
- **C2/C4 `safeHref` at all six sites** — PDF `:342` (Sources), `:382` (mention), `:407` (deal card); viewer
  `ReportViewer.tsx` deal card, mention, `SourceList`. The two `safeHref` implementations agree
  (`http(s)|mailto`), `proseUrl` additionally allows `tel:` (deliberate, tested).
- **C4 real-data premise** — 0 of 373 real source URLs fail `safeHref` (see F7), so the allowlist costs an honest run
  nothing.
- **C6 email escaping** — `escHtml` on `title` and `notice` for the HTML body, raw title in `subject` and `text`,
  raw notice in `text`; the mutation back to stripping reds 3 tests including the subject/text/body-agree assertion.

## Tests: content vs shape, and every mutation I ran

**Assert content (good):** `apps/api/test/progress-payload.test.ts` (whole-object `toEqual`, plus a negative on the
internal key `market_overview` and on the literal `Searched:`); `apps/fbizlab/test/progress-copy.test.tsx` (asserts the
rendered sentences, and `new Set(lines).size === LANGS.length` catches a copy-pasted English block — the exact hole
`language-lists.test.ts` documents); `red-team-c-legit.test.tsx:124-139` (asserts the Spanish strings on the rendered
page); `packages/core/test/red-team/refute-c5c6.test.ts` (exact HTML: `<ol start="2"><li><strong>Ubicación:</strong>…`).

**Shape / self-confirming:** `packages/core/test/progress-kinds.test.ts:17` `KINDS` and
`apps/fbizlab/test/progress-copy.test.tsx:11` `KINDS` are both hand-copied restatements of the union — they detect an
untagged emit, never a kind the SPA cannot render (F1). `red-team-c-legit.test.tsx:30` `showJob(data, lang)` collapses
report language and UI language into one argument, so the two-language case can't be seen (F3). The PDF's
`SOURCE_LABEL_MAX` has no assertion at all (F5).

**Mutations run (all reverted; worktree ends `git status` clean, core 622 passed):**

| # | mutation | file | result |
|---|---|---|---|
| 1 | `clientProgress` returns `message` too | `packages/core/src/jobs/types.ts:127` | 6 api red |
| 2 | non-admin gets `{phase,message,updatedAt}` (API-level revert) | `apps/api/src/index.ts:1493,1551` | 6 api red |
| 3 | drop the `kind==='searched'` guard | `types.ts:126` | 1 api + 1 core red (= 2) |
| 4 | `const line = null` in JobView | `JobView.tsx:80` | 3 fbizlab red (over a 5-red baseline) |
| 5 | remove `img: () => null` | `ReportViewer.tsx:131` | 6 fbizlab red |
| 6 | remove the image-strip line | `report-html.ts:127` | 1 core red |
| 7 | `href="${esc(u)}"` in `mdInline` | `report-html.ts:139` | 2 core red |
| 8 | remove the `NUMBERED_LINE` branch | `report-html.ts:177-185` | 3 core red |
| 9 | `\d+` for `\d{1,2}` | `report-html.ts:144` | 1 core red |
| 10 | `esc(d.sourceUrl)` instead of `safeHref` | `report-html.ts:408` | 1 core red |
| 11 | `esc(s.label \|\| s.url)` instead of `sourceLabel` | `report-html.ts:341` | 1 core red |
| 12 | `SOURCE_LABEL_MAX = 100000` | `report-html.ts:311` | **0 red** (F5) |
| 13 | `escHtml` → `.replace(/[<>&]/g,'')` | `email/templates.ts:37` | 3 core red |
| 14 | drop all 4 `urlTransform={proseUrl}` | `ReportViewer.tsx` | 1 fbizlab red |
| 15 | add `\| 'summarizing'` to core `ProgressKind` | `types.ts:99` | **0 red, 3 typechecks clean** (F1) |
| 16 | delete `fr` from one `progress-copy` entry | `progress-copy.ts:18` | build fails (positive control) |

Two throwaway probes were written and deleted: the `![alt](url_with_parens)` PDF probe, and
`toManifest(getTemplate('florida-business-for-sale')!, 'es').steps` to enumerate the inbox's `stepMap` keys (F4).
Two reproductions are worth porting: the F1 pin (`apps/fbizlab/test/progress-kind-pin.test.tsx`, code inline above) and
the F3 mixed-language case (a third argument to `showJob`).
