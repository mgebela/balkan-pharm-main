#!/usr/bin/env node
/**
 * Wipe all synthetic traffic agents and the data they created.
 * Deletes Auth users, user docs / app state, market listings, public journal,
 * and related sim docs tagged trafficAgent / trafficBatch / traffic_listing_.
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

async function tryDeleteQuery(db, query, label) {
  try {
    return await deleteQueryInChunks(db, query, label);
  } catch (err) {
    console.warn(`${label} wipe skipped`, err.message || err);
    return 0;
  }
}

async function deleteByIdPrefix(db, collection, prefix, label) {
  const snap = await db.collection(collection).limit(500).get();
  const doomed = snap.docs.filter((d) => String(d.id).startsWith(prefix));
  if (!doomed.length) return 0;
  const batch = db.batch();
  doomed.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`  … deleted ${doomed.length} ${label} by id prefix ${prefix}`);
  return doomed.length;
}

async function collectAgentUsers(db) {
  const byId = new Map();
  const addSnap = (snap) => {
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      const email = String(data.email || '');
      if (data.trafficAgent === true || email.startsWith('traffic+')) {
        byId.set(d.id, d);
      }
    });
  };

  try {
    addSnap(await db.collection('users').where('trafficAgent', '==', true).get());
  } catch (err) {
    console.warn('users trafficAgent query skipped', err.message || err);
  }
  try {
    addSnap(await db.collection('users').where('trafficBatch', '==', TRAFFIC_BATCH).get());
  } catch (err) {
    console.warn('users trafficBatch query skipped', err.message || err);
  }

  const creds = readCredsFile();
  if (creds && Array.isArray(creds.accounts)) {
    for (const account of creds.accounts) {
      if (!account || !account.uid || byId.has(account.uid)) continue;
      const ref = db.collection('users').doc(account.uid);
      const doc = await ref.get();
      if (doc.exists) byId.set(doc.id, doc);
      else byId.set(account.uid, { id: account.uid, ref, data: () => ({ email: account.email || '' }) });
    }
  }

  return [...byId.values()];
}

async function deleteUserTree(db, uid) {
  for (const sub of ['app', 'notifications', 'growerPosts']) {
    const snap = await db.collection('users').doc(uid).collection(sub).limit(400).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  const rewards = await db
    .collection('platformRewards')
    .where('uid', '==', uid)
    .limit(50)
    .get()
    .catch(() => null);
  if (rewards && !rewards.empty) {
    const batch = db.batch();
    rewards.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function main() {
  const { db } = initTraffic();
  console.log(`Traffic wipe · all agents (batch tag ${TRAFFIC_BATCH})`);

  const listingsDeleted =
    (await tryDeleteQuery(
      db,
      db.collection('marketListings').where('trafficAgent', '==', true),
      'marketListings(agent)'
    )) +
    (await tryDeleteQuery(
      db,
      db.collection('marketListings').where('trafficBatch', '==', TRAFFIC_BATCH),
      'marketListings(batch)'
    ));

  const journalDeleted =
    (await tryDeleteQuery(
      db,
      db.collection('publicJournalPosts').where('trafficAgent', '==', true),
      'publicJournalPosts(agent)'
    )) +
    (await tryDeleteQuery(
      db,
      db.collection('publicJournalPosts').where('trafficBatch', '==', TRAFFIC_BATCH),
      'publicJournalPosts(batch)'
    ));

  const profilesDeleted =
    (await tryDeleteQuery(
      db,
      db.collection('publicGrowerProfiles').where('trafficAgent', '==', true),
      'publicGrowerProfiles(agent)'
    )) +
    (await tryDeleteQuery(
      db,
      db.collection('publicGrowerProfiles').where('trafficBatch', '==', TRAFFIC_BATCH),
      'publicGrowerProfiles(batch)'
    ));

  const claimsDeleted = await tryDeleteQuery(
    db,
    db.collection('publicSlugClaims').where('trafficBatch', '==', TRAFFIC_BATCH),
    'publicSlugClaims'
  );

  let stakesDeleted = await tryDeleteQuery(
    db,
    db.collection('adoptStakes').where('trafficBatch', '==', TRAFFIC_BATCH),
    'adoptStakes'
  );
  stakesDeleted += await deleteByIdPrefix(db, 'adoptStakes', 'traffic_listing_', 'adoptStakes');
  const harvestDeleted = await deleteByIdPrefix(db, 'harvestClaims', 'traffic_listing_', 'harvestClaims');

  const userDocs = await collectAgentUsers(db);
  console.log(`Users tagged: ${userDocs.length}`);

  for (const userDoc of userDocs) {
    const uid = userDoc.id;
    const email = (userDoc.data() || {}).email || '';
    await deleteUserTree(db, uid);
    try {
      await userDoc.ref.delete();
    } catch (err) {
      console.warn(`… user doc ${uid}: ${err.message || err}`);
    }
    try {
      await deleteAuthUser(uid);
      console.log(`✔ deleted Auth ${email || uid}`);
    } catch (err) {
      console.warn(`… Auth delete ${uid}: ${err.message || err}`);
    }
  }

  if (fs.existsSync(CREDS_PATH)) {
    fs.unlinkSync(CREDS_PATH);
    console.log(`✔ removed ${CREDS_PATH}`);
  } else {
    console.log('… no creds file');
  }

  console.log(
    `Done · listings ${listingsDeleted} · journal ${journalDeleted} · profiles ${profilesDeleted} · claims ${claimsDeleted} · adoptStakes ${stakesDeleted} · harvestClaims ${harvestDeleted} · users ${userDocs.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
