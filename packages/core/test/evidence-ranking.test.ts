/**
 * Which of a shared store's evidence a writer gets to see, and in what order.
 *
 * The store is shared by every agent and filled in insertion order, and the
 * dossier used to render its first 48 snippets / 14 pages. Measured on the two
 * real July runs: wave 1 consumed the 48 in six searches, so every later producer
 * — and the deal-scout building the shortlist — wrote blind to the results its own
 * loop paid for. From outside it is the same mechanism: one steered scout floods
 * the store and an honest peer's own page is in the checkpoint but not in its
 * prompt. `rankEvidence` is the fix; these pin its properties, not a number.
 */
import { describe, it, expect } from 'vitest';
import { rankEvidence, urlsIn, buildProducerSynthPrompt } from '../src/engine/prompt.js';
import { z } from 'zod';

const u = (host: string, n: number) => ({ url: `https://${host}/p/${n}` });
const list = (host: string, n: number, from = 1) => Array.from({ length: n }, (_, i) => u(host, from + i));

describe('rankEvidence · own first, then referenced, then the rest', () => {
  it('a writer’s own fetched pages come first, whatever position they hold in the store', () => {
    // Store: 20 pages a peer fetched first, then the writer's 3.
    const store = [...list('peer.example', 20), ...list('mine.example', 3)];
    const fetched = new Set(list('mine.example', 3).map((x) => x.url));
    const out = rankEvidence(store, 14, 3, { fetched });
    // Mutation that reds this: return `items.slice(0, max)`.
    expect(out.slice(0, 3).map((x) => x.url)).toEqual([...fetched]);
    expect(out).toHaveLength(14);
  });

  it('fetched outranks everything, and referenced outranks touched — an unread SERP row must not push out a URL the writer was told to fill gaps in', () => {
    const store = [u('a.example', 1), u('b.example', 1), u('c.example', 1), u('d.example', 1)];
    const out = rankEvidence(store, 4, 9, {
      fetched: new Set([u('d.example', 1).url]),
      touched: new Set([u('c.example', 1).url, u('d.example', 1).url]),
      referenced: new Set([u('b.example', 1).url]),
    });
    // `referenced` used to be LAST, which is why it never rendered in production
    // (R7-2): `touched` is every url a search returned, 8 per query. Mutation that
    // reds this: merge `fetched` into `touched` (one tier), or put `touched` back
    // above `referenced`.
    expect(out.map((x) => x.url)).toEqual([u('d.example', 1).url, u('b.example', 1).url, u('c.example', 1).url, u('a.example', 1).url]);
  });

  it('the referenced tier holds back slots its own fetches cannot take — sized by the set, and 0 when nothing is referenced', () => {
    // The production shape: a writer whose own loop alone would fill every slot.
    const own = list('mine.example', 48);
    const store = [...own, ...list('shortlist.example', 12)];
    const prefer = {
      fetched: new Set(own.map((x) => x.url)),
      referenced: new Set(list('shortlist.example', 12).map((x) => x.url)),
    };
    const out = rankEvidence(store, 48, 8, prefer);
    // Mutation that reds this: `const reserve = 0`.
    expect(out.filter((x) => x.url.includes('shortlist.example'))).toHaveLength(12);
    expect(out.filter((x) => x.url.includes('mine.example'))).toHaveLength(36);
    // …and a writer with nothing referenced keeps every slot it had before.
    const none = rankEvidence(store, 48, 8, { fetched: prefer.fetched });
    expect(none.filter((x) => x.url.includes('mine.example'))).toHaveLength(48);
    // The reserve is capped at half, so a huge referenced set cannot take the page
    // over: 12 of 48 here, but 24 would be the most it could ever hold back.
    const many = rankEvidence([...own, ...list('shortlist.example', 40)], 48, 8, {
      fetched: prefer.fetched,
      referenced: new Set(list('shortlist.example', 40).map((x) => x.url)),
    });
    expect(many.filter((x) => x.url.includes('mine.example'))).toHaveLength(24);
  });

  it('with no preference at all, everything is the foreign tier: diversity-first, then store order — and with a cap larger than any host, exactly the store order', () => {
    const store = [...list('x.example', 5), ...list('y.example', 5)];
    expect(rankEvidence(store, 6, 3).map((x) => x.url)).toEqual([...list('x.example', 3), ...list('y.example', 3)].map((x) => x.url));
    expect(rankEvidence(store, 6, 99, {})).toEqual(store.slice(0, 6));
  });
});

