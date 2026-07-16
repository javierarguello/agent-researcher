import { describe, it, expect } from 'vitest';
import { resolveMode, creditsForMode, DEFAULT_MODES } from '../src/mode.js';
import { getTemplate } from '../src/templates/registry.js';

describe('report modes', () => {
  const t = getTemplate('florida-business-for-sale')!;

  it('defaults to essential when mode is missing/invalid', () => {
    expect(resolveMode(t.modes, undefined).key).toBe('essential');
    expect(resolveMode(t.modes, 'nope').key).toBe('essential');
  });

  it('essential is cheaper: fewer sections, half budget, default 5 credits', () => {
    const m = resolveMode(t.modes, 'essential');
    expect(m.config.budgetScale).toBe(0.5);
    expect(creditsForMode(m.config, 'essential')).toBe(5);
    expect(m.config.exclude?.length).toBeGreaterThan(0);
  });

  it('comprehensive is full: no exclusions, full budget, default 18 credits', () => {
    const m = resolveMode(t.modes, 'comprehensive');
    expect(m.config.budgetScale).toBe(1);
    expect(creditsForMode(m.config, 'comprehensive')).toBe(18);
  });

  it('falls back to DEFAULT_MODES when a template has none', () => {
    expect(resolveMode(undefined, 'comprehensive').config).toEqual(DEFAULT_MODES.comprehensive);
  });
});
