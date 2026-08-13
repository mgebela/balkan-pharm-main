/*
 * Marketplace settlement (M4, devnet MVP).
 *
 * Listings live in the Firestore `marketListings` collection. Flow:
 *   1. Seller escrows the NFT: signs a transfer to the authority wallet in
 *      the app and creates the listing with status "escrow_pending".
 *      → this script verifies the escrow holds the NFT and flips it "active".
 *   2. Buyer pays the seller in $GROWTOO (signed in the app) and sets the
 *      listing to "sale_pending" with the payment signature.
 *      → this script verifies the payment on-chain, transfers the NFT from
 *        escrow to the buyer and marks the listing "sold".
 *   3. Seller may set "cancel_requested" while active.
 *      → this script returns the NFT and marks the listing "cancelled".
 *
 * The swap is queue-mediated (not atomic) — acceptable for the devnet MVP;
 * an on-chain escrow program is the mainnet path.
 *
 * Usage: node process-market.js [--watch]
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { publicKey, transactionBuilder, createSignerFromKeypair } from '@metaplex-foundation/umi';
import {
  mplToolbox,
  createTokenIfMissing,
  transferTokens,
  findAssociatedTokenPda,
} from '@metaplex-foundation/mpl-toolbox';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createRequire } from 'node:module';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirestore } from './firebase.js';
import { createMarketClient } from './mint-seed-lib.js';
import { RPC_URL, readDeployed, LEGACY_ESCROW_ADDRESS } from './common.js';
import { tryClaimLease, clearLease, workerId } from './queue-lease.js';
import { isRetryableChainError } from './retryable.js';
import { notifyUser } from './notify-user.js';

const require = createRequire(import.meta.url);
const { claimPaymentSignature } = require('../functions/used-payment-signatures.js');

const db = initFirestore();
/** Unpaid invest reservations older than this are released back to active. */
const RESERVATION_TTL_MS = 15 * 60 * 1000;
const {
  umi,
  escrowSigner,
  escrowAddress: ESCROW,
  feePayerAddress,
  legacyEscrowAddress,
  mintAuthoritySecret,
} = createMarketClient();
umi.use(mplToolbox());
const connection = new Connection(RPC_URL, 'confirmed');
const watch = process.argv.includes('--watch');
const legacyEscrowSigner = umi.eddsa.createKeypairFromSecretKey(mintAuthoritySecret);
const LEGACY_ESCROW = legacyEscrowAddress || LEGACY_ESCROW_ADDRESS;

const deployed = readDeployed();
if (!deployed.growMint) {
  console.error('$GROWTOO mint not deployed yet. Run "npm run deploy:grow" first.');
  process.exit(1);
}
const GROW_MINT = deployed.growMint;
const GROW_DECIMALS = Number(deployed.growDecimals || 9);
const EXPECTED_ESCROW = deployed.escrowAddress || ESCROW;

console.log('Escrow vault:', ESCROW);
console.log('Fee payer:   ', feePayerAddress);
console.log('Legacy escrow (open listings):', LEGACY_ESCROW);
console.log('Worker:', workerId());
if (ESCROW !== EXPECTED_ESCROW) {
  console.error(
    `Escrow key ${ESCROW} does not match deployed.escrowAddress ${EXPECTED_ESCROW}. Refusing to settle.`
  );
  process.exit(1);
}

async function walletHoldsNft(ownerAddress, mintAddress) {
  const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(ownerAddress), {
    mint: new PublicKey(mintAddress),
  });
  return accounts.value.some(
    (a) => Number(a.account.data.parsed.info.tokenAmount.amount) >= 1
  );
}

async function findEscrowHolder(mintAddress) {
  if (await walletHoldsNft(ESCROW, mintAddress)) {
    return { address: ESCROW, signer: escrowSigner };
  }
  if (LEGACY_ESCROW !== ESCROW && (await walletHoldsNft(LEGACY_ESCROW, mintAddress))) {
    return { address: LEGACY_ESCROW, signer: legacyEscrowSigner };
  }
  return null;
}

