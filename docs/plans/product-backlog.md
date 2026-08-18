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
