/** Static build-time config (from VITE_* env). */
export const config = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, ''),
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  appId: import.meta.env.VITE_APP_ID ?? 'fbizlab',
  /** Cloudflare Turnstile site key. Public by design — it ships in the HTML.
   *  Empty disables the widget entirely (the API skips verification too). */
  //  `||` not `??`: an unset CI variable is defined as an EMPTY STRING, which
  //  would silently disable the widget rather than fall back to the default.
  /**
   * Cloudflare Turnstile SITE key — public, and per environment.
   *
   * It used to carry the dev widget's key as a literal fallback here and in both
   * deploy workflows' `||`, with neither repo variable defined, so every build in
   * every environment shipped the same hardcoded widget. It worked only because that
   * literal happened to be the right one: rotate the widget and dev and prod would
   * both keep compiling the old key with nothing to say so, while the API — whose
   * SECRET half IS per environment — refused every token it was handed.
   *
   * Empty is a real state (no widget, no token) and the API enforces whenever its
   * secret is set, so an empty key against a configured API is a site nobody can sign
   * in to. `vite.config.ts` refuses to BUILD without it rather than letting that ship.
   */
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '',
};
