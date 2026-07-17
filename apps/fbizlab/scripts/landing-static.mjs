/**
 * Build the STATIC landing HTML (per language) for the SEO prerender. It mirrors
 * the React landing's structure + classes so crawlers (and no-JS visitors) get the
 * real H1, section copy and FAQ in the initial HTML. React (createRoot) replaces
 * this on mount — the dynamic bits (Stripe plan cards, auth state) render then.
 */
import { LANDING_COPY } from '../src/content/landing-copy.mjs';

const BRAND = 'Florida Biz Labs';
const pad = (i) => String(i + 1).padStart(2, '0');
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const logo = '<img class="brand-mark" src="/icons/favicon.svg" alt="" width="26" height="26" />';

export function renderLandingStatic(lang) {
  const c = LANDING_COPY[lang] ?? LANDING_COPY.en;

  const header = `<header class="hdr"><div class="container">
    <div class="brand">${logo}${esc(BRAND)}</div>
    <nav class="nav"><a href="/login">${esc(c.nav.search)}</a><a href="#benefits">${esc(c.nav.insights)}</a><a href="#pricing">${esc(c.nav.pricing)}</a></nav>
    <div class="row" style="gap:12px"><a class="btn btn--black btn--sm" href="/login">${esc(c.nav.login)}</a></div>
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

  const hero = `<section class="container" id="top"><div class="hero">
    <div class="stack" style="gap:20px">
      <div class="eyebrow">${esc(c.hero.kicker)}</div>
      <h1 class="h-xl">${esc(c.hero.title)}</h1>
      <p class="lead">${esc(c.hero.lead)}</p>
      <div class="row" style="gap:12px;margin-top:4px;flex-wrap:wrap"><a class="btn btn--black" href="/login">${esc(c.hero.cta1)}</a><a class="btn btn--outline" href="#inside">${esc(c.hero.cta2)}</a></div>
      <p class="fineprint">${esc(c.hero.disclaimer)}</p>
      <div class="mono muted" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;line-height:1.8">${esc(c.hero.tagline)}</div>
    </div>
    <div>${sample}</div>
  </div></section>`;

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
    <div class="stack" style="gap:16px;max-width:360px"><span class="eyebrow">${esc(c.insum.kicker)}</span><h2 class="h-lg">${esc(c.insum.title)}</h2><p class="soft" style="font-size:14.5px;line-height:1.6">${esc(c.insum.body)}</p><p class="fineprint">${esc(c.insum.disclaimer)}</p></div>
    <div class="sumlist">${c.insum.items.map((it, i) => `<div class="sumitem"><span class="mono">${pad(i)}</span>${esc(it)}</div>`).join('')}</div>
  </div></section>`;

  const pricing = `<section id="pricing" class="section"><div class="container">
    <div class="split" style="margin-bottom:44px;align-items:end"><div class="stack" style="gap:14px"><span class="eyebrow">${esc(c.pricing.kicker)}</span><h2 class="h-lg" style="max-width:420px">${esc(c.pricing.title)}</h2></div><p class="lead">${esc(c.pricing.lead)}</p></div>
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
