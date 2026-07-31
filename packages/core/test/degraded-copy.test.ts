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
import { degradedNotice, degradedSectionNote } from '../src/jobs/report-copy.js';
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

describe('the copy itself', () => {
  it('is written for every supported language, and says nothing internal', () => {
    for (const lang of ['en', 'es', 'fr', 'pt']) {
      for (const text of [degradedSectionNote(lang), degradedNotice(lang, 1), degradedNotice(lang, 3)]) {
        expect(text.length).toBeGreaterThan(20);
        // The whole point: no agent ids, no section keys, no "degraded".
        expect(text).not.toMatch(/degraded|agent|section key|schema|retries|_id|market-analyst/i);
      }
    }
  });

  it('counts, so one missing section does not read as several', () => {
    expect(degradedNotice('en', 1)).toMatch(/one section/i);
    expect(degradedNotice('en', 3)).toMatch(/^3 sections/);
    expect(degradedNotice('es', 2)).toMatch(/^2 secciones/);
  });

  it('says nothing at all when nothing degraded', () => {
    expect(degradedNotice('en', 0)).toBe('');
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

    expect(out.meta.degradedSections).toContain('market_overview');
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
