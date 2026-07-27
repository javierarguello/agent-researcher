# Reviewing a request before it costs anything

Between "the user filled in the form" and "we spent credits and tokens" sit two
gates: **moderation** (may this request run at all?) and the **pre-flight
review** (is this the request they meant?). Both run on the cheapest model, both
are on the request path, and both take input the user wrote — which is exactly
the setup where a model can be talked into working for someone else.

The design is built around one rule:

> **No string produced by a model is ever rendered to a user, stored, or fed to
> the research engine.**

Models pick from closed vocabularies. Everything a user reads is copy we wrote.

## The two layers of the pre-flight review

`POST /research/preflight` answers with a review made of two parts.

### Deterministic — always runs, costs nothing

- **The summary.** `template.preflight.describePlan(params, { lang, modeLabel })`
  renders "here's what we'll look for" from the validated params. A pure
  function: identical params → identical sentence, in the user's language, with
  no model involved. See `templates/florida-preflight.ts`.
- **The findings.** Rule predicates over the params (`preflight.rules`) plus a
  generic min-above-max check, each producing an issue **code**.

This layer alone is a complete preview. Everything below is an enhancement.

### Assisted — a bounded ask to the cheap model

`moderation/enrich.ts` sends the params and accepts exactly three things back:

| Field | Output space |
| --- | --- |
| `corrections[]` | `{ field: <enum of whitelisted fields>, value: string }` |
| `issues[]` | codes from the template's declared enum |
| `quality` | `ok` \| `broad` \| `ambiguous` |

A proposed value is then put through five gates before anyone sees it:

1. the field must be on `preflight.correctable` (for the Florida model: only
   `location` and `industry` — never `instructions`, never a number);
2. `sanitizeProposal` strips links, markup and control characters, and truncates
   to the schema's limit;
3. it must not be longer than `max(3×, +24 chars)` of the original — a
   correction expands a little, an appended payload does not;
4. `similarity(from, to) ≥ 0.55` — "maimi dade" → "Miami-Dade County, FL" passes,
   "Austin, Texas" doesn't;
5. the whole params object, with the value applied, must re-validate against the
   template's Zod schema.

What survives is returned **as a diff**, plus a `correctedParams` object. Nothing
is silently rewritten: the user sees `maimi dade → Miami-Dade County, FL` with a
checkbox, and the front submits whichever set they chose.

The summary is then re-rendered from the corrected params — so it describes what
would actually run, still without a word from the model.

### Why this shape

The alternative (ask the model for a nice summary and show it) hands a user's
free text a direct channel to the confirm dialog, to any email that quotes it,
and to the admin panel. Closing the output space costs one design decision and
removes the channel entirely. It also makes the preview translatable, testable,
and free when the model is unavailable.

## Order of operations on `/research/preflight`

```
1. schema            validateRequest (Zod)            → 400        free
2. account state     getUserFlags → blocked?          → 403        1 read
3. allowance         credits + assist attempts        → assist.state
4. moderation        pre-screen  (always)             → 422 / 403  free
                     classifier  (only if allowance)               1 cheap call
5. review            deterministic  (always)                       free
                     assisted       (only if allowance)            1 cheap call
```

Step 3 comes before step 4 deliberately: **both** model-backed passes on this
endpoint sit behind the same allowance. Gating only the assisted review would
have left the classifier running on every preview, so a user could still burn
tokens indefinitely by previewing and never generating.

Skipping the classifier here is safe because `/research` — the call that actually
spends credits — always runs moderation in full. What never gets skipped anywhere
is the deterministic pre-screen: it is free, so it always runs, and it is still
what records strikes and blocks accounts.

## Moderation

`moderation/moderate.ts` runs two passes:

1. **Deterministic pre-screen** — the only thing allowed to reject on its own.
   Every pattern is tested against the *normalized* form (NFKC, invisibles
   stripped, homoglyphs folded) **and** the *squeezed* form (all non-alphanumeric
   removed), so `i‌gnore`, `іgnore` and `i.g.n.o.r.e` are all the same string to it.
2. **LLM classifier** — answers `allowed` plus categories from a fixed enum.
   Fails open on any error: the engine still fences client instructions as
   low-authority (`engine/prompt.ts`).

