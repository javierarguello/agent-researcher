/**
 * The buyer does not get to choose the sources.
 *
 * `preferredSources` was retired and `keywords` went internal, but two free-text
 * params still reach an agent's prompt verbatim — `industry` and `location`
 * (`florida-business-for-sale.ts:1351-1352`) — and a URL in either is the shortest
 * path in this product to "make the model read this page".
 *
 * Which matters because a fetched page is the least defended surface here: it never
 * passed through our API, so no pre-screen and no classifier sees it, and it reaches
 * the model as content. Every measurement in `test/red-team/` assumes the attacker
 * had to get their page to RANK for an honest query — a URL the buyer supplies skips
 * that entirely, and skips it at a cost of nothing.
 *
 * The other half is the one that decides whether this can ship: what a buyer
 * legitimately types must survive. "St. Petersburg, FL" is not a link.
 */
import { describe, it, expect } from 'vitest';
import { findLink, paramsWithLinks } from '../src/moderation/links.js';
import { validateRequest } from '../src/index.js';

const req = (params: Record<string, unknown>) => () =>
  validateRequest({ template: 'florida-business-for-sale', params: { industry: 'laundromats', ...params } });

describe('a link in what the buyer typed', () => {
  it('is refused, by param name, before the schema has an opinion', () => {
    // Named, because "invalid params" would send someone hunting through a form for
    // a rule nobody stated. And before the schema, so the message is about the link
    // rather than about whatever else the request got wrong.
    expect(req({ location: 'https://broker.example/listings/miami' })).toThrow(/Links are not accepted in location/);
    expect(req({ industry: 'laundromats, see www.miamibizbroker.com' })).toThrow(/Links are not accepted in industry/);
    expect(req({ industry: 'laundromats at bizbuysell.com' })).toThrow(/we find and check the sources ourselves/);
  });

  it('catches the schemes that are not http', () => {
    // `data:` and `javascript:` are not "sources", but a param that carries one is a
    // param someone is testing, and the renderers have their own history with both.
    for (const bad of ['data:text/html,<script>x</script>', 'javascript:alert(1)', 'file:///etc/passwd', 'FTP://x.example/a']) {
      expect(findLink(bad), bad).toBeDefined();
    }
  });

  it('walks arrays and nested objects, not just the top level', () => {
    // A template may declare either, and a guard that reads one level is a guard the
    // next template escapes.
    expect(paramsWithLinks({ tags: ['fine', 'see https://x.test'] })).toEqual(['tags[1]']);
    expect(paramsWithLinks({ deep: { nested: { here: 'www.x.test' } } })).toEqual(['deep.nested.here']);
  });

  it('leaves ordinary requests alone — the half that decides whether this ships', () => {
    // Every one of these is a real thing a buyer types. A guard that refuses them
    // costs customers to protect a prompt, which is the wrong trade in both
    // directions: `\\.[a-z]{2,}` would have caught the first four.
    for (const ok of [
      'St. Petersburg, FL',
      // No space after the dot, which is how people actually type it — and the case
      // that discriminates. A generic `[a-z0-9]\.[a-z]{2,}` refuses this one and
      // passed every other line here, so without it the loose pattern was 0 red.
      'St.Petersburg, FL',
      'Smith&Co.Ltd laundromats',
      'Miami-Dade County, FL',
      'laundromats, e.g. coin-op',
      'Smith & Co. Ltd. laundromats',
      'Jacksonville, FL — Inc. 5000 companies',
      'car washes and quick-lube',
      'restaurants with a 4.5 rating',
    ]) {
      expect(findLink(ok), ok).toBeUndefined();
    }
    // …and the whole request goes through.
    expect(req({ location: 'St. Petersburg, FL' })).not.toThrow();
  });

  it('does not fire on a value the buyer never typed', () => {
    // `sourceUrl` and friends are OURS — model output and search results, checked
    // elsewhere. This guard is about the request, and firing on our own data would
    // make it impossible to resubmit a job.
    expect(paramsWithLinks({ mode: 'essential', language: 'en', sbaFriendly: false })).toEqual([]);
  });
});
