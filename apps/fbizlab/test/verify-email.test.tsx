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

import { VerifyEmail } from '../src/pages/VerifyEmail';

const at = (search: string) =>
  render(
    // LangProvider reads the location, so it lives inside the router.
    <MemoryRouter initialEntries={[`/verify${search}`]}>
      <LangProvider>
        <Routes>
          <Route path="/verify" element={<VerifyEmail />} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </LangProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  verifyEmail.mockReset();
  verifyEmail.mockResolvedValue({ status: 'verified', email: 'a@x.com' });
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
