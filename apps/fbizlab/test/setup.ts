/** jsdom shims the app touches on mount, plus DOM cleanup between tests. */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

// jsdom implements neither, and the app calls both on mount.
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!window.scrollTo) window.scrollTo = (() => {}) as typeof window.scrollTo;
