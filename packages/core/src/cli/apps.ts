/**
 * App registry admin CLI (writes to Firestore).
 *
 *   npm run apps -- seed-admin [--name "Admin"]      # create the base admin app
 *   npm run apps -- create --name "My App" [--role app] [--rate 10]
 *   npm run apps -- list
 *   npm run apps -- update --appId <id> [--active true|false] [--rate 20|none]
 *
 * Requires ADC + Firestore access. The apiKey is printed only at creation time.
 */
import { createApp, listApps, updateApp, getApp } from '../apps/store.js';
import { ensureDefaultSettings, getSettings, updateSettings } from '../settings/store.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : undefined;
}

async function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'seed-admin': {
      const name = arg('name') ?? 'Admin';
      const existing = (await listApps()).find((a) => a.role === 'admin');
      if (existing) {
        console.error(`An admin app already exists: ${existing.appId} (${existing.name}).`);
        console.error('Its apiKey is only shown at creation. Create another with: create --role admin');
        return;
      }
      const admin = await createApp({ name, role: 'admin' });
      const settings = await ensureDefaultSettings();
      console.log('Base admin app created:');
      console.log(JSON.stringify(admin, null, 2));
      console.log('\nDefault settings:', JSON.stringify(settings));
      console.log('\n>> SAVE THIS apiKey — it is not shown again.');
      break;
    }
    case 'create': {
      const name = arg('name');
      if (!name) throw new Error('create requires --name');
      const role = (arg('role') as 'admin' | 'app') ?? 'app';
      const rate = arg('rate');
      const emails = arg('admin-emails');
      const created = await createApp({
        name,
        role,
        appId: arg('appId'),
        rateLimitPerHour: rate ? Number.parseInt(rate, 10) : undefined,
        googleClientId: arg('google-client-id'),
        adminEmails: emails ? emails.split(',').map((e) => e.trim().toLowerCase()) : undefined,
      });
      console.log(JSON.stringify(created, null, 2));
      console.log('\n>> SAVE THIS apiKey — it is not shown again.');
      break;
    }
    case 'list': {
      const apps = await listApps();
      for (const a of apps) {
        console.log(
          `${a.appId}  [${a.role}]  ${a.active ? 'active' : 'INACTIVE'}  ` +
            `rate=${a.rateLimitPerHour ?? '∞'}/h  ${a.name}  key=${a.apiKey.slice(0, 8)}…`,
        );
      }
      if (apps.length === 0) console.log('(no apps)');
      break;
    }
    case 'update': {
      const appId = arg('appId');
      if (!appId) throw new Error('update requires --appId');
      const patch: {
        active?: boolean;
        rateLimitPerHour?: number | null;
        name?: string;
        googleClientId?: string;
        adminEmails?: string[];
      } = {};
      const active = arg('active');
      if (active != null) patch.active = active === 'true';
      const rate = arg('rate');
      if (rate != null) patch.rateLimitPerHour = rate === 'none' ? null : Number.parseInt(rate, 10);
      const name = arg('name');
      if (name != null) patch.name = name;
      const gcid = arg('google-client-id');
      if (gcid != null) patch.googleClientId = gcid;
      const emails = arg('admin-emails');
      if (emails != null) patch.adminEmails = emails.split(',').map((e) => e.trim().toLowerCase());
      const updated = await updateApp(appId, patch);
      if (!updated) throw new Error(`Unknown app: ${appId}`);
      console.log(JSON.stringify({ ...updated, apiKey: `${updated.apiKey.slice(0, 8)}…` }, null, 2));
      break;
    }
    case 'get': {
      const appId = arg('appId');
      if (!appId) throw new Error('get requires --appId');
      const a = await getApp(appId);
      console.log(a ? JSON.stringify({ ...a, apiKey: `${a.apiKey.slice(0, 8)}…` }, null, 2) : 'not found');
      break;
    }
    case 'settings': {
      const sub = process.argv[3];
      if (sub === 'set') {
        const patch: { appRateLimitPerHour?: number | null; userRateLimitPerHour?: number | null } = {};
        const a = arg('app');
        if (a != null) patch.appRateLimitPerHour = a === 'none' ? null : Number.parseInt(a, 10);
        const u = arg('user');
        if (u != null) patch.userRateLimitPerHour = u === 'none' ? null : Number.parseInt(u, 10);
        console.log(JSON.stringify(await updateSettings(patch), null, 2));
      } else {
        console.log(JSON.stringify(await getSettings(), null, 2));
      }
      break;
    }
    default:
      console.error('Usage: apps <seed-admin|create|list|update|get|settings> [flags]');
      console.error('  settings [set --app N|none --user N|none]');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
