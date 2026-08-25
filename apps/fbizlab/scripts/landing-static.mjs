/**
 * Build the STATIC landing HTML (per language) for the SEO prerender. It mirrors
 * the React landing's structure + classes so crawlers (and no-JS visitors) get the
 * real H1, section copy and FAQ in the initial HTML. React (createRoot) replaces
 * this on mount — the dynamic bits (Stripe plan cards, auth state) render then.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANDING_COPY } from '../src/content/landing-copy.mjs';

/**
 * The credit packs, per language, read off the catalog this build already baked.
 *
 * `fetch-plans.mjs` writes `dist/plans.json` from the API before the prerender runs
 * (see the `build` script's order), so the real prices are on disk here — no network,
 * no second source of truth.
 *
 * Returns `[]` if the file is missing rather than throwing: the prices are a section
 * of the page, not the page. A landing that renders without its pricing block is a
 * bad landing; a build that dies because one file moved is a worse outcome. The
 * FETCH is where an empty catalog is fatal, and `fetch-plans.mjs` already exits 1
 * on one, in each of the four languages.
 */
export function plansFor(lang) {
  try {
    const all = JSON.parse(readFileSync(join(process.cwd(), 'dist', 'plans.json'), 'utf8'));
    const forLang = all[lang] ?? all.en ?? [];
    return Array.isArray(forLang) ? forLang : (forLang.plans ?? []);
  } catch {
    return [];
  }
}

/**
 * One pricing card, in the SAME markup `PlanCard.tsx` renders.
 *
 * Identical classes on purpose, and it is not cosmetic: this morning
 * `landing-static.mjs` emitted `section.container` where `Landing.tsx` emits
 * `section.hero-shot`, and because the hero photograph is a CSS background on the
 * missing class the browser could not discover the image until React mounted. Two
 * files describing the same markup drift, and the one nobody looks at is this one.
 */
function planCard(p, lang, c) {
  const price = Number(p.priceUsd).toLocaleString(lang);
  const features = (p.features ?? []).map((f) => `<div class="bullet">${esc(f)}</div>`).join('');
  return `<div class="card plan ${p.popular ? 'dark' : ''}">
      <div class="between">
        <div><div style="font-weight:700;font-size:17px">${esc(p.name)}</div>${p.sub ? `<div class="mono muted" style="font-size:11px">${esc(p.sub)}</div>` : ''}</div>
        ${p.popular ? `<span class="tag-popular">${esc(c.pricing.popular)}</span>` : ''}
      </div>
      <div class="price">$${esc(price)}</div>
      ${p.credits > 0 ? `<div class="metric" style="margin-top:14px"><div class="num">${p.credits}</div><div class="lbl">${esc(c.pricing.creditsWord)}</div></div>` : ''}
      ${features ? `<hr class="divider" style="margin:18px 0" /><div class="stack" style="gap:9px;flex:1">${features}</div>` : ''}
      <button class="btn btn--block ${p.popular ? 'btn--accent' : 'btn--black'}" style="margin-top:22px">${esc(c.pricing.choose)}</button>
    </div>`;
}

const BRAND = 'Florida Biz Labs';
const pad = (i) => String(i + 1).padStart(2, '0');
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const logo = '<img class="brand-mark" src="/icons/favicon.svg" alt="" width="26" height="26" />';

/**
 * `plans` is injectable so this can be tested without a build. It defaults to the
 * baked catalog, which is what the real prerender uses — the parameter exists for
 * the test, and the default is what production takes.
 */
