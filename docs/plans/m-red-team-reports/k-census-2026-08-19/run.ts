import { preScreen, collectFreeText } from '../../../../packages/core/src/moderation/moderate.js';
import { ATTACKS, type Case } from './corpus-attack.js';
import { LEGIT } from './corpus-legit.js';

const LIMITS: Record<Case['field'], number> = { industry: 120, location: 200, freeText: 2000 };

function screen(c: Case): string | null {
  const value = c.s.slice(0, LIMITS[c.field]);
  return preScreen(collectFreeText({ [c.field]: value }));
}

function report(name: string, cases: Case[], hitIsGood: boolean) {
  const byCat = new Map<string, { n: number; bad: number }>();
  const bad: Case[] = [];
  for (const c of cases) {
    const hit = screen(c) !== null;
    const isBad = hitIsGood ? !hit : hit;
    const e = byCat.get(c.cat) ?? { n: 0, bad: 0 };
    e.n++; if (isBad) e.bad++;
    byCat.set(c.cat, e);
    if (isBad) bad.push(c);
  }
  console.log(`\n=== ${name}: ${bad.length} / ${cases.length} ${hitIsGood ? 'MISSED' : 'FALSE POSITIVES'} ===`);
  for (const [cat, e] of byCat) console.log(`  ${cat.padEnd(18)} ${String(e.bad).padStart(3)}/${String(e.n).padEnd(3)}`);
  console.log('');
  for (const c of bad) console.log(`  [${c.cat}/${c.field}] ${JSON.stringify(c.s).slice(0, 130)}`);
}

report('ATTACKS', ATTACKS, true);
report('LEGIT', LEGIT, false);
