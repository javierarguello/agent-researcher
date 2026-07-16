/**
 * DEV-ONLY reset: wipe all test data from Firestore and seed a clean slate
 * (admin app + the FloridaBizLab app with a slug doc id `fbizlab`).
 *
 *   npm run reset:dev -- --confirm
 *
 * Refuses to run unless ENV=dev and --confirm is passed. Destructive.
 * Plans are NOT stored here — the catalog lives entirely in Stripe.
 */
import { Firestore, type Query } from '@google-cloud/firestore';
import { config } from '../config.js';
import { createApp } from '../apps/store.js';
import { ensureDefaultSettings } from '../settings/store.js';

const FBIZLAB_APP_ID = 'fbizlab';

async function wipe(db: Firestore, name: string): Promise<number> {
  return drain(db, db.collection(name));
}

/** Delete every doc in a collection GROUP (e.g. the `daily` subcollections). */
async function wipeGroup(db: Firestore, name: string): Promise<number> {
  return drain(db, db.collectionGroup(name));
}

async function drain(db: Firestore, query: Query): Promise<number> {
  let total = 0;
  for (;;) {
    const snap = await query.limit(400).get();
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
    config.stats.appStatsCollection,
    config.stats.appUsersCollection,
    'plans', // legacy — plans now live in Stripe
    'users', // in case any were created
  ];

  console.error(`>> Wiping dev Firestore (${config.gcp.databaseId})...`);
  for (const c of collections) {
    const n = await wipe(db, c);
    console.error(`   ${c}: deleted ${n}`);
  }
  // `daily` buckets are a subcollection of app-stats docs — wipe those too.
  const dailyN = await wipeGroup(db, config.stats.dailySubcollection);
  console.error(`   ${config.stats.dailySubcollection} (subcol): deleted ${dailyN}`);

  console.error('\n>> Seeding clean slate...');
  await ensureDefaultSettings();
  // Well-known apps use a slug doc id (never a UUID): 'admin', 'fbizlab', …
  const admin = await createApp({ appId: 'admin', name: 'Backoffice Admin', role: 'admin' });
  const fbizlab = await createApp({
    appId: FBIZLAB_APP_ID,
    name: 'FloridaBizLab',
    role: 'app',
    allowedTemplates: ['florida-business-for-sale'],
  });

  console.log('\n=== Seeded apps (SAVE THESE KEYS — shown once) ===');
  console.log(`admin    appId=${admin.appId}  apiKey=${admin.apiKey}`);
  console.log(`fbizlab  appId=${fbizlab.appId}  apiKey=${fbizlab.apiKey}`);
  console.log('\nStripe: tag each Price with metadata { appId: "fbizlab", planId: "<planId>", credits: N }.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
