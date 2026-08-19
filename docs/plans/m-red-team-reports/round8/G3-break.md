# G3-break — what the buyer sees and types (`apps/fbizlab`) / BREAKER

Measured on `4b612426ebb97f9dd38f1561c047413ffd07390c` (my worktree's HEAD, unchanged; `git status` clean at the
end of the run). `npm test` from the root: **GREEN, 1065 passed / 22 skipped** — six short of the brief's 1071,
which is the `out/*/trace.json` gate (`d-legit.test.ts:619`, `refute-b1.test.ts:161`, `refute-B2`), absent from a
worktree checkout. The brief's "~16 fewer" overstates it here: the delta I measure is exactly 6.

## Verdict

The four claims hold for the path the commits were written against — one buyer, one pass, straight through. They
break the moment the buyer does the thing this batch's own design invites them to do: **go back to the form and
change what the notes filled.** The preview key deliberately stops tracking the directive block, so the confirm
dialog can be re-opened over params it never saw; the dialog then shows a ticked row asserting a value the form no
longer holds, and unticking that row deletes the buyer's own hand-picked value (F1). The rule "switching is a view
change, never a data change" is true of the toggle and false of the assist: once `assistOff` latches, the buyer's
2,000 characters are frozen on screen behind an **Edit button that does nothing**, still sent on every later
preflight, under two sentences that contradict each other about whether they were read (F2). The 5xx
"generate-anyway" fallback submits the PREVIOUS review against the CURRENT params, so a stale correction and a
stale ticked basic overwrite two fields the buyer typed by hand — and the basic half is new in this batch (F3).
And R7-7's exact damage statement — "the job was created with the proposals of the sentence they had deleted" — is
back, because `16e7014` moved the proposal out of `pf` and into `params`, where deleting the notes cannot reach it
(F5). On the render side `proseUrl` itself is sound, but the same hover surface R7-24 bounded is unbounded one
element over (F6), and the new tooltip clips by UTF-16 unit in the batch that fixed exactly that elsewhere (F7).

Everything below is **reproduced** with `@testing-library/react` against the real components (or the real
`acceptProposals` / `buildReportHtml`), on the fixtures the existing suites already use. Scratch files were
deleted; `git status` is clean.

## Findings (most severe first)

### F1 · Unticking a suggestion in the confirm dialog DELETES the value the buyer picked by hand — and the dialog states a value that will not be sent — P1

- where: `apps/fbizlab/src/pages/NewReport.tsx:438-447` (`keepProposal`), `:532-534` (`paramsKey` / `validated`),
  `:1027-1048` (the proposals list is rendered from `pf.proposals`, never from the form)
- input / observed:
  1. notes → Validate → `{ directives: { weather: 'sun' }, quotes: { weather: 'sunshine' } }` lands on the form,
     ticked, tagged «sunshine».
  2. Go back; click **Rain**. `editDir` takes the field back (the tag goes) — the flow `16e7014` exists to enable.
  3. Press Generate. The directive block is out of the preview key, so `validated` is still true and the dialog
     re-opens with **no** re-validation (pinned by the existing test at `new-report.test.tsx:715`).
  4. The proposals block shows `Preferred weather: **Sunshine** — «sunshine»`, **checkbox ticked**. The word
     "Rain" appears nowhere in it. This is the last screen before credits are spent, and it asserts a value the
     form does not hold and the job will not receive.
  5. Untick it — the honest reading of "I changed that". `keepProposal(k, v, quote, false)` runs
     `setDir(k, undefined)` and the buyer's **Rain is deleted**. Ordered params: `directives` absent entirely.
- status: **reproduced**. Test (drop into `new-report.test.tsx`'s proposals describe, using its `toProposals` /
  `order` helpers):
  ```tsx
  await toProposals({ directives: { weather: 'sun' }, keywords: [], quotes: { weather: 'sunshine' } });
  await userEvent.click(screen.getByRole('button', { name: /go back|back/i }));
  await userEvent.click(screen.getByRole('button', { name: 'Rain' }));          // the hand edit
  await userEvent.click(screen.getAllByRole('button', { name: /generate dossier/i })[0]!);
  const block = await screen.findByTestId('proposals');
  const box = screen.getByTestId('accept-weather') as HTMLInputElement;
  expect(box.checked).toBe(true);                    // still ticked
  expect(block.textContent).toContain('Sunshine');
  expect(block.textContent).not.toContain('Rain');   // the dialog names a value that will not be sent
  await userEvent.click(box);
  expect((await order()).directives).toBeUndefined();// their own pick is gone
  ```
