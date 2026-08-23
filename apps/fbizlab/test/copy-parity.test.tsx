/**
 * Every copy table speaks all four languages, key for key.
 *
 * `pick()` falls back to English for a missing key, silently. So a string added to
 * `en` and forgotten in `fr` is not a crash and not a type error —
 * `Record<Lang, …>` is satisfied by the block existing — it is a French buyer
 * reading one English sentence in the middle of a translated page, and nothing says
 * so. Round 10 found the last screen before payment leading its preference list
 * with a key declared in four languages and asserted in none (R10-20); the same
 * shape shipped `la passe` and `a passagem` to two languages twice before that.
 *
 * This is the cheap half of the guard — parity of KEYS across every table in the
 * app. The expensive half (are the words right?) is what the per-screen tests do,
 * and only for the screens that have one. A table here is a table that cannot go
 * half-translated without this file going red.
 */
import { describe, it, expect } from 'vitest';
import { LANGS } from '../src/i18n';
import { T as AppLayout } from '../src/components/AppLayout';
import { T as DownloadPdf } from '../src/components/DownloadPdf';
import { T as ApiAccess } from '../src/pages/ApiAccess';
import { T as Credits } from '../src/pages/Credits';
import { T as JobView } from '../src/pages/JobView';
import { T as Login } from '../src/pages/Login';
import { T as NewReport } from '../src/pages/NewReport';
import { T as ReadReport } from '../src/pages/ReadReport';
import { T as Reports } from '../src/pages/Reports';
import { T as ResetPassword } from '../src/pages/ResetPassword';
import { T as SampleReport } from '../src/pages/SampleReport';
import { T as VerifyEmail } from '../src/pages/VerifyEmail';

/** Every table in the app that is keyed by language. */
const TABLES: Record<string, Record<string, unknown>> = {
  AppLayout, DownloadPdf, ApiAccess, Credits, JobView, Login,
  NewReport, ReadReport, Reports, ResetPassword, SampleReport, VerifyEmail,
};

/**
 * Every leaf path in a copy block — `f.industry`, not `f`. A nested dictionary
 * (field labels, per-status lines) goes half-translated exactly like a flat one.
 */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [prefix];
  return Object.entries(node as Record<string, unknown>)
    .flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

describe('the SPA’s copy tables', () => {
  it('cover every language the switcher offers', () => {
    for (const [name, table] of Object.entries(TABLES)) {
      for (const lang of LANGS) expect(table[lang], `${name}.${lang}`).toBeTruthy();
    }
  });

  it.each(Object.entries(TABLES))('%s carries the same keys in every language', (name, table) => {
    const en = leafKeys(table.en);
    expect(en.length, `${name}.en is empty`).toBeGreaterThan(0);
    for (const lang of LANGS) {
      if (lang === 'en') continue;
      const missing = en.filter((k) => !leafKeys(table[lang]).includes(k));
      const extra = leafKeys(table[lang]).filter((k) => !en.includes(k));
      // Named rather than counted: the message has to say WHICH string a buyer in
      // that language would read in English.
      expect(missing, `${name}.${lang} is missing`).toEqual([]);
      expect(extra, `${name}.${lang} has keys en does not`).toEqual([]);
    }
  });
});
