/**
 * Post-build SEO prerender. The app is a static SPA, but for SEO each public
 * language must be a distinct, crawlable URL with its own <title>, description,
 * canonical, og:locale, hreflang alternates and localized JSON-LD (product +
 * FAQ). We emit one HTML file per language (en = index.html, es = es.html, …) —
 * same JS bundle, localized <head>. Firebase `cleanUrls` serves es.html at /es.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderLandingStatic } from './landing-static.mjs';

/**
 * The origin every canonical, hreflang, og:url and sitemap entry is written against.
 *
 * It was the literal `https://fbizlab.web.app` — a host that **404s**. Nothing in the
 * project has ever been served there; the Hosting sites are
 * `agent-researcher-{dev,prod}-fbizlab.web.app` and the product lives at
 * `floridabizlabs.com`. So every prerendered page told Google "the real version of
 * this page is at <a URL that does not exist>", every hreflang alternate pointed at a
 * dead domain, and `robots.txt` sent crawlers to a sitemap that listed four more of
 * them. A canonical is not a hint — it is an instruction to prefer another URL, and
 * the one being preferred was gone.
 *
 * From the environment now, with **no fallback**: a wrong default is what made this
 * survive a launch and a release, precisely because it looked like a working value.
 * The build fails instead — the same rule `vite.config.ts` applies to the Turnstile
 * key, and for the same reason.
 */
function resolveSite() {
  const site = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
  if (!site) {
    throw new Error(
      'SITE_URL is required: every canonical, hreflang, og:url and sitemap entry is written against it. ' +
        'Prod is https://floridabizlabs.com; a dev build should pass its own Hosting URL. ' +
        'There is no default on purpose — the default used to be a domain that 404s.',
    );
  }
  return site;
}
const DIST = join(process.cwd(), 'dist');

