/**
 * LLM layer entry point.
 *
 * - `resolveModel(alias)` / `getProviderFor(name)` — the model registry used by
 *   the agent workflow (per-agent model selection, multi-provider).
 * - `getProvider()` — the default provider, kept for simple/legacy call sites.
 *
 * Add a new provider in `models.ts`; nothing else changes.
 */
import { config } from '../config.js';
import { getProviderFor } from './models.js';
import type { LlmProvider } from './provider.js';

export * from './provider.js';
export { resolveModel, getProviderFor, modelAliases } from './models.js';
export type { ResolvedModel } from './models.js';

/** The default provider instance (memoized via the registry). */
export function getProvider(): LlmProvider {
  return getProviderFor(config.llm.provider);
}
