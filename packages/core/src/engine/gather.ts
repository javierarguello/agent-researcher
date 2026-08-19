/**
 * The web-research loop, shared by every producer agent.
 *
 * A budgeted tool-calling loop (plan → web_search → fetch_page) that writes into
 * a shared `Evidence` store — so a page fetched by one agent is reused (never
 * re-fetched) by another, and the final `sources` list is unified.
 */
import { config } from '../config.js';
import { stripFenceMarker, stripFenceMarkerDeep } from './prompt.js';
import { llmCost, searchCost, type Cost, type CostSink } from '../cost.js';
import type { ResolvedModel } from '../llm/index.js';
import type { LlmMessage, ToolCall, ToolSchema } from '../llm/provider.js';
import type { ProgressKind } from '../jobs/types.js';
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
  /**
   * Every URL THIS loop saw — each result a search returned to it, each page it
   * fetched, each cached page it re-read. Added to as the loop runs (so a throw
   * keeps what was seen), and what the write-up renders FIRST: the shared store
   * is filled in insertion order by whichever agent ran first, and the dossier
   * used to take the first 48 snippets / 14 pages of it — so every producer past
   * the third wrote from other agents' evidence and never saw its own.
   */
  touched?: Set<string>;
  /** Of those, the pages this loop FETCHED or re-read from the cache — its strongest claim. */
  fetched?: Set<string>;
  model: ResolvedModel;
  system: string;
  messages: LlmMessage[];
  maxTurns: number;
  evidence: Evidence;
  /**
   * Called with a short progress note after each tool step — the English
   * sentence for the trace, its KIND for a client to localize, and the one
   * variable a client may show (the query of a `searched`).
   */
  onNote?: (note: string, kind: ProgressKind, detail?: string) => void | Promise<void>;
  /**
   * Called each time a turn is CHARGED — before the search or fetch is made, like
   * the cost. The caller used to add `gres.turns` after the loop returned, so a
   * loop that threw left its turns uncounted (`searchCalls` 5, `turnsUsed` 4 in
   * the summary) and the live progress line's turn count lagged a whole loop
   * behind on every honest run.
   */
  onTurn?: () => void;
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

/**
 * Page bodies kept verbatim in the LOOP's context. Older ones are replaced by a
 * stub that names the URL.
 *
 * Every tool result stays in `messages` for every later turn, and a page is 6,000
 * characters — so by turn 12 the model re-reads eleven full pages to decide one
 * more query, and the input cost of the loop grows with the SQUARE of the budget.
 *
 * Nothing is lost: the full text lives in the shared evidence store and is what the
 * synthesis prompt renders. The loop only needs to know what it has already looked
 * at, and the last couple of pages are what a next query is usually reasoning from.
 */
const KEEP_FULL_PAGES = 2;

const PAGE_STUB = '[Full text omitted here to keep this loop small — it is kept in full for the write-up.]';

/**
 * Replace the bodies of all but the most recent `KEEP_FULL_PAGES` fetched pages.
 *
 * Mutates in place: `messages` is the conversation the loop is building, and the
 * point is that the NEXT turn is cheaper.
 */
function trimOldPages(messages: LlmMessage[]): void {
  const fetches: Array<{ pages: Array<{ content?: string }> }> = [];
  for (const m of messages) {
    const res = m.toolResult;
    if (m.role !== 'tool' || res?.name !== 'fetch_page') continue;
    const body = res.response as { pages?: Array<{ content?: string }> };
    if (Array.isArray(body?.pages)) fetches.push({ pages: body.pages });
  }
  for (const f of fetches.slice(0, Math.max(0, fetches.length - KEEP_FULL_PAGES))) {
    for (const page of f.pages) {
      if (page.content && page.content !== PAGE_STUB) page.content = PAGE_STUB;
    }
  }
}

/**
 * How many model turns in a row may consist ONLY of `update_plan` before the loop
 * intervenes — and how many more before it ends.
 *
 * Measured on the two real July traces (Gemini 2.5 Flash): the honest model
 * re-plans about once per step, at most TWO plan-only turns in a row across
 * eighteen honest agent-runs. The two pathological runs were the deep-dive-refiner
 * (22 plans + 4 cached re-reads + 0 searches, ended only by `maxIterations`, $0.38,
 * its "pro pass" written from no new research) and the risk-analyst (16 plans, 0
 * turns). What made them possible: `forceTools` at zero turns is Gemini's
 * function-calling mode ANY, so a producer with nothing to search literally could
 * not answer without a tool call — the iteration bound was its only exit, and the
 * "you have not gathered any evidence" nudge never ran. So at PLAN_TURNS_BEFORE_NUDGE
 * the plan result says stop planning AND the next call is no longer forced (the
 * model may now say it is ready); at PLAN_TURNS_LIMIT the loop ends. A page that
 * asks for forty plan updates ends in four iterations instead of 2·budget+6.
 */
