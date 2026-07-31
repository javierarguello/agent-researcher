/**
 * The web-research loop, shared by every producer agent.
 *
 * A budgeted tool-calling loop (plan → web_search → fetch_page) that writes into
 * a shared `Evidence` store — so a page fetched by one agent is reused (never
 * re-fetched) by another, and the final `sources` list is unified.
 */
import { config } from '../config.js';
import { llmCost, searchCost, type Cost, type CostSink } from '../cost.js';
import type { ResolvedModel } from '../llm/index.js';
import type { LlmMessage, ToolSchema } from '../llm/provider.js';
import { canExtractPages, extractPages, searchWeb, searchCostPerCall, type ExtractedPage, type SearchResult } from '../tools/web-search.js';

type PlanStep = { task: string; status: 'pending' | 'doing' | 'done' | 'dropped' };

const PLAN_TOOL: ToolSchema = {
  name: 'update_plan',
  description:
    'Create or revise your research plan. Call this FIRST with an initial plan, then again as you learn ' +
    'to mark steps done/doing, add steps, or drop irrelevant ones. Pass the FULL updated list each time.',
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: 'The full, updated plan (replaces the previous one).',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'A concise research step.' },
            status: { type: 'string', enum: ['pending', 'doing', 'done', 'dropped'], description: 'Step state.' },
          },
          required: ['task', 'status'],
        },
      },
    },
    required: ['steps'],
  },
};

const SEARCH_TOOL: ToolSchema = {
  name: 'web_search',
  description:
    'Search the web for one focused query. Returns results (title, snippet, url). Each call spends one ' +
    'from your budget; when the budget is exhausted you must stop and hand off.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'A single focused search query.' } },
    required: ['query'],
  },
};

const EXTRACT_TOOL: ToolSchema = {
  name: 'fetch_page',
  description:
    'Fetch the FULL text of ONE specific web page to read details that never appear in search snippets ' +
    '(prices, financials, reviews, forum threads, lease terms). Call it once per promising URL. Each call ' +
    'spends one from your budget.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'The single page URL to fetch in full.' } },
    required: ['url'],
  },
};

export const RESEARCH_TOOLS = [PLAN_TOOL, SEARCH_TOOL, EXTRACT_TOOL];

/** Accumulated, de-duplicated evidence shared across all agents in a workflow. */
export interface Evidence {
  sources: SearchResult[];
  seenUrls: Set<string>;
  extracted: ExtractedPage[];
  extractedUrls: Set<string>;
}

export function createEvidence(): Evidence {
  return { sources: [], seenUrls: new Set(), extracted: [], extractedUrls: new Set() };
}

export interface GatherInput {
  /** Records LLM and search spend as it happens, so a throw mid-loop cannot
   *  make the turns already paid for invisible. */
  spend?: CostSink;
  model: ResolvedModel;
  system: string;
  messages: LlmMessage[];
  maxTurns: number;
  evidence: Evidence;
  /** Called with a short progress note after each tool step. */
  onNote?: (note: string) => void | Promise<void>;
}

/**
 * Why the research loop stopped. It decides whether the evidence may be REUSED by
 * a retry, so the distinction is between a loop that finished and one that was cut
 * off mid-way:
 *
 * - `done`    the agent stopped calling tools — it decided it had enough.
 * - `budget`  it spent its full search allowance. Also a finished pass.
 * - `ceiling` the JOB's cost ceiling stopped it. Cut off.
 * - `stalled` it ran out of loop iterations without concluding. Cut off.
 */
export type GatherStop = 'done' | 'budget' | 'ceiling' | 'stalled';

export interface GatherResult {
  /** No `cost` here on purpose — see `StructuredResult`: the sink is the only accumulator. */
  turns: number;
  /** How the loop ended. Only `done` and `budget` mean the pass finished. */
  stop: GatherStop;
}

/** A finished pass — the only kind a retry may reuse instead of re-running. */
export function gatherCompleted(result: GatherResult): boolean {
  return (result.stop === 'done' || result.stop === 'budget') && result.turns > 0;
}