- refutation attempted: (a) *does the edit force a re-preview, so the block is refreshed?* No — that is the whole
  point of taking the directives out of `paramsKey`, and `new-report.test.tsx:715` pins it. (b) *Does the API
  refuse to propose a field the buyer set?* Yes (`enrich.ts:463`, `current[f.key] !== undefined`) — but that only
  covers a value set BEFORE the preflight; this one is set after. (c) *Is `submit` reading the form?* Yes —
  `:723` forces `directives: {}` on the merged set, so the form is authoritative at submit. That is exactly what
  makes the dialog's ticked row a lie rather than a preview.
- fix sketch: `keepProposal` must only clear a field it still owns — `if (!on && fromNotes[k] !== undefined)
  setDir(k, undefined)` — and the row must render the FORM's current value (and its own ticked state) from
  `dirVals`/`fromNotes`, not from the frozen `pf.proposals`. A field no longer owned should render as
  "you changed this" rather than as an accepted suggestion. Naive fix that loses honesty: dropping the whole
  proposals block once `validated` survives an edit — the buyer then cannot recover a suggestion they unticked
  by accident.

### F2 · Once the assist is off, the buyer cannot edit or delete their own 2,000 characters — the "Edit" button is inert and the text keeps being sent — P1

- where: `apps/fbizlab/src/pages/NewReport.tsx:416-417` (`assistOff` / `picking`), `:853-862` (the toggle is
  hidden when `assistOff`), `:883-891` (`toggle-notes` calls `setWay('write')`, which `picking` overrides),
  `:871` + `:881` (the two sentences)
- input / observed: type notes → Validate → the preflight answers `assist: { state: 'off_attempts' }` → Go back.
  The form shows the notes quoted, with **Edit** beside them. Clicking Edit does nothing: `setWay('write')` is
  overridden by `picking = way === 'pick' || assistOff`. `free-text` is never in the DOM again. The commit
  message claims "the box is not offered back at all" — it *is* offered back, as a live control that cannot act,
  which is the failure mode `dirField`'s own comment names ("a click that does nothing reads as a broken form",
  `:483`). Meanwhile the same section renders both:
  - `t.s4Off` — "Your notes were not read this time." and
  - `t.notesKept` — "Your notes are still sent — we read them when you continue."

  and the second is the true one: every later `/preflight` still carries `freeText`
  (`:632`), where it is still moderated server-side (`apps/api/src/index.ts:1439`).
- status: **reproduced**.
  ```tsx
  hooks.preflight.mockResolvedValueOnce({ ok: true, summary: 'We will research X.', quality: 'ok',
    issues: [], corrections: [], assist: { state: 'off_attempts', message: 'No attempts left.' } } as never);
  // …type 'sell me a sunny parcel' into free-text, Validate, Go back…
  await userEvent.click(screen.getByTestId('toggle-notes'));
  expect(screen.queryByTestId('free-text')).toBeNull();          // the box never comes back
  const sec = screen.getByTestId('assist-off').closest('section')!;
  expect(sec.textContent).toContain('Your notes were not read this time');
  expect(sec.textContent).toContain('Your notes are still sent — we read them when you continue');
  // edit any keyed field and re-validate:
  expect((hooks.preflight.mock.calls.at(-1)![0] as any).freeText).toBe('sell me a sunny parcel');
  ```
- refutation attempted: (a) *is there another way back to the box?* No — `toggle-preferences` is hidden under
  `!assistOff`, and `assistOff` is sticky for the rest of the draft once `off_attempts` is returned (the claim is
  per `draftId`, `apps/api/src/index.ts:1420`). Reload is the only escape and it drops the whole form. (b) *Does
  it matter, since the notes never reach the job?* They reach `/preflight` and its moderation on every attempt,
  and the buyer is being told the opposite of what is happening to their own words on the same screen.
  (c) *Is the collapsed block only shown when there ARE notes?* Yes (`:875`) — which is precisely the case where
  the buyer has something to withdraw.
