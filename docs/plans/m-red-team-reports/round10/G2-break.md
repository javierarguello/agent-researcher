# G2-break — what the buyer reads / BREAK

Measured at **`20f361b`** (`git rev-parse HEAD` printed `20f361b531626ac0412475407e0a169f1d4c8570`), in my own
worktree after `npm ci`. Clean-worktree `npm test`: **1162 passed, 0 failed** — 751 core (16 skipped, 767 collected)
+ 216 api (6 skipped) + 22 worker + 166 fbizlab + 7 admin. That is the brief's number exactly. `git diff` is clean;
every mutation below was reverted from a copy taken aside, and every scratch file lives in my own scratchpad.

## Verdict

The two fixes that were about a *renderer* hold where they claim to. `0ff22ef` really does close the titled-image
beacon: I threw seventeen image shapes at `mdInline` — all three title delimiters, a title containing `)`, a
whitespace-before-`)` form, a balanced-paren destination, an empty alt, an image nested inside a link — and **not
one produced an anchor at the attacker's URL**. `7a29a43`'s `LINE_FOR_STATUS` tie is real and its "4 red" is
honest. But two of the batch's load-bearing sentences are the shape round 9 was told to hunt, and both are false.
`c1397a9` says "*what is gone is the one artifact that could go stale*" — `pf.summary` is still on that screen,
still server-rendered at preview time, and **two controls inside the same dialog change what will be submitted
without changing it**: unticking "Apply suggested fixes" ships the value the summary just denied, and ticking a
basic re-scopes the search the summary describes. That is R9-1's own damage statement, on the paths the fix did not
walk. And `0ff22ef` says the title group "*cannot cross the end of the link*", which is true, and then reasons from
it that the silent-deletion primitive is closed — which is false for the rule that *deletes*: the shared `MD_TITLE`
carried the swallow into the **image strip**, where prose between two quote pairs disappears from the PDF while the
viewer shows every character of it.

## Findings (most severe first)

### F1 · The confirm dialog's "What we'll search" sentence states the corrected value while the job is created with the value the buyer just declined — P1

- **where:** `apps/fbizlab/src/pages/NewReport.tsx:1073` (`{pf.summary || t.confirmSub}`) against
  `apps/fbizlab/src/pages/NewReport.tsx:785` (`if (applyFixes) for (const c of review?.corrections ?? []) …`) and
  `apps/fbizlab/src/pages/NewReport.tsx:1104` (the `applyFixes` checkbox, inside the same modal).
  Server side: `packages/core/src/moderation/preflight.ts:123` — `summary: renderPlan(template, correctedParams ?? params, …)`.
- **input / observed:** preflight answers with `corrections: [{field:'gridRegion', from:'ERCOT Wst', to:'ERCOT Far West'}]`
  and `summary: 'We will research parcels in ERCOT Far West.'` — which is exactly what the server does
  (`apps/api/test/preflight.test.ts:59` pins it: "*…and the summary reflects what would actually run*"). The buyer
  unticks **Apply suggested fixes** — one click, in the dialog, on a control the dialog itself offers — and presses
  Confirm. The modal still reads **"We will research parcels in ERCOT Far West."**; `createJob` is called with
  `gridRegion: 'ERCOT Wst'`. No second preflight is bought, so nothing re-renders the sentence.
  A second instance of the same hole: `pf.proposals.basics` starts **unticked** (`defaultAccepted`,
  `NewReport.tsx:185`), so ticking one — "Location: Hialeah", the field the buyer left empty — puts it into the
  request through `mergeProposals` (`NewReport.tsx:209`) while `pf.summary`, rendered from params where that field
  was empty, still describes the whole region. Reproduced: `parcelUse` absent from the previewed params, summary
  `"We will research the whole region."`, and `createJob` receives `parcelUse: 'Hialeah'`.
  For the Florida model the two correctable fields are `location` and `industry`
  (`packages/core/src/templates/florida-preflight.ts:140`) and the one fillable basic is `location`
  (`:150`) — i.e. **exactly the two fields `describePlan` uses for its subject and its place**
  (`florida-preflight.ts:207`). There is no field where this is cosmetic.