// English lives at "/" (x-default); the rest at "/<lang>". Copy tracks the
// "research digest that organizes listings" positioning (NOT investment advice).
const LOCALES = {
  es: {
    path: '/es', ogLocale: 'es_ES',
    title: 'Florida Biz Labs — Investiga negocios en venta en Florida',
    description: 'Un digest de investigación especializado para negocios en venta en Florida: organiza la información de los avisos, compara detalles clave y resalta preguntas que vale la pena investigar. No es asesoría de inversión.',
    ogTitle: 'Explora oportunidades de negocio en Florida con mayor claridad',
    ogDescription: 'Un digest de investigación que organiza la información de los avisos y resalta preguntas que vale la pena investigar — para buscar negocios en venta en Florida a escala.',
    twTitle: 'Florida Biz Labs — Negocios en venta en Florida',
    twDescription: 'Organiza la información de los avisos, compara detalles clave y resalta preguntas para investigar. No es asesoría de inversión.',
    appDescription: 'Un digest de investigación especializado que te ayuda a explorar negocios en venta en Florida a escala — organizando la información disponible de los avisos, comparando detalles clave y resaltando preguntas que vale la pena investigar. No es asesoría de inversión.',
    faq: [
      ['¿Qué hace Florida Biz Labs?', 'Es un digest especializado que te ayuda a buscar oportunidades de negocio en Florida de forma masiva e inteligente, según tus propios criterios. Organiza la información disponible de los avisos en un resumen estructurado y resalta detalles que vale la pena investigar.'],
      ['¿Florida Biz Labs reemplaza los portales de avisos?', 'No. Los complementa, no los reemplaza. Florida Biz Labs organiza la información disponible en los avisos y siempre hace referencia a las fuentes originales, para que acudas a ellas por los detalles completos y actualizados.'],
      ['¿Florida Biz Labs recomienda qué negocio debo comprar?', 'No. No te dice si comprar o no. Organiza la información y plantea preguntas para apoyar tu propia evaluación.'],
      ['¿La información está verificada?', 'No. Las cifras provienen de avisos y fuentes de terceros y no se verifican de forma independiente. Confírmalas siempre tú mismo.'],
      ['¿Los resúmenes son revisados por profesionales?', 'No. Los resúmenes se generan automáticamente y no son revisados de forma rutinaria por especialistas del sector.'],
      ['¿Esto es un reporte de debida diligencia?', 'No. Es una ayuda de investigación en etapa temprana, no debida diligencia. Consulta a profesionales calificados antes de cualquier decisión.'],
      ['¿Florida Biz Labs es un broker de negocios?', 'No. Florida Biz Labs no es un broker y no participa en ninguna transacción.'],
    ],
  },
  fr: {
    path: '/fr', ogLocale: 'fr_FR',
    title: 'Florida Biz Labs — Recherchez des entreprises à vendre en Floride',
    description: 'Un digest de recherche spécialisé pour les entreprises à vendre en Floride : il organise les informations des annonces, compare les détails clés et met en évidence les questions à approfondir. Pas un conseil en investissement.',
    ogTitle: 'Explorez les opportunités d’affaires en Floride avec plus de clarté',
    ogDescription: 'Un digest de recherche qui organise les informations des annonces et met en évidence les questions à approfondir — pour rechercher des entreprises à vendre en Floride à grande échelle.',
    twTitle: 'Florida Biz Labs — Entreprises à vendre en Floride',
    twDescription: 'Organisez les informations des annonces, comparez les détails clés et faites ressortir les questions à approfondir. Pas un conseil en investissement.',
    appDescription: 'Un digest de recherche spécialisé qui vous aide à explorer les entreprises à vendre en Floride à grande échelle — en organisant les informations disponibles des annonces, en comparant les détails clés et en mettant en évidence les questions à approfondir. Pas un conseil en investissement.',
    faq: [
      ['Que fait Florida Biz Labs ?', 'C’est un digest spécialisé qui vous aide à rechercher des opportunités d’affaires en Floride à grande échelle et intelligemment, selon vos propres critères. Il organise l’information disponible des annonces dans un résumé structuré et met en évidence les détails à approfondir.'],
      ['Florida Biz Labs remplace-t-il les portails d’annonces ?', 'Non. Il les complète, il ne les remplace pas. Florida Biz Labs organise l’information disponible dans les annonces et renvoie toujours aux sources d’origine, pour que vous y trouviez les détails complets et à jour.'],
      ['Florida Biz Labs recommande-t-il quelle entreprise acheter ?', 'Non. Il ne vous dit pas s’il faut acheter. Il organise l’information et soulève des questions pour appuyer votre propre évaluation.'],
      ['L’information est-elle vérifiée ?', 'Non. Les chiffres proviennent des annonces et de sources tierces et ne sont pas vérifiés de façon indépendante. Confirmez-les toujours vous-même.'],
      ['Les résumés sont-ils examinés par des professionnels ?', 'Non. Les résumés sont générés automatiquement et ne sont pas examinés régulièrement par des spécialistes du secteur.'],
      ['S’agit-il d’un rapport de due diligence ?', 'Non. C’est une aide à la recherche en phase initiale, pas une due diligence. Consultez des professionnels qualifiés avant toute décision.'],
      ['Florida Biz Labs est-il un courtier ?', 'Non. Florida Biz Labs n’est pas un courtier et n’intervient dans aucune transaction.'],
    ],
  },
  pt: {
    path: '/pt', ogLocale: 'pt_BR',
    title: 'Florida Biz Labs — Pesquise negócios à venda na Flórida',
    description: 'Um digest de pesquisa especializado para negócios à venda na Flórida: organiza as informações dos anúncios, compara detalhes-chave e destaca perguntas que valem a pena investigar. Não é aconselhamento de investimento.',
    ogTitle: 'Explore oportunidades de negócio na Flórida com mais clareza',
    ogDescription: 'Um digest de pesquisa que organiza as informações dos anúncios e destaca perguntas que valem a pena investigar — para pesquisar negócios à venda na Flórida em escala.',
    twTitle: 'Florida Biz Labs — Negócios à venda na Flórida',
    twDescription: 'Organize as informações dos anúncios, compare detalhes-chave e destaque perguntas para investigar. Não é aconselhamento de investimento.',
    appDescription: 'Um digest de pesquisa especializado que ajuda você a explorar negócios à venda na Flórida em escala — organizando as informações disponíveis dos anúncios, comparando detalhes-chave e destacando perguntas que valem a pena investigar. Não é aconselhamento de investimento.',
    faq: [
      ['O que a Florida Biz Labs faz?', 'É um digest especializado que ajuda você a buscar oportunidades de negócio na Flórida em escala e de forma inteligente, com base nos seus próprios critérios. Organiza as informações disponíveis dos anúncios em um resumo estruturado e destaca detalhes que valem a pena investigar.'],
      ['A Florida Biz Labs substitui os portais de anúncios?', 'Não. Ela os complementa, não os substitui. A Florida Biz Labs organiza as informações disponíveis nos anúncios e sempre faz referência às fontes originais, para você acessá-las e ver os detalhes completos e atualizados.'],
      ['A Florida Biz Labs recomenda qual negócio devo comprar?', 'Não. Não diz se você deve comprar. Organiza a informação e levanta perguntas para apoiar sua própria avaliação.'],
      ['A informação é verificada?', 'Não. Os números vêm de anúncios e fontes de terceiros e não são verificados de forma independente. Confirme sempre você mesmo.'],
      ['Os resumos são revisados por profissionais?', 'Não. Os resumos são gerados automaticamente e não são revisados rotineiramente por especialistas do setor.'],
      ['Isto é um relatório de due diligence?', 'Não. É um auxílio de pesquisa em estágio inicial, não due diligence. Consulte profissionais qualificados antes de qualquer decisão.'],
      ['A Florida Biz Labs é uma corretora de negócios?', 'Não. A Florida Biz Labs não é corretora e não participa de nenhuma transação.'],
    ],
  },
};

