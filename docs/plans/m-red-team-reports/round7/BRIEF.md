# Review round 7 — the 2026-08-17 batch (`d1ac4dd..a11bafe`)

You are one of eight reviewers, in your own git worktree of
/Users/javier/Documents/src.nosync/personal/agent-researcher. Four groups, two opposed lenses each. You review ONE
group with ONE lens (your task prompt says which). The other seven exist; do not widen into their groups.

## What shipped (17 commits) — read `git log --format='%h %s%n%n%b' d1ac4dd..a11bafe` for the full messages; they
are the CLAIMS you are checking
- Red-team harness + evidence: `5391cbd`, `d6ecba6` (tests only).
- P1 fixes: C1 `73a4e79` (img beacon; dead admin viewer deleted), C5 `245811f` (PDF mdInline escape/lists),
  chart-refiner `a68d656`, B2 `f013cfe` (loop: plan breaker, forceTools, stalled→budget, gatherStop, plan-note
  coalescing, same-URL cached cap, plan stubbing), B1 `1fa5d31` (rankEvidence own-first, touched/fetched, urlsIn),
  C3 `9850bdf` (progress kind/detail; API hands buyers no `message`; SPA localizes), D1 `6264887` (checkpoint
  gatheredAgentIds + writeFailures signature + finalize-in-place + Gemini min/max forwarding).
- P2 batch: `49e71aa` (enricher block fenced + shrink note; cutJson; handoff by code point; marker strip on model
  turns; "no tables"), `f74f7b0` (safeHref/proseUrl/sourceLabel in viewer + PDF; email escapes), `72d2777`
  (onTurn; sampler honours maxLength).
- Refactor: `7a45269` — instructionsField REMOVED (engine, manifest, PDF, worker, SPA); Florida loses
  `instructions` + `preferredSources`; `/research/preflight` gains `freeText` → `proposeFromText`/`acceptProposals`
  → `proposals`/`proposedParams`; SPA "In your own words" box + confirm-dialog proposals.
- Docs: `2a36928`, `d16ac10`, `a11bafe`. Backlog: docs/plans/deep-review.md § "M step 2"; runbook docs/plans/m-red-team.md.

## Standing lessons of this repo — the last six rounds kept finding the same three; look for them FIRST
1. **A guard that never reaches production is not a guard.** Check the PRODUCTION caller of every fix, not the unit.
   (Round 5: three of four severe findings were fixes that never reached a screen.)
2. **Assert the content, not the shape.** A test title or comment claiming more than the assertion below it. A test
   that reads the same constant the source reads (detects deletion only). A test whose scenario is unreachable.
   Flip `it.fails`, mutate one line, and see whether the named test really goes red for the stated reason.
3. **A rename is a migration.** Persisted shapes outlive a deploy: `report.json`, `checkpoint.json` (a HELD job keeps
   it for a human), `progress` on the job document, `trace.json`, the manifest a deployed SPA has cached, params of
   jobs already written (`instructions`, `preferredSources` still exist on old jobs). Any reader that assumes the new
   shape without coercing the old is a P0 here.

## What counts as a finding
Something that changes what a buyer receives, what an admin sees as true, what we store, or what we spend — or a
claim in a commit message / doc / test that is not true. `file:line`, the exact input, the observed output, and
**reproduced** (you ran it) vs **reasoned**. Refute yourself first. Rank by severity: P0 (buyer/money/data wrong in
production) · P1 · P2 hygiene.

## Rules
- Work in YOUR worktree. First: `npm ci` there if node_modules resolves elsewhere, then run
  `cd packages/core && npx vitest run test/resolution.test.ts` — it must pass or your measurements are of the
  wrong checkout (round 4 lost part of a round to this). State that you ran it.
- Mock tier. `TEST_LLM=ollama` (local, qwen2.5:3b at localhost:11434, may be up) is allowed for ONE confirming run
  where the model's behaviour is the mechanism. Never a paid model.
- You may write tests / scratch scripts in your worktree to reproduce; report the code inline (paths + the
  assertion) so it can be ported. Do NOT modify src/ except to run a mutation you then revert. Do NOT commit.
- Time-box: depth on 3–6 things beats breadth. Every finding must survive your own attempt to refute it.

## Report
Write to /private/tmp/claude-501/-Users-javier-Documents-src-nosync-personal-agent-researcher/f5dedb44-1290-441c-b6ae-6bf6564fc5fe/scratchpad/m-review7/<your-id>.md
AND return the same text. Format:
# <your-id> — <group> / <lens>
## Verdict (one paragraph: does the batch's claim for this group hold in production?)
## Findings (most severe first)
### F1 · <one-line damage statement> — P0|P1|P2
- where: file:line (in the reviewed commit)
- input / observed:
- status: reproduced (how) | reasoned
- refutation attempted:
- fix sketch (≤ 2 lines) + what an honest run would lose if fixed naively
## Claims checked and TRUE (so nobody re-checks) — cite the commit claim and how you verified
## Tests: which cited tests assert content, which are shape/tautology, mutations you ran and their result