- fix sketch: either hide `toggle-notes` when `assistOff` (honest: they cannot get the box back) **or**, better,
  let it work and keep the box read-only-plus-clear — a "remove my notes" action. Do NOT keep both sentences: if
  the notes are still sent, `s4Off` must say "we could not read them this time — they are still attached" rather
  than "not read".

### F3 · A 5xx on the SECOND validation submits the FIRST review: a stale correction and a stale ticked basic overwrite what the buyer typed — P1

- where: `apps/fbizlab/src/pages/NewReport.tsx:693-700` (the `else` fallback calls `submit()` with `review = pf`
  from state), `:716` (`base[c.field] = c.to` — `c.from` is never compared with the current value), `:723-726`
  + `:209` (`mergeProposals` writes `out[f] = v` for every ticked basic, unconditionally)
- input / observed:
  1. Validate. The review returns `corrections: [{ field: 'gridRegion', from: 'ERCOT West', to: 'ERCOT West
     (Texas)' }]` and `basics: { parcelUse: 'Miami-Dade' }`. The buyer ticks the basic.
  2. Go back. They change their mind by hand: `gridRegion` → `MISO South`, `parcelUse` → `Broward`.
  3. Press Generate → "Validate & continue" (both fields are in the key, so re-validation is correctly forced)
     → the preflight 500s. The review is advisory, so the form generates anyway — behaviour deliberately pinned
     by `new-report.test.tsx:450`.
  4. The job is created with `gridRegion: 'ERCOT West (Texas)'` and `parcelUse: 'Miami-Dade'`. **Both hand-typed
     values are gone**, replaced by a review computed for text that no longer exists — and `parcelUse` stands in
     for Florida's one `fillable` basic, `location`, i.e. what gets searched at all.
- status: **reproduced** (full test in the run log; the assertions are
  `expect(params.gridRegion).toBe('ERCOT West (Texas)')` and `expect(params.parcelUse).toBe('Miami-Dade')` after
  `hooks.preflight.mockRejectedValueOnce(new ApiError(500, 'boom', {}))` on the second validate).
- refutation attempted: (a) *Isn't this the wholesale-`correctedParams` bug `16e7014` already fixed?* The
  correction half is a survivor of it — field-by-field is strictly better than the snapshot but still applies a
  diff whose `from` no longer matches. The **basic** half is new: basics and `mergeProposals` were introduced by
  `38bfc53` in this batch, and `out[f] = v` has no "only if still empty" guard, unlike its server twin's contract
  ("a param the buyer left empty", `enrich.ts:497`). (b) *Is the 5xx path reachable in production?* It is the
  documented, tested behaviour for a 5xx or a dropped connection, and it is the branch the comment at `:694`
  argues for. (c) *Does the buyer see anything?* No dialog is shown — `submit()` runs and navigates to the job.
- fix sketch: gate both merges on the value being unchanged since the review — `if (base[c.field] === c.from)`
  for a correction, and `if (!String(base[f] ?? '').trim())` for a basic — and, separately, only use `pf` in the
  fallback when `validatedKey === paramsKey`. What an honest fix loses: nothing the buyer wanted; it does mean a
  typo fix silently stops applying after they retype the field, which is correct.

### F4 · The preferences that steer the shortlist never appear on the last screen before payment — P2

- where: `packages/core/src/templates/florida-preflight.ts:207-231` (`describePlan`), reached from
  `NewReport.tsx:996` (`pf.summary` is the whole of "What we'll search")
