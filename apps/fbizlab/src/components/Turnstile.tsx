/**
 * The Turnstile widget, as a drop-in for any form in this app.
 *
 *   const captcha = useRef<TurnstileHandle>(null);
 *   const [ready, setReady] = useState(!captchaConfigured());
 *   …
 *   <button disabled={!ready}>Sign in</button>
 *   <Turnstile ref={captcha} onReady={setReady} />
 *   …
 *   const token = await captcha.current?.getToken();
 *   …submit…
 *   captcha.current?.reset();   // tokens are single-use
 *
 * By default it shows NOTHING: `appearance="interaction-only"` keeps the widget
 * hidden while Cloudflare is satisfied by passive signals, and only reveals it on
 * the rare request that needs a human to click. When it does appear it fills its
 * container (`size="flexible"`) instead of sitting at the fixed 300px an iframe
 * defaults to.
 *
 * Renders nothing at all when no site key is configured, so the forms work
 * untouched before Turnstile is set up (and in tests).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { captchaConfigured, renderWidget, TURNSTILE_ACTION, type Widget } from '../auth/captcha';
import { config } from '../config';

export interface TurnstileHandle {
  /** The current token, waiting up to `timeoutMs` for the widget to solve. */
  getToken: (timeoutMs?: number) => Promise<string | undefined>;
  /** Discard the used token and solve again. Call after every submission. */
  reset: () => void;
}

interface Props {
  /**
   * Called with `true` once a token exists, `false` while one is pending. Wire it
   * to the submit button's `disabled`. It is also called with `true` if the widget
   * cannot produce a token in time — a blocked CDN must not leave the user staring
   * at a permanently dead button; the server rejects such a submit with a clear
   * message instead.
   */
  onReady?: (ready: boolean) => void;
  className?: string;
}

/** How long to wait before letting the form submit without a token anyway. */
const READY_FALLBACK_MS = 12_000;

export const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile({ onReady, className }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<Widget | null>(null);
  const token = useRef<string | undefined>(undefined);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    if (!captchaConfigured() || !host.current) return;
    let live = true;
    if (widget.current) return; // StrictMode mounts twice; never render two widgets

    const fallback = setTimeout(() => ready.current?.(true), READY_FALLBACK_MS);

    void renderWidget(host.current, (t) => {
      token.current = t;
      if (t) clearTimeout(fallback);
      ready.current?.(!!t);
    }).then((w) => {
      if (!live) {
        w?.remove();
        return;
      }
      // The script itself failed to load — don't hold the form hostage.
      if (!w) ready.current?.(true);
      widget.current = w;
    });

    return () => {
      live = false;
      clearTimeout(fallback);
      widget.current?.remove();
      widget.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    async getToken(timeoutMs = 8000) {
      if (!captchaConfigured()) return undefined;
      const deadline = Date.now() + timeoutMs;
      // Normally already solved; poll briefly for the slow case rather than
      // blocking the submit forever.
      while (Date.now() < deadline) {
        const current = token.current ?? widget.current?.token();
        if (current) return current;
        await new Promise((r) => setTimeout(r, 150));
      }
      return undefined;
    },
    reset() {
      token.current = undefined;
      ready.current?.(false);
      widget.current?.reset();
    },
  }));

  if (!captchaConfigured()) return null;
  // Canonical markup: the class + data attributes Turnstile documents, and what
  // analytics attributes the integration by. The same values go to render().
  return (
    <div
      ref={host}
      className={`cf-turnstile${className ? ` ${className}` : ''}`}
      data-sitekey={config.turnstileSiteKey}
      data-action={TURNSTILE_ACTION}
      data-appearance="interaction-only"
      data-size="flexible"
      data-theme="auto"
    />
  );
});