const hreflangFor = (SITE) =>
  [
    `<link rel="alternate" hreflang="en" href="${SITE}/" />`,
    `<link rel="alternate" hreflang="es" href="${SITE}/es" />`,
    `<link rel="alternate" hreflang="fr" href="${SITE}/fr" />`,
    `<link rel="alternate" hreflang="pt" href="${SITE}/pt" />`,
    `<link rel="alternate" hreflang="x-default" href="${SITE}/" />`,
  ].join('\n    ');

const rep = (html, re, value) => html.replace(re, value);
const metaRe = (attr, name) => new RegExp(`<meta ${attr}="${name}" content="[^"]*"\\s*/?>`);
const ldRe = (id) => new RegExp(`(<script type="application/ld\\+json" id="${id}">)[\\s\\S]*?(</script>)`);

function faqLd(items) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  });
}
function appLd(description, url) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Florida Biz Labs',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description,
    url,
    inLanguage: ['en', 'es', 'fr', 'pt'],
  });
}

function withHreflang(html, SITE) {
  if (html.includes('hreflang="x-default"')) return html;
  return html.replace(/(<link rel="canonical"[^>]*>)/, `$1\n    ${hreflangFor(SITE)}`);
}

function localize(base, loc, SITE) {
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
  html = rep(html, ldRe('ld-app'), `$1\n    ${appLd(loc.appDescription, url)}\n    $2`);
  html = rep(html, ldRe('ld-faq'), `$1\n    ${faqLd(loc.faq)}\n    $2`);
  return html;
}

// Bake the static landing content into #root so crawlers see the real H1 /
// sections / FAQ without running JS. React (createRoot) replaces it on mount.
const injectStatic = (html, lang) => html.replace('<div id="root"></div>', `<div id="root">${renderLandingStatic(lang)}</div>`);

/**
 * The public routes that are NOT the landing.
 *
 * Every one of them was served `index.html` byte-for-byte by the SPA rewrite —
 * measured: `md5(/sample) === md5(/privacy) === md5(/) === md5(/any-garbage-path)`.
 * So seven public URLs presented themselves to a non-JS crawler as exact duplicates
 * of the homepage, each carrying the homepage's canonical and title. Duplicates get
 * dropped, which is how a site with `/sample` — 34.5 kB of keyword-rich long-form
 * copy, six times the landing — ends up with a crawlable surface of one page.
 *
 * The titles and descriptions are NOT invented here: each is the page's own heading
 * and its own opening sentence. `test/seo-routes.test.ts` asserts they still match
 * the components, because copy in two files is copy that drifts.
 *
 * English only, and deliberately: unlike the landing these routes have no per-language
 * URL (`/es/privacy` does not exist), so they get no hreflang at all. A hreflang set
 * pointing at landing variants would be worse than none — it would claim `/privacy`
 * has a Spanish version at `/es`, which is the homepage.
 */
