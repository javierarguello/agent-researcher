import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { listTemplates } from '../src/templates/registry.js';
import { validateTemplate } from '../src/templates/validate.js';
import { planWaves } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { sampleFromSchema } from './mocks/llm.js';

describe('templates', () => {
  it('all registered templates are valid', () => {
    for (const t of listTemplates()) {
      expect(validateTemplate(t)).toEqual([]);
    }
  });

  it('florida waves are acyclic and cover all agents', () => {
    const t = getTemplate('florida-business-for-sale')!;
    const waves = planWaves(t);
    const flat = waves.flat();
    expect(new Set(flat).size).toBe(t.agents.length); // every agent scheduled once
    expect(waves.length).toBeGreaterThan(1);
  });
});

describe('mock LLM sampleFromSchema', () => {
  it('produces schema-valid data for a nested Zod schema', () => {
    const schema = z.object({
      title: z.string(),
      price: z.number().nullable(),
      tags: z.array(z.string()).min(1),
      kind: z.enum(['a', 'b']),
      nested: z.object({ items: z.array(z.object({ n: z.number() })) }),
    });
    const sample = sampleFromSchema(z.toJSONSchema(schema) as Record<string, unknown>);
    expect(schema.safeParse(sample).success).toBe(true);
  });
});
