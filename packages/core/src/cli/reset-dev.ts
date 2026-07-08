/**
 * DEV-ONLY reset: wipe all test data from Firestore and seed a clean slate
 * (admin app + the FloridaBizLab app with a slug doc id `fbizlab`).
 *
 *   npm run reset:dev -- --confirm
 *
 * Refuses to run unless ENV=dev and --confirm is passed. Destructive.
 * Plans are NOT stored here — the catalog lives entirely in Stripe.
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';
import { createApp } from '../apps/store.js';
import { ensureDefaultSettings } from '../settings/store.js';

const FBIZLAB_APP_ID = 'fbizlab';

async function wipe(db: Firestore, name: string): Promise<number> {
  const col = db.collection(name);
  let total = 0;
  for (;;) {
    const snap = await col.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 400) break;
  }
  return total;
}

async function main() {
  if (config.env !== 'dev') {
    console.error(`Refusing to run: ENV is "${config.env}", not "dev".`);
    process.exit(1);
  }
  if (!process.argv.includes('--confirm')) {
    console.error('This DELETES all test data in the dev Firestore. Re-run with --confirm.');
    process.exit(1);
  }

  const db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });
  const collections = [
    config.jobs.collection,
    config.credits.ledgerCollection,
    config.credits.balancesCollection,
    config.rateLimits.collection,
    config.apps.collection,
    'plans', // legacy — plans now live in Stripe
    'users', // in case any were created
  ];

  console.error(`>> Wiping dev Firestore (${config.gcp.databaseId})...`);
  for (const c of collections) {
    const n = await wipe(db, c);
    console.error(`   ${c}: deleted ${n}`);
  }

  console.error('\n>> Seeding clean slate...');
  await ensureDefaultSettings();
  const admin = await createApp({ name: 'Backoffice Admin', role: 'admin' });
  const fbizlab = await createApp({ appId: FBIZLAB_APP_ID, name: 'FloridaBizLab', role: 'app' });

  console.log('\n=== Seeded apps (SAVE THESE KEYS — shown once) ===');
  console.log(`admin    appId=${admin.appId}  apiKey=${admin.apiKey}`);
  console.log(`fbizlab  appId=${fbizlab.appId}  apiKey=${fbizlab.apiKey}`);
  console.log('\nStripe: tag each Price with metadata { app: "fbizlab", credits: N } and lookup_key "fbizlab_<planId>".');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
