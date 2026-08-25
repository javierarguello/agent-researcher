/**
 * Stripe client for the shared credits API. Lives in the shared research API
 * (not in any web app) so every product reuses one billing integration and the
 * Stripe keys stay in one place. Hosted Checkout (redirect) — no publishable key
 * needed here.
 */
import Stripe from 'stripe';
import { config, logEvent, SUPPORTED_LANGS } from '@agent-researcher/core';

let client: Stripe | undefined;

export function stripeConfigured(): boolean {
  return !!config.stripe.secretKey;
}

export function stripe(): Stripe {
  if (!config.stripe.secretKey) throw new Error('STRIPE_SECRET_KEY is not configured.');
  if (!client) client = new Stripe(config.stripe.secretKey);
  return client;
}

/**
 * A plan resolved from Stripe (the catalog lives entirely in Stripe — no
 * Firestore). Convention: **the catalog metadata always lives on the PRODUCT**
 * (`appId=<appId>`, `credits=<n>`, optional `planId=<planId>` + marketing). A
 * product may have several Prices but exactly one **default price**, which is the
 * amount we charge and list. The app owns a product when its metadata `appId`
 * matches; `planId` (or, if absent, the product id) selects the specific pack.
 */
export interface StripePlan {
  planId: string;
  /**
   * The research model this pack is sold FOR, written by the system.
   *
   * Absent means "every model this app offers", which is what every pack created
   * before this field is — they are not broken and must keep selling. A pack that
   * names a model is listed only for it, which is also what makes a model's credit
   * FLOOR honest: the ceiling for a model derives from the cheapest credit that
   * model is actually sold at, not from the cheapest credit anywhere in the app.
   */
  templateId?: string;
  name: string;
  priceUsd: number;
  credits: number;
  priceId: string;
  /** Billing interval when the default price is recurring, e.g. 'month'. */
  interval?: string;
  /** Marketing metadata (all optional, from Product metadata). */
  sub?: string;
  popular?: boolean;
  features?: string[];
  /**
   * The marketing copy in EVERY language, for an editor rather than a renderer.
   *
   * `sub`/`features` above are one language — resolved with the English fallback,
   * which is right for a page and wrong for a form: an editor shown the fallback
   * cannot tell "no French copy" from "French copy identical to English", and
   * saving would write the fallback in as a translation. Only the admin listing
   * asks for this.
   */
  copy?: { sub: Record<string, string>; features: Record<string, string[]> };
}

/** Every locale's copy, straight off the metadata — no fallback applied. */
function copyOf(md: Record<string, string>): NonNullable<StripePlan['copy']> {
  const sub: Record<string, string> = {};
  const features: Record<string, string[]> = {};
  for (const lang of SUPPORTED_LANGS) {
    const sKey = lang === BASE_LANG ? 'sub' : `sub_${lang}`;
    const fKey = lang === BASE_LANG ? 'features' : `features_${lang}`;
    if (md[sKey]) sub[lang] = md[sKey]!;
    if (md[fKey]) features[lang] = md[fKey]!.split('|').map((f) => f.trim()).filter(Boolean);
  }
  return { sub, features };
}

/**
 * Localized marketing. Stripe has no native per-language `description`, so we keep
 * per-locale copy in PRODUCT metadata under suffixed keys: `sub_es`, `features_fr`,
 * … (pipe-separated for features). The base `sub`/`features` (and the native
 * `description`) are the English/default fallback. Pass `lang` to pick a locale.
 */
const BASE_LANG = 'en';

function localized(md: Record<string, string>, base: string, lang: string): string | undefined {
  return md[`${base}_${lang}`] ?? md[base] ?? undefined;
}

