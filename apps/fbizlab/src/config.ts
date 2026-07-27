/** Static build-time config (from VITE_* env). */
export const config = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, ''),
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  appId: import.meta.env.VITE_APP_ID ?? 'fbizlab',
  /** Cloudflare Turnstile site key. Public by design — it ships in the HTML.
   *  Empty disables the widget entirely (the API skips verification too). */
  //  `||` not `??`: an unset CI variable is defined as an EMPTY STRING, which
  //  would silently disable the widget rather than fall back to the default.
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAD_OEtqrL5B2NN6f',
};
