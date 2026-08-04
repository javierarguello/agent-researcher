/**
 * What a buyer reads when a report comes back incomplete (F1).
 *
 * The finding: a degraded report explained itself with `trace.warnings` rendered
 * verbatim — `Degraded [risks_red_flags] from agent "market-analyst" after
 * exhausting retries…` — in English, to Spanish, French and Portuguese customers,
 * naming our agents and our section keys. And inside the report each missing
 * section said `_Section unavailable: <internal error>._`, in English too.
 *
 * That text is diagnostics. It still exists, unchanged, in the trace and in the
 * admin. What changed is that it is no longer what the customer is handed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/tools/web-search.js', () => import('./fixtures/fake-web.js'));

import { runResearch } from '../src/engine/research-engine.js';
import { sectionsNotice, degradedSectionNote, heldNotice } from '../src/jobs/report-copy.js';
import { getTemplate } from '../src/templates/registry.js';
import { installMockProvider } from './mocks/llm.js';
import type { MockLlmProvider } from './mocks/llm.js';

const template = getTemplate('florida-business-for-sale')!;
const params = (language: string) =>
  template.paramsSchema.parse({ industry: 'x', mode: 'essential', language }) as Record<string, unknown>;

/** Break one agent so its sections degrade, whatever language the run is in. */
function breakOneAgent(mock: MockLlmProvider): void {
  const base = mock.generate.bind(mock);
  mock.generate = async (opts) => {
    if (opts.responseSchema && JSON.stringify(opts.responseSchema).includes('market_overview')) {
      return { text: 'not json', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    }
    return base(opts);
  };
}

/** N sections lost, the shape `sectionsNotice` now takes. */
const lost = (n: number) => Array.from({ length: n }, () => ({ status: 'lost' as const }));
/** …and the other state, which gets its own sentence. */
const shallow = (n: number) => Array.from({ length: n }, () => ({ status: 'unenriched' as const }));

describe('the copy itself', () => {
  it('is written for every supported language, and says nothing internal', () => {
    for (const lang of ['en', 'es', 'fr', 'pt']) {
      for (const text of [degradedSectionNote(lang), sectionsNotice(lang, lost(1)), sectionsNotice(lang, lost(3))]) {
        expect(text.length).toBeGreaterThan(20);
        // The whole point: no agent ids, no section keys, no "degraded".
        expect(text).not.toMatch(/degraded|agent|section key|schema|retries|_id|market-analyst/i);
      }
    }
  });

  it('counts, so one missing section does not read as several', () => {
    expect(sectionsNotice('en', lost(1))).toMatch(/one section/i);
    expect(sectionsNotice('en', lost(3))).toMatch(/^3 sections/);
    expect(sectionsNotice('es', lost(2))).toMatch(/^2 secciones/);
  });

  it('tells a buyer their job is paused without naming our budget', () => {
    for (const lang of ['en', 'es', 'fr', 'pt']) {
      const text = heldNotice(lang);
      expect(text.length).toBeGreaterThan(20);
      // It is rendered raw by the client, so it has to be their language — and
      // "held at the cost ceiling" tells a customer about our budget, which is
      // neither their business nor their problem.
      expect(text).not.toMatch(/ceiling|budget|cost|held|presupuesto|techo/i);
    }
    expect(heldNotice('es')).toMatch(/en pausa/i);
    expect(heldNotice('de')).toBe(heldNotice('en'));
  });

  it('says nothing at all when nothing degraded', () => {
    expect(sectionsNotice('en', lost(0))).toBe('');
  });

  it('falls back to English for a language we do not have', () => {
    expect(degradedSectionNote('de')).toBe(degradedSectionNote('en'));
  });
});

describe('a degraded report, as the buyer receives it', () => {
  let mock: MockLlmProvider;
  beforeEach(() => {
    mock = installMockProvider();
  });

  it('puts our own words in the missing section, in the report’s language', async () => {
    breakOneAgent(mock);
    const out = await runResearch({ template, params: params('es'), jobId: 'd1', generatedAt: 't' });

    expect((out.meta.sections ?? []).map((x) => x.key)).toContain('market_overview');
    const rendered = JSON.stringify(out.report.market_overview);
    expect(rendered).toContain('No pudimos completar esta sección');
    // The old placeholder leaked the agent's error into the document itself.
    expect(rendered).not.toMatch(/Section unavailable|not json|market-analyst|exhausting retries/i);
  });

  it('keeps the diagnostics — in the trace, where the admin reads them', async () => {
    breakOneAgent(mock);
    const out = await runResearch({ template, params: params('es'), jobId: 'd2', generatedAt: 't' });

    // Not softened, not localized, not removed: this is how the failure gets
    // diagnosed, and the fix must not cost us that.
    const warnings = (out.trace.warnings ?? []).join(' ');
    expect(warnings).toMatch(/market-analyst/);
    expect(warnings).toMatch(/market_overview/);
  });
});
