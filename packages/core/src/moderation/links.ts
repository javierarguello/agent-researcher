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
 * Refused rather than stripped, and NOT as a moderation strike. Someone pasting a
 * broker's link into "industry" is being helpful, not hostile — they get a sentence
 * telling them we find the sources ourselves. Malice through this channel still has
 * to say something the pre-screen catches to earn a strike.
 */

/**
 * Conservative on purpose: a scheme, a `www.`, or a bare host on a TLD people
 * actually type. A generic `\.[a-z]{2,}` would refuse "St. Petersburg", "Bldg. 4"
 * and every "e.g." a buyer writes, which is the failure mode that costs customers
 * rather than the one that costs a prompt.
 */
const TLDS = 'com|net|org|io|co|us|biz|info|ai|app|dev|shop|store|site|online|live|link|xyz|test|local';
const LINK_RE = new RegExp(
  [
    '(?:https?|ftp|file|data|javascript):',        // a scheme, any scheme
    '(?:^|[\\s(<"\'])www\\.[a-z0-9-]',              // www., however it is punctuated
    `(?:^|[\\s(<"'])[a-z0-9][a-z0-9-]*\\.(?:${TLDS})(?![a-z])`, // a bare host
  ].join('|'),
  'i',
);

/** The first link-shaped run in `text`, or undefined. */
export function findLink(text: unknown): string | undefined {
  if (typeof text !== 'string' || !text) return undefined;
  const m = LINK_RE.exec(text);
  return m ? m[0].trim() : undefined;
}

/**
 * Every param that carries a link, by name. Walks arrays and nested objects,
 * because a template may declare either and a guard that only reads the top level
 * is a guard the next template escapes.
 */
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