async function escrowHoldsNft(mintAddress) {
  return !!(await findEscrowHolder(mintAddress));
}

/*
 * Verify the buyer's $GROWTOO payment: the referenced transaction must be
 * confirmed and increase the seller's $GROWTOO balance by at least the price.
 * When buyerPubkey is known, also require that buyer’s $GROWTOO decreased.
 */
async function verifyGrowPayment(signature, sellerPubkey, priceGrow, buyerPubkey) {
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error('Payment transaction not found on devnet: ' + signature);
  if (tx.meta && tx.meta.err) throw new Error('Payment transaction failed on-chain.');

  const pre = (tx.meta.preTokenBalances || []).filter(
    (b) => b.mint === GROW_MINT && b.owner === sellerPubkey
  );
  const post = (tx.meta.postTokenBalances || []).filter(
    (b) => b.mint === GROW_MINT && b.owner === sellerPubkey
  );
  const preAmount = pre.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const postAmount = post.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const received = postAmount - preAmount;
  const required = BigInt(priceGrow) * 10n ** BigInt(GROW_DECIMALS);
  if (received < required) {
    throw new Error(
      `Payment too low: seller received ${received} base units, listing requires ${required}.`
    );
  }

  if (buyerPubkey) {
    const preBuyer = (tx.meta.preTokenBalances || []).filter(
      (b) => b.mint === GROW_MINT && b.owner === buyerPubkey
    );
    const postBuyer = (tx.meta.postTokenBalances || []).filter(
      (b) => b.mint === GROW_MINT && b.owner === buyerPubkey
    );
    const preB = preBuyer.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const postB = postBuyer.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    if (preB - postB < required) {
      throw new Error(
        'Payment does not debit the claimed buyer wallet by the listing price.'
      );
    }
  }
}

