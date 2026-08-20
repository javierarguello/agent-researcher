/**
 * Every call carries the language the SWITCHER is on, not the laptop's.
 *
 * The API answers a person in `body.lang`, then `?lang=`, then `Accept-Language`
 * (`apps/api/src/req-lang.ts`). For everything that is not one of the two emails —
 * the rate-limit sentences, the blocked-account message — only the header was left,
 * and the header was whatever the browser was configured in: `en` for a Spanish
 * speaker on a US machine, which is exactly the person the fallback exists for.
 * `client.ts` had already worked around it for the two emails by putting
 * `lang: chosenLang()` in those two bodies; this is the general form.
 *
 * `Accept-Language` is not a forbidden header name, so `fetch` may set it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, downloadFile } from '../src/api/client';

const calls: Array<{ url: string; headers: Record<string, string> }> = [];

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: { headers?: Record<string, string> } = {}) => {
      calls.push({ url: String(url), headers: init.headers ?? {} });
      return {
        ok: true, status: 200,
        text: async () => '{}',
        blob: async () => new Blob(['x']),
      } as unknown as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('the API client’s language header', () => {
  it('sends the chosen language, so the server answers in it', async () => {
    localStorage.setItem('fbizlab_lang', 'fr');
    await api('/templates');
    expect(calls[0]!.headers['accept-language']).toBe('fr');
  });

  it('follows the switcher rather than being read once', async () => {
    localStorage.setItem('fbizlab_lang', 'es');
    await api('/templates');
    localStorage.setItem('fbizlab_lang', 'pt');
    await api('/templates');
    expect(calls.map((c) => c.headers['accept-language'])).toEqual(['es', 'pt']);
  });

  it('sends NOTHING on a first visit, so the browser’s own value stands', async () => {
    // A hardcoded `en` here would be worse than no header: it would overwrite the
    // one honest signal a visitor who has never touched the switcher gives us.
    await api('/templates');
    expect('accept-language' in calls[0]!.headers).toBe(false);
  });

  it('carries it on a file download too — that route can 429 as well', async () => {
    localStorage.setItem('fbizlab_lang', 'pt');
    // jsdom has no `URL.createObjectURL`; the header is read before it is reached.
    const u = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const orig = { c: u.createObjectURL, r: u.revokeObjectURL };
    u.createObjectURL = () => 'blob:x';
    u.revokeObjectURL = () => {};
    try {
      await downloadFile('/reports/x/file.pdf', 'file.pdf');
    } finally {
      u.createObjectURL = orig.c;
      u.revokeObjectURL = orig.r;
    }
    expect(calls[0]!.headers['accept-language']).toBe('pt');
  });
});
