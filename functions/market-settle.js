/**
 * Market buy/cancel settlement in Cloud Functions.
 * Verifies $GROWTOO payment (or cancel), then releases the NFT from escrow
 * (current vault or legacy mint-authority wallet) using fee-payer + escrow keys.
 *
 * Env (from functions/.env.<project>, gitignored):
 *   SOLANA_RPC_URL
 *   MARKET_ESCROW_ADDRESS / MARKET_LEGACY_ESCROW_ADDRESS
 *   MARKET_FEE_PAYER_KEY_JSON — secret key byte array JSON
 *   MARKET_ESCROW_KEY_JSON
 *   MARKET_MINT_AUTHORITY_KEY_JSON — for legacy escrow holdings
 *   GROW_MINT / GROW_DECIMALS (optional; defaults to deployed growtoo mint)
 */
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {claimPaymentSignature} = require('./used-payment-signatures');
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

const GROW_MINT =
  process.env.GROW_MINT || '3nReF8GGLdbPc4bmrgWyproVwt9taHb1yGvL5Cekrcqp';
const GROW_DECIMALS = Number(process.env.GROW_DECIMALS || 9);
const RESERVATION_TTL_MS = 15 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const WORKER = 'cloud-settle';

function rpcUrl() {
  return (process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com').trim();
}

function escrowAddress() {
  return (
    process.env.MARKET_ESCROW_ADDRESS ||
    'EmQ4nNB1YVWNKVEiPNYhLgJR2gY1deJoV2L743z945yD'
  );
}

function legacyEscrowAddress() {
  return (
    process.env.MARKET_LEGACY_ESCROW_ADDRESS ||
    'F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3'
  );
}

function parseKeyJson(raw, label) {
  if (!raw || !String(raw).trim()) {
    throw new Error('Missing ' + label + ' — set in functions/.env.<project>');
  }
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.length < 32) {
    throw new Error(label + ' must be a Solana secret key byte array JSON');
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

function loadKeys() {
  return {
    feePayer: parseKeyJson(process.env.MARKET_FEE_PAYER_KEY_JSON, 'MARKET_FEE_PAYER_KEY_JSON'),
    escrow: parseKeyJson(process.env.MARKET_ESCROW_KEY_JSON, 'MARKET_ESCROW_KEY_JSON'),
    mintAuthority: parseKeyJson(
        process.env.MARKET_MINT_AUTHORITY_KEY_JSON || process.env.MARKET_ESCROW_KEY_JSON,
        'MARKET_MINT_AUTHORITY_KEY_JSON',
    ),
  };
}

function isRetryable(err) {
  const msg = String((err && err.message) || err);
  if (
    /Payment transaction failed on-chain|Payment too low|Payment does not debit|missing buyer|Payment signature already used/i.test(
        msg,
    )
  ) {
    return false;
  }
  return /block height|expired|429|Too Many|not found on|fetch failed|ECONNRESET|ETIMEDOUT|timeout|503|502|504|rate limit/i.test(
      msg,
  );
}

function isPendingReservation(data) {
  return String(data.paymentSignature || '').startsWith('pending-');
}

function parseTimeMs(raw) {
  if (!raw) return 0;
  if (typeof raw.toDate === 'function') return raw.toDate().getTime();
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

async function walletHoldsNft(connection, owner, mint) {
  const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint: new PublicKey(mint),
  });
  return accounts.value.some(
      (a) => Number(a.account.data.parsed.info.tokenAmount.amount) >= 1,
  );
}

async function findHolder(connection, mint, keys) {
  const primary = escrowAddress();
  const legacy = legacyEscrowAddress();
  if (await walletHoldsNft(connection, primary, mint)) {
    return {owner: primary, signer: keys.escrow};
  }
  if (legacy !== primary && (await walletHoldsNft(connection, legacy, mint))) {
    return {owner: legacy, signer: keys.mintAuthority};
  }
  return null;
}

async function verifyGrowPayment(connection, signature, sellerPubkey, priceGrow, buyerPubkey) {
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error('Payment transaction not found on devnet: ' + signature);
  if (tx.meta && tx.meta.err) throw new Error('Payment transaction failed on-chain.');

  const required = BigInt(priceGrow) * 10n ** BigInt(GROW_DECIMALS);
  const pre = (tx.meta.preTokenBalances || []).filter(
      (b) => b.mint === GROW_MINT && b.owner === sellerPubkey,
  );
  const post = (tx.meta.postTokenBalances || []).filter(
      (b) => b.mint === GROW_MINT && b.owner === sellerPubkey,
  );
  const preAmount = pre.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const postAmount = post.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  if (postAmount - preAmount < required) {
    throw new Error(
        `Payment too low: seller received ${postAmount - preAmount}, needs ${required}`,
    );
  }
  if (buyerPubkey) {
    const preB = (tx.meta.preTokenBalances || [])
        .filter((b) => b.mint === GROW_MINT && b.owner === buyerPubkey)
        .reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const postB = (tx.meta.postTokenBalances || [])
        .filter((b) => b.mint === GROW_MINT && b.owner === buyerPubkey)
        .reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    if (preB - postB < required) {
      throw new Error('Payment does not debit the claimed buyer wallet by the listing price.');
    }
  }
}

async function transferNft(connection, keys, holder, mintAddress, destinationPubkey) {
  if (await walletHoldsNft(connection, destinationPubkey, mintAddress)) {
    return 'already-delivered';
  }
  const mint = new PublicKey(mintAddress);
  const destOwner = new PublicKey(destinationPubkey);
  const sourceAta = await getAssociatedTokenAddress(
      mint,
      new PublicKey(holder.owner),
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const destAta = await getAssociatedTokenAddress(
      mint,
      destOwner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
          keys.feePayer.publicKey,
          destAta,
          destOwner,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createTransferCheckedInstruction(
          sourceAta,
          mint,
          destAta,
          new PublicKey(holder.owner),
          1n,
          0,
          [],
          TOKEN_PROGRAM_ID,
      ),
  );
  tx.feePayer = keys.feePayer.publicKey;

  // Escrow/mint authority must sign the transfer; fee payer pays.
  const signers = [keys.feePayer];
  if (holder.signer.publicKey.toBase58() !== keys.feePayer.publicKey.toBase58()) {
    signers.push(holder.signer);
  }

  const sig = await sendAndConfirmTransaction(connection, tx, signers, {
    commitment: 'confirmed',
    maxRetries: 5,
  });
  return sig;
}

async function tryClaimLease(ref) {
  const db = ref.firestore;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('missing');
      const data = snap.data() || {};
      const until = data.processingUntil ? Date.parse(data.processingUntil) : 0;
      if (Number.isFinite(until) && until > Date.now()) throw new Error('leased');
      tx.update(ref, {
        processingUntil: new Date(Date.now() + LEASE_MS).toISOString(),
        processingBy: WORKER,
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

async function clearLease(ref) {
  try {
    await ref.update({
      processingUntil: FieldValue.delete(),
      processingBy: FieldValue.delete(),
    });
  } catch (_) {
    // ignore
  }
}

async function failOrRetry(doc, err) {
  const msg = String((err && err.message) || err);
  if (isRetryable(err)) {
    await doc.ref.update({lastError: msg, lastErrorAt: new Date().toISOString()});
    return 'retry';
  }
  await doc.ref.update({
    status: 'failed',
    error: msg,
    failedAt: new Date().toISOString(),
  });
  return 'failed';
}

async function processSale(doc, connection, keys) {
  const data = doc.data() || {};
  const label = data.name || doc.id;
  // 50/50 adopt-stake sales are settled by chain/process-adopt-stakes.js
  // (payment goes to care escrow, not seller). Do not verify-as-seller here —
  // that falsely marks paid stakes as failed ("seller received 0").
  if (data.settlement === 'adopt_stake') return 'waiting';
  // Program listings settle on-chain (EscrowProgram.buyListing); never queue them.
  if (data.settlement === 'program') return 'waiting';
  if (!(await tryClaimLease(doc.ref))) return 'leased';

  try {
    if (!data.buyerPubkey || !data.paymentSignature) {
      throw new Error('Sale is missing buyerPubkey or paymentSignature.');
    }
    if (isPendingReservation(data)) {
      const age = Date.now() - (parseTimeMs(data.investedAt) || Date.now());
      if (age >= RESERVATION_TTL_MS) {
        await doc.ref.update({
          status: 'active',
          buyerUid: FieldValue.delete(),
          buyerPubkey: FieldValue.delete(),
          paymentSignature: FieldValue.delete(),
          investedAt: FieldValue.delete(),
          reservationExpiredAt: new Date().toISOString(),
        });
        return 'released';
      }
      return 'waiting';
    }

    await verifyGrowPayment(
        connection,
        data.paymentSignature,
        data.sellerPubkey,
        data.priceGrow,
        data.buyerPubkey,
    );
    await claimPaymentSignature(doc.ref.firestore, data.paymentSignature, doc.id, {
      buyerUid: data.buyerUid || null,
      buyerPubkey: data.buyerPubkey || null,
      source: WORKER,
    });
    const holder = await findHolder(connection, data.mintAddress, keys);
    if (!holder) {
      if (await walletHoldsNft(connection, data.buyerPubkey, data.mintAddress)) {
        await doc.ref.update({
          status: 'sold',
          transferSignature: 'already-delivered',
          soldAt: new Date().toISOString(),
          settledBy: WORKER,
          error: FieldValue.delete(),
        });
        return 'sold';
      }
      throw new Error('NFT is not in the current or legacy escrow wallet.');
    }
    const transferSignature = await transferNft(
        connection,
        keys,
        holder,
        data.mintAddress,
        data.buyerPubkey,
    );
    await doc.ref.update({
      status: 'sold',
      transferSignature,
      soldAt: new Date().toISOString(),
      settledBy: WORKER,
      error: FieldValue.delete(),
      lastError: FieldValue.delete(),
    });
    console.log('sold', label, transferSignature);
    return 'sold';
  } catch (err) {
    console.error('sale settle', label, err && err.message);
    return failOrRetry(doc, err);
  } finally {
    await clearLease(doc.ref);
  }
}

async function processCancel(doc, connection, keys) {
  const data = doc.data() || {};
  const label = data.name || doc.id;
  // Program cancels run via EscrowProgram.cancelListing (wallet), not this queue.
  if (data.settlement === 'program') return 'waiting';
  if (!(await tryClaimLease(doc.ref))) return 'leased';
  try {
    const holder = await findHolder(connection, data.mintAddress, keys);
    if (!holder) {
      if (await walletHoldsNft(connection, data.sellerPubkey, data.mintAddress)) {
        await doc.ref.update({
          status: 'cancelled',
          transferSignature: 'already-delivered',
          cancelledAt: new Date().toISOString(),
          settledBy: WORKER,
        });
        return 'cancelled';
      }
      throw new Error('NFT is not in the current or legacy escrow wallet.');
    }
    const transferSignature = await transferNft(
        connection,
        keys,
        holder,
        data.mintAddress,
        data.sellerPubkey,
    );
    await doc.ref.update({
      status: 'cancelled',
      transferSignature,
      cancelledAt: new Date().toISOString(),
      settledBy: WORKER,
      error: FieldValue.delete(),
      lastError: FieldValue.delete(),
    });
    console.log('cancelled', label, transferSignature);
    return 'cancelled';
  } catch (err) {
    console.error('cancel settle', label, err && err.message);
    return failOrRetry(doc, err);
  } finally {
    await clearLease(doc.ref);
  }
}

/**
 * @returns {Promise<{ok:boolean, salePending:number, cancelRequested:number, sold:number, cancelled:number, retried:number, released:number, errors:string[]}>}
 */
async function settleMarketPending() {
  const keys = loadKeys();
  const connection = new Connection(rpcUrl(), 'confirmed');
  const db = getFirestore();

  const [sales, cancels] = await Promise.all([
    db.collection('marketListings').where('status', '==', 'sale_pending').get(),
    db.collection('marketListings').where('status', '==', 'cancel_requested').get(),
  ]);

  const result = {
    ok: true,
    salePending: sales.size,
    cancelRequested: cancels.size,
    sold: 0,
    cancelled: 0,
    retried: 0,
    released: 0,
    waiting: 0,
    errors: [],
  };

  for (const doc of sales.docs) {
    const outcome = await processSale(doc, connection, keys);
    if (outcome === 'sold') result.sold += 1;
    else if (outcome === 'retry') result.retried += 1;
    else if (outcome === 'released') result.released += 1;
    else if (outcome === 'waiting') result.waiting += 1;
    else if (outcome === 'failed') result.errors.push((doc.data().name || doc.id) + ': failed');
  }
  for (const doc of cancels.docs) {
    const outcome = await processCancel(doc, connection, keys);
    if (outcome === 'cancelled') result.cancelled += 1;
    else if (outcome === 'retry') result.retried += 1;
    else if (outcome === 'failed') result.errors.push((doc.data().name || doc.id) + ': failed');
  }

  return result;
}

module.exports = {
  settleMarketPending,
  escrowAddress,
  legacyEscrowAddress,
};