/** Build a plan from a product + its resolved default price, in `lang`. */
function planFromProduct(product: Stripe.Product, price: Stripe.Price, lang: string, withCopy = false): StripePlan {
  const md = product.metadata ?? {};
  const planId = String(md.planId ?? product.id);
  const sub = localized(md, 'sub', lang) ?? product.description ?? undefined;
  const features = localized(md, 'features', lang);
  return {
    planId,
    ...(md.templateId ? { templateId: String(md.templateId) } : {}),
    name: localized(md, 'name', lang) ?? product.name,
    priceUsd: (price.unit_amount ?? 0) / 100,
    credits: Number(md.credits ?? 0),
    priceId: price.id,
    ...(price.recurring?.interval ? { interval: price.recurring.interval } : {}),
    ...(sub ? { sub } : {}),
    ...(md.popular === 'true' ? { popular: true } : {}),
    // Features: pipe-separated, e.g. "≈4 reports|Basic ROI|…"
    ...(features ? { features: features.split('|').map((f) => f.trim()).filter(Boolean) } : {}),
    ...(withCopy ? { copy: copyOf(md) } : {}),
  };
}

/**
 * All plans for an app — Stripe **products** tagged with metadata.appId == appId,
 * each represented by its default price, localized to `lang`. Products without a
 * default price are skipped (not purchasable).
 */
/**
 * App ids are slugs (see the `apps` registry). Anything else is refused rather
 * than escaped: `appId` is interpolated into Stripe's search DSL, where a stray
 * quote breaks out of the literal, and validating against the shape we actually
 * use is a stronger guarantee than trusting an escape routine to match Stripe's
 * grammar.
 */
// Deliberately looser than the creation schema, which refuses `_`: apps created
// before that rule must stay billable. New ones cannot be made with an underscore,
// so this only ever matches what already exists.
const APP_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export function isValidAppId(appId: string): boolean {
  return APP_ID_RE.test(appId);
}

/**
 * Plan ids are slugs, for exactly the reason above and on exactly the same line:
 * `findProduct` builds ONE query out of BOTH ids, and only the first was guarded
 * (round 11, `money-2`). The route schemas capped `planId` at 128 characters and
 * checked nothing else, and the New-pack modal accepts any characters at all.
 *
 * The likelier failure is not an attack — this is behind `requireAdmin`, and an
 * admin may already write any app's catalog, so a crafted id grants no new
 * capability. It is a pack called `bob's-pack`:
 *
 *   - an UNBALANCED quote malforms the search, so save and archive 500;
 *   - a BALANCED one is worse, because nothing errors. The search matches nothing,
 *     the existence check therefore says "new", and a second live buyer-visible
 *     product is created whose stored planId that same query can never find again
 *     — uneditable and unarchivable through the API, dashboard-only to recover.
 *
 * Same shape as APP_ID_RE, which every id the storefront actually sells already
 * satisfies (`scout`, `investor`, `syndicate`, and `legacy` from before them).
 */
export function isValidPlanId(planId: string): boolean {
  return APP_ID_RE.test(planId);
}

export async function listStripePlans(
  appId: string,
  lang = 'en',
  opts: { templateId?: string; withCopy?: boolean } = {},
): Promise<StripePlan[]> {
  if (!isValidAppId(appId)) {
    // Returning [] silently would show an empty pricing page with nothing in the
    // logs to explain it.
    logEvent({ jobId: '-', appId }, 'WARNING', 'stripe.invalid_app_id', {});
    return [];
  }
  const res = await stripe().products.search({
    query: `active:'true' AND metadata['appId']:'${appId}'`,
    expand: ['data.default_price'],
    limit: 50,
  });
  return res.data
    .filter((p) => p.default_price && typeof p.default_price === 'object')
    .map((p) => planFromProduct(p, p.default_price as Stripe.Price, lang, opts.withCopy))
    // A pack with no `templateId` predates the field and sells for every model the
    // app offers — dropping those would empty the pricing page of every deployment
    // that has ever taken money. One that names a model is listed only for it.
    .filter((p) => !opts.templateId || !p.templateId || p.templateId === opts.templateId)
    .sort((a, b) => a.priceUsd - b.priceUsd);
}

/**
 * Resolve one plan by its `planId` (product metadata `planId`, or the product id
 * as fallback). Reuses the product search so resolution and listing never drift.
 */
export async function resolveStripePlan(appId: string, planId: string): Promise<StripePlan | undefined> {
  const plans = await listStripePlans(appId);
  return plans.find((p) => p.planId === planId);
}

