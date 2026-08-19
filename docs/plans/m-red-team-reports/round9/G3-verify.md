# G3-verify — what the buyer reads (`62b5e61`, `0250063`) / VERIFY

Measured at **`a37d5f57f2f4f9f042ba704a6dec96a7b7aa68da`** (the brief's own commit), in my own worktree, no `out/`
symlink. Baseline `npm test`: **1109 passed, 0 failed, 16 skipped in core** — `708 + 215 + 22 + 158 + 6`, exactly
the clean-worktree number the brief predicts. `npm run typecheck` clean. For the commit-message totals I also
measured in `ff45ae7`, `62b5e61`, `8d2df52` and `0250063` (checkouts of this same worktree, `npm ci` unchanged —
no dependency moved anywhere in the batch); I returned to `a37d5f5` and `git status` is clean.

## Verdict

Both commits do what they say, and every number in both messages is right except one. All nine revert-verified
mutation counts reproduce exactly (2/2/1/4/3/1 for `62b5e61`, 1/1/1 for `0250063`), all four suite totals and both
"up from" deltas reproduce to the unit once the 6 `out/*/trace.json`-gated core tests are added back, the fr/pt/es
chart-refiner strings really are fixed and nothing else in `florida-business-for-sale.ts` carries the same
mistranslation, `sourceLabel` really does clip at 160 so the old C1C2 pin's tooltip really is 188 characters
against a 320 bound it cannot reach, and the by-hand link check holds in substance. Two things do not hold. The
`Record<SectionStatus['status'], true>` pin is real but it pins the wrong half: a fourth status added the way the
type errors push you to add it — union, both `KNOWN_STATUSES`, `SECTION_STATUSES`, the `written` record — leaves
`npm test` at **1109 passed, 0 failed** while both renderers print that section's body with **no advisory line at
all** and `sectionsNotice` returns `''`, which is not "a status no renderer knows yet must not reach a buyer's
screen" (F1). And `0250063`'s "the two artifacts now agree in both directions" is true for `"title"` only: with
CommonMark's other two title delimiters the viewer still renders a clean anchor while the PDF still prints
`[the listing](https://… 'title')` with the brackets showing — the R8-34 damage, unclosed (F2). Neither is a
regression this batch introduced; both are gaps between what the commits claim and what they pinned.

## Findings (most severe first)

### F1 · A fourth section status ships fully green in both renderers with no advisory line and an empty cover notice — the new pin does not cover what its own comment claims — P2

- where: `packages/core/test/fixtures/section-lines.ts:24-36` (the claim, and `SectionLineKey` hand-listed with
  three keys and nothing tying it to `SECTION_STATUSES`), `packages/core/src/pdf/report-html.ts:530-532` and
  `:645-651`, `apps/fbizlab/src/components/ReportViewer.tsx:476-478` and `:550-555`,
  `packages/core/src/engine/section-status.ts:69-71` (the same claim in the source comment).
- input / observed: added a fourth status `'partial'` the way the type layer forces you to — the union in
  `packages/core/src/engine/section-status.ts:40` and `apps/fbizlab/src/lib/section-status.ts:25`, both
  `KNOWN_STATUSES`, `SECTION_STATUSES` in the fixture, `partial: true` in the `written` record at
  `packages/core/test/section-status.test.ts:405`, and `partial: 1` in `research-engine.ts:973`'s `RANK`.
  Result: `npm test` → **708 + 215 + 22 + 158 + 6 = 1109 passed, 0 failed**. Rendering that status through the
  production PDF path (`buildReportHtml`, `meta.sections = [{ key:'market', status:'partial' }]`, en):

  ```
  partial        body: true   advisory: NONE
  unenriched     body: true   advisory: adds-extra-depth
  reconstructed  body: true   advisory: researches-this-section
  lost           body: false  advisory: could-not-complete
  ```

  and `sectionsNotice('en', [{ key:'market', status:'partial' }])` → `""` (the other three return their
  sentence). The viewer has the identical three hard-coded membership sets, so it behaves the same. So the buyer
  gets a section whose provenance the engine flagged, with nothing said about it anywhere in the artifact —
  which is the failure mode this whole file exists to prevent, one status later.
- status: **reproduced** (full `npm test` for the shipped-fourth-status tree; `npx tsx` probe against
  `buildReportHtml` + `getPdfTheme` and against `sectionsNotice`, both in my scratchpad; all mutations reverted,
  `git status` clean).
- refutation attempted:
  (a) *Does the type trick catch it?* It fires — union-only gives
  `test/section-status.test.ts(405,11): error TS2741: Property 'partial' is missing … Record<"lost" | "unenriched"
  | "reconstructed" | "partial", true>` — but it only forces you to **name** the status, not to give it a line.
  Once `partial: true` is added, every pin is green again. It is also not the first error you see: `tsc --noEmit`
  over `src` fails first at `research-engine.ts:973`, `run-job.ts:533` and `report-html.ts:543`, and
  `packages/core/package.json`'s `tsc --noEmit && tsc --noEmit -p tsconfig.test.json` means the test-tree check
  does not run at all until those three are fixed.
  (b) *Does `npm test` catch the union change on its own?* No — I ran it: union-only is **1109 passed, 0 failed**.
  Types are erased by vitest, so "a type error before it is a red test" is only true for someone who runs
  `npm run typecheck`.
  (c) *Is there some other test tying copy to status?* Grepped `SECTION_LINES` / `SectionLineKey` /
  `SECTION_STATUSES` across both suites: the line table and the status list are two independent hand-maintained
  constants in the same file, asserted against different things.
  (d) *Is this in scope, or am I re-describing R8-17?* R8-17 is the cached-bundle direction, and the batch pins
  that one correctly — mutation D (bundle forgets `reconstructed`) is 4 red, exactly as claimed. This is the
  other direction the same comment claims to have closed and did not.
- fix sketch: derive the copy keys from the status list rather than listing them twice — e.g. make the fixture
  `SECTION_LINES: Record<Lang, Record<SectionStatus['status'], string>>` and have both readers index by
  `x.status`, so a fourth status is a missing-property type error in the fixture and a red key-for-key parity
  test in both readers. What a naive version costs an honest run: mechanically deriving key names renames
  `degradedSection` → `lostSection` in two shipped copies, and `RL` is also the table a cached buyer bundle is
  already holding — the rename has to leave the existing three keys spelled exactly as they are today.

### F2 · An ordinary titled link still reaches the buyer's kept PDF as raw Markdown when the title uses either of CommonMark's other two delimiters — the split `0250063` claims to have closed is closed for `"…"` only — P2

- where: `packages/core/src/pdf/report-html.ts:148` — `(?:\s+&quot;.*?&quot;)?` matches the double-quote form
  alone.
- input / observed: fed through the production `buildReportHtml` (the `findings.overview` path
  `red-team/c-legit.test.ts` uses):

  | prose | PDF | viewer |
  |---|---|---|
  | `[the listing](https://x.example.com/a "Official registry")` | `<a href="https://x.example.com/a">the listing</a>` | anchor, `title` = null |
  | `[the listing](https://x.example.com/a 'Official registry')` | **no anchor, raw `[…](…)` in the artifact** | anchor, `title` = null |
  | `[the listing](https://x.example.com/a (Official registry))` | **no anchor, raw `[…](…)`** | anchor, `title` = null |
  | `[the listing](<https://x.example.com/a> "t")` | **no anchor, raw `[…](…)`** | anchor, `title` = null |

  The viewer column is measured, not assumed (a scratch `ReportViewer` render, since deleted). So the two
  artifacts of one purchase still disagree for these three forms, which is precisely R8-34's damage statement.
- status: **reproduced** (`npx tsx` probe against `buildReportHtml`; viewer via a temporary
  `apps/fbizlab/test/zz-scratch-g3verify.test.tsx`, run and deleted — `git status` clean).
- refutation attempted: (a) *Is `'title'` really Markdown?* CommonMark allows `"…"`, `'…'` and `(…)` as link
  titles; micromark/react-markdown accept all three, which is exactly why the viewer renders them and why the
  gap shows as a disagreement rather than as two identical failures. (b) *Would a model write one?* Far less
  often than `"…"`, which is why this is P2 and not P1 — but "ordinary Markdown, and the prose is written after
  reading attacker-controlled pages" is the commit's own argument for why the double-quote case mattered.
  (c) *Did this commit introduce it?* No — the angle-bracket destination and the two other delimiters all failed
  before as well. What is new is the message's claim that the two surfaces now agree "in both directions".
  (d) *Is the new branch itself over-eager?* I could not make it eat anything: the url atom is `[^\s()]`, so no
  amount of backtracking puts whitespace at the boundary the optional group needs, which means the branch can
  only add matches where the old rule already failed. Two titled links on one line, nested `&quot;` inside a
  title, an unterminated title, and a title containing `)` and `&` all behave (see the audit table).
- fix sketch: extend the optional group to `(?:\s+(?:&quot;[^]*?&quot;|'[^']*?'|\([^)]*?\)))?` — `esc()` leaves
  `'` untouched, so the single-quote form is literal by the time `mdInline` runs. What a naive version costs an
  honest run: a `\(.*?\)` alternative will happily swallow the closing paren of a Wikipedia-style destination if
  it is written before the title, so the paren alternative must exclude `)`, and the existing
  `[Laundromat](https://en.wikipedia.org/wiki/Laundromat_(business))` case must stay pinned when it lands.

### F3 · `0250063`'s subject line and body both state "5,160-character" for a fixture that is 4,803 characters — P2

- where: the commit message of `0250063` ("an attacker's 5,160-character claim about itself…", and again in the
  R8-34 bullet) vs `apps/fbizlab/test/red-team-c-attack.test.tsx`'s
  `` `Official registry of the State of Florida. ${'…Regulation. '.repeat(70)}` ``.
- input / observed: that template literal measures **4,803** characters (and 4,803 code points). The 5,160 figure
  is inherited verbatim from `docs/plans/m-red-team-reports/round8/G3-break.md:204-205`, whose own fixture is not
  in the repo; the string the fix actually ships is a different one and nothing in the tree measures 5,160.
- status: **reproduced** (measured the exact expression in `npx tsx`).
- refutation attempted: (a) *Is the attribute longer than the title?* No — react-markdown maps the title
  verbatim; there is no prefix. (b) *Is 5,160 the length of the whole prose field?* No, that is ~4,854.
  (c) *Is it a code-point/UTF-16 distinction?* No, the string is all ASCII: 4,803 either way.
- fix sketch: say 4,803, or restate the round-8 figure as round 8's. Nothing to change in code.

## Claims checked and TRUE (so nobody re-checks)

- **`62b5e61`, all six mutation counts.** Reproduced exactly — see the audit table. No line measured 0 red, as
  the message says.
- **`0250063`, all three mutation counts.** Reproduced exactly.
- **The chart-refiner strings.** `florida-business-for-sale.ts:1167/1236/1305` now read `la etapa de
  refinamiento` / `l'étape d'affinage` / `a etapa de refinamento`; the pre-fix versions were `la pasada` /
  `la passe` / `a passagem`. The message says "fr/pt/es" and all three are there.
- **No other buyer-visible string in `florida-business-for-sale.ts` has the same problem.** Grepped every i18n
  `label`/`help`/`description`/`placeholder`/`suggestions` value in the es/fr/pt blocks for `la pasada`,
  `la passe`, `a passagem`, `passada`. The only other hit in the file is line 1180's French `Passe le marché au
  crible` — "sift through the market", correct idiomatic French, not the noun. The remaining repo hits for those
  words are all in *comments* (`report-copy.ts:73-93`, `gather.ts:133`, `section-status.ts`) plus
  `email/templates.ts:218` `reset the password`. Buyer-visible: none. (One unrelated nit, out of scope and not a
  finding: the es/fr/pt `chart-analyst` descriptions leave `labels` untranslated.)
- **`sourceLabel` clips labels at 160.** `SOURCE_LABEL_MAX = 160` in both copies
  (`apps/fbizlab/src/lib/safe-href.ts:43`, `packages/core/src/pdf/report-html.ts:329`), and the clip is by code
  point (`Array.from(label)`).
- **The old C1C2 pin's tooltip is 188 characters and its 320 bound is unreachable.** With its fixture
  (`label = 'A'.repeat(5000)`, `url = 'https://x.test/a'`): `sourceLabel(s)` = 169 code points
  (`x.test` 6 + ` — ` 3 + 159 A's + `…`), tooltip = 169 + 3 + 16 = **188**. Exactly as claimed. And with the
  label capped at 160, no label can push that fixture past 320 — only a long url or a long host can, which is
  what the new test uses.
- **`[...title].length <= 320` is tautological.** `Array.from(x).slice(0, 320).join('')` cannot exceed 320 code
  points, and the pre-fix `.slice(0, 320)` on UTF-16 units could not either. True before and after the fix.
- **The `Record<SectionStatus['status'], true>` type trick does fire.** Adding a fourth status to the union alone
  produces `test/section-status.test.ts(405,11): error TS2741` under
  `tsc --noEmit -p packages/core/tsconfig.test.json`. It does not fire under `npm test` (F1(b)), and it is not
  the first error under `npm run typecheck` (F1(a)).
- **The writer really is a single typed chokepoint.** Every status the engine emits goes through
  `mark(key, status: SectionStatus['status'])` at `research-engine.ts:974`; nothing widens to `string`. So the
  union is a real pin on the writer, as the message says.
- **The notice was already correct before this batch and the "below" was viewer-only.** At `62b5e61^`,
  `report-copy.ts` already said `la etapa` / `a etapa` / `the step`, and only the viewer's `en degradedSection`
  carried the stray "below" — the PDF's did not. Both match the fixture's parenthetical at
  `section-lines.ts:41-43`.
- **The `0250063` by-hand check, in substance.** The untitled link and the parenthesised Wikipedia path render
  **byte-identically** before and after the branch (`https://en.wikipedia.org/wiki/Laundromat_(business)`, one
  anchor, no title). The title containing `&` and `)` (`"Smith & Co (est. 1990) — official)"`) yields the correct
  anchor with the title discarded and nothing after it swallowed. See the audit table for the one wording
  quibble. I also checked six cases the message does not mention — two titled links on one line, titled-then-
  untitled, untitled-then-titled, nested `&quot;` inside a title, an unterminated title quote, and a 5,160-`Z`
  title — and all behave: correct anchors, `titleAttr=false`, no title text leaking into the PDF.
