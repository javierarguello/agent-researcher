# Review round 9 — the round-8 fix batch (`4b61242..79fa632`)

You are one of eight reviewers, in your own git worktree of
/Users/javier/Documents/src.nosync/personal/agent-researcher. Four groups, two opposed lenses each. You review ONE
group with ONE lens (your task prompt says which). The other seven exist; do not widen into their groups.

## FIRST, before anything else

1. `git rev-parse HEAD` must print **the sha your task prompt names** — this brief's own commit, docs-only, sitting
   one above the batch you are reviewing. If it does not, `git fetch && git checkout <that sha>` in YOUR worktree.
   State in your report which sha you measured. **Do not "correct" yourself to `79fa632`**: the batch under review
   ends there, but this file does not exist at that commit. (The sha is in the prompt and not written here because
   a brief cannot name its own commit — the first attempt at this line was invalidated by the commit that added
   it, twice. Round 7's worktrees were parked at the commit BEFORE the batch and every reviewer had to notice
   alone; round 8's were correct.)
2. A fresh worktree has no `node_modules` and `vitest` is not on the PATH: run **`npm ci`** at the worktree root
   first (it is cached — measured at 4 seconds). Then
   `cd apps/worker && npx vitest run test/resolution.test.ts` — it must pass, or `@agent-researcher/core` is
   resolving to the MAIN checkout and every mutation you make will be invisible to your own test run.
3. `npm test` from your worktree root must be GREEN and total **1109** passing, 0 failed
   (708 core + 215 api + 22 worker + 158 fbizlab + 6 admin), 16 skipped in core. **That is the clean-worktree
   number and it is 6 fewer than the 1115 the commit messages quote**, because six red-team tests are gated on
   `out/*/trace.json`, which exists only in Javier's checkout. Measured for this brief, in a worktree at `79fa632`;
   `dc2edb4` adds no code. If you want the six back, symlink `out/` from the main checkout and say that you did.
   If your number differs from 1109, say so and say why before reporting anything else.
4. Your scratchpad is `<the path your task prompt gives you>` and it is YOURS. Two of round 8's reviewers wrote
   mutation scripts to the same shared path and overwrote each other. Do not write scratch files anywhere else.

## What shipped (8 commits) — `git log --format='%h %s%n%n%b' 4b61242..79fa632` is the list of CLAIMS you are checking

This batch is round 8's own P2 findings, fixed. The backlog entry for each — what it claimed, and the hash that
closed it — is `docs/plans/deep-review.md` § "Round 8"; the raw reports that produced them are in
`docs/plans/m-red-team-reports/round8/`. **So this round is reviewing the fixes for the round that reviewed the
previous round's fixes.** Round 8 found that three of round 7's fixes shipped a hole of their own, two of them in
the code written to close a hole. Assume the same of this batch until you have checked.

- `62b5e61` **section-status copy + coercion** (R8-17, R8-22). The per-section line existed in three copies and a
  wording fix landed in one, so fr/pt buyers read `la passe` / `a passagem` in the viewer and the PDF. All four
  languages were aligned in both tables, a shared fixture (`packages/core/test/fixtures/section-lines.ts`) now
  pins them from both suites, and the writer's status set is pinned to BOTH readers' `KNOWN_STATUSES`. The
  coercion of an unknown status to `lost` was NOT changed — the comment was rewritten to say what it costs.
- `8ff7312` **the evidence tiers** (R8-18, R8-19, R8-29). `urlsIn` walks the value instead of its JSON
  serialization; `referenced` is classified before `touched`; the density e2e fixture stopped excluding the
  overlap case (`nextLot` 20 → 5) and its printed measurement moved 36/48 → 44/48.
- `8901f60` **the fixture's search density** (R8-30). `RESULTS_PER_QUERY` 5 → 8 (production's). Two asserted pins
  and three published figures were re-measured; a new harness test pins the density itself.
- `8d2df52` **four tests that reported evidence they were not producing** (R8-23, R8-24, R8-25, R8-28). A config
  restore moved to `afterEach`; a pin renamed to what it asserts; a dead test deleted; the resumed-writer fixture
  rebuilt so both seeds bite.
- `0250063` **the link title and the Sources tooltip** (R8-34, R8-35). A prose link's `title` is dropped in the
  viewer; the PDF's link regex gained a title branch that matches and discards it; the tooltip clips by code point.
- `1ab2a86` **the validator, the quote gate, the Gemini bound** (R8-20, R8-21, R8-26). `validateTemplate` refuses
  all four loop-only fields; a directive's quote must be 8+ chars or 2+ words to pre-tick, and a basic's quote
  must name the value; `maxLength` is no longer forwarded to Gemini's decoder.
