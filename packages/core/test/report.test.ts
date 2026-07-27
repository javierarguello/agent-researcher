/**
 * End-to-end report generation with the mock provider — runs on every `npm test`.
 *
 * Its twin, `report.live.test.ts`, runs the SAME model and the SAME assertions
 * against a real local model (`TEST_LLM=ollama`). Keeping this one in the default
 * suite is what stops the live test from rotting: the pipeline and the
 * expectations stay exercised whether or not anyone has Docker running.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { __setProviderForTests } from '../src/llm/models.js';
import { validateTemplate } from '../src/templates/validate.js';
import { MockLlmProvider } from './mocks/llm.js';
import { compactModel, runModel } from './fixtures/compact-model.js';
import { expectUsableReport } from './fixtures/expect-report.js';

describe('report generation — full pipeline, mocked model', () => {
  beforeEach(() => {
    __setProviderForTests('gemini-vertex', new MockLlmProvider());
  });

  it('the compact model is well-formed', () => {
    expect(validateTemplate(compactModel)).toEqual([]);
  });

  it('produces a usable report: envelope, schema-valid sections, sources, cost', async () => {
    const out = await runModel(compactModel, { subject: 'laundromats for sale', location: 'Miami-Dade County, FL' }, 'e2e-mock-1');
    expect(out.trace.status).toBe('completed');
    expectUsableReport(out, compactModel); // a scripted model degrades nothing
  });

  it('carries the request language into the report', async () => {
    const out = await runModel(compactModel, { subject: 'lavanderías en venta', location: 'Miami-Dade County, FL', language: 'es' }, 'e2e-mock-es');
    expect(out.language).toBe('es');
    expect(out.meta.language).toBe('es');
  });
});
