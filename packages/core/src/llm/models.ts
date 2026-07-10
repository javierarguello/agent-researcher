/**
 * Model registry + multi-provider resolver.
 *
 * Agents reference a model ALIAS (e.g. 'flash', 'pro', 'claude-sonnet'); this
 * module resolves the alias to a concrete `{ provider, model }` pair. Providers
 * are memoized, so a workflow can mix providers (Gemini for one agent, Claude
 * for another) with one instance each.
 *
 * Adding a provider = one `case` here + one alias in `config.llm.models`. No
 * template, agent, or engine change.
 */
import { config } from '../config.js';
import { GeminiVertexProvider } from './gemini-vertex.js';
import type { LlmProvider } from './provider.js';

const providers = new Map<string, LlmProvider>();

/** Test seam: inject a provider instance for a name (e.g. a mock). */
const overrides = new Map<string, LlmProvider>();
export function __setProviderForTests(name: string, provider: LlmProvider): void {
  overrides.set(name, provider);
}
export function __clearProvidersForTests(): void {
  overrides.clear();
  providers.clear();
}

function instantiate(name: string): LlmProvider {
  switch (name) {
    case 'gemini-vertex':
      return new GeminiVertexProvider();
    // case 'anthropic':
    //   return new AnthropicProvider(); // future — same interface.
    default:
      throw new Error(`Unknown LLM provider: "${name}"`);
  }
}

/** The provider instance for a provider name (memoized; test overrides win). */
export function getProviderFor(name: string): LlmProvider {
  const override = overrides.get(name);
  if (override) return override;
  let p = providers.get(name);
  if (!p) {
    p = instantiate(name);
    providers.set(name, p);
  }
  return p;
}

export interface ResolvedModel {
  /** The alias that was resolved (for logging / progress). */
  alias: string;
  /** The provider that owns the concrete model. */
  provider: LlmProvider;
  /** The concrete model id passed to `provider.generate`. */
  model: string;
  /** USD per 1M input tokens (for cost accounting). */
  inPerM: number;
  /** USD per 1M output tokens. */
  outPerM: number;
}

/** Resolve a model alias to a concrete provider + model id + price. Throws if unknown. */
export function resolveModel(alias: string): ResolvedModel {
  const entry = config.llm.models[alias];
  if (!entry) {
    throw new Error(
      `Unknown model alias "${alias}". Known aliases: ${Object.keys(config.llm.models).join(', ')}`,
    );
  }
  return {
    alias,
    provider: getProviderFor(entry.provider),
    model: entry.model,
    inPerM: entry.inPerM ?? 0,
    outPerM: entry.outPerM ?? 0,
  };
}

/** All registered model aliases (used by template validation). */
export function modelAliases(): string[] {
  return Object.keys(config.llm.models);
}
