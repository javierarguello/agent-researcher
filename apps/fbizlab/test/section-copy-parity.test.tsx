/**
 * The viewer's per-section lines, held to core's table.
 *
 * The same sentence exists three times — the notice above the report, the PDF the
 * buyer downloads, and this viewer — and a wording fix landed in one of them. The
 * French buyer kept reading `la passe`, a sports pass, under the section on
 * screen and in the PDF they forward; the Portuguese one `a passagem`, a
 * passageway. The core test that was meant to pin the fix only read the notice,
 * so both remaining copies stayed wrong and green.
 *
 * This app is a static bundle with no dependency on `@agent-researcher/core`, so
 * it cannot import the strings — it imports the FIXTURE across the workspace
 * boundary, the way `section-status-parity.test.tsx` already imports
 * `LEGACY_SHAPES`. Edit one copy and the other suite goes red.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReportViewer, RL } from '../src/components/ReportViewer';
import { KNOWN_STATUSES } from '../src/lib/section-status';
import { LINE_FOR_STATUS, SECTION_LINES, SECTION_STATUSES, WRONG_STEP_WORDS } from '../../../packages/core/test/fixtures/section-lines';

describe('the viewer prints the canonical section line', () => {
  it.each(Object.entries(SECTION_LINES))('%s says what core says, key for key', (lang, lines) => {
    for (const [key, sentence] of Object.entries(lines)) {
      expect(RL[lang as 'en']?.[key], `${lang}.${key}`).toBe(sentence);
    }
  });

  it('calls a processing step a step, not a sports pass or a passageway', () => {
    for (const [lang, wrong] of Object.entries(WRONG_STEP_WORDS)) {
      expect(RL[lang as 'es']?.unenrichedSection, lang).not.toMatch(wrong);
    }
  });
});

describe('the reassurance is conditional, on this surface too (round 9, R9-7)', () => {
  it('is not repeated under every gap, and is not said when something else is wrong either', () => {
    // The PDF half is pinned in core; this is the same rule on the screen the buyer
    // reads first. Mutation that reds this: render `allElseOk` unconditionally.
    const report = { a: { text: 'x' }, b: { text: 'y' } };
    const sections = [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }];
    const count = (meta: unknown) => {
      const { container, unmount } = render(<ReportViewer report={report} sections={sections} meta={meta as never} lang="en" />);
      const n = (container.textContent?.match(/Everything else was researched and written as usual/g) ?? []).length;
      unmount();
      return n;
    };
    expect(count({ sections: [{ key: 'a', status: 'lost' }, { key: 'b', status: 'lost' }] }), 'two gaps').toBe(0);
    expect(count({ sections: [{ key: 'a', status: 'lost' }, { key: 'b', status: 'unenriched' }] }), 'a gap and a shallow one').toBe(0);
    expect(count({ sections: [{ key: 'a', status: 'lost' }] }), 'the only thing wrong').toBe(1);
  });
});

describe('every status the engine can write prints something here too (round 9, R9-21)', () => {
  it.each([...SECTION_STATUSES])('the viewer prints the %s line', (status) => {
    const { container } = render(
      <ReportViewer
        report={{ market: { text: 'Laundromat demand in Miami-Dade grew 12% year over year.' } }}
        sections={[{ key: 'market', title: 'Market' }]}
        meta={{ sections: [{ key: 'market', status }] } as never}
        lang="en"
      />,
    );
    expect(container.textContent, status).toContain(SECTION_LINES.en[LINE_FOR_STATUS[status]]);
  });
});

describe('this bundle knows every status the engine can write', () => {
  // R8-17: an unrecognised status is coerced to `lost`, and `lost` is the one
  // status whose body is SUPPRESSED. A browser holding a bundle from before
  // `reconstructed` existed therefore hid a section with real content, under a
  // sentence saying everything else was researched as usual, while the
  // server-rendered PDF of the same report showed it. Nothing fixes a bundle
  // already in a cache; this pins the next one — a status added to the engine is
  // red here until this reader knows it.
  it('recognises exactly core’s set', () => {
    expect([...KNOWN_STATUSES].sort()).toEqual([...SECTION_STATUSES].sort());
  });
});
