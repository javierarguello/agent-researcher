/**
 * The language to answer a request in, when the answer is a message a PERSON reads.
 *
 * One rule, in one place, because there were three: the report route read
 * `params.language`, the email routes read `body.lang ?? Accept-Language`, and
 * every other error read nothing at all and answered in English (round 10's B item
 * — four 429s in hand-written English on the three doors a new buyer walks through
 * first). The order below is "most deliberate first":
 *
 *   1. `body.lang` — the language a client STATED for this call.
 *   2. `query.lang` — the manifest/pricing convention, enum-validated by the schema.
 *   3. `Accept-Language` — what the browser says.
 *
 * `Accept-Language` is last for a reason it is worth writing down: it is the
 * BROWSER's setting, `en` for a Spanish speaker on a US-configured laptop, i.e.
 * exactly the person this exists for. The SPA now sends the language its switcher
 * is on as `Accept-Language` on every call (`apps/fbizlab/src/api/client.ts`), so
 * for that client the fallback is no longer a guess — but it stays a fallback,
 * because a third-party client may send nothing.
 */
import { asLang, type Lang } from '@agent-researcher/core';

export function errorLang(req: {
  body?: unknown;
  query?: unknown;
  headers?: Record<string, unknown>;
}): Lang {
  const body = req.body as { lang?: unknown } | undefined;
  if (typeof body?.lang === 'string' && body.lang) return asLang(body.lang);
  const query = req.query as { lang?: unknown } | undefined;
  if (typeof query?.lang === 'string' && query.lang) return asLang(query.lang);
  return asLang(String(req.headers?.['accept-language'] ?? '').slice(0, 2).toLowerCase());
}
