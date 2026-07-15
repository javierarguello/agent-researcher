import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}) }));
vi.mock('../src/stripe.js', () => ({
  stripeConfigured: () => true,
  stripe: () => ({}),
  resolveStripePlan: async () => undefined,
  listStripePlans: async () => [],
}));

import { app } from '../src/index.js';
import {
  recordReportStats,
  recordPurchaseStats,
  createJob,
  setJobStatus,
  setJobAttempts,
  getJob,
  listTransactions,
  getApp,
} from '@agent-researcher/core';
import { seedApp, seedAdmin, token, auth } from './helpers.js';

async function adminToken() {
  await seedAdmin(['boss@x.com']);
  return token('admin', 'boss@x.com', 'admin');
}

describe('admin API — stats, users, jobs, apps, credit audit', () => {
  beforeEach(async () => {
    await seedApp('fbizlab');
  });

  // --- Task 2: cross-app stats ---------------------------------------------
  it('GET /admin/stats aggregates totals across apps (errors + avg/min/max gen time)', async () => {
    await recordReportStats({ appId: 'appA', userId: 'a@x.com', template: 't', status: 'completed', costUsd: 1, durationMs: 1000 });
    await recordReportStats({ appId: 'appA', userId: 'b@x.com', template: 't', status: 'completed', costUsd: 1, durationMs: 3000, degraded: true });
    await recordReportStats({ appId: 'appA', userId: 'a@x.com', template: 't', status: 'failed', costUsd: 0, durationMs: 0 });
    await recordReportStats({ appId: 'appB', userId: 'c@y.com', template: 't', status: 'completed', costUsd: 2, durationMs: 2000 });
    await recordPurchaseStats({ appId: 'appA', userId: 'a@x.com', amountUsd: 10, credits: 5 });

    const admin = await adminToken();
    const r = await app.inject({ method: 'GET', url: '/admin/stats', headers: auth(admin) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as any;
    expect(body.totals.reports).toBe(4);
    expect(body.totals.reportsCompleted).toBe(3);
    expect(body.totals.reportsFailed).toBe(1); // total error count
    expect(body.totals.degradedReports).toBe(1);
    expect(body.totals.avgGenMs).toBe(2000); // (1000+3000+2000)/3
    expect(body.totals.genTimeMsMin).toBe(1000);
    expect(body.totals.genTimeMsMax).toBe(3000);
    expect(body.totals.revenueUsd).toBe(10);
    expect(body.apps.map((a: any) => a.appId).sort()).toEqual(['appA', 'appB']);
    expect(body.daily.length).toBeGreaterThanOrEqual(1);
  });

  // --- Task 3: user search --------------------------------------------------
  it('GET /admin/users filters by app and email prefix', async () => {
    await recordReportStats({ appId: 'appA', userId: 'alice@x.com', template: 't', status: 'completed', costUsd: 1, durationMs: 10 });
    await recordReportStats({ appId: 'appA', userId: 'bob@x.com', template: 't', status: 'completed', costUsd: 1, durationMs: 10 });
    await recordReportStats({ appId: 'appB', userId: 'carol@y.com', template: 't', status: 'completed', costUsd: 1, durationMs: 10 });
    const admin = await adminToken();

    const byApp = await app.inject({ method: 'GET', url: '/admin/users?appId=appA', headers: auth(admin) });
    expect((byApp.json() as any).users.map((u: any) => u.userId).sort()).toEqual(['alice@x.com', 'bob@x.com']);

    const byPrefix = await app.inject({ method: 'GET', url: '/admin/users?appId=appA&q=al', headers: auth(admin) });
    expect((byPrefix.json() as any).users.map((u: any) => u.userId)).toEqual(['alice@x.com']);
  });

  // --- Task 4: cross-app job listing ---------------------------------------
  it('GET /admin/jobs filters across apps by app/status/template', async () => {
    await createJob({ jobId: 'j1', appId: 'appA', userId: 'a@x.com', template: 'florida-business-for-sale', params: {} });
    await createJob({ jobId: 'j2', appId: 'appA', userId: 'a@x.com', template: 'florida-business-for-sale', params: {} });
    await createJob({ jobId: 'j3', appId: 'appB', userId: 'c@y.com', template: 'other', params: {} });
    await setJobStatus('j2', 'completed');
    const admin = await adminToken();

    const byApp = await app.inject({ method: 'GET', url: '/admin/jobs?appId=appA', headers: auth(admin) });
    expect((byApp.json() as any).jobs.map((j: any) => j.jobId).sort()).toEqual(['j1', 'j2']);

    const byStatus = await app.inject({ method: 'GET', url: '/admin/jobs?status=completed', headers: auth(admin) });
    expect((byStatus.json() as any).jobs.map((j: any) => j.jobId)).toEqual(['j2']);

    const byTemplate = await app.inject({ method: 'GET', url: '/admin/jobs?template=other', headers: auth(admin) });
    expect((byTemplate.json() as any).jobs.map((j: any) => j.jobId)).toEqual(['j3']);
  });

  // --- Manual retry of a failed job ----------------------------------------
  it('retries a failed job (202, reset to queued + attempts 0); 409 if in progress, 404 if unknown', async () => {
    await createJob({ jobId: 'f1', appId: 'appA', userId: 'a@x.com', template: 'florida-business-for-sale', params: {} });
    await setJobStatus('f1', 'failed');
    await setJobAttempts('f1', 5);
    const admin = await adminToken();

    const r = await app.inject({ method: 'POST', url: '/admin/jobs/f1/retry', headers: auth(admin) });
    expect(r.statusCode).toBe(202);
    const job = await getJob('f1');
    expect(job?.status).toBe('queued');
    expect(job?.attempts).toBe(0);

    await setJobStatus('f1', 'running');
    expect((await app.inject({ method: 'POST', url: '/admin/jobs/f1/retry', headers: auth(admin) })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/admin/jobs/nope/retry', headers: auth(admin) })).statusCode).toBe(404);
  });

  // --- Task 5: app CRUD (extra fields + delete) ----------------------------
  it('POST /admin/apps accepts allowedTemplates; DELETE removes an app but not your own', async () => {
    const admin = await adminToken();
    const created = await app.inject({
      method: 'POST',
      url: '/admin/apps',
      headers: auth(admin),
      payload: { name: 'Victim', appId: 'victim', allowedTemplates: ['florida-business-for-sale'] },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as any).app.allowedTemplates).toEqual(['florida-business-for-sale']);

    // Can't delete the app the admin token belongs to.
    const self = await app.inject({ method: 'DELETE', url: '/admin/apps/admin', headers: auth(admin) });
    expect(self.statusCode).toBe(400);

    const del = await app.inject({ method: 'DELETE', url: '/admin/apps/victim', headers: auth(admin) });
    expect(del.statusCode).toBe(200);
    expect(await getApp('victim')).toBeUndefined();
  });

  // --- Task 1: credit grant auditability -----------------------------------
  it('POST /admin/credits/grant records grantedBy (from token) + reason; body cannot spoof grantedBy', async () => {
    const admin = await adminToken();
    // A body trying to spoof grantedBy is harmless — it's stripped
    // (additionalProperties: false) and the attribution comes from the token.
    const r = await app.inject({
      method: 'POST',
      url: '/admin/credits/grant',
      headers: auth(admin),
      payload: { appId: 'fbizlab', userId: 'u@x.com', credits: 5, reason: 'promo launch', grantedBy: 'evil@x.com' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ granted: 5, grantedBy: 'boss@x.com', balance: 5 });

    const ledger = await listTransactions('fbizlab', 'u@x.com');
    const grant = ledger.find((e) => e.type === 'grant')!;
    expect(grant.grantedBy).toBe('boss@x.com'); // from the token, NOT the body's evil@x.com
    expect(grant.reason).toBe('promo launch');
  });

  it('POST /admin/credits/grant requires a reason (400 without it)', async () => {
    const admin = await adminToken();
    const r = await app.inject({
      method: 'POST',
      url: '/admin/credits/grant',
      headers: auth(admin),
      payload: { appId: 'fbizlab', userId: 'u@x.com', credits: 5 },
    });
    expect(r.statusCode).toBe(400);
  });

  it('grant idempotencyKey dedupes double grants; audit filter returns only grants', async () => {
    const admin = await adminToken();
    const payload = { appId: 'fbizlab', userId: 'u@x.com', credits: 3, reason: 'once', idempotencyKey: 'k1' };
    const first = await app.inject({ method: 'POST', url: '/admin/credits/grant', headers: auth(admin), payload });
    const second = await app.inject({ method: 'POST', url: '/admin/credits/grant', headers: auth(admin), payload });
    expect((first.json() as any).balance).toBe(3);
    expect((second.json() as any)).toMatchObject({ applied: false, balance: 3 }); // not double-credited

    const onlyGrants = await app.inject({
      method: 'GET',
      url: '/credits/transactions?appId=fbizlab&userId=u@x.com&type=grant',
      headers: auth(admin),
    });
    const tx = (onlyGrants.json() as any).transactions;
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: 'grant', grantedBy: 'boss@x.com', reason: 'once' });
  });

  // --- Input hardening: schema-layer validation (assume attackers) ---------
  it('rejects oversized / malformed / unknown admin input (400)', async () => {
    const admin = await adminToken();
    const grant = (body: object) => app.inject({ method: 'POST', url: '/admin/credits/grant', headers: auth(admin), payload: body });

    // reason over the 500-char cap
    expect((await grant({ appId: 'fbizlab', userId: 'u@x.com', credits: 1, reason: 'x'.repeat(600) })).statusCode).toBe(400);
    // credits over the ceiling
    expect((await grant({ appId: 'fbizlab', userId: 'u@x.com', credits: 2_000_000, reason: 'ok' })).statusCode).toBe(400);
    // app id with illegal characters (pattern)
    const badApp = await app.inject({ method: 'POST', url: '/admin/apps', headers: auth(admin), payload: { name: 'X', appId: 'bad id!' } });
    expect(badApp.statusCode).toBe(400);
    // oversized name
    const bigName = await app.inject({ method: 'POST', url: '/admin/apps', headers: auth(admin), payload: { name: 'x'.repeat(300) } });
    expect(bigName.statusCode).toBe(400);
  });

  // --- Task 6: security — every /admin/* requires an admin token ------------
  it('rejects a non-admin token on every /admin/* route (403)', async () => {
    const user = await token('fbizlab', 'u@x.com', 'user');
    const routes: Array<[string, string, any?]> = [
      ['GET', '/admin/stats'],
      ['GET', '/admin/users'],
      ['GET', '/admin/jobs'],
      ['POST', '/admin/jobs/x/retry'],
      ['GET', '/admin/settings'],
      ['PATCH', '/admin/settings', {}],
      ['GET', '/admin/apps'],
      ['POST', '/admin/apps', { name: 'X' }],
      ['PATCH', '/admin/apps/fbizlab', { active: false }],
      ['DELETE', '/admin/apps/fbizlab'],
      ['POST', '/admin/credits/grant', { appId: 'fbizlab', userId: 'u@x.com', credits: 1, reason: 'x' }],
    ];
    for (const [method, url, payload] of routes) {
      const res = await app.inject({ method: method as any, url, headers: auth(user), ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});
