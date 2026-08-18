/**
 * Market escrow reconcile — activates listings stuck in escrow_pending
 * once the NFT is confirmed in the escrow wallet.
 *
 * Uses plain Solana JSON-RPC (no @solana/web3.js) so Cloud Functions stay CJS-safe.
 * Rotates across public Devnet endpoints; prefer SOLANA_RPC_URL when set.
 */
const {getFirestore, FieldValue} = require('firebase-admin/firestore');

const ESCROW_ADDRESS =
  process.env.MARKET_ESCROW_ADDRESS ||
  'EmQ4nNB1YVWNKVEiPNYhLgJR2gY1deJoV2L743z945yD';
const LEGACY_ESCROW_ADDRESS =
  process.env.MARKET_LEGACY_ESCROW_ADDRESS ||
  'F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** If NFT never arrives after this, mark failed so the board stays clean. */
const STALE_MS = 48 * 60 * 60 * 1000;

const PUBLIC_DEVNET_RPCS = [
  'https://api.devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet',
  'https://endpoints.omniatech.io/v1/sol/devnet/public',
];

let preferredRpc = (process.env.SOLANA_RPC_URL || '').trim();

function setPreferredRpc(url) {
  preferredRpc = String(url || '').trim();
}

function rpcEndpoints() {
  const list = [];
  if (preferredRpc) list.push(preferredRpc);
  for (const url of PUBLIC_DEVNET_RPCS) {
    if (!list.includes(url)) list.push(url);
  }
  return list;
}

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
  const urls = rpcEndpoints();
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
      });
      const json = await res.json();
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`RPC ${res.status} from ${url}`);
        continue;
      }
      if (json.error) {
        const msg = json.error.message || JSON.stringify(json.error);
        if (/429|Too Many Requests|rate limit|capacity/i.test(msg)) {
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }
      return json.result;
    } catch (err) {
      lastErr = err;
      const msg = String((err && err.message) || err);
      if (/429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|503/i.test(msg)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('All Solana RPC endpoints failed for ' + method);
}

async function escrowHoldsNft(mintAddress) {
  const owners = [ESCROW_ADDRESS];
  if (LEGACY_ESCROW_ADDRESS && LEGACY_ESCROW_ADDRESS !== ESCROW_ADDRESS) {
    owners.push(LEGACY_ESCROW_ADDRESS);
  }
  for (const owner of owners) {
    const result = await rpc('getTokenAccountsByOwner', [
      owner,
      {mint: mintAddress},
      {encoding: 'jsonParsed', commitment: 'confirmed'},
    ]);
    const values = (result && result.value) || [];
    const held = values.some((a) => {
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
    if (held) return true;
  }
  return false;
}

async function countSettlementPending() {
  const db = getFirestore();
  const [sales, cancels] = await Promise.all([
    db.collection('marketListings').where('status', '==', 'sale_pending').get(),
    db.collection('marketListings').where('status', '==', 'cancel_requested').get(),
  ]);
  return {
    salePending: sales.size,
    cancelRequested: cancels.size,
  };
}

/**
 * @returns {Promise<{checked:number, activated:number, staleFailed:number, skipped:number, errors:string[], salePending:number, cancelRequested:number}>}
 */
async function reconcileEscrowPending() {
  const db = getFirestore();
  const snap = await db.collection('marketListings')
      .where('status', '==', 'escrow_pending')
      .get();

  const settlement = await countSettlementPending();
  const result = {
    checked: snap.size,
    activated: 0,
    staleFailed: 0,
    skipped: 0,
    errors: [],
    salePending: settlement.salePending,
    cancelRequested: settlement.cancelRequested,
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
      if (!createdMs(data)) {
        result.skipped += 1;
        continue;
      }
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
  setPreferredRpc,
  ESCROW_ADDRESS,
  TOKEN_PROGRAM,
};