export function renderLandingStatic(lang, plans = plansFor(lang)) {
  const c = LANDING_COPY[lang] ?? LANDING_COPY.en;

  /**
   * The language switcher, as real anchors, in the SERVED html.
   *
   * `/es`, `/fr` and `/pt` are fully prerendered pages with their own localized
   * title, description and FAQ JSON-LD — and nothing linked to them. The React
   * switcher was `<button>`, this static header had no switcher at all, the sitemap
   * named a dead host and so did every hreflang. Three orphan translations: no
   * crawlable path in, from anywhere. React replaces this markup on mount, so these
   * anchors exist for exactly one audience, which is the one that matters here.
   */
  const langLinks = (cur) =>
    `<div class="langseg" role="group" aria-label="Language">${['en', 'es', 'fr', 'pt']
      .map((l) => `<a href="${l === 'en' ? '/' : `/${l}`}"${l === cur ? ' class="on" aria-current="true"' : ''}>${l.toUpperCase()}</a>`)
      .join('')}</div>`;

  const header = `<header class="hdr"><div class="container">
    <div class="brand">${logo}${esc(BRAND)}</div>
    <nav class="nav"><a href="/login">${esc(c.nav.search)}</a><a href="#benefits">${esc(c.nav.insights)}</a><a href="#pricing">${esc(c.nav.pricing)}</a></nav>
    <div class="row" style="gap:12px">${langLinks(lang)}<a class="btn btn--black btn--sm" href="/login">${esc(c.nav.login)}</a></div>
  </div></header>`;

  const sampleRows = c.sample.rows.map(([k, v]) => `<div class="sample__row"><span class="mono">${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  const sampleMiss = c.sample.missing.map((m) => `<div class="sample__miss"><i></i>${esc(m)}</div>`).join('');
  const sampleQ = c.sample.questions.map((q, i) => `<div class="sample__q"><span class="mono">${pad(i)}</span>${esc(q)}</div>`).join('');
  const sample = `<div class="sample">
    <div class="sample__top"><span class="mono sample__label">${esc(c.sample.label)}</span><span class="mono sample__id">${esc(c.sample.id)}</span></div>
    <div class="sample__rows">${sampleRows}</div>
    <div class="sample__block"><div class="mono sample__blabel">${esc(c.sample.missingL)}</div>${sampleMiss}</div>
    <div class="sample__block"><div class="mono sample__blabel">${esc(c.sample.questionsL)}</div>${sampleQ}</div>
  </div>`;

  // `hero-shot > container > hero`, matching `Landing.tsx` exactly.
  //
  // It used to be `section.container` here and `section.hero-shot > div.container`
  // there, and the drift had a measurable cost: the hero photograph is a CSS
  // background on `.hero-shot`, so with that class absent from the served HTML the
  // browser could not discover the image AT ANY PRICE until React mounted. Measured
  // on throttled mobile: fetch starts at 2780 ms, paints at 5218 ms, and no
  // `<link rel=preload>` could have helped because the selector that needs it did
  // not exist yet. Two files describing the same markup will drift; this one is the
  // one nobody looks at.
  const hero = `<section class="hero-shot" id="top"><div class="container"><div class="hero">
    <div class="stack" style="gap:20px">
      <div class="eyebrow">${esc(c.hero.kicker)}</div>
      <h1 class="h-xl">${esc(c.hero.title)}</h1>
      <p class="lead">${esc(c.hero.lead)}</p>
      <div class="row" style="gap:12px;margin-top:4px;flex-wrap:wrap"><a class="btn btn--black" href="/login">${esc(c.hero.cta1)}</a><a class="btn btn--outline" href="/sample">${esc(c.hero.cta2)}</a></div>
      <p class="fineprint">${esc(c.hero.disclaimer)}</p>
      <div class="mono muted" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;line-height:1.8">${esc(c.hero.tagline)}</div>
    </div>
    <div>${sample}</div>
  </div></div></section>`;

  const wwd = `<section class="section section--alt"><div class="container split">
    <div class="stack" style="gap:14px"><span class="eyebrow">${esc(c.wwd.kicker)}</span><h2 class="h-lg" style="max-width:420px">${esc(c.wwd.title)}</h2></div>
    <p class="lead" style="max-width:520px">${esc(c.wwd.body)}</p>
  </div></section>`;

  const benefits = `<section id="benefits" class="section"><div class="container">
    <div class="stack" style="gap:14px;margin-bottom:44px"><span class="eyebrow">${esc(c.benefits.kicker)}</span><h2 class="h-lg" style="max-width:460px">${esc(c.benefits.title)}</h2></div>
    <div class="bgrid">${c.benefits.items.map(([t, d], i) => `<div class="bcell"><div class="mono bcell__n">${pad(i)}</div><h4>${esc(t)}</h4><p>${esc(d)}</p></div>`).join('')}</div>
  </div></section>`;

  const hiw = `<section class="section section--alt"><div class="container">
    <div class="stack" style="gap:14px;margin-bottom:44px"><span class="eyebrow">${esc(c.hiw.kicker)}</span><h2 class="h-lg" style="max-width:480px">${esc(c.hiw.title)}</h2></div>
    <div class="hiw">${c.hiw.steps.map(([t, d], i) => `<div class="hcard"><div class="mono hcard__n">${pad(i)}</div><h4>${esc(t)}</h4><p>${esc(d)}</p></div>`).join('')}</div>
  </div></section>`;

  const insum = `<section id="inside" class="section"><div class="container split">
    <div class="stack" style="gap:16px;max-width:360px"><span class="eyebrow">${esc(c.insum.kicker)}</span><h2 class="h-lg">${esc(c.insum.title)}</h2><p class="soft" style="font-size:14.5px;line-height:1.6">${esc(c.insum.body)}</p><a class="btn btn--black" style="align-self:flex-start" href="/sample">${esc(c.insum.cta)}</a><p class="fineprint">${esc(c.insum.disclaimer)}</p></div>
    <div class="sumlist">${c.insum.items.map((it, i) => `<div class="sumitem"><span class="mono">${pad(i)}</span>${esc(it)}</div>`).join('')}</div>
  </div></section>`;

  // The prices themselves, in the served HTML.
  //
  // They used to be fetched by the client from `/plans.json`, so `grep '$29'` on what
  // the server sends returned ZERO — the pricing section existed as a heading with
  // nothing under it. That cost two things: a crawler that does not run JS saw a
  // pricing page with no prices, and `Product`/`Offer` structured data could not
  // honestly be added, because Google requires marked-up data to be visible on the
  // page and marking up invisible prices is what earns a manual action.
  const pricing = `<section id="pricing" class="section"><div class="container">
    <div class="split" style="margin-bottom:44px;align-items:end"><div class="stack" style="gap:14px"><span class="eyebrow">${esc(c.pricing.kicker)}</span><h2 class="h-lg" style="max-width:420px">${esc(c.pricing.title)}</h2></div><p class="lead">${esc(c.pricing.lead)}</p></div>
    ${plans.length === 0
      ? `<p class="soft mono" style="font-size:13px">${esc(c.pricing.noPlans)}</p>`
      : `<div class="plans">${plans.map((p) => planCard(p, lang, c)).join('')}</div>`}
  </div></section>`;

  const usage = `<section class="section section--dark"><div class="container split">
    <div class="stack" style="gap:14px"><span class="eyebrow" style="color:var(--accent)">${esc(c.usage.kicker)}</span><h2 class="h-lg" style="color:var(--on-dark);max-width:360px">${esc(c.usage.title)}</h2></div>
    <div class="stack" style="gap:18px;max-width:520px"><p style="color:var(--on-dark);font-size:17px;line-height:1.55">${esc(c.usage.body1)}</p><p style="color:#a8a49b;font-size:14px;line-height:1.7">${esc(c.usage.body2)}</p></div>
  </div></section>`;

  const faq = `<section class="section section--alt"><div class="container split faq-split">
    <div class="stack" style="gap:14px"><span class="eyebrow">${esc(c.faq.kicker)}</span><h2 class="h-lg">${esc(c.faq.title)}</h2></div>
    <div class="faq">${c.faq.items.map(([q, a]) => `<div class="faqitem open"><div class="faqq">${esc(q)}</div><p class="faqa">${esc(a)}</p></div>`).join('')}</div>
  </div></section>`;

  const cta = `<section class="section"><div class="container split gs-split">
    <div class="stack" style="gap:16px"><span class="eyebrow">${esc(c.cta.kicker)}</span><h2 class="h-xl" style="max-width:560px">${esc(c.cta.title)}</h2><p class="lead">${esc(c.cta.body)}</p></div>
    <div class="stack" style="gap:16px;max-width:320px"><a class="btn btn--accent btn--block" href="/login">${esc(c.cta.btn)} →</a><p class="fineprint">${esc(c.cta.disclaimer)}</p></div>
  </div></section>`;

  const footer = `<footer class="foot"><div class="container"><div class="cols">
    <div><div class="brand" style="margin-bottom:14px">${logo}${esc(BRAND)}</div><p class="disclaimer">${esc(c.foot.disclaimer)}</p></div>
    <div class="col"><h5>${esc(c.foot.productL)}</h5><a href="/login">${esc(c.foot.product[0])}</a><a href="#inside">${esc(c.foot.product[1])}</a><a href="/api-access">${esc(c.foot.product[2])}</a></div>
    <div class="col"><h5>${esc(c.foot.companyL)}</h5>${['/privacy', '/legal', '/support'].map((href, i) => `<a href="${href}">${esc(c.foot.company[i])}</a>`).join('')}</div>
  </div></div></footer>`;

  return `<div>${header}${hero}${wwd}${benefits}${hiw}${insum}${pricing}${usage}${faq}${cta}${footer}</div>`;
}
