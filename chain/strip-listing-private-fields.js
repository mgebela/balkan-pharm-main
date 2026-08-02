/*
 * One-shot: remove journalSnippets + photo from existing marketListings docs.
 * Full docs stay signed-in-only; this shrinks residual private payloads.
 *
 *   node chain/strip-listing-private-fields.js
 */
import {FieldValue} from 'firebase-admin/firestore';
import {initFirestore} from './firebase.js';

async function main() {
  const db = initFirestore();
  const snap = await db.collection('marketListings').get();
  let touched = 0;
  let batch = db.batch();
  let ops = 0;

  async function flush() {
    if (!ops) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!('journalSnippets' in data) && !('photo' in data)) continue;
    batch.update(doc.ref, {
      journalSnippets: FieldValue.delete(),
      photo: FieldValue.delete(),
    });
    touched += 1;
    ops += 1;
    if (ops >= 400) await flush();
  }
  await flush();
  console.log(JSON.stringify({ok: true, scanned: snap.size, stripped: touched}, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
