/**
 * Who the E3 cleanup touches — the only part of it that can do harm.
 *
 * The script clears blocks the pre-screen handed out before `ada33e8`, when a free
 * deterministic rejection still earned a strike and four strikes locked an account
 * out of buying credits. What it must never clear is a block a PERSON decided on.
 * Both live in the same field, so the whole safety of the migration rests on
 * telling them apart.
 */
import { describe, it, expect } from 'vitest';

import { isModerationBlock } from '../src/cli/unblock-moderation.js';
import { blockReasonFor } from '../src/moderation/copy.js';

describe('the E3 cleanup only undoes blocks the pre-screen made', () => {
  it('recognises what the moderation path actually writes, whatever the categories', () => {
    for (const cats of [[], ['prompt_injection'], ['profanity_hate', 'harassment_threats']] as const) {
      expect(isModerationBlock(blockReasonFor([...cats] as never))).toBe(true);
    }
  });

  it('leaves a human decision alone', () => {
    for (const reason of [
      'Chargeback fraud — blocked by hand 2026-06-02',
      'Requested account closure',
      'Blocked pending payment dispute',
      '',
      undefined,
      null,
      42,
    ]) {
      expect(isModerationBlock(reason)).toBe(false);
    }
  });

  it('is derived from the block path, so a reworded reason cannot silently stop matching', () => {
    // If someone edits the wording in copy.ts, this test keeps passing — which is
    // the point: the script reads the same function, so it follows the change
    // instead of quietly matching nothing and reporting "nothing to do".
    expect(blockReasonFor([])).toContain('categories:');
    expect(isModerationBlock(blockReasonFor([]))).toBe(true);
  });
});
