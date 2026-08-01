/**
 * The Turnstile siteverify contract.
 *
 * This is the only thing standing between a bot and the endpoints it guards, and
 * it is a network call we can't exercise for real in CI — so the request shape
 * and the pass/fail rule are pinned here against a stubbed fetch.
 */
import { writableConfig } from './writable-config.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '../src/config.js';
import { verifyCaptcha, captchaEnabled } from '../src/auth/captcha.js';

let lastRequest: { url: string; init: { method?: string; headers?: Record<string, string>; body?: URLSearchParams } };

function stubSiteverify(response: unknown, opts: { throws?: boolean } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: Record<string, unknown> = {}) => {
      lastRequest = { url: String(url), init: init as never };
      if (opts.throws) throw new Error('network down');
      return { ok: true, status: 200, json: async () => response } as Response;
    }),
  );
}

const params = () => Object.fromEntries((lastRequest.init.body as URLSearchParams).entries());

describe('turnstile siteverify', () => {
  beforeEach(() => {
    writableConfig.captcha.secret = 'test-secret';
  });
  afterEach(() => {
    writableConfig.captcha.secret = '';
    vi.unstubAllGlobals();
  });

  it('is off until a secret is configured — and then everything passes through', async () => {
    writableConfig.captcha.secret = '';
    expect(captchaEnabled()).toBe(false);
    stubSiteverify({ success: false });
    expect(await verifyCaptcha(undefined)).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled(); // no call at all when unconfigured
  });

  it('posts the canonical form-encoded body to Cloudflare', async () => {
    stubSiteverify({ success: true });
    const res = await verifyCaptcha('token-abc', '203.0.113.9');

    expect(lastRequest.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(lastRequest.init.method).toBe('POST');
    expect(lastRequest.init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(params()).toEqual({ secret: 'test-secret', response: 'token-abc', remoteip: '203.0.113.9' });
    expect(res).toEqual({ ok: true });
  });

  it('omits remoteip when the client IP is unknown', async () => {
    stubSiteverify({ success: true });
    await verifyCaptcha('token-abc');
    expect(params()).toEqual({ secret: 'test-secret', response: 'token-abc' });
  });

  it('lets a request through ONLY on success === true', async () => {
    stubSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await verifyCaptcha('bad')).toEqual({ ok: false, reason: 'invalid-input-response' });

    // A truthy-but-not-true success must not pass.
    stubSiteverify({ success: 'true' });
    expect((await verifyCaptcha('weird')).ok).toBe(false);

    // Neither must a response missing the field entirely.
    stubSiteverify({});
    expect((await verifyCaptcha('empty')).ok).toBe(false);
  });

  it('rejects a missing token without calling Cloudflare', async () => {
    stubSiteverify({ success: true });
    expect(await verifyCaptcha(undefined)).toEqual({ ok: false, reason: 'missing_token' });
    // Both cases, separately: `'   ' && ''` is just `''` — the whitespace-only
    // token it claimed to cover was never actually passed in.
    expect(await verifyCaptcha('')).toEqual({ ok: false, reason: 'missing_token' });
    expect(await verifyCaptcha('   ')).toEqual({ ok: false, reason: 'missing_token' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails CLOSED when Cloudflare is unreachable', async () => {
    stubSiteverify(null, { throws: true });
    expect(await verifyCaptcha('token-abc')).toEqual({ ok: false, reason: 'verify_unavailable' });
  });

  it('surfaces the error codes for logging', async () => {
    stubSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate', 'invalid-input-secret'] });
    expect((await verifyCaptcha('replayed')).reason).toBe('timeout-or-duplicate,invalid-input-secret');
  });
});
