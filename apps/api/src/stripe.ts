/**
 * Stripe client for the shared credits API. Lives in the shared research API
 * (not in any web app) so every product reuses one billing integration and the
 * Stripe keys stay in one place. Hosted Checkout (redirect) — no publishable key
 * needed here.
 */
import Stripe from 'stripe';
import { config } from '@agent-researcher/core';

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
}

/**
 * Localized marketing. Stripe has no native per-language `description`, so we keep
 * per-locale copy in PRODUCT metadata under suffixed keys: `sub_es`, `features_fr`,
 * … (pipe-separated for features). The base `sub`/`features` (and the native
 * `description`) are the English/default fallback. Pass `lang` to pick a locale.
 */
function localized(md: Record<string, string>, base: string, lang: string): string | undefined {
  return md[`${base}_${lang}`] ?? md[base] ?? undefined;
}

/** Build a plan from a product + its resolved default price, in `lang`. */
function planFromProduct(product: Stripe.Product, price: Stripe.Price, lang: string): StripePlan {
  const md = product.metadata ?? {};
  const planId = String(md.planId ?? product.id);
  const sub = localized(md, 'sub', lang) ?? product.description ?? undefined;
  const features = localized(md, 'features', lang);
  return {
    planId,
    name: localized(md, 'name', lang) ?? product.name,
    priceUsd: (price.unit_amount ?? 0) / 100,
    credits: Number(md.credits ?? 0),
    priceId: price.id,
    ...(price.recurring?.interval ? { interval: price.recurring.interval } : {}),
    ...(sub ? { sub } : {}),
    ...(md.popular === 'true' ? { popular: true } : {}),
    // Features: pipe-separated, e.g. "≈4 reports|Basic ROI|…"
    ...(features ? { features: features.split('|').map((f) => f.trim()).filter(Boolean) } : {}),
  };
}

/**
 * All plans for an app — Stripe **products** tagged with metadata.appId == appId,
 * each represented by its default price, localized to `lang`. Products without a
 * default price are skipped (not purchasable).
 */
export async function listStripePlans(appId: string, lang = 'en'): Promise<StripePlan[]> {
  const res = await stripe().products.search({
    query: `active:'true' AND metadata['appId']:'${appId}'`,
    expand: ['data.default_price'],
    limit: 50,
  });
  return res.data
    .filter((p) => p.default_price && typeof p.default_price === 'object')
    .map((p) => planFromProduct(p, p.default_price as Stripe.Price, lang))
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
