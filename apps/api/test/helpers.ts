import { createApp, signSession } from '@agent-researcher/core';

/** Seed a regular app (doc id = appId). */
export function seedApp(appId = 'fbizlab') {
  return createApp({ appId, name: appId, role: 'app' });
}

/** Seed the admin app with an email whitelist. */
export function seedAdmin(adminEmails: string[], appId = 'admin') {
  return createApp({ appId, name: 'Admin', role: 'admin', adminEmails });
}

/** A session token for a user of an app. */
export function token(appId: string, email: string, role: 'user' | 'admin' = 'user') {
  return signSession({ email, appId, role });
}

export function auth(t: string) {
  return { authorization: `Bearer ${t}`, 'content-type': 'application/json' };
}