// --- Writing the catalog ----------------------------------------------------

/**
 * A plan as the ADMIN edits it. Everything the system needs to run — `appId`,
 * `planId`, `credits` — is written into Product metadata by `upsertStripePlan`,
 * never by a person in the Stripe dashboard.
 *
 * That is the whole reason this write path exists. The catalog stays in Stripe
 * (its reporting, its refunds, its review), but the fields the PRODUCT depends on
 * stop being hand-typed: a pack created with `credits` missing, or `appId`
 * misspelt, is a pack that takes someone's money and grants nothing — and it is
 * invisible until it does, because a product with bad metadata simply does not
 * appear in `listStripePlans`.
 */
export interface PlanWrite {
  /** Stable slug; the key every session, webhook and stat is attributed by. */
  planId: string;
  name: string;
  credits: number;
  priceUsd: number;
  popular?: boolean;
  /** Marketing copy, per locale: `{ en: '…', es: '…' }`. `en` is the fallback. */
  sub?: Record<string, string>;
  features?: Record<string, string[]>;
}

/** The product for an app's plan, or undefined. Searched the same way listing does. */
async function findProduct(appId: string, planId: string): Promise<Stripe.Product | undefined> {
  // Refused at the interpolation itself, not only at the route schema. The schemas
  // are the first line and answer 400 before Stripe is reached; this is the one
  // that cannot be bypassed by a future caller that forgets, and it throws rather
  // than returning undefined because undefined here MEANS "no such pack" and would
  // send `upsertStripePlan` on to create a duplicate.
  if (!isValidAppId(appId) || !isValidPlanId(planId)) {
    throw new Error(`Refusing to search Stripe with an unsafe id (appId=${JSON.stringify(appId)}, planId=${JSON.stringify(planId)}).`);
  }
  const res = await stripe().products.search({
    query: `active:'true' AND metadata['appId']:'${appId}' AND metadata['planId']:'${planId}'`,
    expand: ['data.default_price'],
    limit: 2,
  });
  return res.data[0];
}

/** Marketing copy → the suffixed metadata keys `localized()` reads back. */
function marketingMetadata(input: PlanWrite): Record<string, string> {
  const md: Record<string, string> = {};
  for (const [lang, text] of Object.entries(input.sub ?? {})) md[lang === 'en' ? 'sub' : `sub_${lang}`] = text;
  for (const [lang, list] of Object.entries(input.features ?? {})) {
    md[lang === 'en' ? 'features' : `features_${lang}`] = list.join('|');
  }
  return md;
}

/**
 * Create or update one credit pack, in whichever Stripe account this deployment
 * holds a key for — dev writes the sandbox, prod writes live, and neither can
 * reach the other because the API only ever has its own `STRIPE_SECRET_KEY`.
 *
 * **A price is never edited.** Stripe Prices are immutable by design, so changing
 * an amount means creating a new Price and repointing the product's
 * `default_price`. The old Price is left ACTIVE rather than archived: a checkout
 * link someone is holding, or a session opened seconds ago, still resolves — and
 * the amount they were quoted is the amount they pay. Only the default moves.
 *
 * `templateId` goes into the metadata with the rest: packs are per research model,
 * and the system writes that too — a pack tagged for the wrong model is one that
 * quietly disappears from a pricing page, or quietly appears on the wrong one.
 *
 * `expectedPriceUsd` is the confirmation, enforced here rather than in the UI. It
 * must match what Stripe currently charges before an amount may change, which
 * makes it both "yes, I meant to reprice" and a guard against two admins editing
 * the same pack from different screens.
 */
