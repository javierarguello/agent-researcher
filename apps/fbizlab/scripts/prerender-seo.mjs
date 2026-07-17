/**
 * Post-build SEO prerender. The app is a static SPA, but for SEO each public
 * language must be a distinct, crawlable URL with its own <title>, description,
 * canonical, og:locale, hreflang alternates and localized JSON-LD (product +
 * FAQ). We emit one HTML file per language (en = index.html, es = es.html, …) —
 * same JS bundle, localized <head>. Firebase `cleanUrls` serves es.html at /es.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://fbizlab.web.app';
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

const HREFLANG = [
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
  html = rep(html, ldRe('ld-app'), `$1\n    ${appLd(loc.appDescription, url)}\n    $2`);
  html = rep(html, ldRe('ld-faq'), `$1\n    ${faqLd(loc.faq)}\n    $2`);
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
