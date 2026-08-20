# G3-break — the moderation layer (`29f8593`, `63fd892`, §K in `ff6bc5c`) / BREAK

Measured at **`20f361b`** (`git rev-parse HEAD` = `20f361b531626ac0412475407e0a169f1d4c8570`), fresh worktree,
`npm ci`, `npm test` = **751 + 216 + 22 + 166 + 7 = 1162 passed, 0 failed**, 16 skipped in core and 6 in api —
the brief's clean-worktree number, exactly. Working tree verified clean (`git status --porcelain` empty) after
every mutation below.

## Verdict

The two *measured* claims of `63fd892` are true and reproduce on the nose (70/95 → 61/95 attacks, 2/73 legit
before and after). The *reasoned* claims around them are not. The commit argues that a normalizer which joins
text can only cost a false positive, and then pins exactly one shape of that cost (`jail-break themed escape
room`) with one mechanism (excluding `PADDED_ONLY`); I found **eight new hard-422s in twenty-one probes**, all
absent at `f080011` and present at `20f361b`, in the two vocabularies this product is made of — money
(`Forget everything above 1M`) and escape-room brand names (`Jail-Break: The Escape Room`). The census reports
"No new false positive" because its `money` category has one row exercising the price exemption and that row
uses a `$`. Separately, the third screening form hands an attacker three new ways into a pre-existing cubic
backtracking blowup in the tolerant `disregard` pattern: two inputs that cost **8 ms** at `f080011` cost
**~2–3 seconds of blocked event loop** at `20f361b`, on `/research/preflight`, before any billing. And
`29f8593`'s refusal — correct in principle — is unrecoverable for the one buyer it was written about: a draft
saved on the way to buy credits is restored verbatim, the field is invisible on the form, the message says
"Reload the page and try again", and reloading restores the same draft.

The §K sentence the whole decision rests on is false as written, in two independent ways.

---

## Findings (most severe first)

### F1 · `Forget everything above 1M` is a hard 422 for a paying customer — the digit fold eats the price exemption — P1

- **where:** `packages/core/src/util/text.ts:132-151` (`LEET` / `foldLeet`), consumed at
  `packages/core/src/moderation/moderate.ts:208-211`; the rule it breaks is
  `packages/core/src/moderation/moderate.ts:128`
  `/forget\s+(?:everything|all)\s+(?:above|previous|preceding)\b(?!\s*(?:the|that|a|an)?\s*(?:[$\d]|price|budget|band|range|asking|cost))/i`
- **input / observed** (free-text notes box, via `collectFreeText({ freeText })` exactly as the committed census
  runner drives it):

  | string | `f080011` | `20f361b` |
  |---|---|---|
  | `Forget everything above 1M, that is my ceiling.` | pass | **`prompt_injection`** |
  | `Forget everything above 5M in enterprise value.` | pass | **`prompt_injection`** |
  | `Forget everything above 3M — I cannot finance it.` | pass | **`prompt_injection`** |
  | `Forget everything above 750k, please.` | pass | **`prompt_injection`** |
  | `Forget everything above 40k a month in rent.` | pass | **`prompt_injection`** |
  | `Forget everything above 1M in asking price.` | pass | **`prompt_injection`** |
  | `Forget everything above the $1M asking price.` (the corpus row) | pass | pass |

- **mechanism:** the lookahead's escape hatch is `[$\d]` — the character right after `above` being a digit or a
  dollar sign is what says "this is a price ceiling, not an override". `foldLeet` seeds on a letter neighbour
  and then *spreads along the run*, so `1M → iM`, `5M → sM`, `3M → eM`, `40k → aok`, `750k → tsok`. In the
  deobfuscated form the first character after `above` is a **letter**, the negative lookahead succeeds, and the
  pattern fires. `$1M` survives only because `$` is (deliberately) not in `LEET` and is still there to satisfy
  `[$\d]`. Amounts written without a currency symbol — which is how everybody writes a multiple ("above 1M",
  "under 750k") — have no such shield. Note `1.2M`, `900k`, `2.5M` and `1500000` all still pass: the trigger is
  specifically an amount whose **first** character is one of `0 1 3 4 5 7` and whose run touches a letter. That
  is `1M`–`5M`, i.e. the middle of this product's price band.
