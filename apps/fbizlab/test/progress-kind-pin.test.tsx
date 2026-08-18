/**
 * Every progress kind the ENGINE can emit has a line in this app's language.
 *
 * The direction that ships a broken page is not the one the existing tests watch.
 * `packages/core/test/progress-kinds.test.ts` catches the engine emitting a kind
 * outside the set; this catches core GROWING a kind that no client knows. Adding
 * one to the core union typechecked in `packages/core`, `apps/api` and this app,
 * every suite stayed green — and in production `progressLine` returned `null` and
 * the buyer's live card rendered a step label with a blank line under it
 * (round 7, R7-6).
 *
 * The assertion lives on this side, like `languages.test.tsx`: this is the build
 * that would ship the blank line, and this app is a separately deployed static
 * bundle, so a new engine kind reaches an OLD bundle before any rebuild.
 */
import { describe, it, expect } from 'vitest';
import { PROGRESS_KINDS } from '../../../packages/core/src/jobs/types';
import { LANGS } from '../src/i18n';
import { progressLine } from '../src/lib/progress-copy';
import type { ProgressKind } from '../src/api/types';

describe('the progress vocabulary this app can render', () => {
  it('covers every kind the engine has, in every language it offers', () => {
    const missing = PROGRESS_KINDS.filter((k) =>
      LANGS.some((l) => progressLine({ phase: 'x', kind: k as ProgressKind, updatedAt: 't' }, l) == null),
    );
    // Mutation that reds this: add a kind to `PROGRESS_KINDS` in core (or delete one
    // entry from this app's `KIND` table).
    expect(missing, `no localized progress line for: ${missing.join(', ')}`).toEqual([]);
  });

  it('and does not silently fall back to the internal key', () => {
    // The wrong fix: `progressLine` returning the kind/phase string would pass the
    // test above and put the English internal word back on the buyer's screen —
    // which is the whole thing C3 removed.
    expect(progressLine({ phase: 'deal-scout', kind: 'not_a_kind' as ProgressKind, updatedAt: 't' }, 'es')).toBeNull();
  });
});
