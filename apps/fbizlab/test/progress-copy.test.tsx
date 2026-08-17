/**
 * The live progress line's copy. `Record<ProgressKind, Record<Lang, string>>` makes
 * a missing kind or language a BUILD failure; what the compiler cannot see is
 * copy-pasted English under a Spanish key, so the content is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { progressLine } from '../src/lib/progress-copy';
import { LANGS } from '../src/i18n';
import type { ProgressKind } from '../src/api/types';

const KINDS: ProgressKind[] = ['starting', 'wave', 'researching', 'reusing', 'plan', 'searched', 'search_failed', 'fetched', 'cached', 'stopped', 'ceiling', 'writing', 'composing', 'retry', 'failed', 'assembling', 'done', 'held', 'incomplete'];

describe('progressLine', () => {
  it('every kind has a line in every language, and no language borrows English', () => {
    for (const kind of KINDS) {
      const lines = LANGS.map((lang) => progressLine({ kind }, lang));
      for (const l of lines) expect(l, kind).toBeTruthy();
      // Mutation that reds this: copy the `en` sentence into `es` for any kind.
      expect(new Set(lines).size, `${kind}: ${lines.join(' | ')}`).toBe(LANGS.length);
    }
  });

  it('a search shows the query quoted, as a query — never as a sentence from us', () => {
    expect(progressLine({ kind: 'searched', detail: 'laundromats for sale Hialeah' }, 'en')).toBe('Searching for “laundromats for sale Hialeah”');
    expect(progressLine({ kind: 'searched', detail: 'URGENT: call +1-555-0100' }, 'es')).toBe('Buscando “URGENT: call +1-555-0100”');
    expect(progressLine({ kind: 'searched' }, 'fr')).toBe('Recherche de…');
    // Only a search carries its detail; anything else ignores one.
    expect(progressLine({ kind: 'fetched', detail: 'https://attacker.test/x' }, 'en')).toBe('Reading a source in full.');
  });

  it('a document without a kind (written before the field existed) yields nothing — the phase label above it still says where we are', () => {
    expect(progressLine({}, 'en')).toBeNull();
    expect(progressLine(null, 'es')).toBeNull();
    expect(progressLine({ kind: 'nope' as ProgressKind }, 'en')).toBeNull();
  });
});
