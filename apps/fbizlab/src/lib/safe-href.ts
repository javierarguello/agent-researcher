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

/** react-markdown `urlTransform`: keep http(s), mailto and tel; anything else becomes no href. */
export function proseUrl(url: string): string {
  return /^(https?:\/\/|mailto:|tel:)/i.test(url) || /^[^:]*$/.test(url) ? url : '';
}

/** How much of a source's name a row shows before it is cut. Real listing titles: ≤130. */
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
  const chars = Array.from(label);
  const clipped = chars.length > SOURCE_LABEL_MAX ? `${chars.slice(0, SOURCE_LABEL_MAX - 1).join('')}…` : label;
  if (!clipped) return host || s.url;
  return host && clipped.toLowerCase() !== host ? `${host} — ${clipped}` : clipped;
}
