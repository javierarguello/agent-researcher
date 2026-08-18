# G3-break — PROGRESS contract + RENDERERS (`9850bdf` C3, `73a4e79` C1, `245811f` C5, `f74f7b0` C2/C4/C6) / BREAKER

Setup note: the brief's sanity command is wrong — `packages/core/test/resolution.test.ts` does not exist on this
tree (nor on `d1ac4dd`). I ran `npx vitest run test/resilience.test.ts test/progress-kinds.test.ts` in
`packages/core` instead: **9 passed**. My worktree branch was parked at `d1ac4dd`; I `git reset --hard a11bafe`
first — every measurement below is on `a11bafe`. `npm ci` run in the worktree. `apps/api` suite: 214 pass / 6 skip
clean, and 6 red under my mutation (below).

## Verdict

The batch's core claims hold and hold well: the buyer really never receives `message` (I mutated `clientProgress`
to leak it and got 6 API tests red, one more than the commit claimed), `detail` really is search-only and clipped,
and the PDF renderer changes are a strict improvement — I ran every one of the **1,214 strings in the two real
July `report.json`s through the pre-batch and post-batch `mdToHtml`: 20 changed, all 20 for the better** (7
double-escape fixes, 13 run-on paragraphs that are now real `<ol>`/`<ul>`), zero regressions. Two things break.
First, the migration story — "a progress document written before `kind` existed … the page shows the step label"
— is true for every phase *except the one that matters*: `held` is the only phase the manifest has no step for, so
a job parked before the deploy now shows a buyer a pulsing dot and *"Generando tu dossier…"* and nothing else,
where the day before it showed the localized "paused while we review it" line. Second, `245811f`'s claim that the
PDF and the viewer now "agree on what is a link" is false as shipped: `tel:`, relative and protocol-relative prose
links are live anchors on the web and raw `[text](url)` brackets in the PDF.

## Findings (most severe first)

### F1 · A job held before the deploy tells the buyer it is still being generated, and the held explanation is gone — P1

- where: `packages/core/src/jobs/types.ts:120-128` (`clientProgress`) + `apps/fbizlab/src/pages/JobView.tsx:74,78-82`
  + `packages/core/src/templates/phases.ts:9-11` (`LIFECYCLE_BEFORE/AFTER/OTHER` — no `held`) +
  `packages/core/src/templates/registry.ts:66-80` (`buildSteps`).
- input / observed: a job document written by `run-job.ts:405` **before** `9850bdf`:
  `{ phase: 'held', message: heldNotice('es'), turnsUsed, sourcesFound, updatedAt }`, no `kind`.
  Buyer `GET /research/:id` → `{ phase: 'held', updatedAt }` (correct per the new contract).
  `JobView` then does `stepsById['held']` → **undefined** (the manifest's `steps` are `planning` + agent ids +
  `assembling`, `done`, `incomplete`, `failed` — `held` is the one phase with no step), and
  `progressLine(progress, lang)` → `null` because there is no `kind`. The whole live card renders as:

  ```
  LEGACY HELD CARD >>> Generando tu dossier…
  NEW HELD CARD    >>> Generando tu dossier…En pausa mientras lo revisamos. No se gasta nada más y te avisaremos.
  ```

  Before the deploy that same card printed `heldNotice('es')` — *"En pausa mientras lo revisamos…"* — verbatim
  (old `JobView`: `{job.progress?.message && <p …>{job.progress.message}</p>}`). A held job is precisely the job
  that survives a deploy: it sits waiting for a human. So the buyer of a parked job watches an animated "generating"
  dot forever, with `held`'s own copy — the one line the previous round wrote specifically for this screen
  (`report-copy.ts:122-128`, *"It is rendered raw by the client, so it has to be the buyer's language"*) — deleted.
  Two corroborating symptoms of the same root cause, both live today for **new** held jobs too:
  - the card's bold headline is `step?.label ?? t.working` = **"Generating your dossier…"** on every held job,
    directly under a badge that says "En revisión" (`JobView.tsx:74`);
  - the inbox row prints the raw internal word: `Reports.tsx:193` does `stepMap[j.progress.phase] ?? j.progress.phase`
    and `LIVE` includes `'held'` (`Reports.tsx:68`), so a held job's row reads **`held`**, in English, to a Spanish buyer.
  - `docs/api-reference.md:145` tells third-party integrators to "Map `progress.phase` → a localized label …
    via the model manifest's `steps`" — so any other client following the documented contract has the same hole.