- **status: reproduced.** Three tests, ported below, in `apps/fbizlab/test/` against the real component with the
  fictional manifest (2 assert the defect, 1 is the control):

  ```tsx
  // F1 — the decline path
  hooks.preflight.mockImplementation(async (body: any) => ({
    ok: true, quality: 'ok', issues: [], assist: { state: 'on' },
    corrections: [{ field: 'gridRegion', from: body?.params?.gridRegion ?? '', to: 'ERCOT Far West' }],
    correctedParams: { ...body.params, gridRegion: 'ERCOT Far West' },
    summary: 'We will research parcels in ERCOT Far West.',   // what runPreflight does
    preferences: [],
  }));
  renderForm();
  await userEvent.type(screen.getByPlaceholderText('e.g. ERCOT West'), 'ERCOT Wst');
  await userEvent.click(screen.getAllByRole('button', { name: /generate dossier/i })[0]!);
  await userEvent.click(await screen.findByRole('button', { name: /validate & continue/i }));
  await userEvent.click(document.querySelectorAll('.modal input[type=checkbox]')[0] as HTMLElement); // decline
  expect(document.querySelector('.modal')!.textContent).toContain('ERCOT Far West');
  await userEvent.click((await screen.findAllByRole('button', { name: /generate dossier/i })).at(-1)!);
  expect((hooks.createJob.mock.calls.at(-1)![0] as any).params.gridRegion).toBe('ERCOT Wst');
  expect(hooks.preflight).toHaveBeenCalledTimes(1);   // no second review was bought

  // F1b — the basics path
  //   summary: 'We will research the whole region.'   (parcelUse empty at preview time)
  //   proposals: { directives:{}, keywords:[], basics:{ parcelUse:'Hialeah' }, quotes:{…} }
  await userEvent.click(screen.getByTestId('accept-basic-parcelUse'));
  expect(document.querySelector('.modal')!.textContent).toContain('We will research the whole region.');
  expect((hooks.createJob.mock.calls.at(-1)![0] as any).params.parcelUse).toBe('Hialeah');
  ```
  The CONTROL (leave the fix ticked → `createJob` gets `'ERCOT Far West'`) passes, so the unticking click is what
  changed the request and not the fixture.
- **refutation attempted:** (a) *Does editing re-trigger validation?* No — `applyFixes` and `accepted` are separate
  state, not in `paramsKey` (`NewReport.tsx:574-576`), and correctly so: putting them in would cost an assisted
  attempt per click, which is the trap `c1397a9` explicitly declines to walk into. So the button stays on "Confirm
  & generate" and the stale sentence stays on screen. (b) *Is the buyer told anyway?* The corrections block shows
  `from → to` and the basics block shows the value — they have the raw facts. That is why I graded this P1 and not
  P0, even though round 9 graded the identical damage statement P0: here the contradicting fact is in the same
  modal rather than absent. It is still the last screen before payment saying one thing and the request carrying
  another. (c) *Do the four paths the brief names break the new `livePrefs` line itself?* **No.** I checked all
  four: the mobile wizard renders the same modal from the same component (`stepOf` only sets `display:none`;
  `livePrefs` reads `params`); an edit after a pre-flight is exactly what `livePrefs` is built for and the two new
  tests pin it; an accepted directive proposal lands in the form through `keepProposal` → `setDir`
  (`NewReport.tsx:480`) so `livePrefs` sees it and `submit` sends it from `base`; assist-off still renders `pf`
  and therefore the preferences line. `livePrefs` is right. It is the **sentence above it** that is not.
