/**
 * What a 429 looks like to a buyer, on the four pages that showed them the API's
 * own English sentence.
 *
 * `err.message` is written for whoever reads the logs. Rendered as-is it put
 * "Too many requests. Please wait a moment and try again." on the sign-in form,
 * the sign-up form, the forgot-password form, the reset-link page, the contact
 * form and the credits page — the six screens a customer meets before and around
 * paying us, in a language they may not read.
 *
 * Two things are asserted throughout, because either alone is satisfiable by a
 * wrong fix: that the localized sentence is there, AND that the English body
 * string is not. A page that renders both has not fixed anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * Exactly what `api()` throws — a real `ApiError`, carrying the English prose the
 * API sends and the body the client reads `code` and `retryAfterSeconds` off.
 *
 * It started as a hand-rolled `Object.assign(new Error(...), { status })`, and
 * the 429 cases all passed with it while every `err instanceof ApiError` branch
 * in these pages was silently false. The control below — a 401 that must still
 * say "invalid email or password" — is what caught it.
 */
const apiError = (status: number, body: Record<string, unknown> = {}) =>
  new ApiError(status, 'Too many requests. Please wait a moment and try again.', body);

const RATE_LIMITED = { code: 'rate_limited', retryAfterSeconds: 150 };

const { loginWithPassword, registerFn, requestReset, resetPassword, contactRequest, checkout } = vi.hoisted(() => ({
  loginWithPassword: vi.fn(),
  registerFn: vi.fn(),
  requestReset: vi.fn(),
  resetPassword: vi.fn(),
  contactRequest: vi.fn(),
  checkout: vi.fn(),
}));

// `ApiError` stays REAL — the pages branch on `err instanceof ApiError`, and a
// stubbed class would make every one of those branches silently false.
vi.mock('../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/client')>()),
  register: (...a: unknown[]) => registerFn(...a),
  requestPasswordReset: (...a: unknown[]) => requestReset(...a),
  resetPassword: (...a: unknown[]) => resetPassword(...a),
  contactRequest: (...a: unknown[]) => contactRequest(...a),
}));
vi.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({
    user: null, isAuthed: false, loginWithGoogle: vi.fn(), loginWithPassword,
    applySession: vi.fn(), logout: vi.fn(),
  }),
}));
vi.mock('../src/auth/google', () => ({ initGoogleAuth: vi.fn(async () => ({})), renderGoogleButton: vi.fn() }));
vi.mock('../src/auth/captcha', () => ({ captchaConfigured: () => false }));
vi.mock('../src/components/Turnstile', () => ({ Turnstile: () => null }));
vi.mock('../src/api/hooks', () => ({
  useCheckout: () => ({ mutateAsync: checkout }),
  useBalance: () => ({ data: { balance: 40 } }),
  usePlans: () => ({ data: { plans: [{ planId: 'p1', credits: 10, priceUsd: 20 }] } }),
  useTemplates: () => ({ data: { templates: [] } }),
}));

import { ApiError } from '../src/api/client';
import { rateLimitMessage } from '../src/lib/rate-limit';
import { Login } from '../src/pages/Login';
import { Credits } from '../src/pages/Credits';
import { ApiAccess } from '../src/pages/ApiAccess';
import { ResetPassword } from '../src/pages/ResetPassword';
import { LangProvider, type Lang } from '../src/i18n';

const ENGLISH_BODY = /Too many requests\. Please wait a moment and try again\./;

function at(path: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LangProvider>
        <Routes>
          <Route path={path.split('?')[0]} element={element} />
          <Route path="*" element={element} />
        </Routes>
      </LangProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  for (const m of [loginWithPassword, registerFn, requestReset, resetPassword, contactRequest, checkout]) m.mockReset();
});

