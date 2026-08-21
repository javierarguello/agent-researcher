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
 * that entirely, at a cost of nothing.
 *
 * The link is DEFUSED, not refused, and that decision is what these tests are really
 * about. A refusing guard has to be conservative — a false positive costs a customer
 * their request — so it must let through anything that might be "St.Petersburg, FL".
 * Taking the dots out of a link-shaped run costs a false positive one space and the
 * buyer never notices, so the pattern is allowed to be loose and wrong.
 */
import { describe, it, expect } from 'vitest';
import { defuseLinks, defuseParamLinks, findLink } from '../src/moderation/links.js';
import { validateRequest } from '../src/index.js';

const req = (params: Record<string, unknown>) =>
  validateRequest({ template: 'florida-business-for-sale', params: { industry: 'laundromats', ...params } });

describe('a link in what the buyer typed', () => {
  it('reaches the model as words, not as something fetchable', () => {
    // The property that matters: what arrives cannot be handed to `fetch_page`.
    const out = req({ location: 'https://broker.example/listings/miami' });
    expect(out.params.location).not.toContain('://');
    expect(out.params.location).not.toContain('.');
    expect(out.params.location, 'the meaning was thrown away with the dots').toContain('broker');
    expect(out.defusedLinks).toContain('location');
  });

  it('keeps the request — nobody is refused for pasting a link', () => {
    // A buyer pasting a broker's URL into "industry" is being helpful. The first
    // version of this guard threw, which made the pattern's false positives cost a
    // customer and forced it to be timid.
    expect(() => req({ industry: 'laundromats like the ones on bizbuysell.com' })).not.toThrow();
    expect(req({ industry: 'laundromats like the ones on bizbuysell.com' }).params.industry)
      .toBe('laundromats like the ones on bizbuysell com');
  });

  it('defuses every scheme, not just http', () => {
    // `data:` and `javascript:` are not "sources", but a param carrying one is a
    // param someone is testing, and both renderers have their own history with them.
    for (const bad of ['data:text/html,<script>x</script>', 'javascript:alert(1)', 'file:///etc/passwd', 'FTP://x.example/a']) {
      expect(defuseLinks(bad).changed, bad).toBe(true);
      expect(defuseLinks(bad).text, bad).not.toMatch(/:\s*\/\//);
    }
  });

  it('changes a false positive and not its meaning — the whole reason it defuses', () => {
    // The pattern IS loose: "St.Petersburg" matches it. Under the refusing version
    // that was a customer turned away; here it is a space, and the same place.
    expect(defuseLinks('St.Petersburg, FL').text).toBe('St Petersburg, FL');
    expect(defuseLinks('Smith&Co.Ltd laundromats').text).toContain('Co Ltd');
  });

  it('leaves ordinary text completely alone', () => {
    // Nothing link-SHAPED, nothing touched — not even a space moved.
    for (const ok of [
      'St. Petersburg, FL',
      'Miami-Dade County, FL',
      'laundromats, e.g. coin-op',
      'restaurants with a 4.5 rating',
      'car washes and quick-lube',
      'Jacksonville, FL — Inc. 5000 companies',
    ]) {
      expect(defuseLinks(ok).changed, ok).toBe(false);
      expect(defuseLinks(ok).text, ok).toBe(ok);
      expect(findLink(ok), ok).toBeUndefined();
    }
  });

  it('walks arrays and nested objects, not just the top level', () => {
    // A template may declare either, and a guard that reads one level is a guard the
    // next template escapes.
    expect(defuseParamLinks({ tags: ['fine', 'see https://x.test'] }).defused).toEqual(['tags[1]']);
    expect(defuseParamLinks({ deep: { nested: { here: 'www.x.test' } } }).defused).toEqual(['deep.nested.here']);
  });

  it('reports nothing when there was nothing to do', () => {
    // `defusedLinks` is absent on an ordinary request, so a counter built on it
    // counts links and not requests.
    expect(req({ location: 'St. Petersburg, FL' }).defusedLinks).toBeUndefined();
    expect(defuseParamLinks({ mode: 'essential', sbaFriendly: false }).defused).toEqual([]);
  });
});
