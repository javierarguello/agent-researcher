/**
 * The Turnstile widget, as a drop-in for any form in this app.
 *
 *   const captcha = useRef<TurnstileHandle>(null);
 *   <Turnstile ref={captcha} />
 *   const token = await captcha.current?.getToken();   // waits for the solve
 *   …submit…
 *   captcha.current?.reset();                          // tokens are single-use
 *
 * Renders nothing when no site key is configured, so the forms work untouched
 * before Turnstile is set up (and in tests).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { captchaConfigured, renderWidget, TURNSTILE_ACTION, type Widget } from '../auth/captcha';
import { config } from '../config';

export interface TurnstileHandle {
  /** The current token, waiting up to `timeoutMs` for the widget to solve. */
  getToken: (timeoutMs?: number) => Promise<string | undefined>;
  /** Discard the used token and solve again. Call after every submission. */
  reset: () => void;
}

export const Turnstile = forwardRef<TurnstileHandle, { className?: string }>(function Turnstile({ className }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<Widget | null>(null);
  const token = useRef<string | undefined>(undefined);
  const [, force] = useState(0);

  useEffect(() => {
    if (!captchaConfigured() || !host.current) return;
    let live = true;
    // StrictMode mounts twice in dev; never render two widgets into one host.
    if (widget.current) return;
    void renderWidget(host.current, (t) => {
      token.current = t;
      force((n) => n + 1); // let a parent re-render on solve (e.g. enable submit)
    }).then((w) => {
      if (!live) {
        w?.remove();
        return;
      }
      widget.current = w;
    });
    return () => {
      live = false;
      widget.current?.remove();
      widget.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    async getToken(timeoutMs = 8000) {
      if (!captchaConfigured()) return undefined;
      const deadline = Date.now() + timeoutMs;
      // A managed widget usually solves on render; poll briefly for the slow case
      // rather than blocking the submit forever.
      while (Date.now() < deadline) {
        const current = token.current ?? widget.current?.token();
        if (current) return current;
        await new Promise((r) => setTimeout(r, 150));
      }
      return undefined;
    },
    reset() {
      token.current = undefined;
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
      data-theme="auto"
      style={{ margin: '14px 0' }}
    />
  );
});
