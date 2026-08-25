/**
 * The prices a crawler is TOLD about must be prices it can SEE.
 *
 * `Product`/`Offer` structured data is the one kind Google issues manual actions
 * over, and the rule it enforces is simple: the marked-up value has to be visible
 * content on the page. Until 2026-08-25 the landing failed that test in the honest
 * direction — `grep '$29'` on the served HTML returned **zero**, because the prices
 * were fetched client-side from `/plans.json`. So the markup could not be added at
 * all, which is why P-14 listed it as blocked rather than missing.
 *
 * Baking the cards unblocked it, and this file pins the equivalence rather than the
 * markup: one source (`dist/plans.json`), rendered twice — once as cards a person
 * reads and once as JSON-LD a crawler reads — and the two must agree.
 *
 * The first block runs ALWAYS, against the renderers themselves with a fixture
 * catalog. That matters: `npm test` runs before `npm run build` in CI, so a suite
 * that only inspected `dist/` would skip every time and protect nothing — which is
 * exactly what the first version of this file did.
 *
 * The second block additionally inspects a REAL build when one is present, which is
 * the local and post-build case. It skips rather than passes when `dist/` is absent,
 * because a green tick on a test that checked nothing is worse than a skip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderLandingStatic } from '../scripts/landing-static.mjs';
import { offersLd } from '../scripts/prerender-seo.mjs';

const SITE = 'https://floridabizlabs.com';
/** A catalog shaped exactly like `dist/plans.json`'s per-language arrays. */
const FIXTURE = [
  { planId: 'scout', name: 'Scout Pack', priceUsd: 29, credits: 30, sub: 'Curious buyers', features: ['≈1 comprehensive or 3 essential'] },
  { planId: 'investor', name: 'Investor Pack', priceUsd: 69, credits: 120, sub: 'Active searchers', features: ['≈6 comprehensive'], popular: true },
  { planId: 'syndicate', name: 'Syndicate Pack', priceUsd: 129, credits: 240, sub: 'Funds', features: ['≈13 comprehensive'] },
];

/** Everything outside a <script> — what a reader and a crawler both count as content. */
const visibleOf = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');

