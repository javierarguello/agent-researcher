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
import { writableConfig } from './writable-config.js';
import { DEFAULT_MODES } from '../src/mode.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { config } from '../src/config.js';
import { BudgetExceededError, createCostSink, emptyCost, llmCost, type Cost } from '../src/cost.js';
import { createEvidence, gather } from '../src/engine/gather.js';
import { runResearch, type Checkpoint } from '../src/engine/research-engine.js';
import { getTemplate } from '../src/templates/registry.js';
import { MockLlmProvider, installMockProvider } from './mocks/llm.js';
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
    mock = installMockProvider();
  });
  afterEach(() => {
    writableConfig.workflow.maxJobCostUsd = original;
  });

  it('spends nothing when earlier dispatches already used the ceiling up', async () => {
    writableConfig.workflow.maxJobCostUsd = 1;
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
    writableConfig.workflow.maxJobCostUsd = 1;
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
    expect(out.meta.sections ?? []).toEqual([]);
    expect(Object.keys(out.report)).toHaveLength(0);
  });

  it('delivers a report that finished right ON the ceiling, rather than holding it', async () => {
    // The ceiling is a guard against spending MORE, not a verdict on work already
    // done. If the last step took the total past it, everything exists — ship it.
    const full = await runResearch({ template, params: params(), jobId: 'b2b', generatedAt: 't' });
    installMockProvider();
    // Resume with every step already done and the spend already past the ceiling:
    // there is nothing left to hold BACK from, only a finished report to hand over.
    writableConfig.workflow.maxJobCostUsd = full.trace.cost.usd / 2;

    const out = await runResearch({
      template, params: params(), jobId: 'b2c', generatedAt: 't', resume: full.checkpoint,
    });

    expect(out.trace.status).toBe('completed');
    expect(out.trace.warnings?.join(' ')).toMatch(/right at the per-job cost ceiling/i);
  });

  it('keeps the figures out of the error a degraded section would carry', async () => {
    // The rule this defends, from `cost.ts`: an agent's `error` becomes the reason
    // recorded for its degraded section, so the ceiling's own message must not read
    // "spent $23.41 of the $20.00 allowed" — that is our infrastructure spend, in
    // something a customer paid for.
    //
    // The constructor is only half of it, and pinning only the constructor was the
    // narrow version of this test: the line that CHOOSES `message` over `detail`
    // could be swapped either way and nothing in 329 core tests noticed.
    const err = new BudgetExceededError(23.41, 20);
    const money = /\$\s?\d/;
    expect(err.message).not.toMatch(money);
    // …while the figures stay where they are needed, for the trace and the logs.
    expect(err.detail).toMatch(money);
    expect(err.detail).toContain('23.41');
  });

  it('keeps the figures out of everything the buyer is shown while it waits', async () => {
    // `job.progress.message` is the customer-facing channel — `run-job` writes what
    // the engine emits into the job document and the API returns it to the buyer
    // raw. It is the reachable one, and the reason `message` and `detail` are split
    // at all; the degraded-section story the old comment told was never true.
    const progress: string[] = [];
    writableConfig.workflow.maxJobCostUsd = 0.000001;
    const out = await runResearch({
      template, params: params(), jobId: 'b6', generatedAt: 't',
      onProgress: (p) => { progress.push(p.message); },
    });

    // Non-vacuous by construction: the ceiling really did stop this run, and it
    // really did say so on the buyer's channel.
    expect(out.trace.budgetExceeded).toBe(true);
    expect(progress.join(' ')).toMatch(/cost ceiling/i);

    const money = /\$\s?\d/;
    expect(progress.join(' '), 'progress is shown to the buyer').not.toMatch(money);
    // The per-agent `error` travels with the trace and lands in the job summary.
    const errors = out.trace.agents.map((a) => a.error ?? '').join(' ');
    expect(errors, 'agent errors reach the job summary').not.toMatch(money);
    // …and the figures ARE recorded, admin-side, or the split would just be deletion.
    expect(out.trace.agents.some((a) => a.notes.some((n) => money.test(n)))).toBe(true);
  });

  it('never prints an internal error into the buyer’s report', async () => {
    // The other half, and the reachable one: a step that fails for any ordinary
    // reason IS degraded, and what the buyer reads must be our note rather than
    // "Structured output failed schema validation: verdict.price: expected number".
    const mock = installMockProvider();
    const base = mock.generate.bind(mock);
    mock.generate = async (opts) =>
      opts.responseSchema
        ? { text: 'not json at all', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }
        : base(opts);

    writableConfig.workflow.maxJobCostUsd = 1000;
    const out = await runResearch({ template, params: params(), jobId: 'b5', generatedAt: 't' });

    // Non-vacuous by construction: every section really did degrade.
    expect(((out.meta.sections ?? []).map((x) => x.key) ?? []).length).toBeGreaterThan(0);

    const body = JSON.stringify(out.report);
    expect(body).not.toMatch(/valid JSON|schema validation|Error:/i);
    expect(body).toMatch(/could not complete/i);
    // …and the admin still gets the real reason, in the trace.
    expect((out.trace.warnings ?? []).join(' ')).toMatch(/valid JSON/i);
  });

  it('stops mid-run, having spent about the ceiling and not the whole job', async () => {
    const full = await runResearch({ template, params: params(), jobId: 'b3', generatedAt: 't' });
    const fullCalls = mock.calls;
    expect(full.trace.status).toBe('completed');
    expect(full.trace.budgetExceeded).toBeUndefined(); // the default ceiling is nowhere near

    const capped = installMockProvider();
    writableConfig.workflow.maxJobCostUsd = full.trace.cost.usd / 4;

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
    writableConfig.workflow.maxJobCostUsd = 1000; // deployment says "plenty"
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
    writableConfig.workflow.maxJobCostUsd = 0.001;
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
      // …and the cap is actually a CAP. Reading the same constant the source reads
      // detects its deletion and nothing else: raising it a thousandfold — which is
      // the change that would cost money — passed. A gather turn is a search-loop
      // turn; it does not write the report, so anything near a synthesis-sized
      // budget is a bug whatever the constant says.
      expect(opts.maxOutputTokens, 'a research turn does not need a synthesis budget').toBeLessThanOrEqual(8_192);
      // The same argument, applied to the line above it — which was left reading
      // its own constant, one line under the comment explaining why that proves
      // nothing. On Gemini 2.5 thinking tokens are billed as OUTPUT, so raising
      // this is exactly as expensive as raising the cap next to it, and the suite
      // could not tell a thousandfold change from a correct value.
      expect(opts.thinkingBudget, 'a search-loop turn does not need to deliberate').toBeLessThanOrEqual(4_096);
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

describe('the ceiling an admin is told about is the one that was enforced', () => {
  it('reports the MODEL’s ceiling, not the deployment default', async () => {
    // The Florida-era assumption leaking into a catalog product: `run-job` printed
    // `config.workflow.maxJobCostUsd` whatever the engine actually enforced, so a
    // model declaring `maxCostUsd: 0.002` produced "Passed the per-job ceiling of
    // $20.00" on a job stopped at half a cent — and the admin decides on that line.
    const { runJob } = await import('../src/engine/run-job.js');
    const { createJob, getJob } = await import('../src/jobs/firestore.js');
    const { __registerTemplateForTests, __clearTestTemplates } = await import('../src/templates/registry.js');
    const { compactModel } = await import('./fixtures/compact-model.js');

    __clearTestTemplates();
    // A catalog model with its own, much smaller ceiling.
    __registerTemplateForTests({
      ...compactModel,
      id: 'cheap-model',
      // `essential` is the cheapest mode this model declares, which is what
      // `resolveMode` picks when params name no mode. Spread from the default
      // rather than written as a lone `maxCostUsd`: that shape only compiled
      // because of the `as never` below, and `validateModes` refuses it now — a
      // mode with no `budgetScale` gives every agent a NaN research budget.
      modes: { essential: { ...DEFAULT_MODES.essential!, maxCostUsd: 0.0002 } },
    } as never);
    installMockProvider();
    writableConfig.workflow.maxJobCostUsd = 20;

    await createJob({ jobId: 'ceil1', appId: 'app1', userId: 'b@x.com', templateId: 'cheap-model', params: {}, status: 'queued' } as never);
    await runJob({ jobId: 'ceil1', appId: 'app1', userId: 'b@x.com', template: 'cheap-model', params: {} });

    const job = (await getJob('ceil1'))!;
    // Non-vacuous by construction: the small ceiling really did stop this run.
    expect(job.status).toBe('held');
    // The model's own figure, printed so an admin can reconcile it against the
    // spend beside it. `toContain('0.00')` was the first version and it could not
    // fail: '0.00' is a substring of '20.00', so it matched the very default it was
    // supposed to rule out.
    expect(job.hold?.detail ?? '').toContain('0.0002');
    expect(job.hold?.detail ?? '', 'the deployment default leaked into the admin’s decision line').not.toContain('20.00');
    __clearTestTemplates();
  });
});
