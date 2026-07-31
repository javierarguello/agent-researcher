/**
 * One-off: clear the pre-screen blocks that should never have been earned (E3).
 *
 *   npm run unblock:moderation                  # dry run — prints, changes nothing
 *   npm run unblock:moderation -- --confirm     # writes
 *
 * Why it exists. The deterministic pre-screen used to reject a lot of perfectly
 * ordinary phrasings, and every rejection was a strike; four strikes blocked the
 * account — from generating reports AND from buying credits. `f80ac4e` rebuilt the
 * pre-screen around precision and `ada33e8` stopped the free layer earning strikes
 * at all, but neither fix is retroactive: strikes never decay, so anyone who
 * accumulated four under the old behaviour is still locked out, and nothing
 * identifies them.
 *
 * It only touches users whose `blockedReason` is one of OUR moderation strings —
 * an admin who blocked someone by hand wrote a different reason, and their
 * decision is not this script's to undo.
 *
 * Dry run by default, and it prints every user it would touch, because the failure
 * mode of getting this wrong is unblocking an account somebody blocked on purpose.
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from '../config.js';
import { blockReasonFor } from '../moderation/copy.js';

/**
 * The stable half of the sentence the moderation block path writes, derived from
 * that path rather than copied — a literal here would silently stop matching the
 * day the wording changes, and this script would then report "nothing to do".
 */
const OUR_PREFIX = blockReasonFor([]).split(' (categories:')[0]!;

export function isModerationBlock(reason: unknown): boolean {
  return typeof reason === 'string' && reason.startsWith(OUR_PREFIX);
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const db = new Firestore({ projectId: config.gcp.projectId, databaseId: config.gcp.databaseId });

  const snap = await db.collection(config.stats.appUsersCollection).where('blocked', '==', true).get();

  const touch: Array<{ id: string; reason: string; strikes: number }> = [];
  const skip: Array<{ id: string; reason: string }> = [];
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const reason = String(d.blockedReason ?? '');
    if (isModerationBlock(d.blockedReason)) {
      touch.push({ id: doc.id, reason, strikes: typeof d.moderationStrikes === 'number' ? d.moderationStrikes : 0 });
    } else {
      skip.push({ id: doc.id, reason: reason || '(no reason recorded)' });
    }
  }

  console.log(`env=${config.env}  database=${config.gcp.databaseId}`);
  console.log(`blocked users: ${snap.size}`);
  console.log(`  moderation blocks to clear: ${touch.length}`);
  for (const u of touch) console.log(`    ${u.id}  strikes=${u.strikes}  "${u.reason}"`);
  console.log(`  left alone (blocked by a person, or for another reason): ${skip.length}`);
  for (const u of skip) console.log(`    ${u.id}  "${u.reason}"`);

  if (!touch.length) {
    console.log('\nNothing to do.');
    return;
  }
  if (!confirm) {
    console.log('\nDRY RUN — nothing was written. Re-run with --confirm to apply.');
    return;
  }

  // Batched, and the strike counter is reset alongside the block: leaving it at 4
  // would re-block the user on their very next false positive.
  let written = 0;
  for (let i = 0; i < touch.length; i += 400) {
    const batch = db.batch();
    for (const u of touch.slice(i, i + 400)) {
      batch.set(
        db.collection(config.stats.appUsersCollection).doc(u.id),
        {
          blocked: false,
          blockedReason: null,
          blockedAt: null,
          moderationStrikes: 0,
          unblockedAt: new Date().toISOString(),
          unblockedBy: 'e3-migration',
        },
        { merge: true },
      );
      written += 1;
    }
    await batch.commit();
  }
  console.log(`\nUnblocked ${written} user(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