async function transferNftFromEscrow(mintAddress, destinationPubkey) {
  const mint = publicKey(mintAddress);
  const destOwner = publicKey(destinationPubkey);
  const holder = await findEscrowHolder(mintAddress);
  if (!holder) {
    // Maybe already delivered.
    try {
      if (await walletHoldsNft(destinationPubkey, mintAddress)) {
        return 'already-delivered';
      }
    } catch {
      // ignore
    }
    throw new Error('NFT is not in the current or legacy escrow wallet.');
  }

  const authority = createSignerFromKeypair(umi, holder.signer);
  const source = findAssociatedTokenPda(umi, { mint, owner: publicKey(holder.address) });
  const destination = findAssociatedTokenPda(umi, { mint, owner: destOwner });

  // If destination already holds the NFT, a prior settle already landed.
  try {
    if (await walletHoldsNft(destinationPubkey, mintAddress)) {
      return 'already-delivered';
    }
  } catch {
    // fall through to transfer
  }

  try {
    const result = await transactionBuilder()
      .add(createTokenIfMissing(umi, { mint, owner: destOwner }))
      .add(
        transferTokens(umi, {
          source,
          destination,
          amount: 1n,
          authority,
        })
      )
      .sendAndConfirm(umi);
    return base58.deserialize(result.signature)[0];
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const match = msg.match(/Signature\s+([1-9A-HJ-NP-Za-km-z]{64,100})\s+has expired/i);
    if (match) {
      const sig = match[1];
      // Public RPC often throws block-height exceeded after the tx already landed.
      for (let i = 0; i < 10; i += 1) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        try {
          const st = await connection.getSignatureStatuses([sig], {
            searchTransactionHistory: true,
          });
          const status = st.value && st.value[0];
          if (status && !status.err) {
            const conf = status.confirmationStatus;
            if (conf === 'confirmed' || conf === 'finalized' || status.confirmations != null) {
              return sig;
            }
          }
        } catch {
          // retry
        }
      }
      // Last chance: destination may already hold the NFT.
      try {
        if (await walletHoldsNft(destinationPubkey, mintAddress)) {
          return sig;
        }
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

async function fail(doc, label, err) {
  console.error(`✘ ${label}: ${err.message}`);
  const msg = String(err && err.message ? err.message : err);
  // Don't permanently fail on RPC/confirm flakes — leave pending for retry.
  if (isRetryableChainError(err)) {
    await doc.ref.update({
      lastError: msg,
      lastErrorAt: new Date().toISOString(),
    });
    console.warn(`… ${label}: left pending for retry (RPC/confirm flake)`);
    return;
  }
  await doc.ref.update({
    status: 'failed',
    error: msg,
    failedAt: new Date().toISOString(),
  });
}

function statusEnteredAt(data, status) {
  if (status === 'sale_pending') return data.investedAt || data.createdAt;
  if (status === 'cancel_requested') return data.cancelRequestedAt || data.updatedAt || data.createdAt;
  if (status === 'escrow_pending') return data.createdAt;
  return data.activatedAt || data.createdAt;
}

function ageMinutes(raw) {
  if (!raw) return null;
  let ms = null;
  if (typeof raw.toDate === 'function') ms = raw.toDate().getTime();
  else {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) ms = t;
  }
  if (ms == null) return null;
  return Math.round((Date.now() - ms) / 60000);
}

function isPendingPaymentReservation(data) {
  const sig = String(data.paymentSignature || '');
  return sig.startsWith('pending-');
}

async function processEscrowPending(doc) {
  const data = doc.data();
  const label = `listing ${data.name || doc.id} (escrow check)`;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased by another worker, skipping`);
    return;
  }
  try {
    if (!(await escrowHoldsNft(data.mintAddress))) {
      // NFT not received yet — leave pending, transfer may still be confirming.
      console.log(`… ${label}: escrow does not hold the NFT yet, skipping`);
      return;
    }
    await doc.ref.update({
      status: 'active',
      activatedAt: new Date().toISOString(),
      activatedBy: workerId(),
      error: FieldValue.delete(),
    });
    console.log(`✔ ${label}: NFT in escrow, listing is live`);
  } catch (err) {
    await fail(doc, label, err);
  } finally {
    await clearLease(doc.ref);
  }
}

async function processSalePending(doc) {
  const data = doc.data();
  // 50/50 adopt-stake sales are settled by process-adopt-stakes.js
  if (data.settlement === 'adopt_stake') return;
  const label = `listing ${data.name || doc.id} (sale to ${data.buyerPubkey || '?'})`;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased by another worker, skipping`);
    return;
  }
  try {
    if (!data.buyerPubkey || !data.paymentSignature) {
      throw new Error('Sale is missing buyerPubkey or paymentSignature.');
    }

    // Pre-pay reservation: wait for the buyer to attach a real signature, or release.
    if (isPendingPaymentReservation(data)) {
      const ageMin = ageMinutes(statusEnteredAt(data, 'sale_pending'));
      if (ageMin != null && ageMin * 60000 >= RESERVATION_TTL_MS) {
        // Archive before clearing — see the matching note in
        // process-adopt-stakes.js. A reservation is only presumed unpaid.
        await doc.ref.update({
          status: 'active',
          buyerUid: FieldValue.delete(),
          buyerPubkey: FieldValue.delete(),
          paymentSignature: FieldValue.delete(),
          investedAt: FieldValue.delete(),
          reservationExpiredAt: new Date().toISOString(),
          expiredReservations: FieldValue.arrayUnion({
            buyerUid: data.buyerUid || null,
            buyerPubkey: data.buyerPubkey || null,
            reservationId: data.paymentSignature || null,
            investedAt: data.investedAt || null,
            priceGrow: data.priceGrow || null,
            expiredAt: new Date().toISOString(),
          }),
          lastError: FieldValue.delete(),
        });
        console.warn(
          `… ${label}: unpaid reservation expired, listing reopened ` +
            `(archived buyerPubkey ${data.buyerPubkey || 'none'})`
        );
      } else {
        console.log(`… ${label}: waiting for payment signature`);
      }
      return;
    }

    await verifyGrowPayment(
      data.paymentSignature,
      data.sellerPubkey,
      data.priceGrow,
      data.buyerPubkey
    );
    await claimPaymentSignature(db, data.paymentSignature, doc.id, {
      buyerUid: data.buyerUid || null,
      buyerPubkey: data.buyerPubkey || null,
      source: workerId(),
    });
    const transferSignature = await transferNftFromEscrow(data.mintAddress, data.buyerPubkey);
    await doc.ref.update({
      status: 'sold',
      transferSignature,
      soldAt: new Date().toISOString(),
      settledBy: workerId(),
      error: FieldValue.delete(),
    });
    console.log(`✔ ${label}: payment verified, NFT released (${transferSignature})`);
    try {
      if (data.uid) {
        await notifyUser(db, data.uid, {
          type: 'stake_received',
          title: 'Investment settled',
          body:
            'Your offer "' +
            (data.name || 'plant') +
            '" sold for ' +
            data.priceGrow +
            ' $GROWTOO.',
          meta: {
            listingId: doc.id,
            priceGrow: data.priceGrow,
            buyerUid: data.buyerUid || null,
            key: 'sold:' + doc.id,
          },
          action: { view: 'market', listingId: doc.id },
          source: 'process-market',
        });
      }
      if (data.buyerUid) {
        await notifyUser(db, data.buyerUid, {
          type: 'sale_settled',
          title: 'NFT delivered',
          body: '"' + (data.name || 'Plant') + '" is in your garden.',
          meta: { listingId: doc.id, key: 'delivered:' + doc.id },
          action: { view: 'adopt' },
          source: 'process-market',
        });
      }
    } catch (notifyErr) {
      console.warn('notify after sale failed', notifyErr.message || notifyErr);
    }
  } catch (err) {
    await fail(doc, label, err);
  } finally {
    await clearLease(doc.ref);
  }
}