- `4ba3bd4` **the pre-flight summary and the admin row** (R8-27, R8-36, R8-37). `renderPlan` appends the set
  directives; `kind` rides `JobSummary.agents[]` and reaches the Agents table; the shrink warning is timestamped
  and `snapshot()` copies its arrays.
- `79fa632` **docs** (R8-31, R8-33) — six documents, plus the round-8 close and the record corrections.

## Standing lessons — the last eight rounds keep finding these three; look for them FIRST

1. **A guard that never reaches production is not a guard.** Check the PRODUCTION caller of every fix, not the unit.
2. **Assert the content, not the shape.** A test title or comment claiming more than the assertion below it; a test
   whose fixture makes the bound unreachable; a test that reads the same constant the source reads. Flip it,
   mutate one line, and see whether it really goes red for the stated reason.
3. **A rename is a migration.** `report.json`, `checkpoint.json` (a HELD job keeps one for a human), `trace.json`,
   the manifest a deployed SPA has cached, `localStorage` drafts, params of jobs already written. **This batch
   added one persisted field** — `JobSummary.agents[].kind` — and changed what two others CONTAIN:
   `Checkpoint.warnings` entries are now timestamped, and the pre-flight summary string gained a clause. Any
   reader that assumes the new shape without coercing the old is a P0 here, and so is any WRITER that makes an old
   reader show something false.

## Specific to this batch — four things worth attacking, because they are decisions rather than repairs

- **`maxLength` is no longer forwarded to Gemini** (`1ab2a86`). The argument is written at the forward site: a
  constrained decoder satisfies an upper bound by stopping at it, all five bounds are buyer-visible chart copy, and
  a repair round is a cost we can see while a truncated caption is not. Is the argument right? Is the repair-round
  cost measurable from the mock tier? Does Zod actually still enforce every one of the five?
- **A prose link's `title` is DROPPED, not clipped** (`0250063`). Does an honest report lose anything? Is there a
  second path (the PDF, the email, the admin preview) where a title still reaches a reader?
- **The directive clause is appended in `renderPlan`, not in `describePlan`** (`4ba3bd4`). Every template now gets
  it whether or not it wants it. What does that do to a template with many directives, to the email that carries
  the summary, or to the "identical params → identical sentence" property?
- **The fixture's search density moved 5 → 8** (`8901f60`). Several published measurements moved WITH it, on
  purpose. A figure that disagrees with an older commit message is not automatically a defect — check which side
  was measured. But check that the re-measured ones are right, and that nothing else in the suite silently
  depended on 5.

## What counts as a finding

Something that changes what a buyer receives, what an admin sees as true, what we store, or what we spend — or a
claim in a commit message, a doc, or a test that is not true. `file:line`, the exact input, the observed output,
and **reproduced** (you ran it) vs **reasoned**. Refute yourself first and say what you tried. Rank by severity:
P0 (buyer/money/data wrong in production) · P1 · P2 hygiene.

**Verifiers also audit their group's commit MESSAGES.** Every one of the 8 states mutation counts ("N red"),
measured figures, and in two cases "this measured 0 red" with a reason for keeping the line. Re-run the mutations
you can and check the numbers. Round 8 found 14 of 22 messages in the previous batch stating a wrong suite total,
and three wrong mutation counts. A number nobody re-measures is how this repo ships a false claim.

## Rules

- Work in YOUR worktree. Mock tier only. `TEST_LLM=ollama` (qwen2.5:3b at localhost:11434, may be up) is allowed
  for ONE confirming run where the model's behaviour IS the mechanism. **Never a paid model.**
- You may write tests / scratch scripts to reproduce; report the code inline (path + the assertion) so it can be
  ported. Do NOT modify `src/` except to run a mutation you then revert — and verify `git diff` is clean before you
  report. Do NOT commit. Do NOT push.
- When you mutate with `perl`/`sed`/`python`, **grep the file afterwards** to confirm the substitution applied. A
  pattern that silently fails to match reads exactly like a fix nothing pins; it cost round 8 two wrong readings.
- `npm test` runs the workspaces with `&&`, so a red core suite means the api, worker, fbizlab and admin suites
  **never run** and the "passed" total collapses to ~690. **Count the RED, never the passed.**
- `apps/fbizlab`'s fixtures render labels that are not associated with their inputs, so `getByLabelText` fails on
  the params fields. Reach them with `getByText('<label>').closest('.field')!.querySelector('input')`.
- Time-box: depth on 3-6 things beats breadth. Every finding must survive your own attempt to refute it.

## Report

Write to `docs/plans/m-red-team-reports/round9/<your-id>.md` in your worktree AND return the same text. Format:

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
