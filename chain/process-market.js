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
import { publicKey, transactionBuilder } from '@metaplex-foundation/umi';
import {
  mplToolbox,
  createTokenIfMissing,
  transferTokens,
  findAssociatedTokenPda,
} from '@metaplex-foundation/mpl-toolbox';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirestore } from './firebase.js';
import { createMintClient } from './mint-seed-lib.js';
import { RPC_URL, readDeployed } from './common.js';
import { tryClaimLease, clearLease, workerId } from './queue-lease.js';

const db = initFirestore();
const umi = createMintClient().use(mplToolbox());
const connection = new Connection(RPC_URL, 'confirmed');
const watch = process.argv.includes('--watch');

const deployed = readDeployed();
if (!deployed.growMint) {
  console.error('$GROWTOO mint not deployed yet. Run "npm run deploy:grow" first.');
  process.exit(1);
}
const GROW_MINT = deployed.growMint;
const GROW_DECIMALS = Number(deployed.growDecimals || 9);
const ESCROW = String(umi.identity.publicKey);

console.log('Escrow (authority):', ESCROW);
console.log('Worker:', workerId());

async function escrowHoldsNft(mintAddress) {
  const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(ESCROW), {
    mint: new PublicKey(mintAddress),
  });
  return accounts.value.some(
    (a) => Number(a.account.data.parsed.info.tokenAmount.amount) >= 1
  );
}

/*
 * Verify the buyer's $GROWTOO payment: the referenced transaction must be
 * confirmed and increase the seller's $GROWTOO balance by at least the price.
 */
async function verifyGrowPayment(signature, sellerPubkey, priceGrow) {
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
}

async function transferNftFromEscrow(mintAddress, destinationPubkey) {
  const mint = publicKey(mintAddress);
  const destOwner = publicKey(destinationPubkey);
  const source = findAssociatedTokenPda(umi, { mint, owner: umi.identity.publicKey });
  const destination = findAssociatedTokenPda(umi, { mint, owner: destOwner });

  // If destination already holds the NFT, a prior settle already landed.
  try {
    const destAccounts = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(destinationPubkey),
      { mint: new PublicKey(mintAddress) }
    );
    if (
      destAccounts.value.some(
        (a) => Number(a.account.data.parsed.info.tokenAmount.amount) >= 1
      )
    ) {
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
        const destAccounts = await connection.getParsedTokenAccountsByOwner(
          new PublicKey(destinationPubkey),
          { mint: new PublicKey(mintAddress) }
        );
        if (
          destAccounts.value.some(
            (a) => Number(a.account.data.parsed.info.tokenAmount.amount) >= 1
          )
        ) {
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
  // Don't permanently fail on RPC confirm timeouts — leave pending for retry.
  const msg = String(err && err.message ? err.message : err);
  if (/block height exceeded|has expired|429|Too Many Requests/i.test(msg)) {
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
  const label = `listing ${data.name || doc.id} (sale to ${data.buyerPubkey || '?'})`;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased by another worker, skipping`);
    return;
  }
  try {
    if (!data.buyerPubkey || !data.paymentSignature) {
      throw new Error('Sale is missing buyerPubkey or paymentSignature.');
    }
    await verifyGrowPayment(data.paymentSignature, data.sellerPubkey, data.priceGrow);
    const transferSignature = await transferNftFromEscrow(data.mintAddress, data.buyerPubkey);
    await doc.ref.update({
      status: 'sold',
      transferSignature,
      soldAt: new Date().toISOString(),
      settledBy: workerId(),
      error: FieldValue.delete(),
    });
    console.log(`✔ ${label}: payment verified, NFT released (${transferSignature})`);
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

async function processPending() {
  for (const [status, handler] of Object.entries(HANDLERS)) {
    const snap = await db.collection('marketListings').where('status', '==', status).get();
    if (snap.size) {
      console.log(`… ${status}: ${snap.size} listing(s)`);
    }
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const created = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
      const ageMin = created ? Math.round((Date.now() - created.getTime()) / 60000) : null;
      if (ageMin != null && ageMin >= 30) {
        console.warn(
          `⚠ ${data.name || doc.id} has been ${status} for ~${ageMin} min` +
            ' — Cloud Function reconcileMarketEscrow should pick this up if NFT is in escrow.'
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
          const handler = HANDLERS[change.doc.data().status];
          if (handler) handler(change.doc);
        }
      });
    });
} else {
  process.exit(0);
}
