/**
 * Local smoke test for the research engine — no GCP writes.
 *
 * Usage:
 *   npm run research:local -- --template florida-business-for-sale \
 *     --params '{"industry":"laundromats","location":"Miami-Dade County, FL","askingPriceMax":500000,"targetCount":3}'
 *
 * Requires ADC for Vertex: `gcloud auth application-default login`.
 * Writes the report to ./out/{jobId}/report.md.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getTemplate } from '../templates/registry.js';
import { runResearch } from '../engine/research-engine.js';

function arg(name: string, fallback = ''): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? String(process.argv[idx + 1]) : fallback;
}

async function main() {
  const templateId = arg('template', 'florida-business-for-sale');
  const rawParams = arg('params', '{}');

  const template = getTemplate(templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);

  const parsed = template.paramsSchema.safeParse(JSON.parse(rawParams));
  if (!parsed.success) {
    console.error('Invalid params:', parsed.error.issues);
    process.exit(1);
  }

  const jobId = `local-${randomUUID().slice(0, 8)}`;
  console.error(`Running template "${templateId}" as job ${jobId}...`);

  const out = await runResearch({
    template,
    params: parsed.data as Record<string, unknown>,
    jobId,
    generatedAt: new Date().toISOString(),
    onProgress: (p) => console.error(`[${p.phase}] ${p.message} (turns ${p.turnsUsed}, sources ${p.sourcesFound})`),
  });

  const dir = `out/${jobId}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/report.json`, JSON.stringify({ meta: out.meta, report: out.report }, null, 2), 'utf8');
  await writeFile(`${dir}/sources.json`, JSON.stringify(out.sources, null, 2), 'utf8');
  await writeFile(`${dir}/trace.json`, JSON.stringify(out.trace, null, 2), 'utf8');
  const c = out.meta.cost;
  console.error(
    `\nDone [lang=${out.language}, mode=${out.meta.mode}, schema=${out.meta.schemaVersion}]. Report: ${dir}/report.json  ` +
      `(${out.sources.length} sources, ${out.turnsUsed} searches` +
      `${out.meta.degradedSections ? `, degraded: ${out.meta.degradedSections.join(', ')}` : ''})\n` +
      `Cost: $${c.usd.toFixed(4)} (llm $${c.llmUsd.toFixed(4)} + search $${c.searchUsd.toFixed(4)}; ` +
      `${c.inputTokens.toLocaleString()} in / ${c.outputTokens.toLocaleString()} out tokens)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
