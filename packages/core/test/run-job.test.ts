import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => ({
  searchWeb: async () => [{ title: 't', url: `https://x.com/${Math.random()}`, snippet: 's' }],
  extractPages: async (urls: string[]) => urls.map((url) => ({ url, ok: true, content: 'page' })),
}));
vi.mock('../src/storage/gcs.js', () => ({
  uploadObject: async ({ name }: { name: string }) => ({ name, path: `researchs/j/${name}`, contentType: 'application/json', size: 10 }),
  downloadObject: async () => undefined,
  deleteObject: async () => {},
  signJobFiles: async (f: unknown) => f,
  listJobFiles: async () => [],
  signRead: async () => '',
}));

import { runJob } from '../src/engine/run-job.js';
import { getJob, createJob, setJobAttempts } from '../src/jobs/firestore.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';

function captureLogs(): { logs: Record<string, unknown>[]; restore: () => void } {
  const lines: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation((x) => void lines.push(String(x)));
  const e = vi.spyOn(console, 'error').mockImplementation((x) => void lines.push(String(x)));
  return {
    get logs() {
      return lines.map((s) => { try { return JSON.parse(s); } catch { return {}; } });
    },
    restore: () => { l.mockRestore(); e.mockRestore(); },
  } as any;
}

describe('run-job — a failing agent leaves a trace in Firestore + logs', () => {
  const template = getTemplate('florida-business-for-sale')!;
  beforeEach(() => {
    // Fail any synthesis that includes market_overview → that agent degrades.
    const mock = new MockLlmProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) => {
      if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes('market_overview')) {
        return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return base(opts);
    };
    __setProviderForTests('gemini-vertex', mock);
  });

  it('records degradedSections + agentErrors on the job doc and logs agent.failed', async () => {
    const params = template.paramsSchema.parse({ industry: 'laundromats', mode: 'essential' }) as Record<string, unknown>;
    // Seed on the final attempt (MAX_JOB_ATTEMPTS=2) so it finalizes/degrades this run.
    await createJob({ jobId: 'j1', appId: 'fbizlab', userId: 'u@x.com', template: template.id, params });
    await setJobAttempts('j1', 1);
    const cap = captureLogs();
    const result = await runJob({ jobId: 'j1', appId: 'fbizlab', userId: 'u@x.com', template: template.id, params });
    cap.restore();

    // The job completed (degraded, not failed) — the user still gets a report.
    expect(result.status).toBe('completed');

    const job = (await getJob('j1'))!;
    expect(job.status).toBe('completed');
    expect(job.summary?.degradedSections).toContain('market_overview');
    expect((job.summary?.agentErrors ?? []).length).toBeGreaterThan(0);

    // The failure is in the logs, at ERROR severity, bound to the ids.
    const failed = cap.logs.find((e) => e.event === 'agent.failed');
    expect(failed).toBeTruthy();
    expect(failed!.severity).toBe('ERROR');
    expect(failed!.jobId).toBe('j1');
    expect(failed!.appId).toBe('fbizlab');
  });
});
