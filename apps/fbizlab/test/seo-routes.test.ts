/**
 * The SEO metadata the build emits, and the app's own copy, describe the same pages.
 *
 * `prerender-seo.mjs` is a plain node script that cannot import TSX, so the titles
 * and descriptions for `/sample`, `/privacy`, `/legal`, … are written there a second
 * time. Copy in two files is copy that drifts, and this drift is the invisible kind:
 * the page renders correctly and only a crawler ever reads the tag that is wrong.
 *
 * Written after a real instance of exactly that — the whole site canonicalized to
 * `https://fbizlab.web.app`, a host that 404s, for a launch and two releases,
 * because nothing compared what was emitted against anything true.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { STATIC_ROUTES } from '../scripts/prerender-seo.mjs';
import { CONTENT } from '../src/pages/Legal';

const byPath = Object.fromEntries(STATIC_ROUTES.map((r) => [r.path, r]));

describe('the prerendered public routes', () => {
  it('cover every public non-landing route the router serves', () => {
    // The list a crawler can reach must be the list the app actually has. A route
    // added to `App.tsx` without one here is served the homepage's <head> again.
    for (const path of ['/sample', '/privacy', '/legal', '/support', '/api-access', '/contact']) {
      expect(byPath[path], `${path} has no prerendered head — it will claim to be the homepage`).toBeTruthy();
    }
  });

  it('each has its OWN title and description — no two alike', () => {
    // The defect being pinned: seven URLs served byte-identical HTML, so every one
    // carried the landing's title. `md5(/sample) === md5(/privacy) === md5(/)`.
    const titles = STATIC_ROUTES.map((r) => r.title);
    const descriptions = STATIC_ROUTES.map((r) => r.description);
    expect(new Set(titles).size, 'two routes share a title').toBe(titles.length);
    expect(new Set(descriptions).size, 'two routes share a description').toBe(descriptions.length);
  });

  it('titles match the heading the page actually shows', () => {
    // Not a spelling check — a drift check. If someone retitles the privacy page in
    // `Legal.tsx`, the tag Google reads must not keep the old name.
    expect(byPath['/privacy']!.title).toContain(CONTENT.privacy.en.title);
    expect(byPath['/legal']!.title).toContain(CONTENT.terms.en.title);
    expect(byPath['/support']!.title).toContain(CONTENT.support.en.title);
  });

  it('every title and description is a usable length', () => {
    // A title Google truncates, or a description it replaces with scraped text, is
    // the same as not having written one.
    for (const r of STATIC_ROUTES) {
      expect(r.title.length, `${r.path} title is ${r.title.length} chars`).toBeGreaterThan(15);
      expect(r.title.length, `${r.path} title is ${r.title.length} chars`).toBeLessThanOrEqual(70);
      expect(r.description.length, `${r.path} description is ${r.description.length} chars`).toBeGreaterThan(50);
      expect(r.description.length, `${r.path} description is ${r.description.length} chars`).toBeLessThanOrEqual(200);
    }
  });

  it('every path is absolute and carries no query or fragment', () => {
    // These become <loc> entries and canonicals; a relative or dirty one is a
    // sitemap Google rejects.
    for (const r of STATIC_ROUTES) {
      expect(r.path.startsWith('/'), r.path).toBe(true);
      expect(r.path, r.path).not.toMatch(/[?#]|\/$/);
      expect(r.file, r.file).toBe(`${r.path.slice(1)}.html`);
    }
  });
});

/**
 * The structured data the build emits must be valid JSON and must name the canonical
 * origin — not a placeholder, and not the dead host that made this whole audit
 * necessary. `index.html` is the source; the prerender substitutes `__SITE__`.
 */
describe('the JSON-LD in the source head', () => {
  // `npm test` runs vitest with `--root apps/fbizlab` from the REPO root, so the
  // process cwd is the repo root; running vitest inside the workspace makes it the
  // workspace. Resolve for both rather than depend on how it was invoked.
  const html = readFileSync(existsSync('index.html') ? 'index.html' : 'apps/fbizlab/index.html', 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json" id="(ld-[a-z]+)">([\s\S]*?)<\/script>/g)];

  it('parses as JSON once the origin token is substituted', () => {
    expect(blocks.length, 'no JSON-LD found at all').toBeGreaterThanOrEqual(2);
    for (const [, id, body] of blocks) {
      const filled = body.split('__SITE__').join('https://example.test');
      expect(() => JSON.parse(filled), `${id} is not valid JSON`).not.toThrow();
    }
  });

  it('every absolute URL in it is the token, never a literal host', () => {
    // The defect: five hardcoded `https://fbizlab.web.app` URLs, one of them inside
    // the JSON-LD, all pointing at a host that 404s. Nothing may name a host here.
    for (const [, id, body] of blocks) {
      // `@context` is `https://schema.org` by specification — it names the vocabulary,
      // not this site, and must stay literal. Everything else that is a URL is OUR
      // URL and must come from the token.
      const literals = [...body.matchAll(/"https?:\/\/[^"]*"/g)]
        .map((m) => m[0])
        .filter((u) => !u.includes('schema.org'));
      expect(literals, `${id} hardcodes an absolute URL instead of using __SITE__`).toEqual([]);
    }
  });

  it('declares an Organization that the WebApplication points at', () => {
    // One entity across four hosts (the apex, www, and the two Firebase domains that
    // canonicalize into it). A publisher reference that names nothing is decoration.
    const ids = blocks.map(([, id]) => id);
    expect(ids).toContain('ld-org');
    const org = JSON.parse(blocks.find(([, id]) => id === 'ld-org')![2]!.split('__SITE__').join('https://example.test'));
    const app = JSON.parse(blocks.find(([, id]) => id === 'ld-app')![2]!.split('__SITE__').join('https://example.test'));
    expect(org['@type']).toBe('Organization');
    expect(app.publisher?.['@id'], 'the WebApplication does not name the Organization').toBe(org['@id']);
  });
});
