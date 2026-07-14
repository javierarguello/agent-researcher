/** Static build-time config (injected by Vite from VITE_* env vars). */
export const config = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, ''),
  googleClientId: import.meta.env.VITE_ADMIN_GOOGLE_CLIENT_ID ?? '',
  adminAppId: import.meta.env.VITE_ADMIN_APP_ID ?? 'admin',
};
