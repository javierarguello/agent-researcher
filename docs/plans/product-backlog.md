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
