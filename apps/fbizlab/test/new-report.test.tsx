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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// The network seam. Everything below it is mocked; the component above it is real.
const { hooks } = vi.hoisted(() => ({
  hooks: {
    createJob: vi.fn(async () => ({ jobId: 'j1' })),
    // The real endpoint always returns these; a fixture that omits them tests a
    // response the API never sends, and blew up the render instead of the code.
    preflight: vi.fn(async () => ({
      ok: true, summary: 'We will research X.', quality: 'ok',
      issues: [], corrections: [], assist: { state: 'on' },
    })),
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
  // FIELD NAMES THIS CLIENT HAS NEVER SEEN. The fixture used to say `industry`,
  // `location` and `instructions` — Florida's — while the file's own header
  // claimed "if anything passes because the component knows the Florida model, the
  // fixture would have to know it too". It did. The form hardcoded those fields as
  // JSX, so this test could not see it.
  paramsSchema: {
    type: 'object',
    properties: {
      gridRegion: { type: 'string', maxLength: 120 },
      parcelUse: { type: 'string', maxLength: 200, default: 'Somewhere' },
      capacityMwMin: { type: 'number' },
      interconnectQueueOnly: { type: 'boolean' },
      soilNotes: { type: 'string', maxLength: 2000 },
      directives: { type: 'object' },
      // Deliberately NOT English: the UI runs in English in these tests, so this is
      // what proves the form consults the model's own set instead of assuming the
      // reader's language is on it.
      language: { type: 'string', enum: ['es', 'pt'], default: 'es' },
      mode: { type: 'string', enum: ['essential', 'comprehensive'] },
    },
  },
  instructionsField: 'soilNotes',
  paramsUi: {
    hidden: ['directives'],
    rows: [['gridRegion', 'parcelUse'], ['capacityMwMin']],
    fields: {
      gridRegion: { label: 'Grid region', placeholder: 'e.g. ERCOT West', suggestions: ['ERCOT West', 'MISO South'] },
      parcelUse: { label: 'Parcel use' },
      capacityMwMin: { label: 'Capacity MW (min)' },
      interconnectQueueOnly: { label: 'In the interconnect queue only' },
      soilNotes: { label: 'Soil notes' },
    },
  },
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
import { ApiError } from '../src/api/client';
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
/**
 * The params as sent to PREFLIGHT — the validation step, not the order.
 *
 * Named for what it is: it stops one step short of `createJob`, so a test using it
 * cannot say anything about what was submitted. `orderedParams` below goes the rest
 * of the way.
 */
async function previewedParams(): Promise<Record<string, unknown>> {
  // The fictional model's own first field, by the label the MANIFEST gave it.
  await userEvent.type(screen.getByPlaceholderText('e.g. ERCOT West'), 'ERCOT West');
  await userEvent.click(screen.getAllByRole('button', { name: /generate dossier/i })[0]!);
  await userEvent.click(await screen.findByRole('button', { name: /validate & continue/i }));
  const call = hooks.preflight.mock.calls.at(-1)?.[0] as { params: Record<string, unknown> };
  return call.params;
}

/** The params the job is actually CREATED with — past the confirm step. */
async function orderedParams(): Promise<Record<string, unknown>> {
  await previewedParams();
  // The confirm modal reuses the same CTA label as the page, so take the last one —
  // the modal renders after the form.
  const ctas = await screen.findAllByRole('button', { name: /generate dossier/i });
  await userEvent.click(ctas.at(-1)!);
  const call = hooks.createJob.mock.calls.at(-1)?.[0] as { params: Record<string, unknown> };
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

  it('previews the picks under the key the manifest named', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Sunshine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Red' }));

    expect(await previewedParams()).toMatchObject({ directives: { weather: 'sun', colours: ['red'] } });
  });

  it('ORDERS them under that key too, which is the step that spends credits', async () => {
    // The previous version of this asserted on the preflight payload and was named
    // for the submit — `createJob` was mocked and never looked at, so the params
    // could have been dropped between validating and ordering and nothing would
    // have said so.
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Sunshine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Red' }));

    expect(await orderedParams()).toMatchObject({ directives: { weather: 'sun', colours: ['red'] } });
  });

  it('clears a single-choice field when its option is clicked again', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Sunshine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sunshine' }));

    // Every directive is optional, so "un-choosing" has to be reachable.
    const params = await previewedParams();
    expect(params.directives).toBeUndefined();
  });

  it('sends no directives key at all when the buyer touched nothing', async () => {
    renderForm();
    const params = await previewedParams();

    // An untouched set is ABSENT, not `{}`: it keeps the request identical to never
    // having opened the section, which is what the preflight cache is keyed on.
    expect(params).not.toHaveProperty('directives');
  });
});

describe('the form is the model’s, not one model’s', () => {
  it('renders the fields this manifest declares, by the labels it gave them', async () => {
    // The form used to hardcode Florida's six fields as JSX and look their labels
    // up in a four-language map keyed by Florida's names. A second catalog model
    // therefore drew the WRONG form: `industry` and `location` inputs bound to
    // params it does not have, and none of its own fields anywhere.
    renderForm();
    for (const label of ['Grid region', 'Parcel use', 'Capacity MW (min)', 'In the interconnect queue only']) {
      // `findAllBy`: a boolean field appears twice on purpose — once as its input,
      // once in the running summary — and both are now the manifest's label.
      expect((await screen.findAllByText(label)).length, label).toBeGreaterThan(0);
    }
    // …and nothing from the model this client happens to ship with.
    for (const florida of [/^Industry$/, /^Location$/, /^SBA-friendly$/, /^Include real estate$/]) {
      expect(screen.queryByText(florida), String(florida)).toBeNull();
    }
  });

  it('never submits a language the model cannot write in', async () => {
    // The visitor's UI is English; this model writes only es/pt. `d.language = lang`
    // was unconditional and sat several lines ABOVE where the accepted set is read,
    // so the form submitted `en`, the API 400'd against `paramsSchema`, and the
    // preflight catch treated that as advisory and submitted a second time.
    //
    // Live for the flagship too: dropping a language from its own enum failed zero
    // tests before this.
    renderForm();
    const params = await previewedParams();
    expect(['es', 'pt'], `submitted ${String(params.language)}`).toContain(params.language);
  });

  it('offers the suggestion chips the manifest supplied', async () => {
    // Rendered but never localized: thirteen English chips under the first field
    // of a Spanish form, and clicking one submitted the English string as the
    // subject of the research.
    renderForm();
    expect(await screen.findByRole('button', { name: 'MISO South' })).toBeTruthy();
  });
});

describe('a rate-limited preview does not become an order', () => {
  // The catch had branches for 422, `captcha_failed` and 403, and a 429 fell
  // through to the `else`, which calls `submit()`. The person clicked "Validate &
  // continue" to SEE the review — summary, proposed corrections, findings — and
  // instead the job was created, their credits were spent, and they were
  // navigated to a job page they never asked to start.
  //
  // The comment justifying that fallback argues from a 5xx or a dropped
  // connection, where generating anyway is the kind thing. A 429 is neither: it
  // means "ask again in a moment", and the answer is to say so.
  const rateLimited = () => {
    hooks.preflight.mockRejectedValue(
      Object.assign(new ApiError(429, 'Too many requests.', { code: 'rate_limited' }), {}),
    );
  };

  it('spends nothing and says why', async () => {
    rateLimited();
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('e.g. ERCOT West'), 'ERCOT West');
    await userEvent.click(screen.getAllByRole('button', { name: /generate dossier/i })[0]!);
    await userEvent.click(await screen.findByRole('button', { name: /validate & continue/i }));

    expect(hooks.createJob, 'it created the job the user never confirmed').not.toHaveBeenCalled();
    expect(await screen.findByText(/nothing was charged/i)).toBeTruthy();
  });

  it('still generates anyway when the review itself breaks', async () => {
    // The control, and the behaviour that must NOT regress: the review is
    // advisory, so a 5xx or a dropped connection generates rather than blocking a
    // paying customer on a component that is only meant to help.
    hooks.preflight.mockRejectedValue(new ApiError(500, 'boom', {}));
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('e.g. ERCOT West'), 'ERCOT West');
    await userEvent.click(screen.getAllByRole('button', { name: /generate dossier/i })[0]!);
    await userEvent.click(await screen.findByRole('button', { name: /validate & continue/i }));

    await waitFor(() => expect(hooks.createJob).toHaveBeenCalled());
  });
});
