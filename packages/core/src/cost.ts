/**
 * Cost accounting for a research job.
 *
 * Every LLM call returns token usage; combined with per-model prices (from the
 * model registry) we get an EXACT LLM cost. Web-search/extract cost is an
 * ESTIMATE (Tavily credits × price) since the search API doesn't return a bill.
 * Costs accumulate per agent and into a running job total, stored in the trace
 * and report metadata and updated as each agent finishes.
 */

export interface Cost {
  /** Total USD (llm + search). */
  usd: number;
  /** Exact LLM cost in USD (from token usage × model price). */
  llmUsd: number;
  /** Estimated web-search/extract cost in USD. */
  searchUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** web_search + fetch_page calls that actually hit the backend. */
  searchCalls: number;
}

/**
 * Somewhere to record spend the moment it happens.
 *
 * Returning a cost at the end of a function loses everything when that function
 * throws — which is exactly when the interesting spend has occurred, because a
 * failed agent still ran its whole research loop and its synthesis calls. Every
 * paid call writes here immediately, so a throw can no longer make money
 * invisible. Pass one down; read `total()` from either the success or the failure
 * path.
 *
 * A sink can also carry a JOB-WIDE ceiling. `child()` scopes one attempt's spend
 * (its `total()` is that attempt's alone) while still recording into the parent,
 * so the job total stays in ONE accumulator — the ceiling has to be checked
 * against everything spent so far, not against one attempt's slice.
 */
export interface CostSink {
  add(cost: Cost): void;
  /** What THIS sink has recorded (a child sees only its own slice). */
  total(): Cost;
  /**
   * The job-wide view, whichever sink you happen to hold: what the WHOLE job has
   * spent, its ceiling, and whether it has passed it. Always answered by the root,
   * because that is the only question worth asking — one attempt being cheap says
   * nothing about whether the job can afford another.
   */
  budget(): BudgetState;
  /** A sink recording into this one as well — scopes one attempt's spend. */
  child(): CostSink;
}

export interface BudgetState {
  /** USD spent across the whole job (all dispatches, all agents). */
  spentUsd: number;
  /** The ceiling, or null when uncapped. */
  limitUsd: number | null;
  exceeded: boolean;
}

/**
 * Thrown when a job has spent its ceiling. Distinct from a model/tool error so
 * the engine can stop retrying instead of burning the remaining attempts: no
 * amount of retrying makes money reappear.
 */
export class BudgetExceededError extends Error {
  readonly spentUsd: number;
  readonly limitUsd: number;
  /**
   * The same fact WITH the figures, for the trace and the logs.
   *
   * Kept out of `message` on purpose. An agent's `error` becomes the reason a
   * degraded section carries, and that section is rendered to the buyer — so a
   * dollar amount in this message would print our infrastructure spend inside a
   * customer's report. The numbers are on the instance, in `trace.cost`, and in
   * the `job.budget_exceeded` log; none of those is customer-facing.
   */
  readonly detail: string;
  constructor(spentUsd: number, limitUsd: number) {
    super('The job reached its cost ceiling.');
    this.name = 'BudgetExceededError';
    this.detail = `Job cost ceiling reached: spent $${spentUsd.toFixed(2)} of the $${limitUsd.toFixed(2)} allowed.`;
    this.spentUsd = spentUsd;
    this.limitUsd = limitUsd;
  }
}

export interface CostSinkOptions {
  /** Job-wide USD ceiling. Null/0/negative = uncapped. */
  maxUsd?: number | null;
  /** Spend already incurred (prior dispatches), so the ceiling counts the WHOLE job. */
  seed?: Cost;
}

export function createCostSink(opts: CostSinkOptions = {}): CostSink {
  const max = opts.maxUsd != null && opts.maxUsd > 0 ? opts.maxUsd : null;
  return makeSink(max, opts.seed ?? emptyCost());
}

function makeSink(maxUsd: number | null, seed: Cost, parent?: CostSink): CostSink {
  let acc = seed;
  const self: CostSink = {
    add: (c) => {
      // Record before propagating: money already spent stays visible even when
      // the ceiling has been passed. The ceiling stops FUTURE calls; it never
      // hides a call that was already billed.
      acc = addCost(acc, c);
      parent?.add(c);
    },
    total: () => acc,
    budget: () =>
      parent
        ? parent.budget()
        : { spentUsd: acc.usd, limitUsd: maxUsd, exceeded: maxUsd != null && acc.usd >= maxUsd },
    child: () => makeSink(null, emptyCost(), self),
  };
  return self;
}

export function emptyCost(): Cost {
  return { usd: 0, llmUsd: 0, searchUsd: 0, inputTokens: 0, outputTokens: 0, searchCalls: 0 };
}

export function addCost(a: Cost, b: Cost): Cost {
  return {
    usd: round(a.usd + b.usd),
    llmUsd: round(a.llmUsd + b.llmUsd),
    searchUsd: round(a.searchUsd + b.searchUsd),
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    searchCalls: a.searchCalls + b.searchCalls,
  };
}

/** LLM cost for one call, given token counts and the model's per-1M prices. */
export function llmCost(inputTokens: number, outputTokens: number, inPerM: number, outPerM: number): Cost {
  const llmUsd = round((inputTokens / 1e6) * inPerM + (outputTokens / 1e6) * outPerM);
  return { usd: llmUsd, llmUsd, searchUsd: 0, inputTokens, outputTokens, searchCalls: 0 };
}

/** Estimated cost of N backend search/extract calls. */
export function searchCost(calls: number, perCallUsd: number): Cost {
  const searchUsd = round(calls * perCallUsd);
  return { usd: searchUsd, llmUsd: 0, searchUsd, inputTokens: 0, outputTokens: 0, searchCalls: calls };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
