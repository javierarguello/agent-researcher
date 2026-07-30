/**
 * The per-job spend ceiling (C1/C2/C3).
 *
 * Retry amplification is bounded in TRIES — 3 in-run attempts × 8 dispatches — and
 * was bounded in dollars by nothing at all: a grep for a cost cap across the whole
 * repo returned nothing. A job that cannot satisfy its own schemas therefore spends
 * 24 full research loops discovering that, and finishes `completed` with degraded
 * placeholders, so no refund runs either.
 *
 * The ceiling is the backstop under every other fix here. What it has to get right:
 *   - count the WHOLE job, across dispatches — a per-dispatch cap is 8× no cap;
 *   - stop the job rather than let it re-dispatch into the same wall seven more times;
 *   - never hide spend that already happened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { config } from '../src/config.js';
import { createCostSink, emptyCost, llmCost, type Cost } from '../src/cost.js';
import { createEvidence, gather } from '../src/engine/gather.js';
import { runResearch, type Checkpoint } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { __setProviderForTests } from '../src/llm/models.js';
import { MockLlmProvider } from './mocks/llm.js';
import type { ResolvedModel } from '../src/llm/index.js';
import type { GenerateOptions, GenerateResult, LlmProvider } from '../src/llm/provider.js';

const template = getTemplate('florida-business-for-sale')!;
const params = () => template.paramsSchema.parse({ industry: 'x', mode: 'essential' }) as Record<string, unknown>;

const usd = (n: number): Cost => ({ ...emptyCost(), usd: n, llmUsd: n });

describe('CostSink — one job total, one ceiling', () => {
  it('records a child’s spend in the parent while keeping the child’s own slice', () => {
    const job = createCostSink();
    const attempt = job.child();
    attempt.add(llmCost(100, 50, 1, 10));
    job.child().add(llmCost(100, 50, 1, 10));

    // The child sees its attempt; the parent sees the job. Two views, one accumulator
    // — which is what lets `trace.cost` be READ from the job sink instead of summed
    // a second time.
    expect(attempt.total().inputTokens).toBe(100);
    expect(job.total().inputTokens).toBe(200);
  });

  it('answers the budget question from the root, whichever sink you hold', () => {
    const job = createCostSink({ maxUsd: 1 });
    const attempt = job.child();
    expect(attempt.budget()).toEqual({ spentUsd: 0, limitUsd: 1, exceeded: false });

    attempt.add(usd(0.75));
    expect(attempt.budget().exceeded).toBe(false);
    attempt.add(usd(0.3));
    // The attempt spent $1.05 of the JOB's dollar — a sink that answered from its
    // own slice would still say there was room.
    expect(attempt.budget().exceeded).toBe(true);
    expect(job.budget().exceeded).toBe(true);
  });

  it('counts spend it was seeded with — prior dispatches are part of the job', () => {
    const job = createCostSink({ maxUsd: 1, seed: usd(0.9) });
    expect(job.budget().exceeded).toBe(false);
    job.child().add(usd(0.2));
    expect(job.budget().exceeded).toBe(true);
  });

  it('is uncapped when no ceiling is configured', () => {
    for (const maxUsd of [undefined, 0, -1, null]) {
      const job = createCostSink({ maxUsd });
      job.add(usd(1_000));
      expect(job.budget()).toMatchObject({ limitUsd: null, exceeded: false });
    }
  });

  it('still records spend after the ceiling is passed', () => {
    // The ceiling stops the next call. It must never make a call that was already
    // billed invisible — that is the under-counting bug this whole module exists
    // to prevent, re-entering through the front door.
    const job = createCostSink({ maxUsd: 1 });
    job.add(usd(2));
    job.add(usd(3));
    expect(job.total().usd).toBe(5);
  });
});

describe('the engine stops a job at its ceiling', () => {
  let mock: MockLlmProvider;
  const original = config.workflow.maxJobCostUsd;

  beforeEach(() => {
    mock = new MockLlmProvider();
    __setProviderForTests('gemini-vertex', mock);
  });
  afterEach(() => {
    config.workflow.maxJobCostUsd = original;
  });

  it('spends nothing when earlier dispatches already used the ceiling up', async () => {
    config.workflow.maxJobCostUsd = 1;
    const resume: Checkpoint = {
      report: {}, sources: [], doneAgentIds: [], degraded: [],
      cost: usd(5), // what the previous dispatches burned, carried in the checkpoint
    };

    const out = await runResearch({
      template, params: params(), jobId: 'b1', generatedAt: 't', resume, finalize: false,
    });

    // Not one provider call. A ceiling that only counted THIS dispatch would have
    // started from zero and run the whole job again — eight times over.
    expect(mock.calls).toBe(0);
    expect(out.trace.budgetExceeded).toBe(true);

    // And it did not TRY. Without a check before the attempt, each agent still
    // burns its three attempts — every one entering the loop, finding no budget,
    // failing, and sleeping through the backoff. Zero provider calls, minutes of
    // wall-clock, and a retry count that lies about what was attempted.
    expect(out.trace.agents.filter((a) => a.attempts > 0)).toEqual([]);

    const failed = out.trace.agents.filter((a) => a.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    for (const a of failed) expect(a.error).toMatch(/cost ceiling/i);
  });

  it('holds the job instead of failing it or asking to be re-dispatched', async () => {
    config.workflow.maxJobCostUsd = 1;
    const resume: Checkpoint = { report: {}, sources: [], doneAgentIds: [], degraded: [], cost: usd(5) };

    const out = await runResearch({
      template, params: params(), jobId: 'b2', generatedAt: 't', resume, finalize: false,
    });

    // NOT 'incomplete': the checkpoint carries the spend forward, so every remaining
    // dispatch would wake up already over the ceiling and re-dispatch again.
    //
    // NOT degraded either, and that is what makes an approval worth anything —
    // degrading would write placeholders into the report, and those placeholders
    // would be what an approved job resumed from.
    expect(out.trace.status).toBe('held');
    expect(out.meta.degradedSections).toBeUndefined();
    expect(Object.keys(out.report)).toHaveLength(0);
  });

  it('delivers a report that finished right ON the ceiling, rather than holding it', async () => {
    // The ceiling is a guard against spending MORE, not a verdict on work already
    // done. If the last step took the total past it, everything exists — ship it.
    const full = await runResearch({ template, params: params(), jobId: 'b2b', generatedAt: 't' });
    __setProviderForTests('gemini-vertex', new MockLlmProvider());
    // Resume with every step already done and the spend already past the ceiling:
    // there is nothing left to hold BACK from, only a finished report to hand over.
    config.workflow.maxJobCostUsd = full.trace.cost.usd / 2;

    const out = await runResearch({
      template, params: params(), jobId: 'b2c', generatedAt: 't', resume: full.checkpoint,
    });

    expect(out.trace.status).toBe('completed');
    expect(out.trace.warnings?.join(' ')).toMatch(/right at the per-job cost ceiling/i);
  });

  it('never prints what we spent into the buyer’s report', async () => {
    config.workflow.maxJobCostUsd = 1;
    const resume: Checkpoint = { report: {}, sources: [], doneAgentIds: [], degraded: [], cost: usd(5) };
    const out = await runResearch({
      template, params: params(), jobId: 'b5', generatedAt: 't', resume, finalize: false,
    });

    // A failed agent's `error` becomes the reason text inside its degraded section,
    // and that section is rendered to the customer. So the ceiling's own message
    // must not carry figures: "spent $23.41 of the $20.00 allowed" is our
    // infrastructure spend, printed in something the buyer paid for and reads.
    const money = /\$\s?\d/;
    expect(JSON.stringify(out.report)).not.toMatch(money);
    expect((out.trace.warnings ?? []).join(' ')).not.toMatch(money);

    // …while the figures stay where they are needed: the trace and the job total.
    expect(out.trace.agents.some((a) => a.notes.some((n) => money.test(n)))).toBe(true);
    expect(out.trace.cost.usd).toBeGreaterThan(0);
  });

  it('stops mid-run, having spent about the ceiling and not the whole job', async () => {
    const full = await runResearch({ template, params: params(), jobId: 'b3', generatedAt: 't' });
    const fullCalls = mock.calls;
    expect(full.trace.status).toBe('completed');
    expect(full.trace.budgetExceeded).toBeUndefined(); // the default ceiling is nowhere near

    const capped = new MockLlmProvider();
    __setProviderForTests('gemini-vertex', capped);
    config.workflow.maxJobCostUsd = full.trace.cost.usd / 4;

    const out = await runResearch({ template, params: params(), jobId: 'b4', generatedAt: 't' });

    expect(out.trace.budgetExceeded).toBe(true);
    expect(out.trace.status).toBe('held');
    expect(capped.calls).toBeLessThan(fullCalls / 2);
    expect(out.trace.cost.usd).toBeLessThan(full.trace.cost.usd);
    // The work bought so far is kept, which is what an approval resumes from.
    expect(out.checkpoint.doneAgentIds.length).toBeGreaterThan(0);
  });

  it('takes the ceiling from the MODEL\u2019s mode before the deployment default', async () => {
    // This is a catalog: a cheap scan and a deep multi-agent report cannot share one
    // number. A model that states its own cost profile must win over the global.
    config.workflow.maxJobCostUsd = 1000; // deployment says "plenty"
    const stingy = {
      ...template,
      modes: { ...template.modes, essential: { ...template.modes!.essential!, maxCostUsd: 0.002 } },
    };

    const out = await runResearch({ template: stingy, params: params(), jobId: 'b6', generatedAt: 't' });

    expect(out.trace.status).toBe('held');
    expect(out.trace.budgetExceeded).toBe(true);
  });

  it('runs uncapped when the job was approved to continue', async () => {
    // What an admin approval passes down. Without it the resumed job would wake up
    // already over the ceiling and hold again, forever.
    config.workflow.maxJobCostUsd = 0.001;
    const out = await runResearch({
      template, params: params(), jobId: 'b7', generatedAt: 't', costCeilingUsd: null,
    });

    expect(out.trace.status).toBe('completed');
    expect(out.trace.budgetExceeded).toBeUndefined();
    expect(out.trace.cost.usd).toBeGreaterThan(0.001);
  });
});

// --- gather: the loop that had no output cap at all --------------------------

/** Answers every turn with another search, so only a guard can end the loop. */
class EndlessSearcher implements LlmProvider {
  readonly name = 'endless';
  readonly seen: GenerateOptions[] = [];
  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    this.seen.push(opts);
    return {
      text: '',
      toolCalls: [{ id: `t${this.seen.length}`, name: 'web_search', args: { query: 'q' } }],
      usage: { inputTokens: 1000, outputTokens: 1000 },
    };
  }
}