- status: **reproduced**. `apps/fbizlab/test/g3-break.test.tsx` (scratch, in my worktree):
  ```tsx
  show({ status: 'held', progress: { phase: 'held', updatedAt: '…' }, summary: null });   // legacy
  // container.querySelector('.card').textContent === 'Generando tu dossier…'
  expect(screen.queryByText(/pausa|revisamos/i)).toBeNull();   // passes — the notice is gone
  ```
  Ran green (i.e. the regression is real). `held`'s absence from the step list verified by reading
  `phases.ts` + `buildSteps`, and the raw-`held` inbox row by reading `stepMap`'s construction (`Reports.tsx:97`).
- refutation attempted: (a) *maybe the status badge carries it* — it does say "En revisión", but the live card under
  it simultaneously says "generating", so the page contradicts itself; and the badge never carried the "nothing more
  is being spent, we will come back to you" reassurance, which is the part that stops a support ticket. (b) *maybe
  held documents are rare enough not to matter* — they are the one class of job that is deliberately long-lived
  across deploys, which is exactly the standing-lesson-3 case. (c) *maybe the API should send `message` for `held`* —
  no, `heldNotice` is our own copy and safe, but it is in the **report's** language, so the right fix is client-side.
- fix sketch: add `held: { label: 'Under review', description: … }` to `phases.ts` + a `LIFECYCLE_OTHER` entry, and
  in `run-job.ts` write `kind: 'held'` onto any legacy `phase: 'held'` document on read (or coerce in
  `clientProgress`: `kind: p.kind ?? (p.phase === 'held' ? 'held' : undefined)`).
  What an honest run loses if fixed naively: coercing `phase → kind` for *every* phase would resurrect the very
  thing C3 removed (a `searched` phase has no safe kind without the query), so the coercion must be the closed set
  of lifecycle phases only.

### F2 · The PDF and the viewer disagree about what is a link; `245811f` claims they agree — P2

- where: `apps/fbizlab/src/lib/safe-href.ts:19-21` (`proseUrl`) vs `packages/core/src/pdf/report-html.ts:138`
  (`mdInline`'s link rule). Claim under test: *"a `mailto:` — the same set the web viewer's Markdown allows, so the
  two artifacts agree on what is a link"* (`245811f` message).
- input / observed: one prose field, both production renderers, `lang: 'es'`:
  ```
  Llame al [+1 305 555 0100](tel:+13055550100) para agendar.
  Vea el [listado completo](//deals.example.test/p) aquí.
  Vaya a [su panel](/app/logout) para continuar.
  Escriba a [el broker](mailto:b@x.test).
  Pulse [aquí](javascript:alert(1)) ahora.
  ```
  Web (`ReportViewer`, real component):
  ```
  WEB ANCHORS >>> [ 'tel:+13055550100 | +1 305 555 0100',
                    '//deals.example.test/p | listado completo',
                    '/app/logout | su panel',
                    'mailto:b@x.test | el broker' ]        (javascript: correctly dropped to text)
  ```
  PDF (`buildReportHtml`, real builder):
  ```
  <p>Llame al [+1 305 555 0100](tel:+13055550100) para agendar.</p>
  <p>Vea el [listado completo](//deals.example.test/p) aquí.</p>
  <p>Vaya a [su panel](/app/logout) para continuar.</p>
  <p>Escriba a <a href="mailto:b@x.test">el broker</a>.</p>
  ```
  Two consequences. (i) The *honest* case the `tel:` allowance was added for — "a broker's number is a legitimate
  link" — ships to the buyer's PDF as **raw Markdown source with the brackets showing**. The PDF is the artifact the
  buyer keeps and forwards. (ii) The prose path is now the loosest href channel we have: `safeHref` rejects
  `//attacker/p` at the three raw hrefs, but `proseUrl`'s `/^[^:]*$/` passes it, so `[Ver el listado oficial](//pz.attacker.test/p)`
  written by a prompt-injected model is a live `target="_blank"` anchor to an attacker origin in the buyer's viewer,
  the shared read link and the admin's "View report in the app" — the exact three surfaces `73a4e79` enumerated for
  the image beacon, whose commit message *itself* notes that react-markdown's default "lets protocol-relative and
  same-origin srcs through, which is why the fix is at the ELEMENT". That reasoning was applied to `img` and not to `a`.
  We did not *widen* react-markdown's default here (its `defaultUrlTransform`, `node_modules/react-markdown/lib/index.js:416-437`,
  also passes anything relative or protocol-relative); we added `tel:`, dropped `irc:`/`xmpp:`, and kept the hole.
