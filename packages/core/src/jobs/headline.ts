/**
 * Auto-generated job headline: a short title + one-line description derived from
 * the request params, for dashboards / report lists. Uses the cheapest model
 * tier (the `gather`/flash alias) so it costs a fraction of a cent.
 */
import { z } from 'zod';
import { config } from '../config.js';
import type { Cost } from '../cost.js';
import { synthesizeStructured } from '../engine/synthesize.js';
import { LANGUAGES } from '../engine/prompt.js';
import { resolveModel } from '../llm/index.js';

export interface Headline {
  title: string;
  shortDescription: string;
}

const HeadlineSchema = z.object({
  title: z.string().describe('<= 8 words, plain text, no quotes or markdown'),
  shortDescription: z.string().describe('one sentence, <= 25 words, plain text'),
});

export async function generateHeadline(input: {
  templateName: string;
  params: Record<string, unknown>;
  mode: string;
  language: string;
}): Promise<{ headline: Headline; cost: Cost }> {
  const model = resolveModel(config.llm.defaultGatherModel); // cheapest tier (flash)
  const langName = (LANGUAGES as Record<string, string>)[input.language] ?? input.language;

  const system =
    'You write concise, human-friendly titles and one-line descriptions for research-report jobs, for a ' +
    'dashboard list. Plain text only — no markdown, no surrounding quotes.';
  const user =
    `Research model: ${input.templateName}\nMode: ${input.mode}\n` +
    `Input parameters:\n${JSON.stringify(input.params, null, 2)}\n\n` +
    `Write a short TITLE (<= 8 words) and a one-sentence SHORT DESCRIPTION (<= 25 words) summarizing what ` +
    `this research report is about, based on the parameters. Write both in ${langName}. Return JSON.`;

  const res = await synthesizeStructured({
    model,
    system,
    messages: [{ role: 'user', text: user }],
    schema: HeadlineSchema,
    temperature: 0.4,
  });
  return { headline: res.value, cost: res.cost };
}
