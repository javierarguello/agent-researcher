/**
 * How this suite gets its LLM answers — the dev picks, and the default needs
 * nothing installed. Mirrors `apps/api/test/llm-mode.ts`.
 *
 *   npm test                 → mock: MockLlmProvider, no network
 *   TEST_LLM=ollama npm test → live: the real local model (docker-compose.local.yml)
 */
import { describe } from 'vitest';

export const isLive = (process.env.TEST_LLM ?? 'mock') === 'ollama';

// `describe.skipIf` returns vitest's chainable variant, whose type names internals
// TypeScript cannot re-export from here. Naming the shape we actually use keeps the
// suites typechecked without dragging vitest's private types across the boundary.
type ConditionalDescribe = (name: string, fn: () => void) => void;

/** Tests that script the model's answers — only meaningful against the mock. */
export const describeMock: ConditionalDescribe = describe.skipIf(isLive);
/** Tests that need a real model behind the aliases. */
export const describeLive: ConditionalDescribe = describe.skipIf(!isLive);

/**
 * Fail loudly when live mode is asked for but no model server is up.
 *
 * Every model-backed path in this codebase fails SOFT — an unreachable model
 * degrades to a deterministic fallback. That is right in production and a trap
 * in a test: without this check a live suite would pass green having never
 * spoken to a model. Call it from `beforeAll`.
 */
export async function requireLocalModel(): Promise<void> {
  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const want = process.env.LLM_MODEL_FLASH ?? 'qwen2.5:3b';
  let tags: { models?: Array<{ name?: string }> };
  try {
    tags = await (await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) })).json() as { models?: Array<{ name?: string }> };
  } catch (err) {
    throw new Error(
      `TEST_LLM=ollama but no model server at ${host} (${(err as Error).message}). Start it with: npm run llm:up`,
    );
  }
  const names = (tags.models ?? []).map((m) => m.name ?? '');
  const family = want.split(':')[0];
  if (!names.some((n) => n === want || n.startsWith(`${family}:`))) {
    throw new Error(`Model "${want}" is not pulled on ${host} (have: ${names.join(', ') || 'none'}). Run: npm run llm:up`);
  }
}