- status: **reproduced** — `packages/core/test/g3-break.test.ts` and `apps/fbizlab/test/g3-break-viewer.test.tsx`
  (scratch, in my worktree), output pasted above verbatim. No existing test covers a relative or protocol-relative
  prose link; `red-team-c-attack.test.tsx:148` only covers `javascript:`.
- refutation attempted: *a report never contains a relative link honestly, so rejecting them costs nothing* — agreed,
  which is why this is cheap to fix; *the PDF's brackets are only cosmetic* — for `tel:` yes, but the buyer paid for
  a dossier that reads as a dossier, and the two artifacts are supposed to agree (that is the commit's own standard).
- fix sketch: `proseUrl` → `/^(https?:\/\/|mailto:|tel:)/i.test(url) ? url : ''` (drop the relative alternative), and
  add `|tel:` to `mdInline`'s link alternation. Naively dropping the relative branch alone would still leave the
  PDF printing `[…](tel:…)`, so both halves must move together.

### F3 · Two progress kinds tell the buyer something that is not true — P2

- where: `apps/fbizlab/src/lib/progress-copy.ts:29,27` vs `packages/core/src/engine/gather.ts:515,467`.
- input / observed:
  - `gather.ts:515` fires `note('Research loop ended: <stop> …', 'stopped')` **unconditionally**, for every exit —
    including `stalled` (cut off with budget left; the code's own comment at :186 says "it was cut off, and with no
    turn spent there is nothing to reuse") and `ceiling` (the job just hit its cost limit, one line after the
    `ceiling` note at :295). The buyer's copy for `stopped` is **"Research for this step is complete."** — i.e. we
    tell a buyer the research finished at the exact moment we stopped paying for it.
  - `gather.ts:467` fires `'cached'` for both branches, including `Declined to re-send a page already returned twice.`
    The buyer's copy is **"Re-reading a source already gathered."** — we say we re-read it when we refused to.
- status: **reasoned** (code path traced end to end; not worth a paid run to observe).
- refutation attempted, and it partly succeeds — report it with the caveat: `stopped` essentially never *dwells*.
  After `gather` returns, the next statement is the budget check and then `note('Writing (…)', 'writing')`
  (`research-engine.ts:958`), microseconds later; the ceiling path throws and re-emits `'ceiling'` just as fast. At
  a 3 s poll the buyer will almost never catch it. `cached` **does** dwell (the next note waits on a model turn,
  5–20 s). Same for `wave` — `research-engine.ts:471` emits it on wave 1 too, so the first thing a buyer reads after
  "Starting the research." is "Starting the next group of analysts." — but it is overwritten within milliseconds by
  the first agent's own note. So: one visible untruth (`cached`), two invisible ones (`stopped`, `wave`). The
  `ceiling`, `assembling` and `retry` copies I could not fault — `ceiling` is followed by a genuine hold, the
  finalize-in-place `assembling` line really is assembling the report, and "Retrying this step." is true after both
  a 503 and a schema failure.
- fix sketch: pass the `GatherStop` through as `kind: stop === 'done' || stop === 'budget' ? 'stopped' : 'ceiling'`,
  and split the declined-cached branch onto its own kind (or reuse `'researching'`).

### F4 · `detail` is clipped in UTF-16 units while the rest of the batch clips in code points — P2

- where: `packages/core/src/jobs/types.ts:121` — `p.detail.slice(0, PROGRESS_DETAIL_MAX)`.
- input / observed: a query whose 120th UTF-16 unit lands inside a surrogate pair, e.g.
  `'x'.repeat(119) + '🏦' + 'resto'` → the clipped value ends `"xxx\ud83c"`, a lone high surrogate.
  `JSON.stringify` emits it as the escape `\ud83c` (well-formed JSON, survives round-trip), and the browser paints
  it as `�` inside the quoted query the SPA shows. Harmless in itself; the point is the inconsistency: the *same
  batch* clips by code point in `sourceLabel` (`safe-href.ts:33` / `report-html.ts`, `Array.from`) and in `49e71aa`
  ("handoff by code point"), so this is a known-to-the-author class of cut left in the one place a hostile page
  chooses the string.
- status: **reproduced** in node (`node -e` snippet; lone surrogate confirmed, round-trip confirmed).
- refutation attempted: real queries are p90 90 chars and rarely carry emoji, and the damage is one replacement
  glyph — hence P2, not higher.
- fix sketch: `Array.from(p.detail).slice(0, PROGRESS_DETAIL_MAX).join('')`, matching `sourceLabel`.

### F5 · Two comments now describe behaviour this batch removed — P2

- where: `packages/core/src/engine/research-engine.ts:551-554` — *"`emit` below lands in `job.progress.message`,
  which the API hands to the buyer raw"*. It does not any more; `9850bdf` is the commit that stopped it, and it
  touched this very file. And `packages/core/src/jobs/report-copy.ts:125` — `heldNotice`'s *"It is rendered raw by
  the client"*: no client renders it now (buyers get `kind: 'held'`; the admin's held card is not even shown,
  `apps/admin/src/pages/JobDetail.tsx:100` excludes `held` from `live`). `heldNotice` is now duplicated copy —
  `progress-copy.ts`'s `held` line says the same thing in slightly different words in all four languages.
