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

/**
 * Browser-facing freshness for public responses. Deliberately SHORT — a client's
 * HTTP cache can't be purged, so a long max-age would strand stale prices for
 * everyone. The long TTL above lives only in the server's in-process cache (which
 * IS purgeable, via `bustPublicCache` on a Stripe catalog webhook). With this,
 * a catalog change reaches every client within ~`PUBLIC_BROWSER_MAX_AGE` seconds,
 * and `stale-while-revalidate` keeps repeat loads instant while refreshing in the
 * background.
 */
export const PUBLIC_BROWSER_MAX_AGE = 60;
export const PUBLIC_BROWSER_SWR = 600;

/**
 * `shouldCache` guards what gets stored. Default caches everything; pass a
 * predicate to avoid pinning a "bad" value for the full TTL — e.g. an empty
 * catalog from a misconfigured upstream should recover instantly once fixed,
 * not be served stale for 30 minutes.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await load();
  if (shouldCache(value)) store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** Drop cached entries whose key starts with `prefix` (e.g. `plans:`). */
export function bustPublicCache(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Test/ops hook: drop all cached entries. */
export function clearPublicCache(): void {
  store.clear();
}