const PLAN_TURNS_BEFORE_NUDGE = 3;
const PLAN_TURNS_LIMIT = 4;

/**
 * The same bound for turns that buy nothing by ANY route, not just planning.
 *
 * One free call per turn walked straight around the plan breaker:
 * `[update_plan, fetch_page(cached)]` on repeat cost 54 LLM calls and 974,761
 * prompt chars for 0 research turns and 0 new evidence, ending `stalled` with a
 * note that read as if the model had stopped on its own (round 7, R7-3). The
 * same-URL body cap turned out to be a 38% discount on that, not a bound: what
 * kept growing was the conversation, not the page bodies. The real pathological
 * refiner in the July traces is `(Pc)*`; the breaker caught it only because its
 * four re-reads happened to come first.
 *
 * "Buys nothing" is `buysNothing()` below, decided BEFORE the calls run: a plan
 * update, a call we are about to refuse (allowance spent, search dead, unknown
 * tool), or a re-read of a page whose body we will not send again. A paid search
 * or fetch resets it — and so does a cached read that DOES return a body, which
 * is what keeps the honest `P c P c P F` refiner alive.
 *
 * Looser than the plan bound on purpose, and measured: the most free-and-useless
 * turns in a row any honest persona in `b-legit` reaches is 6 (the cross-checker
 * that re-reads ONE listing five times: reads 3-5 are answered with the stub, and
 * it re-plans between them). 8 keeps the same two-turn margin the plan bound has
 * over its own honest maximum of 2.
 */
const NO_PROGRESS_TURNS_LIMIT = 8;

/**
 * How many times the SAME cached page is returned in full to one loop.
 *
 * The honest deep-dive-refiner re-reads pages the scout fetched — four distinct
 * ones in the real trace, and re-checking a figure on the same page once is
 * ordinary. Past that the body is not sent again: the text is already in the
 * conversation twice and in the shared evidence the write-up renders. This is what
 * bounds a page that alternates a free plan update with a free re-read of itself
 * (each iteration re-sending the whole conversation) — the loop still runs, but it
 * stops growing.
 */
const MAX_SAME_URL_CACHED_READS = 2;

const CACHED_STUB = '[Already returned to you twice in this loop — it is in your evidence and in the write-up. Do not fetch it again.]';

/**
 * Stub the arguments of every `update_plan` call except the latest.
 *
 * Mutates in place, like `trimOldPages`, and for the same reason: every model turn
 * stays in `messages` for every later turn, and a plan is the model's scratchpad —
 * a thirty-step list re-sent on each of fifty iterations was the other half of a
 * loop whose requests grew 12× within the iteration bound. Only the LATEST plan
 * is what the model reasons from. The call itself stays (Gemini rejects a
 * `functionCall` without its `functionResponse`); only its `steps` are replaced.
 */
function trimOldPlans(messages: LlmMessage[]): void {
  const planCalls: ToolCall[] = [];
  for (const m of messages) {
    if (m.role !== 'model') continue;
    for (const c of m.toolCalls ?? []) if (c.name === 'update_plan') planCalls.push(c);
  }
  for (const c of planCalls.slice(0, Math.max(0, planCalls.length - 1))) {
    if (Array.isArray((c.args as { steps?: unknown }).steps)) {
      c.args = { steps: [], superseded: 'replaced by a later plan' };
    }
  }
}

/** Run one budgeted research loop, appending to the shared evidence. Spend goes to `input.spend`. */
/**
 * A search result as the research loop may see it.
 *
 * Title, URL and snippet are all written by whoever owns the page. The providers
 * JSON-encode a tool result, which stops a forged header from beginning a line —
 * an accident, not a guarantee, and it says nothing about the marker.
 */
function untrustedResult(r: SearchResult): SearchResult {
  return {
    ...r,
    title: stripFenceMarker(r.title ?? ''),
    url: stripFenceMarker(r.url ?? ''),
    snippet: stripFenceMarker(r.snippet ?? ''),
  };
}

