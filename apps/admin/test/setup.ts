/** jsdom shims Mantine touches on mount, plus DOM cleanup between tests. */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!window.scrollTo) window.scrollTo = (() => {}) as typeof window.scrollTo;
/**
 * jsdom has no `scrollIntoView`, and Mantine's Combobox calls it from a TIMER when
 * a dropdown opens — so the throw lands after the test that opened it has already
 * passed. Vitest reports it as an unhandled error and exits 1 with every test
 * green, which is a shape worth knowing: the summary line said `25 passed` and the
 * run had failed. Reading that line instead of the exit code is how it reached CI.
 */
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!(window as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}
