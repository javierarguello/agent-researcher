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
  // The fallback is clipped too. A url that `new URL()` parses but whose hostname is
  // empty — `javascript:void("AAAA…")` — with no label put the WHOLE string on the
  // page as the row's text, 4,020 characters of it, while the tooltip beside it was
  // bounded at 320 (round 9, R9-22). `safeHref` refuses the scheme so it is a span
  // and not a link, but the text is on screen either way.
  if (!clipped) return host || cut(s.url);
  return host && clipped.toLowerCase() !== host ? `${host} — ${clipped}` : clipped;
}
