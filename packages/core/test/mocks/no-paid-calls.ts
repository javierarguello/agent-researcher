/**
 * A test may never reach a paid provider. Enforced, not asked for.
 *
 * The suites are mocked by default, but "mocked" was a convention: every file
 * installed its own stub, and a file that forgot would instantiate the real Vertex
 * client and bill a live model. Nothing failed — it just quietly cost money, which
 * is the worst possible failure mode for a test suite. Cloud Storage had exactly
 * this shape until the API suite was found writing report.json to the real dev
 * bucket.
 *
 * So the default provider is one that THROWS. A test that wants a model installs a
 * stub (or, in live mode, points every alias at the local server). One that forgets
 * fails loudly on the first call, with the reason.
 */
import { __setProviderForTests } from '../../src/llm/models.js';
import type { LlmProvider } from '../../src/llm/provider.js';

const PAID_PROVIDERS = ['gemini-vertex', 'anthropic'];

function refuse(name: string): LlmProvider {
  return {
    name,
    async generate() {
      throw new Error(
        `A test tried to call the PAID provider "${name}". Tests never spend money: install a stub with ` +
          `__setProviderForTests()/installMockProvider(), or run the live tier with TEST_LLM=ollama, which ` +
          `points every alias at the local server.`,
      );
    },
  };
}

/** Call from a suite's setup, after any provider reset. */
export function forbidPaidProviders(): void {
  for (const name of PAID_PROVIDERS) __setProviderForTests(name, refuse(name));
}