/** Run one budgeted research loop, appending to the shared evidence. Spend goes to `input.spend`. */
export async function gather(input: GatherInput): Promise<GatherResult> {
  const { model, system, messages, maxTurns, evidence, onNote } = input;
  let plan: PlanStep[] = [];
  let turnsUsed = 0;
  let nudges = 0;
  // Charge as we go: this loop can throw at any turn — a provider error, a tool
  // failure — and whatever it spent before that still has to be visible.
  const charge = (c: Cost) => input.spend?.add(c);
  const maxIterations = maxTurns * 2 + 6;
  const note = async (m: string) => onNote?.(m);
  // Assume the worst until the loop ends for a reason: an unexpected exit is a
  // half-finished pass, and a half-finished pass must not be handed to a retry as
  // if it were research already done.
  let stop: GatherStop = 'stalled';

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Stop, don't throw: the evidence bought so far is in the shared store and is
    // useful to whoever runs next. The caller checks the same budget and decides
    // whether this agent can still afford to write.
    if (input.spend?.budget().exceeded) {
      await note('Stopping research: the job reached its cost ceiling.');
      stop = 'ceiling';
      break;
    }
    const res = await model.provider.generate({
      system,
      messages,
      tools: RESEARCH_TOOLS,
      forceTools: turnsUsed === 0, // force real research before it can stop
      model: model.model,
      // A research turn emits a plan or a query — nothing long. Without these two
      // it could emit up to the model default on every one of `2×budget+6` turns,
      // and on Gemini 2.5 thinking tokens bill as output. The thinking budget is
      // bounded rather than zeroed: picking the next query is the part of this
      // loop that actually benefits from reasoning.
      maxOutputTokens: config.llm.gatherMaxOutputTokens,
      thinkingBudget: config.llm.gatherThinkingBudget,
    });
    if (res.usage) charge(llmCost(res.usage.inputTokens, res.usage.outputTokens, model.inPerM, model.outPerM));

    messages.push({ role: 'model', text: res.text, toolCalls: res.toolCalls });

    if (res.toolCalls.length === 0) {
      if (turnsUsed === 0 && nudges < 2) {
        nudges += 1;
        messages.push({
          role: 'user',
          text:
            'You have not gathered any evidence yet. Call `update_plan`, then `web_search` and ' +
            '`fetch_page` to research with real sources before concluding.',
        });
        continue;
      }
      // The agent stopped asking for tools: it is done, whether it spent the whole
      // allowance or decided it had enough.
      stop = turnsUsed >= maxTurns ? 'budget' : 'done';
      break;
    }

    for (const call of res.toolCalls) {
      if (call.name === 'update_plan') {
        plan = Array.isArray((call.args as any).steps) ? ((call.args as any).steps as PlanStep[]) : plan;
        messages.push({
          role: 'tool',
          toolResult: { name: call.name, response: { ok: true, turnsLeft: Math.max(0, maxTurns - turnsUsed) } },
        });
        await note(`Plan updated (${plan.length} steps).`);
      } else if (call.name === 'web_search') {
        const query = String((call.args as any).query ?? '').trim();
        if (turnsUsed >= maxTurns) {
          messages.push({
            role: 'tool',
            toolResult: { name: call.name, response: { stop: true, message: `Budget reached (${maxTurns}).`, turnsLeft: 0 } },
          });
          continue;
        }
        turnsUsed += 1;
        charge(searchCost(1, searchCostPerCall('search')));
        try {
          const results = await searchWeb(query);
          for (const r of results) {
            if (r.url && !evidence.seenUrls.has(r.url)) {
              evidence.seenUrls.add(r.url);
              evidence.sources.push(r);
            }
          }
          messages.push({
            role: 'tool',
            toolResult: { name: call.name, response: { query, results, turnsLeft: maxTurns - turnsUsed } },
          });
          await note(`Searched: ${query}`);
        } catch (error) {
          messages.push({
            role: 'tool',
            toolResult: { name: call.name, response: { query, error: (error as Error).message, results: [] } },
          });
        }
      } else if (call.name === 'fetch_page') {
        const url = String((call.args as any).url ?? '').trim();
        if (turnsUsed >= maxTurns) {
          messages.push({
            role: 'tool',
            toolResult: { name: call.name, response: { stop: true, message: `Budget reached (${maxTurns}).`, turnsLeft: 0 } },
          });
          continue;
        }
        // Reuse a page already fetched by another agent — no budget spent.
        if (url && evidence.extractedUrls.has(url)) {
          const cached = evidence.extracted.find((p) => p.url === url);
          messages.push({
            role: 'tool',
            toolResult: {
              name: call.name,
              response: { pages: [{ url, ok: true, content: cached?.content ?? '', cached: true }], turnsLeft: maxTurns - turnsUsed },
            },
          });
          await note(`Reused cached page.`);
          continue;
        }
        // The turn is spent either way — that is the budget guard, and it is
        // deliberate. The call is not: an empty url short-circuits inside
        // `extractPages`, and without a Tavily key it refuses locally. Neither
        // reaches a backend, so counting either would invent a call (`searchCalls`
        // is billed backend calls) on top of inventing spend.
        turnsUsed += 1;
        if (url && canExtractPages()) charge(searchCost(1, searchCostPerCall('extract')));
        const pages = await extractPages(url ? [url] : []);
        for (const p of pages) {
          if (p.ok && p.content && !evidence.extractedUrls.has(p.url)) {
            evidence.extractedUrls.add(p.url);
            evidence.extracted.push(p);
          }
        }
        messages.push({
          role: 'tool',
          toolResult: {
            name: call.name,
            response: {
              pages: pages.map((p) => ({ url: p.url, ok: p.ok, error: p.error, content: p.content })),
              turnsLeft: maxTurns - turnsUsed,
            },
          },
        });
        await note(`Fetched ${pages.filter((p) => p.ok).length} page(s).`);
      } else {
        messages.push({ role: 'tool', toolResult: { name: call.name, response: { error: `Unknown tool: ${call.name}` } } });
      }
    }
  }

  return { turns: turnsUsed, stop };
}
