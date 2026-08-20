/**
 * What a report may link to, and what a Sources row says.
 *
 * `safeHref` mirrors the PDF renderer's rule: `http(s)` and `mailto:` are links;
 * anything else — the `javascript:`/`data:` a model can be talked into writing as
 * a `sourceUrl` — is rendered as text. Prose links inside Markdown were already
 * held to this by react-markdown's default `urlTransform`; the three raw `href`s
 * (deal card, community mention, Sources) were not, and React 18 only warns.
 * `tel:` is allowed in prose too — a broker's number is a legitimate link, and
 * react-markdown's default set turned it into `href=""`, a dead link styled as
 * a live one.
 */
export function safeHref(url: unknown): string | null {
  return typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

/**
 * react-markdown `urlTransform`: keep http(s), mailto and tel — nothing else.
 *
 * The `/^[^:]*$/` that used to sit here passed anything with no scheme, which is
 * every RELATIVE and PROTOCOL-RELATIVE url: `[the official listing](//attacker/p)`
 * written by a prompt-injected model was a live `target="_blank"` anchor to another
 * origin in the buyer's viewer, the shared read link and the admin's view-in-app —
 * the same three surfaces the image-beacon fix enumerated, whose own reasoning
 * ("react-markdown's default lets protocol-relative and same-origin srcs through,
 * which is why the fix is at the ELEMENT") had been applied to `img` and not to `a`
 * (round 7, R7-21). A report never links to a relative path honestly: every source
 * it cites is somewhere else.
 */
export function proseUrl(url: string): string {
  return /^(https?:\/\/|mailto:|tel:)/i.test(url.trim()) ? url : '';
}

/**
 * How much of a source's name a row shows before it is cut.
 *
 * Measured over the 373 source rows of the two real July runs: p90 90 code
 * points, max 167 — one row over the cap, an `Fla. Admin. Code` title whose
 * identifying half survives the cut. The comment used to say "real listing
 * titles: ≤130", which was true of one run and not of the other (round 7,
 * R7-24). The cap is right; the evidence quoted for it was half the evidence.
 */
export const SOURCE_LABEL_MAX = 160;

/**
 * The HOST, then the page's own title, clipped. The title is whatever the page's
 * author put in `<title>`; the host is the one thing about a source its author
 * does not choose.
 */
export function sourceLabel(s: { url: string; label?: string }): string {
  const label = (s.label ?? '').trim();
  let host = '';
  try {
    host = new URL(s.url).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  const cut = (x: string) => {
    const c = Array.from(x);
    return c.length > SOURCE_LABEL_MAX ? `${c.slice(0, SOURCE_LABEL_MAX - 1).join('')}…` : x;
  };
  const clipped = cut(label);
  // Every branch is clipped, which took two rounds to be true. R9-22 fixed the url
  // fallback (an empty-host `javascript:` url printed 4,020 characters beside a
  // tooltip bounded at 320) and claimed it was "the one path that returned an
  // unbounded string". `host` is the value on BOTH remaining returns and
  // `new URL().hostname` has no length limit, so a `https://` source with a
  // 4,000-character hostname printed 4,006 — as a LIVE anchor here, because
  // `safeHref` accepts the scheme (round 10, R10-8). Keep this file and
  // `packages/core/src/pdf/report-html.ts` identical; the two copies exist because
  // the PDF cannot import from the SPA, not because they may differ.
  //
  // The dedupe still compares the WHOLE host: a label that equals a clipped host is
  // not the same question.
  const shortHost = cut(host);
  if (!clipped) return shortHost || cut(s.url);
  return host && clipped.toLowerCase() !== host ? `${shortHost} — ${clipped}` : clipped;
}
