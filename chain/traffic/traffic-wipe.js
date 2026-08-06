#!/usr/bin/env node
/**
 * Wipe traffic batch: Auth users, user docs / app state, marketListings.
 * Only deletes documents tagged trafficAgent + trafficBatch.
 *
 * Usage (from chain/): npm run traffic:wipe
 */
import fs from 'node:fs';
import {
  initTraffic,
  deleteQueryInChunks,
  deleteAuthUser,
  CREDS_PATH,
  readCredsFile,
} from './helpers.js';
import { TRAFFIC_BATCH } from './personas.js';

async function main() {
  const { db } = initTraffic();
  console.log(`Traffic wipe · batch ${TRAFFIC_BATCH}`);

  // Listings first
  const listingsDeleted = await deleteQueryInChunks(
    db,
    db.collection('marketListings').where('trafficBatch', '==', TRAFFIC_BATCH),
    'marketListings'
  );

  // adoptStakes mirrors (if any were written by care sync)
  let stakesDeleted = 0;
  try {
    stakesDeleted = await deleteQueryInChunks(
      db,
      db.collection('adoptStakes').where('trafficBatch', '==', TRAFFIC_BATCH),
      'adoptStakes'
    );
  } catch {
    // Collection may lack the field / index — fall through to uid-based cleanup below
  }

  const usersSnap = await db
    .collection('users')
    .where('trafficBatch', '==', TRAFFIC_BATCH)
    .get();

  const userDocs = usersSnap.docs.filter((d) => (d.data() || {}).trafficAgent === true);

  console.log(`Users tagged: ${userDocs.length}`);

  for (const userDoc of userDocs) {
    const uid = userDoc.id;
    const email = (userDoc.data() || {}).email || '';

    // Subcollections under users/{uid}
    const appSnap = await db.collection('users').doc(uid).collection('app').get();
    if (!appSnap.empty) {
      const batch = db.batch();
      appSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    const notifSnap = await db
      .collection('users')
      .doc(uid)
      .collection('notifications')
      .limit(400)
      .get();
    if (!notifSnap.empty) {
      const batch = db.batch();
      notifSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    await userDoc.ref.delete();

    try {
      await deleteAuthUser(uid);
      console.log(`✔ deleted Auth ${email || uid}`);
    } catch (err) {
      console.warn(`… Auth delete ${uid}: ${err.message || err}`);
    }
  }

  // Orphan adoptStakes by listing id prefix if index missing
  if (!stakesDeleted) {
    const prefix = 'traffic_listing_';
    const allActive = await db.collection('adoptStakes').limit(500).get();
    const doomed = allActive.docs.filter((d) => String(d.id).startsWith(prefix));
    if (doomed.length) {
      const batch = db.batch();
      doomed.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      stakesDeleted = doomed.length;
    }
  }

  if (fs.existsSync(CREDS_PATH)) {
    fs.unlinkSync(CREDS_PATH);
    console.log(`✔ removed ${CREDS_PATH}`);
  } else {
    const creds = readCredsFile();
    if (!creds) console.log('… no creds file');
  }

  console.log(
    `Done · listings ${listingsDeleted} · adoptStakes ${stakesDeleted} · users ${userDocs.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
