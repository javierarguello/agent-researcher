import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLang } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { usePublicPlans, useCheckout } from '../api/hooks';
import { PENDING_PLAN_KEY } from '../api/client';
import { config } from '../config';
import { LangSwitcher } from '../components/LangSwitcher';
import { PlanCard } from '../components/PlanCard';
import { LANDING_COPY } from '../content/landing-copy.mjs';

const BRAND = 'Florida Biz Labs';

const COPY = LANDING_COPY;

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
              <Link to="/api-access">{c.foot.product[2]}</Link>
            </div>
            <div className="col">
              <h5>{c.foot.companyL}</h5>
              {['/privacy', '/legal', '/support'].map((href, i) => <Link key={href} to={href}>{c.foot.company[i]}</Link>)}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
