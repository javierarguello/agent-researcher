# G4-verify — API / admin / money / deploy + the DOCS and the COMMIT MESSAGES / VERIFIER

**Checkout measured:** `4b612426ebb97f9dd38f1561c047413ffd07390c` (`git rev-parse HEAD` printed it; no reset needed).
`apps/worker/test/resolution.test.ts` passes (the core one does not exist — the brief's "or").

**Baseline, two ways.** My worktree with nothing but `node_modules` symlinked: **1065**, not 1071. The gap
is exactly **6**, not "~16": the six trace-gated red-team tests (`refute-b1`, `refute-B2`, one `d-legit`
case, gated on `out/*/trace.json`). Symlinking `out/` and copying `apps/fbizlab/.env.local` into a scratch
worktree at `4b61242` reproduces **1071 exactly**, so every number below is a *main-checkout-equivalent*
measurement of a real `npm test`, calibrated against the number the batch claims. I say which for each.

Also: the brief says "20 code commits"; `3d6aad8..4b61242` contains **22** non-docs commits that state
counts (the brief's own list omits `b3e3f8e` and `2bf0b97`).

## Verdict

The **mechanisms** of this group hold. Every one of the 19 mutations I re-ran across `929e8dd`, `b72de29`,
`6780c94`, `60c92a0` and `90a355f` goes red, for the stated reason, in the stated place; `90a355f`'s three
"(0 before this commit)" claims are true to the digit (I re-ran all three at `1ce4893` and got 0 red); the
retired-param 400, the non-admin summary redaction, the `warnings`/`turnsUsed`/`gatherStop` path to the
admin, the fbizlab env fix, and `local-llm.md`'s rewritten injection curl all do exactly what they say —
I reproduced the curl's 422 and the old curl's 400 through the API. The **arithmetic** does not hold. Of
the 22 commits that state a suite total, **14 state a wrong one**, and 8 state a wrong `+N tests`. Two were
corrected in `2c346de`; those two corrections are right, but `2c346de`'s own "before" (1045) contradicts the
correction it publishes on the same screen (1046, which is what I measure), and the drift **restarts after
it** (`b72de29` 1063 vs 1062, `d1dab19` 1066 vs 1065). The batch fixed the two counts a reviewer had found
and did not re-measure the other twelve. On top of that the "a clean clone counts N fewer" constant — the
number every one of these measurements is reconciled against — is written **three different ways in one
batch** (12, "the same", ~16) and none of them is the measured 6; round 8's own BRIEF repeats "~16".

## Findings (most severe first)

### F1 · Fourteen of the batch's 22 suite totals are wrong, and the drift restarts after the commit that corrected two of them — P1
- where: commit messages `3d6aad8..4b61242`; the correction paragraph is in `2c346de`'s body and
  `docs/plans/deep-review.md:1346-1352`.
- input / observed: full table in "Commit-message audit" below. Every "after" I measured with a scratch
  worktree at that sha with `out/` symlinked and `apps/fbizlab/.env.local` copied (calibrated: at `4b61242`
  this reproduces 1071, at `3d6aad8` it reproduces 974 — the two numbers the batch itself asserts). Wrong
  "after": `6fde120` (claims 991, is 990), `6780c94` (994/993), `929e8dd` (1008/1007), `b3e3f8e` (1010/1009),
  `38bfc53` (1023/1022), `60c92a0` (1025/1024), `16e7014` (1030/1029), `2bf0b97` (1031/1030), `c0805a7`
  (1036/1034), `3397da8` (1037/1035), `1ce4893` (1044/1043 — corrected), `90a355f` (1049/1046 — corrected),
  `b72de29` (1063/1062), `d1dab19` (1066/1065). Broken chain links (a commit's "before" ≠ the previous
  commit's "after" as claimed): `f33ecce` says 994 where `6780c94` claimed 994 but measures 993; `2c346de`
  says 1045 where the same message says `90a355f` really measured 1046.
- status: **reproduced**. 22 full `npm test` runs, one per commit, plus a second independent check: net
  `it(`/`test(` additions per commit (`git show <sha> -- '*test*'`) agree with my measured delta for every
  commit (e.g. `b72de29` net +1, `90a355f` net +3, `f33ecce` net +7, `c0805a7` net +4).
- refutation attempted: (a) that my environment differs — refuted, it reproduces both 974 and 1071 exactly;
  (b) that a flaky test moves the total — refuted, the measured chain is strictly monotone and every step
  equals the `it(`-count delta; (c) that "after" means "at the time, with a dirty tree" — the messages say
  "MEASURED, full `npm test`" and `2c346de` says "main checkout".
- fix sketch: record the corrections in `deep-review.md` as `e3e8e3b` did for two of them (history is on
  main). The mechanical fix is to take the total from the command, not from `previous + estimate`: the
  `+N tests` line and the total must be produced by the same run. Honest cost: one more full run per
  commit (~2 min).

### F2 · "A clean clone counts ~16 fewer" is false, has been since `60c92a0` (same batch, same morning), and round 8's BRIEF repeats it — P1
- where: `2c346de`'s message; `docs/plans/deep-review.md:1348-1350`; `docs/plans/m-red-team-reports/round8/BRIEF.md`
  ("a clean clone counts ~16 fewer", and "a worktree counts ~16 fewer than the main checkout").
  Also `c9065e3`: "a clean clone counts 12 fewer". Also `60c92a0`: "a clean clone now counts the same".
- input / observed: measured, at `4b61242`, clean worktree **1065** vs main-equivalent **1071** → **6**.
  At `3397da8` (after `60c92a0`): 1029 vs 1035 → 6. At `3d6aad8` (before `60c92a0`): clean shows **961**
  because the fbizlab suite goes `5 failed | 103 passed` and `npm test`'s `&&` then never runs the admin
  suite at all — 974 − 6 (gated) − 5 (red) − 2 (admin unrun) = 961. So "~16" was an accurate description of
  the *pre-`60c92a0`* world (6+5+4 = 15 at that point in the batch) and was written **three commits after
  `60c92a0` removed 9 of it**. "12" and "the same" are each wrong too. The one figure that is right is
  `deep-review.md`'s step 2: "a clean clone shows 968, not 974" — 974 − 6.
- status: **reproduced** (four measurements: clean and main-equivalent at `3d6aad8`, `3397da8`, `1ce4893`,
  `4b61242`).
- refutation attempted: that the six gated tests vary by commit — they do not; the core suite goes
  `12 skipped` with traces and `16 skipped` without, at every commit in the batch, and the passing delta is
  6 at every one.
- fix sketch: state it once, as a measured fact with its cause, in `deep-review.md`, and stop restating it
  in commit messages. What an honest run loses if done naively: nothing — but a reviewer this round who
  trusts "~16" and measures 1065 will "confirm" a number that is 5 too low and pass wrong arithmetic
  downstream.

### F3 · `929e8dd`'s first mutation count is wrong: "preview key ignores the notes again — 2 red" is 3 red — P2
- where: `929e8dd` message; `apps/fbizlab/src/pages/NewReport.tsx:533`.
- input / observed: `const paramsKey = JSON.stringify([keyParams, previewText])` → `JSON.stringify(keyParams)`.
  At **HEAD**: 3 red — "notes typed AFTER a preview are still sent…", "notes rewritten after the preview are
  validated again…", and "a second preview with nothing to say submits WITHOUT the first one's proposals".
  Re-run at **`929e8dd` itself** (the equivalent line there is `JSON.stringify([cleanParams(), previewText])`
  → `JSON.stringify(cleanParams())`): also **3 red**, the same three names.
- status: **reproduced** (both at HEAD and at the commit that made the claim, so it is not later drift).
- refutation attempted: that the third red is a later test — no, all three exist at `929e8dd` and all three
  red there.
- fix sketch: none needed in code; the count in the message is the defect. Worth saying why it matters here:
  the third red is the *stale-review* test, i.e. the one the same message says "first measured 0 red". The
  count that was carefully re-measured is the one that is wrong.

### F4 · `docs/agents.md`'s checkpoint field list was stale one commit after it was written — P2
- where: `docs/agents.md:126-136` (written by `e3e8e3b`) vs `packages/core/src/engine/research-engine.ts:526-543`.
- input / observed: the doc lists "`report`, `sources`, `extracted`, `doneAgentIds`, `gatheredAgentIds`,
  `fetchedByAgent`, `handoffs`, `degraded`, `warnings`, `writeFailures` and the accumulated `cost`". The
  actual `snapshot()` also writes **`touchedByAgent`** and **`agentTraces`**. `touchedByAgent` is added by
  `a84878d` — the commit immediately after `e3e8e3b`, in this same batch, and one of the five persisted
  fields the round-8 brief singles out. `agentTraces` predates the batch and appears nowhere in `agents.md`.
- status: **reproduced** (read both; `grep -n "agentTraces\|touchedByAgent" docs/agents.md` returns nothing).
- refutation attempted: that the doc's "the checkpoint without the six fields added since" sentence in the
  commit message means something narrower — it does not; item 2 reads as the field list and the sentence
  after it ("Every field added since the first version is optional") invites the reader to treat it as complete.
- fix sketch: add both. The general lesson: a docs commit placed in the middle of a batch is stale by the end
  of it; docs go last, or the doc lists the type, not a prose copy of it.

### F5 · `docs/agents.md` over-states what the breakers report: a stalled loop with its allowance spent reports `budget` and closes `stopped`, not `stalled`/`cut_off` — P2
- where: `docs/agents.md:66-67` ("A loop that ends this way reports `gatherStop: 'stalled'` and the buyer's
  live line reads `cut_off`") vs `packages/core/src/engine/gather.ts:389-395` and `:591-598`.
- input / observed: the breakers `break` with `stop` still `'stalled'`; then
  `if (stop === 'stalled' && turnsUsed >= maxTurns) stop = 'budget';` and the closing note is
  `stop === 'done' || stop === 'budget' ? 'stopped' : 'cut_off'`. Once the turn allowance is spent,
  `buysNothing()` returns true for every `web_search`/`fetch_page`, so `noProgressTurns` climbs to 8 and the
  breaker fires — with `turnsUsed >= maxTurns`. That run reports `gatherStop: 'budget'` and its **last**
  progress kind is `stopped`, not `cut_off` (the breaker's own `cut_off` note is superseded).
- status: **reasoned** from the two code paths (I did not construct a live loop that spends its whole
  allowance and then stalls; the reclassification at `:591` is unconditional and the path is reachable).
- refutation attempted: that the reclassification is a bug — it is not; the comment above it argues the case
  deliberately ("Only a loop cut off with budget LEFT is half-done") and the round-7 work stands behind it.
  The doc is the imprecise artefact, not the code.
- fix sketch: "…reports `gatherStop: 'stalled'` **when the allowance was not spent** (a loop that spent it and
  then stalled is `budget`, and closes `stopped`)".

### F6 · `deep-review.md` declares "P2 is closed" with two of the closing commits uncited, and its P2 totals are wrong at both ends — P2
- where: `docs/plans/deep-review.md:1334`, `:1354-1360`, `:1422`.
- input / observed: (a) `a84878d` (closes R7-12) and `e3e8e3b` (closes R7-27) appear **nowhere** in
  `deep-review.md` or `product-backlog.md`; R7-12's closure is described in prose with no hash and R7-27 is
  still sitting in the open P2 list at `:1422` while the docs it names have been rewritten. That is exactly
  the rule `a11bafe` ("cite the commits that are actually on main") exists to enforce. (b) "Suite 1029 →
  1063 in this checkout" for the eight P2 commits: the commit before the first of them (`3397da8`) measures
  **1035**, and the last of them (`b72de29`) measures **1062**. (c) "suite 974 → 1023 here" for the P1
  batch: `3d6aad8` is 974 (correct) and `38bfc53` measures **1022**.
- status: **reproduced** (measurements as in F1; hash absence by `grep -oE '\b[0-9a-f]{7,40}\b'` over both docs).
- refutation attempted: that 1029/1063 refer to a different span — no span of the batch begins at 1029
  (that is `16e7014`, four commits before the first P2 commit) or ends at 1063.
- fix sketch: one line per closed item with its hash, and the same measured-not-recalled rule for the
  section totals.

### F7 · `request-review.md` folds `fillable` into gate 1 of "five gates", but a fill passes neither gate 3 nor gate 4 — P2
- where: `docs/request-review.md:41-52` vs `packages/core/src/moderation/enrich.ts:494-514`.
- input / observed: the doc's five gates are `correctable` → `sanitizeProposal` → `+40 (MAX_EXPANSION)` →
  `similarity ≥ 0.55` → re-validate; the `fillable` sentence is appended to gate 1. The fill path does
  gate 2 (`sanitizeProposal`), gate 5 (`paramsSchema.safeParse`), a **verbatim-quote** requirement, an
  "only if the field is empty" requirement, and its own `f.maxLength` — it does **not** apply
  `maxLengthFor` (+40) or `similarity`, and cannot: there is no original to expand from or resemble.
- status: **reproduced** (read both; the code path is a separate loop from the corrections loop).
- refutation attempted: the doc's own "and a fill needs a verbatim quote plus the buyer's tick" is a
  partial hedge, but it reads as an *addition* to the five, not a *substitution* for two of them.
- fix sketch: give `fillable` its own three-line list rather than a clause inside gate 1.

### F8 · `product-backlog.md` marks P-3 `done (16e7014)`, but the commit that delivered the entry's title is `3397da8`, uncited — P2
- where: `docs/plans/product-backlog.md:93`, `:137`, `:149`.
- input / observed: the entry is titled "the box, or the fields — **not both at once**" and is stamped
  `done (16e7014)`. `16e7014` collapses 04 behind a link; the "never both" behaviour is `3397da8`
  ("one section, two ways — the box or the fields, never both"), and `2bf0b97` fixes the block closing
  under the cursor. Neither hash appears in the backlog (`c0805a7` and `16e7014` are the only two P-3
  hashes in the file).
- status: **reproduced** (hash scan of the file; `git log` subjects).
- fix sketch: `done (16e7014 → 2bf0b97 → c0805a7 → 3397da8)`.

### F9 · `local-llm.md` §3 cannot be run as written — every curl in it 500s without GCP credentials — P2
- where: `docs/local-llm.md:57` (`APP_ENV=local npm run dev:api`) and `:70-85`.
- input / observed: started the API from a clean worktree at `4b61242` with `APP_ENV=local
  VALIDATION_LLM=false PORT=8099`. It boots and logs "auth is DISABLED". All three documented curls return
  **HTTP 500** `{"error":"Something went wrong on our side."}`; the server log shows
  `Error: 7 PERMISSION_DENIED: Missing or insufficient permissions` from Firestore — the `publicLimit`
  meter reads Firestore before `validateRequest` runs. `deployment.md:326` does say
  `gcloud auth application-default login`, but `local-llm.md` presents §3 as a self-contained local flow and
  never mentions it; there is no Firestore emulator anywhere in the docs (`grep -rn emulator docs/` is empty).
- status: **reproduced** (server started, three curls issued, log captured).
- fix sketch: one line in §2 — "you still need ADC for Firestore (`gcloud auth application-default login`);
  the API's rate meter reads it before anything else."

## Claims checked and TRUE (so nobody re-checks)

**Mutations** (all 19 re-run at `4b61242` in scratch worktrees, each alone, all five workspaces run
regardless of a failure so nothing is hidden by `npm test`'s `&&`; every count below is claimed = observed
unless F3 says otherwise):

- `929e8dd`: "useless preflight submits the stale review" 1 red; "retired params stripped again" 2 red;
  "retired check runs after the schema" 1 red — all exact, and the last one reds the *right* test
  ("says THAT before it complains about anything else"), so the ordering claim is genuinely pinned.
- `b72de29`: "drop the `maxLength` forward" 1 red; "hand a non-admin the whole summary" 1 red — exact. The
  signature mutation ("the signature keeps the parser's kind") reds 3 tests, which is consistent with the
  message's non-numeric "(updates 5 assertions; the pin is the new same-bucket pair in refute-D1)" — the
  refute-D1 pin does fire.
- `6780c94`: all six exact (1 red each). Worth recording for the next round: four of them —
  "shrink line is a note only", "warnings do not ride the checkpoint", "warnings not seeded from resume",
  "warnings only reach the trace at the end" — all red **the same single test** in `a-legit.test.ts`.
  Each mechanism is pinned, but by one assertion; deleting that test returns four defects.
- `60c92a0`: all three exact (1, 2, 1). The "1 red rather than 5" explanation is right — with the env block
  removed *and* `.env.local` moved away, only the control test ("the configured build still offers the
  Google button") fails; the five `rate-limit-copy` tests pass with no env at all, exactly as claimed.
- `90a355f`: all three exact (1 red each) **and** all three "(0 before this commit)" claims are true —
  re-run at `1ce4893`, `FOREIGN_PER_DOMAIN_PAGES = 999`, `FOREIGN_PER_DOMAIN_SNIPPETS = 999` and
  `if (false)` around `stopPlanning` each leave the core suite **663 passed, 0 failed**.

**Docs:**
- `+40` correction bound: `moderation/enrich.ts:71-72` `MAX_EXPANSION = 40`, applied as
  `to.length > maxLengthFor(from.trim())` at `:218`. TRUE, and the old `max(3×, +24)` is gone.
- `similarity ≥ 0.55`: `MIN_SIMILARITY = 0.55` at `:52`, applied at `:219`. TRUE.
- `correctable` for Florida is `location` + `industry` only, no number: `florida-preflight.ts:140-143`. TRUE.
- `fillable` is `location` and nothing else (`florida-preflight.ts:150`); a fill requires the field to be
  empty and a verbatim quote (`enrich.ts:499-513`), and the SPA renders it unticked
  (`new-report.test.tsx:563`). TRUE (see F7 for the one nuance).
- The progress-kind list in `api-reference.md` matches `PROGRESS_KINDS` (`jobs/types.ts:83-111`) **exactly**,
  including `cut_off` in the right position — all 20, same order.
- The lifecycle coercion: `LIFECYCLE_KINDS = {held, incomplete, failed, done, assembling}` and
  `clientProgress` coerces `phase → kind` only for that set (`jobs/types.ts:128`, `:161`). The doc's list is
  the same five. TRUE. `detail` clipped by **code point** to 120 (`Array.from(...).slice(...)`) — the doc's
  "120 code points" is precise, not sloppy. TRUE.
- The inbox payload example: `mode`, `creditsSpent` and a buyer-shaped `progress` are all really returned
  (`apps/api/src/index.ts:1496-1513`), and `cost` really is admin-gated — the doc covers that with
  "(Same for the `cost` field in `GET /research`.)". TRUE.
- The two loop breakers: `PLAN_TURNS_LIMIT = 4`, `NO_PROGRESS_TURNS_LIMIT = 8` (`gather.ts:197`, `:223`);
  `buysNothing()` classifies a plan update, a call we will refuse, and a third+ cached re-read of the same
  URL (`MAX_SAME_URL_CACHED_READS = 2`) as buying nothing, and both counters reset on anything else — the
  doc's prose is accurate to the code. `stopPlanning` + `forceTools` drop at `PLAN_TURNS_BEFORE_NUDGE = 3`
  (`:341`, `:427`), i.e. "on the third such turn". TRUE (see F5 for the outcome sentence).
- `reconstructed`: `research-engine.ts:949-950` marks exactly "a key an enricher wrote without its
  producer"; the body is kept; the copy exists in four languages
  (`report-html.ts:205-208 reconstructedSection`) and says "less directly sourced". The doc's description is
  accurate.
- `local-llm.md`'s rewritten injection curl **does** produce what the doc says. Reproduced through the API
  (Fastify `inject`, mock tier, in-memory Firestore, at `4b61242`): the `freeText` payload → **422**
  `{"code":"params_rejected","categories":["prompt_injection"]}` from the deterministic pre-screen; the
  *old* `params.instructions` payload → **400** `{"error":"This model no longer accepts free-text
  instructions. Reload the page and try again."}` — the exact sentence the doc quotes; and curl #1 → 200
  with the deterministic summary. All three claims in that block are true.
- `architecture.md` / `modules.md`: `buildSystemPrompt` (`prompt.ts:62-82`) is `basePrompt` +
  `--- CLIENT DIRECTIVES (STRUCTURED, VALIDATED) ---`, with no free-text block. TRUE.
- `agents.md` on `focus`: rendered only by `buildAgentKickoff` (`prompt.ts:524`, the single `agent.focus`
  read in the engine) and `validateTemplate` refuses it on an agent with no loop (`templates/validate.ts:61-64`).
  TRUE.
- `request-review.md`'s rewritten fail-open paragraph and `modules.md`'s "client free text reaches no
  prompt" match the code.

**Backlog hashes (task 4):** every commit hash in `docs/plans/deep-review.md` (53) and
`docs/plans/product-backlog.md` (3), plus the two in the round-6 range header (`cd5740b..622e527`), **56
in total — all resolve and all are ancestors of `4b61242`**. Round 7's "all 33 hashes" claim held and the
23 added since hold too. Every "closed by X" row I spot-checked matches what X changed: R7-1/`c9065e3`
(`reconstructed` exists in both renderers and in `KNOWN`), R7-3+R7-29/`93b132e` (limit 8, plan bound 4),
R7-5+R7-6/`f33ecce` (`LIFECYCLE_OTHER = ['incomplete','failed','held']` in `phases.ts:20`, `PROGRESS_KINDS`
exported with a cross-package pin), R7-7+R7-8/`929e8dd`, R7-4+R7-30/`6780c94`, R7-9/`38bfc53`,
R7-10/`b3e3f8e` (`instructions_vague` gone, `allowedIssueCodes` reads `CORE_ISSUE_CODES` at
`deterministic.ts:48`), R7-18/`d1dab19`, R7-31/`90a355f`. The two count corrections `deep-review.md` records
(`1ce4893` really 1043, `90a355f` really 1046) are **exactly right** — I measured both.

## Commit-message audit

**Method.** For each sha: `git worktree add --detach <dir> <sha>`, symlink the six `node_modules`, symlink
`out/` (the six trace-gated tests), copy `apps/fbizlab/.env.local`, then `npm test`. This is the
"main checkout" configuration and it reproduces the batch's own anchors exactly (`3d6aad8` → 974,
`4b61242` → 1071). "clean worktree" figures below are the same runs without `out/` and without `.env.local`.

### Suite totals — claimed vs measured (main-checkout equivalent)

| commit | claimed before → after | measured | after ✓/✗ | claimed Δ | measured Δ | net `it(` |
|---|---|---|---|---|---|---|
| `3d6aad8` (base) | — | **974** | — | — | — | — |
| `c9065e3` | 974 → 986 | **986** | ✓ | +12 | +12 | +10\* |
| `93b132e` | 986 → 988 | **988** | ✓ | +2 | +2 | 2 |
| `6fde120` | 988 → 991 | **990** | ✗ −1 | +3 | **+2** | 2 |
| `6780c94` | 991 → 994 | **993** | ✗ −1 | +3 | +3 | 3 |
| `f33ecce` | 994 → 1000 | **1000** | ✓ | +6 | **+7** | 7 |
| `929e8dd` | 1000 → 1008 | **1007** | ✗ −1 | +8 | **+7** | 7 |
| `b3e3f8e` | 1008 → 1010 | **1009** | ✗ −1 | +2 | +2 | 2 |
| `38bfc53` | 1010 → 1023 | **1022** | ✗ −1 | +13 | +13 | 13 |
| `60c92a0` | 1023 → 1025 | **1024** | ✗ −1 | +2 | +2 | 2 |
| `16e7014` | 1025 → 1030 | **1029** | ✗ −1 | +5 | +5 | 5 |
| `2bf0b97` | 1030 → 1031 | **1030** | ✗ −1 | +1 | +1 | 1 |
| `c0805a7` | 1031 → 1036 | **1034** | ✗ −2 | +5 | **+4** | 4 |
| `3397da8` | 1036 → 1037 | **1035** | ✗ −2 | +1 | +1 | 1 |
| `1ce4893` | 1037 → 1044 | **1043** | ✗ −1 (corrected to 1043 ✓) | +7 | **+8** | 8 |
| `90a355f` | 1044 → 1049 | **1046** | ✗ −3 (corrected to 1046 ✓) | +5 | **+3** | 3 |
| `2c346de` | 1045 → 1052 | **1052** | ✓ (but "before" 1045 ≠ its own 1046) | +7 | **+6** | 6 |
| `7772772` | 1052 → 1056 | **1056** | ✓ | +4 | +4 | 4 |
| `90d6fdf` | 1056 → 1061 | **1061** | ✓ | +5 | +5 | 5 |
| `b72de29` | 1061 → 1063 | **1062** | ✗ −1 | +2 | **+1** | 1 |
| `d1dab19` | 1063 → 1066 | **1065** | ✗ −1 | +3 | +3 | 3 |
| `0497861` | 1066 → 1068 | **1068** | ✓ | +2 | **+3** | 3 |
| `a84878d` | 1068 → 1071 | **1071** | ✓ | +3 | +3 | 3 |

\* `c9065e3`'s `it(`-grep undercounts (some cases are added inside an existing `it.each`/nested describe);
its measured delta of +12 matches its claim.

**Chain check.** Nine "after" values are right; **fourteen are wrong**, twelve of them by 1 and never
corrected. Because the messages compute the next "before" from the previous claimed "after", the chain is
self-consistently wrong from `6fde120` onward — which is why `2c346de` could re-anchor on a real
measurement (1052 ✓) and still write a "before" (1045) that contradicts the correction printed four lines
above it (1046).

### Clean-worktree totals (no `out/`, no `.env.local`)

| commit | clean | main-equiv | gap | note |
|---|---|---|---|---|
| `3d6aad8` | 961 | 974 | 13 | fbizlab `5 failed`; admin's 2 never run (`&&` short-circuits) |
| `1ce4893` | 1037 | 1043 | 6 | after `60c92a0`: green, gap is the 6 gated tests only |
| `90a355f` | 1040 | 1046 | 6 | |
| `2c346de` | 1046 | 1052 | 6 | the commit that wrote "~16 fewer" |
| `3397da8` | 1029 | 1035 | 6 | |
| `4b61242` | **1065** | **1071** | **6** | HEAD |

### Mutations re-run — claimed vs observed

All at `4b61242` in scratch worktrees, each alone, reverted after (`git checkout -- .`), every workspace run.

| commit | mutation | claimed | observed | which test(s) went red |
|---|---|---|---|---|
| `929e8dd` | preview key ignores the notes again | 2 red | **3 red** | the two notes tests + "a second preview with nothing to say submits WITHOUT the first one's proposals" |
| `929e8dd` | (same, re-run at `929e8dd` itself) | 2 red | **3 red** | identical three |
| `929e8dd` | useless preflight submits the stale review | 1 red | 1 red ✓ | "a second preview with nothing to say…" |
| `929e8dd` | retired params stripped again | 2 red | 2 red ✓ | "is refused with something the buyer can act on…", "says THAT before it complains about anything else" |
| `929e8dd` | retired check runs after the schema | 1 red | 1 red ✓ | "says THAT before it complains about anything else" |
| `b72de29` | the signature keeps the parser's kind | (5 assertions) | 3 tests red | 2 in retry-waste + the refute-D1 same-bucket pin |
| `b72de29` | drop the `maxLength` forward | 1 red | 1 red ✓ | "jsonSchemaToGemini forwards every bound the schema declares" |
| `b72de29` | hand a non-admin the whole summary | 1 red | 1 red ✓ | "hands the buyer the notice and the section states… (R7-20)" |
| `6780c94` | shrink line is a note only | 1 red | 1 red ✓ | a-legit "and the note reaches a screen: it is a WARNING…" |
| `6780c94` | warnings do not ride the checkpoint | 1 red | 1 red ✓ | same test |
| `6780c94` | warnings not seeded from resume | 1 red | 1 red ✓ | same test |
| `6780c94` | warnings only reach the trace at the end | 1 red | 1 red ✓ | same test |
| `6780c94` | summary drops `turnsUsed`/`gatherStop` | 1 red | 1 red ✓ | run-job "carries what each agent's loop did into the summary…" |
| `6780c94` | admin table drops the Research column | 1 red | 1 red ✓ | admin "tells a step that researched nothing from one that did" |
| `60c92a0` | suite has no env, `.env.local` moved away | 1 red | 1 red ✓ | "control: the configured build still offers the Google button" |
| `60c92a0` | the page sets the env-var error again | 2 red | 2 red ✓ | the control + "does not put an environment variable name on the buyer's screen" |
| `60c92a0` | the Google button renders without a client id | 1 red | 1 red ✓ | "does not put an environment variable name on the buyer's screen…" |
| `90a355f` | `FOREIGN_PER_DOMAIN_PAGES = 999` | 1 red (0 before) | 1 red ✓ / **0 at `1ce4893` ✓** | "puts a minority host in front of the farm's fourth page — through the builder" |
| `90a355f` | `FOREIGN_PER_DOMAIN_SNIPPETS = 999` | 1 red (0 before) | 1 red ✓ / **0 at `1ce4893` ✓** | "…and the same for snippets, whose cap is a different number" |
| `90a355f` | `if (false)` around `stopPlanning` | 1 red (0 before) | 1 red ✓ / **0 at `1ce4893` ✓** | refute-B2 "the two real plan-loops end at the breaker, not at the bound" |

**Score: 19 of 20 mutation counts exact; 1 wrong (`929e8dd`'s first, 2 claimed / 3 observed).**
**Score: 8 of 22 suite totals exact; 14 wrong, of which 2 were corrected.**

`git diff` in this worktree is clean; no `src/` file was modified here (all mutations ran in scratch
worktrees under the session scratchpad and were reverted).
