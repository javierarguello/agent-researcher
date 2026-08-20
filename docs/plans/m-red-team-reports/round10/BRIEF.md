# Review round 10 — the round-9 fix batch, plus what came after it (`79fa632..HEAD`)

You are one of eight reviewers, in your own git worktree of
/Users/javier/Documents/src.nosync/personal/agent-researcher. Four groups, two opposed lenses each. You review ONE
group with ONE lens (your task prompt says which). The other seven exist; do not widen into their groups.

## FIRST, before anything else

1. `git rev-parse HEAD` must print **the sha your task prompt names** — this brief's own commit, docs-only, sitting
   one above the batch you are reviewing. If it does not, `git checkout <that sha>` in YOUR worktree. State in your
   report which sha you measured. **Do not "correct" yourself to the last commit named below**: the batch under
   review ends there, but this file does not exist at that commit. (The sha is in your prompt and not written here
   because a brief cannot name its own commit — two earlier rounds invalidated that line by committing it.)
2. A fresh worktree has no `node_modules` and `vitest` is not on the PATH: run **`npm ci`** at the worktree root
   first (cached, ~30s). Then `cd apps/worker && npx vitest run test/resolution.test.ts` — it must pass, or
   `@agent-researcher/core` is resolving to the MAIN checkout and every mutation you make will be invisible to your
   own test run.
3. `npm test` from your worktree root must be GREEN and total **1162** passing, 0 failed
   (751 core + 216 api + 22 worker + 166 fbizlab + 7 admin), 16 skipped in core and 6 in api. **That is the
   clean-worktree number.** The main checkout counts **1168**, because six red-team tests gated on `out/*/trace.json`
   run only where that file exists — and its core suite also reports a different TOTAL (769 vs 767 collected), so
   the two numbers are not derivable from each other by arithmetic. Measured for this brief in a worktree at
   `ff6bc5c`; this brief's own commit adds no code. If your number differs from 1162, say so and say why before
   reporting anything else.
4. Your scratchpad is `<the path your task prompt gives you>` and it is YOURS. Round 8 had two reviewers overwrite
   each other's mutation scripts on a shared path. Do not write scratch files anywhere else.

## What shipped (18 commits) — `git log --format='%h %s%n%n%b' 79fa632..HEAD` is the list of CLAIMS you are checking

Most of this batch is round 9's own findings, fixed. The backlog entry for each — what it claimed, and the hash
that closed it — is `docs/plans/deep-review.md` § "Round 9"; the raw reports that produced them are in
`docs/plans/m-red-team-reports/round9/`. **So this round is again reviewing the fixes for the round that reviewed
the previous round's fixes**, and round 9 found that three of round 8's fixes shipped a hole of their own, one of
them a security regression in the code written to close a security hole. Assume the same of this batch until you
have checked.

Two parts of the batch are NOT round-9 repairs and nobody has reviewed them at all:
`29f8593` (`keywords` leaves the client surface) and the three commits of 2026-08-19/20 that close §K
(`63fd892`, `1644897`, `ff6bc5c`). Weight them accordingly.

- `29f8593` **`keywords` is an internal param.** Off the published manifest, refused by `validateRequest` with a
  message rather than stripped, no longer proposed by the assist. Still in `paramsSchema`, still rendered by
  `buildBrief` for a server-side caller.
- `0ff22ef` **the PDF link rule** (R9-2, R9-3). A titled image had become a live anchor at the attacker's URL; a
  malformed title had deleted the rest of the paragraph. One shared title definition, used by both rules.
- `c1397a9` **the confirm dialog** (R9-1). It stated a preference the request would not carry, and stayed silent
  about one it would. Fixed client-side, rendering the clause from the LIVE form rather than re-previewing.
- `d77ffb3` **the quote gates** (R9-4, R9-5, R9-13). The two-word branch that let «de la» pre-tick a directive is
  gone; the basics anchor gained a fallback so `St. Pete` no longer VANISHES; `isEvidence` now applies to the
  higher-bar field too.
- `5a7b844` **the density e2e** (R9-6). The fixture passed with `rankEvidence` deleted; it now needs both the
  overlap and a shortlist that store order does not hand over.
