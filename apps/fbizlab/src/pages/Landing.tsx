import { Link, useNavigate } from 'react-router-dom';
import { useLang } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { usePublicPlans } from '../api/hooks';
import { config } from '../config';
import { LangSwitcher } from '../components/LangSwitcher';
import { IconAI, IconArrow, IconBars, IconChart, IconFlorida, IconPin, IconShield, IconTag, IconTarget } from '../components/icons';

const BRAND = 'FloridaBizLab';

const COPY = {
  en: {
    nav: { discover: 'Discover', inside: 'Inside', pricing: 'Pricing', login: 'Log In', app: 'App' },
    heroKicker: 'Florida · Market Discovery · AI Analysis',
    heroA: 'Discover Florida ',
    heroB: 'Opportunities.',
    heroLead: `${BRAND} leverages AI to surface high-potential investment opportunities across Florida. Explore markets, analyze performance, and make data-driven decisions with confidence.`,
    tagline: 'Market insights. AI analysis. Smarter investments.',
    start: 'Start exploring',
    markets: 'View markets',
    joined: 'Joined by 400+ active FL acquisition seekers this month.',
    card: {
      kicker: 'AI analysis report', name: 'Biscayne Bay Bistro', loc: 'Miami, FL 33132', cat: 'Restaurant',
      revLbl: 'Est. annual revenue', rev: '$1.15M – $1.28M', revSub: '80% confidence',
      roiLbl: 'Est. ROI (3 yr)', roi: '14.2%', roiSub: 'Medium confidence',
      sigLbl: 'Investment signal', sig: 'Strong opportunity', riskLbl: 'Risk level', risk: 'Medium',
      view: 'View full analysis',
    },
    features: [
      ['Market discovery', 'Find high-potential opportunities.'],
      ['AI analysis', 'Advanced models deliver actionable insights.'],
      ['Data confidence', 'Transparent confidence in every metric.'],
      ['Risk aware', 'Identify risk early and invest with clarity.'],
      ['Florida focused', 'Deep local data. Better decisions.'],
    ],
    insideKicker: 'What’s inside a report',
    insideTitle: 'Every section, built for someone weighing a real acquisition move.',
    inside: [
      ['Estimated valuation', 'SDE and revenue multiples benchmarked to the FL market.'],
      ['Risks & red flags', 'Lease, customer concentration, hurricane exposure, permit issues.'],
      ['Comparables', 'Recently sold businesses in the same county and sector.'],
      ['ROI projection', '3-year cash-on-cash based on the deal financials.'],
      ['DD checklist', 'Tailored to sector, county, and buyer profile.'],
      ['Interactive Q&A', 'Ask the AI follow-ups grounded in the dossier data.'],
    ],
    memKicker: 'Membership', memTitle: 'Three plans. Real research.',
    memLead: 'Pay monthly, get a set number of AI-generated market reports plus full discovery access.',
    perMonth: '/mo', creditsWord: 'credits', popular: 'Most popular', choose: 'Choose plan', noPlans: 'Plans are being set up.',
    ctaKicker: 'Ready to shortlist?', ctaTitle: 'Stop reading 40 broker pages. Read one report.', ctaBtn: 'Create your account',
    footDisc: 'AI-generated research. Not investment or legal advice. Verify all figures independently before purchasing.',
    footProduct: 'Product', footCompany: 'Company',
    footLinks: { search: 'Market discovery', reports: 'AI reports', api: 'API access', privacy: 'Privacy', legal: 'Legal', support: 'Support' },
  },
  es: {
    nav: { discover: 'Descubrir', inside: 'Contenido', pricing: 'Planes', login: 'Ingresar', app: 'App' },
    heroKicker: 'Florida · Descubrimiento de Mercado · Análisis IA',
    heroA: 'Descubre oportunidades en ',
    heroB: 'Florida.',
    heroLead: `${BRAND} usa IA para detectar oportunidades de inversión de alto potencial en toda Florida. Explora mercados, analiza desempeño y toma decisiones basadas en datos con confianza.`,
    tagline: 'Insights de mercado. Análisis IA. Inversiones más inteligentes.',
    start: 'Empezar a explorar',
    markets: 'Ver mercados',
    joined: 'Se unieron 400+ compradores activos en FL este mes.',
    card: {
      kicker: 'Reporte de análisis IA', name: 'Biscayne Bay Bistro', loc: 'Miami, FL 33132', cat: 'Restaurante',
      revLbl: 'Ingresos anuales est.', rev: '$1.15M – $1.28M', revSub: '80% confianza',
      roiLbl: 'ROI est. (3 años)', roi: '14.2%', roiSub: 'Confianza media',
      sigLbl: 'Señal de inversión', sig: 'Fuerte oportunidad', riskLbl: 'Nivel de riesgo', risk: 'Medio',
      view: 'Ver análisis completo',
    },
    features: [
      ['Descubrimiento de mercado', 'Encuentra oportunidades de alto potencial.'],
      ['Análisis con IA', 'Modelos avanzados entregan insights accionables.'],
      ['Confianza en los datos', 'Confianza transparente en cada métrica.'],
      ['Consciente del riesgo', 'Detecta riesgos temprano e invierte con claridad.'],
      ['Enfocado en Florida', 'Datos locales profundos. Mejores decisiones.'],
    ],
    insideKicker: 'Qué incluye un reporte',
    insideTitle: 'Cada sección, hecha para quien evalúa una adquisición real.',
    inside: [
      ['Valoración estimada', 'Múltiplos de SDE e ingresos comparados con el mercado de FL.'],
      ['Riesgos y señales', 'Lease, concentración de clientes, huracanes, permisos.'],
      ['Comparables', 'Negocios vendidos recientemente en el mismo condado y sector.'],
      ['Proyección de ROI', 'Cash-on-cash a 3 años según los financieros del negocio.'],
      ['Checklist DD', 'A la medida del sector, condado y perfil del comprador.'],
      ['Q&A interactivo', 'Haz preguntas a la IA basadas en los datos del dossier.'],
    ],
    memKicker: 'Membresía', memTitle: 'Tres planes. Research real.',
    memLead: 'Paga mensual, recibe una cantidad fija de reportes con IA más acceso completo al descubrimiento.',
    perMonth: '/mes', creditsWord: 'créditos', popular: 'Más popular', choose: 'Elegir plan', noPlans: 'Estamos configurando los planes.',
    ctaKicker: '¿Listo para tu lista corta?', ctaTitle: 'Deja de leer 40 páginas de brokers. Lee un reporte.', ctaBtn: 'Crear tu cuenta',
    footDisc: 'Investigación generada por IA. No es asesoría de inversión ni legal. Verifica todas las cifras de forma independiente antes de comprar.',
    footProduct: 'Producto', footCompany: 'Empresa',
    footLinks: { search: 'Descubrimiento', reports: 'Reportes IA', api: 'Acceso API', privacy: 'Privacidad', legal: 'Legal', support: 'Soporte' },
  },
  fr: {
    nav: { discover: 'Découvrir', inside: 'Contenu', pricing: 'Tarifs', login: 'Connexion', app: 'App' },
    heroKicker: 'Floride · Découverte de Marché · Analyse IA',
    heroA: 'Découvrez les opportunités en ', heroB: 'Floride.',
    heroLead: `${BRAND} utilise l’IA pour repérer des opportunités d’investissement à fort potentiel partout en Floride. Explorez les marchés, analysez la performance et décidez sur la base des données, en toute confiance.`,
    tagline: 'Insights de marché. Analyse IA. Investissements plus intelligents.',
    start: 'Commencer à explorer', markets: 'Voir les marchés',
    joined: 'Rejoint par plus de 400 acquéreurs actifs en FL ce mois-ci.',
    card: {
      kicker: 'Rapport d’analyse IA', name: 'Biscayne Bay Bistro', loc: 'Miami, FL 33132', cat: 'Restaurant',
      revLbl: 'Revenu annuel est.', rev: '$1.15M – $1.28M', revSub: '80% de confiance',
      roiLbl: 'ROI est. (3 ans)', roi: '14.2%', roiSub: 'Confiance moyenne',
      sigLbl: 'Signal d’investissement', sig: 'Forte opportunité', riskLbl: 'Niveau de risque', risk: 'Moyen',
      view: 'Voir l’analyse complète',
    },
    features: [
      ['Découverte de marché', 'Trouvez des opportunités à fort potentiel.'],
      ['Analyse IA', 'Des modèles avancés livrent des insights actionnables.'],
      ['Confiance des données', 'Confiance transparente sur chaque métrique.'],
      ['Conscient du risque', 'Détectez le risque tôt et investissez avec clarté.'],
      ['Focalisé sur la Floride', 'Données locales approfondies. Meilleures décisions.'],
    ],
    insideKicker: 'Ce que contient un rapport',
    insideTitle: 'Chaque section, pensée pour qui évalue une acquisition réelle.',
    inside: [
      ['Valorisation estimée', 'Multiples de SDE et de revenus comparés au marché FL.'],
      ['Risques et signaux', 'Bail, concentration client, exposition aux ouragans, permis.'],
      ['Comparables', 'Entreprises vendues récemment dans le même comté et secteur.'],
      ['Projection de ROI', 'Cash-on-cash sur 3 ans selon les finances de l’affaire.'],
      ['Checklist DD', 'Adaptée au secteur, au comté et au profil de l’acheteur.'],
      ['Q&A interactif', 'Posez des questions à l’IA fondées sur les données du dossier.'],
    ],
    memKicker: 'Abonnement', memTitle: 'Trois plans. Du vrai research.',
    memLead: 'Payez au mois, obtenez un nombre défini de rapports de marché IA plus l’accès complet à la découverte.',
    perMonth: '/mois', creditsWord: 'crédits', popular: 'Le plus populaire', choose: 'Choisir le plan', noPlans: 'Les plans sont en cours de configuration.',
    ctaKicker: 'Prêt à faire votre short-list ?', ctaTitle: 'Arrêtez de lire 40 pages de brokers. Lisez un rapport.', ctaBtn: 'Créer votre compte',
    footDisc: 'Research généré par IA. Pas un conseil en investissement ni juridique. Vérifiez tous les chiffres de façon indépendante avant d’acheter.',
    footProduct: 'Produit', footCompany: 'Entreprise',
    footLinks: { search: 'Découverte', reports: 'Rapports IA', api: 'Accès API', privacy: 'Confidentialité', legal: 'Mentions légales', support: 'Support' },
  },
  pt: {
    nav: { discover: 'Descobrir', inside: 'Conteúdo', pricing: 'Planos', login: 'Entrar', app: 'App' },
    heroKicker: 'Flórida · Descoberta de Mercado · Análise IA',
    heroA: 'Descubra oportunidades na ', heroB: 'Flórida.',
    heroLead: `${BRAND} usa IA para revelar oportunidades de investimento de alto potencial em toda a Flórida. Explore mercados, analise desempenho e tome decisões baseadas em dados, com confiança.`,
    tagline: 'Insights de mercado. Análise IA. Investimentos mais inteligentes.',
    start: 'Começar a explorar', markets: 'Ver mercados',
    joined: 'Mais de 400 compradores ativos na FL entraram este mês.',
    card: {
      kicker: 'Relatório de análise IA', name: 'Biscayne Bay Bistro', loc: 'Miami, FL 33132', cat: 'Restaurante',
      revLbl: 'Receita anual est.', rev: '$1.15M – $1.28M', revSub: '80% de confiança',
      roiLbl: 'ROI est. (3 anos)', roi: '14.2%', roiSub: 'Confiança média',
      sigLbl: 'Sinal de investimento', sig: 'Forte oportunidade', riskLbl: 'Nível de risco', risk: 'Médio',
      view: 'Ver análise completa',
    },
    features: [
      ['Descoberta de mercado', 'Encontre oportunidades de alto potencial.'],
      ['Análise com IA', 'Modelos avançados entregam insights acionáveis.'],
      ['Confiança nos dados', 'Confiança transparente em cada métrica.'],
      ['Consciente do risco', 'Detecte riscos cedo e invista com clareza.'],
      ['Focado na Flórida', 'Dados locais profundos. Melhores decisões.'],
    ],
    insideKicker: 'O que há em um relatório',
    insideTitle: 'Cada seção, feita para quem avalia uma aquisição real.',
    inside: [
      ['Valuation estimado', 'Múltiplos de SDE e receita comparados ao mercado da FL.'],
      ['Riscos e sinais', 'Contrato, concentração de clientes, exposição a furacões, licenças.'],
      ['Comparáveis', 'Negócios vendidos recentemente no mesmo condado e setor.'],
      ['Projeção de ROI', 'Cash-on-cash em 3 anos com base nas finanças do negócio.'],
      ['Checklist de DD', 'Sob medida para setor, condado e perfil do comprador.'],
      ['Q&A interativo', 'Faça perguntas à IA baseadas nos dados do dossiê.'],
    ],
    memKicker: 'Assinatura', memTitle: 'Três planos. Research de verdade.',
    memLead: 'Pague por mês, receba um número fixo de relatórios de mercado com IA mais acesso completo à descoberta.',
    perMonth: '/mês', creditsWord: 'créditos', popular: 'Mais popular', choose: 'Escolher plano', noPlans: 'Estamos configurando os planos.',
    ctaKicker: 'Pronto para sua short-list?', ctaTitle: 'Pare de ler 40 páginas de brokers. Leia um relatório.', ctaBtn: 'Criar sua conta',
    footDisc: 'Research gerado por IA. Não é aconselhamento de investimento ou jurídico. Verifique todos os números de forma independente antes de comprar.',
    footProduct: 'Produto', footCompany: 'Empresa',
    footLinks: { search: 'Descoberta', reports: 'Relatórios IA', api: 'Acesso API', privacy: 'Privacidade', legal: 'Jurídico', support: 'Suporte' },
  },
};

