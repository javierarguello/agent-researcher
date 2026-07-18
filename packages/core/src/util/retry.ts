/**
 * Small retry helper for synchronous, single-shot LLM calls (moderation, pre-flight
 * validation). These run inline on request handlers — unlike the agent engine they
 * have no wave-level retry — so a transient provider error or a Gemini rate-limit
 * (429/RESOURCE_EXHAUSTED) would otherwise fail immediately. Retries with exponential
 * backoff; deterministic (no jitter) so it stays test-friendly.
 */
export async function retryAsync<T>(fn: () => Promise<T>, attempts = 3, baseMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1)));
    }
  }
  throw lastErr;
}