- status: reasoned (read both call graphs).
- fix sketch: retarget both comments at the trace/admin, or delete `heldNotice` and let the kind carry it.

### F6 · The Sources row's tooltip is the attacker's self-declared title, whole and host-less — P2

- where: `apps/fbizlab/src/components/ReportViewer.tsx:250` — `<li title={s.label || s.url}>`.
- input / observed: a source labelled
  `"Florida Department of Business Regulation — Official Miami-Dade Laundromat Registry" + 'Z'.repeat(4900)`:
  ```
  WEB SOURCE TEXT       >>> "↗ok.test — Florida Department of Business Regulation — Official … ZZZ…"  len 171
  WEB SOURCE TITLE ATTR >>> "Florida Department of Business Regulation — Official … ZZZ…"            len 4983
  ```
  C2's stated defence is *"the host is the one thing about a source its author does not choose"* — the tooltip has
  no host and no bound, so the authority claim the red team's page made is one hover away from being displayed
  exactly as written. The commit does disclose this ("the full title stays in the row's `title` attribute on the
  web"), so it is an accepted trade-off, not a miss — but it is the wrong half to keep unbounded.
- status: **reproduced** (`apps/fbizlab/test/g3-break-viewer.test.tsx`).
- fix sketch: `title={sourceLabel(s)}` when the label is clipped, or `title={host + ' — ' + label.slice(0, 400)}`.

## Claims checked and TRUE (so nobody re-checks)

- **"The API hands a non-admin `{phase, kind, detail?, updatedAt}` — never `message`"** (`9850bdf`). Verified by
  reading `apps/api/src/index.ts:1493,1537` and by **mutation**: I added `message: p.message` back into
  `clientProgress` and ran the whole `apps/api` suite → **6 failed** (`progress-payload.test.ts` ×5 and one in
  `hold-e2e.test.ts`); the commit claimed 5, i.e. it understated. Reverted; `git status` clean in `src/`.
- **"Admins get everything."** `index.ts:1537` returns `job.progress` whole for admins;
  `apps/admin/src/pages/JobDetail.tsx:170` renders `job.progress.message` and still receives it. `sourcesFound` /
  `turnsUsed` likewise (`JobDetail.tsx:167`).
- **The admin list's `kind: j.progress.kind ?? null`** is never read: `apps/admin/src` references `progress` at
  exactly five places, all on the *detail* payload; there is no list-row progress type, and
  `apps/admin/src/api/types.ts:126-132` `JobProgress` has no `kind`/`detail` field at all. So the `null` cannot hit
  a `ProgressKind`-typed reader. (Type is stale, not wrong.)
- **A pre-`kind` document served to a *deployed old SPA bundle* does not crash.** `git show d1ac4dd:apps/fbizlab/src/pages/JobView.tsx`
  renders `{job.progress?.message && <p …>{job.progress.message}</p>}` — with `message` now absent this is
  `undefined && …` → renders nothing, no blank `<p>`, no throw. The old `Reports.tsx` reads only
  `j.progress.phase`, which is still sent. A cached old bundle degrades to "step label only", cleanly.
- **`detail` travels only with `searched` and is clipped.** `progress-payload.test.ts` and
  `progress-kinds.test.ts` both assert content (exact objects, exact clipped string), not shape. The >120-char
  query is *not* truncated in the trace: `research-engine.ts:901-903` pushes the full
  `Search failed (n/3): <query> — <err>` into `trace.notes`, admin-side, as intended.
- **The held line's language.** The old behaviour showed `heldNotice(output.language)` (the *report's* language);
  the SPA now localizes by the *UI* language. This is **not** a regression against the `reportLang` rule — JobView's
  own doc comment (`JobView.tsx:29-37`) draws the line explicitly: "A delivered document has to agree with itself;
  the chrome around it — buttons, badges, status — still follows the UI." A live progress line is status chrome, so
  UI-language is the consistent choice. Refuted as a finding.