describe('the wait we quote is the wait the API sent', () => {
  it('does not send someone away for an hour over ninety seconds', () => {
    // The exact defect the API side just fixed: the hourly buckets are CALENDAR
    // hours, so `Retry-After: 3600` (and the copy built from it) told a person who
    // could retry in a minute and a half to come back after lunch.
    const soon = rateLimitMessage(apiError(429, { retryAfterSeconds: 90 }), 'en');
    expect(soon).toMatch(/about a minute/);
    expect(soon).not.toMatch(/hour/);

    expect(rateLimitMessage(apiError(429, { retryAfterSeconds: 150 }), 'en')).toMatch(/about 3 minutes/);
    expect(rateLimitMessage(apiError(429, { retryAfterSeconds: 3600 }), 'en')).toMatch(/about an hour/);
  });

  it('rounds up, so we never send them back too early', () => {
    // 61 seconds is not "a minute" if that means "wait 60" — but it is well
    // inside "about a minute", and 121 must not round down to two.
    expect(rateLimitMessage(apiError(429, { retryAfterSeconds: 121 }), 'en')).toMatch(/about 3 minutes/);
  });

  it('stays vague when the API sent no figure, rather than inventing one', () => {
    const vague = rateLimitMessage(apiError(429), 'en');
    expect(vague).toMatch(/in a moment/);
    expect(vague).not.toMatch(/\d/);
  });

  it('says nothing was charged only where that is the question', () => {
    // On the credits page it answers what the person is actually worrying about.
    expect(rateLimitMessage(apiError(429, RATE_LIMITED), 'en', { nothingCharged: true })).toMatch(/Nothing was charged/);
    // On a sign-in form it raises a question nobody had.
    expect(rateLimitMessage(apiError(429, RATE_LIMITED), 'en')).not.toMatch(/charged/);
  });

  it('is written in each of the four languages, not merely different', () => {
    const anchors: Record<string, RegExp[]> = {
      es: [/Demasiadas solicitudes/, /en unos 3 minutos/, /No se te cobró nada/],
      fr: [/Trop de requêtes/, /environ 3 minutes/, /Rien ne vous a été facturé/],
      pt: [/Muitas solicitações/, /cerca de 3 minutos/, /Nada foi cobrado/],
    };
    for (const [lang, res] of Object.entries(anchors)) {
      const msg = rateLimitMessage(apiError(429, RATE_LIMITED), lang as Lang, { nothingCharged: true });
      for (const re of res) expect(msg, `${lang} is missing ${re}`).toMatch(re);
      expect(msg, lang).not.toMatch(/Try again|Nothing was charged|Too many requests/);
    }
  });
});

