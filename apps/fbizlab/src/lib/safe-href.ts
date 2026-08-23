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
 * The engine's own evidence tags, as they reach an artifact.
 *
 * `buildDossier` numbers the evidence it hands a writer `[S1]…[S48]` (snippets) and
 * `[P1]…` (fetched pages), and the system prompt tells the model in as many words:
 * "Do not use bare `[S3]`/`[P2]` tags". It emits them anyway, in every real run
 * measured — 84 to 146 per report across the five in `out/`, 122 in the published
 * sample: 77 as the LABEL of a real link (`[S2](https://…)`) and 45 bare in prose.
 *
 * Neither belongs in front of a reader. `S2` is our vocabulary, and the bare ones
 * resolve to nothing at all: the numbering is per-agent, from `rankEvidence`'s
 * ordering of that writer's dossier, while the report's own Sources list is numbered
 * over the whole store — so `[S27]` is not source 27, and following it would be
 * worse than dropping it.
 *
 * A tag with a url behind it keeps the url and shows the host (`linkLabel`); a tag
 * with nothing behind it is removed, with the space before it, so the sentence it
 * interrupted closes up. `[Plumbing & HVAC SEO]` — a real link label from the same
 * report — is not a tag: the digit is required.
 */
const EVIDENCE_TAG_BODY = String.raw`[SP]\d{1,3}(?:\s*,\s*[SP]\d{1,3})*`;
const EVIDENCE_TAG = new RegExp(String.raw`^\[?${EVIDENCE_TAG_BODY}\]?$`);
const BARE_EVIDENCE_TAG = new RegExp(String.raw`[ \t]*\[${EVIDENCE_TAG_BODY}\](?!\()`, 'g');

/** Markdown with the engine's dangling evidence tags removed. Tags that label a link are left to `linkLabel`. */
export function stripEvidenceTags(md: string): string {
  return md.replace(BARE_EVIDENCE_TAG, '');
}

/** The host of an http(s) url, without `www.` — '' when it is not one. */
function hostOf(url: string): string {
  const m = /^https?:\/\/(?:www\.)?([^/?#\s]+)/i.exec(url.trim());
  return m ? m[1]! : '';
}

/**
 * What a prose link SHOWS when its text is the destination all over again.
 *
 * A model citing evidence writes `[https://www.linkedin.com/posts/…-activity-7387468055867449344-bm7P](the same url)`
 * often enough to matter: **36 of the 165** prose links in the 2026-08-22
 * statewide run carry the url as their own label, against **0** in the Tampa run
 * an hour earlier — so this is a coin flip per report, not a rarity. Rendered
 * verbatim it is a 120-character unbreakable token mid-sentence: it pushes the
 * page sideways in the viewer and runs off the column in the PDF.
 *
 * The HOST is the half a reader needs from a citation ("who says so"), and it is
 * the half the page's author does not choose. The full url is not lost: it stays
 * in the `href` and in the Sources list, which is where someone goes to check it.
 *
 * A label that IS a url is shown as its host; so is one of the engine's own
 * evidence tags (`[S2](https://…)`), which is our vocabulary rather than a name for
 * anything the reader can use. Every other label is the author's words and is left
 * exactly as written, however long.
 *
 * Clipped by the same bound as a Sources row for the same reason: `hostname` has
 * no length limit, so a 4,000-character host is the text of a live anchor
 * (round 10, R10-8).
 *
 * Keep identical to its twin in `packages/core/src/pdf/report-html.ts`; the two
 * copies exist because the PDF cannot import from the SPA, not because they may
 * differ.
 */
export function linkLabel(text: string, href = ''): string {
  const clip = (host: string) => {
    const c = Array.from(host);
    return c.length > SOURCE_LABEL_MAX ? `${c.slice(0, SOURCE_LABEL_MAX - 1).join('')}…` : host;
  };
  const ownHost = hostOf(text);
  if (ownHost) return clip(ownHost);
  // `[S2](https://…)`: our tag over their url. The href is the honest label.
  if (EVIDENCE_TAG.test(text.trim())) {
    const linked = hostOf(href);
    if (linked) return clip(linked);
  }
  return text;
}

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
