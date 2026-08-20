import { describe, it, expect } from 'vitest';
import { resolveMode, creditsForMode, DEFAULT_MODES } from '../src/mode.js';
import { getTemplate } from '../src/templates/registry.js';

describe('report modes', () => {
  const t = getTemplate('florida-business-for-sale')!;

  it('defaults to essential when mode is missing/invalid', () => {
    expect(resolveMode(t.modes, undefined).key).toBe('essential');
    expect(resolveMode(t.modes, 'nope').key).toBe('essential');
  });

  it('essential is cheaper: fewer sections, half budget, 8 credits', () => {
    // 8, not the 5 this said until 2026-08-20. Essential really is ~half the COST of
    // comprehensive ($1.92 inferred vs $3.885843 measured), and it was priced at 28%
    // of it — so the cheaper mode was the one with the worse margin, and its cost
    // ceiling could not be set from its cost at all, only from what it earned (D1).
    // Cost parity per credit is 8.9; 8 keeps it visibly the cheaper report.
    const m = resolveMode(t.modes, 'essential');
    expect(m.config.budgetScale).toBe(0.5);
    expect(creditsForMode(m.config, 'essential')).toBe(8);
    expect(m.config.exclude?.length).toBeGreaterThan(0);
    // Half the budget for 44% of the price is the relation that has to hold; 28% is
    // what it was.
    expect(creditsForMode(m.config, 'essential') / 18).toBeGreaterThan(0.4);
  });

  it('comprehensive is full: no exclusions, full budget, default 18 credits', () => {
    const m = resolveMode(t.modes, 'comprehensive');
    expect(m.config.budgetScale).toBe(1);
    expect(creditsForMode(m.config, 'comprehensive')).toBe(18);
  });

  it('takes the price from the MODEL, not from the shared default', () => {
    // The two assertions above pass whether or not the template declares anything:
    // `creditsForMode` falls back to the same 5/18, so deleting `credits: 18` from
    // the flagship left the whole core suite green. In a catalog the fallback is
    // the least interesting case — a model that costs more to run has to be able
    // to say so.
    expect(creditsForMode({ credits: 42 } as never, 'comprehensive')).toBe(42);
    expect(creditsForMode({ credits: 1 } as never, 'essential')).toBe(1);
    // …and the default still applies to a mode that declares nothing. BOTH of them:
    // the essential fallback was unpinned — every test that touches credits goes
    // through the flagship, which declares its own — so changing 8 back to 5 here
    // was 0 red across the suite. What a future template gets by default is exactly
    // the case nothing else covers.
    expect(creditsForMode({} as never, 'comprehensive')).toBe(18);
    expect(creditsForMode({} as never, 'essential')).toBe(8);
  });

  it('falls back to DEFAULT_MODES when a template has none', () => {
    expect(resolveMode(undefined, 'comprehensive').config).toEqual(DEFAULT_MODES.comprehensive);
  });
});
