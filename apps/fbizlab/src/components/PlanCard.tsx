import type { CreditPlan } from '../api/types';

/**
 * The pricing card used on both the landing and the in-app Credits page, so the
 * design and copy stay identical. Data (name, sub, credits, features, popular)
 * comes straight from Stripe via the API; only the button action differs.
 */
export function PlanCard({
  plan,
  lang,
  creditsWord,
  popularLabel,
  buttonLabel,
  onSelect,
  busy,
}: {
  plan: CreditPlan;
  lang: string;
  creditsWord: string;
  popularLabel: string;
  buttonLabel: string;
  onSelect: () => void;
  busy?: boolean;
}) {
  const p = plan;
  return (
    <div className={`card plan ${p.popular ? 'dark' : ''}`}>
      <div className="between">
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</div>
          {p.sub && <div className="mono muted" style={{ fontSize: 11 }}>{p.sub}</div>}
        </div>
        {p.popular && <span className="tag-popular">{popularLabel}</span>}
      </div>
      <div className="price">${p.priceUsd.toLocaleString(lang)}</div>
      {p.credits > 0 && (
        <div className="metric" style={{ marginTop: 14 }}>
          <div className="num">{p.credits}</div>
          <div className="lbl">{creditsWord}</div>
        </div>
      )}
      {p.features && p.features.length > 0 && (
        <>
          <hr className="divider" style={{ margin: '18px 0' }} />
          <div className="stack" style={{ gap: 9, flex: 1 }}>
            {p.features.map((f) => (
              <div key={f} className="bullet">{f}</div>
            ))}
          </div>
        </>
      )}
      <button
        className={`btn btn--block ${p.popular ? 'btn--accent' : 'btn--black'}`}
        style={{ marginTop: 22 }}
        onClick={onSelect}
        disabled={busy}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
