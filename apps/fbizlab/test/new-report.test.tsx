/**
 * The form the customer fills in, against a manifest the API supplied.
 *
 * The whole design of the directives feature is that this client knows NOTHING
 * about them: no field names, no option labels, no translations, no ordering. It
 * renders what the manifest hands it and submits under the key the manifest names.
 * That property is invisible to `tsc` — a component that hardcoded "Reason for
 * sale" would compile and pass a build, and would then quietly ignore the next
 * field a model declares.
 *
 * So these tests drive the real component with a FICTIONAL model. If anything here
 * passes because the component happens to know the Florida model, the fixture
 * would have to know it too — and it does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// The network seam. Everything below it is mocked; the component above it is real.
const { hooks } = vi.hoisted(() => ({
  hooks: {
    createJob: vi.fn(async () => ({ jobId: 'j1' })),
    preflight: vi.fn(async () => ({ ok: true, summary: 'We will research X.', findings: [] })),
  },
}));

/** A model this client has never heard of, in a language it does not speak. */
const MANIFEST = {
  id: 'imaginary-model',
  name: 'Imaginary model',
  description: 'Something the client has never seen.',
  version: 1,
  lang: 'en',
  sections: [],
  paramsSchema: {
    type: 'object',
    properties: {
      industry: { type: 'string', maxLength: 120 },
      location: { type: 'string', maxLength: 200, default: 'Somewhere' },
      instructions: { type: 'string', maxLength: 2000 },
      directives: { type: 'object' },
      language: { type: 'string', enum: ['en', 'es'] },
      mode: { type: 'string', enum: ['essential', 'comprehensive'] },
    },
  },
  paramsUi: { hidden: ['directives'], fields: { industry: { placeholder: 'e.g. Laundromats' } } },
  directives: [
    {
      key: 'weather',
      kind: 'single' as const,
      label: 'Preferred weather',
      description: 'Nothing to do with business.',
      options: [
        { value: 'sun', label: 'Sunshine' },
        { value: 'rain', label: 'Rain' },
      ],
    },
    {
      key: 'colours',
      kind: 'multi' as const,
      maxSelected: 2,
      label: 'Favourite colours',
      options: [
        { value: 'red', label: 'Red' },
        { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' },
      ],
    },
  ],
  directivesKey: 'directives',
  modes: [
    { key: 'essential', label: 'Essential', credits: 5 },
    { key: 'comprehensive', label: 'Comprehensive', credits: 18 },
  ],
  addons: [],
  steps: [],
  reportSchema: {},
};

vi.mock('../src/api/hooks', () => ({
  useTemplates: () => ({ data: { templates: [MANIFEST] }, isLoading: false }),
  useTemplate: () => ({ data: MANIFEST }),
  useBalance: () => ({ data: { balance: 100 } }),
  useMyStats: () => ({ data: { inProgress: 0, blocked: false, total: 0, ready: 0, failed: 0 } }),
  useCreateJob: () => ({ mutateAsync: hooks.createJob, isPending: false }),
  usePreflight: () => ({ mutateAsync: hooks.preflight, isPending: false }),
}));
vi.mock('../src/auth/captcha', () => ({ captchaConfigured: () => false }));
vi.mock('../src/components/Turnstile', () => ({ Turnstile: () => null }));

import { NewReport } from '../src/pages/NewReport';
import { LangProvider } from '../src/i18n';

function renderForm() {
  return render(
    <MemoryRouter initialEntries={['/app/new']}>
      <LangProvider>
        <NewReport />
      </LangProvider>
    </MemoryRouter>,
  );
}

/**
 * Walk the real submit flow — fill the one required field, open the confirm
 * dialog, ask for the preview — and read the params the component actually sent.
 */
async function submittedParams(): Promise<Record<string, unknown>> {
  await userEvent.type(screen.getByPlaceholderText('e.g. Laundromats'), 'Laundromats');
  await userEvent.click(screen.getAllByRole('button', { name: /generate dossier/i })[0]!);
  await userEvent.click(await screen.findByRole('button', { name: /validate & continue/i }));
  const call = hooks.preflight.mock.calls.at(-1)?.[0] as { params: Record<string, unknown> };
  return call.params;
}

beforeEach(() => {
  hooks.createJob.mockClear();
  hooks.preflight.mockClear();
  localStorage.clear();
});

describe('the directive block comes entirely from the manifest', () => {
  it('renders fields, help text and options the client has never heard of', () => {
    renderForm();

    expect(screen.getByText('Preferred weather')).toBeTruthy();
    expect(screen.getByText('Nothing to do with business.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sunshine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rain' })).toBeTruthy();
    expect(screen.getByText('Favourite colours')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Blue' })).toBeTruthy();
  });

  it('shows the cap the model declared, and stops at it', async () => {
    renderForm();
    expect(screen.getByText(/\(pick up to 2\)/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Red' }));
    await userEvent.click(screen.getByRole('button', { name: 'Green' }));

    // At the cap, an unpicked option is DISABLED rather than silently ignored — a
    // click that does nothing reads as a broken form.
    expect(screen.getByRole('button', { name: 'Blue' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Red' }).hasAttribute('disabled')).toBe(false);
  });

  it('submits the picks under the key the manifest named', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Sunshine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Red' }));

    expect(await submittedParams()).toMatchObject({ directives: { weather: 'sun', colours: ['red'] } });
  });

  it('clears a single-choice field when its option is clicked again', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Sunshine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sunshine' }));

    // Every directive is optional, so "un-choosing" has to be reachable.
    const params = await submittedParams();
    expect(params.directives).toBeUndefined();
  });

  it('sends no directives key at all when the buyer touched nothing', async () => {
    renderForm();
    const params = await submittedParams();

    // An untouched set is ABSENT, not `{}`: it keeps the request identical to never
    // having opened the section, which is what the preflight cache is keyed on.
    expect(params).not.toHaveProperty('directives');
  });
});
