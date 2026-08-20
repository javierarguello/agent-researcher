/**
 * Per-model credit pricing, overridable in Firestore without a deploy.
 *
 *   model-pricing/{templateId} → { modes?: { essential, comprehensive }, addons?, updatedAt }
 *
 * Code holds the DEFAULTS (a template's `modes[mode].credits`, or DEFAULT_MODES).
 * A doc here OVERRIDES them per model. Resolution order: Firestore override →
 * template default → code default.
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';
import { creditsForMode, maxCostForMode, type ModeConfig, type ReportMode } from '../mode.js';

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}
const col = () => firestore().collection(config.credits.pricingCollection);
const nowIso = () => new Date().toISOString();

export interface ModelPricing {
  /** Per-mode credit override (e.g. { essential: 8, comprehensive: 18 }). */
  modes?: Partial<Record<ReportMode, number>>;
  /** Per-addon credit price (e.g. { deck: 10, docx: 3 }). */
  addons?: Record<string, number>;
  /**
   * The lowest USD a single credit is sold for, for the catalog THIS model is sold
   * through. Computed from Stripe by an admin tool (`creditFloorFrom`) rather than
   * typed, though an admin may type it — the two write the same field and the last
   * one wins.
   *
   * It lives per model, next to the credits it multiplies, because everything that
   * decides what a report of this model may spend should be readable in one place.
   */
  creditFloorUsd?: number;
  /**
   * The gross margin, in PERCENT, a job of this model must leave on the report it
   * produced. See `config.pricing.expectedProfitPct` for what the number means and
   * `resolveModeCeiling` for where it is applied.
   */
  expectedProfitPct?: number;
  updatedAt?: string;
}

/**
 * The credit floor a live Stripe catalog implies: `min(priceUsd / credits)`.
 *
 * A pure function on purpose — the Stripe client lives in the API and this package
 * has no business holding one. The admin app's "read from Stripe" button lists the
 * packs and posts them; the API calls this and stores the result on the model.
 *
 * `undefined` for an empty or unusable catalog. Stripe being down, an app with no
 * products, or a pack with zero credits must never be read as "credits are free":
 * that would drive every ceiling to zero and hold every job.
 */
export function creditFloorFrom(packs: Array<{ priceUsd: number; credits: number }>): number | undefined {
  const usable = packs.filter((p) => p.priceUsd > 0 && p.credits > 0);
  return usable.length ? Math.min(...usable.map((p) => p.priceUsd / p.credits)) : undefined;
}

/** Firestore pricing override for a model, or null if none. */
export async function getModelPricing(templateId: string): Promise<ModelPricing | null> {
  const snap = await col().doc(templateId).get();
  return snap.exists ? (snap.data() as ModelPricing) : null;
}

/** Upsert the pricing override for a model (merge). */
export async function setModelPricing(templateId: string, patch: ModelPricing): Promise<ModelPricing> {
  const ref = col().doc(templateId);
  const data: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.modes) data.modes = patch.modes;
  if (patch.addons) data.addons = patch.addons;
  if (patch.creditFloorUsd !== undefined) data.creditFloorUsd = patch.creditFloorUsd;
  if (patch.expectedProfitPct !== undefined) data.expectedProfitPct = patch.expectedProfitPct;
  await ref.set(data, { merge: true });
  return (await ref.get()).data() as ModelPricing;
}

/** Effective mode credits: Firestore override → template/code default. */
export function resolveModeCredits(pricing: ModelPricing | null, config: ModeConfig, key: ReportMode): number {
  return pricing?.modes?.[key] ?? creditsForMode(config, key);
}

/**
 * Effective cost ceiling for a mode: derived from the EFFECTIVE price.
 *
 * `credits × creditFloorUsd × (1 − expectedProfitPct/100)`, and all three inputs
 * come from THIS model's pricing doc — an admin who doubles a mode's credits in
 * `/admin/pricing` has doubled what that report earns, and the ceiling follows with
 * no deploy. Reading a code default instead would leave a re-priced model guarded by
 * its old price, which is the failure this whole shape exists to prevent (D1).
 *
 * The deployment-wide `MAX_JOB_COST_USD` still clamps the result: it is the
 * incident lever and a per-model number must not be able to ignore it.
 */
export function resolveModeCeiling(
  pricing: ModelPricing | null,
  mode: ModeConfig,
  key: ReportMode,
  fallbackUsd: number,
): number {
  return maxCostForMode(mode, fallbackUsd, {
    credits: resolveModeCredits(pricing, mode, key),
    // A stored 0 or a negative is a missing price, not a policy: a ceiling derived
    // from it would be zero and would hold every job of this model.
    creditFloorUsd: positive(pricing?.creditFloorUsd) ?? config.pricing.creditFloorUsd,
    expectedProfitPct: inRange(pricing?.expectedProfitPct) ?? config.pricing.expectedProfitPct,
  });
}

const positive = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
/** 0–100. A stored 100 would mean "spend nothing", which is a hold on every job. */
const inRange = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100 ? v : undefined;
