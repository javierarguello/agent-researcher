# G4-break — API surface / admin / money / deploy · BREAKER

Measured at `4b612426ebb97f9dd38f1561c047413ffd07390c` (`git rev-parse HEAD`, confirmed before anything
else), in my own worktree, fresh `npm ci`.

**Suite: 1065 passing, 22 skipped, GREEN** — not 1071. Breakdown: core 679 (+16 skipped), api 215
(+6 skipped), worker 22, fbizlab 145, admin 4. The delta to the brief's 1071 is **6**, not the
"~16" the brief estimates: 16 is the *total* skipped in `packages/core`, and ten of those sixteen
(`report.live` 3, `context-size.measure` 1, `refute-A1` 2, `refute-A2` 1, and three in `refute-B2`
that are skipped for other reasons) are skipped on Javier's checkout too. Nothing in my findings
depends on the total; recording it so the next round's brief stops carrying an estimate.
`src/` was clean (`git status --porcelain` empty) before I wrote this.

## Verdict

Two of the five claims hold as stated, one holds for a reason its own commit message gets wrong,
and two break. `int()` really does treat an empty `LLM_GATHER_*` as the code default — I ran it,
4096 / 1024, no zero and no NaN, so **item 4 is not an incident** and the deploy wiring is safe. The
summary redaction is real and I could not find a second route that leaks a `JobSummary` or trace
field to a buyer. But the admin's new Research column **is rendered under the wrong header**: the
commit deleted the "Tries" cell from the row and left "Tries" in the header, so every agent's
research figure appears under *Tries*, its cost under *Research*, the *Cost* column is empty, and
the retry count is gone from the page entirely — the one commit in this batch whose entire subject is
"a field the engine writes that no admin page can read" now writes three fields under the wrong
names. And the login fix closed one path to an internal English string on the buyer's sign-in page
while the adjacent line still opens another, with the same eat-the-buyer's-error timing the commit
message describes. Separately, and worse than any of it: the **prod** deploy workflow passes three
of the ten secrets `deploy.sh` reads, and `--set-env-vars` replaces rather than merges, so a push to
`deploy-prod` blanks `AUTH_JWT_SECRET`, both Stripe keys and Postmark on the live service —
`docs/deployment.md` even prescribes the remedy (`set the other prod secrets on the service`) that
this flag erases. That predates the batch, but `90a355f` is the commit that just widened
`COMMON_ENV` on exactly this mechanism and asserted "empty = the code default" as if the list were
additive.

## Findings (most severe first)

### F1 · A push to `deploy-prod` blanks `AUTH_JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `POSTMARK_SERVER_TOKEN` on the live API — P0