function DossierCard({ c, onOpen }: { c: (typeof COPY)['en']['card']; onOpen: () => void }) {
  return (
    <div className="card" style={{ padding: 26 }}>
      <div className="between">
        <span className="eyebrow" style={{ color: 'var(--muted)' }}>{c.kicker}</span>
        <span className="dots">···</span>
      </div>
      <h3 style={{ fontSize: 26, marginTop: 12, letterSpacing: '-0.02em' }}>{c.name}</h3>
      <div className="row" style={{ gap: 18, marginTop: 8 }}>
        <span className="metaicon"><IconPin />{c.loc}</span>
        <span className="metaicon"><IconTag />{c.cat}</span>
      </div>
      <div className="stat2" style={{ marginTop: 22, gap: 24 }}>
        <div className="kv"><div className="k">{c.revLbl}</div><div className="v coral">{c.rev}</div><div className="sub">{c.revSub}</div></div>
        <div className="kv"><div className="k">{c.roiLbl}</div><div className="v green">{c.roi}</div><div className="sub">{c.roiSub}</div></div>
      </div>
      <div className="stat2" style={{ marginTop: 22, gap: 24 }}>
        <div className="kv"><div className="k" style={{ marginBottom: 8 }}>{c.sigLbl}</div><span className="sig sig--ok">{c.sig}</span></div>
        <div className="kv"><div className="k" style={{ marginBottom: 8 }}>{c.riskLbl}</div><span className="sig sig--risk">{c.risk}</span></div>
      </div>
      <hr className="divider" style={{ margin: '22px 0 16px' }} />
      <button className="row" onClick={onOpen} style={{ background: 'transparent', border: 0, padding: 0, width: '100%', justifyContent: 'space-between', color: 'var(--ink)' }}>
        <span className="metaicon" style={{ color: 'var(--ink)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 11 }}><IconBars />{c.view}</span>
        <span style={{ width: 18, height: 18, color: 'var(--muted)' }}><IconArrow /></span>
      </button>
    </div>
  );
}

const FEATURE_ICONS = [IconTarget, IconAI, IconChart, IconShield, IconFlorida];

export function Landing() {
  const { lang } = useLang();
  const { isAuthed } = useAuth();
  const nav = useNavigate();
  const c = COPY[lang];
  const go = () => nav(isAuthed ? '/app/new' : '/login');
  // Pricing comes straight from Stripe via the public API — never hardcoded here.
  const plansQuery = usePublicPlans(config.appId);
  const plans = plansQuery.data?.plans ?? [];

  return (
    <div>
      <header className="hdr">
        <div className="container">
          <div className="brand">{BRAND}<span className="dot">.</span></div>
          <nav className="nav">
            <a href="#workspace">{c.nav.discover}</a>
            <a href="#inside">{c.nav.inside}</a>
            <a href="#pricing">{c.nav.pricing}</a>
          </nav>
          <div className="row" style={{ gap: 12 }}>
            <LangSwitcher />
            <Link className="btn btn--black btn--sm" to={isAuthed ? '/app' : '/login'}>{isAuthed ? c.nav.app : c.nav.login}</Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="container">
        <div className="hero">
          <div className="stack rise" style={{ gap: 22 }}>
            <div className="eyebrow">{c.heroKicker}</div>
            <h1 className="h-xl">{c.heroA}<span className="accent">{c.heroB}</span></h1>
            <p className="lead">{c.heroLead}</p>
            <div className="mono muted" style={{ fontSize: 12, letterSpacing: '.06em' }}>{c.tagline}</div>
            <div className="row" style={{ gap: 12, marginTop: 4 }}>
              <button className="btn btn--black" onClick={go}>{c.start}</button>
              <a className="btn btn--outline" href="#workspace">{c.markets}</a>
            </div>
            <div className="row" style={{ gap: 14, marginTop: 8 }}>
              <div className="avatars">
                <span style={{ background: '#d8d2c6' }} /><span style={{ background: '#bdb6a8' }} /><span style={{ background: 'var(--accent)' }} />
              </div>
              <span className="mono muted" style={{ fontSize: 11 }}>{c.joined}</span>
            </div>
          </div>
          <div className="rise rise-1"><DossierCard c={c.card} onOpen={go} /></div>
        </div>
      </section>

      {/* feature row */}
      <section className="section" style={{ paddingTop: 40, paddingBottom: 40 }}>
        <div className="container">
          <div className="features">
            {c.features.map(([title, desc], i) => {
              const Icon = FEATURE_ICONS[i]!;
              return (
                <div key={title} className="feat"><Icon /><h6>{title}</h6><p>{desc}</p></div>
              );
            })}
          </div>
        </div>
      </section>

      {/* workspace */}
      <section id="workspace" className="section section--alt">
        <div className="container">
          <div className="between" style={{ marginBottom: 36, alignItems: 'flex-end' }}>
            <div className="stack" style={{ gap: 12, maxWidth: 640 }}>
              <span className="eyebrow">{c.insideKicker}</span>
              <h2 className="h-lg">{c.insideTitle}</h2>
            </div>
            <button className="btn btn--black" onClick={go}>{c.start}</button>
          </div>
          <div style={{ maxWidth: 460 }}><DossierCard c={c.card} onOpen={go} /></div>
        </div>
      </section>

      {/* what's inside */}
      <section id="inside" className="section">
        <div className="container">
          <div className="inside">
            {c.inside.map(([title, desc], i) => (
              <div key={title} className="cell">
                <div className="n">{String(i + 1).padStart(2, '0')}</div>
                <h4>{title}</h4>
                <p className="soft" style={{ fontSize: 14 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="section section--alt">
        <div className="container">
          <div className="between" style={{ marginBottom: 36, alignItems: 'flex-end' }}>
            <div className="stack" style={{ gap: 12 }}>
              <span className="eyebrow">{c.memKicker}</span>
              <h2 className="h-lg">{c.memTitle}</h2>
            </div>
            <p className="soft" style={{ fontSize: 13.5, maxWidth: 260 }}>{c.memLead}</p>
          </div>
          {plans.length === 0 ? (
            <p className="soft mono" style={{ fontSize: 13 }}>{c.noPlans}</p>
          ) : (
            <div className="plans">
              {plans.map((p) => (
                <div key={p.planId} className={`card plan ${p.popular ? 'dark' : ''}`}>
                  <div className="between">
                    <div><div style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</div>{p.sub && <div className="mono muted" style={{ fontSize: 11 }}>{p.sub}</div>}</div>
                    {p.popular && <span className="tag-popular">{c.popular}</span>}
                  </div>
                  <div className="price">${p.priceUsd.toLocaleString(lang)}{p.interval && <small>{c.perMonth}</small>}</div>
                  {p.credits > 0 && <div className="metric" style={{ marginTop: 14 }}><div className="num">{p.credits}</div><div className="lbl">{c.creditsWord}</div></div>}
                  {p.features && p.features.length > 0 && (
                    <>
                      <hr className="divider" style={{ margin: '18px 0' }} />
                      <div className="stack" style={{ gap: 9, flex: 1 }}>{p.features.map((f) => <div key={f} className="bullet">{f}</div>)}</div>
                    </>
                  )}
                  <button className={`btn btn--block ${p.popular ? 'btn--accent' : 'btn--black'}`} style={{ marginTop: 22 }} onClick={go}>{c.choose}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="section">
        <div className="container">
          <span className="eyebrow">{c.ctaKicker}</span>
          <div className="between" style={{ marginTop: 16, alignItems: 'flex-end', gap: 40 }}>
            <h2 className="h-xl" style={{ maxWidth: 640 }}>{c.ctaTitle}</h2>
            <button className="btn btn--accent" onClick={go}>{c.ctaBtn} →</button>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="foot">
        <div className="container">
          <div className="cols">
            <div>
              <div className="brand" style={{ marginBottom: 14 }}>{BRAND}<span className="dot">.</span></div>
              <p className="disclaimer">{c.footDisc}</p>
            </div>
            <div className="col">
              <h5>{c.footProduct}</h5>
              <a href="#workspace">{c.footLinks.search}</a>
              <a href="#inside">{c.footLinks.reports}</a>
              <a href="#pricing">{c.footLinks.api}</a>
            </div>
            <div className="col">
              <h5>{c.footCompany}</h5>
              <a href="#">{c.footLinks.privacy}</a><a href="#">{c.footLinks.legal}</a><a href="#">{c.footLinks.support}</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
