/**
 * Market escrow reconcile — activates listings stuck in escrow_pending
 * once the NFT is confirmed in the escrow wallet.
 *
 * Uses plain Solana JSON-RPC (no @solana/web3.js) so Cloud Functions stay CJS-safe.
 */
const {getFirestore, FieldValue} = require('firebase-admin/firestore');

const ESCROW_ADDRESS = 'F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** If NFT never arrives after this, mark failed so the board stays clean. */
const STALE_MS = 48 * 60 * 60 * 1000;

function createdMs(data) {
  if (data.createdAt && typeof data.createdAt.toDate === 'function') {
    return data.createdAt.toDate().getTime();
  }
  if (typeof data.createdAt === 'string') {
    const t = Date.parse(data.createdAt);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  return json.result;
}

async function escrowHoldsNft(mintAddress) {
  const result = await rpc('getTokenAccountsByOwner', [
    ESCROW_ADDRESS,
    {mint: mintAddress},
    {encoding: 'jsonParsed', commitment: 'confirmed'},
  ]);
  const values = (result && result.value) || [];
  return values.some((a) => {
    const amount =
      a &&
      a.account &&
      a.account.data &&
      a.account.data.parsed &&
      a.account.data.parsed.info &&
      a.account.data.parsed.info.tokenAmount &&
      a.account.data.parsed.info.tokenAmount.amount;
    return Number(amount || 0) >= 1;
  });
}

/**
 * @returns {Promise<{checked:number, activated:number, staleFailed:number, skipped:number, errors:string[]}>}
 */
async function reconcileEscrowPending() {
  const db = getFirestore();
  const snap = await db.collection('marketListings')
      .where('status', '==', 'escrow_pending')
      .get();

  const result = {
    checked: snap.size,
    activated: 0,
    staleFailed: 0,
    skipped: 0,
    errors: [],
  };

  const now = Date.now();

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const label = data.name || doc.id;
    try {
      if (!data.mintAddress) {
        result.skipped += 1;
        continue;
      }

      const held = await escrowHoldsNft(data.mintAddress);
      if (held) {
        await doc.ref.update({
          status: 'active',
          activatedAt: new Date().toISOString(),
          activatedBy: 'reconcileMarketEscrow',
          error: FieldValue.delete(),
          lastError: FieldValue.delete(),
        });
        result.activated += 1;
        console.log('activated', label, doc.id);
        continue;
      }

      const age = now - createdMs(data);
      if (age > STALE_MS) {
        await doc.ref.update({
          status: 'failed',
          error: 'Escrow NFT never arrived in the escrow wallet within 48h.',
          failedAt: new Date().toISOString(),
          failedBy: 'reconcileMarketEscrow',
        });
        result.staleFailed += 1;
        console.warn('stale-failed', label, doc.id);
        continue;
      }

      result.skipped += 1;
    } catch (err) {
      const msg = (err && err.message) || String(err);
      result.errors.push(label + ': ' + msg);
      console.error('reconcile error', label, msg);
      try {
        await doc.ref.update({
          lastError: msg,
          lastErrorAt: new Date().toISOString(),
        });
      } catch (_) {
        // ignore secondary write failures
      }
    }
  }

  return result;
}

module.exports = {
  reconcileEscrowPending,
  ESCROW_ADDRESS,
  TOKEN_PROGRAM,
};