export async function upsertStripePlan(
  appId: string,
  templateId: string,
  input: PlanWrite,
  opts: { expectedPriceUsd?: number } = {},
): Promise<{ plan: StripePlan; priceChanged: boolean; previousPriceUsd: number | null }> {
  const metadata = {
    appId,
    templateId,
    planId: input.planId,
    credits: String(input.credits),
    popular: String(!!input.popular),
    ...marketingMetadata(input),
  };
  const existing = await findProduct(appId, input.planId);
  const unitAmount = Math.round(input.priceUsd * 100);

  if (!existing) {
    const product = await stripe().products.create({ name: input.name, metadata });
    const price = await stripe().prices.create({ product: product.id, currency: 'usd', unit_amount: unitAmount });
    const updated = await stripe().products.update(product.id, { default_price: price.id });
    return { plan: planFromProduct(updated, price, BASE_LANG), priceChanged: false, previousPriceUsd: null };
  }

  const current = existing.default_price as Stripe.Price | null;
  const currentUsd = (current?.unit_amount ?? 0) / 100;
  const priceChanged = !!current && current.unit_amount !== unitAmount;

  if (priceChanged) {
    // The confirmation. Refused rather than applied-and-logged: this is the number
    // a customer is charged, and the cost of asking twice is nothing next to the
    // cost of a silent zero.
    if (opts.expectedPriceUsd === undefined) {
      throw Object.assign(new Error(`Changing the price of "${input.planId}" needs expectedPriceUsd (it is currently ${currentUsd}).`), { statusCode: 428 });
    }
    if (Math.abs(opts.expectedPriceUsd - currentUsd) > 0.0001) {
      throw Object.assign(
        new Error(`"${input.planId}" now costs ${currentUsd}, not the ${opts.expectedPriceUsd} you were shown — someone changed it. Reload and try again.`),
        { statusCode: 409 },
      );
    }
  }

  // Stripe MERGES product metadata per key — a key is deleted only by posting an
  // empty string for it. So the localized marketing keys this write no longer
  // carries have to be cleared BY NAME, or they survive on the product forever.
  //
  // The case, measured: an admin deletes the Spanish subtitle (say it still
  // promises "≈4 reports" after a reprice halved the credits). The admin UI strips
  // emptied locales before sending, `marketingMetadata` omits what it is not given,
  // the save returns 200 — and `sub_es` is still on the product, still rendering to
  // every Spanish buyer, and back in the editor on the next open. Withdrawn
  // marketing copy that cannot be withdrawn.
  //
  // Only OUR keys, matched by the shape this file writes. A key a person added by
  // hand in the Stripe dashboard is not ours to delete, and the system keys
  // (`appId`, `credits`, …) are in `metadata` on every write anyway.
  const OURS = /^(sub|features)(_[a-z]{2})?$/;
  const cleared: Record<string, string> = {};
  for (const k of Object.keys(existing.metadata ?? {})) {
    if (OURS.test(k) && !(k in metadata)) cleared[k] = '';
  }
  await stripe().products.update(existing.id, { name: input.name, metadata: { ...metadata, ...cleared } });
  const price = priceChanged || !current
    ? await stripe().prices.create({ product: existing.id, currency: 'usd', unit_amount: unitAmount })
    : current;
  if (priceChanged || !current) await stripe().products.update(existing.id, { default_price: price.id });

  const product = (await stripe().products.retrieve(existing.id, { expand: ['default_price'] })) as Stripe.Product;
  logEvent({ jobId: '-', appId }, 'INFO', 'stripe.plan_upserted', {
    planId: input.planId, priceChanged, from: priceChanged ? currentUsd : undefined, to: input.priceUsd, credits: input.credits,
  });
  return {
    plan: planFromProduct(product, (product.default_price as Stripe.Price) ?? price, BASE_LANG),
    priceChanged,
    previousPriceUsd: priceChanged ? currentUsd : null,
  };
}

/**
 * Retire a pack: `active: false` on the product, so it stops being listed and
 * stops being purchasable.
 *
 * Not a delete. Stripe keeps the payments, the sessions and the reporting attached
 * to it, and a deleted product would orphan every one of them.
 */
export async function archiveStripePlan(appId: string, planId: string): Promise<boolean> {
  const existing = await findProduct(appId, planId);
  if (!existing) return false;
  await stripe().products.update(existing.id, { active: false });
  logEvent({ jobId: '-', appId }, 'INFO', 'stripe.plan_archived', { planId });
  return true;
}
