/**
 * A re-dispatch must resume, not start over.
 *
 * This is the most expensive uncovered guard the suite had. `run-job` loads the
 * checkpoint with one line — `downloadObject(input.jobId, CHECKPOINT)` — and
 * replacing its result with `undefined` left all 329 core tests green. Every
 * re-dispatch would then re-run the whole research from zero: a second full
 * purchase of a paid report, per retry, up to eight of them, and the buyer's only
 * symptom is a slow job.
 *
 * Nothing covered it because every existing resume test hands `resume` straight to
 * `runResearch`. That exercises the engine's skip logic and says nothing about
 * whether anyone ever reads the checkpoint back off storage.
 *
 * Javier's standing rule is the sharper version of the same thing: a retry may only
 * reuse work that FINISHED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runJob } from '../src/engine/run-job.js';
import { createJob, getJob } from '../src/jobs/firestore.js';
import { installMockProvider } from './mocks/llm.js';
import { OBJECTS } from './mocks/storage.js';
import { compactModel } from './fixtures/compact-model.js';
import { __registerTemplateForTests, __clearTestTemplates } from '../src/templates/registry.js';
import { writableConfig } from './writable-config.js';

const APP = 'app1';
const USER = 'buyer@x.com';

const input = (jobId: string) => ({
  jobId, appId: APP, userId: USER, template: compactModel.id, params: {}, creditsSpent: 1,
});

const seed = (jobId: string) =>
  createJob({ jobId, appId: APP, userId: USER, templateId: compactModel.id, params: {}, status: 'queued' } as never);

/**
 * Fail the agent that owns `key`, so the dispatch ends `incomplete` with the OTHER
 * agent finished and saved. Returns the provider so the caller can count calls.
 */
function failing(key: string) {
  const mock = installMockProvider();
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    if (opts.responseSchema) {
      const keys = Object.keys((opts.responseSchema as { properties?: object }).properties ?? {});
      if (keys.includes(key)) return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    }
    return base(opts);
  };
  return mock;
}

beforeEach(() => {
  __clearTestTemplates();
  __registerTemplateForTests(compactModel);
  installMockProvider();
  // Two dispatches, and the second one finalizes. The default is 8, which would
  // need eight round trips to reach the same state.
  writableConfig.workflow.maxJobAttempts = 2;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a re-dispatch resumes from the checkpoint', () => {
  it('hands the engine the work the last dispatch finished', async () => {
    // The plumbing assertion, and the one the mutation kills: whatever the engine
    // decides to do with it, `run-job` has to READ the checkpoint back and pass it.
    await seed('res1');
    failing('recommendation');
    const first = await runJob(input('res1'));
    expect(first.status).toBe('incomplete');
    expect([...OBJECTS.keys()].some((k) => k.includes('res1') && k.includes('checkpoint'))).toBe(true);

    const engine = await import('../src/engine/research-engine.js');
    const spy = vi.spyOn(engine, 'runResearch');
    installMockProvider(); // second dispatch: everything succeeds
    await runJob(input('res1'));

    const resume = spy.mock.calls[0]?.[0]?.resume;
    expect(resume, 'run-job never read the checkpoint back').toBeDefined();
    // Non-vacuous: the first dispatch really did finish a step, and it is THAT step
    // the second dispatch is told about.
    expect(resume!.doneAgentIds).toContain('scout');
    expect(resume!.doneAgentIds).not.toContain('advisor');
  });

  it('does not buy the finished step’s research a second time', async () => {
    // The plumbing test above can be satisfied by passing a checkpoint the engine
    // then ignores. This is the money: the second dispatch must cost less than the
    // first, because the step that already finished is not re-run.
    await seed('res2');
    const firstMock = failing('recommendation');
    await runJob(input('res2'));
    const firstCalls = firstMock.calls;

    const secondMock = installMockProvider();
    await runJob(input('res2'));

    expect((await getJob('res2'))!.status).toBe('completed');
    // One of the two agents was already done, so the second dispatch cannot cost
    // what a from-scratch run costs. Asserted as a strict inequality rather than an
    // exact figure: the point is that work was reused, not how the fixture is shaped.
    expect(secondMock.calls, 'the second dispatch re-ran everything').toBeLessThan(firstCalls);
  });

  it('keeps what the finished step wrote, rather than regenerating it', async () => {
    // The buyer-visible half. Re-running is not only a second purchase — it is a
    // second, different answer for a section the report already had.
    await seed('res3');
    const mock = failing('recommendation');
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) => {
      const res = await base(opts);
      if (!opts.responseSchema) return res;
      const value = JSON.parse(res.text) as Record<string, unknown>;
      // Stamped INTO the section the schema demands, not over it: replacing the
      // shape makes the write fail validation, the agent degrade, and the test pass
      // for the wrong reason — the second dispatch would then re-run it either way.
      const findings = value.findings as { overview?: string } | undefined;
      if (findings) findings.overview = `FIRST PASS — ${findings.overview ?? ''}`;
      return { ...res, text: JSON.stringify(value) };
    };
    await runJob(input('res3'));

    // The second dispatch's model would write something else entirely.
    installMockProvider();
    await runJob(input('res3'));

    const raw = OBJECTS.get('researchs/res3/report.json');
    expect(raw, 'no report was delivered').toBeDefined();
    const delivered = JSON.parse(String(raw)) as { report: { findings: unknown } };
    expect(JSON.stringify(delivered.report.findings)).toContain('FIRST PASS');
  });
});
