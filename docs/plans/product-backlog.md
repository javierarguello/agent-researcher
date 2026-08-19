# Product backlog

Things to BUILD, as opposed to things that are broken. Same conventions as the rest
of `docs/plans`: each item names the value and the cost, cites `file:line` for
everything it claims about the code today, and says what was verified by reading vs
what is still a hypothesis. Product decisions — numbers and scope someone has to
choose — are called out as such.

---

## P-1 · A dossier that compares TWO scenarios (locations, or industries) — `open`

**Asked for by Javier, 2026-08-18.** Today a request is one scenario: one
`location`, one `industry` (`packages/core/src/templates/florida-business-for-sale.ts:419`
— both are single strings in `paramsSchema`), and the whole report is written about
that one. A buyer choosing between Hialeah and Coral Gables, or between laundromats
and car washes, has to buy two dossiers and compare them by hand — and the two are
not comparable: they were researched by different runs, with different evidence,
different shortlists and no shared yardstick.

**What to build:** one dossier that researches TWO scenarios and says how they
differ. **Maximum two** — that bound is the point of the item, not a simplification:
the research budget, the evidence store and the report all scale with it, and three
scenarios is a different product (a screener), not a bigger version of this one.

**What it touches** (verified by reading, not built):
- `paramsSchema` — a second scenario has to be expressible without breaking the
  single-scenario request, and `validateRequest` now rejects retired keys but still
  strips unknown ones (`packages/core/src/index.ts:231`).
- The DAG (`florida-business-for-sale.ts:65`+): the producers are per-scenario
  (deal-scout, market-analyst, …) and would run twice; the synthesizers
  (exec-summary, charts) are the ones that would gain the comparison. Whether that
  is two sub-DAGs plus a comparison wave, or one DAG whose agents take a scenario
  argument, is the design question.
- Evidence: the store is shared across agents (`engine/prompt.ts` dossier tiers), so
  scenario A's results are visible to scenario B's writer. That is wrong for a
  comparison and is exactly what the `fetched`/`touched` tiers already know how to
  separate.
- Cost: ~2× the research turns. That is a MODE and a credit price, not a free
  option — `modes` (`florida-business-for-sale.ts`, `credits`) and the per-job cost
  ceiling both need a number.
- Report: a comparison section (side-by-side figures, a recommendation between the
  two) plus per-scenario sections, and the PDF/viewer have to render both without
  reading as one report printed twice.

**Product decisions, unresolved:** whether the two scenarios vary ONE axis at a time
(two locations, same industry — the clean case) or any two full parameter sets; the
credit price; whether `essential` may be compared at all or comparison is
`comprehensive`-only.

**Not started.** No code exists for this.

---

## P-2 · No location given → RECOMMEND where in Florida to look — `open`

**Asked for by Javier, 2026-08-18.** `location` is not required: it defaults to
`'State of Florida, USA'` (`packages/core/src/templates/florida-business-for-sale.ts:407`,
verified by reading). So a buyer who skips it gets a state-wide dossier — the
analysts search all of Florida, the shortlist is whatever the market happened to
surface, and nothing in the report tells them WHERE the opportunity actually is.
The only thing that fires today is a soft pre-flight finding
(`no_narrowing_filter`, `florida-preflight.ts` rules, `severity: 'info'`) saying a
narrower area gives sharper matches — advice the buyer cannot act on, because they
do not know which area.

