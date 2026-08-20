/**
 * A compact research model, shared by the two end-to-end report tests:
 *
 *   report.test.ts       every run, against the mock provider
 *   report.live.test.ts  opt-in, against a real local model (TEST_LLM=ollama)
 *
 * Same template, same assertions, different model. That is the whole point: the
 * default run keeps the pipeline and these expectations honest, and live mode
 * swaps in a model that will genuinely fumble to see what survives.
 *
 * Deliberately free of any vitest import, so a throwaway script can run it too.
 * The shared assertions live next door in expect-report.ts.
 *
 * It is deliberately small — one producer (tool loop + structured synthesis)
 * feeding one synthesizer, plus the engine's derived `sources` section — because
 * it tests that the pipeline holds together, not how much a tiny model can write.
 */
import { z } from 'zod';
import { runResearch, type ResearchOutput } from '../../src/engine/research-engine.js';
import type { ResearchTemplate } from '../../src/templates/types.js';

export const compactModel: ResearchTemplate<Record<string, unknown>> = {
  id: 'e2e-compact',
  name: 'Compact e2e model',
  description: 'A two-agent research model used to exercise the engine end to end.',
  version: 1,
  basePrompt:
    'You are a research analyst. Report only what the evidence supports, never invent figures or URLs, ' +
    'and say so plainly when the evidence is missing.',
  paramsSchema: z.object({
    subject: z.string().trim().max(120).default('laundromats for sale'),
    location: z.string().trim().max(120).default('Miami-Dade County, FL'),
    language: z.enum(['en', 'es']).default('en'),
  }),
  sections: [
    {
      key: 'findings',
      title: 'Findings',
      guidance: 'Two or three sentences on what the evidence shows, and each listing the evidence names.',
      schema: z.object({
        overview: z.string().describe('2-3 sentences on what the evidence shows (Markdown).'),
        listings: z
          .array(z.object({ business: z.string(), askingPrice: z.number().nullable(), sourceUrl: z.string() }))
          .describe('Listings the evidence actually names; empty if none.'),
      }),
    },
    {
      key: 'recommendation',
      title: 'Recommendation',
      guidance: 'One paragraph recommending what the buyer should do next, derived strictly from the findings.',
      schema: z.object({ nextStep: z.string().describe('One paragraph (Markdown).') }),
    },
    {
      key: 'sources',
      title: 'Sources',
      derived: true,
      guidance: 'Every source consulted.',
      schema: z.array(z.object({ title: z.string(), url: z.string() })),
      derive: ({ sources }) => sources.map((s) => ({ title: s.title, url: s.url })),
    },
  ],
  agents: [
    {
      id: 'scout',
      role: 'producer',
      objective: 'Find businesses matching the request and summarize what the evidence shows.',
      produces: ['findings'],
      researchBudget: 2,
      // 'flash' + 'gather' are the cheap aliases; in live mode both point at the
      // local server, so no test ever reaches for a strong hosted tier.
      model: 'flash',
      gatherModel: 'gather',
    },
    {
      id: 'advisor',
      role: 'synthesizer',
      objective: 'Recommend the next step from the findings.',
      produces: ['recommendation'],
      dependsOn: ['scout'],
      model: 'flash',
    },
  ],
  buildBrief: (p) => `Find ${p.subject} currently for sale in ${p.location} and summarize the best matches.`,
};

/** Run a template through the engine the way the worker does. */
export function runModel(
  template: ResearchTemplate<any>,
  params: Record<string, unknown>,
  jobId: string,
  /** Anything else the engine takes — a wall-clock deadline, `finalize`, progress. */
  extra: Partial<Parameters<typeof runResearch>[0]> = {},
): Promise<ResearchOutput> {
  return runResearch({
    template,
    params: template.paramsSchema.parse(params) as Record<string, unknown>,
    jobId,
    generatedAt: '2026-07-27T00:00:00.000Z',
    ...extra,
  });
}
