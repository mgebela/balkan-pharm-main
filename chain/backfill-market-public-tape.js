/*
 * One-shot: mirror scrubbed marketListings → marketPublicTape for the landing page.
 * Run after deploying firestore rules that lock marketListings to signed-in reads.
 *
 *   node chain/backfill-market-public-tape.js
 */
import {createRequire} from 'node:module';
import {initFirestore} from './firebase.js';

const require = createRequire(import.meta.url);
const {
  scrubPublicListing,
  PUBLIC_COLLECTION,
} = require('../functions/market-public-tape.js');

async function main() {
  const db = initFirestore();
  const snap = await db.collection('marketListings').get();
  let upserted = 0;
  let removed = 0;
  let batch = db.batch();
  let ops = 0;

  async function flush() {
    if (!ops) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }

  for (const doc of snap.docs) {
    const scrubbed = scrubPublicListing(doc.data());
    const ref = db.collection(PUBLIC_COLLECTION).doc(doc.id);
    if (scrubbed) {
      batch.set(ref, scrubbed, {merge: false});
      upserted += 1;
    } else {
      batch.delete(ref);
      removed += 1;
    }
    ops += 1;
    if (ops >= 400) await flush();
  }
  await flush();
  console.log(
    JSON.stringify(
      {ok: true, scanned: snap.size, upserted, removed, collection: PUBLIC_COLLECTION},
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