- `dcfeedf` **the degraded-section copy** (R9-7). "Everything else was researched and written as usual" is now
  conditioned, in four languages, in both copies.
- `2f5ab43` **five test claims of the previous round's** (R9-8 … R9-12): the reserve arithmetic, three `it()`
  titles carrying moved figures, a title pinned at the old density, an assertion invariant under the mutation it
  was evidence for, and a `urlsIn` test that pinned a backslash INTO a URL.
- `b18ea51` **the bounds the model is told about** (R9-14 … R9-16). The five `maxLength`s are in `.describe()`;
  two docs stopped saying `researchBudget`/`sites` are "ignored for synthesizers" when they are a throw.
- `99a1a48` **the summary, the snapshot, the admin cell** (R9-17 … R9-20). `renderPlan`'s generic fall-through no
  longer prints `[object Object]`; `snapshot()` copies the rest of its arrays; a producer and a synthesizer no
  longer render the identical badge.
- `7a29a43` **the buyer's surfaces** (R9-21 … R9-23). A fourth section status can no longer ship with no advisory
  line; the Sources ROW is clipped like its tooltip; `node="[object Object]"` is off every prose anchor.
- `63fd892` **the pre-screen's evasion half** (§K). A rebuilt census (95 attacks / 73 ordinary phrasings,
  committed and runnable at `docs/plans/m-red-team-reports/k-census-2026-08-19/`) measured **70 of 95 attacks
  passing**; nine of those were evasion and are closed — the invisible-character class, a separator inside one word
  (`ig-nore`), digits standing in for letters (`ign0re`) — leaving **61 of 95**, with the ordinary phrasings
  refused unchanged at **2 of 73**.
- `449ab03`, `f74b3d9`, `ec66323`, `f080011`, `1644897`, `ff6bc5c`, `a37d5f5` **the record**: round 9's findings and
  stamps, four documents corrected, the handoff rewritten, the P-5 backlog item, and §K decided (option 1: the
  pre-screen owns normalization and evasion, the classifier owns semantics).

## Standing lessons — the last nine rounds keep finding these three; look for them FIRST

1. **A guard that never reaches production is not a guard.** Check the PRODUCTION caller of every fix, not the unit.
2. **Assert the content, not the shape.** A test title or comment claiming more than the assertion below it; a
   fixture that makes the bound unreachable; a test that reads the same constant the source reads. Flip it, mutate
   one line, and see whether it goes red for the stated reason.
3. **A rename is a migration — and so is a REMOVAL.** This batch takes a param off the client surface. Every tab
   open at that deploy has a form built from the old manifest, a draft in `localStorage`, and an assist that
   proposed keywords. Jobs already stored carry the field. Follow all of those.

**And the rule round 9 earned, which this batch is the first to be graded on:** every false claim it found was a
TRUE measurement written as a universal — "nothing gets worse", "no budget reaches it", "a template cannot forget",
"copies its arrays". Hunt for that shape specifically. A sentence in this batch that says "never", "every",
"cannot" or "only" is where the next finding is.

## Specific to this batch — six things worth attacking, because they are decisions rather than repairs

- **`keywords` is REFUSED, not stripped** (`29f8593`). The message says a silent strip is worse. Is the refusal
  reachable by a buyer who did nothing wrong — a cached SPA bundle, a saved draft, a retry of a stored job, an
  admin re-run? What exactly do they see, and can they recover without losing what they typed?
- **A normalizer that JOINS text can only create false positives** (`63fd892`). `deobfuscate` closes intra-word
  separators and folds digits, and the third form is tested against the full injection list. Find an innocent
  string — in en/es/fr/pt, in an industry this product serves — that becomes a trigger once joined or folded. The
  corpus pins `jail-break themed escape room`; it does not pin yours.
- **The same change adds up to three more regex passes over up to 2000 characters** with gaps written as
  `[^\p{L}\p{N}]*`. Is there an input for which this is slow — catastrophic backtracking, or just N× — and does the
  request path have anything that bounds it? `preScreen` runs before any billing.
