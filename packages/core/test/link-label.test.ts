/**
 * A citation whose LABEL is the url again.
 *
 * Models write `[https://www.linkedin.com/posts/…-activity-7387468055867449344-bm7P](the same url)`
 * — 36 of the 165 prose links in the 2026-08-22 statewide run, 0 in the Tampa run
 * an hour before it. In the artifact the buyer keeps, that renders as a
 * 120-character unbreakable token in the middle of a sentence.
 *
 * What is asserted here is the RENDERED text, through `buildReportHtml`, because
 * the label is the thing a reader sees and `linkLabel` on its own cannot show
 * that the renderer actually calls it.
 */
import { describe, it, expect } from 'vitest';
import { buildReportHtml, linkLabel, stripEvidenceTags } from '../src/pdf/report-html.js';
import { getPdfTheme } from '../src/pdf/theme.js';

const LONG_URL = 'https://www.example-broker.test/reports/hvac-florida-2026?utm_source=news&utm_medium=email';

const html = (market: string) =>
  buildReportHtml({
    report: { market },
    sections: [{ key: 'market', title: 'Market' }],
    meta: {},
    lang: 'en',
    title: 'Dossier',
    generatedAt: '2026-08-22T00:00:00.000Z',
    theme: getPdfTheme('fbizlab'),
  } as never);

/** The visible text of every anchor in the document, in order. */
const anchorTexts = (out: string) => [...out.matchAll(/<a\b[^>]*>(.*?)<\/a>/g)].map((m) => m[1]!);

describe('a link labelled with its own url is shown as its host', () => {
  it('renders the host, not the query string, and keeps the url in the href', () => {
    const out = html(`Demand grew 15% ([${LONG_URL}](${LONG_URL})).`);

    // The premise: the paragraph really became an anchor rather than raw Markdown.
    expect(out).toContain('<a href=');
    expect(anchorTexts(out)).toContain('example-broker.test');
    // The reader never sees the url as words. Not `not.toContain(LONG_URL)` — the
    // href holds it and must: that assertion would pass on a renderer that dropped
    // the link entirely, which is the R9-3 silent-deletion failure, not a fix.
    expect(anchorTexts(out).some((t) => t.includes('utm_source'))).toBe(false);
    // Escaped ONCE. The `&` in the query string is `&amp;` in the attribute and not
    // `&amp;amp;`, which is the defect the escape comment above `mdInline` records.
    expect(out).toContain(`href="https://www.example-broker.test/reports/hvac-florida-2026?utm_source=news&amp;utm_medium=email"`);
  });

  it('leaves a label a human would write exactly as written', () => {
    const out = html(`See the [Florida DBPR licensing rules](${LONG_URL}).`);
    expect(anchorTexts(out)).toContain('Florida DBPR licensing rules');
  });

  it('leaves the same url alone when it is prose rather than a label', () => {
    // Only the anchor's text is ours to rewrite. A url the model wrote as a
    // sentence, with no link around it, is the model's sentence.
    const out = html(`The filing is at ${LONG_URL} for now.`);
    expect(out).toContain('utm_source=news');
  });
});

describe('linkLabel', () => {
  it('drops a leading www. so two spellings of one host read the same', () => {
    expect(linkLabel('https://www.bizbuysell.com/business/1')).toBe('bizbuysell.com');
    expect(linkLabel('https://bizbuysell.com/business/1')).toBe('bizbuysell.com');
  });

  it('clips a host with no length limit, like a Sources row does', () => {
    // `new URL().hostname` does not enforce IDNA's 253 octets, so an anchor's text
    // is otherwise unbounded — R10-8, for the twin bound one function below.
    const out = linkLabel(`https://${'a'.repeat(4000)}.test/x`);
    expect(Array.from(out).length).toBe(160);
    expect(out.endsWith('…')).toBe(true);
  });

  it('is not fooled by a scheme it does not render as a link', () => {
    // `javascript:` never becomes an anchor (`safeHref`/`mdInline` refuse it), so if
    // one reaches a label it is TEXT, and shortening text is not this function's job.
    expect(linkLabel('javascript:void(0)')).toBe('javascript:void(0)');
    expect(linkLabel('Bizbuysell — https://bizbuysell.com')).toBe('Bizbuysell — https://bizbuysell.com');
  });
});


describe('the engine’s own evidence tags never reach the page', () => {
  it('shows the source’s host where the model labelled a link with our tag', () => {
    // 77 of the 122 tags in the published sample are this shape: `[S2](https://…)`.
    // The url is real and stays; `S2` is our vocabulary and means nothing to a reader.
    const out = html(`The market grew 15% ([S2](${LONG_URL})).`);
    expect(anchorTexts(out)).toContain('example-broker.test');
    expect(out).not.toMatch(/>S2</);
    expect(out).toContain('href="https://www.example-broker.test');
  });

  it('removes a tag with nothing behind it, and the space it sat in', () => {
    // The other 45. `[S27]` resolves to nothing a reader can follow: the numbering is
    // per-agent (`rankEvidence` ordering of THAT writer's dossier) while the report's
    // Sources list is numbered over the whole store — so it is not source 27.
    const out = html('The licence does not transfer to the buyer [P3]. Plan for it.');
    expect(out).toContain('The licence does not transfer to the buyer. Plan for it.');
    expect(out).not.toContain('[P3]');
  });

  it('leaves a bracketed label that is not a tag exactly as written', () => {
    // `[Plumbing & HVAC SEO]` is a real link label from the same report. The digit is
    // what tells a tag from a name.
    const out = html(`See [Plumbing & HVAC SEO](${LONG_URL}) for the source.`);
    expect(anchorTexts(out)).toContain('Plumbing &amp; HVAC SEO');
  });
});

describe('stripEvidenceTags', () => {
  it('takes the multi-tag forms the model actually writes', () => {
    // Measured shapes across the five runs: [SN], [PN], [SN, SN], [SN, SN, SN], [SN, PN].
    expect(stripEvidenceTags('Multiples cluster at 3.6x [S18, S20, S25].')).toBe('Multiples cluster at 3.6x.');
    expect(stripEvidenceTags('Two sources agree [S4, P8] on this.')).toBe('Two sources agree on this.');
  });

  it('does not touch a tag that labels a link — that is `linkLabel`’s half', () => {
    const md = `see [S9](${LONG_URL}) for detail`;
    expect(stripEvidenceTags(md)).toBe(md);
  });

  it('is not fooled by ordinary bracketed prose', () => {
    expect(stripEvidenceTags('The seller [the current owner] retires.')).toBe('The seller [the current owner] retires.');
    expect(stripEvidenceTags('Section [S] of the lease.')).toBe('Section [S] of the lease.');
  });
});
