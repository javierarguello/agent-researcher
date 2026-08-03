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
  it('passes the report meta through, so degraded sections stay suppressed', async () => {
    const { renderJobPdf } = await import('../src/pdf.js');
    await renderJobPdf(job);

    expect(buildReportHtml).toHaveBeenCalledTimes(1);
    const arg = buildReportHtml.mock.calls[0]?.[0] as unknown as { meta?: { degradedSections?: string[] } };
    // Without this the renderer's whole degradation contract is dead code in
    // production while its own unit test stays green.
    expect(arg.meta?.degradedSections).toEqual(['verdict']);
  });

  it('passes the report itself, not the wrapper it was stored in', async () => {
    const { renderJobPdf } = await import('../src/pdf.js');
    await renderJobPdf(job);

    const arg = buildReportHtml.mock.calls[0]?.[0] as unknown as { report?: Record<string, unknown> };
    expect(arg.report).toEqual(REPORT.report);
  });
});
