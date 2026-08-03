import { describe, it, expect, vi } from 'vitest';
import { jobLogger, logEvent } from '../src/obs/log.js';

/**
 * Captures both streams, and remembers WHICH.
 *
 * Pooling them into one array was the defect: the whole point of the error path is
 * that it goes to stderr — Cloud Logging keys the severity off the stream — and
 * routing every line to `console.log` left the assertion green.
 */
function capture(fn: () => void): Array<Record<string, unknown> & { __stream: 'out' | 'err' }> {
  const lines: Array<{ text: string; stream: 'out' | 'err' }> = [];
  const log = vi.spyOn(console, 'log').mockImplementation((l) => void lines.push({ text: String(l), stream: 'out' }));
  const err = vi.spyOn(console, 'error').mockImplementation((l) => void lines.push({ text: String(l), stream: 'err' }));
  try {
    fn();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines.map((l) => ({ ...(JSON.parse(l.text) as Record<string, unknown>), __stream: l.stream }));
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
    expect(e.__stream, 'an ERROR on stdout is an ERROR nobody alerts on').toBe('err');
    expect(e.message).toContain('boom');
    expect(e.jobId).toBe('j1');
  });
});
