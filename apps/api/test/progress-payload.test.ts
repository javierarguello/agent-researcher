/**
 * What a buyer's poll of a running job is handed, versus the admin.
 *
 * `progress.message` is the engine's own English sentence — `Writing
 * (market_overview, competitive_landscape).` — and it was handed to the buyer raw:
 * English whatever language they bought in, internal section keys, and whatever
 * a web page had talked the model into searching for (the M red team put a
 * phishing sentence there, 4,010 characters long, through one search query). The
 * buyer now gets the KIND of step, which the client localizes, and — only for a
 * search — the query, clipped, which the client shows quoted as a query. The
 * admin still gets the sentence.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index.js';
import { createJob, setJobStatus, setProgress, PROGRESS_DETAIL_MAX } from '@agent-researcher/core';
import { seedApp, seedAdmin, token, auth } from './helpers.js';

const APP = 'fbizlab';
const BUYER = 'buyer@x.com';

async function jobWithProgress(jobId: string, progress: Parameters<typeof setProgress>[1]) {
  await createJob({ jobId, appId: APP, userId: BUYER, template: 'florida-business-for-sale', params: { language: 'es' } });
  await setJobStatus(jobId, 'running');
  await setProgress(jobId, progress);
}

describe('the buyer’s progress line is a KIND, not the engine’s sentence', () => {
  beforeEach(async () => {
    await seedApp(APP);
    await seedAdmin(['boss@x.com']);
  });

  it('a `writing` step: the buyer gets {phase, kind, updatedAt} and no message; the admin gets the sentence too', async () => {
    await jobWithProgress('p1', {
      phase: 'market-analyst', message: 'Writing (market_overview, competitive_landscape).', kind: 'writing',
      turnsUsed: 4, sourcesFound: 12, updatedAt: '2026-08-17T00:00:00.000Z',
    });
    const buyer = await app.inject({ method: 'GET', url: '/research/p1', headers: auth(await token(APP, BUYER)) });
    expect(buyer.statusCode).toBe(200);
    // Mutation that reds this: hand non-admins `job.progress` (or `{ phase, message, … }`) again.
    expect(buyer.json().progress).toEqual({ phase: 'market-analyst', kind: 'writing', updatedAt: '2026-08-17T00:00:00.000Z' });
    expect(JSON.stringify(buyer.json().progress)).not.toContain('market_overview');

    const admin = await app.inject({ method: 'GET', url: '/research/p1', headers: auth(await token('admin', 'boss@x.com', 'admin')) });
    expect(admin.json().progress).toMatchObject({ phase: 'market-analyst', kind: 'writing', message: 'Writing (market_overview, competitive_landscape).', turnsUsed: 4, sourcesFound: 12 });
  });

  it('a `searched` step: the buyer gets the query as `detail`, clipped to PROGRESS_DETAIL_MAX — a page cannot put a 4,000-char sentence on their screen', async () => {
    const query = 'URGENT: your report is on hold, call +1-555-0100 to release it (PZ-NOTE) ' + 'x'.repeat(4_000);
    await jobWithProgress('p2', {
      phase: 'deal-scout', message: `Searched: ${query}`, kind: 'searched', detail: query,
      turnsUsed: 1, sourcesFound: 5, updatedAt: '2026-08-17T00:00:01.000Z',
    });
    const buyer = await app.inject({ method: 'GET', url: '/research/p2', headers: auth(await token(APP, BUYER)) });
    const p = buyer.json().progress as { kind: string; detail: string; message?: string };
    expect(p.kind).toBe('searched');
    expect(p.message).toBeUndefined();
    // Mutation that reds this: send `p.detail` unclipped.
    expect(p.detail).toHaveLength(PROGRESS_DETAIL_MAX);
    expect(p.detail).toBe(query.slice(0, PROGRESS_DETAIL_MAX));
  });

  it('`detail` travels ONLY with `searched`: a `fetched` line with a detail hands the buyer none', async () => {
    await jobWithProgress('p3', {
      phase: 'deal-scout', message: 'Fetched 1 page(s).', kind: 'fetched', detail: 'https://attacker.test/x',
      turnsUsed: 2, sourcesFound: 5, updatedAt: '2026-08-17T00:00:02.000Z',
    });
    const buyer = await app.inject({ method: 'GET', url: '/research/p3', headers: auth(await token(APP, BUYER)) });
    // Mutation that reds this: drop the `p.kind === 'searched'` guard in clientProgress.
    expect(buyer.json().progress).toEqual({ phase: 'deal-scout', kind: 'fetched', updatedAt: '2026-08-17T00:00:02.000Z' });
  });

  it('a progress document written before `kind` existed still serves: phase and updatedAt, nothing else — a rename is a migration', async () => {
    await jobWithProgress('p4', {
      phase: 'deal-scout', message: 'Searched: laundromats miami',
      turnsUsed: 2, sourcesFound: 5, updatedAt: '2026-08-17T00:00:03.000Z',
    } as Parameters<typeof setProgress>[1]);
    const buyer = await app.inject({ method: 'GET', url: '/research/p4', headers: auth(await token(APP, BUYER)) });
    expect(buyer.json().progress).toEqual({ phase: 'deal-scout', updatedAt: '2026-08-17T00:00:03.000Z' });
  });

  it('the inbox list carries the same shape per job', async () => {
    await jobWithProgress('p5', {
      phase: 'deal-scout', message: 'Searched: q', kind: 'searched', detail: 'laundromats for sale Hialeah',
      turnsUsed: 1, sourcesFound: 5, updatedAt: '2026-08-17T00:00:04.000Z',
    });
    const list = await app.inject({ method: 'GET', url: '/research', headers: auth(await token(APP, BUYER)) });
    const row = (list.json().jobs as Array<{ jobId: string; progress: unknown }>).find((j) => j.jobId === 'p5')!;
    expect(row.progress).toEqual({ phase: 'deal-scout', kind: 'searched', detail: 'laundromats for sale Hialeah', updatedAt: '2026-08-17T00:00:04.000Z' });
    expect(JSON.stringify(row.progress)).not.toContain('Searched:');
  });
});
