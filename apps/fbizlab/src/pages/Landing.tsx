import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLang } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { usePublicPlans, useCheckout } from '../api/hooks';
import { PENDING_PLAN_KEY } from '../api/client';
import { config } from '../config';
import { LangSwitcher } from '../components/LangSwitcher';
import { PlanCard } from '../components/PlanCard';

const BRAND = 'Florida Biz Labs';

const COPY = {
  en: {
    nav: { search: 'Search', insights: 'Insights', pricing: 'Pricing', login: 'Log In', app: 'App' },
    hero: {
      kicker: 'AI-assisted research for Florida business opportunities',
      title: 'Explore Florida business opportunities with greater clarity.',
      lead: `${BRAND} is a specialized research digest for exploring Florida business opportunities at scale and intelligently, based on your own criteria — it organizes available listing information, compares key details and highlights questions worth investigating.`,
      cta1: 'Explore opportunities', cta2: 'See a sample summary',
      disclaimer: 'AI-generated research for informational purposes. Always refer to the original listings for complete, up-to-date details.',
      tagline: 'Research faster. Ask better questions. Decide what to investigate next.',
    },
    sample: {
      label: 'Research summary (sample)', id: 'FBL-SAMPLE',
      rows: [['Industry', 'HVAC services'], ['Location', 'Broward County, FL'], ['Asking price', '$1.45M'], ['Reported revenue', '$3.2M']],
      missingL: 'Appears missing', missing: ['Customer concentration', 'Lease terms detail'],
      questionsL: 'Questions to investigate',
      questions: ['How is revenue distributed across customers?', 'What are the current lease terms and renewal options?'],
      cta: 'See a sample summary',
    },
    wwd: {
      kicker: 'What we do', title: 'A simpler starting point for your business search',
      body: `Business listings often come scattered, incomplete or difficult to compare. ${BRAND} brings available details into a structured summary, helping you understand each opportunity and prepare for the next step in your own research.`,
    },
    benefits: {
      kicker: 'Benefits', title: 'Bring scattered information into one place',
      items: [
        ['Review information faster', 'See important listing details in a more organized and consistent format.'],
        ['Compare opportunities', 'Review multiple businesses using similar categories and search criteria.'],
        ['Identify missing details', 'Discover which financial, operational or commercial information may require further investigation.'],
        ['Prepare better questions', 'Generate a useful starting list of questions for brokers, sellers and professional advisors.'],
        ['Focus your search', 'Spend more time reviewing opportunities aligned with your interests, budget and preferred location.'],
      ],
    },
    hiw: {
      kicker: 'How it works', title: 'From scattered information to a clearer overview',
      steps: [
        ['Set your preferences', 'Select your preferred location, industry, investment range and other search criteria.'],
        ['Explore available opportunities', 'Review businesses that appear related to the criteria you selected.'],
        ['Generate a research summary', 'Florida Biz Labs organizes available information and highlights missing details or questions to investigate.'],
        ['Continue your own evaluation', 'Use the summary as a starting point when consulting brokers, accountants, attorneys, lenders or other qualified professionals.'],
      ],
    },
    insum: {
      kicker: 'Inside a summary', title: 'See the information that matters at a glance',
      body: 'Depending on the information available, each AI-generated summary may organize details such as:',
      disclaimer: `${BRAND} does not independently verify the information provided by sellers, brokers, listings or third-party sources.`,
      items: ['Asking price', 'Reported revenue or owner earnings', 'Location and industry', 'Seller or broker listing details', 'Operational information', 'Information that appears to be missing', 'General questions for further investigation', 'Sources and data limitations'],
    },
    usage: {
      kicker: 'How to use it', title: 'Useful research without false certainty',
      body1: `${BRAND} is designed to make early-stage research easier — not to tell you whether to buy a business.`,
      body2: 'The platform uses automated systems and artificial intelligence to organize information and generate preliminary observations. Results are not routinely reviewed by humans and may not reflect industry-specific, legal, financial or local-market considerations.',
    },
    pricing: {
      kicker: 'Pricing', title: 'Credit packs. No subscription.',
      lead: 'Buy credits once and use them whenever you research. Each summary spends credits — a more thorough one spends more. Credits never expire.',
      creditsWord: 'credits', popular: 'Most popular', choose: 'Choose pack', noPlans: 'Packs are being set up.',
    },
    faq: {
      kicker: 'FAQ', title: 'Common questions',
      items: [
        ['What does Florida Biz Labs do?', 'It is a specialized digest that helps you search Florida business opportunities at scale and intelligently, based on your own criteria. It organizes available listing information into a structured summary and highlights details worth investigating.'],
        ['Does Florida Biz Labs replace business listing portals?', 'No. It complements them — it does not replace them. Florida Biz Labs organizes information available across listings and always references the original sources, so you can go back to them for complete, up-to-date details.'],
        ['Does Florida Biz Labs recommend which business I should buy?', 'No. It does not tell you whether to buy. It organizes information and raises questions to support your own evaluation.'],
        ['Is the information verified?', 'No. Figures come from listings and third-party sources and are not independently verified. Always confirm them yourself.'],
        ['Are summaries reviewed by professionals?', 'No. Summaries are generated automatically and are not routinely reviewed by industry specialists.'],
        ['Is this a due diligence report?', 'No. It is an early-stage research aid, not due diligence. Consult qualified professionals before any decision.'],
        ['Is Florida Biz Labs a business broker?', 'No. Florida Biz Labs is not a broker and is not involved in any transaction.'],
      ],
    },
    cta: {
      kicker: 'Get started', title: 'Find the opportunities you want to investigate further',
      body: `Start with your preferred location, industry and investment range. ${BRAND} will help you organize available information and narrow your research more efficiently.`,
      btn: 'Start my search',
      disclaimer: 'No investment recommendation is provided. Always verify information independently and consult qualified professionals before making financial or acquisition decisions.',
    },
    foot: {
      disclaimer: 'AI-generated research. Not investment or legal advice. Verify all figures independently before purchasing.',
      productL: 'Product', companyL: 'Company',
      product: ['Search', 'AI reports', 'API access'], company: ['Privacy', 'Legal', 'Support'],
    },
  },

  es: {
    nav: { search: 'Buscar', insights: 'Insights', pricing: 'Precios', login: 'Ingresar', app: 'App' },
    hero: {
      kicker: 'Investigación asistida por IA para oportunidades de negocio en Florida',
      title: 'Explora oportunidades de negocio en Florida con mayor claridad.',
      lead: `${BRAND} es un digest de investigación especializado para explorar oportunidades de negocio en Florida de forma masiva e inteligente, según tus propios criterios — organiza la información disponible de los avisos, compara detalles clave y resalta preguntas que vale la pena investigar.`,
      cta1: 'Explorar oportunidades', cta2: 'Ver un resumen de ejemplo',
      disclaimer: 'Investigación generada por IA con fines informativos. Consulta siempre los avisos originales para ver los detalles completos y actualizados.',
      tagline: 'Investiga más rápido. Haz mejores preguntas. Decide qué investigar después.',
    },
    sample: {
      label: 'Resumen de investigación (ejemplo)', id: 'FBL-SAMPLE',
      rows: [['Industria', 'Servicios HVAC'], ['Ubicación', 'Broward County, FL'], ['Precio', '$1.45M'], ['Ingresos reportados', '$3.2M']],
      missingL: 'Parece faltar', missing: ['Concentración de clientes', 'Detalle de términos del lease'],
      questionsL: 'Preguntas para investigar',
      questions: ['¿Cómo se distribuyen los ingresos entre los clientes?', '¿Cuáles son los términos actuales del lease y las opciones de renovación?'],
      cta: 'Ver un resumen de ejemplo',
    },
    wwd: {
      kicker: 'Qué hacemos', title: 'Un punto de partida más simple para tu búsqueda de negocios',
      body: `Los avisos de negocios suelen venir con información dispersa, incompleta o difícil de comparar. ${BRAND} reúne los detalles disponibles en un resumen estructurado, ayudándote a entender cada oportunidad y a prepararte para el siguiente paso de tu propia investigación.`,
    },
    benefits: {
      kicker: 'Beneficios', title: 'Reúne información dispersa en un solo lugar',
      items: [
        ['Revisa la información más rápido', 'Ve los detalles importantes del aviso en un formato más organizado y consistente.'],
        ['Compara oportunidades', 'Revisa varios negocios usando categorías y criterios de búsqueda similares.'],
        ['Identifica detalles faltantes', 'Descubre qué información financiera, operativa o comercial puede requerir más investigación.'],
        ['Prepara mejores preguntas', 'Genera una lista inicial útil de preguntas para brokers, vendedores y asesores profesionales.'],
        ['Enfoca tu búsqueda', 'Dedica más tiempo a revisar oportunidades alineadas con tus intereses, presupuesto y ubicación preferida.'],
      ],
    },
    hiw: {
      kicker: 'Cómo funciona', title: 'De información dispersa a una visión más clara',
      steps: [
        ['Define tus preferencias', 'Selecciona tu ubicación, industria, rango de inversión y otros criterios de búsqueda.'],
        ['Explora las oportunidades disponibles', 'Revisa los negocios que parecen relacionados con los criterios que seleccionaste.'],
        ['Genera un resumen de investigación', 'Florida Biz Labs organiza la información disponible y resalta detalles faltantes o preguntas para investigar.'],
        ['Continúa tu propia evaluación', 'Usa el resumen como punto de partida al consultar brokers, contadores, abogados, prestamistas u otros profesionales calificados.'],
      ],
    },
    insum: {
      kicker: 'Dentro de un resumen', title: 'Ve la información que importa de un vistazo',
      body: 'Según la información disponible, cada resumen generado por IA puede organizar detalles como:',
      disclaimer: `${BRAND} no verifica de forma independiente la información provista por vendedores, brokers, avisos o fuentes de terceros.`,
      items: ['Precio', 'Ingresos reportados o ganancias del dueño', 'Ubicación e industria', 'Detalles del aviso del vendedor o broker', 'Información operativa', 'Información que parece faltar', 'Preguntas generales para investigar', 'Fuentes y limitaciones de los datos'],
    },
    usage: {
      kicker: 'Cómo usarlo', title: 'Investigación útil sin certezas falsas',
      body1: `${BRAND} está diseñado para facilitar la investigación en etapa temprana — no para decirte si comprar o no un negocio.`,
      body2: 'La plataforma usa sistemas automatizados e inteligencia artificial para organizar información y generar observaciones preliminares. Los resultados no son revisados de forma rutinaria por humanos y pueden no reflejar consideraciones específicas del sector, legales, financieras o del mercado local.',
    },
    pricing: {
      kicker: 'Precios', title: 'Paquetes de créditos. Sin suscripción.',
      lead: 'Compra créditos una vez y úsalos cuando investigues. Cada resumen gasta créditos — uno más completo gasta más. Los créditos no expiran.',
      creditsWord: 'créditos', popular: 'Más popular', choose: 'Elegir paquete', noPlans: 'Estamos configurando los paquetes.',
    },
    faq: {
      kicker: 'FAQ', title: 'Preguntas frecuentes',
      items: [
        ['¿Qué hace Florida Biz Labs?', 'Es un digest especializado que te ayuda a buscar oportunidades de negocio en Florida de forma masiva e inteligente, según tus propios criterios. Organiza la información disponible de los avisos en un resumen estructurado y resalta detalles que vale la pena investigar.'],
        ['¿Florida Biz Labs reemplaza los portales de avisos?', 'No. Los complementa, no los reemplaza. Florida Biz Labs organiza la información disponible en los avisos y siempre hace referencia a las fuentes originales, para que acudas a ellas por los detalles completos y actualizados.'],
        ['¿Florida Biz Labs recomienda qué negocio debo comprar?', 'No. No te dice si comprar o no. Organiza la información y plantea preguntas para apoyar tu propia evaluación.'],
        ['¿La información está verificada?', 'No. Las cifras provienen de avisos y fuentes de terceros y no se verifican de forma independiente. Confírmalas siempre tú mismo.'],
        ['¿Los resúmenes son revisados por profesionales?', 'No. Los resúmenes se generan automáticamente y no son revisados de forma rutinaria por especialistas del sector.'],
        ['¿Esto es un reporte de debida diligencia?', 'No. Es una ayuda de investigación en etapa temprana, no debida diligencia. Consulta a profesionales calificados antes de cualquier decisión.'],
        ['¿Florida Biz Labs es un broker de negocios?', 'No. Florida Biz Labs no es un broker y no participa en ninguna transacción.'],
      ],
    },
    cta: {
      kicker: 'Empezar', title: 'Encuentra las oportunidades que quieres investigar a fondo',
      body: `Empieza con tu ubicación, industria y rango de inversión preferidos. ${BRAND} te ayudará a organizar la información disponible y a acotar tu investigación de forma más eficiente.`,
      btn: 'Iniciar mi búsqueda',
      disclaimer: 'No se brinda ninguna recomendación de inversión. Verifica siempre la información de forma independiente y consulta a profesionales calificados antes de tomar decisiones financieras o de adquisición.',
    },
    foot: {
      disclaimer: 'Investigación generada por IA. No es asesoría de inversión ni legal. Verifica todas las cifras de forma independiente antes de comprar.',
      productL: 'Producto', companyL: 'Empresa',
      product: ['Buscar', 'Reportes IA', 'Acceso API'], company: ['Privacidad', 'Legal', 'Soporte'],
    },
  },

  fr: {
    nav: { search: 'Recherche', insights: 'Aperçus', pricing: 'Tarifs', login: 'Connexion', app: 'App' },
    hero: {
      kicker: 'Recherche assistée par IA pour les opportunités d’affaires en Floride',
      title: 'Explorez les opportunités d’affaires en Floride avec plus de clarté.',
      lead: `${BRAND} est un digest de recherche spécialisé pour explorer les opportunités d’affaires en Floride à grande échelle et intelligemment, selon vos propres critères — il organise les informations disponibles des annonces, compare les détails clés et met en évidence les questions à approfondir.`,
      cta1: 'Explorer les opportunités', cta2: 'Voir un exemple de résumé',
      disclaimer: 'Recherche générée par IA à titre informatif. Reportez-vous toujours aux annonces d’origine pour les détails complets et à jour.',
      tagline: 'Recherchez plus vite. Posez de meilleures questions. Décidez quoi approfondir.',
    },
    sample: {
      label: 'Résumé de recherche (exemple)', id: 'FBL-SAMPLE',
      rows: [['Secteur', 'Services CVC'], ['Localisation', 'Broward County, FL'], ['Prix', '$1.45M'], ['Revenu déclaré', '$3.2M']],
      missingL: 'Semble manquer', missing: ['Concentration de la clientèle', 'Détail des conditions du bail'],
      questionsL: 'Questions à approfondir',
      questions: ['Comment le revenu est-il réparti entre les clients ?', 'Quelles sont les conditions actuelles du bail et les options de renouvellement ?'],
      cta: 'Voir un exemple de résumé',
    },
    wwd: {
      kicker: 'Ce que nous faisons', title: 'Un point de départ plus simple pour votre recherche',
      body: `Les annonces d’entreprises arrivent souvent avec des informations dispersées, incomplètes ou difficiles à comparer. ${BRAND} rassemble les détails disponibles dans un résumé structuré, pour vous aider à comprendre chaque opportunité et à préparer la prochaine étape de votre propre recherche.`,
    },
    benefits: {
      kicker: 'Avantages', title: 'Rassemblez l’information dispersée en un seul endroit',
      items: [
        ['Examinez l’information plus vite', 'Voyez les détails importants d’une annonce dans un format plus organisé et cohérent.'],
        ['Comparez les opportunités', 'Examinez plusieurs entreprises avec des catégories et critères de recherche similaires.'],
        ['Identifiez les détails manquants', 'Découvrez quelles informations financières, opérationnelles ou commerciales méritent d’être approfondies.'],
        ['Préparez de meilleures questions', 'Générez une liste de départ utile de questions pour les courtiers, vendeurs et conseillers professionnels.'],
        ['Ciblez votre recherche', 'Passez plus de temps sur les opportunités alignées avec vos intérêts, votre budget et votre localisation préférée.'],
      ],
    },
    hiw: {
      kicker: 'Comment ça marche', title: 'D’une information dispersée à une vue plus claire',
      steps: [
        ['Définissez vos préférences', 'Sélectionnez votre localisation, votre secteur, votre fourchette d’investissement et d’autres critères.'],
        ['Explorez les opportunités disponibles', 'Examinez les entreprises qui semblent liées aux critères sélectionnés.'],
        ['Générez un résumé de recherche', 'Florida Biz Labs organise l’information disponible et met en évidence les détails manquants ou les questions à approfondir.'],
        ['Poursuivez votre propre évaluation', 'Utilisez le résumé comme point de départ pour consulter courtiers, comptables, avocats, prêteurs ou autres professionnels qualifiés.'],
      ],
    },
    insum: {
      kicker: 'Dans un résumé', title: 'Voyez l’information qui compte d’un coup d’œil',
      body: 'Selon l’information disponible, chaque résumé généré par IA peut organiser des détails tels que :',
      disclaimer: `${BRAND} ne vérifie pas de façon indépendante les informations fournies par les vendeurs, courtiers, annonces ou sources tierces.`,
      items: ['Prix', 'Revenu déclaré ou bénéfices du propriétaire', 'Localisation et secteur', 'Détails de l’annonce du vendeur ou du courtier', 'Informations opérationnelles', 'Informations qui semblent manquer', 'Questions générales à approfondir', 'Sources et limites des données'],
    },
    usage: {
      kicker: 'Comment l’utiliser', title: 'Une recherche utile sans fausse certitude',
      body1: `${BRAND} est conçu pour faciliter la recherche en phase initiale — pas pour vous dire s’il faut acheter une entreprise.`,
      body2: 'La plateforme utilise des systèmes automatisés et l’intelligence artificielle pour organiser l’information et générer des observations préliminaires. Les résultats ne sont pas examinés régulièrement par des humains et peuvent ne pas refléter des considérations sectorielles, juridiques, financières ou de marché local.',
    },
    pricing: {
      kicker: 'Tarifs', title: 'Packs de crédits. Sans abonnement.',
      lead: 'Achetez des crédits une fois et utilisez-les quand vous faites vos recherches. Chaque résumé consomme des crédits — un plus complet en consomme plus. Les crédits n’expirent pas.',
      creditsWord: 'crédits', popular: 'Le plus populaire', choose: 'Choisir le pack', noPlans: 'Les packs sont en cours de configuration.',
    },
    faq: {
      kicker: 'FAQ', title: 'Questions fréquentes',
      items: [
        ['Que fait Florida Biz Labs ?', 'C’est un digest spécialisé qui vous aide à rechercher des opportunités d’affaires en Floride à grande échelle et intelligemment, selon vos propres critères. Il organise l’information disponible des annonces dans un résumé structuré et met en évidence les détails à approfondir.'],
        ['Florida Biz Labs remplace-t-il les portails d’annonces ?', 'Non. Il les complète, il ne les remplace pas. Florida Biz Labs organise l’information disponible dans les annonces et renvoie toujours aux sources d’origine, pour que vous y trouviez les détails complets et à jour.'],
        ['Florida Biz Labs recommande-t-il quelle entreprise acheter ?', 'Non. Il ne vous dit pas s’il faut acheter. Il organise l’information et soulève des questions pour appuyer votre propre évaluation.'],
        ['L’information est-elle vérifiée ?', 'Non. Les chiffres proviennent des annonces et de sources tierces et ne sont pas vérifiés de façon indépendante. Confirmez-les toujours vous-même.'],
        ['Les résumés sont-ils examinés par des professionnels ?', 'Non. Les résumés sont générés automatiquement et ne sont pas examinés régulièrement par des spécialistes du secteur.'],
        ['S’agit-il d’un rapport de due diligence ?', 'Non. C’est une aide à la recherche en phase initiale, pas une due diligence. Consultez des professionnels qualifiés avant toute décision.'],
        ['Florida Biz Labs est-il un courtier ?', 'Non. Florida Biz Labs n’est pas un courtier et n’intervient dans aucune transaction.'],
      ],
    },
    cta: {
      kicker: 'Commencer', title: 'Trouvez les opportunités que vous voulez approfondir',
      body: `Commencez avec votre localisation, votre secteur et votre fourchette d’investissement. ${BRAND} vous aidera à organiser l’information disponible et à affiner votre recherche plus efficacement.`,
      btn: 'Lancer ma recherche',
      disclaimer: 'Aucune recommandation d’investissement n’est fournie. Vérifiez toujours l’information de façon indépendante et consultez des professionnels qualifiés avant toute décision financière ou d’acquisition.',
    },
    foot: {
      disclaimer: 'Recherche générée par IA. Pas un conseil en investissement ni juridique. Vérifiez tous les chiffres de façon indépendante avant d’acheter.',
      productL: 'Produit', companyL: 'Entreprise',
      product: ['Recherche', 'Rapports IA', 'Accès API'], company: ['Confidentialité', 'Mentions légales', 'Support'],
    },
  },

  pt: {
    nav: { search: 'Buscar', insights: 'Insights', pricing: 'Preços', login: 'Entrar', app: 'App' },
    hero: {
      kicker: 'Pesquisa assistida por IA para oportunidades de negócio na Flórida',
      title: 'Explore oportunidades de negócio na Flórida com mais clareza.',
      lead: `${BRAND} é um digest de pesquisa especializado para explorar oportunidades de negócio na Flórida em escala e de forma inteligente, com base nos seus próprios critérios — organiza as informações disponíveis dos anúncios, compara detalhes-chave e destaca perguntas que valem a pena investigar.`,
      cta1: 'Explorar oportunidades', cta2: 'Ver um resumo de exemplo',
      disclaimer: 'Pesquisa gerada por IA para fins informativos. Consulte sempre os anúncios originais para ver os detalhes completos e atualizados.',
      tagline: 'Pesquise mais rápido. Faça perguntas melhores. Decida o que investigar a seguir.',
    },
    sample: {
      label: 'Resumo de pesquisa (exemplo)', id: 'FBL-SAMPLE',
      rows: [['Setor', 'Serviços HVAC'], ['Localização', 'Broward County, FL'], ['Preço', '$1.45M'], ['Receita reportada', '$3.2M']],
      missingL: 'Parece faltar', missing: ['Concentração de clientes', 'Detalhe dos termos do contrato'],
      questionsL: 'Perguntas para investigar',
      questions: ['Como a receita se distribui entre os clientes?', 'Quais são os termos atuais do contrato e as opções de renovação?'],
      cta: 'Ver um resumo de exemplo',
    },
    wwd: {
      kicker: 'O que fazemos', title: 'Um ponto de partida mais simples para sua busca de negócios',
      body: `Anúncios de negócios costumam vir com informações dispersas, incompletas ou difíceis de comparar. ${BRAND} reúne os detalhes disponíveis em um resumo estruturado, ajudando você a entender cada oportunidade e a preparar o próximo passo da sua própria pesquisa.`,
    },
    benefits: {
      kicker: 'Benefícios', title: 'Reúna informações dispersas em um só lugar',
      items: [
        ['Revise as informações mais rápido', 'Veja os detalhes importantes do anúncio em um formato mais organizado e consistente.'],
        ['Compare oportunidades', 'Revise vários negócios usando categorias e critérios de busca semelhantes.'],
        ['Identifique detalhes faltantes', 'Descubra quais informações financeiras, operacionais ou comerciais podem exigir mais investigação.'],
        ['Prepare perguntas melhores', 'Gere uma lista inicial útil de perguntas para corretores, vendedores e consultores profissionais.'],
        ['Foque sua busca', 'Dedique mais tempo a oportunidades alinhadas com seus interesses, orçamento e localização preferida.'],
      ],
    },
    hiw: {
      kicker: 'Como funciona', title: 'De informações dispersas a uma visão mais clara',
      steps: [
        ['Defina suas preferências', 'Selecione sua localização, setor, faixa de investimento e outros critérios de busca.'],
        ['Explore as oportunidades disponíveis', 'Revise os negócios que parecem relacionados aos critérios selecionados.'],
        ['Gere um resumo de pesquisa', 'Florida Biz Labs organiza as informações disponíveis e destaca detalhes faltantes ou perguntas para investigar.'],
        ['Continue sua própria avaliação', 'Use o resumo como ponto de partida ao consultar corretores, contadores, advogados, credores ou outros profissionais qualificados.'],
      ],
    },
    insum: {
      kicker: 'Dentro de um resumo', title: 'Veja a informação que importa de relance',
      body: 'Dependendo da informação disponível, cada resumo gerado por IA pode organizar detalhes como:',
      disclaimer: `${BRAND} não verifica de forma independente as informações fornecidas por vendedores, corretores, anúncios ou fontes de terceiros.`,
      items: ['Preço', 'Receita reportada ou ganhos do dono', 'Localização e setor', 'Detalhes do anúncio do vendedor ou corretor', 'Informações operacionais', 'Informações que parecem faltar', 'Perguntas gerais para investigar', 'Fontes e limitações dos dados'],
    },
    usage: {
      kicker: 'Como usar', title: 'Pesquisa útil sem falsas certezas',
      body1: `${BRAND} foi feito para facilitar a pesquisa em estágio inicial — não para dizer se você deve comprar um negócio.`,
      body2: 'A plataforma usa sistemas automatizados e inteligência artificial para organizar informações e gerar observações preliminares. Os resultados não são revisados rotineiramente por humanos e podem não refletir considerações específicas do setor, jurídicas, financeiras ou do mercado local.',
    },
    pricing: {
      kicker: 'Preços', title: 'Pacotes de créditos. Sem assinatura.',
      lead: 'Compre créditos uma vez e use quando pesquisar. Cada resumo gasta créditos — um mais completo gasta mais. Os créditos não expiram.',
      creditsWord: 'créditos', popular: 'Mais popular', choose: 'Escolher pacote', noPlans: 'Os pacotes estão sendo configurados.',
    },
    faq: {
      kicker: 'FAQ', title: 'Perguntas comuns',
      items: [
        ['O que a Florida Biz Labs faz?', 'É um digest especializado que ajuda você a buscar oportunidades de negócio na Flórida em escala e de forma inteligente, com base nos seus próprios critérios. Organiza as informações disponíveis dos anúncios em um resumo estruturado e destaca detalhes que valem a pena investigar.'],
        ['A Florida Biz Labs substitui os portais de anúncios?', 'Não. Ela os complementa, não os substitui. A Florida Biz Labs organiza as informações disponíveis nos anúncios e sempre faz referência às fontes originais, para você acessá-las e ver os detalhes completos e atualizados.'],
        ['A Florida Biz Labs recomenda qual negócio devo comprar?', 'Não. Não diz se você deve comprar. Organiza a informação e levanta perguntas para apoiar sua própria avaliação.'],
        ['A informação é verificada?', 'Não. Os números vêm de anúncios e fontes de terceiros e não são verificados de forma independente. Confirme sempre você mesmo.'],
        ['Os resumos são revisados por profissionais?', 'Não. Os resumos são gerados automaticamente e não são revisados rotineiramente por especialistas do setor.'],
        ['Isto é um relatório de due diligence?', 'Não. É um auxílio de pesquisa em estágio inicial, não due diligence. Consulte profissionais qualificados antes de qualquer decisão.'],
        ['A Florida Biz Labs é uma corretora de negócios?', 'Não. A Florida Biz Labs não é corretora e não participa de nenhuma transação.'],
      ],
    },
    cta: {
      kicker: 'Começar', title: 'Encontre as oportunidades que você quer investigar a fundo',
      body: `Comece com sua localização, setor e faixa de investimento preferidos. ${BRAND} vai ajudar você a organizar as informações disponíveis e a refinar sua pesquisa de forma mais eficiente.`,
      btn: 'Iniciar minha busca',
      disclaimer: 'Nenhuma recomendação de investimento é fornecida. Verifique sempre a informação de forma independente e consulte profissionais qualificados antes de decisões financeiras ou de aquisição.',
    },
    foot: {
      disclaimer: 'Pesquisa gerada por IA. Não é aconselhamento de investimento ou jurídico. Verifique todos os números de forma independente antes de comprar.',
      productL: 'Produto', companyL: 'Empresa',
      product: ['Buscar', 'Relatórios IA', 'Acesso API'], company: ['Privacidade', 'Jurídico', 'Suporte'],
    },
  },
};

