/*
 * One payment signature → one market listing.
 * Prevents replaying a public Solana $GROWTOO payment tx against multiple asks.
 */
'use strict';

const COLLECTION = 'usedPaymentSignatures';

function isRealPaymentSignature(signature) {
  const sig = String(signature || '').trim();
  if (!sig) return false;
  if (sig.startsWith('pending-')) return false;
  // Solana tx signatures are base58; reject path separators for safe doc ids.
  if (sig.includes('/') || sig.includes('\\')) return false;
  return sig.length >= 32;
}

function isSignatureConflict(err) {
  const msg = String((err && err.message) || err || '');
  return /already used|ALREADY_EXISTS|already exists/i.test(msg);
}

/**
 * Atomically reserve/consume a payment signature for a listing.
 * Idempotent when the same listingId already owns the signature.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} signature
 * @param {string} listingId
 * @param {object} [meta]
 */
async function claimPaymentSignature(db, signature, listingId, meta) {
  if (!isRealPaymentSignature(signature)) {
    throw new Error('Invalid payment signature for consumption.');
  }
  if (!listingId) throw new Error('listingId required to claim payment signature.');

  const sig = String(signature).trim();
  const ref = db.collection(COLLECTION).doc(sig);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const prev = snap.data() || {};
      if (String(prev.listingId || '') === String(listingId)) {
        return; // idempotent re-settle / re-write
      }
      const err = new Error(
          'Payment signature already used by listing ' + (prev.listingId || '?'),
      );
      err.code = 'payment-signature-reused';
      throw err;
    }
    tx.create(ref, {
      listingId: String(listingId),
      consumedAt: new Date().toISOString(),
      buyerUid: (meta && meta.buyerUid) || null,
      buyerPubkey: (meta && meta.buyerPubkey) || null,
      source: (meta && meta.source) || 'settle',
    });
  });
}

/**
 * After a listing write: reserve a newly attached real payment signature.
 * If another listing already consumed it, revert this sale_pending claim.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} listingId
 * @param {object|null} before
 * @param {object|null} after
 * @param {FirebaseFirestore.DocumentReference} ref
 * @param {typeof import('firebase-admin/firestore').FieldValue} FieldValue
 */
async function reservePaymentSignatureOnListingWrite(
    db,
    listingId,
    before,
    after,
    ref,
    FieldValue,
) {
  if (!after) return {reserved: false};
  const sig = String(after.paymentSignature || '').trim();
  if (!isRealPaymentSignature(sig)) return {reserved: false};

  const status = String(after.status || '');
  if (status !== 'sale_pending' && status !== 'sold') return {reserved: false};

  const beforeSig = before ? String(before.paymentSignature || '').trim() : '';
  const sigChanged = sig !== beforeSig;
  const statusChanged = !before || String(before.status || '') !== status;
  if (!sigChanged && !statusChanged) return {reserved: false};

  try {
    await claimPaymentSignature(db, sig, listingId, {
      buyerUid: after.buyerUid || null,
      buyerPubkey: after.buyerPubkey || null,
      source: 'listing-write',
    });
    return {reserved: true};
  } catch (err) {
    if (!isSignatureConflict(err)) throw err;
    if (status === 'sale_pending') {
      await ref.update({
        status: 'active',
        buyerUid: FieldValue.delete(),
        buyerPubkey: FieldValue.delete(),
        paymentSignature: FieldValue.delete(),
        investedAt: FieldValue.delete(),
        lastError: 'Payment signature already used on another listing',
        lastErrorAt: new Date().toISOString(),
      });
      return {reserved: false, reverted: true};
    }
    throw err;
  }
}

module.exports = {
  COLLECTION,
  isRealPaymentSignature,
  isSignatureConflict,
  claimPaymentSignature,
  reservePaymentSignatureOnListingWrite,
};
