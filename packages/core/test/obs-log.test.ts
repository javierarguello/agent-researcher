import { describe, it, expect, vi } from 'vitest';
import { jobLogger, logEvent } from '../src/obs/log.js';

function capture(fn: () => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((l) => void lines.push(String(l)));
  const err = vi.spyOn(console, 'error').mockImplementation((l) => void lines.push(String(l)));
  try {
    fn();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('structured logging', () => {
  it('emits one JSON line per event bound to jobId/appId/userId', () => {
    const [entry] = capture(() =>
      logEvent({ jobId: 'j1', appId: 'fbizlab', userId: 'u@x.com' }, 'INFO', 'step', { message: 'hi' }),
    );
    expect(entry).toMatchObject({ severity: 'INFO', event: 'step', jobId: 'j1', appId: 'fbizlab', userId: 'u@x.com' });
    expect((entry as any)['logging.googleapis.com/labels']).toMatchObject({ jobId: 'j1', appId: 'fbizlab', userId: 'u@x.com' });
  });

  it('errors go to stderr with severity ERROR (a diagnosable failure trace)', () => {
    const entries = capture(() => jobLogger({ jobId: 'j1', appId: 'a', userId: 'u' }).error('job.failed', { message: 'boom' }));
    const e = entries.find((x) => x.event === 'job.failed')!;
    expect(e.severity).toBe('ERROR');
    expect(e.message).toContain('boom');
    expect(e.jobId).toBe('j1');
  });
});
