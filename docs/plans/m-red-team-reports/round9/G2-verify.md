# G2-verify — templates, the quote gate and the provider (`1ab2a86`) / VERIFY

Measured in my own worktree at **`a37d5f57f2f4f9f042ba704a6dec96a7b7aa68da`** (the brief's commit), `npm ci` fresh,
`apps/worker` `resolution.test.ts` green (core resolves to THIS worktree). Baseline `npm test` = **1109 passed, 0
failed** (708 core + 215 api + 22 worker + 158 fbizlab + 6 admin), 16 skipped in core — exactly the brief's
clean-worktree number, so no `out/` symlink and the six gated tests did not run. For the suite-total claim only, I
also checked out `1ab2a86` itself and re-ran the whole suite there (then returned to `a37d5f5`). All five mutations
were run at `a37d5f5`; `git diff 1ab2a86 a37d5f5` shows none of the three source files or three test files under
review changed after this commit, so the tree the mutations bite is the tree the commit shipped.

## Verdict

The claim for this group holds, and it holds unusually well: **every one of the five stated mutation counts is
exactly 1 red, every number in the message reconciles, and every factual claim about the flagship that the
`maxLength` decision rests on is true when you walk the real schemas instead of the commit message.** There are
exactly five `maxLength`s in the flagship's 18 section schemas, they are exactly `charts[].title` 160,
`charts[].description` 500, `charts[].labels[]` 80, `charts[].series[].name` 80, `charts[].unit` 8, there is no
other string bound anywhere in a section schema (0 `minLength`, 0 `pattern`), the counts the same file states for
the other families are right too (17 `minItems`, 2 `maxItems`, 0 `minimum`/`maximum`), Zod refuses at exactly
n+1 and accepts at n for all five, and `synthesizeStructured` really does `safeParse` after the call so the
"repair round we can see" is a real code path. `validateTemplate` refuses all four loop-only fields, names the
kind in each message, and the flagship as shipped still returns `[]`. The quote gate's honest cases survive: an
inference with no literal quote still arrives (unticked), and `Hialeah` → `Hialeah, FL` still fills and is still
shown with the buyer's phrase. What I did find is three places where the message's *prose* claims a little more
than the code does — a test title that now says the opposite of its own assertion, "must be a phrase" for a rule
that two filler words still satisfy, and "any word of the value" for a rule that ignores words under three
characters. All P2; none of them changes what a buyer receives today.

## Findings (most severe first)

### F1 · The `maxLength` test's title now states the opposite of the decision it pins — P2

- where: `packages/core/test/red-team/d-attack.test.ts:374` (title) against `:404` (assertion), and `:386-387`
  (the paragraph left standing above the new one).
- input / observed: the test is titled
  `jsonSchemaToGemini forwards every bound the schema declares — array, number AND string — to the decoder`
  while the assertion four lines from the bottom is
  `expect((gem.properties.labels?.items as …)?.maxLength, 'the decoder must not be told where to stop a label').toBeUndefined()`.
  `maxLength` is the only *string* bound in the fixture, so "AND string" is now false in the title of the test
  that pins it being false. The comment above it still ends "…so the half that was kept is dead for the flagship
  and the half that was dropped is the live one" before the new paragraph reverses it — read top-down, the reader
  meets the old conclusion first.
- status: **reproduced** — mutation M5 (re-add `if (typeof base.maxLength === 'number') out.maxLength = …` at
  `gemini-vertex.ts:288`) turns exactly this test red, i.e. the title and the behaviour it guards point in
  opposite directions.
- refutation attempted: the title could be read as scoping "string" to `pattern`, which IS forwarded and IS
  asserted at `:407`. But the fixture's only string bound is `maxLength` and `pattern` is tested on a second,
  separately-built schema, so the sentence does not survive that reading either.
- fix sketch: retitle to something like `…forwards every array and number bound, and withholds maxLength on
  purpose`, and fold the pre-R8-21 conclusion sentence into the new paragraph so the file reads in one direction.
  No honest run loses anything — this is a title and a comment.

### F2 · "A DIRECTIVE's quote must now be a phrase to tick" — two filler words of any length still tick — P2

- where: `packages/core/src/moderation/enrich.ts:299`
  `const isEvidence = (q) => q.trim().length >= QUOTE_TICK_MIN_LEN || /\s/.test(q.trim());`
- input / observed (mock tier, `acceptProposals` direct):
  - text `Looking for a laundromat in Miami that runs itself, up to 500k.`, proposal
    `{ riskAppetite: { value: 'opportunistic', quote: 'for a' } }` → `directives.riskAppetite = 'opportunistic'`,
    **`quotes.riskAppetite = 'for a'`** → `NewReport.tsx:183` pre-ticks it and `:1098` shows «for a» as the
    buyer's own words. Same for `'up to'`.
  - Spanish, text `Busco una lavandería en Hialeah que se maneje sola.`, quote `'que se'` → ticked.
  - The reported case is genuinely closed: `'una'` and `'sale'` (single words, <8) now arrive unticked.
- status: **reproduced** (script `edges.ts` / `en-filler.ts` in my scratchpad; both call the shipped
  `acceptProposals` with the real flagship template).
- refutation attempted: (a) the rule the message states — "8+ characters or more than one word" — is *exactly*
  what the code does, so this is not a false statement of the rule, only of the word "phrase" and of the
  rationale, whose own filler list (`una`, `the`, `for`, `sale`) is one space away from passing. (b) I tried to
  find an honest quote the whitespace branch is needed for: a two-word quote under 8 characters that a real
  buyer's note would produce as evidence. Every honest example I built ("en Hialeah" 10, "que se maneje sola" 18,
  "lavandería" 10) clears the length rule on its own. The branch appears to buy only the hole. (c) the four
  supported languages are all space-separated, so no CJK counter-case applies.
