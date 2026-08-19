# Review round 8 — the 2026-08-19 batch (`3d6aad8..4b61242`)

You are one of eight reviewers, in your own git worktree of
/Users/javier/Documents/src.nosync/personal/agent-researcher. Four groups, two opposed lenses each. You review ONE
group with ONE lens (your task prompt says which). The other seven exist; do not widen into their groups.

## FIRST, before anything else

1. `git rev-parse HEAD` must print `4b612426ebb97f9dd38f1561c047413ffd07390c`. If it does not, `git fetch && git
   checkout 4b61242` in YOUR worktree. Round 7's worktrees were parked at the commit BEFORE the batch they were
   reviewing and every reviewer had to notice that alone; one lost part of its run to it. State in your report
   which sha you measured.
2. `npm ci` if `node_modules` resolves elsewhere, then `cd packages/core && npx vitest run test/resolution.test.ts`
   (or `apps/worker/test/resolution.test.ts`) — it must pass, or your measurements are of another checkout.
3. `npm test` from the root must be GREEN and total **1071** passing. If your number differs, say so and say why
   before you report anything else: a clean clone counts ~16 fewer (six red-team tests are gated on `out/*/trace.json`,
   which only exists in Javier's checkout).

## What shipped (20 code commits) — `git log --format='%h %s%n%n%b' 3d6aad8..4b61242` is the list of CLAIMS you are checking

Round 7's own findings, fixed today. The full backlog with what each commit closed is `docs/plans/deep-review.md`
§ "Round 7"; the raw reports that produced them are in `docs/plans/m-red-team-reports/round7/`.

- **Engine / loop**: `93b132e` (a turn that buys nothing counts, whatever free branch), `90d6fdf` (a gathered
  agent's own pages survive the checkpoint or it loses `gathered`; the turn counter is seeded from the resume),
  `a84878d` (`touchedByAgent`: a resumed writer keeps the results its loop saw), `c9065e3` (`reconstructed`),
  `6780c94` (`warnings` ride the checkpoint; `turnsUsed`/`gatherStop` reach the admin).
- **Dossier / prompts**: `6fde120` (the `referenced` reserve), `7772772` (string-aware `cutJson`, tool-arg strip),
  `d1dab19` (`AgentKind`, `focus` refused on an agent with no loop, the chart rules folded into the section
  guidance), `b72de29` (Gemini string bounds, `json:parse`).
- **Buyer / SPA**: `38bfc53` (per-field proposals with verified quotes, `fillable` basics), `929e8dd` (the preview
  key includes the notes; a stale bundle is told to reload), `f33ecce` (`held` as a lifecycle phase,
  `PROGRESS_KINDS` + the cross-package pin), `16e7014`/`c0805a7`/`3397da8`/`2bf0b97` (the form: one section, two
  ways), `0497861` (the draft carries the notes; the keyword instruction), `2c346de` (`cut_off`, the `cached`
  copy, the live line's language), `1ce4893` (prose links, the Sources tooltip).
- **API / money / CI**: `b72de29` (the summary redaction), `929e8dd` (`validateRequest` 400s on retired params),
  `60c92a0` (the fbizlab suite stops depending on a gitignored file; a misconfigured build stops eating the
  buyer's error), `90a355f` (two production guards pinned; `LLM_GATHER_*` wired into the deploy).

## Standing lessons — the last seven rounds keep finding these three; look for them FIRST

1. **A guard that never reaches production is not a guard.** Check the PRODUCTION caller of every fix, not the unit.
2. **Assert the content, not the shape.** A test title or comment claiming more than the assertion below it; a test
   whose fixture makes the bound unreachable (round 7 found one running 48 items against `max = 48`); a test that
   reads the same constant the source reads. Flip it, mutate one line, and see whether it really goes red for the
   stated reason.
3. **A rename is a migration.** `report.json`, `checkpoint.json` (a HELD job keeps one for a human), the `progress`
   field, `trace.json`, the manifest a deployed SPA has cached, `localStorage` drafts, params of jobs already
   written. **This batch added five persisted fields** — `Checkpoint.warnings`, `.fetchedByAgent`,
   `.touchedByAgent`, `AgentTrace.kind`, `JobSummary.agents[].turnsUsed/gatherStop` — and two new enum values
   (`SectionStatus.reconstructed`, `ProgressKind.cut_off`). Any reader that assumes the new shape without coercing
   the old is a P0 here, and so is any WRITER that makes an old reader show something false.

## What counts as a finding

Something that changes what a buyer receives, what an admin sees as true, what we store, or what we spend — or a
claim in a commit message, a doc, or a test that is not true. `file:line`, the exact input, the observed output,
and **reproduced** (you ran it) vs **reasoned**. Refute yourself first and say what you tried. Rank by severity:
P0 (buyer/money/data wrong in production) · P1 · P2 hygiene.

**Verifiers also audit their group's commit MESSAGES.** Every one of the 20 states mutation counts ("N red"),
measured figures, and in several cases "this measured 0 red at first". Re-run the mutations you can and check the
numbers. Round 7 caught four wrong counts in the previous batch's messages, and two more written today were wrong
(recorded in `deep-review.md`). A number nobody re-measures is how this repo ships a false claim.

## Rules

- Work in YOUR worktree. Mock tier only. `TEST_LLM=ollama` (qwen2.5:3b at localhost:11434, may be up) is allowed
  for ONE confirming run where the model's behaviour IS the mechanism. Never a paid model.
- You may write tests / scratch scripts to reproduce; report the code inline (path + the assertion) so it can be
  ported. Do NOT modify `src/` except to run a mutation you then revert — and verify `git diff` is clean before you
  report. Do NOT commit.
- Time-box: depth on 3-6 things beats breadth. Every finding must survive your own attempt to refute it.

## Report

Write to `docs/plans/m-red-team-reports/round8/<your-id>.md` in your worktree AND return the same text. Format:

```
# <your-id> — <group> / <lens>
## Verdict (one paragraph: does the batch's claim for this group hold in production?)
## Findings (most severe first)
### F1 · <one-line damage statement> — P0|P1|P2
- where: file:line
- input / observed:
- status: reproduced (how) | reasoned
- refutation attempted:
- fix sketch: (and what an honest run loses if it is done naively)
## Claims checked and TRUE (so nobody re-checks)
## Commit-message audit (verifiers only): every count you re-ran, claimed vs observed
```
