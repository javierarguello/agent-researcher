/**
 * The screen that changes what a customer is charged.
 *
 * The guard is the SERVER's — a price change is refused without `expectedPriceUsd`,
 * the amount the editor was shown — so what this screen owes is that an admin never
 * meets that refusal by accident, and never sends the confirmation for an edit that
 * is not a reprice. Both halves are asserted: a confirm that appears when it should
 * not is how confirms get clicked through without reading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ path: string; init?: { method?: string; body?: Record<string, unknown> } }> }));

const PACKS = [
  { planId: 'scout', templateId: 'm1', name: 'Scout', priceUsd: 29, credits: 20, priceId: 'p1' },
  { planId: 'investor', templateId: 'm1', name: 'Investor', priceUsd: 69, credits: 80, priceId: 'p2', popular: true },
  // No `templateId`: a pack from before packs were per-model. It sells for every
  // model the app offers, which is not visible from its price alone.
  { planId: 'legacy', name: 'Legacy', priceUsd: 9, credits: 5, priceId: 'p3' },
];

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    calls.push({ path, init });
    if (path.startsWith('/admin/plans?')) return Promise.resolve({ plans: PACKS });
    return Promise.resolve({ plan: PACKS[0], priceChanged: false, previousPriceUsd: null });
  },
}));

import { CreditPacks } from '../src/components/CreditPacks';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}><CreditPacks appId="fbizlab" templateId="m1" /></QueryClientProvider>
    </MantineProvider>,
  );
}

const saved = () => calls.find((c) => c.init?.method === 'PUT');

beforeEach(() => { calls.length = 0; });

describe('the credit packs table', () => {
  it('marks the cheapest credit as the floor — the number every ceiling derives from', async () => {
    show();
    // $9/5 = $1.80, $29/20 = $1.45, $69/80 = $0.86. The floor is the last, and it
    // is NOT the cheapest pack to buy — which is exactly why it is worth marking.
    // Asserted on the ROW, not on the page: "one badge exists" passes just as well
    // when it is on the wrong pack, which is what a `min(priceUsd)` mistake looks
    // like — and the cheapest PACK here is `legacy`, at the DEAREST credit.
    const row = (planId: string) => screen.getByText(planId).closest('tr')!;
    await waitFor(() => expect(row('investor')).toBeTruthy());
    expect(row('investor').textContent).toContain('$0.86');
    expect(row('investor').textContent).toContain('floor');
    expect(row('legacy').textContent, 'the cheapest pack is not the cheapest credit').not.toContain('floor');
    expect(row('scout').textContent).not.toContain('floor');
  });

  it('says which pack sells for every model', async () => {
    show();
    expect(await screen.findByText('all models')).toBeTruthy();
  });
});

describe('editing a pack', () => {
  it('saves a non-price change with no confirmation and no expectedPriceUsd', async () => {
    // Sending the confirmation on every save would make the server treat each one
    // as a reprice, and the dialog would stop meaning anything.
    show();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Scout pack');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saved()).toBeTruthy());
    expect(screen.queryByText(/change what customers are charged/i)).toBeNull();
    expect(saved()!.init!.body).toMatchObject({ name: 'Scout pack', appId: 'fbizlab', templateId: 'm1' });
    expect('expectedPriceUsd' in saved()!.init!.body!).toBe(false);
  });

  it('asks before a price change, naming both figures, and sends nothing until then', async () => {
    show();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    const price = await screen.findByLabelText('Price (USD)');
    await userEvent.clear(price);
    await userEvent.type(price, '39');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Nothing written yet — the dialog is not a notification after the fact.
    expect(saved()).toBeUndefined();
    expect(await screen.findByText(/change what customers are charged/i)).toBeTruthy();
    // Both figures, per pack AND per credit: "are you sure?" without them is the
    // dialog everyone clicks through.
    // The SENTENCE, not the dialog: `$29.00` also appears on the "Keep $29.00"
    // button, so asserting on the dialog as a whole passed with the old figure
    // dropped from the prose entirely.
    const sentence = screen.getByText(/goes from/i);
    expect(sentence.textContent).toContain('$29.00');
    expect(sentence.textContent).toContain('$39.00');
    // …and per credit, which is the number that actually decides anything.
    expect(sentence.textContent).toContain('$1.45');
    expect(sentence.textContent).toContain('$1.95');

    await userEvent.click(screen.getByRole('button', { name: /change the price/i }));
    await waitFor(() => expect(saved()).toBeTruthy());
    // The confirmation carries what the editor was SHOWN, which is what lets the
    // server refuse a screen that went stale.
    expect(saved()!.init!.body).toMatchObject({ priceUsd: 39, expectedPriceUsd: 29 });
  });

  it('writes nothing when the price change is declined', async () => {
    show();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    const price = await screen.findByLabelText('Price (USD)');
    await userEvent.clear(price);
    await userEvent.type(price, '39');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/change what customers are charged/i);
    await userEvent.click(screen.getByRole('button', { name: /keep \$29\.00/i }));
    expect(saved()).toBeUndefined();
  });
});
