import { useState } from 'react';
import { Link } from 'react-router-dom';
import { pick, useLang } from '../i18n';
import { useBalance, useCheckout, usePlans, useTemplates } from '../api/hooks';
import { ApiError, DRAFT_KEY } from '../api/client';

const T = {
  en: {
    eyebrow: 'Credits', title: 'Top up your balance',
    sub: 'Credits pay for your AI research dossiers. Buy once — your credits never expire, and you always see a dossier’s exact cost before you confirm.',
    currentBalance: 'Current balance', creditsAvailable: 'credits available',
    creditsLbl: 'Credits', perCredit: '/ credit', oneTime: 'One-time payment. Credits never expire.',
    buy: 'Buy now', popular: 'Most popular', bestValue: 'Best value',
    none: 'No credit packs are available right now.', back: 'Back to dashboard',
    faq: 'Common questions',
    q1: 'Do credits expire?', a1: 'No. Your purchased credits never expire.',
    q2: 'How many credits does a dossier cost?',
    a2: 'An essential dossier costs {e} credits; a comprehensive one costs {c}. You always see the exact cost before you confirm.',
    a2f: 'Each dossier shows its exact credit cost before you confirm — a comprehensive one costs more than an essential one.',
    q3: 'When is my dossier ready?', a3: 'Dossiers are generated in about 2–8 minutes and appear in your dashboard — open one to read it in full.',
  },
  es: {
    eyebrow: 'Créditos', title: 'Recarga tu saldo',
    sub: 'Los créditos pagan tus dossiers de research con IA. Compra una vez — tus créditos no expiran, y siempre ves el costo exacto de un dossier antes de confirmar.',
    currentBalance: 'Saldo actual', creditsAvailable: 'créditos disponibles',
    creditsLbl: 'Créditos', perCredit: '/ crédito', oneTime: 'Pago único. Los créditos no expiran.',
    buy: 'Comprar', popular: 'Más popular', bestValue: 'Mejor valor',
    none: 'No hay paquetes de créditos disponibles ahora.', back: 'Volver al panel',
    faq: 'Preguntas frecuentes',
    q1: '¿Los créditos expiran?', a1: 'No. Tus créditos comprados no expiran.',
    q2: '¿Cuántos créditos cuesta un dossier?',
    a2: 'Un dossier essential cuesta {e} créditos; uno comprehensive cuesta {c}. Siempre ves el costo exacto antes de confirmar.',
    a2f: 'Cada dossier muestra su costo exacto en créditos antes de confirmar — uno comprehensive cuesta más que uno essential.',
    q3: '¿Cuándo está listo mi dossier?', a3: 'Los dossiers se generan en unos 2–8 minutos y aparecen en tu panel — ábrelo para leerlo completo.',
  },
  fr: {
    eyebrow: 'Crédits', title: 'Rechargez votre solde',
    sub: 'Les crédits paient vos dossiers de research IA. Achetez une fois — vos crédits n’expirent pas, et vous voyez toujours le coût exact d’un dossier avant de confirmer.',
    currentBalance: 'Solde actuel', creditsAvailable: 'crédits disponibles',
    creditsLbl: 'Crédits', perCredit: '/ crédit', oneTime: 'Paiement unique. Les crédits n’expirent pas.',
    buy: 'Acheter', popular: 'Le plus populaire', bestValue: 'Meilleure valeur',
    none: 'Aucun pack de crédits disponible pour le moment.', back: 'Retour au tableau de bord',
    faq: 'Questions fréquentes',
    q1: 'Les crédits expirent-ils ?', a1: 'Non. Vos crédits achetés n’expirent jamais.',
    q2: 'Combien de crédits coûte un dossier ?',
    a2: 'Un dossier essential coûte {e} crédits ; un comprehensive coûte {c}. Vous voyez toujours le coût exact avant de confirmer.',
    a2f: 'Chaque dossier affiche son coût exact en crédits avant confirmation — un comprehensive coûte plus qu’un essential.',
    q3: 'Quand mon dossier est-il prêt ?', a3: 'Les dossiers sont générés en 2–8 minutes environ et apparaissent dans votre tableau de bord — ouvrez-en un pour le lire en entier.',
  },
  pt: {
    eyebrow: 'Créditos', title: 'Recarregue seu saldo',
    sub: 'Os créditos pagam seus dossiês de research com IA. Compre uma vez — seus créditos não expiram, e você sempre vê o custo exato de um dossiê antes de confirmar.',
    currentBalance: 'Saldo atual', creditsAvailable: 'créditos disponíveis',
    creditsLbl: 'Créditos', perCredit: '/ crédito', oneTime: 'Pagamento único. Os créditos não expiram.',
    buy: 'Comprar', popular: 'Mais popular', bestValue: 'Melhor valor',
    none: 'Nenhum pacote de créditos disponível agora.', back: 'Voltar ao painel',
    faq: 'Perguntas frequentes',
    q1: 'Os créditos expiram?', a1: 'Não. Seus créditos comprados não expiram.',
    q2: 'Quantos créditos custa um dossiê?',
    a2: 'Um dossiê essential custa {e} créditos; um comprehensive custa {c}. Você sempre vê o custo exato antes de confirmar.',
    a2f: 'Cada dossiê mostra seu custo exato em créditos antes de confirmar — um comprehensive custa mais que um essential.',
    q3: 'Quando meu dossiê fica pronto?', a3: 'Os dossiês são gerados em cerca de 2–8 minutos e aparecem no seu painel — abra um para lê-lo completo.',
  },
};

