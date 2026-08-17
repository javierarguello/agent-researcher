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

/**
 * A structured write that failed VALIDATION — the model answered, and what it
 * answered was not the schema (or was not JSON). Distinct from a provider error
 * (a 5xx, a timeout) because the two mean different things to a retry: a provider
 * blip is transient; a model that returns the same invalid shape on the same
 * evidence will do it again, and the engine uses `signature` to notice.
 *
 * The signature is WHAT failed, not what the model said about it:
 *   - schema: every Zod issue's path + code (`findings.risks:too_small`), sorted
 *     and de-duplicated, array indices collapsed to `*` — the message strings
 *     carry no value ("<=80 characters" reads the same for 82 and 95), so two
 *     honest near-misses at different lengths ARE the same failure, and an
 *     invalid type in listing 3 vs listing 5 is too;
 *   - JSON: the parser's error kind with the position and the excerpt stripped
 *     (two truncations at different lengths are one failure).
 */
export class StructuredOutputError extends Error {
  readonly signature: string;
  constructor(message: string, signature: string) {
    super(message);
    this.name = 'StructuredOutputError';
    this.signature = signature;
  }
}

/** Longest signature persisted — a schema with hundreds of issues still yields one line. */
const MAX_SIGNATURE_CHARS = 1000;

/** `schema:` + sorted unique `path:code` pairs, array indices collapsed to `*`. */
export function schemaFailureSignature(issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>): string {
  const keys = new Set(
    issues.map((i) => `${i.path.map((seg) => (typeof seg === 'number' ? '*' : String(seg))).join('.') || '(root)'}:${i.code}`),
  );
  return `schema:${[...keys].sort().join(',')}`.slice(0, MAX_SIGNATURE_CHARS);
}

/** `json:` + the parser's error kind, without the position or the offending excerpt. */
export function jsonFailureSignature(message: string): string {
  const kind = message
    .replace(/ at position \d+[\s\S]*$/, '')
    .replace(/^Unexpected token\b[\s\S]*$/, 'Unexpected token')
    .trim();
  return `json:${kind}`.slice(0, MAX_SIGNATURE_CHARS);
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
      if (attempt === 1) {
        const message = (err as Error).message;
        throw new StructuredOutputError(`Model did not return valid JSON: ${message}`, jsonFailureSignature(message));
      }
      messages.push({ role: 'model', text: res.text });
      messages.push({ role: 'user', text: `That was not valid JSON (${(err as Error).message}). Return ONLY the JSON object.` });
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) return { value: result.data };

    if (attempt === 1) {
      const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new StructuredOutputError(`Structured output failed schema validation: ${issues}`, schemaFailureSignature(result.error.issues));
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
