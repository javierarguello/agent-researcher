/**
 * A link in what the buyer typed. We choose the sources; they do not.
 *
 * `preferredSources` was retired for this reason and `keywords` went internal, but
 * two free-text params still reach an agent's prompt verbatim — `industry` and
 * `location` (`florida-business-for-sale.ts:1351-1352`) — and a URL in either is
 * the shortest path in the product to "make the model read this page".
 *
 * That matters more than it looks. A fetched page is the least defended surface
 * here: it never passed through our API, so no pre-screen and no classifier sees
 * it, and its content reaches the model as content. Every extraction and injection
 * measurement in `test/red-team/` assumes the attacker had to get their page to
 * RANK for an honest query. A URL the buyer supplies skips that entirely.
 *
 * **DEFUSED, not refused** (Javier, 2026-08-21), and the choice is what makes the
 * detection affordable. A guard that REJECTS has to be conservative, because a
 * false positive costs a customer their request — so it must let through anything
 * that might be "St.Petersburg, FL". A guard that takes the dots out of a
 * link-shaped run costs a false positive one space, and the buyer never learns it
 * happened because their meaning does not change: `bizbuysell.com` becomes
 * `bizbuysell com`, which the model reads as a broker's name and cannot fetch.
 *
 * So the pattern below is deliberately LOOSE. It is allowed to be wrong.
 */

/** A scheme, with or without slashes — `data:` and `javascript:` included. */
const SCHEME_RE = /\b(?:https?|ftp|ftps|file|data|javascript|vbscript|about|blob)\s*:\s*\/{0,3}/gi;
/**
 * A dotted host. Loose on purpose: two or more letters after a dot, no TLD list.
 * "St.Petersburg" matches, and that is fine — it becomes "St Petersburg", which is
 * the same place. Under a refusing guard this pattern would have been unusable.
 */
const HOST_RE = /\b([a-z0-9][a-z0-9-]*)(\.[a-z][a-z0-9-]{1,})+(\/[^\s]*)?/gi;

/** The first link-shaped run in `text`, or undefined. Detection only. */
export function findLink(text: unknown): string | undefined {
  if (typeof text !== 'string' || !text) return undefined;
  const m = new RegExp(SCHEME_RE.source, 'i').exec(text) ?? new RegExp(HOST_RE.source, 'i').exec(text);
  return m ? m[0].trim() : undefined;
}

/**
 * Take the URL out of a string without taking the meaning out.
 *
 * The dots become spaces and the scheme and slashes go. What is left reads as words
 * — which is what a buyer wanting "listings like the ones on bizbuysell.com" meant,
 * and is no longer something `fetch_page` can be handed. A model would have to
 * invent the TLD to rebuild it, which is a different attack from being given one.
 *
 * Runs on ordinary prose too, and does nothing to it: "restaurants with a 4.5
 * rating" has no letters after the dot, "e.g. coin-op" has a space. Only a
 * link-SHAPED run is touched.
 */
export function defuseLinks(text: string): { text: string; changed: boolean } {
  let changed = false;
  const out = text
    .replace(new RegExp(SCHEME_RE.source, 'gi'), () => { changed = true; return ''; })
    .replace(new RegExp(HOST_RE.source, 'gi'), (m) => {
      changed = true;
      return m.replace(/[./]+/g, ' ').replace(/\s+/g, ' ').trim();
    });
  return { text: changed ? out.replace(/\s+/g, ' ').trim() : text, changed };
}

/**
 * Defuse every string in a params object, in place of the value.
 *
 * Walks arrays and nested objects, because a template may declare either and a
 * guard that only reads the top level is a guard the next template escapes.
 * Returns the paths it changed, so the API can log that it happened — silent is
 * fine for the buyer, whose meaning is intact, and not fine for the record.
 */
export function defuseParamLinks(params: Record<string, unknown>): { params: Record<string, unknown>; defused: string[] } {
  const defused: string[] = [];
  const walk = (value: unknown, path: string): unknown => {
    if (typeof value === 'string') {
      const r = defuseLinks(value);
      if (r.changed) defused.push(path);
      return r.text;
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, path ? `${path}.${k}` : k)]));
    }
    return value;
  };
  return { params: walk(params, '') as Record<string, unknown>, defused };
}

/** Every param that carries a link, by name. Detection only — see `defuseParamLinks`. */
export function paramsWithLinks(params: Record<string, unknown>): string[] {
  const hits: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (findLink(value)) hits.push(path);
      return;
    }
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(params, '');
  return hits;
}
