/**
 * Bake the pricing catalog into the build.
 *
 * The landing is a static SPA, and its pricing section used to call the API on
 * every visit — which called Stripe on every cache miss. Fetching the catalog
 * once at build time removes the landing from that path entirely: the public
 * `/plans` route stops carrying visitor traffic, and Stripe stops being reachable
 * from anonymous page loads at all.
 *
 * The catalog changes when someone edits it in Stripe, i.e. rarely and
 * deliberately. A daily scheduled rebuild (plus a manual trigger) is the right
 * cadence; a price change that must go out now is one `workflow_dispatch` away.
 *
 * Writes `dist/plans.json` — `{ "<lang>": [ …plans… ] }`.
 *
 * FAILS THE BUILD if the catalog can't be fetched or comes back empty. Shipping a
 * silently blank pricing page is worse than a red deploy: nobody notices the
 * first, everybody notices the second.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = (process.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const APP_ID = process.env.VITE_APP_ID ?? 'fbizlab';
const LANGS = ['en', 'es', 'fr', 'pt'];
const OUT = join(process.cwd(), 'dist', 'plans.json');

if (!API) {
  console.error('fetch-plans: VITE_API_BASE_URL is not set — cannot fetch the catalog.');
  process.exit(1);
}

/**
 * Fetch with room for a cold API. The prod API scales to zero, and its first
 * request after idle — or after a deploy, which is exactly when this runs on a
 * release — took 19s, past the old 15s cap: the nightly re-bake went red on
 * 2026-10-27, -28 and on the first try of the 2026-10-29 release, each time
 * against an API that answered in 0.3s once warm.
 *
 * Only what a retry can fix is retried — a timeout, a network error, a 5xx. A 4xx
 * is a wrong URL or app id and fails at once, and so does an empty catalog below:
 * waiting changes neither.
 */
const ATTEMPTS = 3;
const TIMEOUT_MS = Number(process.env.FETCH_PLANS_TIMEOUT_MS ?? 60_000);
const BACKOFF_MS = Number(process.env.FETCH_PLANS_BACKOFF_MS ?? 5_000);

async function fetchWithRetry(url) {
  for (let attempt = 1; ; attempt++) {
    let problem;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status < 500) return res;
      problem = `returned ${res.status}`;
    } catch (err) {
      problem = `failed: ${err.message}`;
    }
    if (attempt >= ATTEMPTS) {
      console.error(`fetch-plans: ${url} ${problem} (attempt ${attempt} of ${ATTEMPTS}, giving up)`);
      process.exit(1);
    }
    console.error(`fetch-plans: ${url} ${problem} (attempt ${attempt} of ${ATTEMPTS}, retrying)`);
    await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt));
  }
}

const catalog = {};
for (const lang of LANGS) {
  const url = `${API}/plans?appId=${encodeURIComponent(APP_ID)}&lang=${lang}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    console.error(`fetch-plans: ${url} returned ${res.status}`);
    process.exit(1);
  }
  const { plans } = await res.json();
  if (!Array.isArray(plans) || plans.length === 0) {
    console.error(`fetch-plans: ${url} returned an empty catalog. Refusing to ship a blank pricing page.`);
    process.exit(1);
  }
  catalog[lang] = plans;
}

writeFileSync(OUT, JSON.stringify(catalog), 'utf8');
console.error(`fetch-plans: wrote ${OUT} (${LANGS.map((l) => `${l}:${catalog[l].length}`).join(' ')})`);
