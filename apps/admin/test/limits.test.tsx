/**
 * The Limits screen: every spend limit editable, and what each edit SENDS.
 *
 * The API's rules are tested in api/test/spend-caps.test.ts. What only this screen
 * can get wrong is the wire: an emptied field has to go out as `null` (which
 * clears the cap) and not as 0 or be dropped — a dropped field leaves the old cap
 * in force while the screen shows it gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';

const { calls, state } = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; init?: { method?: string; body?: unknown } }>,
  state: { postmark: undefined as unknown },
}));

const SETTINGS = {
  appRateLimitPerHour: 100,
  userRateLimitPerHour: 20,
  globalMonthlySpendCapUsd: 200,
  globalMonthlySpendAlertUsd: 100,
  spendAlertEmails: [],
  jobsPaused: false,
  postmarkPlanUsd: 15,
  postmarkIncludedEmails: 10000,
  postmarkOveragePer1000Usd: 1.8,
  updatedAt: '',
};

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (path.startsWith('/admin/spend')) {
      return Promise.resolve({
        spend: { month: '2026-10', totalUsd: 123.45, apps: { fbizlab: 120 } },
        settings: SETTINGS,
        postmark: state.postmark ?? { sent: 412, bounced: 3, spamComplaints: 0, bounceRate: 0.73, estimatedUsd: 15 },
        apps: [
          { appId: 'fbizlab', name: 'Florida Biz Labs', spentUsd: 120, monthlySpendCapUsd: 150, monthlySpendAlertUsd: null, blocked: null },
          { appId: 'other', name: 'Other', spentUsd: 3.45, monthlySpendCapUsd: 3, monthlySpendAlertUsd: null, blocked: { scope: 'app', spentUsd: 3.45, capUsd: 3 } },
        ],
      });
    }
    return Promise.resolve({ settings: SETTINGS, app: {} });
  },
}));

import { Limits } from '../src/pages/Limits';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider client={qc}><Limits /></QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

const patches = (prefix: string) => calls.filter((c) => c.init?.method === 'PATCH' && c.path.startsWith(prefix));

beforeEach(() => {
  calls.length = 0;
  state.postmark = undefined;
});

describe('Limits', () => {
  it('shows the month against the cap, each app, and Postmark', async () => {
    show();
    expect((await screen.findByTestId('global-spent')).textContent).toBe('$123.45');
    expect(screen.getByText('of $200.00 this month')).toBeTruthy();
    expect(screen.getByText('App cap reached — $3.45 of $3.00')).toBeTruthy();
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('$15.00')).toBeTruthy();
  });

  it('clearing an app cap sends null, not 0 and not nothing', async () => {
    show();
    const input = (await screen.findByLabelText('Monthly cap for fbizlab')) as HTMLInputElement;
    await userEvent.clear(input);
    const row = input.closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches('/admin/apps/fbizlab')).toHaveLength(1));
    expect(patches('/admin/apps/fbizlab')[0]!.init!.body).toEqual({ monthlySpendCapUsd: null, monthlySpendAlertUsd: null });
  });

  it('pausing asks first, and only then sends jobsPaused', async () => {
    show();
    await userEvent.click(await screen.findByLabelText('Pause all jobs'));
    expect(patches('/admin/settings')).toHaveLength(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(patches('/admin/settings')).toHaveLength(1));
    expect(patches('/admin/settings')[0]!.init!.body).toEqual({ jobsPaused: true });
  });

  it('a global edit sends the cap, the alert and the recipients', async () => {
    show();
    const cap = (await screen.findByLabelText('Monthly cap (USD)')) as HTMLInputElement;
    await userEvent.clear(cap);
    await userEvent.type(cap, '350');
    const card = cap.closest('.mantine-Card-root') as HTMLElement;
    await userEvent.click(within(card).getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(patches('/admin/settings')).toHaveLength(1));
    expect(patches('/admin/settings')[0]!.init!.body).toEqual({ globalMonthlySpendCapUsd: 350, globalMonthlySpendAlertUsd: 100, spendAlertEmails: [] });
  });

  it('says why when Postmark cannot be read, and the page still works', async () => {
    state.postmark = { error: 'Postmark stats failed (503)' };
    show();
    expect(await screen.findByText('Could not read Postmark: Postmark stats failed (503)')).toBeTruthy();
    expect(screen.getByTestId('global-spent').textContent).toBe('$123.45');
  });
});
