# Credits & billing

Credits are the unit users spend to generate reports. The system is **shared**
across every research model and web app, scoped per `(appId, userId)` — each app
keeps its own balance for the same user. Source:
`packages/core/src/credits/{types,store}.ts`, `apps/api/src/{index,stripe}.ts`.

## Data model (Firestore)

Two collections, both keyed for idempotency:

| Collection | Doc id | Shape |
|---|---|---|
| `credit-balances` | `<appId>__<userId>` | `CreditBalance { appId, userId, balance, updatedAt }` — the materialized current balance. |
| `credit-ledger` | deterministic (see below) | `CreditLedgerEntry` — append-only log of every mutation. |

`CreditLedgerEntry`:
```ts
{ id, appId, userId,
  type: 'purchase' | 'consumption' | 'refund' | 'grant',
  credits,              // absolute amount, always positive; `type` gives direction
  plan?, paymentId?, provider?, amountUsd?, currency?,  // purchase (Stripe provenance)
  jobId?,               // consumption / refund
  grantedBy?, reason?,  // manual grant: who issued it + why (audit)
  note?, createdAt }
```

**The plan catalog is NOT in Firestore** — it lives entirely in Stripe (see below).

## Mutations (all transactional & idempotent)

Every mutation runs one Firestore transaction that reads the balance **and** the
ledger entry (idempotency check) before writing both, so balance and log never
diverge. Deterministic ledger ids make each operation replay-safe:

| Function | Ledger id | Semantics |
|---|---|---|
| `grantCredits({appId,userId,credits,grantedBy?,reason?,note?,idempotencyKey?})` | `grant_<idempotencyKey \| random>` | Add free credits (admin/promo). Records `grantedBy`+`reason` for audit; pass `idempotencyKey` to dedupe. |
| `recordPurchase({…, paymentId})` | `purchase_<paymentId>` | Add bought credits; a duplicate webhook is a no-op. |
| `consumeCredits(appId,userId,credits,jobId)` | `consume_<jobId>` | Subtract; throws `InsufficientCreditsError` if balance < credits. One consumption per job. |
| `refundForJob(appId,userId,jobId,note?)` | `refund_<jobId>` | Refund exactly what `consume_<jobId>` took — only if it was consumed and not already refunded. Returns `false` if nothing to do. |

`applyEntry` returns `{ applied, balance }`: `applied === false` means the entry id
already existed (idempotent replay). Absent optional fields are stripped before
writing (Firestore rejects `undefined`).

## How much a report costs — per-model pricing

The credit cost of a report is the chosen **mode's** `credits`, resolved in this
order (`resolveModeCredits`):

1. **Firestore override** — `model-pricing/{templateId}.modes[mode]`, editable
   live via `PUT /admin/pricing/:templateId` (no deploy).
2. **Template default** — the template's own `modes[mode].credits`.
3. **Code default** — `DEFAULT_MODES` (`creditsForMode`): **essential = 5,
   comprehensive = 18** (set to track the real ~1:3.6 compute-cost ratio).

So pricing is **per model** and tunable without shipping code; the code values are
just the fallback. The effective cost is what the client sees in the manifest's
`modes[].credits` (the API overlays the override) and what `POST /research`
charges. Add-on prices live in the same `model-pricing/{templateId}.addons` map.
Purchasable packs still live entirely in Stripe. See
[research-models.md](research-models.md) → Modes.

## Consumption & refund flow

1. `POST /research` resolves the requested mode, computes `creditsForMode`, and
   calls `consumeCredits(appId, userId, cost, jobId)` **before** recording the
   job. Insufficient balance → `402 { error, required, balance }`; nothing is
   enqueued. (Skipped when `APP_ENV=local`.)
2. The job runs in the worker.
3. If the job **fails** (final schema validation fails, or the engine throws),
   `run-job.ts` calls `refundForJob(appId, userId, jobId, 'job failed')`. It is
   idempotent (`refund_<jobId>`) and a no-op if nothing was consumed (e.g. local
   runs). A successful job is **not** refunded.

So the user only pays for reports that complete. The `jobId` ties consume↔refund
together and makes both replay-safe under Cloud Tasks' at-least-once delivery.

## Buying credits — Stripe plans

The plan catalog is defined **in Stripe**, not the codebase (`apps/api/src/stripe.ts`):

- Create a Stripe **Product** + **Price** per pack.
- **Convention (metadata-driven, no lookup_key):** put `metadata.appId = <appId>`,
  `metadata.planId = <planId>`, and `metadata.credits = <n>` on the Price (or
  Product; Price metadata wins on merge).

`StripePlan` resolved from a Price:
`{ planId, name, priceUsd, credits, priceId }`.

- **`listStripePlans(appId)`** — `prices.search` for `active AND
  metadata['appId'] == appId`, sorted by price. Powers `GET /credits/plans`.
- **`resolveStripePlan(appId, planId)`** — `prices.search` for `active AND
  metadata['appId'] == appId AND metadata['planId'] == planId`. Powers checkout.

### Checkout → webhook → grant

1. `POST /credits/checkout { planId, successUrl, cancelUrl }` resolves the plan,
   creates a **hosted** Stripe Checkout session (`mode: 'payment'`,
   `allow_promotion_codes: true`, `client_reference_id = userId`) with
   `metadata { appId, userId, planId, credits }`, and returns
   `{ url, sessionId, credits }`. The frontend redirects to `url`.
2. The user pays on Stripe's hosted page.
3. Stripe calls `POST /credits/webhook`. The handler verifies the
   `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` using the **raw** request
   body (the API keeps `rawBody` on every request for exactly this).
4. On `checkout.session.completed` with the expected metadata, it calls
   `recordPurchase` (idempotent by `payment_intent` id, falling back to the
   session id) with `amountUsd = amount_total/100`. **Only if newly applied**, it
   folds the purchase into per-app stats (`recordPurchaseStats`) — safe under
   at-least-once webhook delivery. Always returns `200 { received: true }`.

If Stripe isn't configured (`STRIPE_SECRET_KEY` unset), `/credits/plans` returns
`{ plans: [] }` and `/credits/checkout` returns `503`.

## Reading balance & history

- `GET /credits/balance` → `{ appId, userId, balance }` (`getBalance`, 0 if none).
- `GET /credits/transactions?limit=&type=` → `{ transactions: [ CreditLedgerEntry… ] }`
  newest-first (`listTransactions`; needs the composite index on
  `(appId, userId, createdAt desc)`, or `(appId, userId, type, createdAt desc)` when
  filtering by `type` — see [deployment.md](deployment.md)).

Admins may target another `appId`/`userId` via query params on both.

## Admin grants (audited)

`POST /admin/credits/grant { appId, userId, credits, reason, idempotencyKey?, note? }`
(admin token) → `grantCredits` then returns `{ granted, applied, grantedBy, balance }`.
**`grantedBy` is taken from the admin token, never the body**, and `reason` is
required — so every manual grant is attributed and explains itself in the ledger,
sitting alongside Stripe purchases (which carry `paymentId`). Filter a user's grants
with `GET /credits/transactions?type=grant`. Admins top up themselves by targeting
their own `appId`/`userId`. Useful for promos, comps, and testing.
