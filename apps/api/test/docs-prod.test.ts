/**
 * The OpenAPI docs are published in dev and NOT in prod.
 *
 * The decision is taken at import time (`config.env`), so each case imports a
 * fresh copy of the app under its own ENV.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/enqueue.js', () => ({ enqueueJob: vi.fn(async () => {}), enqueuePdf: vi.fn(async () => {}) }));

async function appUnder(env: string) {
  vi.resetModules();
  vi.stubEnv('ENV', env);
  return (await import('../src/index.js')).app;
}

afterEach(() => vi.unstubAllEnvs());

describe('/docs', () => {
  it('is published in dev', async () => {
    const app = await appUnder('dev');
    expect((await app.inject({ method: 'GET', url: '/docs/json' })).json().info.title).toBe('agent-researcher API');
  });

  it('is not published in prod — neither the UI nor the spec', async () => {
    const app = await appUnder('prod');
    expect((await app.inject({ method: 'GET', url: '/docs' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(404);
    // …and the API itself still answers.
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
