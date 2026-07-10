export type AppRole = 'admin' | 'app';

/**
 * A registered client application. Source of truth for API-key auth.
 * Doc id in Firestore == `appId`.
 */
export interface AppRecord {
  appId: string;
  name: string;
  /** Secret API key the app authenticates with. */
  apiKey: string;
  /** Whether the app may call the API. */
  active: boolean;
  /** "admin" apps may manage other apps (backoffice); "app" is a normal client. */
  role: AppRole;
  /** Optional cap: max reports (jobs) this app may create per calendar hour. */
  rateLimitPerHour?: number;
  /** Google OAuth client id of this app's frontend (validates the id_token `aud`). */
  googleClientId?: string;
  /** For the admin/backoffice app: emails allowed to log in (get admin tokens). */
  adminEmails?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Client-safe view (never leaks the apiKey). */
export type AppPublic = Omit<AppRecord, 'apiKey'> & { apiKeyPreview: string };

export function toPublicApp(app: AppRecord): AppPublic {
  const { apiKey, ...rest } = app;
  return { ...rest, apiKeyPreview: `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` };
}