describe('gather bounds what a research turn may emit, and stops at the ceiling', () => {
  const model = (provider: LlmProvider): ResolvedModel => ({
    alias: 'gather', provider, model: 'endless', inPerM: 1, outPerM: 10,
  });

  it('caps output tokens and the thinking budget on every turn', async () => {
    const provider = new EndlessSearcher();
    await gather({
      spend: createCostSink(), model: model(provider), system: 's',
      messages: [{ role: 'user', text: 'go' }], maxTurns: 3, evidence: createEvidence(),
    });

    expect(provider.seen.length).toBeGreaterThan(0);
    for (const opts of provider.seen) {
      // Uncapped, each of `2×budget+6` turns could emit up to the model default —
      // and on Gemini 2.5 thinking tokens are billed as output.
      expect(opts.maxOutputTokens).toBe(config.llm.gatherMaxOutputTokens);
      expect(opts.thinkingBudget).toBe(config.llm.gatherThinkingBudget);
    }
  });

  it('stops looping once the job has spent its ceiling', async () => {
    const provider = new EndlessSearcher();
    // Each turn bills $0.011 in tokens, so the ceiling lands after the second.
    const spend = createCostSink({ maxUsd: 0.02 });
    const result = await gather({
      spend, model: model(provider), system: 's',
      messages: [{ role: 'user', text: 'go' }], maxTurns: 12, evidence: createEvidence(),
    });

    expect(spend.budget().exceeded).toBe(true);
    expect(result.turns).toBeLessThan(12); // the search budget was never the binding limit
    expect(provider.seen.length).toBeLessThan(6);
  });
});