- **fix sketch:** render the plan sentence from the live form too, or — cheaper and honest — recompute `summary`
  client-side from `base` at confirm time. The naive fix (put `applyFixes`/`accepted` into `paramsKey`) costs an
  assisted-review attempt per checkbox click, which is the same bill `c1397a9` refused to pay for the chips. The
  narrow fix that loses nothing: when `applyFixes` is off, or a basic is ticked, do a **local** string substitution
  of the affected `from`/`to` in `pf.summary` — the two correctable fields and the fillable basic are named in the
  manifest, so the client already knows which substrings are in play.

### F2 · The PDF's image strip still deletes prose the viewer keeps — the swallow the fix closed for links, inherited by the rule that deletes — P1

- **where:** `packages/core/src/pdf/report-html.ts:143` (`MD_TITLE`) used at
  `packages/core/src/pdf/report-html.ts:159` (the image strip, `out.replace(…, '')`).
- **input / observed:** model prose (a `findings.overview` string, the production path):

  ```
  KEEP1 ![alt](https://beacon.attacker.test/x.png "a" KEEP-MIDDLE "c") KEEP2
  ```
  PDF: `<p>KEEP1  KEEP2</p>` — **`KEEP-MIDDLE` is gone, with no marker.**
  Viewer (`ReportViewer`, react-markdown + remarkGfm): `KEEP1 ![alt](https://beacon.attacker.test/x.png "a" KEEP-MIDDLE "c") KEEP2`
  — every character present, zero `<img>`. The two artifacts disagree, and the one that disagrees by *deleting* is
  the one the buyer keeps and forwards.
  The mechanism is the shared definition the commit introduced. `&quot;[^)]*?&quot;` is lazy but not anchored to a
  single quoted run: the short match `"a"` fails the following `\)`, so it extends to `"a" KEEP-MIDDLE "c"` and
  succeeds. Because `MD_TITLE` is now used by the image strip too, the strip's replacement (`''`) removes every
  character it matched. The link rule's version of the same over-reach is harmless — it only discards a title — so
  the commit's reasoning ("*Every alternative now excludes `)` … a second real link deleted … with no marker*")
  is sound for the rule it was tested on and false for the rule it was newly applied to. Both of the commit's F3
  tests (`c-attack.test.ts`) use the LINK rule; no test feeds a two-quote title to the image strip.
- **status: reproduced.** PDF side through `buildReportHtml({ report: { findings: { overview, listings: [], risks: [] } }, … })`
  — the same `pdf()` seam `c-legit.test.ts` uses. Viewer side through the real `ReportViewer`:

  ```tsx
  const md = 'KEEP1 ![alt](https://beacon.attacker.test/x.png "a" KEEP-MIDDLE "c") KEEP2';
  const { container } = render(<ReportViewer report={{ findings: { overview: md, listings: [], risks: [] } }}
    sections={[{ key: 'findings', title: 'Findings' }]} meta={{}} lang="en" />);
  expect(container.textContent).toContain('KEEP-MIDDLE');       // passes — the viewer keeps it
  expect(container.querySelectorAll('img').length).toBe(0);     // passes
  // …and the PDF for the same string renders <p>KEEP1  KEEP2</p>
  ```
- **refutation attempted:** (a) *Can the deletion reach past the image's own parenthesis into unrelated prose?* No —
  every alternative excludes `)`, so the reach is bounded by the next `)`. I tried eleven shapes with the deletion
  target outside the parens and none matched; the commit's claim about `)` is genuinely true. The damage is
  confined to the span between the two quote pairs, which is where the model would put the sentence it wants gone.
  (b) *Is a well-formed second LINK still swallowed?* No — `KEEP1 ![alt](url "t) KEEP2 [real](https://ok.test/p "t2") KEEP3`
  renders with the real anchor intact and the malformed image left as visible raw Markdown. Round 9's F3 is closed
  for the case it named. (c) *Is this the beacon coming back?* No — I fuzzed seventeen image shapes and **no
  titled, paren-destinationed, extra-spaced, alt-empty or link-nested image produced an `href` at the beacon.**
  The strip always matches at least a prefix of anything the link rule would match, so `0ff22ef`'s headline fix
  holds. (d) *Is the shape reachable?* It is one line of model output, and the file it lives in exists because a
  prompt-injected model writes exactly this kind of line — `poisoned-web.ts:204` is the same class of instruction.
