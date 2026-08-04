/**
 * The PDF renderer is only as good as the argument it is handed.
 *
 * A review of the degradation fix found that `meta: parsed.meta` here is the ONLY
 * production caller of `buildReportHtml`, and deleting it left every suite green
 * while the shipped PDF went back to printing a recommendation the engine never
 * made at a price of zero. The core test drives `buildReportHtml` directly, so it
 * proves the function and not the product.
 *
 * This asserts the wiring: what the worker reads out of storage is what the
 * renderer is given.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The renderer resolves a Chromium binary before it builds anything; the launch
// itself is stubbed below, so any path satisfies the check.
process.env.PUPPETEER_EXECUTABLE_PATH ||= '/bin/true';

const buildReportHtml = vi.fn((_input: unknown) => '<html></html>');
const downloadObject = vi.fn();

vi.mock('@agent-researcher/core', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    buildReportHtml,
    downloadObject,
    uploadObject: vi.fn(async () => ({ name: 'report.pdf', path: 'x', contentType: 'application/pdf', size: 1 })),
    addJobFile: vi.fn(async () => {}),
  };
});

// Chromium is not available (and not the point): the assertion is about the
// arguments, so the render itself is stubbed.
vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(async () => ({
      newPage: async () => ({
        setContent: async () => {},
        evaluate: async () => {},
        emulateMediaType: async () => {},
        addStyleTag: async () => {},
        pdf: async () => Buffer.from('%PDF'),
        close: async () => {},
      }),
      close: async () => {},
    })),
  },
}));

const REPORT = {
  meta: { sections: [{ key: 'verdict', status: 'lost' }], mode: 'essential' },
  report: { verdict: { recommendation: 'buy', price: 0 } },
};

/** A report.json written before `degradedSections` was renamed. Still in the
 *  bucket, still re-rendered on demand, still has to reach the coercion. */
const LEGACY_REPORT = {
  meta: { degradedSections: ['verdict'], mode: 'essential' },
  report: { verdict: { recommendation: 'buy', price: 0 } },
};

const job = {
  jobId: 'j1', appId: 'fbizlab', userId: 'u@x.com', template: 'florida-business-for-sale',
  params: { language: 'en' }, status: 'completed', files: [],
} as never;

beforeEach(() => {
  buildReportHtml.mockClear();
  downloadObject.mockResolvedValue(JSON.stringify(REPORT));
});

describe('what the worker hands the PDF renderer', () => {
  it('passes the section statuses through, so a lost section stays suppressed', async () => {
    const { renderJobPdf } = await import('../src/pdf.js');
    await renderJobPdf(job);

    expect(buildReportHtml).toHaveBeenCalledTimes(1);
    const arg = buildReportHtml.mock.calls[0]?.[0] as unknown as { meta?: { sections?: unknown } };
    // Pinned to the FIELD the renderer reads, not to pass-through of some key.
    // This assertion used to name `degradedSections`, and stayed green through
    // the rename that made the renderer stop honouring it — in the one test
    // written because that contract had been dead in production before.
    expect(arg.meta?.sections).toEqual([{ key: 'verdict', status: 'lost' }]);
  });

  it('passes a pre-rename meta through untouched, for the coercion to read', async () => {
    // The worker must not "clean up" what it forwards: every report.json in the
    // bucket older than the rename says `degradedSections`, and dropping it here
    // puts the fabricated body back in the PDF with no notice anywhere.
    downloadObject.mockResolvedValue(JSON.stringify(LEGACY_REPORT));
    const { renderJobPdf } = await import('../src/pdf.js');
    await renderJobPdf(job);

    const arg = buildReportHtml.mock.calls[0]?.[0] as unknown as { meta?: { degradedSections?: unknown } };
    expect(arg.meta?.degradedSections).toEqual(['verdict']);
  });

  it('passes the report itself, not the wrapper it was stored in', async () => {
    const { renderJobPdf } = await import('../src/pdf.js');
    await renderJobPdf(job);

    const arg = buildReportHtml.mock.calls[0]?.[0] as unknown as { report?: Record<string, unknown> };
    expect(arg.report).toEqual(REPORT.report);
  });
});
