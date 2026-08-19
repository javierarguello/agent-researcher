# G3-break — WHAT THE BUYER READS (`62b5e61`, `0250063`) / BREAK

Measured at `a37d5f57f2f4f9f042ba704a6dec96a7b7aa68da` (`git rev-parse HEAD` printed it; the worktree
arrived parked at `79fa632` and I checked out the brief's sha). `npm ci` then `apps/worker
npx vitest run test/resolution.test.ts` passed, so core resolves to THIS worktree. Baseline
`npm test`: **1109 passed, 0 failed** — 708 core (16 skipped) + 215 api + 22 worker + 158 fbizlab +
6 admin. Exactly the brief's number; no `out/` symlink.

## Verdict

Both commits do what they say for the input they were written against, and the three mutations
`0250063` claims each go red for the stated reason (I re-ran all three; counts below). But the batch's
headline claim for this group — *"the two artifacts now agree in both directions"* — is false in two
new directions that the fix itself opened. The PDF's new title branch reaches past the link rule it
was added to and re-opens the **image-beacon hole the line directly above it exists to close**: a
titled Markdown image `![alt](url "t")` now renders in the buyer's kept PDF as `!` + a live anchor at
the attacker's URL labelled with the attacker's alt text, while the viewer renders nothing at all
(F1, reproduced). The same branch's unanchored `.*?` runs over a whole joined paragraph, so a
malformed title **silently deletes** everything up to the next `&quot;)` — including a second, real
link — where the viewer keeps every character (F3, reproduced). Separately, `62b5e61` promoted four
languages of the per-section `degraded` line into a shared fixture without reading what the sentence
claims: it says *"Everything else was researched and written as usual"* **once per lost section**, so
a two-lost-section report tells the buyer that twice, and a lost+unenriched report contradicts itself
one section apart (F2, reproduced). That is the exact defect `report-copy.ts`'s `ALL_ELSE_OK` was
split out to fix — the fixture blessed the unfixed copy in all four languages. The section-status half
of `62b5e61` is otherwise sound: the parity fixture bites (2 red on the fr mutation), `KNOWN_STATUSES`
being exported changes nothing at runtime, and I found no fourth reader of section statuses that the
two suites miss.

## Findings (most severe first)

### F1 · A titled Markdown image is now a LIVE LINK to the attacker's URL in the PDF — the click-beacon the image-strip rule exists to stop — while the viewer shows nothing — P1

- where: `packages/core/src/pdf/report-html.ts:148` (the new title branch) vs `:128` (the image strip);
  viewer side `apps/fbizlab/src/components/ReportViewer.tsx:141` (`img: () => null`).
- input / observed: the repo's own beacon fixture with a title added —
  `![Bubbles Express verified photo](https://beacon.attacker.test/p.gif?ref=PZ-IMG&report=REPORT-ID "Verified by the Florida DBPR")`
  in `findings.overview`. PDF output:

  ```html
  <p>Two match. !<a href="https://beacon.attacker.test/p.gif?ref=PZ-IMG&amp;report=REPORT-ID">Bubbles Express verified photo</a></p>
  ```

  Viewer output for the identical Markdown: `<p>Two match. </p>`.
- mechanism: the image strip is `/!\[[^\]]*\]\([^\s)]*\)/` — its URL class `[^\s)]*` stops at the
  space before the title, so it needs a `)` and does not match a titled image. Before `0250063` the
  link rule did not match it either (no title branch), so the whole thing survived as literal text.
  Now the link rule matches `[alt](url "title")` inside `![alt](...)`, consumes it, and leaves the
  bare `!`. `report-html.ts:126-128` says in so many words what this costs: *"Without this line the
  link rule below turned `![alt](url)` into `!` + a link labelled by the alt text: a click-beacon
  dressed as a 'verified photo'."* The pin for it,
  `packages/core/test/red-team/c-attack.test.ts:41`, only uses the untitled form, so it stayed green.
- status: **reproduced.** Scratch test in my scratchpad, run as `packages/core/test/zz-g3-probe.test.ts`
  (deleted after; tree clean). Portable form — add to `c-attack.test.ts` beside the existing pin:

  ```ts
  const IMG_MD_TITLED = `![Bubbles Express verified photo](${BEACON} "Verified by the Florida DBPR")`;
  const html = pdf({ findings: { overview: `Two match. ${IMG_MD_TITLED}`, listings: [], risks: [`Lease. ${IMG_MD_TITLED}`] } }, [{ key: 'findings', title: 'Findings' }]);
  expect(html).not.toContain('beacon.attacker.test');
  expect(html).not.toContain('verified photo');
  ```

  Both assertions fail today.
- refutation attempted: (a) is the title form realistic? `![alt](src "title")` is CommonMark, the same
  syntax the fix was added for on the link side, and the model writes prose after reading
  attacker-controlled pages — the poisoned-web fixture already plants `IMG_MD`. (b) Does `safeHref`
  or `proseUrl` save it? No — neither runs in `mdInline`; the URL is `https:` and goes straight into
  `href`. (c) Is the `!` enough to warn a reader? It renders as a stray exclamation mark before an
  orange, underlined link labelled "verified photo". (d) Does the viewer also do it? No — `img: () =>
  null` drops the element, so the two artifacts disagree, which is the thing this commit set out to
  end.
- fix sketch: make the image strip tolerate a title, and run it *before* the link rule as it already
  does: `/!\[[^\]]*\]\([^\s)]*(?:\s+&quot;.*?&quot;)?\)/g`. Better, strip the `!`-prefixed form inside
  the link rule itself so the two can never diverge again. An honest run loses nothing — the renderer
  has never emitted an `<img>` and the viewer drops images at the element level; a naive fix that only
  widens the strip's URL class (`[^\s)]*` → `[^)]*`) would also swallow ordinary `)` and is not
  equivalent.

### F2 · Every lost section tells the buyer "Everything else was researched and written as usual" — false as soon as a second section is degraded, in all four languages, in both copies — P1

- where: `packages/core/test/fixtures/section-lines.ts:52,57,62,67` (`degradedSection`, the four
  languages this commit canonicalised), rendered at `packages/core/src/pdf/report-html.ts:650` and
  `apps/fbizlab/src/components/ReportViewer.tsx:554`.
- input / observed: a report with `meta.sections = [{key:'a',status:'lost'},{key:'b',status:'lost'}]`.
  The PDF contains the string `Everything else was researched and written as usual` **twice** — once
  under section A (where "everything else" includes the lost section B) and once under B. With
  `[{a:lost},{b:unenriched}]` the PDF prints the lost line under A and, one section down,
  `the step that adds extra depth … did not finish` under B: the two sentences are on facing screens
  and contradict each other. The cover notice, meanwhile, is correct in both cases
  (`2 sections of this dossier could not be completed…` / `One section … One section … did not finish`).
- mechanism: `sectionsNotice` was explicitly fixed for exactly this — `report-copy.ts:51-57`:
  *"Only said when NOTHING else is wrong. It used to be part of the sentence above, so a report with
  one lost section and one shallow one told the buyer 'Everything else is complete.' and then, in the
  next sentence, that it was not."* The per-section copy makes the same unconditional claim and was
  never given the same treatment. `62b5e61` read all four languages of it, aligned them, and pinned
  them from two suites — canonicalising the false half of the sentence rather than noticing it. The
  new fixture doc-comment (`section-lines.ts:41-43`) even restates the claim as intended behaviour:
  *"the body was suppressed; say so and say the rest is intact."*
- status: **reproduced.** Scratch test (`packages/core/test/zz-g3-probe2.test.ts`, deleted; tree clean):

  ```ts
  const html = buildReportHtml({ report: { a: {overview:'x'}, b: {overview:'y'}, c: {overview:'real'} },
    sections: [{key:'a',title:'A'},{key:'b',title:'B'},{key:'c',title:'C'}],
    meta: { sections: [{key:'a',status:'lost'},{key:'b',status:'lost'}] }, lang:'en', … } as never);
  expect((html.match(/Everything else was researched and written as usual/g) ?? []).length).toBe(0); // got 2
  ```

- refutation attempted: (a) does "everything else" plausibly mean "everything else in THIS section"?
  No — the sentence's first half is about the section (`We could not complete this section for this
  report`), so the second half's contrast is with the rest of the report; the es/fr/pt renderings
  (`Todo lo demás`, `Tout le reste`, `Todo o restante`) leave no room for the narrow reading. (b) Is
  multi-degradation real? `sectionsNotice` has a `{n} sections` plural for both `lost` and
  `unenriched`, so the product expects it; `run-job.ts:612` computes `degraded` from
  `.some(s => s.status === 'lost')` over an array. (c) Does the cover notice cancel it out? The cover
  is right; the line beside the section is what a buyer reads while looking at the gap, and it says
  something the cover has already contradicted.
- fix sketch: split the second sentence out of `degradedSection` the way `ALL_ELSE_OK` was split out
  of `LOST_ONE`, and emit it only when this is the report's only degraded section — i.e. pass the
  count/status set into the per-section renderer in both copies, and add the same two keys to the
  fixture. An honest run with one lost section loses nothing (same sentence). A naive fix that simply
  deletes the reassurance costs the single-lost-section case its one piece of good news, which is
  what the sentence is for — keep it, condition it.

### F3 · A malformed link title silently DELETES the rest of the paragraph from the PDF, including a second real link; the viewer keeps every character — P2

- where: `packages/core/src/pdf/report-html.ts:148` — `(?:\s+&quot;.*?&quot;)?` is unanchored and
  `.` is unbounded except by newline, and `mdToHtml` joins a paragraph's lines with a space
  (`report-html.ts:199`) before calling `mdInline`, so the reach is the whole paragraph.
- input / observed (all reproduced through `buildReportHtml`):

  | input (one paragraph) | PDF |
  |---|---|
  | `See [a](https://x.test/1 "Title A) and [b](https://y.test/2 "Title B").` | `See <a href="https://x.test/1">a</a>.` |
  | `[a](https://x.test/1 "see [b](https://evil.test/2") tail.` | `<a href="https://x.test/1">a</a> tail.` |
  | two lines of one paragraph, unterminated title on line 1 | everything from the first `[` to the last `&quot;)` collapses into one anchor |

  ` and [b](https://y.test/2 "Title B")` — 36 characters of the buyer's report including a working
  link — is gone from the artifact they keep and forward, with no marker. Before `0250063` the same
  input rendered as raw Markdown: ugly, but complete. The viewer, on the same shape
  (`See [the listing](https://ok.test/1 "Official registry) and note [the lease risk](https://ok.test/2 "Lease").`),
  keeps **every character** and still renders the second link:
  `<p>See [the listing](<a href="https://ok.test/1" …>https://ok.test/1</a> "Official registry) and note <a href="https://ok.test/2" …>the lease risk</a>.</p>`.
- status: **reproduced** (probe over 14 inputs; the well-formed cases are all correct — see "checked
  and TRUE").
- refutation attempted: (a) is a malformed title realistic? It needs `[t](url` + whitespace + `&quot;`
  and then an odd quote count before the next `&quot;)`. Honest, well-formed titles are safe (the lazy
  `.*?` stops at the first `&quot;` followed by `)`); I confirmed titles containing `)`, `&`, balanced
  inner quotes, `mailto:`/`tel:` and the parenthesised Wikipedia path all render correctly. So this
  needs an unterminated or odd-parity quote — which the model does emit, and which an
  attacker-controlled page can steer it into emitting, turning it into a primitive for **deleting**
  a risk sentence from the PDF while leaving it on screen. (b) Is it worse than what it replaced?
  Yes: raw Markdown is visible; deletion is not. (c) Could I make it eat across a paragraph boundary?
  No — blocks split on `\n{2,}` and `.` excludes `\n`, so the blast radius is one paragraph (or one
  bullet / checklist item).
- fix sketch: bound the title to what a title can be — `(?:\s+&quot;(?:(?!&quot;).)*?&quot;)?` is no
  better, so use a class that cannot cross a `)`: `(?:\s+&quot;[^)]*?&quot;)?`, or reject the match
  when the captured title contains `](`. Honest titles lose nothing (they contain no `)` in the cases
  above except the balanced-paren one, which then falls back to raw Markdown — the pre-fix behaviour,
  so the naive fix trades F3 for a smaller version of the defect R8-34 was raised for; F1's fix should
  land with it.

### F4 · The Sources tooltip is bounded at 320 and the row's own visible text is not — 4,020 characters of it on screen without hovering — P2

- where: `apps/fbizlab/src/lib/safe-href.ts:60` and the identical `packages/core/src/pdf/report-html.ts:350`
  (`if (!clipped) return host || s.url;`), rendered at `ReportViewer.tsx:264`.
- input / observed: `sources.items = [{ id: 1, url: 'javascript:void("AAA…4000…")' }]` with no
  `label`. `new URL()` parses it, `hostname` is `''`, the label is empty, so `sourceLabel` returns the
  **whole url**. Measured: row `textContent` 4,020 characters; `title` attribute 320. `safeHref`
  correctly refuses the scheme so it is a `<span>`, not a link — but the text is on the page.
- status: **reproduced** (fbizlab probe, deleted).
- refutation attempted: this is pre-existing, not introduced by `0250063` — but the comment
  `0250063` *edited* is what makes it a finding: `ReportViewer.tsx:256-259` now reads "the row shows
  (host first, label clipped) plus the url, so hovering cannot reveal 4,900 characters of a title an
  attacker wrote about their own authority". For a hostless url with no label the row reveals it
  without hovering. Also checked the ordinary paths: a real `https:` url with a long label gives
  `host — label(160)`, and an empty label gives just the host — both bounded.
- fix sketch: clip the fallback the same way — `return host || Array.from(s.url).slice(0, SOURCE_LABEL_MAX).join('')`
  (with the ellipsis), in both copies. An honest run loses the tail of a very long URL in the row
  label only; the `href` and the tooltip still carry it.

### F5 · `title` was not the only prop worth dropping from that spread: `node="[object Object]"` ships on every prose anchor — P2

- where: `apps/fbizlab/src/components/ReportViewer.tsx:140` — `{...p}` after removing `title`.
- input / observed: any prose link. Rendered DOM:
  `<a href="https://ok.test/2" node="[object Object]" target="_blank" rel="noopener noreferrer">`.
  react-markdown 9 passes its hast `node` to custom components; the TS type
  (`React.AnchorHTMLAttributes`) does not mention it, so the destructure did not catch it and the
  spread writes it into the DOM (React 18 renders unknown lowercase attributes verbatim).
- status: **reproduced** (visible in the F3 probe output above).
- refutation attempted: only `a` is a custom component that spreads (`img` returns null), so this is
  one attribute on one element type; it is inert and not attacker-controlled. It is a hygiene defect,
  not a leak — but the commit's whole subject is what that spread is allowed to carry, and it audited
  one prop of the two that do not belong.
- fix sketch: `a: ({ title: _t, node: _n, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => …`,
  or build the anchor explicitly from `href`/`children` and stop spreading. Nothing honest is lost.

### F6 · The tooltip clips by code point, not by grapheme cluster: the last glyph can still be half a flag — P2

- where: `apps/fbizlab/src/components/ReportViewer.tsx:264`.
- input / observed: `https://x.test/` + 279 `a` + `🇺🇸`×20, label `Beach`. `Array.from(...).slice(0,320)`
  ends the tooltip on a lone U+1F1FA regional indicator: the tail is `"🇺🇸🇺"`, and the buyer's last
  glyph is a boxed letter **U**, not a flag. Padding 281 does the same; 280/282 orphan the trailing
  half instead.
- status: **reproduced** (four paddings, fbizlab probe).
- refutation attempted: this is strictly milder than the lone-surrogate `?` R8-35 fixed (no
  replacement character, no invalid UTF-16) and the same is true of `sourceLabel`'s own 160-point cut
  and the handoff cut, so the whole codebase is consistent here. Reported only because the new test's
  claim is "clips by CODE POINT" and someone will one day read that as "clips safely". A percent-
  encoded real URL cannot contain raw emoji, so the honest reach is small; the label half can.
- fix sketch: `Intl.Segmenter('und', { granularity: 'grapheme' })` where available, falling back to
  the current cut. An honest run loses nothing; the cost is a Segmenter allocation per source row, so
  hoist it.

## Claims checked and TRUE (so nobody re-checks)

- **All twelve strings, four languages, three copies.** `SECTION_LINES` (fixture),
  `report-html.ts:212-215` (`RL`) and `ReportViewer.tsx:65-68` (`RL`) agree character for character
  for `degradedSection`/`unenrichedSection`/`reconstructedSection` in en/es/fr/pt — the two parity
  suites assert exactly that and I confirmed the assertion is over real values, not shapes.
- **The wrong words are gone from `src/`.** A repo-wide grep for `la pasada|la passe|a passagem|une
  passe|uma passagem|pasada d|passe d|passagem d` outside tests hits only `mot de passe` (password
  copy in `templates.ts:220` and `ResetPassword.tsx:12`) — not the section line. The Florida template's
  three `chart-refiner` descriptions are fixed in es/fr/pt as claimed.
- **The English `degradedSection` "below" really was only in the viewer**, and removing it aligned the
  two tables; no other language had a word for it.
- **`KNOWN_STATUSES` being exported changes nothing at runtime** — same `Set`, same three members,
  same two call sites in the two `normalizeSectionStatuses`; the rename is `KNOWN` → `KNOWN_STATUSES`
  and both files' only use is `.has(status)`.
- **No unpinned third reader of section statuses.** The readers are: the two `normalizeSectionStatuses`
  (both tied to `SECTION_STATUSES` by an equality assertion), `sectionsNotice`
  (`report-copy.ts:127-141`, three hard-coded filters) and `run-job.ts:612`'s `degraded` flag.
  `sectionsNotice`'s parameter type is a hard-coded three-literal union rather than
  `SectionStatus['status']`, so it would not red on a fourth status — but the CALL SITE
  (`run-job.ts:533`, passing `SectionStatus[]`) becomes a type error, so `npm run typecheck` catches
  it. Same for the `Record<SectionStatus['status'], true>` pin, which vitest transpiles away and only
  typecheck enforces. The claim holds, via typecheck rather than via a red test — worth writing down.
  The email (`templates.ts:183`) carries `sectionsNotice`'s output, not a fourth copy of the sentence,
  so there is nothing there to drift. The admin app renders no report prose (`react-markdown` appears
  only in `apps/fbizlab`).
- **The viewer has exactly one `title=` attribute** (`ReportViewer.tsx:264`, the Sources row) and all
  four `<Markdown>` call sites (`Prose`, `Checklist`, the string-array branch, the risk branch) pass
  `components={MD}`, so the `title` drop is uniform. No chart, tile, table or image path surfaces a
  model-authored tooltip.
- **The PDF's new title branch handles every well-formed case correctly** — verified against the
  viewer for: two titled links on one line (lazy `.*?` stops at the right quote), two untitled links,
  a title containing `(` and `)`, a title containing balanced inner quotes, a title containing `&`,
  `mailto:` with a title, `tel:` with a title, the parenthesised Wikipedia path, and single-quoted /
  parenthesised title syntax (both still fall through to raw Markdown, as they did before — a
  pre-existing, unchanged gap).
- **The 320 bound is reachable in an honest case** (a ~300-character listing URL), and the new
  `red-team-c-attack.test.tsx` fixture genuinely reaches it: 315 code points under the old
  `.slice(0, 320)` versus 320 under `Array.from(...)`, and index 319 of the old cut really is a lone
  high surrogate. The commit's account of why the OLD pin could not reach the bound (a 5,000-char
  label, clipped to 160, tooltip 188) is correct.

## Mutations I re-ran (BREAK lens — did each new test red for its STATED reason?)

| mutation | claimed | observed |
|---|---|---|
| PDF regex loses its title branch (`report-html.ts:148`) | 1 red | **1 red** — `c-legit.test.ts:85`, `expected [] to deeply equal ['https://ok.test/p']`. Stated reason exactly. |
| the anchor spreads `title` again (`ReportViewer.tsx:140`) | 1 red | **1 red** — `red-team-c-attack.test.tsx:281`, `getAttribute('title')` not null. Stated reason exactly. |
| the tooltip clips by UTF-16 unit again (`ReportViewer.tsx:264`) | 1 red | **1 red** — `red-team-c-attack.test.tsx:301`. Note: it reds on the *length* assertion (315 ≠ 320), not on the lone-high-surrogate assertion two lines down, which never executes. Same defect, but the sentence the test is named for is only reached when the length one passes. |
| viewer fr → `la passe` (`ReportViewer.tsx:67`) | 2 red | **2 red** — `section-copy-parity.test.tsx:26` (key-for-key) and `:30` (wrong-word). Stated reason exactly. |

Also noted for `G3-verify`: `0250063`'s message writes the new tooltip code as
`Array.from(...).slice(320).join('')`; the shipped line is `.slice(0, 320)`. And its "Checked by hand
that the new branch does not eat what it should not" enumerates three inputs — a title with `&` and
`)`, an untitled link, and the Wikipedia path — none of which is a titled **image** (F1) or an odd
quote count (F3).

`git diff` is clean; every mutation was reverted and verified with `git status --porcelain`. All
scratch scripts were written to and deleted from my own scratchpad path.