export const STATIC_ROUTES = [
  {
    file: 'sample.html',
    path: '/sample',
    // From public/sample-dossier.json `title` — the real dossier's own headline.
    title: 'Florida Businesses for Sale — Buy-Side Research | Florida Biz Labs',
    description:
      'A complete example dossier from a real run: shortlisted Florida businesses for sale, valuation and ROI signals, comparables, risk flags and the questions worth investigating before you buy.',
  },
  {
    file: 'privacy.html',
    path: '/privacy',
    title: 'Privacy Notice | Florida Biz Labs',
    description:
      'Florida Biz Labs is an AI research tool. We keep data to the minimum needed to run your account, we count visits without cookies, and we never sell your data.',
  },
  {
    file: 'legal.html',
    path: '/legal',
    title: 'Terms & Disclaimer | Florida Biz Labs',
    description:
      'Terms of use for Florida Biz Labs. AI-generated research for informational purposes — not investment advice, not due diligence, and not a brokerage.',
  },
  {
    file: 'support.html',
    path: '/support',
    title: 'Support | Florida Biz Labs',
    description: 'Questions about a dossier, your credits or your account — how to reach Florida Biz Labs.',
  },
  {
    file: 'api-access.html',
    path: '/api-access',
    title: 'API & MCP access | Florida Biz Labs',
    description:
      'Run Florida Biz Labs research from your own tools: an HTTP API and an MCP server for generating buy-side dossiers on Florida businesses for sale.',
  },
  {
    file: 'contact.html',
    path: '/contact',
    title: 'Request information | Florida Biz Labs',
    description:
      'Have a question about researching Florida businesses for sale, or want more information about Florida Biz Labs? Send us a message and we’ll get back to you.',
  },
];

