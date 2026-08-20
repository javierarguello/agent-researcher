/**
 * The screen where a price is changed has to show what the change DID.
 *
 * A job's cost ceiling is no longer a number anyone types: it is
 * `credits × creditFloorUsd × (1 − expectedProfitPct/100)`, per model. That is a
 * good property and a bad user experience if the derivation is invisible — an admin
 * raising a tier from 8 to 30 credits has tripled what a job of that tier may burn
 * and would have no way to know.
 *
 * So the ceilings are rendered, and rendered from the API's own figures rather than
 * recomputed here: the API returns what the ENGINE enforces, `MAX_JOB_COST_USD`
 * clamp included, and a second copy of the formula in the admin would be one that
 * can quietly disagree with the one that bills.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';

const { state, calls } = vi.hoisted(() => ({
  state: { economics: undefined as Record<string, unknown> | undefined },
  calls: [] as Array<{ path: string; init?: { method?: string; body?: unknown } }>,
}));

const ECONOMICS = {
  creditFloorUsd: 0.806,
  creditFloorSource: 'stored',
  expectedProfitPct: 40,
  maxJobCostUsd: 20,
  ceilings: [
    { key: 'essential', credits: 8, earnsUsd: 6.448, ceilingUsd: 3.8688, budgetScale: 0.5, depth: 'light', sections: 12, agents: 10, researchers: 8, maxTurns: 40 },
    { key: 'comprehensive', credits: 18, earnsUsd: 14.508, ceilingUsd: 8.7048, budgetScale: 1, depth: 'standard', sections: 17, agents: 15, researchers: 10, maxTurns: 92 },
  ],
};

const PRICING = () => ({
  templateId: 'florida-business-for-sale',
  modes: [
    { key: 'essential', defaultCredits: 8, credits: 8 },
    { key: 'comprehensive', defaultCredits: 18, credits: 18 },
  ],
  addons: [],
  updatedAt: null,
  economics: state.economics ?? ECONOMICS,
});

/** What the API answers a PREVIEW with — a different figure, so it is visible. */
const PREVIEWED = {
  ...ECONOMICS,
  expectedProfitPct: 10,
  ceilings: [
    { key: 'essential', credits: 8, earnsUsd: 6.448, ceilingUsd: 5.8032, budgetScale: 0.5, depth: 'light', sections: 12, agents: 10, researchers: 8, maxTurns: 40 },
    { key: 'comprehensive', credits: 18, earnsUsd: 14.508, ceilingUsd: 13.0572, budgetScale: 1, depth: 'standard', sections: 17, agents: 15, researchers: 10, maxTurns: 92 },
  ],
};

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (path.includes('/preview')) return Promise.resolve({ ...PRICING(), economics: PREVIEWED });
    if (path.startsWith('/templates')) return Promise.resolve({ templates: [{ id: 'florida-business-for-sale', name: 'Florida' }] });
    if (path.startsWith('/admin/apps')) return Promise.resolve({ apps: [{ appId: 'fbizlab', name: 'F' }] });
    if (path.includes('/credit-floor')) {
      return Promise.resolve({
        creditFloorUsd: 0.75,
        applied: true,
        before: 0.806,
        packs: [
          { planId: 'scout', priceUsd: 29, credits: 20, perCredit: 1.45 },
          { planId: 'syndicate', priceUsd: 120, credits: 160, perCredit: 0.75 },
        ],
        pricing: PRICING(),
      });
    }
    return Promise.resolve(PRICING());
  },
}));

import { Pricing } from '../src/pages/Pricing';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider client={qc}><Pricing /></QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => { state.economics = undefined; calls.length = 0; });

describe('the economics section', () => {
  it('shows both inputs and the ceilings they produce', async () => {
    show();
    // `toHaveValue` is jest-dom and this suite does not install it; read the DOM.
    expect((await screen.findByLabelText(/credit floor/i) as HTMLInputElement).value).toBe('0.806');
    expect((screen.getByLabelText(/expected profit/i) as HTMLInputElement).value).toBe('40');
    // The derived figures, per tier, in dollars — the thing an admin cannot work
    // out from the two inputs at a glance.
    expect(screen.getByText('$3.87')).toBeTruthy();
    expect(screen.getByText('$8.70')).toBeTruthy();
    // …beside what that tier earns, because the ceiling is only meaningful next to it.
    expect(screen.getByText('$6.45')).toBeTruthy();  // 8 × 0.806
    expect(screen.getByText('$14.51')).toBeTruthy(); // 18 × 0.806
    // …and what the money BUYS, which is the half that was invisible: an admin
    // pricing a tier had no way to know it is 40 turns or 92.
    const tiers = screen.getByTestId('tiers');
    expect(tiers.textContent).toContain('40');
    expect(tiers.textContent).toContain('92');
    expect(tiers.textContent).toContain('8 researching / 10 agents');
    expect(tiers.textContent).toContain('12 sections');
  });

  it('marks a ceiling the deployment lever capped, rather than showing it as chosen', async () => {
    // Above a certain price the per-model number stops being the one in force and
    // `MAX_JOB_COST_USD` is. Rendered as $20 with nothing said, that reads as a
    // figure someone picked.
    state.economics = { ...ECONOMICS, ceilings: [{ ...ECONOMICS.ceilings[1]!, ceilingUsd: 20 }] };
    show();
    expect(await screen.findByText('capped')).toBeTruthy();
  });

  it('reads the floor off Stripe on demand, and never on its own', async () => {
    // A tool, not a side effect: the stored figure is what every ceiling derives
    // from, so it moves when a person asks. Nothing should have called it on render.
    show();
    await screen.findByLabelText(/credit floor/i);
    expect(calls.some((c) => c.path.includes('/credit-floor'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: /read from stripe/i }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('/credit-floor'))).toBe(true));
    const call = calls.find((c) => c.path.includes('/credit-floor'))!;
    expect(call.init?.method).toBe('POST');
    expect(call.init?.body).toMatchObject({ appId: 'fbizlab', apply: true });
    // …and the field takes the value it came back with, so a save does not write
    // the stale one back over it.
    await waitFor(() => expect((screen.getByLabelText(/credit floor/i) as HTMLInputElement).value).toBe('0.75'));
  });

  it('sends both economics fields when saving, not just the credits', async () => {
    // They are the same PUT as the tier prices. Left out, an admin editing the
    // margin would watch it silently revert.
    show();
    await screen.findByLabelText(/expected profit/i);
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === 'PUT');
      expect(put?.init?.body).toMatchObject({ creditFloorUsd: 0.806, expectedProfitPct: 40 });
    });
  });
});

describe('the live preview', () => {
  it('recomputes the tiers on the SERVER while the inputs change, and says the figures are unsaved', async () => {
    // Without it, every number in the table describes the SAVED pricing while the
    // inputs above show something else — the shape of screen where someone changes
    // a price, reads a ceiling that has not moved, and concludes it did not matter.
    //
    // On the server, because recomputing the formula in the browser would be a
    // second implementation of the one that bills.
    show();
    const profit = await screen.findByLabelText(/expected profit/i);
    expect(screen.getByTestId('tiers').textContent).toContain('$8.70');
    expect(screen.queryByText('unsaved')).toBeNull();

    await userEvent.clear(profit);
    await userEvent.type(profit, '10');

    await waitFor(() => expect(screen.getByTestId('tiers').textContent).toContain('$13.06'));
    expect(screen.getByText('unsaved'), 'a previewed figure must not read as stored').toBeTruthy();
    const call = calls.find((c) => c.path.includes('/preview'));
    expect(call?.init?.method).toBe('POST');
  });
});