- **`245811f` on real data.** I ran all 1,214 strings of `out/local-aa4b3edf/report.json` and
  `out/local-4837f6e3/report.json` (main checkout, read-only) through the `d1ac4dd` and `a11bafe` `mdToHtml`
  (script: `…/scratchpad/g3/md-diff.mjs`). **20 changed, 0 regressions**: 7 × `&amp;amp;` → `&amp;` on the real
  `miamidadematters.org?indicatorId=393&localeTypeId=2` and `yelp.com?cflt=…&find_loc=…` citations, and 13 list
  fixes — including four where the old renderer had turned a `*` bullet run into stray `<em>` tags
  (`deep_dives[0].includedAssets`: `<em>   Cambiadoras de monedas </em>   Carros de lavandería` → a clean `<ul>`).
  Every changed paragraph is better.
- **`NUMBERED_LINE = /^\s*(\d{1,2})[.)]\s+/`.** The `\s+` requirement means "3.5x el SDE…" is prose, not a list, and
  `\d{1,2}` means "2024. El mercado…" is prose — both pinned. The one false positive I could construct is an address
  on its own line: `La dirección declarada es:\n1. Ocean Drive, Miami Beach` → `<p>…</p><ol><li>Ocean Drive, Miami
  Beach</li></ol>` (reproduced). Cosmetic, and zero occurrences in the real reports. A `-` run interrupted by a
  numbered run nests correctly (`</ul><ol>…</ol><ul>`); a *wrapped* bullet fragments into
  `<ul>…</ul><p>continuation</p><ul>…</ul>` (reproduced), but the old code turned the same input into one run-on
  paragraph, so it is not a regression.
