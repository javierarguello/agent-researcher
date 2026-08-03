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
