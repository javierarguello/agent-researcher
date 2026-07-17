export interface LandingCopy {
  nav: { search: string; insights: string; pricing: string; login: string; app: string };
  hero: { kicker: string; title: string; lead: string; cta1: string; cta2: string; disclaimer: string; tagline: string };
  sample: {
    label: string; id: string;
    rows: [string, string][];
    missingL: string; missing: string[];
    questionsL: string; questions: string[];
    cta: string;
  };
  wwd: { kicker: string; title: string; body: string };
  benefits: { kicker: string; title: string; items: [string, string][] };
  hiw: { kicker: string; title: string; steps: [string, string][] };
  insum: { kicker: string; title: string; body: string; disclaimer: string; items: string[] };
  usage: { kicker: string; title: string; body1: string; body2: string };
  pricing: { kicker: string; title: string; lead: string; creditsWord: string; popular: string; choose: string; noPlans: string };
  faq: { kicker: string; title: string; items: [string, string][] };
  cta: { kicker: string; title: string; body: string; btn: string; disclaimer: string };
  foot: { disclaimer: string; productL: string; companyL: string; product: string[]; company: string[] };
}

export const LANDING_COPY: Record<'en' | 'es' | 'fr' | 'pt', LandingCopy>;