- **`img: () => null`.** Renders zero `<img>` in prose, leaves the surrounding text intact (`Foto verificada  del
  local.`), and produces **no** React warning and no key error inside `<ul>` lists — my scratch render's stderr
  carried only the two react-router future-flag warnings. `mdInline`'s image strip (`report-html.ts:126`) means the
  PDF never resurrects the beacon as an alt-labelled link either.
- **`sourceLabel`.** `https://user:pass@registry.example.test/x` → `registry.example.test — Official Registry`
  (credentials stripped by `new URL().hostname`); a punycode host renders as `xn--80ak6aa92e.com`, i.e. **not**
  decoded to the homograph — the safe choice; a 5,000-char title clips to 160 code points (`len 171` including the
  `↗host — ` prefix) in both renderers. `mailto:` accepted by `safeHref`; a `mailto:x@y?subject=…&body=<huge>` is
  escaped by `esc()` into the attribute and is inert.
- **`f74f7b0` C6 (email).** `{ ...v, title }` — the spread order puts `title: escHtml(title)` first and the raw
  `title` second, so the **raw** value wins in both the subject and the text part; I read all four languages'
  `READY_*` blocks and there is exactly **one** HTML interpolation site for `{title}` (`READY_BODY`,
  `<strong>{title}</strong>`), which takes the escaped `v`. No attribute context, so `escHtml` not covering `"` is
  fine. `t()` substitutes with `split/join` in insertion order `app → url → title`, so a title containing `{app}`
  or `{url}` cannot be re-expanded. The notice is raw in the text part and escaped in the HTML — correct, and the
  whitespace-only case still collapses to `undefined` exactly as before.

## Tests: content vs shape, and the mutations I ran

- `apps/api/test/progress-payload.test.ts` — **content**. Exact-object `toEqual` on the buyer payload, an explicit
  `not.toContain('market_overview')` and `not.toContain('Searched:')`, and a named mutation per case. The legacy-doc
  case (`p4`) is real, but it uses `phase: 'deal-scout'` — a phase that *has* a step. The `held` phase, which has
  none, is untested; that gap is F1.
- `packages/core/test/progress-kinds.test.ts` — **content**. Asserts every emitted event's kind is in the closed set,
  the exact `detail`/`message` for searches, `detail === undefined` for everything else, and the lifecycle order.
  Its `KINDS` set is written out in the test rather than imported, which is the right direction (a new emitted kind
  reds it). It does not exercise the `ceiling`/`retry`/`held`/`failed` paths — only the type protects those.
- `apps/fbizlab/test/progress-copy.test.tsx` — **content**, and the distinctness assertion
  (`new Set(lines).size === LANGS.length`) is a genuine "no language borrows English" guard. But its third test's
  title — *"a document without a kind … the phase label above it still says where we are"* — asserts only
  `progressLine(...) === null`; it never renders `JobView`, so the second half of the claim is untested and, for
  `held`, untrue (F1).
- `packages/core/test/red-team/refute-c5c6.test.ts` — **content**, exact HTML strings, named mutations. Good.
- `apps/fbizlab/test/red-team-c-attack.test.tsx` — **content**, real `ReportViewer`, measured before/after numbers
  in the comments. Gap: no case for a relative or protocol-relative prose link (F2).
- **Mutation I ran**: `clientProgress` → re-add `message` ⇒ 6 red across `apps/api` (claim: 5). Reverted; `src/`
  clean (`git status --porcelain` shows only my three untracked scratch test files).
- Scratch reproductions left in my worktree (untracked, not committed):
  `apps/fbizlab/test/g3-break.test.tsx`, `apps/fbizlab/test/g3-break-viewer.test.tsx`,
  `packages/core/test/g3-break.test.ts`, and `…/scratchpad/g3/md-diff.mjs`.
