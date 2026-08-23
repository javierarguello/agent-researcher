/**
 * An enricher that INVENTS an item — the mirror of M-A1's shrink note.
 *
 * A rewrite replaces its section, and M-A1 taught the engine to say so when one
 * comes back shorter. Longer went unrecorded, and it is not the same kind of
 * event: a comprehensive run on 2026-08-22 (`out/local-4ed81938`) had
 * `deep-dive-refiner` return a SEVENTH listing profile for a business
 * `deal-scout` never shortlisted. Every other agent — shortlist, projections,
 * charts, recommendations, executive summary — had already written against the
 * producer's six, so the buyer's dossier carried a full page about a business it
 * mentioned nowhere else, with no row, no price in the range, and no place in the
 * recommendation.
 *
 * A section that declares `itemKeys` says its SET belongs to its producer.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runResearch } from '../src/engine/research-engine.js';
import { redTeamModel } from './fixtures/red-team-model.js';
import { MockLlmProvider } from './mocks/llm.js';
import type { GenerateOptions, GenerateResult } from '../src/llm/provider.js';
import type { ResearchTemplate } from '../src/templates/types.js';

const THREE = [
  { business: 'Sunshine Coin Laundry', askingPrice: 450000, sourceUrl: 'https://example-marketplace.test/listing/sunshine-coin-laundry' },
  { business: 'Bayside Wash Center', askingPrice: 280000, sourceUrl: 'https://example-marketplace.test/listing/bayside-wash-center' },
  { business: 'Palmetto Laundry Express', askingPrice: 1150000, sourceUrl: 'https://example-marketplace.test/listing/palmetto-laundry-express' },
];
/** The refiner's own find: a real listing, honestly researched, that nobody else in the report knows about. */
const INVENTED = { business: 'Hialeah Express Wash', askingPrice: 214900, sourceUrl: 'https://example-marketplace.test/listing/hialeah-express-wash' };

const produced = (listings: unknown[]) => ({
  findings: { overview: 'Three laundromats in Miami-Dade.', listings, risks: ['Lease expires 2027.'] },
});

/** The shared fixture, with the producer's set declared as its producer's. */
const model: ResearchTemplate<Record<string, unknown>> = {
  ...redTeamModel,
  sections: redTeamModel.sections.map((s) => (s.key === 'findings' ? { ...s, itemKeys: ['business', 'sourceUrl'] } : s)),
};

/** A producer that writes `THREE`, and an enricher that writes whatever the test says. */
function twoAgents(enriched: unknown[], producedSet: unknown[] = THREE) {
  class Pair extends MockLlmProvider {
    override async generate(opts: GenerateOptions): Promise<GenerateResult> {
      const r = await super.generate(opts);
      if (!opts.responseSchema) return r;
      const text = opts.messages.map((m) => m.text ?? '').join('\n');
      if (text.startsWith('Write your assigned report sections')) {
        return { ...r, text: JSON.stringify({ ...produced(producedSet), _handoff: 'Listings found.' }) };
      }
      if (text.startsWith('Improve and enrich the sections below')) {
        return { ...r, text: JSON.stringify({ ...produced(enriched), _handoff: 'Refined.' }) };
      }
      return r;
    }
  }
  return new Pair();
}

async function run(template: ResearchTemplate<Record<string, unknown>>, enriched: unknown[], jobId: string, producedSet: unknown[] = THREE) {
  const mock = twoAgents(enriched, producedSet);
  for (const name of ['gemini-vertex', 'ollama']) (await import('../src/llm/models.js')).__setProviderForTests(name, mock);
  return runResearch({
    template,
    params: template.paramsSchema.parse({}) as Record<string, unknown>,
    jobId,
    generatedAt: '2026-08-22T00:00:00.000Z',
  });
}

const listingsOf = (out: { report: Record<string, unknown> }) => (out.report.findings as { listings: Array<{ business: string }> }).listings;