- fix sketch: `tokens(q).filter(t => t.length >= 3).length >= 2 || q.length >= 8`. Honest loss: I could not
  construct one; a two-word quote whose both words are under three characters is not evidence in en/es/fr/pt.

### F3 · "Any word of the value … is enough of an anchor" — words under 3 characters are not, and a cross-language normalisation is dropped outright — P2

- where: `packages/core/src/moderation/enrich.ts:313-317` `quoteNames()`, the `.filter((t) => t.length >= 3)`.
- input / observed:
  - text `I want a laundromat in FL, budget 500k.`, basic `{ location: { value: 'FL', quote: 'in FL' } }` →
    `basics.location` **undefined**. `flatten('FL')` yields one token of length 2, it is filtered out,
    `tokens.length > 0` fails, and the buyer's literal word is refused as evidence for itself.
  - text `Busco una lavandería en el área de Cayo Hueso, presupuesto 500k.`, basic
    `{ location: { value: 'Key West, FL', quote: 'Cayo Hueso' } }` → **undefined**. The exonym→English
    normalisation the feature exists to do is dropped for a Spanish buyer; `Cayo Hueso, FL` (same quote) is kept.
  - The control the message names does hold: fr `comté de Miami-Dade` → `Miami-Dade County, FL` survives.
- status: **reproduced** (`edges.ts`).
- refutation attempted, and it half-succeeds: lowering the filter to 2 would re-open the exact case R8-26 closed —
  `{ value: 'Orlando, FL', quote: 'en FL' }` would anchor on `fl`. So the ≥3 filter is doing real work and the
  design is defensible; what is not exact is the sentence "Any word of the value that the quote also contains is
  enough of an anchor", in both the commit message and the doc comment at `enrich.ts:308-310`. And because for a
  BASIC the quote is a hard gate (`if (!quoteNames(said, v)) continue;`), the buyer loses the *fill*, not just the
  tick. Severity stays P2: `location` is the only `fillable` field today (`florida-preflight.ts:150`), a basic is
  never pre-ticked anyway (`NewReport.tsx:185` sets `basic:*` to `false`), and the buyer can type it.
- fix sketch: keep ≥3 as the anchor, and add "or the quote contains the whole flattened value" as a second lane,
  which admits `FL`/`in FL` without admitting `Orlando, FL`/`en FL`. Naive fix (drop to ≥2) re-opens R8-26. Say
  "any word of three characters or more" in both places either way.

## Claims checked and TRUE (so nobody re-checks)

**The flagship's bounds** — walked with `z.toJSONSchema()` over all 18 registered section schemas of
`florida-business-for-sale` (the only template in `registry.ts:8-10`), recursing into `properties`, `items`,
`anyOf`/`oneOf`/`allOf` and `$defs`:

- **exactly five `maxLength`, and no other string bound anywhere in a section schema.** They are
  `charts[].title = 160`, `charts[].description = 500`, `charts[].labels[] = 80`, `charts[].series[].name = 80`,
  `charts[].unit = 8` — the five the message lists, at the five values it lists, all from `chartSchema`
  (`packages/core/src/templates/chart.ts:12-27`), i.e. all buyer-visible chart copy. **TRUE.**
- **`minLength`: 0. `pattern`: 0.** "Both dead for the flagship" — **TRUE**. `grep -rn '\.regex('` over
  `packages/core/src` and `apps/*/src` returns exactly one hit: the comment that says there are none. The only
  `.min()` on a string in `packages/core/src/templates` is `keywords: z.array(z.string().trim().min(1)…)` at
  `florida-business-for-sale.ts:409`, which is the **params** schema, never a section schema and never forwarded
  to a decoder — so "no `.min()` on a section string" is exact.
