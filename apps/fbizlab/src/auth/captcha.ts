/**
 * Cloudflare Turnstile: script loading + widget lifecycle.
 *
 * Framework-agnostic on purpose — `components/Turnstile.tsx` is the thin React
 * wrapper, and any other client can use these two functions directly.
 *
 * The API is loaded with `render=explicit`, so Turnstile does not auto-scan the
 * DOM. In a SPA the widget divs mount long after the script does, so we render
 * each one ourselves; the `cf-turnstile` class and `data-*` attributes stay on
 * the element (canonical markup, and what analytics attributes the integration
 * by) while the same values are passed to `render()` for the actual behaviour.
 *
 * A token is single-use and expires in ~5 minutes: after every submission the
 * caller resets the widget to get a fresh one.
 */
import { config } from '../config';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Tags this integration in Turnstile analytics. Must be on every widget. */
export const TURNSTILE_ACTION = 'turnstile-spin-v2';

interface TurnstileApi {
  render: (el: HTMLElement, params: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
  getResponse: (widgetId?: string) => string | undefined;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** True when a site key is configured; the forms skip the widget otherwise. */
export const captchaConfigured = (): boolean => !!config.turnstileSiteKey;

let loading: Promise<TurnstileApi | null> | undefined;

/**
 * Load the Turnstile API once. Resolves `null` when no site key is configured or
 * the script can't load — the form then submits without a token and the server
 * decides, rather than the UI dead-ending on a blocked CDN.
 */
export function loadTurnstile(): Promise<TurnstileApi | null> {
  if (!captchaConfigured()) return Promise.resolve(null);
  loading ??= new Promise<TurnstileApi | null>((resolve) => {
    if (window.turnstile) return resolve(window.turnstile);
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_URL.split('?')[0]}"]`);
    const el = existing ?? document.createElement('script');
    el.addEventListener('load', () => resolve(window.turnstile ?? null));
    el.addEventListener('error', () => resolve(null));
    if (!existing) {
      el.src = SCRIPT_URL;
      el.async = true;
      el.defer = true;
      document.head.appendChild(el);
    }
    // The script may already be parsed (index.html loads it eagerly).
    if (window.turnstile) resolve(window.turnstile);
  });
  return loading;
}

export interface Widget {
  /** Cloudflare's widget id, for reset/remove. */
  id: string;
  /** The current token, or undefined until the widget solves. */
  token: () => string | undefined;
  /** Discard the used token and solve again — required before a second submit. */
  reset: () => void;
  remove: () => void;
}

/**
 * Render a widget into `el`, calling `onToken` whenever a fresh token is issued
 * (and with `undefined` when one errors or expires).
 */
export async function renderWidget(el: HTMLElement, onToken: (token?: string) => void): Promise<Widget | null> {
  const turnstile = await loadTurnstile();
  if (!turnstile) return null;

  const id = turnstile.render(el, {
    sitekey: config.turnstileSiteKey,
    action: TURNSTILE_ACTION,
    theme: 'auto',
    callback: (token: string) => onToken(token),
    'error-callback': () => onToken(undefined),
    'expired-callback': () => onToken(undefined),
  });

  return {
    id,
    token: () => turnstile.getResponse(id),
    reset: () => {
      onToken(undefined);
      turnstile.reset(id);
    },
    remove: () => turnstile.remove(id),
  };
}
