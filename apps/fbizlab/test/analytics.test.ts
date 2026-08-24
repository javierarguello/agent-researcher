/**
 * Anonymous traffic measurement, and the two ways it could do harm.
 *
 * 1. **It could leak a credential.** Three routes carry secrets in the query:
 *    `/verify?token=…` and `/reset?token=…` are single-purpose auth tokens, and
 *    `/report/:jobId?rt=…` is the admin share link whose `rt` IS the authorization.
 *    The stock "track page views" snippet sends `pathname + search`, which would put
 *    live tokens in Google's logs.
 * 2. **It could run where it was never meant to.** It is prod-only, and prod-only is
 *    enforced by the measurement id being absent from every other build.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('the path GA is allowed to see', () => {
  it('never carries a query string — that is where every token lives', async () => {
    const { screenPath } = await import('../src/analytics');
    for (const raw of [
      '/verify?token=abc.def.ghi',
      '/reset?token=super-secret',
      '/report/abc123?rt=eyJhbGciOiJIUzI1NiJ9.payload.sig',
      '/?utm_source=x&gclid=y',
    ]) {
      const out = screenPath(raw);
      expect(out, raw).not.toContain('?');
      expect(out, raw).not.toMatch(/token|rt=|secret|eyJ/i);
    }
  });

  it('replaces ids with the SHAPE of the route, not its contents', async () => {
    // A job id is not a secret, but it is an identifier for one person's paid work,
    // and a per-job row in someone else's analytics is not what "count visits" means.
    const { screenPath } = await import('../src/analytics');
    expect(screenPath('/app/jobs/AAE4931b-77c2-4f0a')).toBe('/app/jobs/:jobId');
    expect(screenPath('/report/local-52835003')).toBe('/report/:jobId');
  });

  it('leaves the public routes recognisable — the control', async () => {
    // Without this, "sanitize everything to /" passes every test above and the
    // feature reports one page for the whole product.
    const { screenPath } = await import('../src/analytics');
    expect(screenPath('/')).toBe('/');
    expect(screenPath('/sample')).toBe('/sample');
    expect(screenPath('/es')).toBe('/es');
    expect(screenPath('/app/credits')).toBe('/app/credits');
    expect(screenPath('/privacy')).toBe('/privacy');
  });

  it('normalises a trailing slash rather than reporting two pages for one', async () => {
    const { screenPath } = await import('../src/analytics');
    expect(screenPath('/sample/')).toBe('/sample');
    expect(screenPath('/')).toBe('/');
  });
});

describe('prod-only, enforced by absence', () => {
  beforeEach(() => { vi.resetModules(); });

  it('is OFF in a build with no measurement id, and sends nothing', async () => {
    // Every test run and every dev build is exactly this case. If it were on, the
    // suite would be reporting page views into a real property.
    const { analyticsEnabled, trackPageView } = await import('../src/analytics');
    expect(analyticsEnabled()).toBe(false);
    // The proof that it sends nothing: the firebase SDK is never even imported.
    // A static import would load it here regardless.
    expect(() => trackPageView('/')).not.toThrow();
  });

  it('…and turns ON purely because the id is present — the control', async () => {
    // Without this, `analyticsEnabled: () => false` passes the test above forever.
    vi.doMock('../src/config', () => ({
      config: { firebase: { measurementId: 'G-TEST', apiKey: 'k', authDomain: 'a', projectId: 'p', storageBucket: 's', messagingSenderId: 'm', appId: 'x' } },
    }));
    const { analyticsEnabled } = await import('../src/analytics');
    expect(analyticsEnabled()).toBe(true);
  });
});

describe('anonymous means cookieless, and that is set BEFORE the SDK starts', () => {
  beforeEach(() => { vi.resetModules(); });

  it('denies analytics_storage and all three ad consents, before getAnalytics', async () => {
    // The ordering is the whole feature: consent applied after initialization is
    // consent applied after the first cookie has already been written.
    const calls: string[] = [];
    let consent: Record<string, string> | undefined;
    vi.doMock('../src/config', () => ({
      config: { firebase: { measurementId: 'G-TEST', apiKey: 'k', authDomain: 'a', projectId: 'p', storageBucket: 's', messagingSenderId: 'm', appId: 'x' } },
    }));
    vi.doMock('firebase/app', () => ({ initializeApp: () => { calls.push('initializeApp'); return {}; } }));
    vi.doMock('firebase/analytics', () => ({
      isSupported: async () => true,
      setConsent: (c: Record<string, string>) => { calls.push('setConsent'); consent = c; },
      getAnalytics: () => { calls.push('getAnalytics'); return {}; },
      logEvent: (_a: unknown, name: string, params: unknown) => { calls.push(`logEvent:${name}`); void params; },
    }));
    const { trackPageView } = await import('../src/analytics');
    trackPageView('/sample');
    await new Promise((r) => setTimeout(r, 10));

    expect(consent).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    expect(calls.indexOf('setConsent')).toBeLessThan(calls.indexOf('getAnalytics'));
    expect(calls).toContain('logEvent:page_view');
  });

  it('never identifies anybody — setUserId and setUserProperties are never called', async () => {
    // The first version of this grepped the SOURCE for `setUserId` and went red on
    // the doc comment that says it is not used. A test that reads its own file's
    // prose is testing the prose. This one hands the module a real SDK surface and
    // watches what it reaches for.
    const touched: string[] = [];
    vi.doMock('../src/config', () => ({
      config: { firebase: { measurementId: 'G-TEST', apiKey: 'k', authDomain: 'a', projectId: 'p', storageBucket: 's', messagingSenderId: 'm', appId: 'x' } },
    }));
    vi.doMock('firebase/app', () => ({ initializeApp: () => ({}) }));
    vi.doMock('firebase/analytics', () => ({
      isSupported: async () => true,
      setConsent: () => {},
      getAnalytics: () => ({}),
      logEvent: () => { touched.push('logEvent'); },
      setUserId: () => { touched.push('setUserId'); },
      setUserProperties: () => { touched.push('setUserProperties'); },
    }));
    const { trackPageView } = await import('../src/analytics');
    trackPageView('/app/jobs/abc123');
    trackPageView('/app/credits');
    await new Promise((r) => setTimeout(r, 10));
    expect(touched).not.toContain('setUserId');
    expect(touched).not.toContain('setUserProperties');
    expect(touched, 'the premise: it really did run').toContain('logEvent');
  });
});
