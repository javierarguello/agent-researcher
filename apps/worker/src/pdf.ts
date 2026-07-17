/**
 * On-demand PDF rendering for a completed report. The API enqueues a `render-pdf`
 * task when a user first downloads the PDF; this renders the SHARED report HTML
 * (from core, themed per app) to PDF with headless Chromium, uploads it as
 * `report.pdf`, and appends it to the job's files. Idempotent: if `report.pdf`
 * already exists, it's returned untouched (never regenerated).
 */
import puppeteer, { type Browser } from 'puppeteer-core';
import {
  addJobFiles,
  buildReportHtml,
  downloadObject,
  getPdfTheme,
  getTemplate,
  toManifest,
  uploadObject,
  type JobFile,
  type ResearchJob,
} from '@agent-researcher/core';

const PDF_NAME = 'report.pdf';

/** Resolve the Chromium binary — set by the Docker image (or a local Chrome for dev). */
function executablePath(): string {
  const p = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!p) throw new Error('PUPPETEER_EXECUTABLE_PATH is not set (Chromium binary path).');
  return p;
}

let browserPromise: Promise<Browser> | undefined;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: executablePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
  }
  return browserPromise;
}

/** Render (or reuse) a completed job's report.pdf and return its file descriptor. */
export async function renderJobPdf(job: ResearchJob): Promise<JobFile> {
  const existing = (job.files ?? []).find((f) => f.name === PDF_NAME);
  if (existing) return existing;

  const raw = await downloadObject(job.jobId, 'report.json');
  if (!raw) throw new Error('report.json not found — cannot render PDF.');
  const parsed = JSON.parse(raw) as { meta?: Record<string, unknown>; report: Record<string, unknown> };

  const template = getTemplate(job.template);
  const lang = (job.params?.language as string) || 'en';
  const manifest = template ? toManifest(template, lang) : undefined;
  const sections = manifest?.sections.map((s) => ({ key: s.key, title: s.title }));

  const html = buildReportHtml({
    report: parsed.report,
    meta: parsed.meta,
    sections,
    title: job.title ?? undefined,
    params: job.params,
    lang,
    theme: getPdfTheme(job.appId),
    generatedAt: job.finishedAt ?? job.updatedAt,
  });

  const browser = await getBrowser();
  const page = await browser.newPage();
  let pdf: Buffer;
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    // Wait for the web fonts (@import Inter/JetBrains Mono) to load so the PDF uses
    // them instead of a fallback face.
    await page.evaluate('document.fonts.ready').catch(() => {});
    // preferCSSPageSize honors our `@page { size: letter; margin: 0 }`; the report's
    // own padding is the margin, so bleed backgrounds (cover) reach the page edge.
    const out = await page.pdf({ printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    pdf = Buffer.from(out);
  } finally {
    await page.close();
  }

  const file = await uploadObject({ jobId: job.jobId, name: PDF_NAME, data: pdf, contentType: 'application/pdf' });
  await addJobFiles(job.jobId, [file]);
  return file;
}