describe('prices in the served markup', () => {
  const html = renderLandingStatic('en', FIXTURE as never);
  const body = visibleOf(html);

  it('renders every price, credit count and pack name as real text', () => {
    // The defect: `grep '$29'` on the served HTML returned ZERO, because the cards
    // were painted by JavaScript from `/plans.json`. A crawler saw a pricing section
    // that was a heading with nothing under it.
    for (const p of FIXTURE) {
      expect(body, `$${p.priceUsd} missing`).toContain(`$${p.priceUsd}`);
      expect(body, `${p.name} missing`).toContain(p.name);
      expect(body, `${p.credits} credits missing`).toContain(`>${p.credits}<`);
    }
    expect((body.match(/class="card plan/g) ?? []).length).toBe(FIXTURE.length);
  });

  it('uses the same classes PlanCard.tsx does, so React replaces rather than reflows', () => {
    // This morning `landing-static.mjs` emitted `section.container` where
    // `Landing.tsx` emits `section.hero-shot`; the hero photo is a CSS background on
    // the missing class, so it could not be discovered until hydration. Two files
    // describing one markup drift, and this is the one nobody looks at.
    for (const cls of ['card plan', 'tag-popular', 'price', 'metric', 'bullet', 'btn--accent', 'plans']) {
      expect(body, `.${cls} is missing from the static landing`).toContain(cls);
    }
  });

  it('falls back to the "no plans" line rather than an empty section', () => {
    const empty = visibleOf(renderLandingStatic('en', [] as never));
    expect(empty).not.toContain('class="card plan');
    expect(empty, 'an empty catalog renders a heading with nothing under it').toMatch(/soft mono/);
  });
});

describe('the Offer markup', () => {
  const ld = JSON.parse(offersLd(FIXTURE, SITE, 'en')!);
  const body = visibleOf(renderLandingStatic('en', FIXTURE as never));

  it('claims only prices the page actually shows — the rule Google penalises', () => {
    for (const entry of ld.itemListElement) {
      const price = Number(entry.item.offers.price);
      expect(body, `Offer claims $${price} and the page does not show it`).toContain(`$${price}`);
      expect(body, `Offer names "${entry.item.name}" and the page does not show it`).toContain(entry.item.name);
    }
  });

  it('covers every pack, in order, with a currency and an availability', () => {
    expect(ld.itemListElement).toHaveLength(FIXTURE.length);
    ld.itemListElement.forEach((e: Record<string, never>, i: number) => {
      expect(e.position).toBe(i + 1);
      expect(e.item.offers.priceCurrency).toBe('USD');
      expect(e.item.offers.availability).toBe('https://schema.org/InStock');
    });
  });

  it('ties every offer to the Organization rather than leaving it anonymous', () => {
    for (const entry of ld.itemListElement) {
      expect(entry.item.brand['@id']).toBe(`${SITE}/#organization`);
      expect(entry.item.offers.seller['@id']).toBe(`${SITE}/#organization`);
    }
  });

  it('invents no priceValidUntil — we do not know when a price expires', () => {
    // Structured data is a set of claims. A date nobody decided is a made-up claim,
    // and an expired one makes Google drop the offer outright.
    expect(JSON.stringify(ld)).not.toContain('priceValidUntil');
  });

  it('returns nothing at all for an empty catalog', () => {
    expect(offersLd([], SITE, 'en')).toBeNull();
  });

  it('points each language at its own landing', () => {
    const es = JSON.parse(offersLd(FIXTURE, SITE, 'es')!);
    expect(es.itemListElement[0].item.offers.url).toBe(`${SITE}/es#pricing`);
    expect(ld.itemListElement[0].item.offers.url).toBe(`${SITE}/#pricing`);
  });
});

const root = existsSync('index.html') ? '.' : 'apps/fbizlab';
const dist = `${root}/dist`;
const built = existsSync(`${dist}/index.html`) && existsSync(`${dist}/plans.json`);

// And the same equivalence against a REAL build, when one is present.
describe.skipIf(!built)('a real build on disk', () => {
  const html = () => readFileSync(`${dist}/index.html`, 'utf8');
  const offers = () => {
    const m = html().match(/id="ld-offers">([\s\S]*?)<\/script>/);
    return JSON.parse(m![1]!);
  };
  /** Everything outside a <script> — what a reader and a crawler both count as content. */
  const visible = () => html().replace(/<script[\s\S]*?<\/script>/g, '');

  it('shows every price in the served HTML, not just after JavaScript runs', () => {
    const plans = JSON.parse(readFileSync(`${dist}/plans.json`, 'utf8')).en as Array<{ priceUsd: number; credits: number; name: string }>;
    expect(plans.length, 'the catalog is empty — nothing to check').toBeGreaterThan(0);
    for (const p of plans) {
      expect(visible(), `$${p.priceUsd} is not in the served HTML`).toContain(`$${p.priceUsd.toLocaleString('en')}`);
      expect(visible(), `${p.name} is not in the served HTML`).toContain(p.name);
      expect(visible(), `${p.credits} credits not shown`).toContain(`>${p.credits}<`);
    }
  });

  it('marks up only prices that are visible — the rule Google penalises', () => {
    const body = visible();
    for (const entry of offers().itemListElement) {
      const price = Number(entry.item.offers.price);
      expect(body, `Offer claims $${price} but the page does not show it`).toContain(`$${price.toLocaleString('en')}`);
      expect(body, `Offer names "${entry.item.name}" but the page does not show it`).toContain(entry.item.name);
    }
  });

  it('marks up EVERY pack, not a stale subset', () => {
    const plans = JSON.parse(readFileSync(`${dist}/plans.json`, 'utf8')).en as Array<{ name: string }>;
    const marked = offers().itemListElement.map((e: { item: { name: string } }) => e.item.name);
    expect(marked.sort()).toEqual(plans.map((p) => p.name).sort());
  });

  it('ties every offer to the Organization rather than leaving it anonymous', () => {
    const org = JSON.parse(html().match(/id="ld-org">([\s\S]*?)<\/script>/)![1]!);
    for (const entry of offers().itemListElement) {
      expect(entry.item.brand['@id']).toBe(org['@id']);
      expect(entry.item.offers.seller['@id']).toBe(org['@id']);
    }
  });

  it('leaves the pages with no prices unmarked', () => {
    // `/sample`, `/privacy` and the rest show no pricing, so an Offer block there
    // would be markup for content that is not on the page — the same defect in
    // miniature.
    for (const f of ['sample.html', 'privacy.html']) {
      if (!existsSync(`${dist}/${f}`)) continue;
      const m = readFileSync(`${dist}/${f}`, 'utf8').match(/id="ld-offers">([\s\S]*?)<\/script>/);
      expect(m?.[1]?.trim(), `${f} carries Offer markup and shows no prices`).toBe('');
    }
  });
});