- the same comment's other counts, re-measured independently rather than read back: **17 `minItems`, 2 `maxItems`,
  0 `minimum`, 0 `maximum`.** **TRUE.**
- **no sixth bound elsewhere on the forward path.** `jsonSchemaToGemini` is reached only via
  `gemini-vertex.ts:60` ← `opts.responseSchema`, whose producers are `synthesize.ts:94` (section schemas),
  `headline.ts:18` (`HeadlineSchema` — its limits are prose in `.describe()`, no `.max()`),
  `moderate.ts:229` and `enrich.ts:120/416` (hand-built JSON, no string bounds). The agent's response schema
  extends the section subset with `HANDOFF_KEY`, explicitly `// No .max() here on purpose`
  (`research-engine.ts:1098-1104`). **TRUE.**
- **"Zod enforces every one of them either way."** Parsed the real `chartSchema` at each bound: 161/501/81/81/9
  → `success=false`; 160/500/80/80/8 → `success=true`. Five for five. And production really does re-check:
  `synthesize.ts:131` `schema.safeParse(parsed)`, with one repair round and then `StructuredOutputError`. **TRUE.**
- **`maxLength` is genuinely no longer forwarded and `pattern` genuinely still is.** `gemini-vertex.ts:288`
  forwards `pattern`; there is no `maxLength` assignment left. **TRUE.**

**The `pattern` trap** — "Gemini's is RE2 and zod emits ECMA-262, so a lookahead would be forwarded and rejected
by the API rather than by us":

- the zod half is **TRUE and stronger than stated**. `zod@4.4.3` `toJSONSchema` emits the raw ECMA-262 source and
  `jsonSchemaToGemini` forwards it byte for byte: `/^(?=.*\d)[A-Z]+$/` → `"^(?=.*\\d)[A-Z]+$"`, `(a)\1` → kept,
  `(?<x>a)b` → kept. Nothing throws or warns. Notably **`z.email()` alone emits two lookaheads**
  (`^(?!\.)(?!.*\.\.)…`) — the trap is one plausible field away, not a hypothetical.
- the RE2 half is **not verifiable from this repo and I am not claiming it false**: the installed
  `@google/genai@1.52.0` types document `pattern` only as "a regular expression that the string must match"
  (`dist/genai.d.ts:9701`), with no engine named, and whether the API rejects or ignores an unsupported construct
  is a paid-tier question. The comment is a warning, correctly framed as one.

**The validator (R8-20)** — ran `validateTemplate` over a mutated flagship:

- all four fields refused on an agent with no loop, each in its own message, **each naming the kind**:
  `writer "chart-analyst" declares \`sites\`, and it becomes SUGGESTED SOURCES in the research kickoff — an agent
  with no research loop never reads it. …`, and the same shape for `focus`, `researchBudget`, `gatherModel`;
  `refiner "chart-refiner"` for the enriching agent. Falsy-but-present values (`sites: []`, `researchBudget: 0`,
  `focus: ''`) are caught too — the guard tests `=== undefined`, not truthiness. **TRUE.**
- **the flagship as shipped returns `[]`.** **TRUE** (and `assertTemplatesValid` runs at module load, so a
  regression here is a hard boot failure, not a test-only one).
- "the loop is the only reader of" all four: `focus` → `prompt.ts:572` (`buildAgentKickoff`, producer-only);
  `sites` → `effectiveSites` (`research-engine.ts:1236`) whose single caller is `:1124`; `researchBudget` → `:1123`;
  `gatherModel` → `:1122` and `:615`, both inside `if (hasResearchLoop(agent))` / a `hasResearchLoop` ternary.
  `hasResearchLoop` is `role === 'producer'` (`types.ts:60`). **TRUE.**
- "`sites` becomes 'SUGGESTED SOURCES (additive …)' in the kickoff" — verbatim at `prompt.ts:574`. **TRUE.**

**The quote gate (R8-26)** — all run through the shipped `acceptProposals` with the real template:

- `"que se maneje sola"` → `absentee` **with no quote at all** still arrives: `directives.ownerInvolvement =
  'absentee'`, `quotes.ownerInvolvement = undefined` (unticked). **TRUE** — the honest inference lane is intact.
- the same with the literal 18-char phrase as the quote is still ticked. **TRUE.**
- `Hialeah` → `Hialeah, FL` still fills: quote `'lavandería en Hialeah'` → `basics.location = 'Hialeah, FL'`,
  `quotes.location = 'lavandería en Hialeah'`; and a bare `'Hialeah'` (7 chars, one word) also fills — the
  8-character rule is directive-only, as the message says. **TRUE.**
