/**
 * Invisible bot check for the two anonymous forms (signup, contact).
 *
 * There is no puzzle and no visible widget: Cloudflare Turnstile runs in
 * execute-on-demand mode, so the token is minted in the background when the user
 * submits. Nothing is loaded, and `captchaToken()` resolves to `undefined`, until
 * `VITE_CAPTCHA_SITE_KEY` is set — matching the API, which skips verification
 * until its own secret is configured.
 *
 * (The API also accepts Google reCAPTCHA v3 tokens; swap this file's script and
 * execute call if you go that way. Turnstile is the default because it is free
 * at any volume.)
 */
const SITE_KEY = import.meta.env.VITE_CAPTCHA_SITE_KEY ?? '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Turnstile {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile | null> | undefined;
let widgetId: string | undefined;
/** Resolver for the submission in flight. The widget's callbacks are registered
 *  once at render time and reused on every `execute`, so they must always hand
 *  the token to the CURRENT caller, not the one that happened to render it. */
let pending: ((token?: string) => void) | undefined;

function loadScript(): Promise<Turnstile | null> {
  if (!SITE_KEY) return Promise.resolve(null);
  loading ??= new Promise<Turnstile | null>((resolve) => {
    if (window.turnstile) return resolve(window.turnstile);
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(window.turnstile ?? null);
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
  return loading;
}

/** True when a site key is configured — the forms use it to decide whether to wait. */
export const captchaConfigured = (): boolean => !!SITE_KEY;

/**
 * Mint a token for one submission. Resolves `undefined` when the check is not
 * configured (the API then skips verification) or when the script can't load —
 * the request still goes through and the API decides, rather than the UI
 * silently dead-ending on a blocked CDN.
 */
export async function captchaToken(): Promise<string | undefined> {
  const turnstile = await loadScript();
  if (!turnstile) return undefined;

  // A second submission takes over the widget; release the previous caller so it
  // falls back to sending no token rather than hanging.
  pending?.(undefined);

  return new Promise<string | undefined>((resolve) => {
    let settled = false;
    const settle = (token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pending === settle) pending = undefined;
      resolve(token);
    };
    pending = settle;
    const timer = setTimeout(() => settle(undefined), 8000); // never hang a form on it

    if (widgetId === undefined) {
      const host = document.createElement('div');
      host.style.display = 'none';
      document.body.appendChild(host);
      widgetId = turnstile.render(host, {
        sitekey: SITE_KEY,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token: string) => pending?.(token),
        'error-callback': () => pending?.(undefined),
        'timeout-callback': () => pending?.(undefined),
      });
    } else {
      turnstile.reset(widgetId);
    }
    turnstile.execute(widgetId!);
  });
}
