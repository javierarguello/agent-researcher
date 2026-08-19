# G4-break — the pre-flight summary, the admin row and the checkpoint (`4ba3bd4`) / BREAK

Measured at `a37d5f57f2f4f9f042ba704a6dec96a7b7aa68da` (the brief's own commit). `npm ci` ran; clean-worktree
`npm test` = **708 + 215 + 22 + 158 + 6 = 1109 passed, 0 failed, 16 skipped in core** — the brief's number
exactly. `out/` not symlinked, so the six trace-gated red-team tests did not run.

## Verdict

Three of the four halves hold in the unit and one of them does not hold in production. `kind` really does ride
`JobSummary.agents[]` through an API with no response schema to strip it, the admin cell really does render it,
the shrink warning really is timestamped, `snapshot()` really does copy five of its containers, and all five
mutation counts in the commit message re-measure exactly as claimed (four × 1 red, snapshot × 0 red). But R8-36 —
the headline, the reason the commit is titled "the preferences that steer the shortlist were absent from the last
screen before payment" — **does not reach the buyer's screen intact**. `renderPlan` is a pure function of the
params it is *called* with, and `apps/fbizlab` deliberately keeps the directives OUT of the key that decides
whether the preview is still valid (a pinned, commented, intentional choice — `new-report.test.tsx:839`). Before
this commit that exclusion was sound, because the summary did not depend on the directives. This commit made it
depend on them and did not touch the key. The result, reproduced both ways: the confirm dialog now states a
preference the request will not carry, and stays silent about one it will — the second is verbatim the bug R8-36
was filed for, unfixed on the exact path the P-3 design invites the buyer down. Two supporting claims in the
message are also not true as written: "a template cannot forget it: every model's summary" (only a template with
a `describePlan` gets the clause) and "a snapshot that keeps mutating is not a snapshot" (it still does —
`report` and `sources` are still handed out live, and they are the two biggest fields).

## Findings (most severe first)

### F1 · The confirm dialog's "What we'll search" now states a preference the request will not carry — and is still silent about one it will — P0

- where: `packages/core/src/moderation/deterministic.ts:99-113` (the new clause) against
  `apps/fbizlab/src/pages/NewReport.tsx:655` (`keyParams` strips `dirKey`), `:657` (`validated`), `:1054`
  (`{pf.summary}`), `:761` (`submit()` sends `cleanParams()`, the LIVE form). Pinned as intended behaviour by
  `apps/fbizlab/test/new-report.test.tsx:839` "editing a chip does not send the buyer back through validation".
- input / observed (two directions, both reproduced):
  1. Buyer ticks a preference by hand, previews, goes back, changes it, presses Generate. The modal shows
     `We will research X. Preferences you set: Preferred weather: Sunshine.` — and `createJob` is called with
     `{"weather":"rain"}`. `preflight` was called exactly once. The button never reverts to "Validate & continue".
  2. Buyer previews with no preference, goes back, ticks `Rain`, presses Generate. The modal shows
     `We will research X.` with no Preferences clause — and `createJob` is called with `{"weather":"rain"}`.
     That is R8-36's own sentence ("a buyer could pay with `absentee` and `financial_distress` in the request
     with nothing on that screen saying so") still true after the fix.
  3. Same mechanism, not separately reproduced: `runPreflight` renders the summary from `correctedParams ?? params`
     (`preflight.ts:110`, deliberately never `proposedParams`), then `NewReport.tsx:695-704` merges the
     auto-accepted proposal directives into `params` right after the response lands. So a clause headed
     "Preferences you set:" omits every directive the assist proposed and the buyer left ticked, while the
     request carries them.
- status: **reproduced**. Scratch test (deleted; port it into `apps/fbizlab/test/new-report.test.tsx`, which
  already has every helper). The only thing the fixture needs beyond the existing file is a preflight mock that
  behaves like the server does since `4ba3bd4` — echoing the directives it was called with into `summary`:

  ```ts
  preflight: vi.fn(async (body: any) => {
    const d = body?.params?.directives ?? {};
    const parts = [];
    if (d.weather) parts.push(`Preferred weather: ${{ sun: 'Sunshine', rain: 'Rain' }[d.weather]}`);
    return { ok: true, summary: `We will research X.${parts.length ? ` Preferences you set: ${parts.join('; ')}.` : ''}`,
             quality: 'ok', issues: [], corrections: [], assist: { state: 'on' } };
  }),
  ```

  ```ts
  await userEvent.click(screen.getByTestId('toggle-preferences'));
  await userEvent.type(screen.getByPlaceholderText('e.g. ERCOT West'), 'ERCOT West');
  await userEvent.click(screen.getByRole('button', { name: 'Sunshine' }));
  await userEvent.click(screen.getAllByRole('button', { name: /generate dossier/i })[0]!);
  await userEvent.click(await screen.findByRole('button', { name: /validate & continue/i }));
  await userEvent.click(screen.getByRole('button', { name: /go back|back/i }));
  await userEvent.click(screen.getByRole('button', { name: 'Rain' }));       // hand edit, after the preview
  await userEvent.click(screen.getAllByRole('button', { name: /generate dossier/i })[0]!);
  const modal = document.querySelector('.modal')!;
  expect(modal.textContent, 'the last screen before payment must not name a value that is not going').not.toContain('Sunshine');
  ```
  Observed: `Received: "…What we'll searchWe will research X. Preferences you set: Preferred weather: Sunshine.Cost5 credits…"`,
  `SENT: {"weather":"rain"}`, `preflight` called once.
- refutation attempted: (a) *maybe the proposals block covers it* — no: in repro 1 there were no proposals at all,
  the block does not render, and the summary is the only statement about directives on the screen. That is
  precisely R8-36's own argument, now pointing the other way. (b) *maybe the buyer is sent back through validation*
  — no, `queryByRole('validate & continue')` is null and `preflight` is called once; the exclusion of `dirKey`
  from `paramsKey` is deliberate and pinned. (c) *maybe `submit()` sends the previewed params* — no, `:761`
  `const base = cleanParams()`, and `new-report.test.tsx:891` pins that a post-preview edit survives. (d) *maybe
  it only bites the fictional-model fixture* — no: the fixture is the real `NewReport` component, and the server
  half is `renderPlan`, whose output for real Florida params I rendered separately (below).
- fix sketch: the cheap correct fix is to stop the client asserting a stale sentence, not to re-preview. Render
  the directive clause CLIENT-side from the live `params` + the manifest labels (the client already has both —
  `directives[].options[].label` is exactly what `planDirectives` reads) and drop it from `renderPlan`; or keep
  it server-side and have `NewReport` blank/regenerate the clause portion whenever `dirVals` differs from what was
  previewed. Putting `dirKey` back into `paramsKey` is the naive fix and costs an honest run real money: every
  chip click flips the dialog back to "Validate & continue" and burns one of the two assisted-review attempts —
  which is exactly what `new-report.test.tsx:839` exists to prevent.

### F2 · "a template cannot forget it: every model's summary" is false — only a template with `describePlan` gets the clause — P2

- where: `packages/core/src/moderation/deterministic.ts:99-113`. The clause is appended **inside** the
  `if (template.preflight?.describePlan)` branch. `describePlan` is optional (`templates/types.ts:381`), and the
  same branch's `catch` falls through to the generic renderer, which appends nothing.
- input / observed: same Florida params + `directives: { ownerInvolvement: 'absentee', reasonForSale: ['financial_distress'] }`,
  against a template built as `{ ...florida, preflight: undefined }`:
  - with `describePlan`: `… Preferences you set: Reason for sale: Financial distress; Owner involvement: Absentee — a manager runs it.`
  - generic path: `We'll run "Generic model" (Essential) — location: Miami-Dade County; industry: HVAC contractors; directives: [object Object].`
  - `describePlan` that throws: identical to the generic path, silently.
  The `directives: [object Object]` is pre-existing (`deterministic.ts:107` `String(v)`), not this commit's — but
  it is what the generic path actually shows a buyer, so "every model's summary is now a function of the params
  actually being submitted" is wrong twice over on the one path the architectural argument was written for.
- status: **reproduced** (scratch `tsx` script against the real registry; only one template is registered today
  and it does have `describePlan`, so nothing is broken in production right now — the CLAIM is what is false).
- refutation attempted: I checked whether `assertTemplatesValid` forces a `describePlan` — it does not
  (`templates/validate.ts` has no such rule); and whether `renderPlan` re-enters the branch after the catch — it
  does not, the `return` is inside the `try`.
- fix sketch: hoist `planDirectives(...)` out of the branch and append it to whichever string is returned, and
  add `directives` to the generic renderer's skip list next to `mode`/`language`. Naive version: appending it
  after the generic filter list leaves the `directives: [object Object]` entry in place and the buyer reads the
  same field twice, once as noise.

### F3 · `snapshot()` still hands out a checkpoint that keeps mutating — `report` and `sources` were left aliased — P2

- where: `packages/core/src/engine/research-engine.ts:547-570`. Copied: `fetchedByAgent`, `touchedByAgent`,
  `handoffs`, `degraded`, `warnings`, `doneAgentIds`, `gatheredAgentIds`, `extracted`. Still live:
  `report` (mutated at `:747` `Object.assign(report, slice)` and `:986`), `sources: evidence.sources`,
  `writeFailures` (mutated at `:816-821`).
- input / observed: `runResearch` on the flagship with the mock provider, `finalize: true`, holding the object
  handed to `onCheckpoint`. At the first wave boundary it read `{reportKeys: 2, sources: 4}`; the SAME held
  object at the end of the run read `{reportKeys: 12, sources: 16}`. `warnings`/`handoffs`/`degraded`/
  `writeFailures` stayed put — i.e. the fix works for the five it touched and the commit's stated invariant
  ("a snapshot that keeps mutating is not a snapshot… the next caller that holds one inherits the aliasing
  without being told") is still false for the two largest fields.
- status: **reproduced** (scratch core test, deleted). Assertion to port:
  ```ts
  const held: Checkpoint[] = []; const at: number[] = [];
  await runResearch({ …, onCheckpoint: async (cp) => { held.push(cp); at.push(Object.keys(cp.report ?? {}).length); } });
  expect(Object.keys(held[0]!.report ?? {}).length, 'a snapshot does not keep growing').toBe(at[0]);
  ```
- refutation attempted: (a) *is it observable on a real caller?* `run-job.ts:290-298` awaits `stillOurs()` — a
  Firestore read — between receiving the checkpoint and `uploadJson(CHECKPOINT, cp)`, and a wave runs agents
  concurrently through `runPool`, so the serialized bytes can include a `report` section from an agent that is
  NOT in the copied `doneAgentIds` — that agent re-runs and re-buys its loop next dispatch. But that skew existed
  identically before `4ba3bd4` (`doneAgentIds` was always a copy), so it is not damage this commit did — it is
  damage this commit says it removed and did not. (b) *is it deliberate, since the held/incomplete returns hand
  out the same live `report` anyway (`:917`, `:927`)?* Possibly — but then the commit message should say "the
  three big fields stay aliased on purpose", and it says the opposite.
- fix sketch: `report: { ...report }`, `sources: [...evidence.sources]`, `writeFailures: { ...writeFailures }`.
  Naive cost: `report`'s values are section objects and a shallow spread still shares them, so `report[key] = …`
  is fixed but an in-place edit of a section body is not; and copying `report` on every wave boundary of a large
  job is real allocation on the hot path — bound it or document that only the top level is frozen.

### F4 · The Research cell cannot separate the two refiners the flagship actually ships — P2

- where: `apps/admin/src/pages/JobDetail.tsx:50-58`, `kind && kind !== 'researcher' ? <Badge>{kind}</Badge> : '—'`,
  under the comment "A synthesizer has no research at all — say which it is".
- input / observed (reasoned from the code, not run): `agentKind()` (`templates/types.ts:65`) returns `refiner`
  for ANY agent with `enriches`, whatever its role; `hasResearchLoop()` keys on `role === 'producer'`. The
  flagship has three producer-refiners **with** research loops (`market-refiner`, `deep-dive-refiner`,
  `valuation-analyst` — `florida-business-for-sale.ts:852-899`) and one synthesizer-refiner **without** one
  (`chart-refiner`, `:911`). `run-job.ts:521-522` writes `turnsUsed`/`gatherStop` only when truthy, so a
  producer-refiner whose loop threw before its first turn arrives with neither — and renders the identical
  `refiner` badge as `chart-refiner`, which never had a loop at all. That is the same "different conversations,
  and one of them is a refund" ambiguity the commit says it removed, moved one row over. `role` is not in
  `JobSummary.agents[]` and there is no Role column, so nothing else on the page resolves it.
- status: **reasoned** (the badge branch is trivially reachable; I did not build a failed-refiner e2e fixture —
  it needs a provider mock that throws inside `gather` for one agent, which is more machinery than the finding
  is worth).
- refutation attempted: (a) *maybe a resumed refiner carries its turns forward* — it does (`:641-642`), so the
  resume path is fine; the exposure is a loop that failed before turn 1 on the first dispatch. (b) *maybe the
  Status column disambiguates* — it says `failed`, which both an exploded synthesizer and an exploded producer
  show. (c) *maybe `kind` is enough because an admin knows the DAG* — that is the argument the commit rejects for
  writers.
- fix sketch: carry `role` (or a boolean `hadLoop`) in `JobSummary.agents[]` alongside `kind`, and gate the badge
  on "no loop declared" rather than `kind !== 'researcher'`. Naive version — badging only `writer` — throws away
  the `chart-refiner` case, which is the one the badge is genuinely right about.

### F5 · `planDirectives` renders a directive value verbatim; its sibling `renderDirectives` re-checks the vocabulary and says why — P2

- where: `packages/core/src/moderation/deterministic.ts:151-153`, `const label = (raw) => text.valueLabels?.[raw] ?? raw`,
  with no `field.values.includes(v)` test and no bound on array length. Compare
  `templates/directives.ts:100-103`: "*Only a declared value renders. `directivesSchema` already enforces this;
  re-checking here means a caller that skipped validation still cannot get an arbitrary string into a prompt.*"
- input / observed: `renderPlan(florida, { …, directives: { ownerInvolvement: 'PWNED <script>alert(1)</script>' } }, …)`
  → `… Preferences you set: Owner involvement: PWNED <script>alert(1)</script>.` Likewise
  `reasonForSale: ['owner_retiring', 'INJECT me']` → `Reason for sale: Owner retiring, INJECT me.`
  A `maxSelected: 4` field will print all 500 entries of a 500-element array.
- status: **reproduced** (scratch script calling the exported `renderPlan` directly, bypassing `validateRequest`).
- refutation attempted: this is defence-in-depth only, and I could not find a live caller that skips validation.
  `apps/api/src/index.ts:1376` runs `validateRequest` → `paramsSchema.safeParse` → `directivesSchema`
  (`z.strictObject` of `z.enum`s with `.max(maxSelected)`), and `applyCorrections` can only touch `location` and
  `industry` (`florida-preflight.ts:140-143`), so `correctedParams` cannot introduce a directive. There is no
  Fastify `response` schema anywhere in `apps/api/src/index.ts` (0 matches for `response:`), so nothing strips or
  bounds it downstream either — but nothing feeds it, either. `renderPlan` *is* exported from the package's public
  index (`core/src/index.ts:211`), which is why this is worth the four lines.
- fix sketch: mirror the sibling — skip a value not in `field.values`, and slice the array at
  `field.maxSelected ?? field.values.length`. Nothing honest is lost: every value the buyer can pick is declared.
  Doing it naively by reusing `renderDirectives` itself would put `promptLabel`/`promptValues` (English, internal
  prompt wording) on the buyer's screen instead of the manifest labels, which is exactly what the clause is
  careful not to do.

## Claims checked and TRUE (so nobody re-checks)

- **The summary is still a pure function of the params it is given.** `planDirectives` iterates `spec.fields`,
  not the object's key order: `{ownerInvolvement, reasonForSale}` and `{reasonForSale, ownerInvolvement}` render
  byte-identically. `directives: {}` ≡ `directives` absent (also pinned by the new test). A value of `null`,
  `undefined`, `[]`, an unknown KEY, or a non-string/non-boolean scalar all render nothing. Array order within a
  multi is the buyer's own order, which is part of the params.
- **"a request with no directives reads exactly as it did"** — true, byte-for-byte.
- **No length bound is blown.** All four languages with all seven fields at their `maxSelected` bound:
  en 882, es 983, fr 1035, pt 979 characters. The summary reaches exactly two places — the `/research/preflight`
  response body and `NewReport.tsx:1054` — and is never stored on the job, never in `JobSummary`, never in the
  report, the PDF, the trace, or any email. There is no Fastify response schema on any route to truncate it and
  no `maxLength` on the client side.
- **A missing `valueLabels` key cannot ship**, so `label()`'s raw-key fallback is unreachable for a registered
  template: `validateDirectives` (`directives.ts:152-155`) requires every declared language to label every value,
  and `assertTemplatesValid` runs at module load (`registry.ts:13`), not only in tests.
- **`kind` reaches the admin.** `GET /research/:jobId` returns `s` whole for an admin (`index.ts:1553-1558`) and
  the file declares zero Fastify `response` schemas, so nothing serializer-strips the new field.
- **Migration both ways is safe.** An OLD job (no `kind`) → `kind` undefined → the `—` branch, unchanged; a NEW
  job in an OLD admin bundle → an extra JSON property React never reads. `Checkpoint.warnings` entries gaining a
  timestamp prefix cannot break a reader: the only consumer that pattern-matches them is
  `research-engine.ts:805`, and it dedups the UNtimestamped `capped` string against itself, so the shrink
  warning's timestamp cannot defeat it. `warnings` growth is unchanged — the shrink push was never deduped
  before this commit either, so nothing about checkpoint size moved.
- **`snapshot()`'s frozen `degraded`/`warnings` do not regress the held/incomplete paths.** The `:896` snapshot
  is returned only by the `held` (`:917`) and `incomplete` (`:927`) returns, both of which precede every
  `degraded.push` (`:975-977`) and every post-wave `warnings.push` (`:934`, `:999`); the completed path takes a
  fresh `snapshot()` at `:1041` after both. So freezing those two arrays changes nothing that is read.

## Commit-message audit (verifiers only): every count I re-ran, claimed vs observed

Not my lens, but I ran all five while I had the tree mutated. **All five match.** Baseline 1109/0.

| mutation (as the message names it) | claimed | observed |
|---|---|---|
| the plan summary drops the directive clause | 1 red | **1 red** — `moderation.test.ts` "states the preferences that steer the shortlist… (R8-36)". Reds for the stated reason. |
| the shrink warning loses its timestamp | 1 red | **1 red** — `red-team/a-legit.test.ts` 3a "and the note reaches a screen…". Stated reason. |
| the summary row drops `kind` | 1 red | **1 red** — `run-job-resilience.test.ts` "carries what each agent's loop did into the summary the admin page reads". Stated reason. |
| the Research cell ignores `kind` | 1 red | **1 red** — `admin/test/job-detail-sections.test.tsx` "says WHY an agent has no turns — it is a writer (R8-27)"; core/api/worker/fbizlab all stayed green, which is itself the message's point about the admin suite mocking the summary. |
| snapshot aliases its arrays again | **0 red**, disclosed | **0 red** — 708 + 215 + 22 + 158 + 6, unchanged. The disclosure is honest; see F3 for why the reason given for keeping the line does not fully hold. |

Every mutation was grep-confirmed to have applied before the suite ran, and `git status --porcelain` is empty
after each revert and at the end of this report.