- `{ location: 'Orlando, FL', quote: 'una' }` is refused, value and quote both. **TRUE.**
- "the client ticks anything that arrives with a quote": `apps/fbizlab/src/pages/NewReport.tsx:183`
  `out[k] = !!proposals.quotes?.[k]` for every directive. **TRUE.** And the basics half is shown, not ticked
  (`:185` `out['basic:'+f] = false`), with «quote» rendered at `:1153` — which is precisely the "«una» shown as
  the evidence for Orlando" harm the message describes.
- `QUOTE_MIN_LEN`'s existing comment really does read "Shorter than this and a \"quote\" matches almost any text
  by accident" (`enrich.ts:287`). **TRUE.**

**`npm run typecheck`** — clean across all five workspaces. **TRUE.**

## Commit-message audit (verifiers only): every count I re-ran, claimed vs observed

Every mutation was applied with `perl -0pi`, **grep-verified to have actually matched**, run through a full
`npm test` from the worktree root, then reverted and `git diff --stat` confirmed empty before the next one.
"Red" counts failing TESTS; core fails first, so api/worker/fbizlab/admin never ran in the red runs — as the
brief warns, I counted the red and ignored the passed.

| # | Message says | I observed | Verdict |
|---|---|---|---|
| M1 | the validator forgets `sites` — **1 red** | **1 red**, 1 file. `templates.test.ts > …and refuses the other three loop-only fields for the same reason (R8-20)` | **TRUE** |
| M2 | the validator forgets `focus` — **1 red** *(the original guard still bites)* | **1 red**, 1 file. `templates.test.ts > the validator refuses one, and names the kind so the author knows why` — i.e. the pre-existing R7-18 test, exactly as the parenthetical claims | **TRUE** |
| M3 | tick threshold back to 3 characters — **1 red** (`QUOTE_TICK_MIN_LEN` 8→3) | **1 red**, 1 file. `preflight-proposals.test.ts > … > a filler word is not evidence — three characters ticked a directive by default (R8-26)` | **TRUE** |
| M4 | a basic accepts any verbatim quote — **1 red** (delete `if (!quoteNames(said, v)) continue;`) | **1 red**, 1 file. `preflight-proposals.test.ts > a basic must be quoted by something that names it (R8-26) > refuses a location from anywhere on earth carried by a three-letter quote` | **TRUE** |
| M5 | `maxLength` forwarded again — **1 red** (re-add the forward at `gemini-vertex.ts:288`) | **1 red**, 1 file. `red-team/d-attack.test.ts > D1 · … > jsonSchemaToGemini forwards every bound …` (see F1 — the title) | **TRUE** |
| — | `npm test`, **main checkout: 1113 passed, 0 failed (713 + 215 + 22 + 158 + 5)** | Not measurable here (no `out/`). Measured **at `1ab2a86`, clean worktree: 1107** = 707 core + 215 + 22 + 158 + 5, 0 failed | **TRUE** — the split reconciles: 707 + 6 gated = 713, and all six gated tests are in core (`red-team/d-legit.test.ts:623`, `refute-b1.test.ts:163`, `refute-B2.test.ts:58` — every `skipIf` on `out/*/trace.json` is under `packages/core/test/red-team/`) |
| — | **Clean clone: 6 fewer** (⇒ 1107) | **1107** measured at `1ab2a86` | **TRUE** |
| — | **up from 1109** | `0250063`'s message states 1109 main (709 core). This commit adds exactly **4** core tests — 1 in `templates.test.ts`, 1 in the existing quote `describe`, 2 in the new basics `describe` — 709 + 4 = 713 | **TRUE** (reconciled by count; I did not re-run the predecessor) |
| — | `npm run typecheck` clean | clean, all five workspaces | **TRUE** |
| — | (in-file) "Over the real Florida sections: 17 `minItems`, 2 `maxItems`, 5 `maxLength`, zero `minimum`/`maximum`" (`d-attack.test.ts:385-386`) | 17 / 2 / 5 / 0 / 0, measured by walking all 18 section schemas | **TRUE** |
| — | brief's own baseline: **1109** clean at the batch tip | 1109 at `a37d5f5` (708 + 215 + 22 + 158 + 6), 0 failed, 16 skipped in core | **TRUE** |

Zero wrong numbers in this message. For contrast with round 8's audit — 14 of 22 messages carried a wrong suite
total — this one's arithmetic is internally consistent *and* survives an independent re-measurement of the clean
half.

`git status --porcelain` and `git diff` are empty; the only file I added is this report. Nothing committed,
nothing pushed. Scratch scripts (`mut.sh`, `audit-bounds.ts`, `zod-enforce.ts`, `pattern.ts`, `quote-gate.ts`,
`edges.ts`, `en-filler.ts`, `validate-msgs.ts`, five full-suite logs) are in
`…/scratchpad/r9-G2-verify/` and nowhere else.
