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
