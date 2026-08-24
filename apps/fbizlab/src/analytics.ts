/**
 * ANONYMOUS traffic measurement (Firebase Analytics / GA4), for one question nobody
 * could answer: how many people arrive, and how far do they get.
 *
 * **Anonymous is not a setting we hope is on — it is `setConsent` called BEFORE the
 * SDK is ever handed a config.** `analytics_storage: 'denied'` puts GA4 in cookieless
 * mode: no `_ga` cookie is written, no client id is persisted, and the pings that
 * reach Google carry no identifier that can follow a person between sessions or
 * between sites. The three ad consents are denied in the same call, so nothing here
 * can feed advertising even if someone later enables it on the property.
 *
 * **What that buys, and what it costs — say both out loud.** You get page views and
 * traffic volume, which is the question that was asked. You do NOT get returning
 * visitors, accurate unique-user counts (GA4 models them), or any funnel that spans
 * sessions. That is the price of anonymous, and it is the price Javier chose.
 *
 * **PROD ONLY, and that is a property of the CONFIG, not of a flag.** Nothing
 * initializes unless `VITE_FIREBASE_MEASUREMENT_ID` is present at build time, and
 * only the prod workflow passes it. A dev build, a local build and every test report
 * nowhere — not because someone remembered to switch it off, but because the id they
 * would report to is not in the bundle.
 *
 * **The SDK is loaded dynamically.** `firebase/analytics` is not small and this is a
 * landing page whose job is to be fast; a static import would put it in the critical
 * bundle and charge for it on every first paint, including the paints where analytics
 * is not configured at all.
 *
 * Nothing here identifies a person: no `setUserId`, no `setUserProperties`, no email,
 * no job id. It counts screens.
 *
 * One thing this file CANNOT enforce, so it is written down instead: **Google Signals
 * must stay off on the GA4 property.** Signals is a property-level setting in the
 * console; consent mode denies its inputs, but the switch itself lives outside the
 * code.
 */
import { config } from './config';

/**
 * The path as GA is allowed to see it.
 *
 * This is the load-bearing function in the file, and it is a SECURITY control rather
 * than a privacy nicety.
 *
 *   - `/verify?token=…` and `/reset?token=…` carry single-purpose auth tokens in the
 *     query. They are the credential.
 *   - `/report/:jobId?rt=…` is the admin's read-only share link, and `rt` IS the
 *     authorization for it.
 *
 * Sending `pathname + search`, which is what every "track page views" snippet on the
 * internet does, would hand live tokens to Google's logs. So: the query string is
 * dropped entirely, never sanitized field by field — a deny-list would be one new
 * `?foo=` away from leaking again — and identifiers in the path are replaced by the
 * shape of the route rather than its contents.
 */
export function screenPath(pathname: string): string {
  const p = pathname.split('?')[0]!.split('#')[0]!.replace(/\/+$/, '') || '/';
  return p
    .replace(/^\/report\/[^/]+$/, '/report/:jobId')
    .replace(/^\/app\/jobs\/[^/]+$/, '/app/jobs/:jobId');
}

type Logger = (name: string, params?: Record<string, unknown>) => void;
let log: Logger | undefined;
let starting: Promise<void> | undefined;

/** Configured means: this build was given a measurement id. Only prod is. */
export const analyticsEnabled = (): boolean => !!config.firebase?.measurementId;

async function start(): Promise<void> {
  if (!analyticsEnabled() || typeof window === 'undefined') return;
  const [{ initializeApp }, { getAnalytics, logEvent, isSupported, setConsent }] = await Promise.all([
    import('firebase/app'),
    import('firebase/analytics'),
  ]);
  // Safari with storage blocked, some in-app browsers, and any environment without
  // cookies report unsupported. It is not an error and must not become one.
  if (!(await isSupported())) return;
  // BEFORE `getAnalytics`, and that ordering is the whole feature: consent set after
  // initialization is consent set after the first cookie has already been written.
  setConsent({
    analytics_storage: 'denied',   // cookieless pings — no persistent client id
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  const analytics = getAnalytics(initializeApp(config.firebase!));
  log = (name, params) => logEvent(analytics, name as 'page_view', params as never);
}

/**
 * Record one screen view. Safe to call before the SDK has loaded and safe to call
 * when analytics is off — both are no-ops rather than errors, because a page view is
 * never worth a broken page.
 */
export function trackPageView(pathname: string): void {
  if (!analyticsEnabled()) return;
  starting ??= start().catch(() => { /* analytics must never break the app */ });
  const path = screenPath(pathname);
  void starting.then(() => log?.('page_view', { page_path: path, page_location: `${location.origin}${path}` }));
}
