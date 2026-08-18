/*
 * Process pending seed mint requests from Firestore (M2).
 *
 * The app (importSeed) writes mint requests to the `seedMints` collection.
 * This script mints each pending request as a real Seed NFT on devnet and
 * writes the mint address + metadata URI back to the request document, where
 * the app picks it up live.
 *
 * Usage: node process-seed-mints.js [--watch]
 *   --watch  keep running and process new requests as they arrive
 */
import { FieldValue } from 'firebase-admin/firestore';
import { initFirestore } from './firebase.js';
import { createMintClient, mintSeedNft } from './mint-seed-lib.js';
import { tryClaimLease, clearLease, workerId } from './queue-lease.js';
import { isRetryableChainError } from './retryable.js';

const db = initFirestore();
const umi = createMintClient();
const watch = process.argv.includes('--watch');

console.log('Authority:', String(umi.identity.publicKey));
console.log('Worker:', workerId());

async function processDoc(doc) {
  const data = doc.data();
  const label = `${data.name || doc.id} (uid ${data.uid || '?'})`;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased by another worker, skipping`);
    return;
  }
  console.log(`Minting ${label}…`);
  try {
    const plantId = data.plantId || null;
    if (!plantId) {
      throw new Error('Seed mint requires a linked journal plantId.');
    }
    const stateSnap = await db
      .collection('users')
      .doc(data.uid)
      .collection('app')
      .doc('state')
      .get();
    const plants = (stateSnap.exists && Array.isArray(stateSnap.data().plants))
      ? stateSnap.data().plants
      : [];
    if (!plants.some((p) => p && String(p.id) === String(plantId))) {
      throw new Error('Plant not found in grower journal — cannot mint seed.');
    }
    const samePlant = await db.collection('seedMints').where('plantId', '==', plantId).get();
    const clash = samePlant.docs.find((d) => {
      if (d.id === doc.id) return false;
      const row = d.data() || {};
      return row.uid === data.uid && (row.status === 'pending' || row.status === 'minted');
    });
    if (clash) {
      throw new Error(
        'A seed mint for this plant is already ' + (clash.data().status || 'filed') + '.',
      );
    }
    const result = await mintSeedNft(
      umi,
      {
        name: data.name,
        strain: data.strain,
        batch: data.batch,
        plantId: data.plantId || null,
        importedAt: data.requestedAt || undefined,
      },
      { recipient: data.recipient || undefined }
    );
    await doc.ref.update({
      status: 'minted',
      mintAddress: result.mint,
      metadataUri: result.metadataUri,
      signature: result.signature,
      owner: result.owner,
      mintedAt: new Date().toISOString(),
      mintedBy: workerId(),
      error: FieldValue.delete(),
    });
    console.log(`✔ ${label}: ${result.mint}`);
  } catch (err) {
    console.error(`✘ ${label}: ${err.message}`);
    if (isRetryableChainError(err)) {
      await doc.ref.update({
        lastError: String(err.message || err),
        lastErrorAt: new Date().toISOString(),
      });
      console.warn(`… ${label}: left pending for retry`);
    } else {
      await doc.ref.update({
        status: 'failed',
        error: String(err.message || err),
        failedAt: new Date().toISOString(),
      });
    }
  } finally {
    await clearLease(doc.ref);
  }
}

async function processPending() {
  const snap = await db.collection('seedMints').where('status', '==', 'pending').get();
  if (snap.empty) {
    console.log('No pending seed mint requests.');
    return;
  }
  for (const doc of snap.docs) {
    await processDoc(doc);
  }
}

await processPending();

if (watch) {
  console.log('Watching for new seed mint requests (Ctrl+C to stop)…');
  db.collection('seedMints')
    .where('status', '==', 'pending')
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') processDoc(change.doc);
      });
    });
} else {
  process.exit(0);
}
