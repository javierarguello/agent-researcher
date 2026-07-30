/**
 * Structured synthesis: ask a model for JSON conforming to a Zod schema, then
 * validate it. On a schema/parse failure, one self-repair round feeds the errors
 * back. Provider-agnostic — the Zod schema is turned into a standard JSON Schema
 * (`z.toJSONSchema`) and handed to whatever provider the resolved model uses.
 */
import { z } from 'zod';
import { config } from '../config.js';
import { BudgetExceededError, llmCost, type CostSink } from '../cost.js';
import type { ResolvedModel } from '../llm/index.js';
import type { LlmMessage } from '../llm/provider.js';

export interface SynthesizeStructuredInput<T> {
  model: ResolvedModel;
  system: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
  /** Lower temperature = more schema-faithful; default 0.3. */
  temperature?: number;
  /**
   * Records each call the moment it returns. Without it, a repair round that
   * still fails throws away both calls' tokens — and those are precisely the
   * attempts a failing agent makes over and over.
   */
  spend?: CostSink;
}

export interface StructuredResult<T> {
  // No `cost` here, deliberately. Spend goes to the sink as it happens, and every
  // call this function makes is billed whether or not it ever returns — so a
  // returned total would be a second accumulator that only covers the happy path.
  value: T;
}

/** Generate + validate a typed object, with one repair retry. Spend goes to `input.spend`. */
export async function synthesizeStructured<T>(input: SynthesizeStructuredInput<T>): Promise<StructuredResult<T>> {
  const { model, system, schema, temperature = 0.3 } = input;
  const responseSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const messages: LlmMessage[] = [...input.messages];

  for (let attempt = 0; attempt < 2; attempt++) {
    // The repair round is a second full-size structured call. If the first one took
    // the job past its ceiling, that is where it stops — the schema errors it would
    // be fixing are not worth another 32k output tokens.
    if (attempt > 0) {
      const budget = input.spend?.budget();
      if (budget?.exceeded) throw new BudgetExceededError(budget.spentUsd, budget.limitUsd ?? 0);
    }
    const res = await model.provider.generate({
      system,
      messages,
      model: model.model,
      temperature,
      responseSchema,
      maxOutputTokens: config.llm.maxOutputTokens,
    });
    if (res.usage) {
      input.spend?.add(llmCost(res.usage.inputTokens, res.usage.outputTokens, model.inPerM, model.outPerM));
    }

    const raw = stripJsonFences(res.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      if (attempt === 1) throw new Error(`Model did not return valid JSON: ${(err as Error).message}`);
      messages.push({ role: 'model', text: res.text });
      messages.push({ role: 'user', text: `That was not valid JSON (${(err as Error).message}). Return ONLY the JSON object.` });
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) return { value: result.data };

    if (attempt === 1) {
      const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new Error(`Structured output failed schema validation: ${issues}`);
    }
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    messages.push({ role: 'model', text: res.text });
    messages.push({
      role: 'user',
      text: `The JSON did not match the required schema. Fix these problems and return the corrected JSON only:\n${issues}`,
    });
  }
  // Unreachable — both attempts either return or throw above.
  throw new Error('Structured synthesis exhausted retries.');
}

/** Models sometimes wrap JSON in ```json fences — strip them. */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}