- **cost:** `preScreen` is the only layer allowed to reject alone (`moderate.ts:319-320`), so this returns
  `422 params_rejected` before the classifier is asked and before anything is spent. No strike is recorded
  (`index.ts:1004`), so the account is not blocked — but the request is refused and the SPA shows
  `${t.rejected} …` and stops (`NewReport.tsx:729-732`). There is no second opinion and no appeal.
- **status: reproduced.** Differential run of the same 21 probes against `packages/core/src/{util/text.ts,
  moderation/moderate.ts}` restored from `f080011` and then from `20f361b`
  (`scratchpad/round10/g3-break/fp.ts`). Also re-ran the committed census both ways to prove the harness is
  honest: **70/95 at `f080011`, 61/95 at `20f361b`, 2/73 legit both** — the commit's own numbers, confirmed.
- **refutation attempted:** (a) *Is it really new?* Yes — every row above passes at `f080011` with the identical
  script. (b) *Does the classifier rescue it?* No: `moderateResearchParams` returns on the pre-screen hit before
  `llmModerate` is reached. (c) *Is the phrasing contrived?* The census's own `money` category contains
  `Forget everything above the $1M asking price.` — the authors judged that sentence likely enough to pin.
  Dropping the `$` is not a contrivance, it is the commoner spelling. (d) *Is it only the notes box?* The same
  string in `industry`/`location` refuses identically; the notes box is just where prose of this shape lands.
- **fix sketch, measured:** exempt the two rules that carry their own escape hatch from the deobfuscated pass,
  the way `PADDED_ONLY` already is — the price rule (`INJECTION_PATTERNS[3]`) and the jailbreak rule
  (`INJECTION_PATTERNS[7]`, see F2). I ran that mutation:

  ```ts
  // moderate.ts, replacing the loop at 208-211
  for (let i = 0; i < TOLERANT_PATTERNS.length; i++) {
    const re = TOLERANT_PATTERNS[i]!;
    if (re.test(normalized) || re.test(unpadded)) return 'prompt_injection';
    if (i === 3 || i === 7) continue;           // carries a numeric / bare-word exemption
    if (deobfuscated.some((form) => re.test(form))) return 'prompt_injection';
  }
  ```

  **Census after the mutation: 61/95 attacks missed, 2/73 legit refused — unchanged — and all eight new false
  positives gone.** It costs nothing because every `evade-*` row in `corpus-attack.ts:101-112` exercises
  pattern 0 (`ignore … previous … instructions`); none exercises the price rule or the jailbreak rule.
  **What a naive fix loses:** dropping `1`/`5` from `LEET` instead would re-open `1nstructions`, `a11` and
  `sy5tem pr0mpt` — four census rows — and is the wrong knob.

### F2 · a hyphen in an escape room's own name is now a 422; the corpus pins the one spelling that survives — P1

- **where:** `packages/core/src/util/text.ts:114` (`INTRA_WORD_SEPARATOR`) against
  `packages/core/src/moderation/moderate.ts:156`
  `/\bjailbreak\b\s*(?::|mode\b)|\b(?:enable|activate)\s+jailbreak\b|\bjailbreak(?:ing)?\s+(?:the\s+)?(?:model|assistant|ai|bot|llm|system|prompt)\b/i`
- **input / observed:**

  | string | field | `f080011` | `20f361b` |
  |---|---|---|---|
  | `Jail-Break: The Escape Room, Orlando` | industry | pass | **`prompt_injection`** |
  | `The brand is Jail-Break Mode, an escape-room franchise.` | freeText | pass | **`prompt_injection`** |
  | `jail-break the system of locks used in county facilities` | industry | pass | **`prompt_injection`** |
  | `jail-break themed escape room` (the corpus row) | industry | pass | pass |

- **mechanism:** `moderate.ts:203-206` says *"Only THIS list runs against it, never `PADDED_ONLY` below: those
  patterns are bare words, and closing intra-word separators turns 'jail-break themed escape room' … into
  `jailbreak`."* The reasoning is right and the mitigation is aimed at the wrong list. `PADDED_ONLY`'s
  `/\bjailbreak\b/` is not the only near-bare-word rule — `TOLERANT_PATTERNS[7]` fires on `jailbreak` followed
  by nothing but a colon, or by `mode`, or by `the system`. All three are ordinary text for the acquisition
  target the comment names: a colon subtitle in a brand name, a room called "Jail-Break Mode", a locksmith
  describing what he does to a lock system. The corpus row that is supposed to pin this shape
  (`corpus-legit.ts`, `escape` category) uses the one spelling the exclusion actually covers, so the guard reads
  as proven while three-quarters of the rule is uncovered.
