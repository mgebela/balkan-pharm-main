/*
 * Shared Firestore lease so GitHub Actions + local watchers do not double-process
 * the same pending mint/market/growth doc.
 */
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export function workerId() {
  return process.env.QUEUE_WORKER_ID || 'local';
}

/**
 * Try to claim a doc for processing. Returns false if another worker holds a live lease.
 * @param {FirebaseFirestore.DocumentReference} ref
 * @param {number} [leaseMs]
 */
export async function tryClaimLease(ref, leaseMs = DEFAULT_LEASE_MS) {
  const db = ref.firestore;
  const id = workerId();
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('missing');
      const data = snap.data() || {};
      const until = data.processingUntil ? Date.parse(data.processingUntil) : 0;
      if (Number.isFinite(until) && until > Date.now() && data.processingBy !== id) {
        throw new Error('leased');
      }
      tx.update(ref, {
        processingUntil: new Date(Date.now() + leaseMs).toISOString(),
        processingBy: id,
      });
    });
    return true;
  } catch (err) {
    if (String(err && err.message) === 'leased' || String(err && err.message) === 'missing') {
      return false;
    }
    throw err;
  }
}

export async function clearLease(ref) {
  try {
    await ref.update({
      processingUntil: FieldValue.delete(),
      processingBy: FieldValue.delete(),
    });
  } catch {
    // ignore
  }
}
