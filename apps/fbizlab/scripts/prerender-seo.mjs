/**
 * Post-build SEO prerender. The app is a static SPA, but for SEO each public
 * language must be a distinct, crawlable URL with its own <title>, description,
 * canonical, og:locale and a full set of hreflang alternates. We emit one HTML
 * file per language (en = index.html, es = es.html, …) — same JS bundle, but a
 * localized <head> baked in so crawlers and social scrapers get correct signals
 * without executing JS. Firebase `cleanUrls` serves es.html at /es.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://fbizlab.web.app';
const DIST = join(process.cwd(), 'dist');

// English lives at "/" (x-default); the rest at "/<lang>".
const LOCALES = {
  es: {
    path: '/es', ogLocale: 'es_ES',
    title: 'Florida Biz Labs — Descubre oportunidades de negocio en Florida con IA',
    description: 'Reporte de inversión personalizado con IA para adquirir un negocio en Florida: una tesis clara de comprar o pasar, valoración, riesgos, comparables y ROI, con un digest de mercado actualizado al momento.',
    ogTitle: 'Tu tesis de inversión en Florida, escrita por IA',
    ogDescription: 'Un reporte de inversión personalizado con una tesis clara, respaldado por un digest de mercado en vivo. No es un aviso más de brokers.',
    twTitle: 'Florida Biz Labs — Tu tesis de inversión en Florida',
    twDescription: 'Research de inversión con IA para adquirir un negocio en Florida: tesis, valoración, riesgos, comparables, ROI.',
  },
  fr: {
    path: '/fr', ogLocale: 'fr_FR',
    title: 'Florida Biz Labs — Découvrez des opportunités d’affaires en Floride avec l’IA',
    description: 'Rapport d’investissement personnalisé par IA pour acquérir une entreprise en Floride : une thèse claire d’achat ou de renoncement, valorisation, risques, comparables et ROI, avec un digest de marché en temps réel.',
    ogTitle: 'Votre thèse d’investissement en Floride, écrite par l’IA',
    ogDescription: 'Un rapport d’investissement personnalisé avec une thèse claire, appuyé par un digest de marché en temps réel. Pas une annonce de courtier de plus.',
    twTitle: 'Florida Biz Labs — Votre thèse d’investissement en Floride',
    twDescription: 'Research d’investissement par IA pour acquérir une entreprise en Floride : thèse, valorisation, risques, comparables, ROI.',
  },
  pt: {
    path: '/pt', ogLocale: 'pt_BR',
    title: 'Florida Biz Labs — Descubra oportunidades de negócio na Flórida com IA',
    description: 'Relatório de investimento personalizado com IA para adquirir um negócio na Flórida: uma tese clara de comprar ou passar, valuation, riscos, comparáveis e ROI, com um digest de mercado atualizado ao momento.',
    ogTitle: 'Sua tese de investimento na Flórida, escrita por IA',
    ogDescription: 'Um relatório de investimento personalizado com uma tese clara, apoiado por um digest de mercado ao vivo. Não é mais um anúncio de corretor.',
    twTitle: 'Florida Biz Labs — Sua tese de investimento na Flórida',
    twDescription: 'Research de investimento com IA para adquirir um negócio na Flórida: tese, valuation, riscos, comparáveis, ROI.',
  },
};

const HREFLANG = [
  `<link rel="alternate" hreflang="en" href="${SITE}/" />`,
  `<link rel="alternate" hreflang="es" href="${SITE}/es" />`,
  `<link rel="alternate" hreflang="fr" href="${SITE}/fr" />`,
  `<link rel="alternate" hreflang="pt" href="${SITE}/pt" />`,
  `<link rel="alternate" hreflang="x-default" href="${SITE}/" />`,
].join('\n    ');

const rep = (html, re, value) => html.replace(re, value);
const metaRe = (attr, name) => new RegExp(`<meta ${attr}="${name}" content="[^"]*"\\s*/?>`);

function withHreflang(html) {
  if (html.includes('hreflang="x-default"')) return html;
  return html.replace(/(<link rel="canonical"[^>]*>)/, `$1\n    ${HREFLANG}`);
}

function localize(base, loc) {
  let html = base;
  const url = `${SITE}${loc.path}`;
  html = rep(html, /<html lang="[^"]*"/, `<html lang="${loc.path.slice(1)}"`);
  html = rep(html, /<title>[\s\S]*?<\/title>/, `<title>${loc.title}</title>`);
  html = rep(html, metaRe('name', 'description'), `<meta name="description" content="${loc.description}" />`);
  html = rep(html, /<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${url}" />`);
  html = rep(html, metaRe('property', 'og:url'), `<meta property="og:url" content="${url}" />`);
  html = rep(html, metaRe('property', 'og:locale'), `<meta property="og:locale" content="${loc.ogLocale}" />`);
  html = rep(html, metaRe('property', 'og:title'), `<meta property="og:title" content="${loc.ogTitle}" />`);
  html = rep(html, metaRe('property', 'og:description'), `<meta property="og:description" content="${loc.ogDescription}" />`);
  html = rep(html, metaRe('name', 'twitter:title'), `<meta name="twitter:title" content="${loc.twTitle}" />`);
  html = rep(html, metaRe('name', 'twitter:description'), `<meta name="twitter:description" content="${loc.twDescription}" />`);
  return html;
}

const indexPath = join(DIST, 'index.html');
const base = withHreflang(readFileSync(indexPath, 'utf8'));
writeFileSync(indexPath, base); // en / x-default, now with hreflang
for (const [lang, loc] of Object.entries(LOCALES)) {
  writeFileSync(join(DIST, `${lang}.html`), localize(base, loc));
  console.log(`✓ dist/${lang}.html — ${loc.path}`);
}
console.log('✓ SEO prerender done (en + es/fr/pt)');