- input / observed: `describePlan` renders industry, location, price band, revenue, cash flow, SBA, real estate
  and keywords. It renders **no directive at all**. `38bfc53`'s own message says "six of the seven fields decide
  which listings get shortlisted" — so the summary headed "What we'll search", the one artefact the batch calls
  "unforgeable" and "the request as the buyer TYPED it", is silent about six of the seven preferences that will
  be sent. When the fields view is not on screen (F5's flow, or any buyer who stayed in `write`), nothing on the
  confirm screen states them.
- status: **reproduced** by reading (`describePlan` touches no `p.directives`); observed indirectly in F5, where
  ordering with `directives: { weather: 'sun' }` produced a summary identical to one without it.
- refutation attempted: the proposals block does list them — but only while `pf.proposals` is non-empty, i.e. not
  after a second preflight that proposes nothing, and never for values the buyer picked by hand.
- fix sketch: append the set directives to `describePlan` (they are already localized in the manifest), so the
  summary is a function of the params actually being submitted.

### F5 · R7-7 restored: proposals from a sentence the buyer DELETED are still ordered — P1

- where: `apps/fbizlab/src/pages/NewReport.tsx:644-655` (a kept proposal is written into `params[dirKey]`),
  `:532-534` (the notes are in the key, so the preflight re-runs — but nothing un-writes the params)
- input / observed:
  1. Notes "sunshine, red, absentee" → Validate → `weather: 'sun'` is quoted, ticked, written into
     `params.directives`, `way` flips to `pick`.
  2. Go back, switch to the box, **clear the notes entirely**.
  3. Press Generate → "Validate & continue" (correct: the notes ARE in the key, R7-7's fix works) → the preflight
     re-runs with **no `freeText`** and returns no proposals.
  4. The job is created with `directives: { weather: 'sun' }`. The preference derived from the deleted sentence
     is ordered and paid for, and at that moment the section is showing the BOX — the value is behind a toggle,
     absent from the summary (F4), and absent from the dialog (no proposals block on the second review).
- status: **reproduced**:
  ```tsx
  await toProposals({ directives: { weather: 'sun' }, keywords: [], quotes: { weather: 'sunshine' } });
  await userEvent.click(screen.getByRole('button', { name: /go back|back/i }));
  await userEvent.click(screen.getByTestId('toggle-preferences'));   // back to the box
  await userEvent.clear(screen.getByTestId('free-text'));
  // …re-validate (preflight returns no proposals), then order…
  expect(params.directives).toEqual({ weather: 'sun' });
  expect(pfCall.freeText).toBeUndefined();   // the text that justified it is gone from the request
  ```
  `fromNotes` is also never cleared, so toggling back to the fields still shows `✎ from your notes — «sunshine»`
  quoting text that no longer exists anywhere.
- refutation attempted: (a) *Is it "theirs" now, since it arrived ticked?* It arrived ticked by default
  (`defaultAccepted`), which is not an act of acceptance; deleting the sentence is one. `929e8dd`'s own damage
  statement is "the job was created with the proposals of the sentence they had deleted" — the mechanism moved
  (from a stale `pf` to `params`), the outcome did not. (b) *Is it visible?* Only if the buyer toggles to the
  fields, which the flow that reaches this state has just toggled away from. (c) *Does `acceptProposals` skipping
  set fields save it?* The opposite — because the value is now in `params`, the server will never propose that
  field again, so the second review cannot correct it either.
- fix sketch: when a preflight runs with a `previewText` that no longer contains the quote a field was tagged
  with — or simply when `freeText` becomes empty — drop the still-tagged entries from `params[dirKey]` and
  `fromNotes` (a value the buyer has since edited by hand has already lost its tag, so it survives untouched).
  Naive fix that loses an honest run: clearing all directives on any re-preflight would also wipe hand picks.

### F6 · An unbounded, attacker-authored link TITLE is one hover away in the viewer — and the same link is raw Markdown in the PDF — P2

- where: `apps/fbizlab/src/components/ReportViewer.tsx:133` (`<a {...p} …>` spreads react-markdown's props,
  `title` included) and `packages/core/src/pdf/report-html.ts:141` (the link regex has no title branch)
- input / observed: prose `See the [official listing](https://attacker.test/p "Official registry of the State of
  Florida. …")` with a 5,160-character title.
  - Viewer: `<a href="https://attacker.test/p" target="_blank" title="…5160 chars…">`. R7-24 bounded the Sources
    tooltip at 320 precisely because "an attacker page's 4,900-character claim about its own authority was one
    hover from being displayed exactly as written". The prose link's tooltip has **no bound at all**, on the same
    three surfaces, and the sentence is chosen by the same author.
  - PDF: `expect(out).not.toContain('<a href="https://ok.test/p"')` and `expect(out).toContain('[official
    listing](https://ok.test/p')` both hold — a titled link reaches the buyer's kept artefact as raw Markdown,
    brackets showing. That is the identical defect `1ce4893` fixed for `tel:`, and its claim that "both halves
    had to move together" leaves the title case still split.
- status: **reproduced** (viewer: `render(<ReportViewer report={{ m: { text: md } }} …/>` then
  `expect(a.getAttribute('title')!.length).toBe(claim.length)`; PDF: `buildReportHtml` with the same string, plus
  a control proving the untitled link IS an anchor).
- refutation attempted: (a) *Does `urlTransform` cover it?* No — `proseUrl` only sees the destination. (b) *Does
  react-markdown strip titles?* No, it maps them onto the `title` attribute. (c) *Would the model write one?*
  Titled links are ordinary Markdown and the prose is written after reading attacker-controlled pages; the same
  assumption underwrites the whole of C1/C2.
- fix sketch: in `MD.a`, drop or clip `title` (`const { title, ...rest } = p` and re-add
  `title?.slice(0, 320)` by code point) — and add a title branch to the PDF regex so the two artefacts finally
  agree, which is what `1ce4893` claimed.

### F7 · The new Sources tooltip clips by UTF-16 unit, in the batch that fixed exactly that elsewhere — P2

- where: `apps/fbizlab/src/components/ReportViewer.tsx:254` —
  ``title={`${sourceLabel(s)} — ${s.url}`.slice(0, 320)}``
- input / observed: a source url of 280 ASCII characters followed by `🏖` repeated. The `title` attribute is 320
  UTF-16 units long and its last unit is a **lone high surrogate** — the buyer's screen paints `?`/`�`.
  `sourceLabel` itself is correct (`Array.from`, `safe-href.ts:58`); the `.slice` wrapped around it is not.
  `2c346de` in this same batch fixed the identical defect for `progress.detail` and its message says the rest of
  the batch "clips by code point"; `clientProgress` (`jobs/types.ts:152-155`) even carries the comment "By CODE
  POINT, like `sourceLabel` and the handoff cut". This one line is the exception.
- status: **reproduced** — `expect(title.charCodeAt(319)).toBeGreaterThanOrEqual(0xd800)` and
  `<= 0xdbff` both hold.
- refutation attempted: the existing pin `red-team-refute-C1C2.test.tsx:126` asserts
  `[...title].length <= 320` on a fixture whose tooltip is 188 characters — **the bound is unreachable in that
  test**, and the assertion is tautological besides (`.slice(0, 320)` can never yield more than 320 code points).
  This is standing lesson #2 in the file that was rewritten to close R7-24. Both halves need a long URL, not a
  long label, to be exercised at all.
- fix sketch: `Array.from(\`${sourceLabel(s)} — ${s.url}\`).slice(0, 320).join('')`, and change the pin's fixture
  to a 5,000-character URL so the bound is actually reached.

### F8 · `verbatim()` proves the QUOTE is in the text, never that the VALUE is — three characters are enough to pre-tick — P2

- where: `packages/core/src/moderation/enrich.ts:288` (`QUOTE_MIN_LEN = 3`), `:300-306` (`verbatim`),
  `:497-514` (basics), consumed by `NewReport.tsx:180-187` (`defaultAccepted` ticks anything with a quote)
- input / observed, against the real Florida template and `acceptProposals`, buyer text
  `"Busco una lavandería en Hialeah, presupuesto máximo 500k."`:
  - `{ riskAppetite: { value: <any vocabulary value>, quote: 'una' } }` → kept **with** a quote → the client
    ticks it by default. The evidence the buyer is shown is `«una»`.
  - `{ basics: { location: { value: 'Orlando, FL', quote: 'una' } } }` → `basics.location = 'Orlando, FL'`,
    `quotes.location = 'una'`. The buyer wrote *Hialeah*. The one field the batch calls higher-bar because "it
    decides what is searched at all" accepts a value from anywhere on earth as long as the model returns any
    three-character substring of the note as its "quote".
- status: **reproduced** (two assertions above, run against `getTemplate('florida-business-for-sale')`).
- refutation attempted: (a) *Are basics saved by being unticked?* Yes — that is the mitigation, and it holds; but
  the commit's stated gate is "a basic requires a verbatim quote", and that gate is satisfied by a quote with no
  relation to the value. (b) *Is the comment right?* `QUOTE_MIN_LEN`'s own comment says "shorter than this and a
  'quote' matches almost any text by accident" — three characters still matches almost any text by accident, so
  the constant does not do what its comment claims. (c) *Would a real model do this?* Unmeasured here (no paid
  model); the point is that the CODE's guarantee is weaker than the message's, which is what a reviewer can
  check.
- fix sketch: for a **basic**, require the value itself (flattened) to appear in the text, not merely a quote —
  a location the buyer typed is always a substring of what they typed. For a directive, raise `QUOTE_MIN_LEN`
  to something a filler word cannot reach (a word count ≥ 2, or ~8 characters) so the pre-tick means what the
  client says it means. What an honest run loses: nothing for basics; a small number of genuinely short quotes
  ("SBA", "absentee") would drop to unticked-but-present, which is the designed fallback.

## Claims checked and TRUE (so nobody re-checks)

- **Keywords are still in the preview key.** `keyParams` (`NewReport.tsx:532`) destructures out only `[dirKey]`;
  `keywords`, `preferredSources` and every typed param stay in `paramsKey`. Nothing the buyer types is outside
  "already validated" except the closed-vocabulary directive values, as claimed.
- **Directive values really are from closed vocabularies.** Every write to `params[dirKey]` is either a chip
  (`dirField`, manifest options) or a server proposal that passed `acceptProposals`' `values.has(v)` gate. No
  free text reaches the block.
- **Basics start unticked and `applyProposals` leaves them out.** `defaultAccepted` sets `basic:<f>` to `false`
  unconditionally (`:185`), `pickAccepted` filters on it (`:194`), and `applyProposals` needs `opts.basics`
  (`enrich.ts:571`). A pre-basics client cannot fill a location it never rendered.
- **A quoted proposal ticks, an inferred one does not**, and the inferred value is still present and one click
  away (`:183`) — the R7-9 shape is implemented as described.
- **`acceptProposals` never overrides a field the buyer already set** (`enrich.ts:463`), and the tag really is
  dropped by a hand edit (`editDir`, `:425-433`).
- **`proseUrl` closes R7-21.** `/^(https?:\/\/|mailto:|tel:)/i` refuses protocol-relative (`//host/p`),
  same-origin (`/api/x`), `javascript:` and `data:`; entity-encoded schemes are decoded by react-markdown before
  the transform, so `&#106;avascript:` is refused too. `MD.a` renders the children rather than a dead anchor when
  the href is emptied. `img: () => null` still drops every image. I found no way to get a live link to another
  scheme into the viewer.
- **`sourceLabel` leads with the host and clips the label to 160 code points**, in both packages, and the
  cross-package pin exists.
- **`progressLine` never prints an internal key**: an unknown kind returns `null` (`progress-copy.ts:51`) and
  `JobView` renders nothing rather than the raw word; the step label above it comes from the manifest. The
  `cut_off` / `held` / `PROGRESS_KINDS` pin is real and reads the core's own list. `clientProgress` clips
  `detail` by code point and only for `searched`.
- **The live line renders in the report's language** (`JobView.tsx:87`, `reportLang` with an `LANGS` guard), and
  falls back to the UI language for a params language the SPA does not speak.

## Commit-message audit (verifiers only)

Not my lens; two things I happened to measure and that the verifier should carry:

- `1ce4893` claims "the tooltip carries the raw label again → 2 red". The bound half of that pin
  (`red-team-refute-C1C2.test.tsx:126`, `[...title].length <= 320`) can never go red for the stated reason — its
  fixture's tooltip is 188 characters and the assertion is implied by `.slice(0, 320)` regardless. Only the
  `startsWith('x.test — ')` assertion is load-bearing. See F7.
- `1ce4893` claims the PDF and the viewer "agree on what is a link" after adding `tel:`. They still disagree on
  `[text](url "title")` — anchor in the viewer, raw Markdown in the PDF. See F6.