describe('rankEvidence · the per-domain cap decides ORDER in the foreign tier, never volume', () => {
  it('a farm of one host no longer pushes every other host out of the first pass', () => {
    // A steered peer fetched 20 farm pages first; two honest hosts fetched one page each after.
    const store = [...list('farm.example', 20), u('honest-a.example', 1), u('honest-b.example', 1)];
    const out = rankEvidence(store, 14, 3, {});
    const hosts = out.map((x) => new URL(x.url).hostname);
    // Mutation that reds this: drop the per-host pass (append `rest` in store order).
    expect(hosts.slice(0, 5)).toEqual(['farm.example', 'farm.example', 'farm.example', 'honest-a.example', 'honest-b.example']);
    // …and the dossier is still FULL: the farm fills what is left.
    expect(out).toHaveLength(14);
    expect(hosts.filter((h) => h === 'farm.example')).toHaveLength(12);
  });

  it('a store that is legitimately 90% one marketplace still fills every slot', () => {
    const store = [...list('bizbuysell.example', 45), ...list('loopnet.example', 3)];
    const out = rankEvidence(store, 48, 8, {});
    // Mutation that reds this: `continue` past the cap without deferring.
    expect(out).toHaveLength(48);
    // …with the minority host in the first pass, ahead of the ninth bizbuysell result.
    expect(out.slice(0, 11).map((x) => new URL(x.url).hostname).filter((h) => h === 'loopnet.example')).toHaveLength(3);
  });

  it('the cap does not touch the writer’s own tier: twelve listings it fetched from one marketplace all render', () => {
    const own = list('bizbuysell.example', 12);
    const store = [...list('other.example', 10), ...own];
    const out = rankEvidence(store, 14, 3, { fetched: new Set(own.map((x) => x.url)) });
    // Mutation that reds this: apply `perDomain` before splitting the tiers.
    expect(out.slice(0, 12)).toEqual(own);
  });

  it('www. and a malformed URL do not break the host grouping', () => {
    const store = [{ url: 'https://www.a.example/1' }, { url: 'https://a.example/2' }, { url: 'not a url' }, { url: 'https://b.example/1' }];
    const out = rankEvidence(store, 4, 1, {});
    // a.example counted once for both spellings, so the second is deferred behind b.example.
    expect(out.map((x) => x.url)).toEqual(['https://www.a.example/1', 'not a url', 'https://b.example/1', 'https://a.example/2']);
  });
});

describe('urlsIn · the URLs a writer is handed in its sections', () => {
  it('finds sourceUrl values and Markdown links inside nested sections, and nothing else', () => {
    const current = {
      shortlist: [{ business: 'X', sourceUrl: 'https://listing.example/x?id=1&ref=2' }],
      notes: 'See [the profile](https://wiki.example/w/Hialeah,_Florida_(city)) and https://plain.example/p.',
    };
    const found = urlsIn(current);
    expect(found.has('https://listing.example/x?id=1&ref=2')).toBe(true);
    expect(found.has('https://plain.example/p')).toBe(true);
    // A URL with balanced parens loses its trailing `)` here — that is the price
    // of a regex over JSON, and it only affects the REFERENCED tier's matching.
    expect([...found].some((x) => x.startsWith('https://wiki.example/w/Hialeah'))).toBe(true);
    expect(found.size).toBe(3);
    expect(urlsIn(undefined).size).toBe(0);
    expect(urlsIn({}).size).toBe(0);
  });
});


// --- The production caller (R7-31 / G1-verify F4) ------------------------------
//
// Every test above passes its OWN `perDomain`, so the per-host pass is pinned and
// the values production actually uses are not: setting `FOREIGN_PER_DOMAIN_PAGES`
// and `FOREIGN_PER_DOMAIN_SNIPPETS` to 999 — i.e. turning diversity-first off in
// production — left the whole core suite green. That is standing lesson 1 in
// miniature: the guard is tested, the caller is not. These go through the prompt
// builder the engine calls, with no `perDomain` of their own.
describe('the dossier a writer actually receives is diversity-first', () => {
  const agent = { id: 'scout', role: 'producer' as const, objective: 'Find things.', produces: ['findings'] };
  const sections = [{ key: 'findings', title: 'Findings', guidance: 'Write it.', schema: z.object({ text: z.string() }) }];
  /** 20 pages from one host, then one page each from two others — the farm shape. */
  const pages = [
    ...Array.from({ length: 20 }, (_, i) => ({ url: `https://farm.example/p/${i + 1}`, ok: true, content: `FARM-${i + 1}` })),
    { url: 'https://honest-a.example/p/1', ok: true, content: 'HONEST-A' },
    { url: 'https://honest-b.example/p/1', ok: true, content: 'HONEST-B' },
  ];
  const results = pages.map((p, i) => ({ url: p.url, title: `T${i}`, snippet: `S${i}` }));

  const prompt = () =>
    buildProducerSynthPrompt({
      agent, brief: 'Find things.', sections, evidence: results, extracted: pages, context: {}, lang: 'en',
    } as never);

  it('puts a minority host in front of the farm’s fourth page — the cap production runs with, through the builder', () => {
    // Mutation that reds this: `FOREIGN_PER_DOMAIN_PAGES = 999`.
    const order = [...prompt().matchAll(/\[P\d+\] Full page content — (\S+)/g)].map((m) => new URL(m[1]!).hostname);
    expect(order.slice(0, 5)).toEqual(['farm.example', 'farm.example', 'farm.example', 'honest-a.example', 'honest-b.example']);
  });

  it('…and the same for snippets, whose cap is a different number', () => {
    // Mutation that reds this: `FOREIGN_PER_DOMAIN_SNIPPETS = 999`. Eight, not three:
    // a snippet is one line, so a store that is legitimately one marketplace still
    // reads as one marketplace.
    const hosts = [...prompt().matchAll(/\n\s+URL: (\S+)/g)].map((m) => new URL(m[1]!).hostname);
    expect(hosts.slice(0, 10)).toEqual([
      ...Array.from({ length: 8 }, () => 'farm.example'),
      'honest-a.example',
      'honest-b.example',
    ]);
  });

  it('and the dossier is still FULL — the cap decides order, never volume', () => {
    const p = prompt();
    expect([...p.matchAll(/\[P\d+\] Full page content/g)]).toHaveLength(14);
    expect([...p.matchAll(/\n\s+URL: /g)].length).toBe(22);
  });
});