- **§K's load-bearing claim** (`ff6bc5c`, and the § K section): *"the buyer's free text reaches a model only when
  `assist === 'on'`, which is exactly when the classifier runs too, so the pre-screen is never the sole layer on a
  path where a miss reaches a prompt."* That is the sentence the whole decision rests on, and it is the exact shape
  the previous round punished. Find the path that breaks it, or say it holds and name where you looked.
- **The census is a measurement, so it can be wrong** (`k-census-2026-08-19/`). Re-run it. Then read the corpus: is
  every "attack" actually an attack, is every "legit" string actually something a buyer would type, and does the
  61 / 95 headline survive a sceptical reading of what is in the two files?
- **R9-1 was fixed client-side** (`c1397a9`) — the confirm dialog renders from the live form rather than
  re-previewing, because re-previewing costs an assisted-review attempt per chip click. Does the dialog now agree
  with the REQUEST on every path: the mobile wizard, an edit made after a pre-flight, an accepted correction, the
  assist being off?

## What counts as a finding

Something that changes what a buyer receives, what an admin sees as true, what we store, or what we spend — or a
claim in a commit message, a doc, or a test that is not true. `file:line`, the exact input, the observed output,
and **reproduced** (you ran it) vs **reasoned**. Refute yourself first and say what you tried. Rank by severity:
P0 (buyer/money/data wrong in production) · P1 · P2 hygiene.

**Verifiers also audit their group's commit MESSAGES.** Every fix commit states mutation counts ("N red") and
measured figures. Re-run the ones you can and check the numbers. Round 8 found 14 of 22 messages stating a wrong
suite total; round 9 found all 26 mutation counts correct and nine PROSE claims false. A number nobody re-measures
is how this repo ships a false claim — and so is a number that is right in a sentence that is not.

## Rules

- Work in YOUR worktree. Mock tier only. `TEST_LLM=ollama` (qwen2.5:3b at localhost:11434, may be up) is allowed
  for ONE confirming run where the model's behaviour IS the mechanism. **Never a paid model.**
- You may write tests / scratch scripts to reproduce; report the code inline (path + the assertion) so it can be
  ported. Do NOT modify `src/` except to run a mutation you then revert — and verify `git diff` is clean before you
  report. Do NOT commit. Do NOT push.
- When you mutate with `perl`/`sed`/`python`, **grep the file afterwards** to confirm the substitution applied. A
  pattern that silently fails to match reads exactly like a fix nothing pins; it cost round 8 two wrong readings.
- Never `git checkout` a file to undo a mutation while other uncommitted work of yours lives in it. Copy it aside
  first.
- `npm test` runs the workspaces with `&&`, so a red core suite means the api, worker, fbizlab and admin suites
  **never run** and the "passed" total collapses. **Count the RED, never the passed.**
- `apps/fbizlab`'s fixtures render labels that are not associated with their inputs, so `getByLabelText` fails on
  the params fields. Reach them with `getByText('<label>').closest('.field')!.querySelector('input')`.
- Time-box: depth on 3-6 things beats breadth. Every finding must survive your own attempt to refute it.

## Report

Write to `docs/plans/m-red-team-reports/round10/<your-id>.md` in your worktree AND return the same text. Format:

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

## The four groups

- **G1 · the engine's gates and the tests that stand behind them** — `d77ffb3`, `5a7b844`, `2f5ab43`, `b18ea51`.
  The quote rules (a directive's, a basic's), the evidence tiers and their e2e fixture, the reserve arithmetic, and
  the five bounds the model is now told about.
- **G2 · what the buyer reads** — `c1397a9`, `dcfeedf`, `7a29a43`, `0ff22ef`. The confirm dialog before payment,
  the degraded-section copy in four languages, the section-status advisory, the Sources row, and the PDF's link and
  image rules.
- **G3 · the moderation layer** — `29f8593`, `63fd892`, and §K's decision in `ff6bc5c`. The removal of a client
  param, the pre-screen's third screening form, the census that justifies it, and every claim about which layer
  runs on which path.
- **G4 · the summary, the checkpoint, the admin surfaces, and the record** — `99a1a48` plus every docs commit
  (`449ab03`, `f74b3d9`, `ec66323`, `f080011`, `1644897`, `ff6bc5c`). `renderPlan`'s generic path, `snapshot()`,
  the Agents table, and whether the six documents now say what the code does.
