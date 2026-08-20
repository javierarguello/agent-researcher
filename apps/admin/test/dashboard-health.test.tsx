/**
 * What the admin sees about moderation the moment they log in.
 *
 * The failure this panel exists for is SILENT everywhere else. A classifier that
 * throws is allowed through by design (an outage must not block paying users) and
 * left one WARNING in a log nobody watches; a deployment with
 * `MODERATION_LLM=false` leaves no trace at all, because a layer that does not run
 * increments nothing. §K decided to stop chasing semantic injection patterns with
 * regexes precisely BECAUSE the classifier handles them — and round 10 (R10-10)
 * reproduced two shipping paths on which it does not run at all.
 *
 * So the panel renders in every state, including the healthy one and the one where
 * the API is too old to answer: a health panel that only appears when something is
 * wrong is indistinguishable from a health panel that has stopped working.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';

const { state } = vi.hoisted(() => ({ state: { health: undefined as Record<string, unknown> | undefined } }));

const EMPTY_TOTALS = {
  reports: 0, reportsCompleted: 0, reportsFailed: 0, budgetStoppedReports: 0, degradedReports: 0,
  users: 0, payingUsers: 0, costUsd: 0, failedCostUsd: 0, requestLlmUsd: 0, requestLlmCalls: 0,
  moderationFailOpen: 0, revenueUsd: 0, purchases: 0, creditsPurchased: 0,
  avgGenMs: null, genTimeMsMin: null, genTimeMsMax: null,
};

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  api: () => Promise.resolve({
    totals: EMPTY_TOTALS,
    apps: [],
    daily: [],
    ...(state.health ? { health: state.health } : {}),
  }),
}));

import { Dashboard } from '../src/pages/Dashboard';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider client={qc}><Dashboard /></QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

const OK = { classifierEnabled: true, moderationFailOpenRecent: 0, moderationFailOpen: 0, adminBypassesModeration: true };

beforeEach(() => { state.health = undefined; });

describe('the moderation health strip, on the way in', () => {
  it('says the classifier is OFF, and that the flag is not the one the assist reads', async () => {
    // The state R10-10 reproduced: `MODERATION_LLM=false` while `VALIDATION_LLM`
    // stays true, so the buyer's free text still reaches a model through the
    // assisted review — with the pre-screen, which lets roughly two thirds of known
    // injection phrasings through on purpose, as the only thing in front of it.
    // Mutation that reds this: render the healthy strip whenever `health` exists.
    state.health = { ...OK, classifierEnabled: false };
    show();

    await waitFor(() => expect(screen.getByText(/classifier is OFF/i)).toBeTruthy());
    const text = document.body.textContent!;
    expect(text).toContain('MODERATION_LLM=false');
    expect(text).toContain('VALIDATION_LLM');
  });

  it('counts fail-opens and says WHEN, because a count alone cannot be acted on', async () => {
    // "Is this from March or from this morning?" is the question an admin has, and
    // a bare number does not answer it.
    // Mutation that reds this: drop the timestamp from the alert.
    state.health = { ...OK, moderationFailOpenRecent: 7, moderationFailOpen: 9, moderationFailOpenLastAt: '2026-08-20T10:00:00Z' };
    show();

    await waitFor(() => expect(screen.getByText(/failed open/i)).toBeTruthy());
    const text = document.body.textContent!;
    expect(text).toMatch(/failed open 7×/);
    // The date as the admin sees it. `shortDateTime` prints no year — the relative
    // label beside it is what carries recency — so the assertion matches what is on
    // screen rather than what the ISO string contains.
    expect(text).toMatch(/Aug 20/);
  });

  it('says so when everything is fine — silence is the one thing it must never be', async () => {
    // Mutation that reds this: render nothing when there is nothing wrong.
    state.health = OK;
    show();

    await waitFor(() => expect(screen.getByText(/Moderation is running/i)).toBeTruthy());
    // …and the standing fact that an admin's own requests skip both layers, which
    // is true in every state and is why this reads differently for the person
    // looking at it than for a buyer.
    expect(document.body.textContent).toMatch(/skip moderation/i);
  });

  it('does not claim health when the API did not report any', async () => {
    // An API deployed before this field returns stats with no `health`. Showing
    // green there would be a lie of exactly the kind this panel exists to stop.
    // Mutation that reds this: default a missing `health` to the healthy shape.
    show();

    await waitFor(() => expect(screen.getByText(/not reported/i)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/Moderation is running/i);
  });
});
