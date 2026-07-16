import { useState } from 'react';
import type { ModeInfo, ParamsUi } from '../api/types';

export interface JsonProp {
  type?: string; enum?: string[]; default?: unknown; items?: { type?: string; maxLength?: number };
  minimum?: number; maximum?: number; maxLength?: number; maxItems?: number; description?: string;
}
export interface JsonSchema { type?: string; properties?: Record<string, JsonProp>; required?: string[]; }

function humanize(key: string): string {
  const s = key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function defaultsFor(schema: JsonSchema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema?.properties ?? {})) if (p.default !== undefined) out[k] = p.default;
  return out;
}
function layout(schema: JsonSchema, ui: ParamsUi | undefined, omit: Set<string>): string[][] {
  const all = Object.keys(schema.properties ?? {});
  const rows = (ui?.rows ?? []).map((r) => r.filter((k) => !omit.has(k) && all.includes(k)));
  const placed = new Set(rows.flat());
  const rest = all.filter((k) => !placed.has(k) && !omit.has(k)).map((k) => [k]);
  return [...rows, ...rest].filter((r) => r.length > 0);
}

function Tags({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (t: string) => { const v = t.trim(); if (v && !value.includes(v)) onChange([...value, v]); setDraft(''); };
  return (
    <div className="card" style={{ padding: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {value.map((t) => (
        <span key={t} className="badge" style={{ cursor: 'pointer' }} onClick={() => onChange(value.filter((x) => x !== t))}>{t} ✕</span>
      ))}
      <input list="sugg" value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); } }}
        style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, minWidth: 100, fontSize: 14 }} placeholder="+" />
      {suggestions && <datalist id="sugg">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

export function JsonSchemaForm({ schema, ui, modes, value, onChange }: {
  schema: JsonSchema; ui?: ParamsUi; modes?: ModeInfo[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const rangeKeys = new Set((ui?.ranges ?? []).flatMap((r) => [r.minKey, r.maxKey]));
  const advanced = (ui?.advanced ?? []).filter((k) => schema.properties?.[k]);
  const omit = new Set([...(ui?.hidden ?? []), ...advanced]);
  const credWord = (n: number) => `${n} cr`;

  function control(key: string) {
    const prop = schema.properties?.[key];
    if (!prop) return null;
    const f = ui?.fields?.[key];
    const label = humanize(key);
    const help = f?.help ?? prop.description;
    const req = (schema.required ?? []).includes(key) && prop.default === undefined;
    const inp = (extra: React.ReactNode) => (
      <div className="field" key={key} style={{ flex: 1 }}>
        <label>{label}{req ? ' *' : ''}</label>
        {extra}
        {help && <div className="desc">{help}</div>}
      </div>
    );
    if (prop.enum || f?.widget === 'select') {
      const isMode = modes && prop.enum && prop.enum.every((v) => modes.some((m) => m.key === v));
      return inp(
        <select className="select" value={(value[key] as string) ?? ''} onChange={(e) => set(key, e.target.value)}>
          <option value="" disabled>—</option>
          {isMode
            ? modes!.map((m) => <option key={m.key} value={m.key}>{m.label} · {credWord(m.credits)}</option>)
            : (prop.enum ?? f?.suggestions ?? []).map((v) => <option key={v} value={v}>{f?.optionLabels?.[v] ?? v}</option>)}
        </select>,
      );
    }
    if (prop.type === 'boolean') {
      return (
        <div className="field" key={key} style={{ flex: 1 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--ink)' }}>
            <input type="checkbox" checked={Boolean(value[key])} onChange={(e) => set(key, e.target.checked)} />{label}
          </label>
          {help && <div className="desc">{help}</div>}
        </div>
      );
    }
    if (prop.type === 'integer' || prop.type === 'number') {
      return inp(<input className="input" type="number" min={prop.minimum ?? 0} max={prop.maximum} value={(value[key] as number) ?? ''} onChange={(e) => set(key, e.target.value === '' ? undefined : Number(e.target.value))} placeholder={f?.placeholder} />);
    }
    if (prop.type === 'array') {
      return inp(<Tags value={(value[key] as string[]) ?? []} onChange={(v) => set(key, v)} suggestions={f?.suggestions} />);
    }
    if (f?.widget === 'textarea' || key.toLowerCase().includes('instruction')) {
      return inp(<textarea className="textarea" maxLength={prop.maxLength} value={(value[key] as string) ?? ''} onChange={(e) => set(key, e.target.value)} placeholder={f?.placeholder} />);
    }
    const list = f?.suggestions?.length ? `dl-${key}` : undefined;
    return inp(
      <>
        <input className="input" list={list} maxLength={prop.maxLength} value={(value[key] as string) ?? ''} onChange={(e) => set(key, e.target.value)} placeholder={f?.placeholder} />
        {list && <datalist id={list}>{f!.suggestions!.map((s) => <option key={s} value={s} />)}</datalist>}
      </>,
    );
  }

  function rangeRow(key: string) {
    const r = (ui?.ranges ?? []).find((x) => x.minKey === key || x.maxKey === key);
    if (!r || r.minKey !== key) return null; // render once, at minKey
    const numInput = (k: string, ph: string) => (
      <div className="field" style={{ flex: 1 }}>
        <label>{ph}</label>
        <input className="input" type="number" min={r.min} max={r.max} value={(value[k] as number) ?? ''} onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))} placeholder={`${r.prefix ?? ''}${r.min}`} />
      </div>
    );
    return (
      <div key={key} style={{ flex: 1 }}>
        <label className="field" style={{ marginBottom: 6, display: 'block' }}>{r.label}</label>
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>{numInput(r.minKey, 'Min')}{numInput(r.maxKey, 'Max')}</div>
      </div>
    );
  }

  const rows = layout(schema, ui, omit);
  const renderRow = (row: string[], i: number) => {
    const r = (ui?.ranges ?? []).find((rg) => row.includes(rg.minKey) && row.includes(rg.maxKey));
    if (r) return <div key={i}>{rangeRow(r.minKey)}</div>;
    const keys = row.filter((k) => !rangeKeys.has(k));
    if (!keys.length) return null;
    return <div key={i} className="row" style={{ gap: 16, alignItems: 'flex-start' }}>{keys.map((k) => control(k))}</div>;
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      {rows.map(renderRow)}
      {advanced.length > 0 && (
        <details>
          <summary className="mono muted" style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>Advanced</summary>
          <div className="stack" style={{ gap: 16, marginTop: 14 }}>{advanced.map((k) => control(k))}</div>
        </details>
      )}
    </div>
  );
}
