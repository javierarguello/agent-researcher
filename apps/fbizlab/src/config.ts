/** Static build-time config (from VITE_* env). */
export const config = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, ''),
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  appId: import.meta.env.VITE_APP_ID ?? 'fbizlab',
};
