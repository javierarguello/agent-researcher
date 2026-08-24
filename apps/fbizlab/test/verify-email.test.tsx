/**
 * The page that carries half the pre-hijack fix, and had no test at all.
 *
 * An attacker registers an address they do not own; the victim receives a genuine
 * "verify your email" and clicks it. The API-side guard is the password
 * requirement — that is the security floor and it is well covered. This page is
 * the other half: it must NOT verify on load, because merely opening the link was
 * the whole mechanism.
 *
 * A regression here is one `useEffect` away, and only the API check would stand
 * between it and the takeover. So the first assertion is the design decision:
 * nothing goes out before the user submits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LangProvider } from '../src/i18n';

const verifyEmail = vi.fn();
vi.mock('../src/api/client', () => ({ verifyEmail: (...a: unknown[]) => verifyEmail(...a) }));

// The page signs the person in once the password verifies, so it now needs the auth
// context and the captcha `/auth/session` asks for. Both are stubbed: what this file
// is about is what the page SENDS and when.
const loginWithPassword = vi.fn();
vi.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ loginWithPassword }) }));
vi.mock('../src/components/Turnstile', () => ({
  Turnstile: () => null,
  TurnstileHandle: {},
}));

import { VerifyEmail } from '../src/pages/VerifyEmail';

const at = (search: string) =>
  render(
    // LangProvider reads the location, so it lives inside the router.
    <MemoryRouter initialEntries={[`/verify${search}`]}>
      <LangProvider>
        <Routes>
          <Route path="/verify" element={<VerifyEmail />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/app" element={<div>the app</div>} />
        </Routes>
      </LangProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  verifyEmail.mockReset();
  verifyEmail.mockResolvedValue({ status: 'verified', email: 'a@x.com' });
  loginWithPassword.mockReset();
  loginWithPassword.mockResolvedValue(undefined);
});

describe('verifying an email', () => {
  it('sends nothing until the person submits a password', async () => {
    // The assertion the whole fix rests on. Auto-verifying on load is what let a
    // victim activate a stranger's password by opening their mail.
    at('?token=abc');
    await new Promise((r) => setTimeout(r, 20));
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('sends the token and the password together', async () => {
    at('?token=abc');
    await userEvent.type(screen.getByLabelText(/password|contraseña/i), 'sup3rsecret');
    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith('abc', 'sup3rsecret'));
  });

  it('tells a wrong password apart from a dead link', async () => {
    // These are different situations and the difference matters: one means try
    // again, the other means the link is gone.
    verifyEmail.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 401 }));
    at('?token=abc');
    await userEvent.type(screen.getByLabelText(/password|contraseña/i), 'wrong');
    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText(/does not match/i)).toBeTruthy());
    // …and the form is still there, because a typo must not cost the registration.
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('says so when the link has no token at all', async () => {
    at('');
    expect(screen.getByText(/missing its token/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('speaks the buyer’s language', async () => {
    localStorage.setItem('fbizlab_lang', 'es');
    at('?token=abc');
    expect(screen.getByText(/confirma tu contraseña/i)).toBeTruthy();
    localStorage.removeItem('fbizlab_lang');
  });
});

describe('a rate-limited attempt is not a dead link', () => {
  // Every non-401 rendered "This verification link is invalid or has expired."
  // For a 429 that is simply false — the link is fine, we declined to look at it —
  // and it is a dead end: the routes out are registering again (409, the address
  // is taken) and forgot-password, which is metered on the same address. The two
  // token routes shared one 30/hour-per-IP bucket, so behind a carrier NAT a run
  // of password resets could tell every new signup that their signup was broken.
  const submitWith = async (status: number) => {
    verifyEmail.mockRejectedValue(Object.assign(new Error('nope'), { status }));
    at('?token=t1');
    await userEvent.type(screen.getByLabelText(/password|contraseña/i), 'sup3rsecret');
    await userEvent.click(screen.getByRole('button'));
  };

  it('says the link is still valid, and keeps the form up', async () => {
    await submitWith(429);
    await waitFor(() => expect(screen.getByText(/still valid/i)).toBeTruthy());
    expect(screen.queryByText(/invalid or has expired/i), 'a false statement about their link').toBeNull();
    // The form has to survive, or "try again" is not something they can do.
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('still calls a genuinely dead link dead', async () => {
    // The control. Mapping every failure to "busy" would pass the case above and
    // leave someone pressing a button that will never work.
    await submitWith(400);
    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeTruthy());
  });

  it('and still tells a wrong password apart from both', async () => {
    await submitWith(401);
    await waitFor(() => expect(screen.getByText(/does not match/i)).toBeTruthy());
  });
});

describe('a page the API would not even look at is not a dead link either (N9)', () => {
  // This app ships as a static bundle the browser caches. After a deploy that
  // changes what `/auth/verify-email` accepts, an already-open tab is still running
  // the OLD code: it posts the old shape, ajv refuses it with `FST_ERR_VALIDATION`,
  // and the catch mapped every non-401 to "this link is invalid or has expired".
  // The link was fine and a reload fixed it — but the person had already been told
  // their signup was broken, and the two ways out (register again, forgot password)
  // both dead-end on an address that is taken.
  //
  // `apps/api/test/auth.test.ts` pins the API half: that a request of the wrong
  // shape really does come back 400 with that code, and that a genuinely dead token
  // comes back 400 WITHOUT it. This side owns what the buyer is told.
  const submit = async (err: Record<string, unknown>) => {
    verifyEmail.mockRejectedValue(Object.assign(new Error('nope'), err));
    at('?token=t2');
    await userEvent.type(screen.getByLabelText(/password|contraseña/i), 'sup3rsecret');
    await userEvent.click(screen.getByRole('button', { name: /verify my email/i }));
  };

  it('a stale bundle is told to reload, not that its link died', async () => {
    await submit({ status: 400, code: 'FST_ERR_VALIDATION' });
    await waitFor(() => expect(screen.getByText(/still valid/i)).toBeTruthy());
    expect(screen.queryByText(/invalid or has expired/i), 'a false statement about their link').toBeNull();
    // And the way out is offered, not merely described.
    expect(screen.getByRole('button', { name: /reload and try again/i })).toBeTruthy();
  });

  it('so is an outage', async () => {
    // The server never judged the token — `consumeActionToken` runs only after the
    // password verifies, so the link is still there when the API comes back.
    await submit({ status: 503 });
    await waitFor(() => expect(screen.getByText(/still valid/i)).toBeTruthy());
  });

  it('and so is a reply we cannot read at all', async () => {
    // A 502 HTML page from the load balancer, or a rejected `fetch`: the client's
    // own `JSON.parse` throws, so the error reaching this page has no status.
    await submit({});
    await waitFor(() => expect(screen.getByText(/still valid/i)).toBeTruthy());
  });

  it('but a 400 in the API’s own words still means the link is gone', async () => {
    // The control, and the one that matters: "everything is a reload" would leave
    // someone re-loading a link that will never work again.
    await submit({ status: 400 });
    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeTruthy());
    expect(screen.queryByText(/still valid/i)).toBeNull();
  });
});

describe('after the password verifies', () => {
  it('signs the person in instead of sending them to type it again', async () => {
    // Clicking the link proves you read the mail; this form proves you are the
    // person who registered. That is strictly more than the sign-in page asks for,
    // so asking for the same password on the next screen is a step with nothing
    // behind it. The API still returns no session of its own — this signs in.
    at('?token=abc');
    await userEvent.type(screen.getByLabelText(/password|contraseña/i), 'sup3rsecret');
    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(loginWithPassword).toHaveBeenCalledWith('a@x.com', 'sup3rsecret', undefined));
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy());
  });

  it('still says it worked when the sign-in cannot go through', async () => {
    // The address is stamped and the link is spent either way. A captcha that never
    // solved or a rate limit must not read as a failed verification.
    loginWithPassword.mockRejectedValue(new Error('429'));
    at('?token=abc');
    await userEvent.type(screen.getByLabelText(/password|contraseña/i), 'sup3rsecret');
    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText(/sign in to continue/i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('login page')).toBeTruthy(), { timeout: 3000 });
  });
});
