/**
 * Tiny in-memory TTL cache for public (unauthenticated) responses.
 *
 * Public endpoints — pricing/plans and other client-facing catalog data that
 * carries no per-user information — are served to anyone and hit slow upstreams
 * (Stripe). We cache them for a fixed TTL so an unauthenticated landing page
 * can't turn into a Stripe request amplifier. Never use this for
 * authenticated/per-user data: the cache is keyed only by the arguments you pass.
 */
const store = new Map<string, { value: unknown; expires: number }>();

/** Default TTL for public, unauthenticated responses: 30 minutes. */
export const PUBLIC_TTL_MS = 30 * 60_000;

/** Seconds form, for HTTP `Cache-Control: max-age`. */
export const PUBLIC_TTL_SECONDS = Math.floor(PUBLIC_TTL_MS / 1000);

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await load();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** Test/ops hook: drop all cached entries. */
export function clearPublicCache(): void {
  store.clear();
}