export function Credits() {
  const { lang } = useLang();
  const t = pick(T, lang);
  const balance = useBalance();
  const plansQ = usePlans(lang);
  const templates = useTemplates(lang);
  const checkout = useCheckout();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const plans = plansQ.data?.plans ?? [];
  const bal = balance.data?.balance;

  // Credit cost per mode — read from the manifest (dynamic), for the honest FAQ.
  const modes = templates.data?.templates?.[0]?.modes ?? [];
  const essential = modes.find((m) => m.key === 'essential')?.credits;
  const comprehensive = modes.find((m) => m.key === 'comprehensive')?.credits;
  const a2 = essential != null && comprehensive != null
    ? t.a2.replace('{e}', String(essential)).replace('{c}', String(comprehensive))
    : t.a2f;

  const perCredit = (p: { priceUsd: number; credits: number }) => (p.credits > 0 ? p.priceUsd / p.credits : Infinity);
  const bestId = plans.length ? plans.reduce((a, b) => (perCredit(b) < perCredit(a) ? b : a)).planId : null;

  async function buy(planId: string) {
    setError(null);
    setBusyId(planId);
    // If the user came here mid-report (a saved draft exists), send them back to
    // the new-report page after paying/cancelling — their inputs are restored there.
    const back = localStorage.getItem(DRAFT_KEY) ? '/app/new' : '/app/credits';
    const url = `${window.location.origin}${back}`;
    try {
      const res = await checkout.mutateAsync({ planId, successUrl: `${url}?ok=1`, cancelUrl: url });
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checkout failed.');
      setBusyId(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 30 }}>
      <div className="tu-hero">
        <div className="tu-herotop">
          <div style={{ maxWidth: 560 }}>
            <span className="eyebrow" style={{ color: 'var(--accent)' }}>{t.eyebrow}</span>
            <h1 className="tu-title">{t.title}</h1>
            <p className="soft" style={{ fontSize: 14.5, marginTop: 12, lineHeight: 1.55 }}>{t.sub}</p>
          </div>
          <div className="tu-bal">
            <div className="mono muted" style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase' }}>{t.currentBalance}</div>
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>{bal ?? '…'}</span>{' '}
              <span className="soft" style={{ fontSize: 13 }}>{t.creditsAvailable}</span>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="mono" style={{ fontSize: 12.5, color: 'var(--risk)' }}>{error}</div>}
      {plansQ.data && plans.length === 0 && <p className="muted">{t.none}</p>}

      <div className="topups">
        {plans.map((p) => {
          const tag = p.popular ? t.popular : p.planId === bestId ? t.bestValue : null;
          const per = p.credits > 0 ? (p.priceUsd / p.credits).toFixed(2) : null;
          return (
            <div key={p.planId} className={`topup ${p.popular ? 'hl' : ''}`}>
              {tag && <span className="topup__tag">{tag}</span>}
              <div className="topup__cr">{p.credits}</div>
              <div className="topup__crlbl">{t.creditsLbl}</div>
              <hr className="divider" style={{ margin: '18px 0' }} />
              <div className="topup__price">${p.priceUsd.toLocaleString(lang)}</div>
              {per && <div className="topup__per">${per} {t.perCredit}</div>}
              <div className="topup__note">{t.oneTime}</div>
              <button className="btn btn--black btn--block" style={{ marginTop: 'auto' }} disabled={busyId === p.planId} onClick={() => buy(p.planId)}>{t.buy}</button>
            </div>
          );
        })}
      </div>

      <div className="tu-faq">
        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 18 }}>{t.faq}</h2>
        <div className="tu-faqgrid">
          <div><div className="tu-q">{t.q1}</div><p className="soft" style={{ fontSize: 14 }}>{t.a1}</p></div>
          <div><div className="tu-q">{t.q2}</div><p className="soft" style={{ fontSize: 14 }}>{a2}</p></div>
          <div><div className="tu-q">{t.q3}</div><p className="soft" style={{ fontSize: 14 }}>{t.a3}</p></div>
        </div>
      </div>

      <div style={{ textAlign: 'center', paddingTop: 4 }}>
        <Link className="btn btn--outline" to="/app">{t.back}</Link>
      </div>
    </div>
  );
}