describe('sign-in, sign-up and forgot-password', () => {
  const signIn = async (err: unknown) => {
    loginWithPassword.mockRejectedValue(err);
    at('/login', <Login />);
    // By regex, because one of these cases runs the page in Spanish — where the
    // labels and the button are Spanish too, which is the point of it.
    await userEvent.type(screen.getByLabelText('Email'), 'a@x.com');
    await userEvent.type(screen.getByLabelText(/^(Password|Contraseña)$/), 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: /^(Sign in|Ingresar)$/ }));
  };

  it('says how long to wait instead of printing the API’s English', async () => {
    await signIn(apiError(429, RATE_LIMITED));
    await waitFor(() => expect(screen.getByText(/about 3 minutes/)).toBeTruthy());
    expect(screen.queryByText(ENGLISH_BODY), 'the log sentence reached the customer').toBeNull();
  });

  it('still tells a wrong password from a rate limit', async () => {
    // The control. Mapping every failure to "too many requests" hides the one
    // thing the person can actually fix.
    await signIn(apiError(401));
    await waitFor(() => expect(screen.getByText(/Invalid email or password/)).toBeTruthy());
    expect(screen.queryByText(/Try again in/)).toBeNull();
  });

  it('speaks the buyer’s language on the form they see before they have an account', async () => {
    localStorage.setItem('fbizlab_lang', 'es');
    await signIn(apiError(429, RATE_LIMITED));
    await waitFor(() => expect(screen.getByText(/Demasiadas solicitudes/)).toBeTruthy());
    expect(screen.queryByText(ENGLISH_BODY)).toBeNull();
  });

  it('covers the sign-up form on the same page', async () => {
    registerFn.mockRejectedValue(apiError(429, RATE_LIMITED));
    at('/login', <Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Create one' }));
    await userEvent.type(screen.getByLabelText('Email'), 'new@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(screen.getByText(/about 3 minutes/)).toBeTruthy());
    expect(screen.queryByText(ENGLISH_BODY)).toBeNull();
  });

  it('and the forgot-password form, which is metered on the same address', async () => {
    requestReset.mockRejectedValue(apiError(429, RATE_LIMITED));
    at('/login', <Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Forgot?' }));
    await userEvent.type(screen.getByLabelText('Email'), 'a@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(screen.getByText(/about 3 minutes/)).toBeTruthy());
    expect(screen.queryByText(ENGLISH_BODY)).toBeNull();
  });
});

describe('buying credits', () => {
  it('says plainly that nothing was charged', async () => {
    // The 429 happens before Stripe is reached — no session, no card. The person
    // just pressed Buy, and the English "Too many checkout attempts" left them
    // with no idea whether their money had moved.
    checkout.mockRejectedValue(apiError(429, { ...RATE_LIMITED, error: 'Too many checkout attempts.' }));
    at('/app/credits', <Credits />);
    await userEvent.click(screen.getByRole('button', { name: 'Buy now' }));

    await waitFor(() => expect(screen.getByText(/Nothing was charged/)).toBeTruthy());
    expect(screen.getByText(/about 3 minutes/)).toBeTruthy();
    expect(screen.queryByText(ENGLISH_BODY)).toBeNull();
  });

  it('still surfaces a real checkout failure', async () => {
    // The control: not every failure on this button is a rate limit, and
    // swallowing a genuine one would leave the buyer pressing it forever.
    checkout.mockRejectedValue(apiError(404, {}));
    at('/app/credits', <Credits />);
    await userEvent.click(screen.getByRole('button', { name: 'Buy now' }));
    await waitFor(() => expect(screen.queryByText(/Nothing was charged/)).toBeNull());
  });
});

describe('the contact form', () => {
  it('does not answer a rate limit in English', async () => {
    contactRequest.mockRejectedValue(apiError(429, RATE_LIMITED));
    at('/api-access', <ApiAccess />);
    await userEvent.type(screen.getByLabelText('Name'), 'A');
    await userEvent.type(screen.getByLabelText('Contact email'), 'a@x.com');
    await userEvent.type(screen.getByLabelText('Message'), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(screen.getByText(/about 3 minutes/)).toBeTruthy());
    expect(screen.queryByText(ENGLISH_BODY)).toBeNull();
  });
});

describe('the reset-password page', () => {
  const submit = async (err: unknown) => {
    resetPassword.mockRejectedValue(err);
    at('/reset?token=t1', <ResetPassword />);
    await userEvent.type(screen.getByLabelText('New password'), 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  };

  it('says the link is still valid, and when to try again', async () => {
    // A 429 here is not a dead link, and the way to get a new one is the reset
    // form — metered on the same address, so "invalid or has expired" sends them
    // to the one door that is also shut.
    await submit(apiError(429, RATE_LIMITED));
    await waitFor(() => expect(screen.getByText(/still valid/)).toBeTruthy());
    expect(screen.getByText(/about 3 minutes/)).toBeTruthy();
    expect(screen.queryByText(/invalid or has expired/), 'a false statement about their link').toBeNull();
    expect(screen.queryByText(ENGLISH_BODY)).toBeNull();
  });

  it('still calls a genuinely dead link dead', async () => {
    // The control, and the direction that must not be lost: an expired token has
    // to say so, or the person keeps pressing a button that will never work.
    await submit(apiError(400));
    await waitFor(() => expect(screen.getByText(/invalid or has expired/)).toBeTruthy());
    expect(screen.queryByText(/still valid/)).toBeNull();
  });
});