const pad = (i: number) => String(i + 1).padStart(2, '0');

function SampleCard({ c }: { c: (typeof COPY)['en']['sample']; onCta: () => void }) {
  return (
    <div className="sample">
      <div className="sample__top">
        <span className="mono sample__label">{c.label}</span>
        <span className="mono sample__id">{c.id}</span>
      </div>
      <div className="sample__rows">
        {c.rows.map(([k, v]) => (
          <div key={k} className="sample__row"><span className="mono">{k}</span><b>{v}</b></div>
        ))}
      </div>
      <div className="sample__block">
        <div className="mono sample__blabel">{c.missingL}</div>
        {c.missing.map((m) => (
          <div key={m} className="sample__miss"><i />{m}</div>
        ))}
      </div>
      <div className="sample__block">
        <div className="mono sample__blabel">{c.questionsL}</div>
        {c.questions.map((q, i) => (
          <div key={q} className="sample__q"><span className="mono">{pad(i)}</span>{q}</div>
        ))}
      </div>
    </div>
  );
}

export function Landing() {
  const { lang } = useLang();
  const { isAuthed } = useAuth();
  const nav = useNavigate();
  const c = COPY[lang];
  const go = () => nav(isAuthed ? '/app/new' : '/login');
  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Credit packs come straight from Stripe via the public API — never hardcoded.
  const checkout = useCheckout();
  const plansQuery = usePublicPlans(config.appId, lang);
  const plans = plansQuery.data?.plans ?? [];

  // "Choose pack": signed in → straight to Stripe Checkout; otherwise log in first
  // and resume the purchase right after (see Login + PENDING_PLAN_KEY).
  async function choosePlan(planId: string) {
    if (!isAuthed) {
      localStorage.setItem(PENDING_PLAN_KEY, planId);
      nav('/login');
      return;
    }
    try {
      const url = `${window.location.origin}/app/credits`;
      const res = await checkout.mutateAsync({ planId, successUrl: `${url}?ok=1`, cancelUrl: url });
      window.location.href = res.url;
    } catch {
      nav('/app/credits');
    }
  }

  return (
    <div>
      <header className="hdr">
        <div className="container">
          <div className="brand"><img className="brand-mark" src="/icons/favicon.svg" alt="" width="26" height="26" />{BRAND}</div>
          <nav className="nav">
            <a href="#top" onClick={(e) => { e.preventDefault(); go(); }}>{c.nav.search}</a>
            <a href="#benefits" onClick={scrollTo('benefits')}>{c.nav.insights}</a>
            <a href="#pricing" onClick={scrollTo('pricing')}>{c.nav.pricing}</a>
          </nav>
          <div className="row" style={{ gap: 12 }}>
            <LangSwitcher />
            <Link className="btn btn--black btn--sm" to={isAuthed ? '/app' : '/login'}>{isAuthed ? c.nav.app : c.nav.login}</Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="container" id="top">
        <div className="hero">
          <div className="stack rise" style={{ gap: 20 }}>
            <div className="eyebrow">{c.hero.kicker}</div>
            <h1 className="h-xl">{c.hero.title}</h1>
            <p className="lead">{c.hero.lead}</p>
            <div className="row" style={{ gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
              <button className="btn btn--black" onClick={go}>{c.hero.cta1}</button>
              <button className="btn btn--outline" onClick={scrollTo('inside')}>{c.hero.cta2}</button>
            </div>
            <p className="fineprint">{c.hero.disclaimer}</p>
            <div className="mono muted" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', lineHeight: 1.8 }}>{c.hero.tagline}</div>
          </div>
          <div className="rise rise-1"><SampleCard c={c.sample} onCta={go} /></div>
        </div>
      </section>

      {/* what we do */}
      <section className="section section--alt">
        <div className="container split">
          <div className="stack" style={{ gap: 14 }}>
            <span className="eyebrow">{c.wwd.kicker}</span>
            <h2 className="h-lg" style={{ maxWidth: 420 }}>{c.wwd.title}</h2>
          </div>
          <p className="lead" style={{ maxWidth: 520 }}>{c.wwd.body}</p>
        </div>
      </section>

      {/* benefits */}
      <section id="benefits" className="section">
        <div className="container">
          <div className="stack" style={{ gap: 14, marginBottom: 44 }}>
            <span className="eyebrow">{c.benefits.kicker}</span>
            <h2 className="h-lg" style={{ maxWidth: 460 }}>{c.benefits.title}</h2>
          </div>
          <div className="bgrid">
            {c.benefits.items.map(([t, d], i) => (
              <div key={t} className="bcell">
                <div className="mono bcell__n">{pad(i)}</div>
                <h4>{t}</h4>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="section section--alt">
        <div className="container">
          <div className="stack" style={{ gap: 14, marginBottom: 44 }}>
            <span className="eyebrow">{c.hiw.kicker}</span>
            <h2 className="h-lg" style={{ maxWidth: 480 }}>{c.hiw.title}</h2>
          </div>
          <div className="hiw">
            {c.hiw.steps.map(([t, d], i) => (
              <div key={t} className="hcard">
                <div className="mono hcard__n">{pad(i)}</div>
                <h4>{t}</h4>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* inside a summary */}
      <section id="inside" className="section">
        <div className="container split">
          <div className="stack" style={{ gap: 16, maxWidth: 360 }}>
            <span className="eyebrow">{c.insum.kicker}</span>
            <h2 className="h-lg">{c.insum.title}</h2>
            <p className="soft" style={{ fontSize: 14.5, lineHeight: 1.6 }}>{c.insum.body}</p>
            <p className="fineprint">{c.insum.disclaimer}</p>
          </div>
          <div className="sumlist">
            {c.insum.items.map((it, i) => (
              <div key={it} className="sumitem"><span className="mono">{pad(i)}</span>{it}</div>
            ))}
          </div>
        </div>
      </section>

      {/* pricing — credit packs from Stripe */}
      <section id="pricing" className="section">
        <div className="container">
          <div className="split" style={{ marginBottom: 44, alignItems: 'end' }}>
            <div className="stack" style={{ gap: 14 }}>
              <span className="eyebrow">{c.pricing.kicker}</span>
              <h2 className="h-lg" style={{ maxWidth: 420 }}>{c.pricing.title}</h2>
            </div>
            <p className="lead">{c.pricing.lead}</p>
          </div>
          {plans.length === 0 ? (
            <p className="soft mono" style={{ fontSize: 13 }}>{c.pricing.noPlans}</p>
          ) : (
            <div className="plans">
              {plans.map((p) => (
                <PlanCard key={p.planId} plan={p} lang={lang} creditsWord={c.pricing.creditsWord} popularLabel={c.pricing.popular} buttonLabel={c.pricing.choose} onSelect={() => choosePlan(p.planId)} busy={checkout.isPending} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* how to use it — dark */}
      <section className="section section--dark">
        <div className="container split">
          <div className="stack" style={{ gap: 14 }}>
            <span className="eyebrow" style={{ color: 'var(--accent)' }}>{c.usage.kicker}</span>
            <h2 className="h-lg" style={{ color: 'var(--on-dark)', maxWidth: 360 }}>{c.usage.title}</h2>
          </div>
          <div className="stack" style={{ gap: 18, maxWidth: 520 }}>
            <p style={{ color: 'var(--on-dark)', fontSize: 17, lineHeight: 1.55 }}>{c.usage.body1}</p>
            <p style={{ color: '#a8a49b', fontSize: 14, lineHeight: 1.7 }}>{c.usage.body2}</p>
          </div>
        </div>
      </section>

      {/* faq */}
      <section className="section section--alt">
        <div className="container split faq-split">
          <div className="stack" style={{ gap: 14 }}>
            <span className="eyebrow">{c.faq.kicker}</span>
            <h2 className="h-lg">{c.faq.title}</h2>
          </div>
          <div className="faq">
            {c.faq.items.map(([q, a], i) => {
              const open = openFaq === i;
              return (
                <div key={q} className={`faqitem${open ? ' open' : ''}`}>
                  <button className="faqq" onClick={() => setOpenFaq(open ? null : i)} aria-expanded={open}>
                    <span>{q}</span><span className="faqx">{open ? '–' : '+'}</span>
                  </button>
                  {open && <p className="faqa">{a}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* get started */}
      <section className="section">
        <div className="container split gs-split">
          <div className="stack" style={{ gap: 16 }}>
            <span className="eyebrow">{c.cta.kicker}</span>
            <h2 className="h-xl" style={{ maxWidth: 560 }}>{c.cta.title}</h2>
            <p className="lead">{c.cta.body}</p>
          </div>
          <div className="stack" style={{ gap: 16, maxWidth: 320 }}>
            <button className="btn btn--accent btn--block" onClick={go}>{c.cta.btn} →</button>
            <p className="fineprint">{c.cta.disclaimer}</p>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="foot">
        <div className="container">
          <div className="cols">
            <div>
              <div className="brand" style={{ marginBottom: 14 }}><img className="brand-mark" src="/icons/favicon.svg" alt="" width="26" height="26" />{BRAND}</div>
              <p className="disclaimer">{c.foot.disclaimer}</p>
            </div>
            <div className="col">
              <h5>{c.foot.productL}</h5>
              <a href="#top" onClick={(e) => { e.preventDefault(); go(); }}>{c.foot.product[0]}</a>
              <a href="#inside" onClick={scrollTo('inside')}>{c.foot.product[1]}</a>
              <a href="#pricing" onClick={scrollTo('pricing')}>{c.foot.product[2]}</a>
            </div>
            <div className="col">
              <h5>{c.foot.companyL}</h5>
              {c.foot.company.map((x) => <a key={x} href="#top">{x}</a>)}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
