/**
 * `@agent-researcher/core` must be the copy in THIS tree.
 *
 * Node resolves a bare specifier by walking up `node_modules`. A git worktree —
 * which is how review agents are run, so they cannot fight over one checkout — has
 * no `node_modules` of its own, so the walk continues past the worktree and lands
 * on the MAIN checkout's `packages/core`.
 *
 * The consequence is not a broken run; it is a run that lies. An agent mutates
 * `packages/core/src` in its worktree, runs this suite, sees green, and reports the
 * test as unable to fail. Two agents hit this independently in one review round and
 * a third one's control mutation was silently invisible.
 *
 * `vitest.config.ts` fixes it with an alias resolved relative to the config file.
 * This is the guard that the alias is still there — for this suite and for any
 * config added later that forgets it.
 */
import { describe, it, expect } from 'vitest';
import { validateRequest } from '@agent-researcher/core';

/** Where the `core` module vitest actually loaded lives on disk. */
function coreSourcePath(): string {
  // Read from a stack rather than `import.meta.resolve` (undefined under vitest's
  // transform) or `require.resolve` (which reproduces the node_modules walk this
  // guard exists to detect, so it would report the escape even once the alias has
  // corrected it). A throw from inside core names the file that actually ran.
  try {
    (validateRequest as (x: unknown) => unknown)(undefined);
  } catch (err) {
    const frame = ((err as Error).stack ?? '').split('\n').find((l) => l.includes('packages/core'));
    if (frame) return frame;
  }
  throw new Error('could not locate the loaded core module — has validateRequest stopped throwing?');
}

describe('the core package this suite runs against', () => {
  it('is the one in this working tree, not another checkout', () => {
    // <tree>/apps/worker/test/resolution.test.ts → <tree>
    const tree = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
    const frame = coreSourcePath();

    expect(
      frame.includes(`${tree}/packages/core`),
      `core resolved outside this tree.\n  tree:  ${tree}\n  frame: ${frame.trim()}\n` +
        'Every result from this run is suspect: a source mutation in this tree would be invisible.\n' +
        "Fix: the '@agent-researcher/core' alias in vitest.config.ts.",
    ).toBe(true);
  });
});