/** Same head rewrite as `localize`, minus the language-specific parts, plus hreflang REMOVAL. */
function staticRoute(base, route, SITE) {
  const url = `${SITE}${route.path}`;
  // `API & MCP access` is a real title and a bare `&` is invalid in markup. Escaped
  // here rather than pre-escaped in the table, so the table stays readable copy.
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  route = { ...route, title: esc(route.title), description: esc(route.description) };
  let html = base;
  // These pages have no language variants; the landing's alternates do not apply.
  html = html.replace(/\s*<link rel="alternate" hreflang="[^"]*" href="[^"]*"\s*\/>/g, '');
  html = rep(html, /<title>[\s\S]*?<\/title>/, `<title>${route.title}</title>`);
  html = rep(html, metaRe('name', 'description'), `<meta name="description" content="${route.description}" />`);
  html = rep(html, /<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${url}" />`);
  html = rep(html, metaRe('property', 'og:url'), `<meta property="og:url" content="${url}" />`);
  html = rep(html, metaRe('property', 'og:title'), `<meta property="og:title" content="${route.title}" />`);
  html = rep(html, metaRe('property', 'og:description'), `<meta property="og:description" content="${route.description}" />`);
  html = rep(html, metaRe('name', 'twitter:title'), `<meta name="twitter:title" content="${route.title}" />`);
  html = rep(html, metaRe('name', 'twitter:description'), `<meta name="twitter:description" content="${route.description}" />`);
  // The landing's FAQ describes the landing, not these pages — stripped. The
  // Organization block is NOT stripped: it identifies who publishes the site, which
  // is true on every page and is the thing that ties all four hosts to one entity.
  html = rep(html, ldRe('ld-faq'), '$1$2');
  return html;
}

/**
 * Everything with a side effect lives in here.
 *
 * The module used to run on import — resolve `SITE_URL`, throw without it, and write
 * a dozen files. That made it impossible to `import { STATIC_ROUTES }` from a test,
 * which is exactly what `test/seo-routes.test.ts` needs in order to check the emitted
 * metadata against the app's own copy. A build script that cannot be inspected
 * without running it is a build script nothing will ever check.
 */
export function main() {
  const SITE = resolveSite();
  const INDEXABLE = process.env.SEO_INDEXABLE === 'true';
  const indexPath = join(DIST, 'index.html');
  /**
   * Every `__SITE__` in the source head becomes this deployment's origin — canonical,
   * og:url, og:image, twitter:image and the JSON-LD `url`, in one pass rather than five
   * hand-maintained replacements. `localize()` overwrites some of them again per
   * language; this is what covers the ROOT and, more importantly, the tags nobody
   * remembered were absolute (the two IMAGES).
   */
  const base = withHreflang(readFileSync(indexPath, 'utf8').split('__SITE__').join(SITE), SITE);
  writeFileSync(indexPath, injectStatic(base, 'en')); // en / x-default
  for (const [lang, loc] of Object.entries(LOCALES)) {
  writeFileSync(join(DIST, `${lang}.html`), injectStatic(localize(base, loc, SITE), lang));
  console.log(`✓ dist/${lang}.html — ${loc.path}`);
  }

  // The non-landing public routes. `cleanUrls` serves `sample.html` at `/sample`.
  // No static body is baked into these: unlike the landing there is no server-side
  // renderer for them, so what this fixes is the HEAD — each one stops claiming to be
  // the homepage. A JS-executing crawler (Google is one) then indexes the real content
  // under the right canonical and title. Baking `/sample`'s body for crawlers that do
  // NOT run JS is the remaining half; see `product-backlog.md` § P-9.
  for (const route of STATIC_ROUTES) {
  writeFileSync(join(DIST, route.file), staticRoute(base, route, SITE));
  console.log(`✓ dist/${route.file} — ${route.path}`);
  }
  console.log('✓ SEO prerender done (en + es/fr/pt, static content baked)');

  /**
   * `robots.txt` and `sitemap.xml` are GENERATED here rather than shipped from
   * `public/`, because both of them name the origin — and a checked-in file naming an
   * origin is a file that is wrong in every environment but one. They used to be static
   * and they named the dead host in three places.
   *
   * The private routes deserve a word. `/app` and `/login` were already disallowed;
   * `/verify`, `/reset` and `/report` were not, and all three carry single-purpose
   * tokens in their query strings. The `noindex` on them is applied by React AFTER the
   * page loads, so a crawler that does not run JS never sees it. They are disallowed
   * here, where the answer does not depend on executing anything.
   *
   * The sitemap lists the four landings AND the static public routes. It briefly
   * listed only the landings, correctly: until `STATIC_ROUTES` existed, `/sample` and
   * the rest inherited the ROOT canonical and claimed to BE the homepage, and listing
   * a page whose own canonical points elsewhere is a contradiction the sitemap loses.
   * They have canonicals of their own now, so they belong here. `/sample` is weighted
   * above the legal pages because it is the only long-form content on the site.
   */
  const PUBLIC_LANDINGS = ['/', '/es', '/fr', '/pt'];

  writeFileSync(
  join(DIST, 'robots.txt'),
  INDEXABLE
    ? [
        'User-agent: *',
        'Disallow: /app',
        'Disallow: /login',
        'Disallow: /verify',   // carries a single-purpose auth token in ?token=
        'Disallow: /reset',    // same
        'Disallow: /report',   // ?rt= IS the authorization for the shared dossier
        '',
        `Sitemap: ${SITE}/sitemap.xml`,
        '',
      ].join('\n')
    : ['# Non-production deployment — a duplicate of the live site.', 'User-agent: *', 'Disallow: /', ''].join('\n'),
  );

  writeFileSync(
  join(DIST, 'sitemap.xml'),
  INDEXABLE
    ? `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  ${PUBLIC_LANDINGS.map(
  (path) => `  <url>
    <loc>${SITE}${path === '/' ? '/' : path}</loc>
  ${PUBLIC_LANDINGS.map((alt) => `    <xhtml:link rel="alternate" hreflang="${alt === '/' ? 'en' : alt.slice(1)}" href="${SITE}${alt}" />`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/" />
    <changefreq>weekly</changefreq>
    <priority>${path === '/' ? '1.0' : '0.9'}</priority>
  </url>`,
  ).join('\n')}
  ${STATIC_ROUTES.map(
  (r) => `  <url>
    <loc>${SITE}${r.path}</loc>
    <changefreq>${r.path === '/sample' ? 'monthly' : 'yearly'}</changefreq>
    <priority>${r.path === '/sample' ? '0.8' : '0.3'}</priority>
  </url>`,
  ).join('\n')}
  </urlset>
  `
    : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`,
  );

  console.log(`prerender-seo: SITE=${SITE} indexable=${INDEXABLE}`);

  /**
   * The guard that makes this class of defect impossible to reintroduce.
   *
   * A canonical pointing at a dead host is invisible: the page renders, the build is
   * green, and only a crawler ever reads the tag. So the build ASSERTS on its own
   * output — no unreplaced token, and no trace of the origin that caused this.
   */
  for (const file of ['index.html', 'es.html', 'fr.html', 'pt.html', 'robots.txt', 'sitemap.xml', ...STATIC_ROUTES.map((r) => r.file)]) {
  const out = readFileSync(join(DIST, file), 'utf8');
  if (out.includes('__SITE__')) throw new Error(`${file} still contains the __SITE__ placeholder — prerender did not replace it.`);
  // The ORIGIN, scheme and all — not the bare hostname. `fbizlab.web.app` is a
  // substring of `agent-researcher-dev-fbizlab.web.app`, which is a real and correct
  // origin, so the loose check failed every dev build. Caught by running it.
  if (out.includes('https://fbizlab.web.app')) {
    throw new Error(`${file} names https://fbizlab.web.app — a host that 404s, and the literal this guard exists for.`);
  }
  }
  console.log(`prerender-seo: origin guard passed on ${6 + STATIC_ROUTES.length} files`);

}

// Only when invoked directly — importing this module must do nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