async function processCancelRequested(doc) {
  const data = doc.data();
  const label = `listing ${data.name || doc.id} (cancel)`;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased by another worker, skipping`);
    return;
  }
  try {
    const transferSignature = await transferNftFromEscrow(data.mintAddress, data.sellerPubkey);
    await doc.ref.update({
      status: 'cancelled',
      transferSignature,
      cancelledAt: new Date().toISOString(),
      settledBy: workerId(),
      error: FieldValue.delete(),
    });
    console.log(`✔ ${label}: NFT returned to seller (${transferSignature})`);
  } catch (err) {
    await fail(doc, label, err);
  } finally {
    await clearLease(doc.ref);
  }
}

const HANDLERS = {
  escrow_pending: processEscrowPending,
  sale_pending: processSalePending,
  cancel_requested: processCancelRequested,
};

const inFlight = new Set();

async function runHandler(doc) {
  const data = doc.data() || {};
  if (data.settlement === 'program') return; // on-chain path — no queue settle
  const status = data.status;
  const handler = HANDLERS[status];
  if (!handler) return;
  if (inFlight.has(doc.id)) return;
  inFlight.add(doc.id);
  try {
    await handler(doc);
  } finally {
    inFlight.delete(doc.id);
  }
}

async function processPending() {
  for (const [status, handler] of Object.entries(HANDLERS)) {
    const snap = await db.collection('marketListings').where('status', '==', status).get();
    if (snap.size) {
      console.log(`… ${status}: ${snap.size} listing(s)`);
    }
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (data.settlement === 'program') continue;
      const ageMin = ageMinutes(statusEnteredAt(data, status));
      if (ageMin != null && ageMin >= 30) {
        console.warn(
          `⚠ ${data.name || doc.id} has been ${status} for ~${ageMin} min` +
            (status === 'escrow_pending'
              ? ' — Cloud Function reconcileMarketEscrow should pick this up if NFT is in escrow.'
              : ' — GitHub Actions market:queue / local market:queue should settle this.')
        );
      }
      await handler(doc);
    }
  }
  console.log('Market queue pass complete.');
}

await processPending();

if (watch) {
  console.log('Watching marketplace listings (Ctrl+C to stop)…');
  db.collection('marketListings')
    .where('status', 'in', Object.keys(HANDLERS))
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          runHandler(change.doc);
        }
      });
    });
} else {
  process.exit(0);
}
