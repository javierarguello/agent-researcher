/**
 * How the suite gets its LLM answers. The dev picks; the default needs nothing
 * installed.
 *
 *   npm test                       → mock:   a stub provider, no network, no Ollama
 *   TEST_LLM=ollama npm test       → live:   the real local model (docker-compose.local.yml)
 *
 * Mock mode is what CI runs: fast and exactly reproducible, and it can force the
 * pathological answers a real model rarely produces on demand (prose where a code
 * belongs, a correction that replaces the value, an unknown enum member).
 *
 * Live mode is the complement: it can't assert an exact answer, so it asserts the
 * INVARIANTS instead — whatever a sloppy 3B model returns, the response must
 * still carry no model-authored text and no param the user didn't ask for. That
 * is the real test of the guards.
 */
import { describe } from 'vitest';

export const LLM_MODE = (process.env.TEST_LLM ?? 'mock') as 'mock' | 'ollama';
export const isLive = LLM_MODE === 'ollama';

/** Tests that drive the model's answer — only meaningful against the stub. */
export const describeMock = describe.skipIf(isLive);
/** Tests that check invariants against a real local model. */
export const describeLive = describe.skipIf(!isLive);