- where: `.github/workflows/deploy.yml:63-68` (the prod job's `env:` block) against
  `infra/deploy.sh:43-46,59,96`; `docs/deployment.md:81-82`; `packages/core/src/auth/tokens.ts:41-44`.
- input / observed: the prod `Build & deploy` step exports exactly three variables — `ENV`,
  `TAVILY_API_KEY`, `TURNSTILE_SECRET`. Every other name `deploy.sh` reads falls through its
  `${X:-}` default to the empty string, and both `gcloud run deploy` calls pass the whole list with
  **`--set-env-vars`**, which is the replace form (`--update-env-vars` is the merge form; it appears
  nowhere in this repo — `grep -rn 'update-env-vars' infra/ .github/ docs/` is empty). So after any
  prod deploy the API service carries:
  - `AUTH_JWT_SECRET=""` → `tokens.ts:42` `if (!config.auth.jwtSecret) throw new Error('AUTH_JWT_SECRET is not configured.')`, and `secret()` is called by **both** `signSession` and `verifySession` (`tokens.ts:95`). Nobody can log in and every live session dies. Full auth outage.
  - `STRIPE_SECRET_KEY=""` → `/plans` empty, `/checkout` 503 (the doc's own words at `deployment.md:190`).
  - `STRIPE_WEBHOOK_SECRET=""` → `/credits/webhook` cannot verify a signature, so a payment already
    taken never grants credits. Money in, nothing delivered.
  - `POSTMARK_SERVER_TOKEN=""` → no verification, reset or report-ready mail.
  - `SEARCH_COST_PER_CALL_USD=""` / `BRAVE_COST_PER_CALL_USD=""` → search booked at the code
    defaults, which is the exact failure `deploy.sh:32-33` says was fixed ("which is how 'Brave
    traffic is billed at $0' survived a fix for it").
  - `CORS_ORIGINS="*"` in production.
  The contrast is the proof this is a gap and not a policy: `deploy-dev.yml:72-79` passes
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AUTH_JWT_SECRET`, `POSTMARK_SERVER_TOKEN`,
  `TURNSTILE_SECRET` and `CORS_ORIGINS`. Prod passes none of the first four.
  And `docs/deployment.md:81-82` prescribes the one remedy that cannot work: *"Only passes
  `TAVILY_API_KEY_PROD` in the shown workflow — set the other prod secrets (Stripe/auth) **on the
  service** or extend the workflow."* Setting them on the service survives exactly until the next
  `deploy.sh`, which replaces the env block wholesale.
- status: **reasoned**, from reading. I could not run `gcloud`, so the load-bearing external fact is
  gcloud's documented `--set-env-vars` semantics ("existing environment variables … will be removed
  first"), as against `--update-env-vars`. Everything else — which workflow exports what, that
  `deploy.sh` defaults each to empty, that empty `AUTH_JWT_SECRET` throws on every sign *and* every
  verify — is read directly from the files cited and is not in doubt.
- refutation attempted: (a) *maybe prod is deployed by hand and `deploy.yml` is dead* — it is wired
  to `push: branches: [deploy-prod]` and `needs: verify`, and `deploy-fbizlab-prod.yml:8-12`
  describes `deploy-prod` as "the released ref (the same branch the API's prod deploy uses)", so it
  is the live path. (b) *maybe the empty entries are dropped, leaving the old value* — even if
  gcloud omits an empty pair from the new map, `--set-env-vars` still installs that map as the whole
  environment, so the previous value is gone either way; and `deploy.sh:39-40`'s own comment asserts
  Cloud Run "drops an env var set to the empty string", which is the same conclusion. (c) *maybe
  `AUTH_JWT_SECRET` has a default* — `config.ts:101` is `str('AUTH_JWT_SECRET')`, no fallback.
- fix sketch: pass the same secret set in `deploy.yml` that `deploy-dev.yml` passes, and add a
  pre-flight assertion in `deploy.sh` that refuses to deploy `ENV=prod` with an empty
  `AUTH_JWT_SECRET` or `STRIPE_WEBHOOK_SECRET` — a `set -u`-style guard is the only thing that turns
  this class from silent into loud. Correct the `deployment.md:81-82` sentence: "on the service" is
  not a supported option under `--set-env-vars`. **Done naively** — switching the flag to
  `--update-env-vars` to "preserve" hand-set values — an honest run loses the ability to *unset*
  anything: `TURNSTILE_SECRET` would become impossible to clear, and the doc's stated rollback
  (`gh secret delete` to turn the bot check back off, `deployment.md:216-217`) would silently stop
  working. The replace semantics are right; the missing secrets are the bug.

### F2 · The admin's Research column renders under the "Tries" header, the per-agent cost under "Research", and the retry count is gone — P1

- where: `apps/admin/src/pages/JobDetail.tsx:397-404` (seven `<Table.Th>`) against `:410-422`
  (six `<Table.Td>`). `6780c94` added `<Table.Th>Research</Table.Th>` to the header but **replaced**
  the attempts cell in the body instead of adding beside it:
  `-<Table.Td ta="right"><Mono … c={a.attempts > 1 ? 'yellow' : undefined}>{a.attempts}</Mono></Table.Td>`
  `+<Table.Td><Research turnsUsed={a.turnsUsed} gatherStop={a.gatherStop} /></Table.Td>`
- input / observed: one agent `{ id: 'deal-scout', wave: 1, status: 'ok', durationMs: 1000,
  attempts: 3, costUsd: 0.38, turnsUsed: 21, gatherStop: 'budget' }` fed through the existing
  `job-detail-sections` mock. Rendered DOM:
  ```
  HEADERS ["Agent","Wave","Status","Duration","Tries","Research","Cost"]
  CELLS   ["deal-scout","1","ok","1.0s","21 turnsbudget","$0.38"]
  ```
  Six cells for seven headers. An admin reads `21 turns budget` under **Tries**, `$0.38` under
  **Research**, an empty **Cost** column, and `attempts: 3` — an agent that failed twice and was
  retried — is not on the page at all, along with the `c="yellow"` highlight that existed to make it
  jump out. The commit message says the table "gained a Research column"; it gained a header and
  swapped a cell.
- status: **reproduced**. Scratch test in `apps/admin/test/` (written, run, deleted; tree verified
  clean). Port it as:
  ```tsx
  const t = Array.from(document.querySelectorAll('table'))
    .find((x) => (x.querySelector('thead th')?.textContent ?? '') === 'Agent')!;
  const headers = Array.from(t.querySelectorAll('thead th')).map((h) => h.textContent);
  const cells   = Array.from(t.querySelectorAll('tbody tr td')).map((c) => c.textContent);
  expect(cells.length).toBe(headers.length);                       // 6 vs 7 today
  expect(cells[headers.indexOf('Research')]).toContain('21 turns');
  expect(cells[headers.indexOf('Tries')]).toBe('3');
  ```
  I also **measured** that the shipped suite cannot see this: deleting
  `<Table.Th ta="right">Tries</Table.Th>` — which *fixes* the alignment by dropping the orphan header
  — leaves `apps/admin` at `4 passed`, green. The new test in `job-detail-sections.test.tsx:88-108`
  asserts `screen.getByText('21 turns')`, `getByText('budget')`, `getByText('0 turns')`,
  `getByText('stalled')`, `getByText('—')`: five presence checks, none of which says which column
  the value is in — and in a table the column *is* the meaning. This is standing lesson 2 in its
  table-shaped form.
- refutation attempted: (a) *maybe replacing Tries was deliberate* — the header still says Tries, so
  no; and the commit message calls it a gain, not a trade. (b) *maybe Mantine's `Table` fills the
  short row* — it does not; it renders a plain `<tr>` and the browser leaves the last column empty,
  which is what the DOM above shows. (c) *maybe the fixture is unrealistic* — `attempts` is written
  by `run-job.ts:513` for every agent and rendered by nothing else on the page.
- fix sketch: put the attempts `<Table.Td>` back between Duration and Research. Then add the shape
  assertion above to `job-detail-sections.test.tsx` — a presence-only assertion on a table is not a
  test of a table. **Done naively** — dropping the "Tries" header to match the six cells — an honest
  run loses the per-agent retry count and the `attempts > 1` warning colour, which is the signal
  that an agent burned three in-run attempts on one section, and it is not derivable from anything
  else the page shows.
- secondary, same component, lower confidence: `run-job.ts:520-522` writes `turnsUsed` only when
  truthy and `gatherStop` only when truthy. If `gather()` **throws** on an agent's first pass,
  `research-engine.ts:1114-1115` is never reached, so both are absent and `Research` renders `—` —
  the "this agent is a synthesizer with no loop" glyph — for a researcher whose loop died. Mitigated
  by `status: failed` and `agentErrors` on the same row, and it needs all three in-run attempts to
  throw before a single turn, so I am not filing it as its own finding.

### F3 · The sign-in page still puts an internal English sentence on the buyer's screen, and still eats their own error — P1

- where: `apps/fbizlab/src/pages/Login.tsx:203` —
  `.catch((e) => !cancelled && setError(e.message))`, on the `initGoogleAuth(...)` promise. The
  message it renders is `apps/fbizlab/src/auth/google.ts:7`:
  `reject(new Error('Google Identity Services failed to load.'))`, after an 8-second poll.
- input / observed: a build **with** `VITE_GOOGLE_CLIENT_ID` set (so `googleReady` is true and
  `60c92a0`'s branch never runs) where `window.google` never appears — an adblocker, a corporate
  proxy, a CSP that does not allow `accounts.google.com`, a GSI outage. The buyer types a password,
  gets a 429, reads the localized *"about 3 minutes"* sentence, and 8 seconds later the visible error
  element reads, verbatim:
  ```
  WHAT THE BUYER READS >>> Google Identity Services failed to load.
  ```
  Untranslated, in whatever language they were reading the site, on the one screen a customer meets
  before they have an account — and it overwrites their own error a moment after it appears. That is
  the defect `60c92a0`'s commit message describes ("it overwrote the rate-limit sentence … a moment
  after they appeared"), closed for the env-var branch at line 176 and left open at line 203.
- status: **reproduced**. Scratch test in `apps/fbizlab/test/` (written, run, deleted). The mock that
  matters, and the two traps I had to avoid to keep it honest:
  ```tsx
  // stable across renders, like the real useCallback one (AuthContext.tsx:39-49) —
  // a fresh vi.fn() per render re-fires the effect and proves nothing about production
  loginWithGoogle: vi.fn(),
  // rejects AFTER the buyer's own error, like the real 8s poll
  initGoogleAuth: vi.fn(() => new Promise((_r, rej) =>
    setTimeout(() => rej(new Error('Google Identity Services failed to load.')), 250))),
  ```
  then: submit → `await screen.findByText(/about 3 minutes/)` passes → wait 400ms →
  `screen.queryByText(/Google Identity Services failed to load/)` is **non-null** and
  `/about 3 minutes/` is gone.
- refutation attempted: (a) *maybe the effect re-runs and my first attempt was an artefact* — it was,
  on my first pass; `AuthContext.tsx:39-49` wraps `loginWithGoogle` in `useCallback([applySession])`
  and `applySession` is `useCallback([])`, so the dep is stable and the effect runs once. I rebuilt
  the mock to match and the finding survives. (b) *maybe it is unreachable because GSI always loads*
  — it is the exact failure `loadGoogle` was written to time out on, and the 8s budget in
  `google.ts:2` says someone expected it. (c) *maybe the buyer can still sign in* — they can, the
  password form works; the damage is the string and the swallowed error, not a lockout.
- fix sketch: same treatment as the branch above it — `setGoogleReady(false)` plus a `console.warn`,
  and leave `error` alone. **Done naively** — replacing `e.message` with a localized "Google sign-in
  is unavailable" — an honest run loses nothing on screen but the developer loses the only signal
  that GSI is down for a whole population of buyers; the `console.warn` has to survive the change.

### F4 · `MAX_JOB_COST_USD` — the per-job spend ceiling — still cannot be set by a deploy — P2

- where: `infra/deploy.sh:59` (`COMMON_ENV`) against `packages/core/src/config.ts:343`
  (`maxJobCostUsd: float('MAX_JOB_COST_USD', 20)`) and `docs/deployment.md:145`.
- input / observed: R7-31's finding was "documented in `docs/deployment.md` as deployable and were in
  no `--set-env-vars`". `90a355f` closed that for `LLM_GATHER_MAX_OUTPUT_TOKENS` and
  `LLM_GATHER_THINKING_BUDGET`. I diffed the whole documented table against `deploy.sh`: **44 of the
  69 documented variables are still in no `--set-env-vars`.** Most are collection names nobody
  touches, but the list includes `MAX_JOB_COST_USD` (the ceiling that decides whether a job is
  **held** — credits consumed, checkpoint kept, waiting on a human), `LLM_MAX_OUTPUT_TOKENS`,
  `LLM_MODEL_PRO` / `LLM_MODEL_FLASH`, `LLM_MAX_CONCURRENT_AGENTS`, `TRUSTED_PROXY_HOPS`,
  `AUTH_JWT_TTL_SECONDS`, `CHECKOUT_PER_HOUR_PER_USER` and every `PUBLIC_*_PER_HOUR_IP`. Turning any
  of them during an incident requires a code change and a redeploy — and under F1's replace
  semantics, setting one by hand on the service lasts until the next deploy.
- status: **reproduced** (script over `docs/deployment.md` and `infra/deploy.sh`; the money-relevant
  names above were then confirmed by eye in both files).
- refutation attempted: the doc's section header is "Environment variables (from `config.ts`)",
  which is a catalogue rather than a promise — but `deployment.md` *is* the deployment document, and
  `90a355f` used exactly this argument to justify wiring two of them. Applying the standard once and
  not to the ceiling is the inconsistency. There is no Firestore override for `MAX_JOB_COST_USD`;
  `config.ts:343` is the only reader.
- fix sketch: add `MAX_JOB_COST_USD` and the rate-limit knobs to `COMMON_ENV` empty-by-default, on
  the same pattern; or mark the table's rows that are *not* deployable so the doc stops implying
  they are. **Done naively** — adding all 44 — an honest run gets a `--set-env-vars` string long
  enough to be unreadable and a new way to typo a collection name into a fresh empty database.

### F5 · The stated reason for not using `.strict()` is false — the case it names 400s anyway — P2

- where: `packages/core/src/index.ts:236-238` (source comment) and `929e8dd`'s commit message:
  *"Not `.strict()`: that would 400 any client sending any extra key, including tooling that
  round-trips stored params from jobs created before these fields were retired."*
- input / observed: those jobs are precisely the ones whose stored params carry `instructions`.
  Replaying one through `validateRequest`:
  ```
  400  stored params of a pre-7a45269 job, replayed ->
       This model no longer accepts free-text instructions. Reload the page and try again.
  ```
  The non-strict choice buys nothing for the case offered as its justification. It does still buy
  the unrelated-extra-key case (`someFutureField` → `OK`), which is the real reason.
- status: **reproduced** (scratch script against the real `florida-business-for-sale` template).
  Also confirmed, in the same run, that the guard itself is sound and cannot be slipped:
  `instructions: null`, `instructions: ''` and `preferredSources: []` all 400 (`k in sent` catches a
  present-but-empty key), and `paramsSchema.shape` survives `.superRefine()` in Zod 4.4.3 — I
  checked, because in Zod 3 that would have been `undefined` and the `declared` escape hatch dead.
- refutation attempted: I looked for a caller that actually round-trips stored params into
  `POST /research`. There is none — `apps/admin/src/components/NewJobModal.tsx:24-26` builds params
  from `defaultsFor(schema)`, the buyer's SPA builds them from the form, and the worker re-validates
  through `paramsSchema` (not `validateRequest`), so an **admin retry of an old job is unaffected**.
  So this is a wrong rationale, not a live break — which is why it is P2 and not higher.
- fix sketch: correct the sentence in both places to name the case that is actually protected
  (a client sending a key this model has never had), and say plainly that an old job's params cannot
  be replayed as-is. **Done naively** — "fixing" it by allowing `instructions` through for
  round-tripping — an honest run loses the whole point of `929e8dd`: a stale bundle gets its words
  silently dropped and the buyer is charged for a job that never read them.

### F6 · A shrink warning repeats, verbatim and undated, once per dispatch that notices it — P2

- where: `packages/core/src/engine/research-engine.ts:425` (`warnings` seeded from
  `input.resume?.warnings`) and `:707` (the push inside the rewrite loop).
- input / observed: the `at.notes` twin at `:594` carries `new Date().toISOString()`; the `warnings`
  entry does not. `warnings` now rides the checkpoint and is seeded on resume, so an agent whose
  rewrite shrinks the same array on two dispatches leaves two byte-identical lines and the admin
  cannot tell "it happened twice" from "we double-counted it". Bounded (≤ `MAX_JOB_ATTEMPTS` = 8
  dispatches × agents × array fields), so not a growth hazard — a truth hazard. Related, from the
  same read: `snapshot()` at `:855` captures the **same array reference**, so the pushes at `:893`
  and `:958` mutate `checkpoint.warnings` after the snapshot was taken. Harmless on the paths I
  traced (both are on the finalize/held tail), but it is an aliasing waiting to be inherited.
- status: **reasoned** (read, not run — I could not build a two-dispatch fixture that shrinks the
  same field twice inside my time-box).
- fix sketch: timestamp the `warnings` entry like its `notes` twin, or dedupe on push. Take a copy
  in `snapshot()`. **Done naively** — deduping by exact string — an honest run loses the real
  repeat: two shrinks of the same field on two dispatches is worse news than one, and collapsing
  them hides it.

## Claims checked and TRUE (so nobody re-checks)

- **`90a355f` / item 4 — no incident.** `config.ts:12-17` `int()` is
  `const raw = process.env[name]?.trim(); if (!raw) return fallback;` — the empty string is falsy, so
  it never reaches `Number.parseInt`. Ran it with both vars set to `''` (exactly what
  `--set-env-vars K=` yields): `empty string -> 4096 1024`. No 0, no NaN. A garbage value (`'abc'`)
  also falls back; only an explicit `'0'` gives 0, which is a deliberate setting. The `deploy.sh`
  wiring is correct and the two knobs now really are deployable. (The comment at `deploy.sh:39-40`
  reasons via "Cloud Run drops an env var set to the empty string", which I could not verify and
  which does not matter — `int()` reaches the fallback either way.)
- **`b72de29` / item 2 — the redaction holds, and I found no second door.** I walked every surface a
  `JobSummary` or trace field could reach a non-admin by:
  - `GET /research` (inbox, `index.ts:1496-1513`) returns **no `summary` at all**, and gates
    `progress.message` and `cost` on `isAdmin`.
  - `GET /research/:jobId` (`:1552-1559`) reduces to `{notice, sections}`; `security.test.ts` now
    asserts `Object.keys(...).sort()` equals `['notice','sections']`, which is the right shape of
    assertion (a new leaky field reds it).
  - `GET /research/:jobId/report` and `/files/report.json` go through `redactReportForBuyer`
    (`:924-932`), which only strips `meta.cost` — sufficient, because `ReportMeta`
    (`research-engine.ts:66-104`) has no `warnings` and no `agentErrors`; those live only in
    `metadata.json` and `trace.json`, both in `ADMIN_ONLY_FILES` (`:917`) and filtered out of
    `files[]` (`:1602`) as well as 404'd on direct fetch (`:1714`).
  - the read-only share token is minted with `role: 'user'` (`auth/tokens.ts:71`) and path-capped to
    its one job (`api/auth.ts:149-160`), so "view in app" does not hand an admin view to a link
    holder.
  - `clientProgress` (`jobs/types.ts:152-166`) drops `message`, `turnsUsed` and `sourcesFound`, and
    clips `detail` by code point for `searched` only — round 7's `progress.message` hole is closed
    on **both** routes.
  - `job.error` reaches a non-admin, but nothing writes a provider string into it: `markFailed` has
    one caller (`index.ts:1275`, our own fixed sentence) and the held/reject paths write the admin's
    localized decision. Engine exception text goes to `hold.detail`, which is admin-gated.
- **`929e8dd` — the retired-param guard cannot be slipped.** `instructions` / `preferredSources`
  present as `null`, `''` or `[]` all 400; an unrelated extra key still passes; `.shape` survives
  `.superRefine()` in Zod 4.4.3 so a template that legitimately declares one of those names would be
  exempted as intended; an **admin retry of an old job does not go through `validateRequest`** and is
  unaffected. Only the *rationale* is wrong (F5).
- **`60c92a0` — the dead-button scenario I went hunting for does not exist.** `Turnstile.tsx` arms a
  12s `READY_FALLBACK_MS` at mount *and* re-arms it on every `reset()`, and calls `onReady(true)`
  when the script never loaded at all (`:86`, `:115-117`). A misconfigured or blocked Turnstile
  cannot leave the buyer with a permanently disabled submit, with or without the Google button.
- **`6780c94` — `turnsUsed: 0` is not swallowed.** `run-job.ts:521` omits a falsy `turnsUsed`, but a
  stalled loop still carries `gatherStop`, and `Research` (`JobDetail.tsx:51-53`) does
  `turnsUsed ?? 0` whenever `gatherStop` is present — so `0 turns · stalled` in orange does render.
  The `—` case is correctly reserved for an agent with neither. (The one hole is the throw-on-first-
  pass case noted under F2.)

## Commit-message audit

Not a verifier, so I re-ran only what my findings touch:

| claim | source | observed |
|---|---|---|
| suite total 1071 | brief | **1065** here; delta 6, and the brief's "~16 fewer for a clean clone" over-counts — 16 is core's total skips, ten of which are skipped everywhere |
| `6780c94`: "the admin agents table **gained** a Research column" | commit msg | false as written — the header gained a column, the row **swapped** the Tries cell for it (F2) |
| `6780c94`: "admin table drops the Research column · 1 red" | commit msg | plausible for that mutation, but I measured the neighbouring one: **deleting the orphan `Tries` header leaves `apps/admin` 4 passed, green** — the suite cannot distinguish an aligned table from a misaligned one |
| `929e8dd`: "Not `.strict()` … including tooling that round-trips stored params from old jobs" | commit msg + `index.ts:236-238` | false — replaying a pre-`7a45269` job's params 400s regardless (F5) |
| `90a355f`: "empty-by-default so an unset one still means 'the code default'" | commit msg | **true**, measured: `4096 1024` |
| `90a355f`: "documented in `docs/deployment.md` as deployable and were in no `--set-env-vars`" | commit msg | true of those two, and still true of **44 more**, `MAX_JOB_COST_USD` among them (F4) |