- **fix sketch:** make the double-quote alternative exclude its own delimiter the way the single-quote one already
  does: `&quot;(?:(?!&quot;)[^)])*&quot;` (or, equivalently, forbid `&` inside and match `[^)&]*`, which would also
  refuse a title containing an entity). What an honest run loses: a genuine title containing an escaped quote falls
  back to raw Markdown for the link rule and to a **visible** raw image for the strip — visible and complete, which
  is the trade the commit already argues for. Doing it naively by dropping the shared definition re-opens
  `0ff22ef`'s own F1, so the change belongs inside `MD_TITLE`.

### F3 · `sourceLabel`'s HOST is not clipped, on both branches the R9-22 fix left — P2

- **where:** `packages/core/src/pdf/report-html.ts:407-408` and the identical
  `apps/fbizlab/src/lib/safe-href.ts:66-67`:
  `if (!clipped) return host || cut(s.url);` and `return host && … ? \`${host} — ${clipped}\` : clipped;`
- **input / observed:** `sourceLabel({ url: 'https://' + 'a'.repeat(4000) + '.com/x' })` returns **4004
  characters**; with a label it returns 4004 + the clipped label. `new URL()` imposes no hostname bound — I
  measured `hostname.length === 4004` for that string, and `3903` for a 1300-label dotted name. Meanwhile the
  path R9-22 *did* fix returns ≤160. So the fix's own sentence — "*It was the one path that returned an unbounded
  string*" — is false: `cut()` was applied to `s.url` and not to `host`, and `host` is the value on **both**
  remaining returns. The file's other universal is false in the same place: "*the host is the one thing about a
  source its author does not choose*" (`safe-href.ts:45`) — the host is precisely what a site operator chooses.
  Unlike R9-22's case this one is a **live anchor**: `safeHref` passes `https://`.
- **status: reproduced** (against the real exported `sourceLabel` in `packages/core/src/pdf/report-html.ts`):
  ```ts
  const long = 'a'.repeat(4000);
  expect(sourceLabel({ url: `https://${long}.com/x` }).length).toBeGreaterThan(4000);
  expect(sourceLabel({ url: `https://${long}.com/x`, label: 'Fla. Admin. Code' }).length).toBeGreaterThan(4000);
  expect(sourceLabel({ url: `javascript:void("${'A'.repeat(4000)}")` }).length).toBeLessThanOrEqual(160); // R9-22's path
  ```
- **refutation attempted:** this is why it is P2 and not P1. In production the Sources rows are **derived**, not
  model-authored: `florida-business-for-sale.ts:778` maps `dedupeSources(searchResults)` and
  `refute-C1C2.test.ts:71` measures that the one registered template is the only shape. So the url comes from the
  search provider, and a hostname a resolver will actually serve is capped by DNS at 253 octets. The honest damage
  is therefore "a Sources row of up to ~253 characters where the design says 160", not 4,020 — but it is the same
  defect R9-22 was raised for, on the sibling branch, in both copies, and the 4,004-character version is one
  provider quirk away. The bound also silently stops being true if any future template lets the model write
  `sources` directly, which is the shape `refute-C1C2` exists to watch.
- **fix sketch:** `const h = cut(host)` once, and use it in both returns. Nothing honest loses anything: 160 code
  points is longer than any registrable hostname.

## Claims checked and TRUE (so nobody re-checks)

- **`0ff22ef` F1 — a titled image is never a live anchor.** Seventeen shapes through the production `mdInline`
  seam, all four title forms plus `"t)x"`, `"a" b "c"`, a balanced-paren destination
  (`https://beacon.attacker.test/a(b)c.png "t"`), an unbalanced one, `![](url "t")`, `[![alt](url)](click)`,
  a doubled `!!`, a trailing `))`, an escaped `]` in the alt, and two-space separation: **zero anchors at the
  beacon.** The strip matches at least a prefix of anything the link rule can match, so the ordering is what makes
  it hold, and it holds.
