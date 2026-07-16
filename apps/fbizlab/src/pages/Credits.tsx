import { useState } from 'react';
import { pick, useLang } from '../i18n';
import { useBalance, useCheckout, usePlans } from '../api/hooks';
import { PlanCard } from '../components/PlanCard';
import { ApiError } from '../api/client';

const T = {
  en: { title: 'Credits', sub: 'Buy credits to generate market reports. Each report’s cost is shown when you launch it.', balance: 'Your balance', credits: 'credits', buy: 'Buy', none: 'No credit packs are available right now.', per: 'credits', popular: 'Most popular' },
  es: { title: 'Créditos', sub: 'Compra créditos para generar reportes de mercado. El costo de cada reporte se muestra al lanzarlo.', balance: 'Tu saldo', credits: 'créditos', buy: 'Comprar', none: 'No hay paquetes de créditos disponibles ahora.', per: 'créditos', popular: 'Más popular' },
  fr: { title: 'Crédits', sub: 'Achetez des crédits pour générer des rapports de marché. Le coût de chaque rapport s’affiche au lancement.', balance: 'Votre solde', credits: 'crédits', buy: 'Acheter', none: 'Aucun pack de crédits disponible pour le moment.', per: 'crédits', popular: 'Le plus populaire' },
  pt: { title: 'Créditos', sub: 'Compre créditos para gerar relatórios de mercado. O custo de cada relatório aparece ao lançá-lo.', balance: 'Seu saldo', credits: 'créditos', buy: 'Comprar', none: 'Nenhum pacote de créditos disponível agora.', per: 'créditos', popular: 'Mais popular' },
};

export function Credits() {
  const { lang } = useLang();
  const t = pick(T, lang);
  const balance = useBalance();
  const plans = usePlans(lang);
  const checkout = useCheckout();
  const [error, setError] = useState<string | null>(null);

  async function buy(planId: string) {
    setError(null);
    const url = `${window.location.origin}/app/credits`;
    try {
      const res = await checkout.mutateAsync({ planId, successUrl: `${url}?ok=1`, cancelUrl: url });
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checkout failed.');
    }
  }

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 900 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">{t.title}</span>
        <p className="soft" style={{ fontSize: 14 }}>{t.sub}</p>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <div className="kv"><div className="k">{t.balance}</div><div className="v coral" style={{ fontSize: 30 }}>{balance.data?.balance ?? '…'}<span className="mono muted" style={{ fontSize: 13, marginLeft: 8 }}>{t.credits}</span></div></div>
      </div>

      {error && <div className="mono risk" style={{ fontSize: 12.5 }}>{error}</div>}

      {plans.data && plans.data.plans.length === 0 && <p className="muted">{t.none}</p>}
      <div className="plans">
        {(plans.data?.plans ?? []).map((p) => (
          <PlanCard
            key={p.planId}
            plan={p}
            lang={lang}
            creditsWord={t.per}
            popularLabel={t.popular}
            buttonLabel={t.buy}
            busy={checkout.isPending}
            onSelect={() => buy(p.planId)}
          />
        ))}
      </div>
    </div>
  );
}
