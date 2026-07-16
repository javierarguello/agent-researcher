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
import { creditsForMode, type ModeConfig, type ReportMode } from '../mode.js';

let db: Firestore | undefined;
function firestore(): Firestore {
  if (!db) db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  return db;
}
const col = () => firestore().collection(config.credits.pricingCollection);
const nowIso = () => new Date().toISOString();

export interface ModelPricing {
  /** Per-mode credit override (e.g. { essential: 5, comprehensive: 18 }). */
  modes?: Partial<Record<ReportMode, number>>;
  /** Per-addon credit price (e.g. { deck: 10, docx: 3 }). */
  addons?: Record<string, number>;
  updatedAt?: string;
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
  await ref.set(data, { merge: true });
  return (await ref.get()).data() as ModelPricing;
}

/** Effective mode credits: Firestore override → template/code default. */
export function resolveModeCredits(pricing: ModelPricing | null, config: ModeConfig, key: ReportMode): number {
  return pricing?.modes?.[key] ?? creditsForMode(config, key);
}