- **`npm run typecheck` clean** at `a37d5f5`.
- **All six `out/*/trace.json`-gated tests are in core**, confirmed three ways: my core count is 6 below every
  message's core figure at every commit I measured, while api/worker/fbizlab/admin match to the unit.

## Commit-message audit (verifiers only): every count I re-ran, claimed vs observed

Every mutation below was run with a **full `npm test`** from the worktree root, RED counted (never "passed"),
each applied alone and reverted before the next, each substitution grepped back after applying.

| # | commit | claim | claimed | observed | verdict |
|---|---|---|---|---|---|
| 1 | `62b5e61` | viewer fr → `la passe` (`ReportViewer.tsx:67`) | 2 red | **2 red** — fbizlab `section-copy-parity`: "fr says what core says, key for key" + "calls a processing step a step…" | ✅ |
| 2 | `62b5e61` | PDF pt → `a passagem` (`report-html.ts:215`) | 2 red | **2 red** — core `section-status`: "the PDF prints the canonical line…" + "and calls a processing step a step there too" | ✅ |
| 3 | `62b5e61` | viewer en regains its stray "below" | 1 red | **1 red** — fbizlab "en says what core says, key for key" | ✅ |
| 4 | `62b5e61` | buyer bundle forgets `reconstructed` (fbizlab `KNOWN_STATUSES`) | 4 red, both fbizlab suites | **4 red**, `section-copy-parity` ×1 + `section-status-parity` ×3 | ✅ |
| 5 | `62b5e61` | core forgets `reconstructed` (core `KNOWN_STATUSES`) | 3 red | **3 red**, all in core `section-status.test.ts` | ✅ |
| 6 | `62b5e61` | notice regains `la pasada` (`report-copy.ts:80`) | 1 red | **1 red** — "the notice and the section line agree on the word for the step" | ✅ |
| 7 | `62b5e61` | "No line measured 0 red" | — | true for all six | ✅ |
| 8 | `62b5e61` | `npm test` main checkout 1104 = 705+215+22+157+5 | 1104 | clean worktree at `62b5e61`: **699+215+22+157+5 = 1098** = 1104 − 6 | ✅ |
| 9 | `62b5e61` | "up from 1093 — 5 new in core, 6 in fbizlab" | 1093 | clean at `ff45ae7`: **694+215+22+151+5 = 1087** = 1093 − 6; core +5, fbizlab +6 | ✅ |
| 10 | `0250063` | the anchor spreads `title` again (`ReportViewer.tsx:140`) | 1 red | **1 red** — `red-team-c-attack`: "a titled prose link carries no tooltip at all…" | ✅ |
| 11 | `0250063` | the tooltip clips by UTF-16 unit again (`ReportViewer.tsx:264`) | 1 red | **1 red** — `red-team-c-attack`: "the Sources tooltip clips by CODE POINT…" | ✅ |
| 12 | `0250063` | the PDF regex loses its title branch (`report-html.ts:148`) | 1 red | **1 red** — core `red-team/c-legit`: "a link with a TITLE is a link, not raw Markdown…" | ✅ |
| 13 | `0250063` | `npm test` main checkout 1109 = 709+215+22+158+5 | 1109 | clean worktree at `0250063`: **703+215+22+158+5 = 1103** = 1109 − 6 | ✅ |
| 14 | `0250063` | "up from 1106" | 1106 | clean at `8d2df52`: **702+215+22+156+5 = 1100** = 1106 − 6; delta +1 core +2 fbizlab = +3 | ✅ |
| 15 | `0250063` | "the old pin's … tooltip is 188 characters" | 188 | **188** code points (169 + 3 + 16) | ✅ |
| 16 | `0250063` | "`sourceLabel` clips labels at 160" | 160 | `SOURCE_LABEL_MAX = 160`, by code point, in both copies | ✅ |
| 17 | `0250063` | the 320 bound "is NOT reached and cannot be" with that fixture | — | true: label capped at 160, 16-char url ⇒ ceiling 188 | ✅ |
| 18 | `0250063` | `[...title].length <= 320` "tautological besides" | — | true, before and after the fix | ✅ |
| 19 | `0250063` | "a title containing `&` and `)`, an untitled link, and the parenthesised Wikipedia path all render as the same anchors they did before" | — | the untitled link and the Wikipedia path are **identical** before and after; the title case is **not** "the same as before" (before: no anchor at all, raw Markdown) — but the substance holds: it yields the right anchor with the title discarded and eats nothing after it. **TRUE in substance, imprecise as written** | ⚠️ |
| 20 | `0250063` | "an attacker's 5,160-character claim" (subject + body) | 5,160 | the shipped fixture is **4,803** characters; 5,160 is round 8's number for a string not in the tree (F3) | ❌ |
| 21 | `62b5e61` | "a `Record<SectionStatus['status'], true>` … making a fourth status a type error before it is a red test" | — | the type error is real (`error TS2741` at `section-status.test.ts:405`), but only under `npm run typecheck`, and only after three pre-existing `src` errors are cleared first; under `npm test` a fourth status is 0 red (F1) | ⚠️ |
| 22 | `62b5e61` | "a fourth status is red in every renderer that does not know it yet" | — | true only for "does not have it in `KNOWN_STATUSES`". A status added the way the type layer pushes you to add it is **1109 passed, 0 failed** with no advisory line in either renderer (F1) | ❌ |
| 23 | `62b5e61` | fr/pt/es chart-refiner descriptions fixed, "same mistranslation, different string" | — | all three fixed; nothing else buyer-visible in that file has it | ✅ |
| 24 | `0250063` | "the two artifacts now agree in both directions" | — | for `"title"` only; `'title'`, `(title)` and `<url>` still split (F2) | ❌ |
