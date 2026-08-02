/*
 * One-shot: reserve payment signatures already attached to sale_pending/sold listings
 * so historical Solscan-linked txs cannot be replayed against new asks.
 *
 *   node chain/backfill-used-payment-signatures.js
 */
import { createRequire } from 'node:module';
import { initFirestore } from './firebase.js';

const require = createRequire(import.meta.url);
const {
  claimPaymentSignature,
  isRealPaymentSignature,
  isSignatureConflict,
} = require('../functions/used-payment-signatures.js');

async function main() {
  const db = initFirestore();
  const snap = await db.collection('marketListings').get();
  let claimed = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const status = String(data.status || '');
    if (status !== 'sale_pending' && status !== 'sold') {
      skipped += 1;
      continue;
    }
    const sig = data.paymentSignature || data.buySignature;
    if (!isRealPaymentSignature(sig)) {
      skipped += 1;
      continue;
    }
    try {
      await claimPaymentSignature(db, sig, doc.id, {
        buyerUid: data.buyerUid || null,
        buyerPubkey: data.buyerPubkey || null,
        source: 'backfill',
      });
      claimed += 1;
    } catch (err) {
      if (isSignatureConflict(err)) {
        conflicts += 1;
        console.warn('conflict', doc.id, String(err.message || err));
      } else {
        throw err;
      }
    }
  }

  console.log(
    JSON.stringify({ ok: true, scanned: snap.size, claimed, skipped, conflicts }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
