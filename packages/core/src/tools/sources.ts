import type { SearchResult } from './web-search.js';

/**
 * Canonical form of a URL for de-duplication: lowercased scheme+host, no default
 * port, no `www.`, no trailing slash, no fragment, and common tracking params
 * (utm_*, gclid, fbclid, ref) stripped. Two URLs that only differ by those are
 * treated as the same source.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = u.protocol.toLowerCase();
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(k) || /^(gclid|fbclid|ref|ref_|mc_cid|mc_eid)$/i.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    s = s.replace(/\/$/, ''); // drop a trailing slash
    return s;
  } catch {
    return raw.trim().replace(/\/$/, '').toLowerCase();
  }
}

/** De-duplicate sources by canonical URL, keeping the first occurrence + its order. */
export function dedupeSources(sources: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const s of sources) {
    if (!s.url) continue;
    const key = normalizeUrl(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