- **status: reproduced**, same differential harness as F1.
- **refutation attempted:** (a) *`Jailbreak: The Escape Room` was already refused at `f080011`* — true, and I
  report it as pre-existing. The finding is that `63fd892` extended that pre-existing false positive to the
  hyphenated spelling that the commit went out of its way to protect. (b) *Would a buyer really type a colon?*
  `industry` is 120 characters of free text and the manifest's own placeholder invites a business description;
  "Jail-Break: The Escape Room" is a real naming convention. (c) *Is `jail-break the system` plausible?* It is
  the literal phrase a locksmith/security-hardware seller uses; I kept it as the weakest of the three.
- **fix sketch:** the same `i === 7` exemption as F1, measured at zero census cost. Naive alternative — removing
  `-` from `INTRA_WORD_SEPARATOR` — reds both `evade-hyphen` rows (`Ig-nore …`, `pre-vious instruc-tions`),
  which is exactly what the commit bought.

### F3 · `disregard` + 2 000 punctuation characters blocks the API event loop for ~3 s, and `63fd892` opened two more doors to it — P1

- **where:** `packages/core/src/util/text.ts:204-208` (`GAP = '[^\\p{L}\\p{N}]*'`, `tolerantPattern`) applied to
  `packages/core/src/moderation/moderate.ts:124` — the `disregard` rule has three `\s+`/`\s*` positions with
  optional groups between them, so its tolerant twin is `disregard[^LN]*(?:all[^LN]*)?(?:the|your|any)?[^LN]*
  (?:previous|…|system)?[^LN]*(?:instructions|prompts?)`. Three adjacent star-quantified classes over the same
  characters ⇒ cubic backtracking on a failing match.
- **input / observed** — `preScreen(collectFreeText({ freeText }))`, `freeText` clipped to the endpoint's own
  `maxLength: 2000` (`apps/api/src/index.ts:1348`), one process per row, `20f361b`:

  | free-text box (2 000 chars) | `f080011` | `20f361b` |
  |---|---|---|
  | `disregard` + `.`×2000 | 3 009 ms | 3 255 ms |
  | `d1sregard` + `.`×2000 | **8 ms** | **2 947 ms** |
  | `dis-regard` + `.`×2000 | **9 ms** | **1 907 ms** |
  | three variants sharing one box | 134 ms | 702 ms |

  Scaling on the same shape: 500→57 ms, 1000→457 ms, 1500→1 647 ms, 2000→3 680 ms — cubic.
- **cost:** `/research/preflight` calls `moderateParams` at `apps/api/src/index.ts:1439`, before the assisted
  pass and before anything is billed; Node is single-threaded, so this is ~3 s of **the whole API** stalled per
  request, not 3 s for the caller. The per-user meter is 60/hour (`config.ts:185`), i.e. ~180 s of dead event
  loop per hour per account, linear in accounts. The captcha and the rate limiter run first, so this needs an
  authenticated account — it is not anonymous — but it is one ordinary buyer account.
- **status: reproduced**, `scratchpad/round10/g3-break/perf3.ts`, one row per process to keep JIT state out of
  it; the `f080011` column measured with `packages/core/src/{util/text.ts,moderation/moderate.ts}` restored from
  that commit and then restored back (tree verified clean).
- **refutation attempted:** (a) *Is the blowup `63fd892`'s?* No — the cubic pattern is pre-existing and I say so.
  What `63fd892` adds is reachability: `d1sregard` and `dis-regard` did not touch the pattern at all before,
  because the literal `disregard` was not in the text; the third screening form manufactures it. That is a
  ~370× regression on those two inputs. (b) *Does it cost ordinary traffic anything?* No — I measured 2 000
  characters of realistic hyphen- and domain-heavy buyer notes: 2 deobfuscated forms, **0.52 ms**. The commit's
  "paid for only by input that looks tampered with" holds for cost; it is the *worst case* it does not bound.
  (c) *Is 2 000 reachable?* `industry` (120) and `location` (200) are too short to matter; the free-text box is
  the vector, and `/research` never sees it. So this is `/research/preflight` only. (d) *Is `.` special?* No —
  any run of non-alphanumerics works.
- **fix sketch:** bound the gap (`[^\p{L}\p{N}]{0,4}` instead of `*`) or collapse separator runs to a single
  character before matching, and rewrite `disregard`'s optional groups so two star-classes are never adjacent.
  **What a naive fix loses:** capping the gap at a small number weakens `ignore***…***all` style padding, so
  the change needs the census run both directions before and after — the corpus's `evade-pad` and `evade-space`
  rows are what would go red.

