# §K census, re-measured 2026-08-19

The 2026-08-03 census (85 injection strings pass / 59 ordinary phrasings refused)
lived in two reviewers' reports that were never committed, so it could not be
re-run against a changed pre-screen. This one is in the repo for exactly that
reason. It is a REBUILT corpus, not a recovery of theirs — the two sets of numbers
are not comparable row by row.

```
npx tsx docs/plans/m-red-team-reports/k-census-2026-08-19/run.ts
```

Prints, per category, how many attack strings PASSED the pre-screen and how many
ordinary business phrasings were REFUSED, then lists each one. It calls the real
`preScreen` through `collectFreeText`, with each string truncated to the bound of
the field it is submitted in (`industry` 120, `location` 200, the free-text box
2000) — `keywords` is not a channel any more (`29f8593`).

Measured in the main checkout:

| | `ec66323` (before) | `HEAD` of the 2026-08-19 fix |
|---|---|---|
| attacks that pass | 70 / 95 | **61 / 95** |
| ordinary phrasings refused | 2 / 73 | **2 / 73** |

Both refusals are the documented attribution class ("forget the instructions THE
broker gave me"), named in `moderation.test.ts` as the accepted price of the
lookahead. The nine that closed were all EVASION — five invisible characters, two
intra-word separators, two digit substitutions — and each has a row in the repo's
own corpus now, so a regression is a red test rather than a re-run of this script.
The 61 that remain are semantic; `deep-review.md` §K is where that decision lives.

One case is deliberately still open: a newline INSIDE a word (`instru\nctions`).
After `\s+` collapse it is two short words, and joining across whitespace is what
turned "county jail. Breakdown of revenue" into a jailbreak.
