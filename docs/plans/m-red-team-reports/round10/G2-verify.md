# G2-verify — what the buyer reads (`c1397a9`, `dcfeedf`, `7a29a43`, `0ff22ef`) / VERIFY

Measured at **`20f361b`** (`git rev-parse HEAD` = `20f361b531626ac0412475407e0a169f1d4c8570`), in my own worktree
after `npm ci`. `apps/worker` `test/resolution.test.ts` passes, so `@agent-researcher/core` resolves to THIS
checkout. Clean-worktree baseline: **1162 passed, 0 failed** (751 core + 216 api + 22 worker + 166 fbizlab +
7 admin; 16 skipped in core, 6 in api) — the brief's number exactly. Working tree verified clean (`git status
--short` empty, `git diff --stat` empty) after every mutation and again at the end; final run re-measured
1162/0.

Because `npm test` chains the workspaces with `&&`, every count below comes from a harness that runs all five
suites unconditionally and sums the RED
(`…/scratchpad/round10/g2-verify/suite.sh`). That distinction turns out to matter — see the audit.

## Verdict

The four commits do what they say on the buyer's screen, and I could not break the two hardest pieces: the
Markdown image/link rules survive a 119-shape sweep with no anchor, no stray `!` and no swallowed tail, and the
four-language `allElseOk` copy is genuinely pinned in both copies — I drifted the FRENCH string in the viewer
and the PORTUGUESE string in the PDF and each went red on its own. What does not hold is one sentence of
`7a29a43`: **"It was the one path that returned an unbounded string."** It was not. `sourceLabel` clips the
label and now clips the url fallback, but never clips `host`, and `new URL(...).hostname` is unbounded — a
plain `https://` source with a 4,000-character hostname puts 4,006 characters into the Sources row of the PDF
the buyer keeps AND of the viewer, as a live anchor, in both copies, with the tooltip beside it correctly
bounded at 320. That is R9-22's own damage statement, reproduced through the half of the function the fix did
not look at, and its two new tests cannot see it because both fixtures use the empty-host `javascript:` url
that made the *other* branch fire. Separately, three of the fourteen mutation counts in these four messages do
not reproduce: `7a29a43`'s headline "adding `partial` to the list now reds **4**" reds **3** for the mutation
the same paragraph describes ("the union, both `KNOWN_STATUSES`, `SECTION_STATUSES`, the exhaustiveness
record"), and two of `c1397a9`'s counts are understated by one each in a way that is consistent with counting
red from a `&&`-chained `npm test` that stopped at the first failing workspace. All four suite totals are
correct.

## Findings (most severe first)

### F1 · A source with a long hostname puts 4,006 characters into the Sources row of the PDF and the viewer, as a live link — the same defect R9-22 closed, through the branch the fix did not clip — P1

- where:
  - `packages/core/src/pdf/report-html.ts:407-408` — `if (!clipped) return host || cut(s.url);` /
    `return host && clipped.toLowerCase() !== host ? `${host} — ${clipped}` : clipped;`
  - `apps/fbizlab/src/lib/safe-href.ts:68-69` — identical.
  - the claim: `7a29a43` commit message, R9-22 paragraph — *"`sourceLabel`'s last line is `return host ||
    s.url` … **It was the one path that returned an unbounded string** … Clipped now, in both copies."*
    `cut()` is applied to `label` and to `s.url`. It is applied to `host` on neither return.
  - the fixtures that cannot see it: `packages/core/test/red-team/refute-C1C2.test.ts:42` and
    `apps/fbizlab/test/red-team-c-attack.test.tsx:294` — both use
    `` const url = `javascript:void("${'A'.repeat(4000)}")` ``, whose `hostname` is `''`, so both exercise only
    the `cut(s.url)` branch. The bound on the other branch is unreachable from either fixture.

- input / observed: source `{ id: 1, url: 'https://' + 'a'.repeat(4000) + '.test/x' }`, no `label`.
  - `new URL(url).hostname.length === 4005` (Node/WHATWG `URL` enforces no length limit on a domain; a
    non-special scheme's opaque host is unlimited too — `foo://` + 4000 chars parses to a 4000-char hostname).
  - `sourceLabel({url})` → **4005** code points (both copies, core and fbizlab, identical).
  - `sourceLabel({url, label: 'Official registry'})` → **4025** (`${host} — ${clipped}`).
  - rendered PDF Sources row text: **4006** characters, and `safeHref` ACCEPTS `https://`, so unlike R9-22's
    case it is a live `<a href>` — worse than the span R9-22 measured.
  - rendered viewer row: **4006** characters of `li.textContent`, `title` attribute correctly **320**. The row
    and its tooltip disagree by 3,686 characters, which is precisely the asymmetry R8-35/R9-22 exist to end.

- status: **reproduced**. Scratch tests (ported verbatim from
  `…/scratchpad/round10/g2-verify/zz-host.test.ts` and `zz-host.test.tsx`, run and then deleted; tree verified
  clean):

  ```ts
  // packages/core/test/… — the core half
  const url = `https://${'a'.repeat(4000)}.test/x`;
  expect(sourceLabel({ url }).length).toBeLessThanOrEqual(160);          // observed 4005
  const html = buildReportHtml({ report: { sources: { items: [{ id: 1, url }] } },
    sections: [{ key: 'sources', title: 'Sources' }], meta: {}, lang: 'en',
    theme: getPdfTheme('fbizlab') } as never);
  const text = html.match(/<ul class="sources">([\s\S]*?)<\/ul>/)![1].replace(/<[^>]*>/g, '');
  expect(text.length).toBeLessThanOrEqual(200);                          // observed 4006, inside <a href="https:…">
  ```

  ```tsx
  // apps/fbizlab/test/… — the viewer half
  const { container } = render(<ReportViewer report={{ sources: { items: [{ id: 1, url }] } } as never}
    sections={[{ key: 'sources', title: 'Sources' }]} meta={{} as never} lang="en" />);
  const li = container.querySelector('li[title]')!;
  expect(li.textContent!.length).toBeLessThanOrEqual(200);               // observed 4006; title observed 320
  ```

- refutation attempted, four ways:
  1. *Does `new URL` bound a hostname?* No. Measured directly: `https://<4000×a>.test/x` → `hostname.length
     4005`; `https://<66 labels of 60 chars>.test/` → 4071; `foo://<4000×a>/x` → 4000. IDNA's 63-byte-label /
     253-byte-domain limits are not enforced by the WHATWG algorithm with `beStrict = false`.
  2. *Is it reachable, or does something upstream bound the url?* `packages/core/src/tools/sources.ts`
     (`normalizeUrl` / `dedupeSources`) has no length check — the only `url` guard is `if (!s.url) continue`.
     No `maxLength` sits on a `sources[].url` anywhere in the templates. The threat model R9-22 already
     accepted ("the `javascript:`/`data:` a model can be talked into writing as a `sourceUrl`") covers a
     model-authored `sources` section, and this variant additionally arrives from any crawled/search result
     whose url is long.
  3. *Is it cosmetic because CSS clips it?* No — R9-22 rejected exactly that argument for the url branch
     ("`safeHref` refuses the scheme, so it is a span and not a link; the text is on the page either way"),
     and here the string additionally is the anchor TEXT of a live link, which is the one thing about a source
     the row is supposed to guarantee ("the host is the one thing about a source its author does not choose"
     — `report-html.ts:381-388`). In the PDF it is a paginated document with no scroll container.
  4. *Is it out of scope for `7a29a43`?* No: the commit's own sentence is a universal ("the one path"), the
     fix's stated goal is "Clipped now, in both copies", and both copies still return an unclipped string.

- fix sketch: `return cut(host) || cut(s.url);` and `` return host ? `${cut(host)} — ${clipped}` : clipped ``
  (guarding the `clipped.toLowerCase() !== host` comparison against the *uncut* host so the dedupe still
  works). What a naive run loses: clipping the host at `SOURCE_LABEL_MAX` (160) is far more than any real
  host needs, so honest rows are unaffected — but clipping it at something small (say 60) would cut real
  long-but-honest hosts, and clipping the host AFTER the `!== host` comparison would break the
  "label equals host, don't print it twice" case. The fixture must use a long HOSTNAME, not the
  `javascript:` url: the existing two fixtures stay green through any host-side fix, which is exactly how
  this shipped.

### F2 · `7a29a43`'s headline measurement — "adding `partial` to the list now reds 4" — reds 3 for the mutation the same paragraph describes; the variant that reds 4 includes a test that predates the commit, contradicting "(0 before this commit)" — P2

- where: `7a29a43` commit message, R9-21 paragraph and mutation table; the tie it describes is
  `packages/core/test/fixtures/section-lines.ts:96` (`LINE_FOR_STATUS`).
- input / observed. The message defines the mutation twice, identically: *"a reviewer added one the way the
  type layer pushes you to — the union, both `KNOWN_STATUSES`, `SECTION_STATUSES`, the exhaustiveness
  record"*. I applied exactly that, adding `'partial'` to
  `packages/core/src/engine/section-status.ts:40` (union) and `:43` (`KNOWN_STATUSES`),
  `apps/fbizlab/src/lib/section-status.ts:25` and `:28`,
  `packages/core/test/fixtures/section-lines.ts:34` (`SECTION_STATUSES`), and
  `packages/core/test/section-status.test.ts:463` (`written`). `LINE_FOR_STATUS` is a type error without an
  entry, so I ran it both ways:
  - with `partial: 'degradedSection'` in `LINE_FOR_STATUS` → **3 red**
  - with `LINE_FOR_STATUS` untouched (undefined at runtime) → **3 red**

  The three are always: core `the PDF prints the partial line`, core `and the cover notice says something
  about each one too`, fbizlab `the viewer prints the partial line`.
  A **4th** red only appears if you *skip* `apps/fbizlab/src/lib/section-status.ts` — then
  `section-copy-parity.test.tsx > this bundle knows every status the engine can write > recognises exactly
  core’s set` reds as well (total 4). But `git show 7a29a43 -- apps/fbizlab/test/section-copy-parity.test.tsx`
  shows that describe block is context, not an addition: it predates the commit. So for the variant that
  measures 4, the parenthetical "(0 before this commit)" is false by one.
- status: **reproduced** (four full five-workspace runs: `m5`, `m5c`, `m5d`, and `pre21`).
- refutation attempted: I also confirmed the other half of the claim, and it is TRUE — at `7a29a43^`
  (`99a1a48`) the same mutation measures **0 red** across all five suites (727 + 216 + 22 + 161 + 7, 0
  failed). So the fix is real and the direction of the claim is right; only the figure is wrong. I could not
  construct any mutation matching the message's own description that reaches 4.
- fix sketch: correct the message/backlog line to `3 red (0 before this commit)`. Nothing in `src/` changes.
  Worth noting for whoever adds a real fourth status: 3 reds is still enough, and the chain is sound — the
  union ties to the `written` `Record`, `written` ties to `SECTION_STATUSES`, `SECTION_STATUSES` ties to
  `LINE_FOR_STATUS`, and both renderer suites iterate it.

### F3 · Two of `c1397a9`'s four mutation counts are understated by one; the pattern fits counting red from a `&&`-chained `npm test` — P2

- where: `c1397a9` commit message, "Revert-verified, full suite per mutation, red counted".
- input / observed (all five suites run unconditionally, measured **at `20f361b` and again at `c1397a9`
  itself** so suite drift cannot explain it):

  | mutation as the message names it | claimed | observed @`20f361b` | observed @`c1397a9` |
  |---|---|---|---|
  | the dialog renders the server pairs instead of the form | 1 | **2** | **2** |
  | the live preferences line removed | 2 | 2 | — |
  | `planPreferences` returns nothing | 1 | **3** | **2** |
  | the response drops `preferences` | 1 | 1 | — |

  For "the dialog renders the server pairs", both new SPA tests red — the second one
  (`…and states one the buyer set AFTER a preview that had none`) mocks a preflight response with **no**
  `preferences` field at all, so any mutation that renders `pf.preferences` instead of the form must red it.
  For "`planPreferences` returns nothing", core reds 1 and api reds 1 at `c1397a9` — and `npm test` chains
  with `&&`, so a run that stops after core sees exactly the claimed 1. The same explanation does not cover
  the first row (core and api are green there; the 2 reds are both in fbizlab, a single suite).
- status: **reproduced** (runs `m12`, `m12at`, `m13`, `m14`, `m14at`, `m15`).
- refutation attempted: I tried to find a narrower reading of "renders the server pairs instead of the form"
  that reds only one test — rendering `pf.preferences ?? []`, and rendering the old `pf.summary` clause both
  necessarily red the second test, because its mock deliberately carries neither. I also re-ran at the
  commit's own sha to rule out later tests inflating the count; it did not change.
- fix sketch: none in `src/`. The process fix is the brief's own rule — count red from a runner that does not
  stop at the first red workspace. Understated counts are the safe direction (more tests catch the regression
  than claimed), but they are still a number nobody re-measured.

### F4 · `0ff22ef`'s hand-check line "the malformed-title paragraph keeps every character and its second link" — the second link survives; "every character" does not — P2

- where: `0ff22ef` commit message, last paragraph of the hand-check list.
- input / observed. The paragraph in question is the one its own test uses
  (`packages/core/test/red-team/c-attack.test.ts:88`):
  `See [a](https://x.test/1 "Title A) and [b](https://y.test/2 "Title B").`
  Rendered: `<p>See [a](https://x.test/1 &quot;Title A) and <a href="https://y.test/2">b</a>.</p>`
  The second link survives, the prose between them survives, and nothing is silently swallowed — F3 is
  genuinely fixed. But `"Title B"` (and the second link's brackets) are gone: that trailing quote IS a
  well-formed title for link `b`, and titles are discarded by design ("It is discarded rather than rendered
  because a link title is the page's own account of itself"). So the sentence is true of the damage it cares
  about and false as written.
- status: **reproduced** (rendered through `buildReportHtml`; the test below it asserts only
  `toContain('https://y.test/2')` and `toContain('and')`, which is the accurate claim).
- refutation attempted: I checked whether the author might have meant a different paragraph — the message
  lists eleven shapes and this is the only "malformed-title" one. I also confirmed the title is discarded on
  every well-formed path (`"…"`, `'…'`, `(…)`), so the behaviour is intended and only the prose overstates.
- fix sketch: reword to "keeps every character of the prose and its second link". No code change.

### F5 · The confirm dialog's own copy key `prefsLead` is unpinned in all four languages — P2

- where: `apps/fbizlab/src/pages/NewReport.tsx:40, 71, 102, 133` (`prefsLead`, and the new `no` in each
  table); rendered at `:1085` (`data-testid="confirm-prefs"`).
- input / observed: `grep -rn "prefsLead\|Preferences you set\|Préférences que vous" apps/fbizlab/test
  packages/core/test` returns nothing. Both new SPA tests assert only the VALUE (`'Rain'`, `'Sunshine'`) and
  run in `lang="en"`. There is no key-completeness test over the `T` table
  (`grep -rn "Object.keys(T" apps/fbizlab` → nothing). A French or Portuguese `prefsLead` that drifted, or
  a fifth language added without it, stays green — the exact shape the repo has shipped twice (the `la passe`
  / `a passagem` incident that `section-lines.ts` exists to prevent).
  `c1397a9` does not CLAIM four languages for this string, so this is a gap and not a false claim. I checked
  the four strings by hand and they are correct today, including the French space before the colon.
- status: **reproduced** (the greps; and the two dialog tests read as English-only).
- refutation attempted: I looked for an indirect pin — a snapshot, a `Object.keys` parity assertion, an i18n
  lint — and found none for this file's `T` table.
- fix sketch: the cheapest correct fix is the pattern this repo already owns — assert
  `Object.keys(T.en)` equals `Object.keys(T[lang])` for `es|fr|pt` in `apps/fbizlab/test`. A naive fix that
  pins the four sentences verbatim instead makes every copy edit a two-file change for no benefit; the
  failure this repo actually suffers is a MISSING key, not a differing one.

### F6 · Two small divergences between the dialog's `livePrefs` and the server's `planPreferences` — P2

- where: `apps/fbizlab/src/pages/NewReport.tsx:432-443` vs
  `packages/core/src/moderation/deterministic.ts:158-184`.
- input / observed, reasoned from a line-by-line read of the two:
  1. The SPA renders an UNDECLARED directive value as `String(x)` (`f.options?.find(...)?.label ?? String(x)`);
     `planPreferences` filters through `allowed = new Set(field.values ?? [])` and drops anything else
     (that filter is R9-19's, added in `99a1a48` *after* `c1397a9`). The SPA also does not apply
     `field.maxSelected`. So the comment at `:428` — "The preferences the request is about to carry, in the
     manifest's own labels" — is true only for declared values. Reachable path: a draft restored from
     `localStorage` (`:337`) written before an option was renamed or removed. The buyer would read
     `Reason for sale: owner_retiring` on the last screen before payment and then get a 422.
  2. `yes`/`no` differ in case between the two renderings (`PREFS_YESNO` = `['yes','no'] / ['sí','no'] /
     ['oui','non'] / ['sim','não']`; the SPA's `t.yes`/`t.no` = `Yes/No`, `Sí/No`, `Oui/Non`, `Sim/Não`), so
     a headless client and the SPA print the same preference differently. **Not live today**: the only
     production template has no `kind: 'boolean'` directive (`grep -n "kind: '"
     packages/core/src/templates/florida-business-for-sale.ts` → 4 × `single`, 3 × `multi`), so both branches
     are dead copy. It becomes a real split the day one is added.
- status: **reasoned** (1 and 2 both; I did not build a template with a boolean directive or forge a draft).
- refutation attempted: I ruled out the three paths that could otherwise feed an undeclared value into
  `dirVals`: chip clicks are option-driven and `atCap`-guarded (`:505`); accepted proposals come from the
  server's own `proposeFromText` and are re-validated there; and `corrections` cannot touch directives at all
  — `florida-preflight.ts:140` declares `correctable` as exactly `location` and `industry`, so the
  correction-vs-dialog path the brief asks about is genuinely closed. That leaves only the stored draft.
- fix sketch: give the SPA the same `allowed`/`maxSelected` filter, and source `yes`/`no` from one place.
  A naive fix that makes the SPA silently DROP an unrecognised value re-creates R8-36 for that field (the
  screen goes quiet about something the request carries); it should drop it from the line **and** clear it
  from the form, so the dialog and the request stay equal.

## Claims checked and TRUE (so nobody re-checks)

- **`dcfeedf` — "in four languages, in both copies", and "rendered only when this section is the ONLY one with
  anything to report".** Both true and both pinned. `allElseOk` is present in en/es/fr/pt in
  `packages/core/src/pdf/report-html.ts:261-264` and `apps/fbizlab/src/components/ReportViewer.tsx:65-68`, and
  in the shared fixture. The condition is `statuses.length === 1` at `report-html.ts:707` and
  `ReportViewer.tsx:559`, and `normalizeSectionStatuses` only ever returns entries for sections that have
  something wrong, so the condition means what the sentence says.
  **Reproduced the four-language pin specifically** (the thing the brief flags): I drifted the **French**
  `allElseOk` in `ReportViewer.tsx` and the **Portuguese** `allElseOk` in `report-html.ts` in one run — 2 red,
  `fr says what core says, key for key` (fbizlab) and `the PDF prints the canonical line, key for key,
  language for language` (core). Neither is an English test.
- **`dcfeedf` mutation counts: all three correct.** the PDF says it under every gap again → **1 red**; the PDF
  drops the reassurance entirely → **1 red**; the viewer says it under every gap again → **1 red**. The third
  really does stop the naive "just delete the sentence" fix.
- **`0ff22ef` mutation counts: all four correct.** image strip forgets titles → **1 red**; title group
  unanchored (`.*?`) → **1 red**; `'…'` delimiter dropped → **2 red**; `(…)` delimiter dropped → **2 red**.
- **`0ff22ef` — the image rule cannot be turned back into a live anchor.** I swept 7 url shapes × 17 title
  shapes = 119 `![alt](url title)` forms (balanced parens in the url, unterminated quotes, `)` inside the
  title, tabs, doubled titles, empty delimiters) through `buildReportHtml`: **no `<a href=` in any output, no
  stray `!`, and no shape swallowed the text after the image.** The one cosmetic residue —
  `![p](https://a.test/x(y)z)` renders as `z)` because the strip's url class ends at the first `)` while the
  viewer drops the image entirely — predates this commit (the url class is unchanged by `0ff22ef`) and
  produces text, not a link.
- **`0ff22ef` — the honest cases the message lists.** Verified by rendering: `…/Hialeah,_Florida_(city)`
  survives whole; an apostrophe in prose (`The broker's own [listing](…) says it's fine.`) is untouched; a
  title containing `&` and `)` falls back to raw Markdown unchanged; all three title delimiters give a clean
  anchor with the title discarded.
- **`7a29a43` R9-23 — "the anchor now carries exactly `href`, `target`, `rel`".** True, and the mutation reds
  1 with the diff `expected [ 'href', 'node', 'rel', 'target' ]` — so the `node="[object Object]"` it
  describes was real. The test asserts the LIST, as claimed.
- **`7a29a43` R9-22, the branch it did fix.** Both hostless-fallback mutations red 1 each, in the right
  suites. (The branch it did not fix is F1.)
- **`c1397a9` — "R8-36 stays answered for every consumer".** True for the two consumers that exist: the
  `preferences` pairs are on the preflight outcome on BOTH construction paths
  (`preflight.ts:86` base and `:126` enriched), and dropping them reds the api test; the SPA renders from the
  live form and dropping that line reds 2 SPA tests.
- **`c1397a9` — "the dialog renders from the live form, not the preview" holds on the paths the brief names.**
  There is exactly one confirm dialog in the app (`grep whatWeWillSearch` → one render site,
  `NewReport.tsx:1072`), so there is no separate mobile-wizard copy of it. An edit after a pre-flight is the
  fixed case and is pinned both directions. An accepted correction cannot reach a directive
  (`correctable` = `location`, `industry` only). With the assist off, `livePrefs` is still read off
  `params[dirKey]`, which is the form.
- **`c1397a9` — the doc comment's honesty.** The `planPreferences` doc no longer says "every word here is a
  label from the manifest"; `99a1a48`/`ec66323` corrected it to name the lead-in and the `yes`/`no` as ours
  (R9-27). The version shipped in `c1397a9` still carried the over-claim; at `20f361b` it is fixed.
- **`c1397a9` — "`reserveAssistedReview` is claimed on EVERY preflight call where the assist is on".** Not
  re-measured by me (G1/G3 territory); the design consequence I did verify is that a chip edit buys no second
  review — the SPA test asserts `preflight` was called exactly once across the edit.

## Commit-message audit (verifiers only): every count I re-ran, claimed vs observed

Every row is a full five-workspace run with the RED summed across all five (never a `&&`-chained total).

### Suite totals — all four correct

| commit | claimed (main checkout) | claimed clean clone (= main − 6) | measured in my worktree | verdict |
|---|---|---|---|---|
| `0ff22ef` | 1127 (726 + 215 + 22 + 158 + 6) | 1121 | 720 + 215 + 22 + 158 + 6 = **1121** | ✅ |
| `c1397a9` | 1130 (726 + 216 + 22 + 160 + 6) | 1124 | 720 + 216 + 22 + 160 + 6 = **1124** | ✅ |
| `dcfeedf` | 1135 (730 + 216 + 22 + 161 + 6) | 1129 | 724 + 216 + 22 + 161 + 6 = **1129** | ✅ |
| `7a29a43` | 1149 (738 + 216 + 22 + 166 + 7) | 1143 | 732 + 216 + 22 + 166 + 7 = **1143** | ✅ |

The six-test gap is entirely in `core` in every case (main's core minus my core = 6, four times), which is
consistent with the brief's account of the `out/*/trace.json`-gated red-team tests. `7a29a43`'s "up from 1139"
also checks out: at `7a29a43^` my worktree measures 1133 = 1139 − 6.

### Mutation counts

| commit | mutation, as the message names it | claimed | observed | verdict |
|---|---|---|---|---|
| `0ff22ef` | the image strip forgets titles again | 1 | 1 | ✅ |
| `0ff22ef` | the title group unanchored (`.*?`) again | 1 | 1 | ✅ |
| `0ff22ef` | the `'…'` delimiter dropped | 2 | 2 | ✅ |
| `0ff22ef` | the `(…)` delimiter dropped | 2 | 2 | ✅ |
| `c1397a9` | the dialog renders the server pairs instead of the form | 1 | **2** (also 2 at `c1397a9` itself) | ❌ F3 |
| `c1397a9` | the live preferences line removed | 2 | 2 | ✅ |
| `c1397a9` | `planPreferences` returns nothing | 1 | **3** at `20f361b`, **2** at `c1397a9` (core 1 + api 1) | ❌ F3 |
| `c1397a9` | the response drops `preferences` | 1 | 1 | ✅ |
| `dcfeedf` | the PDF says it under every gap again | 1 | 1 | ✅ |
| `dcfeedf` | the viewer says it under every gap again | 1 | 1 | ✅ |
| `dcfeedf` | the PDF drops the reassurance entirely | 1 | 1 | ✅ |
| `7a29a43` | a fourth status added to the list | 4 | **3** for the mutation described; 4 only if fbizlab's `KNOWN_STATUSES` is skipped | ❌ F2 |
| `7a29a43` | …"(0 before this commit)" | 0 | 0 (verified at `7a29a43^` = `99a1a48`: 0 red, 1133 passed) — but false for the 4-red variant, whose 4th test predates the commit | ⚠️ F2 |
| `7a29a43` | the anchor spreads the hast node again | 1 | 1 | ✅ |
| `7a29a43` | the viewer's hostless fallback unclipped | 1 | 1 | ✅ |
| `7a29a43` | the PDF's hostless fallback unclipped | 1 | 1 | ✅ |

Exact mutations, for anyone re-running: image strip = drop `${MD_TITLE}` from `report-html.ts:159`;
unanchored = `MD_TITLE` → `` (?:\s+(?:&quot;.*?&quot;|'.*?'|\(.*?\)))? ``; delimiter drops = remove one
alternative from `MD_TITLE`; PDF-under-every-gap = drop the `statuses.length === 1 ?` guard at
`report-html.ts:707`; PDF-drops-it = delete the whole `${statuses.length === 1 ? … }` expression;
viewer-under-every-gap = same at `ReportViewer.tsx:559`; server-pairs = `const livePrefs =
(pf?.preferences ?? [])` at `NewReport.tsx:432`; line-removed = `{false && livePrefs.length > 0 && (` at
`:1084`; `planPreferences` returns nothing = `if (true) return [];` at `deterministic.ts:161`;
response drops `preferences` = `preferences: []` at `preflight.ts:86` and `:126`; hostless unclipped =
`return host || s.url` at `report-html.ts:407` / `safe-href.ts:68`; hast node = drop `node: _node` from the
destructure at `ReportViewer.tsx:145`; fourth status = `'partial'` into `section-status.ts:40,43`,
`apps/fbizlab/src/lib/section-status.ts:25,28`, `section-lines.ts:34` and `section-status.test.ts:463`.

### Prose claims

| commit | claim | verdict |
|---|---|---|
| `7a29a43` | "It was the one path that returned an unbounded string" | **FALSE** — F1 |
| `7a29a43` | "Clipped now, in both copies" | **FALSE as a universal** — the label and url are; `host` is not, in either copy — F1 |
| `7a29a43` | "the test asserts that list rather than the absence of one attribute" | TRUE |
| `7a29a43` | "the two hand-maintained lists … had nothing tying them together" / `LINE_FOR_STATUS` is the tie | TRUE (chain: union → `written` `Record` → `SECTION_STATUSES` → `LINE_FOR_STATUS` → both renderer suites) |
| `0ff22ef` | "the malformed-title paragraph keeps every character and its second link" | **overstated** — F4 |
| `0ff22ef` | "all four image forms strip to nothing with no stray `!`" | TRUE, and holds for 119 forms |
| `0ff22ef` | "all three link title forms give a clean anchor with the title discarded" | TRUE |
| `0ff22ef` | "the parenthesised Wikipedia destination, an apostrophe in ordinary prose, and a title containing `&` and `)` are unchanged" | TRUE |
| `dcfeedf` | "in four languages, in both copies" | TRUE, and pinned in fr and pt specifically (reproduced) |
| `dcfeedf` | "rendered only when this section is the ONLY one with anything to report" | TRUE |
| `dcfeedf` | "That closes every P1 in round 9" | not checked (G4's ledger) |
| `c1397a9` | "R8-36 stays answered for every consumer" | TRUE |
| `c1397a9` | "each client renders the set that matches what IT is about to submit" | TRUE for declared values; see F6 for the two edges |
| `c1397a9` | "every word here is a label from the manifest" (the comment as shipped) | was FALSE; already corrected at `20f361b` by R9-27 |
