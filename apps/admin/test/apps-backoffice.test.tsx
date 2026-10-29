/**
 * The backoffice is not a client app: it sells nothing and runs no jobs of its
 * own, so the client-app limits (rate/h, allowed models) are not shown or sent
 * for it — and "who may sign in" is the one setting it does have.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ path: string; init?: { method?: string; body?: unknown } }> }));

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (path.startsWith('/templates')) return Promise.resolve({ templates: [{ id: 'florida-business-for-sale', name: 'Florida' }] });
    if (path === '/admin/apps') {
      return Promise.resolve({ apps: [
        { appId: 'admin', name: 'Backoffice', role: 'admin', active: true, rateLimitPerHour: 7, allowedTemplates: ['x'], adminEmails: ['boss@x.com'], apiKeyPreview: 'ar_…1' },
        { appId: 'fbizlab', name: 'Florida', role: 'app', active: true, rateLimitPerHour: 50, allowedTemplates: ['florida-business-for-sale'], apiKeyPreview: 'ar_…2' },
      ] });
    }
    return Promise.resolve({ app: {} });
  },
}));
vi.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ user: { appId: 'admin', role: 'admin' } }) }));

import { Apps } from '../src/pages/Apps';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider client={qc}><Apps /></QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

const rowOf = async (appId: string) => (await screen.findByText(appId)).closest('tr') as HTMLElement;

beforeEach(() => { calls.length = 0; });

describe('the backoffice in Apps', () => {
  it('shows no limits on its row, while a client app does', async () => {
    show();
    const admin = await rowOf('Backoffice');
    expect(admin.textContent).not.toContain('7');
    expect(within(admin).queryByText('x')).toBeNull();
    const app = await rowOf('Florida');
    expect(app.textContent).toContain('50');
    expect(within(app).getByText('florida-business-for-sale')).toBeTruthy();
  });

  it('its edit form offers who may sign in, not client limits — and sends only that', async () => {
    show();
    await userEvent.click(within(await rowOf('Backoffice')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/rate limit/i)).toBeNull();
    expect(within(dialog).queryByText('Allowed models')).toBeNull();
    expect(within(dialog).getByText('Admin emails')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true));
    const body = calls.find((c) => c.init?.method === 'PATCH')!.init!.body as Record<string, unknown>;
    expect(body).toMatchObject({ adminEmails: ['boss@x.com'] });
    expect(body).not.toHaveProperty('rateLimitPerHour');
    expect(body).not.toHaveProperty('allowedTemplates');
  });

  it('a client app’s form keeps its limits and has no admin emails', async () => {
    show();
    await userEvent.click(within(await rowOf('Florida')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/rate limit/i)).toBeTruthy();
    expect(within(dialog).queryByText('Admin emails')).toBeNull();
  });
});
