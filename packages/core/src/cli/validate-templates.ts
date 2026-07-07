/**
 * Template validation + workflow inspection. Run in CI and locally:
 *   npm run templates:check
 *
 * Loading the registry already asserts every template is well-formed; this also
 * prints each template's sections and execution waves so a new agent/section
 * change is easy to eyeball. Exits non-zero if anything is invalid.
 */
import { listTemplates, planWaves, reportSchemaOf } from '../index.js';
import { validateTemplate } from '../templates/validate.js';
import { z } from 'zod';

let failed = false;
for (const t of listTemplates()) {
  const errors = validateTemplate(t);
  console.log(`\n=== ${t.id}@${t.version} — ${t.name} ===`);
  console.log(`sections (${t.sections.length}): ${t.sections.map((s) => s.key).join(', ')}`);
  console.log(`agents (${t.agents.length}):`);
  for (const a of t.agents) {
    const owns = [...(a.produces ?? []), ...(a.enriches ?? []).map((k) => `${k}*`)].join(', ');
    console.log(`  - ${a.id} [${a.role}] -> ${owns}${a.dependsOn ? `  (deps: ${a.dependsOn.join(', ')})` : ''}`);
  }
  console.log('waves:');
  planWaves(t).forEach((w, i) => console.log(`  ${i + 1}. ${w.join(' | ')}`));
  // Sanity: the report schema must serialize to JSON Schema without throwing.
  z.toJSONSchema(reportSchemaOf(t));
  if (errors.length) {
    failed = true;
    console.error(`  ERRORS:\n   - ${errors.join('\n   - ')}`);
  } else {
    console.log('  ✓ valid');
  }
}

if (failed) {
  console.error('\nTemplate validation FAILED.');
  process.exit(1);
}
console.log('\nAll templates valid.');