**What to build:** treat "no location" as its own supported case rather than as a
missing field. The dossier should come back with a RECOMMENDATION of where to
look — the two or three Florida markets that fit the buyer's industry, budget and
filters, with the evidence for why (listing density, price levels, demographics,
competition), and the shortlist ordered by it. Always inside Florida
(`basePrompt`: *"Stay within the State of Florida unless the criteria explicitly
say otherwise"*, `florida-business-for-sale.ts:954`).

**Design questions, open:**
- Is this a section that only appears when `location` is the default (a
  `where_to_look` section, derived or agent-written), or a first WAVE that picks
  the markets and hands them to the existing producers as their scope? The second
  is better research and changes the DAG; the first is additive and cheap.
- If it is a wave, its output narrows every later agent's search — which is close
  to the buyer having typed a location, and should probably be shown back to them
  in the report ("we focused on Hialeah, Kendall and Fort Myers, because…").
- Interaction with P-1: "compare two locations" and "recommend a location" are the
  same machinery seen from two ends.
- Interaction with the assist: the "in your own words" box can now FILL an empty
  location when the buyer's text names one (`fillable`, `florida-preflight.ts:150`).
  This item is the case where nobody named one anywhere.

**Not started.** No code exists for this.

---

## P-4 · The mode belongs in the right-hand card, where the price is — `open`

**Asked for by Javier, 2026-08-19**, with a screenshot of the current page. Today
the mode is section **02** of the form — two wide `modecard` buttons carrying the
label, the credit price and a one-line description
(`apps/fbizlab/src/pages/NewReport.tsx:842-855`) — while the right-hand sticky card
shows the mode as a read-only ROW (`:1001`) above `COST · 5 credits` and the
GENERATE button (`:1009-1030`). So the thing that sets the price is a screen away
from the price, and the card that adds up the order cannot change it.

**What to build:** move the mode SELECTION into the summary card, the way a checkout
lets you pick a plan or tick add-ons next to the running total — pick it where you
see what it costs. The reference Javier gave is a checkout's add-on/mode selector.

**What it touches** (read, not built):
- `NewReport.tsx` section 02 (`:842-864`) — the mode picker leaves it; the report
  LANGUAGE toggle currently lives in the same section and would be left alone in a
  renamed 02, or moved with it. That is a decision, not a detail: language does not
  change the price, so it may not belong next to the total.
- The summary card (`:994-1030`) — `nr-sumrows`' mode row becomes a control. It is
  the same `modes` array (`credits` per mode) that already feeds `cost` at `:359`.
- `nr-summary` / `nr-sumcard` / `modecards` / `modecard` CSS — the two wide cards do
  not fit a ~300px column; this needs a compact form (stacked rows with the price on
  the right, or a segmented control) that still shows each mode's price before the
  buyer commits, since that is the whole point of moving it.
- **The mobile path, which is where the real work is.** The summary card is
  `{!isMobile && (…)}` (`:993`): on a phone it does not render AT ALL, and the
  confirm dialog is what reviews everything. So moving the picker into that card
  DELETES the mode picker on mobile unless the mobile flow gets its own home for it
  — a step in the wizard, or a persistent bottom bar with the total. Javier's
  "responsive todo" is this.
- The confirm dialog and the pre-flight summary already state the mode; both read
  from the params, so neither changes.

**Product decisions, unresolved:** whether the language toggle travels with the mode
or stays in the form; what the mobile home for the picker is (wizard step vs sticky
bottom bar); whether the compact picker keeps the one-line description of each mode
or only its name and price.

**Not started.** No code exists for this.

---

## P-5 · Documentation the BUYER can read, inside the app — `open`

**Asked for by Javier, 2026-08-19.** A couple of pages, behind the login, that
explain the model: what each param actually does to the search, what comes out at
the end and how, and what the two tiers differ in. Today none of that is readable
by the person paying for it — the form's help texts are one line each and appear
only next to the field, and everything longer lives in `docs/`, which is written for
whoever is extending the code.

**What exists to build on** (verified by reading):
- The manifest already carries, per field and in FOUR languages, a `label`, a
  `help` line, a `placeholder` and suggestion chips
  (`florida-business-for-sale.ts:1059` for `paramsUi`, `:1109` for `i18n`), and the
  SPA already renders forms from it (`docs/model-ui.md`). A docs page that DERIVES
  from the manifest inherits every new param and every translation for free.
- The report's shape is equally declared: `sections`
  (`florida-business-for-sale.ts:504`) with a title and notes per section, `modes`
  with the credit price per tier, and `DIRECTIVE_FIELDS` with the closed
  vocabularies. "What comes out" is a rendering of `sections`, not new prose.
- `docs/models/florida-business-for-sale.md` covers much of the same ground for a
  developer, and is the warning as much as the head start: its params table still
  lists `keywords` as client input, which since `29f8593` is a hard error
  (`packages/core/src/index.ts:285`). A second hand-written copy of a moving thing
  drifts the same way — this is the defect the review rounds keep finding.

**What to build:** two or three pages, in the SPA, behind auth:
1. **The inputs** — every param, what it does to the research (not what it is),
   what happens when it is left empty, and which ones cost money to change. Derived
   from `paramsUi` + `i18n`, with a longer body per field kept next to the field's
   declaration so it moves with it.
2. **What you get** — the sections in the order they appear, what each is written
   from, how long it takes, and what a degraded section means when one is missing
   (the `sectionsNotice` copy the buyer already sees is the seam to explain).
3. **Essential vs comprehensive** — the two tiers side by side with their credit
   prices, read from `modes`.

**Product decisions, unresolved:**
- **Generated or written?** Deriving from the manifest is the anti-drift answer and
  the reason the manifest exists; prose that explains WHY a param matters is not in
  the manifest and would have to live somewhere new (a `docs` block per field in the
  template, or MDX per model with a test that pins it against the manifest's keys).
- **Behind the login or public?** Javier asked for internal, for authenticated
  users. The same pages are the strongest thing this product could show a stranger,
  so this is a real choice, not a default.
- **Which languages.** The app runs in four; a page that exists only in English
  inside a Spanish form is worse than a link. If the body prose is hand-written,
  four languages is the recurring cost.
- **A sample report.** The clearest possible answer to "what comes out" is one real
  dossier. It needs an anonymised fixture and a decision about hosting it.

**Not started.** No code exists for this.

---

## P-3 · Two ways to say what you want: the box, or the fields — not both at once — `done (16e7014 → 2bf0b97 → c0805a7 → 3397da8)`

**Asked for by Javier, 2026-08-19, looking at the deployed form.** Sections 04
("Your preferences", seven directive rows of chips) and 05 ("In your own words")
both sit open on the page, one under the other. They are two ways to fill the SAME
seven params — 05 exists only to fill 04 (`7a45269`) — so the form asks the buyer
to do the same job twice, and the second one is a wall of ~30 chips before they
know whether the product is any good.

**The shape (Javier's, and the one to build):** the box is the way in; the fields
are what it produced, and stay editable by hand afterwards.

1. Section 05 is primary; 04 starts collapsed behind "prefer to pick them
   yourself?" — visible from the first render, not only on error.
2. On validate, the accepted proposals land in the FORM's directive state, not
   only in the confirm dialog: 04 opens showing exactly what was filled, each field
   marked with the words that filled it (`proposals.quotes`, already carried).
3. The buyer edits any of them by hand from there. The precedence rule already
   supports this: `acceptProposals` skips a field the buyer set
   (`enrich.ts`, `if (current[f.key] !== undefined) continue`), so a later
   re-validation cannot clobber a hand-picked value.
4. The confirm dialog goes back to being a REVIEW (summary, issues, corrections)
   instead of the place where seven preferences are decided — which today is at the
   moment of spending credits, the worst moment to meet a new vocabulary.

**Constraints, verified in the code:**
- The assist is not always available: `PreflightOutcome.assist.state` is
  `off_disabled | off_no_credits | off_cooldown | off_attempts`, and there are two
  free attempts per draft. Prompt-first MUST fall back to the fields whenever the
  assist is off, or a buyer with no attempts left has no way to express a
  preference at all.
- Mobile is a wizard: 04 and 05 are separate steps (`stepOf(2)`, `stepOf(3)`,
  `WIZARD_STEPS = 4` in `NewReport.tsx`). Collapsing them changes the step count.
- The form is manifest-driven, so this is an SPA decision, not a Florida one —
  another model with directives gets the same behaviour for free.
- Whatever is not rendered must not be silently sent, and whatever the buyer typed
  must not be silently dropped: that is the R7-7 class of defect (input given,
  charged for, never used).

**Decided (Javier, 2026-08-19):** the box stays VISIBLE but collapsed, with the text
still in it. The dialog keeps listing the proposals with their per-field ticks —
ticking there is what writes them onto the form, so the two views are one state, not
two.

**Refined in `c0805a7` (option B of a frontend review).** Collapsing 04 left a bare
header with a 10px link — "a section that failed to load", in Javier's words. The
review found the real cause: the RESULT sat above its CAUSE (and, on a phone, a whole
wizard step before it), and the sentence explaining the whole flow was passed to
`SecHead`'s `right` slot, styled `nr-hint` — mono, 10px, uppercase, right-aligned.
Fine for three words; decoration for forty. So: the box is section 04, the
preferences are 05, the explanation is a `.nr-lead` paragraph, the empty state names
what will land there and offers a real button, a `n/7` counter shows there is
something inside without opening it, and the lead changes with the state (empty →
filled → assist off). Canvas of the three options considered:
https://claude.ai/code/artifact/4d732a3e-ab48-4d9e-ac29-9d66c0f97520

**Built in `16e7014`, finished in `3397da8`.** The stamp used to name `16e7014`
alone, which is the commit that collapses section 04 behind a link — the "never both
at once" that titles this entry is `3397da8` ("one section, two ways — the box or
the fields, never both"), with `2bf0b97` fixing the block that closed under the
buyer's cursor and `c0805a7` in between (round 8, R8-31). Two things the design
walked into, both found by building it
rather than by reading: the preview key had to stop including the directive block
(or every chip click would spend an assisted attempt re-approving a value we
proposed), and `correctedParams` had to be applied field by field (or accepting a
typo fix at the end would silently revert every edit made after validating).