export async function gather(input: GatherInput): Promise<GatherResult> {
  const { model, system, messages, maxTurns, evidence, onNote, onTurn } = input;
  const touched = input.touched ?? new Set<string>();
  const fetched = input.fetched ?? new Set<string>();
  let plan: PlanStep[] = [];
  let turnsUsed = 0;
  let nudges = 0;
  // Charge as we go: this loop can throw at any turn — a provider error, a tool
  // failure — and whatever it spent before that still has to be visible.
  const charge = (c: Cost) => input.spend?.add(c);
  const maxIterations = maxTurns * 2 + 6;
  const note = async (m: string, kind: ProgressKind, detail?: string) => onNote?.(m, kind, detail);
  /**
   * Consecutive failing searches, and the point at which we stop paying for more.
   *
   * The turn and the charge are taken BEFORE the call — deliberately, because a
   * provider that took the request may well have billed it, and pretending
   * otherwise under-reports what a job cost. What was wrong is that the failure
   * then went into a tool result and nowhere else: no note, no log, nothing in
   * the trace. A degraded provider burned the entire search budget and the entire
   * estimated search spend on queries that all failed, and the only evidence was
   * that the report came out thin.
   *
   * Three in a row is a broken provider, not a bad query. Stop, and say so.
   */
  let searchFailures = 0;
  const MAX_SEARCH_FAILURES = 3;
  /** Model turns in a row that carried only `update_plan` calls. */
  let planOnlyTurns = 0;
  /** Model turns in a row that bought nothing and returned nothing new (⊇ the above). */
  let noProgressTurns = 0;
  /** Full-text returns per cached URL, this loop. */
  const cachedReads = new Map<string, number>();
  /**
   * Cached URLs whose body this loop has already returned.
   *
   * `cachedReads` is per-URL, and any body-returning read reset `noProgressTurns` —
   * so every distinct page in the shared store was worth two free resets and the
   * breaker's real bound was `8 × 2 × |distinct cached pages|`. Four pages already
   * cleared the iteration ceiling: the July `(Pc)*` shape ran 54 LLM calls and
   * 808,868 prompt characters on zero turns and zero search spend, which is free of
   * SEARCH money and not free of ours (round 8, R8-4). A page is new to this loop
   * once; reading it again teaches the model nothing, whichever page it alternates
   * with.
   */
  const readThisLoop = new Set<string>();
  // Assume the worst until the loop ends for a reason: an unexpected exit is a
  // half-finished pass, and a half-finished pass must not be handed to a retry as
  // if it were research already done.
  let stop: GatherStop = 'stalled';

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Stop, don't throw: the evidence bought so far is in the shared store and is
    // useful to whoever runs next. The caller checks the same budget and decides
    // whether this agent can still afford to write.
    if (input.spend?.budget().exceeded) {
      await note('Stopping research: the job reached its cost ceiling.', 'ceiling');
      stop = 'ceiling';
      break;
    }
    // Immediately before the call, so the bound is exact: at most KEEP_FULL_PAGES
    // page bodies and ONE full plan travel in any single request, however long
    // the loop runs.
    trimOldPages(messages);
    trimOldPlans(messages);

    const res = await model.provider.generate({
      system,
      messages,
      tools: RESEARCH_TOOLS,
      // Force real research before it can stop — but not once it has planned
      // three turns in a row without searching: under Gemini's mode ANY the model
      // cannot answer without a tool call, and the honest way out of a plan-loop
      // is to let it say it is ready (or to end the loop, below).
      forceTools: turnsUsed === 0 && noProgressTurns < PLAN_TURNS_BEFORE_NUDGE,
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

    // The model's own turn, back to it — the one other place text entered a prompt
    // outside `untrusted()`. Its own authority, but the marker still must not ride.
    // Its ARGS too, not only its text: a plan step is model output written after
    // reading pages, it rides in every later request of this loop, and it was the
    // one model-authored string on this path that went back unstripped (R7-17).
    // …and the loop READS this copy from here on, not `res.toolCalls`. R7-17 stripped
    // what went back into `messages` and left every consumer reading the raw args, so
    // the `web_search` tool result echoed the raw `query` twelve lines below the strip
    // and put the marker back in the conversation for the rest of the loop — with an
    // odd count, which is the invariant `a-attack` measures (round 8, R8-7).
    const toolCalls = res.toolCalls.map((c) => ({ ...c, args: stripFenceMarkerDeep(c.args) }));
    messages.push({ role: 'model', text: stripFenceMarker(res.text), toolCalls });

    // Classified BEFORE the calls run, so the loop can end without paying for the
    // turn — the same shape as the plan-only rule this replaces. Every branch below
    // that spends a turn, or returns a page body, is `false` here.
    const buysNothing = (c: ToolCall): boolean => {
      if (c.name === 'update_plan') return true;
      if (c.name === 'web_search') return turnsUsed >= maxTurns || searchFailures >= MAX_SEARCH_FAILURES;
      if (c.name === 'fetch_page') {
        if (turnsUsed >= maxTurns) return true;
        const url = String((c.args as any).url ?? '').trim();
        // A cached page we are about to answer with the stub teaches the model
        // nothing it has not already been told twice — and neither does one whose
        // body this loop has already handed over, however many turns ago (R8-4).
        if (url && evidence.extractedUrls.has(url)) {
          return readThisLoop.has(url) || (cachedReads.get(url) ?? 0) + 1 > MAX_SAME_URL_CACHED_READS;
        }
        return false; // a paid fetch
      }
      return true; // unknown tool: an error string back, nothing bought
    };
    const noProgress = toolCalls.length > 0 && toolCalls.every(buysNothing);
    noProgressTurns = noProgress ? noProgressTurns + 1 : 0;
    const planOnly = toolCalls.length > 0 && toolCalls.every((c) => c.name === 'update_plan');
    planOnlyTurns = planOnly ? planOnlyTurns + 1 : 0;
    // The nudge below was delivered on an earlier turn and the model asked for
    // nothing again. Nothing it can plan or re-read will change without new
    // evidence; end the loop rather than pay for the rest of the iterations.
    // `stalled`, not `done`: it was cut off, and with the allowance unspent there
    // is nothing worth reusing anyway.
    if (planOnlyTurns >= PLAN_TURNS_LIMIT) {
      await note(`Stopping research: ${planOnlyTurns} plan updates in a row with no search or fetch.`, 'cut_off');
      break;
    }
    if (noProgressTurns >= NO_PROGRESS_TURNS_LIMIT) {
      await note(`Stopping research: ${noProgressTurns} turns in a row with no new evidence (no search, no new page).`, 'cut_off');
      break;
    }

    if (toolCalls.length === 0) {
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

    // One note per FREE branch per model turn, however many calls the turn carried.
    // A note is a trace line, a progress write and a buyer-visible message, and a
    // turn carrying hundreds of free calls used to emit one of each per call — 400
    // cached re-reads evicted the `Writing` note and the loop's own closing note
    // from the 300 an agent keeps, and fired 410 progress writes (round 7, R7-29).
    let planNoted = false;
    let cachedReused = 0;
    let cachedDeclined = 0;
    for (const call of toolCalls) {
      if (call.name === 'update_plan') {
        plan = Array.isArray((call.args as any).steps) ? ((call.args as any).steps as PlanStep[]) : plan;
        const response: Record<string, unknown> = { ok: true, turnsLeft: Math.max(0, maxTurns - turnsUsed) };
        if (noProgress && noProgressTurns >= PLAN_TURNS_BEFORE_NUDGE) {
          response.stopPlanning = true;
          response.message =
            `You have spent ${noProgressTurns} turns in a row without gathering anything new — no search, and no page you ` +
            `have not already been given. Do not call update_plan again: either web_search / fetch_page a NEW url now, or ` +
            `stop calling tools and say you are ready to write.`;
        }
        messages.push({ role: 'tool', toolResult: { name: call.name, response } });
        // One note per model turn, however many plan calls it carried: the note
        // is what the buyer's progress line and the admin's trace see, and a turn
        // that carried a hundred plan updates used to be a hundred progress
        // writes and a hundred trace lines — enough to evict the notes an admin
        // actually needs from the 300 an agent keeps.
        if (!planNoted) {
          planNoted = true;
          await note(`Plan updated (${plan.length} steps).`, 'plan');
        }
      } else if (call.name === 'web_search') {
        const query = String((call.args as any).query ?? '').trim();
        if (turnsUsed >= maxTurns) {
          messages.push({
            role: 'tool',
            toolResult: { name: call.name, response: { stop: true, message: `Budget reached (${maxTurns}).`, turnsLeft: 0 } },
          });
          continue;
        }
        if (searchFailures >= MAX_SEARCH_FAILURES) {
          // Not charged and not counted against the turn budget: we are not
          // calling anything.
          messages.push({
            role: 'tool',
            toolResult: {
              name: call.name,
              response: {
                stop: true,
                message: `Search is unavailable (${searchFailures} consecutive failures). Write with the evidence you have.`,
                turnsLeft: 0,
              },
            },
          });
          continue;
        }
        turnsUsed += 1;
        onTurn?.();
        charge(searchCost(1, searchCostPerCall('search')));
        try {
          const results = await searchWeb(query);
          searchFailures = 0;
          for (const r of results) {
            if (r.url) touched.add(r.url);
            if (r.url && !evidence.seenUrls.has(r.url)) {
              evidence.seenUrls.add(r.url);
              evidence.sources.push(r);
            }
          }
          messages.push({
            role: 'tool',
            toolResult: {
              name: call.name,
              // The FRONT DOOR. The dossier fence protects the synthesis prompt;
              // this loop reads the same pages first, turn after turn, and it is
              // the loop that chooses the next query and URL — and whose model
              // writes the handoff every later agent reads. Fencing downstream of
              // the compromise is not fencing.
              response: { query, results: results.map(untrustedResult), turnsLeft: maxTurns - turnsUsed },
            },
          });
          await note(`Searched: ${query}`, 'searched', query);
        } catch (error) {
          searchFailures += 1;
          // Into the TRACE, which is what an admin reads to decide about a job.
          // This was the most expensive silently-swallowed catch in the job path:
          // charged, failed, and invisible.
          await note(`Search failed (${searchFailures}/${MAX_SEARCH_FAILURES}): ${query} — ${(error as Error).message}`, 'search_failed');
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
          touched.add(url);
          fetched.add(url);
          const reads = (cachedReads.get(url) ?? 0) + 1;
          cachedReads.set(url, reads);
          const cached = evidence.extracted.find((p) => p.url === url);
          const content = reads > MAX_SAME_URL_CACHED_READS ? CACHED_STUB : stripFenceMarker(cached?.content ?? '');
          if (content !== CACHED_STUB) readThisLoop.add(url);
          messages.push({
            role: 'tool',
            toolResult: {
              name: call.name,
              response: {
                pages: [{ url, ok: true, content, cached: true }],
                turnsLeft: maxTurns - turnsUsed,
              },
            },
          });
          if (reads > MAX_SAME_URL_CACHED_READS) cachedDeclined += 1;
          else cachedReused += 1;
          continue;
        }
        // The turn is spent either way — that is the budget guard, and it is
        // deliberate. The call is not: an empty url short-circuits inside
        // `extractPages`, and without a Tavily key it refuses locally. Neither
        // reaches a backend, so counting either would invent a call (`searchCalls`
        // is billed backend calls) on top of inventing spend.
        turnsUsed += 1;
        onTurn?.();
        if (url && canExtractPages()) charge(searchCost(1, searchCostPerCall('extract')));
        const pages = await extractPages(url ? [url] : []);
        for (const p of pages) {
          if (p.ok && p.content) {
            touched.add(p.url);
            fetched.add(p.url);
          }
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
              pages: pages.map((p) => ({ url: p.url, ok: p.ok, error: p.error, content: stripFenceMarker(p.content ?? '') })),
              turnsLeft: maxTurns - turnsUsed,
            },
          },
        });
        await note(`Fetched ${pages.filter((p) => p.ok).length} page(s).`, 'fetched');
      } else {
        messages.push({ role: 'tool', toolResult: { name: call.name, response: { error: `Unknown tool: ${call.name}` } } });
      }
    }
    // After the turn, so the count is the turn's: `Reused cached page.` stays the
    // wording for the ordinary one-per-turn re-read the honest refiner does.
    if (cachedReused) {
      await note(cachedReused === 1 ? `Reused cached page.` : `Reused ${cachedReused} cached pages.`, 'cached');
    }
    if (cachedDeclined) {
      await note(
        cachedDeclined === 1
          ? `Declined to re-send a page already returned twice.`
          : `Declined to re-send ${cachedDeclined} pages already returned twice.`,
        'cached',
      );
    }
  }

  // A loop that spent its whole allowance and then ran out of iterations before
  // it could say "ready" FINISHED its research — the honest deal-scout in the real
  // July trace did exactly this (24 paid turns + 24 plans + 6 cached re-reads = the
  // bound), and was classed unfinished, so one flaky write afterwards re-bought the
  // job's most expensive loop. Only a loop cut off with budget LEFT is half-done.
  if (stop === 'stalled' && turnsUsed >= maxTurns) stop = 'budget';
  // Say why it ended. Two real agent-runs reached the iteration bound with zero
  // searches and nothing in the trace said so; an admin reading it could not tell
  // a section written from research from one written from none.
  // The KIND carries which of the two it was. `stopped` is "research for this step
  // is complete", and it was fired for every exit — including the loop we cut off
  // and the one that hit the job's cost ceiling, i.e. exactly when it is not true.
  await note(`Research loop ended: ${stop} (${turnsUsed}/${maxTurns} turns).`, stop === 'done' || stop === 'budget' ? 'stopped' : 'cut_off');
  return { turns: turnsUsed, stop };
}