### F4 · a buyer who went to buy credits before 2026-08-19 comes back to a form that 400s forever, with nothing on screen to fix — P1

- **where:** `apps/fbizlab/src/pages/NewReport.tsx:326-344` (draft restore) + `:551-560` (`cleanParams`) against
  `packages/core/src/index.ts:285-290` (`validateRequest`'s `internalParams` refusal)
- **input / observed:** `localStorage['fbizlab_newreport_draft'] = {"params":{"gridRegion":"ERCOT West",
  "keywords":["absentee owner","seller financing"]},"freeText":"…"}` — exactly what `saveDraft`
  (`NewReport.tsx:588-592`) wrote on the way to `/app/credits` one deploy ago. On remount the draft is restored
  **verbatim** (`setParams(saved.params)`; no filtering against the manifest), the manifest no longer declares
  `keywords` so nothing renders it, `cleanParams` drops only `undefined`/`''` so the array survives, and both
  calls carry it:
  - `POST /research/preflight` → 400 `This model does not accept keywords from a client. Reload the page and try again.`
  - `POST /research` → the same 400.
  `validateRequest` triggers on `k in sent`, so `keywords: []` and even `keywords: undefined` throw too (I
  measured all three); only `undefined` is saved by `cleanParams`.
- **why it does not end:** `clearDraft()` runs only after a *successful* `createJob` (`NewReport.tsx:797`).
  Reloading is a fresh mount reading the same key, so the remedy the message names — "Reload the page and try
  again" — restores the identical draft. The value is not on the form, so the buyer cannot see it, edit it or
  delete it. Recovery requires clearing site data. The draft has no TTL, so this is not only "the day it ships":
  any abandoned top-up from before 2026-08-19 is a permanently bricked form.
- **and it costs a second call:** a 400 from `/research/preflight` is not 422/403/429/`captcha_failed`, so it
  falls into the "the review is advisory, generate anyway" branch (`NewReport.tsx:764`) and immediately posts
  `/research`, which 400s too. One click, two failed requests, one consumed captcha token.
- **and it is in English only:** `validateRequest` throws a hardcoded English sentence, `/research` returns it as
  a bare `{error}` with no `code`, and the SPA's last fallback renders `err.message` raw
  (`NewReport.tsx:810`). An es/fr/pt buyer gets an English sentence on a translated page — the same shape as the
  bug the `d.language` comment at `NewReport.tsx:350-353` was written to close.
- **status: reproduced.** Component test driving the real `NewReport` against a post-removal manifest, run in
  `apps/fbizlab` and then deleted (tree clean); source kept at
  `scratchpad/round10/g3-break/g3-draft-internal-param.test.tsx`. Both assertions pass:

  ```ts
  expect(screen.queryByText(/keyword/i), 'nothing on screen names it').toBeNull();
  const pf = hooks.preflight.mock.calls.at(-1)?.[0] as { params: Record<string, unknown> };
  expect(pf.params.keywords, 'POST /research/preflight carries it → 400')
    .toEqual(['absentee owner', 'seller financing']);
  const cj = hooks.createJob.mock.calls.at(-1)?.[0] as { params: Record<string, unknown> };
  expect(cj.params.keywords, 'POST /research carries it → 400')
    .toEqual(['absentee owner', 'seller financing']);
  ```

  The `validateRequest` half is `scratchpad/round10/g3-break/keywords.ts`, run against the shipped
  `florida-business-for-sale`.
- **refutation attempted:** (a) *Does a cached SPA bundle break too?* No — the form is built from the live
  manifest, so an old bundle renders no keywords field and sends none. I checked. The draft is the live case,
  and it is the one `29f8593`'s own message says is live ("Every tab open at this deploy still posts the keywords
  its assist proposed"). (b) *Does the assist re-introduce it?* No — `hasKeywordsField` returns false
  (`enrich.ts:515`) and `mergeProposals` only writes the key when `proposals.keywords.length`
  (`NewReport.tsx:201`). Correctly closed. (c) *Is there any other clear path?* Switching model resets `params`
  (`NewReport.tsx:846`), but the chips only render when `catalog.length > 1`, and there is one model.
  Logout does not touch `DRAFT_KEY`. (d) *Is the refusal itself wrong?* No — R7-8's reasoning is right. The bug
  is that the refusal's own remedy does not work.
- **fix sketch:** on restore, drop any draft key the current manifest does not declare
  (`Object.keys(saved.params).filter((k) => k in (schema.properties ?? {}))`), and keep the API refusal for a
  genuinely wrong client. **What a naive fix loses:** filtering against `schema.properties` also silently drops
  a key the buyer typed into a field that has since been *renamed* — so pair it with keeping the API's loud
  refusal for anything that still reaches it, rather than treating the client filter as the guard.

### F5 · §K's load-bearing sentence is false in two ways, and one of them contradicts §K's own next paragraph — P2

The sentence, in `63fd892`'s message and in `docs/plans/deep-review.md:466-474`:
> *"the buyer's free text reaches a model only when `assist === 'on'`, which is exactly when the LLM classifier
> runs too (`apps/api/src/index.ts:1440`), and `/research` runs it unconditionally. **The pre-screen is never the
> sole layer on a path where a miss reaches a prompt.**"*

- **(a) two independent env flags, not one.** `assist` is gated on `config.validation.llm`
  (`VALIDATION_LLM`, `apps/api/src/index.ts:1408`); the classifier is gated on `config.moderation.llm`
  (`MODERATION_LLM`, `packages/core/src/moderation/moderate.ts:322`). With `MODERATION_LLM=false` and
  `VALIDATION_LLM=true` — an entirely ordinary operational choice, "the classifier is noisy, keep the assist" —
  `assist === 'on'`, the free text reaches `proposeFromText`'s prompt (`preflight.ts:92-93`), and
  `moderateResearchParams` returns clean the moment the pre-screen passes. The pre-screen *is* the sole layer,
  on the path where a miss reaches a prompt. §K's own closing paragraph
  (`deep-review.md:495-500`) then says exactly this — *"`MODERATION_LLM` can be `false` … which is the one
  configuration in which the pre-screen really is the only layer"* — so the section contains its own refutation
  eleven lines below the claim. The commit message drops the caveat entirely and ships the universal.
- **(b) `/research` does not run it unconditionally.** `apps/api/src/index.ts:1182-1185` wraps `moderateParams`
  in `if (req.auth!.role !== 'admin')`. For an admin, **no** layer runs — not the classifier, not the
  pre-screen. On `/research/preflight` the same is true (`index.ts:1403-1441`: steps 1–3, moderation included,
  are all inside `if (req.auth!.role !== 'admin')`), while `assist` stays `'on'`, so an admin's free text goes
  to `proposeFromText` completely unscreened. The comment at `index.ts:1432` — *"The deterministic pre-screen
  always runs"* — is false in the block it sits in.
- **status: reasoned** (code read, exact lines above; both are unconditional `if`s, nothing subtle). I did not
  stand up an admin session to run it.
- **why it matters, and why it is only P2:** the decision §K took (option 1, refocus) is defensible on its other
  two feet — the 61 are semantic, and false positives are the expensive failure. F1 and F2 above are evidence
  *for* the decision, not against it. But fact 1 in the "decided on, in order of weight" list is the one stated
  as a universal, and it is not one. Round 9's rule ("a TRUE measurement written as a universal") applies
  precisely here.
- **refutation attempted:** is an admin a threat model? No, and I do not claim one. The finding is that the
  sentence says "never" and "unconditionally" about code that has two `if`s in it; the honest form is "on the
  default configuration, for a non-admin caller". (b) *Does `/research` need the free text at all?* No — it is
  not sent there, which is why (a) is the sharper half.

---

## Claims checked and TRUE (so nobody re-checks)

- **`70 of 95` before, `61 of 95` after, `2 of 73` legit both** — re-ran the committed runner
  (`npx tsx docs/plans/m-red-team-reports/k-census-2026-08-19/run.ts`) at `20f361b` (61/95, 2/73) and with
  `text.ts`/`moderate.ts` restored from `f080011` (70/95, 2/73). Both figures exact, and the two refused legit
  rows are the two the README names (`Forget the instructions the broker gave me`,
  `Ignora las instrucciones anteriores que le di al corredor`). The per-category evasion table in
  `deep-review.md:449-457` also reproduces: `evade-hyphen 0/2`, `evade-leet 0/2`, `evade-invisible 0/6`,
  `evade-pad 0/1`, `evade-space 0/1`, `evade-homoglyph 0/4`, `evade-split 1/2`.
- **`$` staying out of `LEET` protects `Forget everything above the $1M asking price`** — true for that string.
  It is the generalisation ("this is how buyers write money") that F1 breaks.
- **`hasKeywordsField` and `mergeProposals` agree with the API** — the assist proposes no keywords for a
  template that lists it in `internalParams`, and the client only writes the key when a proposal is non-empty.
  No path from the assist to a 400. Checked both, `enrich.ts:515` and `NewReport.tsx:199-206`.
- **`toManifest` strips both halves** — `hideInternal` (`registry.ts:82-113`) removes the key from
  `properties`, `required`, `ui.fields`, `ui.rows`, `ui.hidden`, `ui.advanced` and `ui.ranges`. A fresh SPA
  renders nothing for it; my component test asserts that directly.
- **The deobfuscated form does *not* break the equipment exemption.** I expected it to: joining `cash-register`
  into `cashregister` should have defeated `(?:\w+\s+){0,2}(?:…|register|…)`. It does not, because
  `tolerantPattern` rewrites that `\s+` to `[^\p{L}\p{N}]*` too, which matches empty, so `\w+` eats `cash` and
  `register` still matches. Verified on `cash-register`, `alarm-panel`, `fuel-dispenser`, `door-lock` — all
  pass. Same for the price exemption's own words (`price-band` still exempt).
- **The extra passes cost ordinary traffic nothing.** 2 000 characters of realistic buyer notes (hyphenated
  business terms, a domain, an email address, `24/7`, `3x SDE`) produce **2** deobfuscated forms and
  **0.52 ms** best-of-30 for the whole `preScreen`.
- **The correction guard's behaviour is unchanged by the third form.** `similarity` (`text.ts:242-251`) reads
  only `.normalized`, and `deobfuscate` does not touch it. It does now compute two `foldLeet` passes per call
  and throw them away — pure waste, bounded by the correction field lengths, so hygiene rather than a finding.
  The widened `INVISIBLE` class *does* reach `similarity` and `sanitizeProposal`; the five added classes
  (hangul fillers, braille blank, CGJ, khmer inherent vowels, mongolian selectors) do not occur in en/es/fr/pt
  proposals, and stripping them can only shorten, which loosens `maxLengthFor` rather than tightening it. No
  behaviour change I could produce.
- **`k in sent` really does mean "an empty array is still a client that has the field"** — measured:
  `keywords: []` and `keywords: undefined` both throw. `cleanParams` deletes `undefined`, so only the array
  form reaches the API from the SPA.

## Commit-message audit — every count I re-ran, claimed vs observed

| claim (`63fd892`) | observed |
|---|---|
| "Measured before the fix: **70 of 95** attacks pass, **2 of 73** ordinary phrasings are refused" | **70 / 95, 2 / 73** — true (re-run with both files restored from `f080011`) |
| "After: **61 of 95** attacks pass, **2 of 73** refused — the same two" | **61 / 95, 2 / 73**, same two rows — true |
| "Every evasion category is at zero except the newline" | true — `evade-split 1/2`, every other `evade-*` at 0 |
| "the same two, both the attribution class the corpus already documents" | true |
| "Suite 1168 passed, 0 failed (main checkout; a clean clone counts 6 fewer)" | my worktree: **1162 passed, 0 failed** = 1168 − 6. Consistent. |
| "`$` is NOT in the leet map … A miss is the cheaper of the two" | **misleading**: the stated protection covers `$1M` and not `1M`/`5M`/`750k`/`40k`. See F1. |
| "closing intra-word separators turns 'jail-break themed escape room' … into `jailbreak`. That row is in the corpus now." | **incomplete**: the row is pinned, three sibling spellings are not. See F2. |
| "It is empty for text that carries neither — most text — so the extra regex passes are paid for only by input that looks tampered with" | true for *cost* (0.52 ms on ordinary notes) — but it is the attacker's input that is tampered with, and that input now reaches a cubic pattern from three directions. See F3. |
| "the buyer's free text reaches a model only when `assist === 'on'` … and `/research` runs it unconditionally. The pre-screen is never the sole layer…" | **false** on both halves. See F5. |
| README + `deep-review.md`: "**No new false positive.**" | **false** — 8 in 21 probes, all reproduced against `f080011`. The claim is true *of the committed corpus*, which is the distinction the sentence does not draw. |

I did not re-run the "6 red / 7 red / 1 red / 2 red" revert-verify counts — those are the verifier's half of this
group and I spent the budget on the four reproductions above.
