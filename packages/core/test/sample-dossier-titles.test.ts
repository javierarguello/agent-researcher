/**
 * The public sample is titled the way a buyer's own report is.
 *
 * `apps/fbizlab/public/sample-dossier.json` is generated from this template's
 * manifest and committed, so the site can serve one complete report to a visitor
 * with no session. Rename a section here and the public sample keeps the old
 * heading until someone re-runs `npm run sample:build` — this is the line that says
 * so. The other half (the artifact equals the sample it was built from) lives in the
 * app that ships it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { getTemplate, toManifest } from '../src/templates/registry.js';

const HERE = import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]*$/, '');
const DOSSIER = `${HERE}/../../../apps/fbizlab/public/sample-dossier.json`;

describe.skipIf(!existsSync(DOSSIER))('the published sample dossier', () => {
  it('uses this template’s current section titles', () => {
    const dossier = JSON.parse(readFileSync(DOSSIER, 'utf8')) as {
      meta: { template: string; language: string };
      sections: Array<{ key: string; title: string }>;
    };
    const template = getTemplate(dossier.meta.template)!;
    const titles = new Map(toManifest(template, dossier.meta.language).sections.map((s) => [s.key, s.title]));
    // Run `npm run sample:build` if this fails.
    expect(dossier.sections.map((s) => [s.key, s.title])).toEqual(dossier.sections.map((s) => [s.key, titles.get(s.key)]));
  });
});
