/**
 * App registry admin CLI (writes to Firestore).
 *
 *   npm run apps -- seed-admin [--name "Admin"]      # create the base admin app
 *   npm run apps -- create --name "My App" [--role app] [--rate 10]
 *   npm run apps -- list
 *   npm run apps -- update --appId <id> [--active true|false] [--rate 20|none]
 *
 * Requires ADC + Firestore access. The apiKey is printed only at creation time.
 *
 * `--email-from` and `--web-url` are here because during a first bring-up this is
 * the ONLY surface that can write them. The API route that carries them
 * (`PATCH /admin/apps/:appId`) needs an admin SESSION — a Google id_token for an
 * address already listed in the app's `adminEmails` — and the admin SPA never
 * renders either field. So on an empty prod Firestore the two of them were
 * unreachable, and without them `POST /auth/register` answers 500: no buyer can
 * verify an email, which is every buyer.
 */
import { pathToFileURL } from 'node:url';
import { createApp, listApps, updateApp, getApp, deleteApp } from '../apps/store.js';
import { ensureDefaultSettings, getSettings, updateSettings } from '../settings/store.js';

/** The argv `run` was called with — set on entry so `arg` reads the same list. */
let argv: string[] = [];

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : undefined;
}

/**
 * Exported so a test can drive the real commands against the in-memory Firestore.
 * The flag→field wiring is the part that breaks silently: `updateApp` has accepted
 * `emailFrom`/`webUrl` all along, and the CLI simply never passed them.
 */
export async function run(input: string[]): Promise<void> {
  argv = input;
  const cmd = argv[2];

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
        allowedTemplates: arg('allowed-templates')?.split(',').map((t) => t.trim()),
        emailFrom: arg('email-from'),
        webUrl: arg('web-url')?.replace(/\/$/, ''),
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
        allowedTemplates?: string[];
        emailFrom?: string;
        webUrl?: string;
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
      const tmpls = arg('allowed-templates');
      if (tmpls != null) patch.allowedTemplates = tmpls.split(',').map((t) => t.trim());
      const from = arg('email-from');
      if (from != null) patch.emailFrom = from;
      // Trailing slash stripped here rather than trusted: the value is concatenated
      // into `${webUrl}/verify?token=…` (apps/api/src/index.ts:481), and a double
      // slash in a verification link is the kind of thing nobody tests until a
      // buyer cannot sign in.
      const web = arg('web-url');
      if (web != null) patch.webUrl = web.replace(/\/$/, '');
      const updated = await updateApp(appId, patch);
      if (!updated) throw new Error(`Unknown app: ${appId}`);
      console.log(JSON.stringify({ ...updated, apiKey: `${updated.apiKey.slice(0, 8)}…` }, null, 2));
      break;
    }
    case 'delete': {
      const appId = arg('appId');
      if (!appId) throw new Error('delete requires --appId');
      await deleteApp(appId);
      console.log(`deleted app ${appId}`);
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
      const sub = argv[3];
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
      console.error('Usage: apps <seed-admin|create|list|update|get|delete|settings> [flags]');
      console.error('  create/update flags: --appId --name --role --rate --google-client-id');
      console.error('                       --admin-emails --allowed-templates --email-from --web-url');
      console.error('  settings [set --app N|none --user N|none]');
      process.exit(1);
  }
}

// Only when this file IS the program. A test that imports it must not run a
// command — and must not take the process down through the `catch` below.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run(process.argv).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