A rejection increments a strike; at `MODERATION_STRIKE_LIMIT` the account is
blocked. The `blockedReason` written to Firestore is built by `blockReasonFor()`
from the categories — never from the classifier's own words, which would
otherwise let a crafted request write its own text into the admin panel.

## Spending the assisted pass only where it can pay off

The assisted pass costs tokens; it earns them back only when a preview turns into
a report. So it runs when **both** hold:

- the user's balance covers the selected mode (nothing to preview otherwise);
- they haven't used up `PREFLIGHT_ASSIST_ATTEMPTS` (default 3) previews since
  their last generated report.

Exceeding the allowance doesn't error, and doesn't block anything: it starts an
escalating pause (`PREFLIGHT_COOLDOWN_HOURS`, default `1,6,24,72` hours) during
which the review falls back to its deterministic layer, with
`assist.state = "off_cooldown"` and a line explaining it. Generating a report
resets the counter, lifts the pause, and pays back one escalation step.

```
assist.state   on | off_disabled | off_no_credits | off_cooldown
```

## Response shape

```jsonc
{
  "ok": true,
  "summary": "We'll search Florida marketplaces … Filtered to an asking price up to $500,000.",
  "quality": "broad",
  "issues": [{ "code": "no_narrowing_filter", "message": "…", "severity": "info" }],
  "corrections": [{ "field": "location", "from": "maimi dade", "to": "Miami-Dade County, FL" }],
  "correctedParams": { /* submit this to accept the fixes */ },
  "assist": { "state": "on" }
}
```

Token usage stays in the logs, like job cost — it is not returned to clients.

## Adding this to another model

```ts
preflight: {
  assistPrompt: 'a one-line description of what this model delivers',
  correctable: [{ field: 'location', maxLength: 200 }],
  rules: [{ code: 'no_narrowing_filter', when: (p) => !p.maxPrice, severity: 'info' }],
  issueCopy: { my_code: { en: '…', es: '…' } },   // template-specific codes
  describePlan: (p, { lang, modeLabel }) => `…`,   // MUST be pure
}
```

Core issue codes (`missing_subject`, `no_narrowing_filter`, `scope_too_broad`,
`contradictory_range`, `instructions_vague`, `request_ambiguous`) already have
copy in `moderation/copy.ts` in all four languages.

## Testing it

`docs/local-llm.md` — the suite is fully mocked by default; `npm run
test:local-llm` re-runs the assisted pass against a real (deliberately sloppy)
local model and asserts the invariants above still hold.

## Turnstile: proving a human is behind the request

Cloudflare Turnstile sits in front of the flows where a bot costs us money or
tokens. The verification is shared (`core/auth/captcha.ts`) and the binding is a
one-line Fastify preHandler (`apps/api/src/captcha.ts`), so a new app or route
opts in without new logic:

```ts
app.post('/thing', { preHandler: requireCaptcha('my-flow'), schema: {...} }, handler)
```

Three deployment-level switches decide whether a given request must carry a token:

| Switch | Meaning |
| --- | --- |
| `TURNSTILE_SECRET` | Unset ⇒ the whole check is off and nothing changes. |
| `TURNSTILE_FLOWS` | Which flows are enforced (`register`, `login`, `password-reset`, `contact`, `research`, `preflight`). |
| `TURNSTILE_APPS` | Which apps' UIs actually render a widget. |

That last one matters: the admin SPA logs in through the same `/auth/session` and
can create jobs through the same `/research`, and it has no widget. Without the
per-app switch, setting the secret would lock the admins out of their own
dashboard. Admin sessions are exempt for the same reason.

The browser never calls siteverify — the widget hands a token to our API, which
verifies it server-side with the client IP the edge saw, and only `success === true`
lets the request through. Verification fails **closed**: an unreachable Cloudflare
rejects rather than waving traffic past a guard that costs credits.

Tokens are single-use and live ~5 minutes, so each protected call needs its own
solve. In the report flow that means two: one for the pre-flight review and one
for the generation. The client resets the widget after every submission; if the
double solve is unwanted, drop `preflight` from `TURNSTILE_FLOWS` — the assisted
allowance already limits repeated previews on its own.
