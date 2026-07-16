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
 * Firestore). Convention: a Price/Product carries metadata `appId=<appId>`,
 * `planId=<planId>`, and `credits=<n>`. The app owns a Price when its metadata
 * `appId` matches; `planId` selects the specific pack. (lookup_key is no longer
 * used for resolution.)
 */
export interface StripePlan {
  planId: string;
  name: string;
  priceUsd: number;
  credits: number;
  priceId: string;
}

function planFromPrice(price: Stripe.Price): StripePlan {
  const productMd = typeof price.product === 'object' && 'metadata' in price.product ? price.product.metadata : {};
  const md = { ...productMd, ...price.metadata }; // price metadata wins over product metadata
  const planId = String(md.planId ?? price.lookup_key ?? price.id);
  const name = typeof price.product === 'object' && 'name' in price.product ? String(price.product.name) : planId;
  return { planId, name, priceUsd: (price.unit_amount ?? 0) / 100, credits: Number(md.credits ?? 0), priceId: price.id };
}

/** All plans for an app — Stripe prices tagged with metadata.appId == appId. */
export async function listStripePlans(appId: string): Promise<StripePlan[]> {
  const res = await stripe().prices.search({
    query: `active:'true' AND metadata['appId']:'${appId}'`,
    expand: ['data.product'],
    limit: 20,
  });
  return res.data.map(planFromPrice).sort((a, b) => a.priceUsd - b.priceUsd);
}

/** Resolve one plan by its metadata `appId` + `planId`. */
export async function resolveStripePlan(appId: string, planId: string): Promise<StripePlan | undefined> {
  const res = await stripe().prices.search({
    query: `active:'true' AND metadata['appId']:'${appId}' AND metadata['planId']:'${planId}'`,
    expand: ['data.product'],
    limit: 1,
  });
  const price = res.data[0];
  return price ? planFromPrice(price) : undefined;
}
