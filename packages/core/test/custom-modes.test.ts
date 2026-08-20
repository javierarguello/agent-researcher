/**
 * A model may declare its OWN flavours — not just essential/comprehensive.
 *
 * The header of `mode.ts` claimed "a new research model just declares its `modes`"
 * and it was false in a way nothing caught. `ReportMode` was the closed union
 * `'essential' | 'comprehensive'`, written into a `z.enum`, a type guard, a credits
 * fallback, the manifest builder and the admin's pricing schema. A template
 * declaring `{ deep: … }` had it dropped from the manifest in silence — the builder
 * walked the CONSTANT, not the template — and the API's enum refused the key even
 * if a client somehow learnt it. A catalog product cannot ship two flavours for
 * every model it will ever have.
 *
 * These drive the real seams end to end: the manifest a client renders its picker
 * from, the price it is charged, the ceiling it runs under, and the refusal it gets
 * for a flavour that does not exist.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { modeParamSchema, resolveMode, modesOf, defaultModeOf, creditsForMode } from '../src/mode.js';
import { resolveModeCeiling } from '../src/credits/pricing.js';
import { toManifest, __registerTemplateForTests, __clearTestTemplates } from '../src/templates/registry.js';
import { validateTemplate } from '../src/templates/validate.js';
import { validateRequest } from '../src/index.js';
import { config } from '../src/config.js';
import { compactModel } from './fixtures/compact-model.js';
import type { ResearchTemplate } from '../src/templates/types.js';

/** A model whose flavours are named nothing like the defaults. */
const threeFlavours = {
  ...compactModel,
  id: 'three-flavours',
  paramsSchema: z.object({ mode: modeParamSchema, language: z.enum(['en', 'es']).default('en') }),
  modes: {
    peek: { label: 'Peek', budgetScale: 0.25, depth: 'light' as const, credits: 3 },
    dossier: { label: 'Dossier', budgetScale: 1, depth: 'standard' as const, credits: 12 },
    deep: { label: 'Deep dive', budgetScale: 2, depth: 'deep' as const, credits: 30 },
  },
} as unknown as ResearchTemplate<Record<string, unknown>>;

describe('a model with flavours of its own', () => {
  it('boots — the names are the template’s business', () => {
    expect(validateTemplate(threeFlavours)).toEqual([]);
  });

  it('publishes all three in the manifest, in its own order and with its own labels', () => {
    // The defect this replaces: `toManifest` walked `REPORT_MODES`, so this model
    // published "Essential / Comprehensive" at 8 and 18 credits — two flavours it
    // does not have, at prices it never set — and none of its three.
    const m = toManifest(threeFlavours);
    expect(m.modes.map((x) => x.key)).toEqual(['peek', 'dossier', 'deep']);
    expect(m.modes.map((x) => x.label)).toEqual(['Peek', 'Dossier', 'Deep dive']);
    expect(m.modes.map((x) => x.credits)).toEqual([3, 12, 30]);
  });

  it('charges and caps each one from its own declaration', () => {
    for (const [key, cfg] of modesOf(threeFlavours.modes)) {
      const credits = creditsForMode(cfg, key);
      const ceiling = resolveModeCeiling(null, cfg, key, config.workflow.maxJobCostUsd);
      // The invariant that survives any flavour: a job may never be allowed to cost
      // more than the report it produced earned.
      expect(ceiling, key).toBeLessThan(credits * config.pricing.creditFloorUsd);
    }
  });

  it('defaults to the CHEAPEST flavour when a request names none', () => {
    // It used to default to the literal `'essential'`, which this model does not
    // have — `resolveMode` then handed back a DEFAULT_MODES config belonging to no
    // template, with this template's budgets and sections nowhere in it.
    expect(defaultModeOf(threeFlavours.modes)).toBe('peek');
    expect(resolveMode(threeFlavours.modes, undefined).config.budgetScale).toBe(0.25);
    // …and an unknown key falls back rather than throwing, because the engine is no
    // place to raise one. The REFUSAL is at the API edge, below.
    expect(resolveMode(threeFlavours.modes, 'comprehensive').key).toBe('peek');
  });

  it('refuses a flavour it does not offer, BY NAME, at the API edge', () => {
    // The half that makes the fallback above safe. Without it an undeclared mode
    // would run — and be charged — as the cheapest one, silently.
    __clearTestTemplates();
    __registerTemplateForTests(threeFlavours);
    try {
      expect(() => validateRequest({ template: 'three-flavours', params: { mode: 'comprehensive' } }))
        .toThrow(/does not offer the "comprehensive" mode.*peek, dossier, deep/s);
      // …and its own flavours pass, with the mode preserved rather than defaulted.
      const ok = validateRequest({ template: 'three-flavours', params: { mode: 'deep' } });
      expect(ok.params.mode).toBe('deep');
    } finally {
      __clearTestTemplates();
    }
  });

  it('still refuses a flavour on a model that declares NO modes', () => {
    // A template with no `modes` gets the defaults — and must still refuse a key
    // outside them, or "open-ended" would mean "unvalidated".
    __clearTestTemplates();
    __registerTemplateForTests({ ...compactModel, id: 'default-modes', paramsSchema: z.object({ mode: modeParamSchema }) } as never);
    try {
      expect(() => validateRequest({ template: 'default-modes', params: { mode: 'peek' } })).toThrow(/essential, comprehensive/);
      expect(validateRequest({ template: 'default-modes', params: { mode: 'comprehensive' } }).params.mode).toBe('comprehensive');
    } finally {
      __clearTestTemplates();
    }
  });
});