afterEach(async () => {
  for (const name of ['gemini-vertex', 'ollama']) (await import('../src/llm/models.js')).__setProviderForTests(name, undefined as never);
});

describe('a section whose set belongs to its producer', () => {
  it('does not deliver the listing the enricher added on its own', async () => {
    const out = await run(model, [...THREE, INVENTED], 'enricher-adds-1');

    expect(out.trace.status).toBe('completed');
    // The producer's three, whole — the deepening is kept, the invention is not.
    expect(listingsOf(out).map((l) => l.business)).toEqual(THREE.map((l) => l.business));
    // Not merely absent from the array: absent from the dossier. This is the assertion
    // the real defect would have failed — a page about a business named nowhere else.
    expect(JSON.stringify(out.report)).not.toContain('Hialeah Express Wash');
  });

  it('says so where an admin reads, and keeps the analyst’s own write recoverable', async () => {
    const out = await run(model, [...THREE, INVENTED], 'enricher-adds-2');

    // A warning, not a degraded section: the buyer's report is whole, and this is
    // news about an agent. Mutation that reds this: push to `at.notes` only.
    const warning = (out.trace.warnings ?? []).find((w) => w.includes('match nothing it listed'));
    expect(warning).toMatch(/Agent "refiner" rewrite of "findings.listings" came back 4 where the producer listed 3, and 1 of the extra item\(s\) match nothing it listed \("hialeah express wash"\)/);
    expect(warning).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z Agent/);
    expect(out.meta.sections ?? []).toEqual([]);
    // The research is not destroyed, only unmerged: the refiner's full write is in
    // its trace, which is where an admin who disagrees with the drop goes.
    expect(JSON.stringify(out.trace.agents.find((a) => a.id === 'refiner')!.output)).toContain('Hialeah Express Wash');
  });

  it('keeps a profile the enricher retitled while deepening it', async () => {
    // The false positive that would cost a buyer a page they paid for. The refiner
    // re-opened the same listing url and rewrote the title; that is one item, not two.
    const retitled = [{ ...THREE[0], business: 'Sunshine Coin Laundry — Miami Springs (absentee)' }, THREE[1], THREE[2]];
    const out = await run(model, retitled, 'enricher-adds-3');

    expect(listingsOf(out).map((l) => l.business)).toEqual(retitled.map((l) => l!.business));
    expect(out.trace.warnings ?? []).toEqual([]);
  });

  it('keeps a profile whose title AND url both moved, when the set did not grow', async () => {
    // The false positive that a real run produced (`out/local-52835003`, 2026-08-23):
    // the refiner returned the same six listings, and for one of them it rewrote the
    // title AND re-sourced the url to another path on the same marketplace. Under the
    // first version of this guard — every unmatched item dropped — that profile was
    // deleted, and a business the shortlist DOES carry lost its page. Six back from
    // six has no surplus slot, so nothing is a candidate for dropping.
    const rewritten = [
      { business: 'Sunshine Coin Laundry — Miami Springs (absentee)', askingPrice: 450000, sourceUrl: 'https://example-marketplace.test/miami-springs/listing/sunshine-coin-laundry-2' },
      THREE[1],
      THREE[2],
    ];
    const out = await run(model, rewritten, 'enricher-adds-7-retitled-and-resourced');

    expect(listingsOf(out).length).toBe(3);
    expect(listingsOf(out)[0]!.business).toBe('Sunshine Coin Laundry — Miami Springs (absentee)');
    expect(out.trace.warnings ?? []).toEqual([]);
  });

  it('when a rewrite and an invention are both unmatched, the surplus slot takes the invention', async () => {
    // Four back from three: one slot. Two items match nothing — the first listing,
    // retitled and re-sourced by the refiner, and a listing it found on its own and
    // appended. Taking the earlier one would delete the rewrite and DELIVER the
    // invention, which is both halves of this guard backwards.
    const mixed = [
      { business: 'Sunshine Coin Laundry — Miami Springs (absentee)', askingPrice: 450000, sourceUrl: 'https://example-marketplace.test/miami-springs/listing/sunshine-coin-laundry-2' },
      THREE[1],
      THREE[2],
      INVENTED,
    ];
    const out = await run(model, mixed, 'enricher-adds-8-rewrite-and-invention');

    expect(listingsOf(out).map((l) => l.business)).toEqual([
      'Sunshine Coin Laundry — Miami Springs (absentee)',
      THREE[1]!.business,
      THREE[2]!.business,
    ]);
    expect(JSON.stringify(out.report)).not.toContain('Hialeah Express Wash');
  });

  it('keeps everything when there was no producer version to belong to', async () => {
    // The `reconstructed` path: the producer's write failed every attempt, so the
    // enricher wrote the section from nothing on the finalize pass and every item in
    // it is new BY DEFINITION. A guard that fired here would deliver an empty
    // findings section instead of a rebuilt one — the failure mode that matters most,
    // because it costs the buyer the whole section rather than one item.
    class RefinerOnly extends MockLlmProvider {
      override async generate(opts: GenerateOptions): Promise<GenerateResult> {
        const r = await super.generate(opts);
        if (!opts.responseSchema) return r;
        // By OBJECTIVE, not by prompt opener: an enricher with no producer version to
        // improve is handed the PRODUCER prompt ("Write your assigned report
        // sections"), so the two agents are indistinguishable by their first line —
        // which is itself the shape of this path, and the reason the guard keys on
        // `report[key]` rather than on which prompt was built.
        const text = opts.messages.map((m) => m.text ?? '').join('\n');
        if (text.includes(redTeamModel.agents[0]!.objective)) return { ...r, text: 'not json' };
        if (text.includes(redTeamModel.agents[1]!.objective)) {
          return { ...r, text: JSON.stringify({ ...produced([...THREE, INVENTED]), _handoff: 'Rebuilt.' }) };
        }
        return r;
      }
    }
    const mock = new RefinerOnly();
    for (const name of ['gemini-vertex', 'ollama']) (await import('../src/llm/models.js')).__setProviderForTests(name, mock);
    const out = await runResearch({
      template: model,
      params: model.paramsSchema.parse({}) as Record<string, unknown>,
      jobId: 'enricher-adds-5',
      generatedAt: '2026-08-22T00:00:00.000Z',
    });

    expect(listingsOf(out).length).toBe(4);
    expect((out.trace.warnings ?? []).some((w) => w.includes('match nothing it listed'))).toBe(false);
  });

  it('treats a producer that found NOTHING as a set of nothing, and says so', async () => {
    // The niche with no listings: `deal-scout` delivers an empty set, and a refiner
    // that then produces profiles is producing them for businesses no shortlist row,
    // projection or recommendation will ever mention — the defect in its purest form.
    // An empty delivered array is a delivery, not an absence, and this is the branch
    // where that distinction has teeth. The warning is what keeps it from being a
    // silent emptying.
    const out = await run(model, [...THREE], 'enricher-adds-6-empty-producer', []);

    expect(listingsOf(out).length).toBe(0);
    expect((out.trace.warnings ?? []).some((w) => w.includes('came back 3 where the producer listed 0, and 3 of the extra'))).toBe(true);
  });

  it('leaves a section that declares no identity alone — the refiner of `charts` is allowed to add one', async () => {
    // Opt-in, and the opt-out is the default. The same run against the fixture as
    // shipped (no `itemKeys`) delivers the addition, which is what makes the pass
    // above a property of the declaration and not of the engine.
    const out = await run(redTeamModel, [...THREE, INVENTED], 'enricher-adds-4');

    expect(listingsOf(out).map((l) => l.business)).toContain('Hialeah Express Wash');
    expect(out.trace.warnings ?? []).toEqual([]);
  });
});