- **`0ff22ef` — the title cannot cross `)`.** Confirmed by construction and by test: a well-formed second link
  after a malformed first one survives, and `…/Hialeah,_Florida_(city)` renders as one clean anchor with the
  closing paren inside the href.
- **`0ff22ef` — all three CommonMark delimiters reach a clean anchor.** `"…"`, `'…'` and `(…)` all render as
  `<a href="…">text</a>` with the title discarded, including `tel:` and `mailto:`. `[listing](url 'It's the
  flagship')` falls back to raw Markdown in the PDF — and react-markdown does not parse it as a title either, so
  the two artifacts still agree. Not a finding.
- **`c1397a9` — `livePrefs` agrees with the request on all four paths the brief names** (mobile wizard, edit after
  pre-flight, accepted correction/proposal, assist off). See F1's refutation (c) for where I looked. The one
  divergence I could find between the SPA's `livePrefs` (`NewReport.tsx:432`) and the server's `planPreferences`
  (`deterministic.ts:145`) is a numeric or non-string directive value — the server drops it, the SPA prints it —
  and `DirectiveField.kind` is `'single' | 'multi' | 'boolean'` (`types.ts:219`), so it is unreachable through
  the manifest. Not a finding.
- **`c1397a9` — the directives really are out of `paramsKey`** (`NewReport.tsx:574`) and a chip click really does
  not buy a second review: my own repro asserts `preflight` was called exactly once after a post-preview edit.
- **`dcfeedf` — `allElseOk` is a separate key in all four languages in both tables and is conditioned in both
  renderers** (`report-html.ts:699`, `ReportViewer.tsx:554`, both `statuses.length === 1`). I checked the
  interaction with the cover notice: `sectionsNotice` prints its own reassurance under
  `lost > 0 && shallow === 0 && rebuilt === 0` (`report-copy.ts:137`), but its string is "*Everything else is
  complete.*" while the section line is "*Everything else was researched and written as usual.*" — different
  sentences, so a single-gap report does not read the same sentence twice. Not a finding.
- **`7a29a43` R9-23 — the prose anchor.** `a: ({ title: _title, node: _node, ...p })` does drop the hast node; a
  plain prose link carries only `href`/`target`/`rel`.

## Commit-message audit — every count I re-ran, claimed vs observed

The brief assigns this section to verifiers; these are the ones I ran anyway, because they are the load-bearing
claims of my group.

| commit | claim | observed |
|---|---|---|
| `7a29a43` | "adding `partial` to the list now reds **4** (0 before this commit)" | **TRUE — 4.** Mutation: `'partial'` added to `KNOWN_STATUSES` in `packages/core/src/engine/section-status.ts:43` **and** `apps/fbizlab/src/lib/section-status.ts:28`, and to `SECTION_STATUSES` in `packages/core/test/fixtures/section-lines.ts:34` (all three greps confirmed applied). Core reds **3** — `the PDF prints the partial line`, `and the cover notice says something about each one too`, `the engine writes exactly the statuses this fixture lists`. fbizlab reds **1** — `the viewer prints the partial line`. Caveat worth recording: `npm test` alone shows only **3 failed**, because core is red and the `&&` chain never reaches fbizlab. The 4 is real, but it is only visible if you run the two workspaces separately. Reverted from a copy; `git diff` clean. |
| brief step 3 | clean worktree totals **1162** (751 + 216 + 22 + 166 + 7), 16 skipped core, 6 api | **TRUE**, exactly, at `20f361b`. |
| `0ff22ef` / `c1397a9` / `dcfeedf` / `7a29a43` | suite totals of 1127 / 1130 / 1135 / 1149 in the *main* checkout at those commits | not re-measurable from this worktree at `20f361b`; not checked. |
