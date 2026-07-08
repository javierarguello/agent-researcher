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
 * Firestore). Convention: Price `lookup_key` = `<appId>_<planId>` and Price/
 * Product metadata carries `app=<appId>` and `credits=<n>`.
 */
export interface StripePlan {
  planId: string;
  name: string;
  priceUsd: number;
  credits: number;
  lookupKey?: string;
  priceId: string;
}

function planFromPrice(appId: string, price: Stripe.Price): StripePlan {
  const productMd = typeof price.product === 'object' && 'metadata' in price.product ? price.product.metadata : {};
  const md = { ...productMd, ...price.metadata };
  const lk = price.lookup_key ?? undefined;
  const planId = lk && lk.startsWith(`${appId}_`) ? lk.slice(appId.length + 1) : (lk ?? price.id);
  const name = typeof price.product === 'object' && 'name' in price.product ? String(price.product.name) : planId;
  return { planId, name, priceUsd: (price.unit_amount ?? 0) / 100, credits: Number(md.credits ?? 0), lookupKey: lk, priceId: price.id };
}

/** All plans for an app — Stripe prices tagged with metadata.app == appId. */
export async function listStripePlans(appId: string): Promise<StripePlan[]> {
  const res = await stripe().prices.search({
    query: `active:'true' AND metadata['app']:'${appId}'`,
    expand: ['data.product'],
    limit: 20,
  });
  return res.data.map((p) => planFromPrice(appId, p)).sort((a, b) => a.priceUsd - b.priceUsd);
}

/** Resolve one plan by its lookup_key `<appId>_<planId>`. */
export async function resolveStripePlan(appId: string, planId: string): Promise<StripePlan | undefined> {
  const res = await stripe().prices.list({
    lookup_keys: [`${appId}_${planId}`],
    active: true,
    expand: ['data.product'],
    limit: 1,
  });
  const price = res.data[0];
  return price ? planFromPrice(appId, price) : undefined;
}
