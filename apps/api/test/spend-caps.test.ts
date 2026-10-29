/**
 * The monthly spend caps at the API's front door, and their admin surface.
 *
 * A refused report must cost nothing and move nothing: no classifier call, no
 * credits, no job. The worker holds whatever was already queued (core's
 * spend-caps.test.ts); this is the half that stops new work arriving.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));

import { bookSpend, getBalance, getMonthSpend, grantCredits, listJobs, updateApp, updateSettings } from '@agent-researcher/core';
import { app } from '../src/index.js';
import { auth, seedAdmin, seedApp, token } from './helpers.js';
import { fakeLlm } from './setup.js';
import { writableConfig } from './writable-config.js';

const APP = 'fbizlab';
const USER = 'u@x.com';
const ADMIN = 'boss@x.com';
const research = { template: 'florida-business-for-sale', params: { industry: 'laundromats', mode: 'essential', language: 'es' } };

let userToken = '';
let adminToken = '';
const post = () => app.inject({ method: 'POST', url: '/research', headers: auth(userToken), payload: research });

beforeEach(async () => {
  await seedApp(APP);
  await seedAdmin([ADMIN]);
  userToken = await token(APP, USER);
  adminToken = await token('admin', ADMIN, 'admin');
  await grantCredits({ appId: APP, userId: USER, credits: 500 });
});

async function expectRefusedForFree(): Promise<void> {
  const calls = fakeLlm.calls;
  const res = await post();
  expect(res.statusCode).toBe(503);
  expect(res.json().code).toBe('spend_paused');
  // In the buyer's language, and saying no credits moved.
  expect(res.json().error).toContain('no se te cobró nada');
  expect(fakeLlm.calls).toBe(calls); // no moderation call
  expect(await getBalance(APP, USER)).toBe(500);
  expect(await listJobs(APP, USER)).toHaveLength(0);
}

describe('POST /research under the caps', () => {
  it('accepts a report under the default caps', async () => {
    expect((await post()).statusCode).toBe(202);
  });

  it('refuses for free when the global cap is reached', async () => {
    await updateSettings({ globalMonthlySpendCapUsd: 10 });
    await bookSpend('other-app', 10); // another app's spend counts toward the global cap
    await expectRefusedForFree();
  });

  it('refuses for free when THIS app reached its own cap', async () => {
    await updateApp(APP, { monthlySpendCapUsd: 3 });
    await bookSpend(APP, 3);
    await expectRefusedForFree();
  });

  it('does not refuse an app for another app’s spend', async () => {
    await updateApp(APP, { monthlySpendCapUsd: 3 });
    await bookSpend('other-app', 50);
    expect((await post()).statusCode).toBe(202);
  });

  it('refuses for free while an admin has paused jobs', async () => {
    await updateSettings({ jobsPaused: true });
    await expectRefusedForFree();
  });
});

describe('admin surface', () => {
  it('edits the global limits and reports the month, per app', async () => {
    const patch = await app.inject({
      method: 'PATCH', url: '/admin/settings', headers: auth(adminToken),
      payload: { globalMonthlySpendCapUsd: 300, globalMonthlySpendAlertUsd: 150, spendAlertEmails: ['ops@x.com'], postmarkPlanUsd: 15 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().settings).toMatchObject({ globalMonthlySpendCapUsd: 300, globalMonthlySpendAlertUsd: 150, spendAlertEmails: ['ops@x.com'], postmarkPlanUsd: 15 });

    await app.inject({
      method: 'PATCH', url: '/admin/settings', headers: auth(adminToken),
      payload: { postmarkIncludedEmails: 10_000, postmarkOveragePer1000Usd: 1.8 },
    });
    await updateApp(APP, { monthlySpendCapUsd: 2 });
    await bookSpend(APP, 2.5);
    // Postmark's stats endpoint, stubbed — a test never reaches the network.
    const seen: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ Sent: 12_345, Bounced: 7, SpamComplaints: 1, BounceRate: 0.06 }), { status: 200 });
    });
    const res = await app.inject({ method: 'GET', url: '/admin/spend?month=2026-02', headers: auth(adminToken) });
    fetchSpy.mockRestore();
    // The whole UTC month asked for, last day included (2026 is not a leap year).
    expect(seen).toEqual(['https://api.postmarkapp.com/stats/outbound?fromdate=2026-02-01&todate=2026-02-28']);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Booked this month, asked about February: nothing there.
    expect(body.spend).toMatchObject({ month: '2026-02', totalUsd: 0 });
    // $15 plan + 2,345 over 10,000 → 3 blocks of 1,000 × $1.80.
    expect(body.postmark).toMatchObject({ sent: 12_345, bounced: 7, spamComplaints: 1, estimatedUsd: 15 + 3 * 1.8 });

    const down = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 503 }));
    const now = (await app.inject({ method: 'GET', url: '/admin/spend', headers: auth(adminToken) })).json();
    down.mockRestore();
    expect(now.spend.totalUsd).toBe(2.5);
    // The backoffice (seeded in beforeEach) has no spend to cap and is not listed.
    expect(now.apps.map((a: { appId: string }) => a.appId)).toEqual([APP]);
    const row = now.apps.find((a: { appId: string }) => a.appId === APP);
    expect(row).toMatchObject({ spentUsd: 2.5, monthlySpendCapUsd: 2, blocked: { scope: 'app', capUsd: 2 } });
    // Postmark failing does not take the page down — it says why instead.
    expect(now.postmark).toEqual({ error: 'Postmark stats failed (503)' });
  });

  it('refuses a malformed alert recipient, and a user', async () => {
    const bad = await app.inject({ method: 'PATCH', url: '/admin/settings', headers: auth(adminToken), payload: { spendAlertEmails: ['a@x.com, b@y.com'] } });
    expect(bad.statusCode).toBe(400);
    const asUser = await app.inject({ method: 'PATCH', url: '/admin/settings', headers: auth(userToken), payload: { jobsPaused: true } });
    expect(asUser.statusCode).toBe(403);
  });

  it('a per-app cap is set and cleared through the app endpoint', async () => {
    const set = await app.inject({ method: 'PATCH', url: `/admin/apps/${APP}`, headers: auth(adminToken), payload: { monthlySpendCapUsd: 40, monthlySpendAlertUsd: 20 } });
    expect(set.json().app).toMatchObject({ monthlySpendCapUsd: 40, monthlySpendAlertUsd: 20 });
    const cleared = await app.inject({ method: 'PATCH', url: `/admin/apps/${APP}`, headers: auth(adminToken), payload: { monthlySpendCapUsd: null } });
    expect(cleared.json().app.monthlySpendCapUsd).toBeUndefined();
  });
});

describe('request-time LLM spend is booked too', () => {
  it('a preflight’s moderation call lands in the month ledger for its app', async () => {
    const before = (await getMonthSpend()).apps[APP] ?? 0;
    await app.inject({ method: 'POST', url: '/research/preflight', headers: auth(userToken), payload: { template: research.template, params: research.params, freeText: 'I want laundromats in Miami' } });
    expect((await getMonthSpend()).apps[APP] ?? 0).toBeGreaterThan(before);
  });
});

describe('provider quotas on /admin/spend', () => {
  it('Tavily credits used and left, and Postmark emails left on the plan', async () => {
    writableConfig.search.tavilyApiKey = 'tvly-test';
    await updateSettings({ postmarkIncludedEmails: 100 });
    const seen: string[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      seen.push(String(url));
      if (String(url).startsWith('https://api.tavily.com/usage')) {
        return new Response(JSON.stringify({
          key: { usage: 150, limit: null, search_usage: 100, extract_usage: 50 },
          account: { current_plan: 'Project', plan_usage: 3100, plan_limit: 4000, paygo_usage: 0, paygo_limit: 100 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ Sent: 130, Bounced: 0, SpamComplaints: 0, BounceRate: 0 }), { status: 200 });
    });
    try {
      const body = (await app.inject({ method: 'GET', url: '/admin/spend', headers: auth(adminToken) })).json();
      expect(seen).toContain('https://api.tavily.com/usage');
      expect(body.search.provider).toBe('tavily');
      expect(body.search.tavily).toMatchObject({ remainingCredits: 900, account: { plan: 'Project', planUsage: 3100, planLimit: 4000 } });
      expect(body.search.tavily.key).toMatchObject({ usage: 150, searchUsage: 100, extractUsage: 50 });
      // 130 sent of a 100-email plan: none left (never negative).
      expect(body.postmark).toMatchObject({ sent: 130, includedEmails: 100, remainingEmails: 0 });
    } finally {
      spy.mockRestore();
      writableConfig.search.tavilyApiKey = '';
    }
  });

  it('no Tavily call when Tavily is not the provider', async () => {
    writableConfig.search.tavilyApiKey = '';
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 503 }));
    try {
      const body = (await app.inject({ method: 'GET', url: '/admin/spend', headers: auth(adminToken) })).json();
      expect(body.search).toMatchObject({ provider: 'duckduckgo', tavily: null });
      expect(spy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('tavily'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
