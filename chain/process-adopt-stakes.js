/*
 * Adopt-stake settlement (50/50 care escrow) + harvest all-or-nothing release.
 *
 * Listings with settlement: 'adopt_stake':
 *   1. Grower escrows NFT (legacy escrow_pending → active via process-market).
 *   2. Adopter pays FULL priceGrow $GROWTOO to the care escrow wallet.
 *   3. This worker verifies payment, sends NFT to buyer, releases 50% $GROWTOO
 *      to the grower, leaves 50% locked, sets careStatus: 'active'.
 *   4. harvestClaims pending → validate all monthly care months; release locked
 *      half to grower or refund to adopter.
 *
 * Usage: node process-adopt-stakes.js [--watch]
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { publicKey, transactionBuilder, createSignerFromKeypair } from '@metaplex-foundation/umi';
import {
  mplToolbox,
  createTokenIfMissing,
  transferTokens,
  findAssociatedTokenPda,
} from '@metaplex-foundation/mpl-toolbox';
import {
  updateV1,
  fetchMetadataFromSeeds,
} from '@metaplex-foundation/mpl-token-metadata';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createRequire } from 'node:module';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirestore } from './firebase.js';
import { createMarketClient, createMintClient, uploadSeedMetadata } from './mint-seed-lib.js';
import { RPC_URL, readDeployed, LEGACY_ESCROW_ADDRESS } from './common.js';
import { tryClaimLease, clearLease, workerId } from './queue-lease.js';
import { isRetryableChainError } from './retryable.js';
import {
  validateHarvestCarePath,
  validateMonthlyCareProof,
  monthKey,
  MONTHLY_CARE_MIN_DAYS,
} from './weekly-care.js';
import { applyCareHistory, toPublicMetadataUri } from './seed-metadata.js';
import { notifyUser } from './notify-user.js';

const require = createRequire(import.meta.url);
const { claimPaymentSignature } = require('../functions/used-payment-signatures.js');

const db = initFirestore();
/** Unpaid invest reservations older than this are released back to active. */
const RESERVATION_TTL_MS = 15 * 60 * 1000;
const {
  umi: marketUmi,
  escrowSigner,
  escrowAddress: ESCROW,
  careEscrowSigner,
  careEscrowAddress: configuredCareEscrow,
  legacyEscrowAddress,
  mintAuthoritySecret,
} = createMarketClient();
marketUmi.use(mplToolbox());
const mintUmi = createMintClient().use(mplToolbox());
const connection = new Connection(RPC_URL, 'confirmed');
const watch = process.argv.includes('--watch');
const legacyEscrowSigner = marketUmi.eddsa.createKeypairFromSecretKey(mintAuthoritySecret);
const LEGACY_ESCROW = legacyEscrowAddress || LEGACY_ESCROW_ADDRESS;
const escrowAuthority = createSignerFromKeypair(marketUmi, escrowSigner);
const careEscrowAuthority = createSignerFromKeypair(marketUmi, careEscrowSigner);

const deployed = readDeployed();
if (!deployed.growMint) {
  console.error('$GROWTOO mint not deployed yet. Run "npm run deploy:grow" first.');
  process.exit(1);
}
const GROW_MINT = deployed.growMint;
const GROW_MINT_PK = publicKey(GROW_MINT);
const GROW_DECIMALS = Number(deployed.growDecimals || 9);
const CARE_ESCROW = configuredCareEscrow || deployed.careEscrowAddress || ESCROW;
const NFT_ESCROW = ESCROW;

console.log('NFT escrow: ', NFT_ESCROW);
console.log('Care escrow:', CARE_ESCROW);
console.log('Worker:', workerId());

function growAuthorityForEscrow(sourceAddress) {
  const addr = String(sourceAddress || CARE_ESCROW);
  if (addr === String(careEscrowSigner.publicKey)) return careEscrowAuthority;
  if (addr === String(escrowSigner.publicKey) || addr === NFT_ESCROW) return escrowAuthority;
  if (addr === LEGACY_ESCROW) {
    return createSignerFromKeypair(marketUmi, legacyEscrowSigner);
  }
  throw new Error('No signer configured for care escrow ' + addr);
}

function stakeAmounts(priceGrow) {
  const total = Math.max(0, Math.round(Number(priceGrow) || 0));
  const locked = Math.floor(total / 2);
  const immediate = total - locked;
  return { total, immediate, locked };
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

async function verifyGrowPaymentToEscrow(signature, escrowPubkey, priceGrow, buyerPubkey) {
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error('Payment transaction not found: ' + signature);
  if (tx.meta && tx.meta.err) throw new Error('Payment transaction failed on-chain.');

  const pre = (tx.meta.preTokenBalances || []).filter(
    (b) => b.mint === GROW_MINT && b.owner === escrowPubkey
  );
  const post = (tx.meta.postTokenBalances || []).filter(
    (b) => b.mint === GROW_MINT && b.owner === escrowPubkey
  );
  const preAmount = pre.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const postAmount = post.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const received = postAmount - preAmount;
  const required = BigInt(priceGrow) * 10n ** BigInt(GROW_DECIMALS);
  if (received < required) {
    throw new Error(
      `Care-escrow payment too low: received ${received}, requires ${required}.`
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
      throw new Error('Payment does not debit the claimed buyer wallet by the listing price.');
    }
  }
}

async function transferNftFromEscrow(mintAddress, destinationPubkey) {
  const mint = publicKey(mintAddress);
  const destOwner = publicKey(destinationPubkey);
  const holder = await findEscrowHolder(mintAddress);
  if (!holder) {
    if (await walletHoldsNft(destinationPubkey, mintAddress)) return 'already-delivered';
    throw new Error('NFT is not in the escrow wallet.');
  }
  if (await walletHoldsNft(destinationPubkey, mintAddress)) return 'already-delivered';

  const authority = createSignerFromKeypair(marketUmi, holder.signer);
  const source = findAssociatedTokenPda(marketUmi, { mint, owner: publicKey(holder.address) });
  const destination = findAssociatedTokenPda(marketUmi, { mint, owner: destOwner });
  const result = await transactionBuilder()
    .add(createTokenIfMissing(marketUmi, { mint, owner: destOwner }))
    .add(
      transferTokens(marketUmi, {
        source,
        destination,
        amount: 1n,
        authority,
      })
    )
    .sendAndConfirm(marketUmi);
  return base58.deserialize(result.signature)[0];
}

async function transferGrowFromEscrow(destinationPubkey, wholeTokens, sourceEscrowAddress) {
  const amount = BigInt(wholeTokens) * 10n ** BigInt(GROW_DECIMALS);
  if (amount <= 0n) return 'zero';
  const sourceAddr = String(sourceEscrowAddress || CARE_ESCROW);
  const authority = growAuthorityForEscrow(sourceAddr);
  const destOwner = publicKey(destinationPubkey);
  const sourceOwner = publicKey(sourceAddr);
  const source = findAssociatedTokenPda(marketUmi, { mint: GROW_MINT_PK, owner: sourceOwner });
  const destination = findAssociatedTokenPda(marketUmi, { mint: GROW_MINT_PK, owner: destOwner });
  const result = await transactionBuilder()
    .add(createTokenIfMissing(marketUmi, { mint: GROW_MINT_PK, owner: destOwner }))
    .add(
      transferTokens(marketUmi, {
        source,
        destination,
        amount,
        authority,
      })
    )
    .sendAndConfirm(marketUmi);
  return base58.deserialize(result.signature)[0];
}

async function loadGrowerAppState(uid) {
  if (!uid) return null;
  const snap = await db.collection('users').doc(uid).collection('app').doc('state').get();
  if (!snap.exists) return null;
  return snap.data() || {};
}

async function fail(doc, label, err) {
  console.error(`✘ ${label}: ${err.message}`);
  if (isRetryableChainError(err)) {
    await doc.ref.update({
      lastError: String(err.message || err),
      lastErrorAt: new Date().toISOString(),
    });
    console.warn(`… ${label}: left pending for retry`);
    return;
  }
  await doc.ref.update({
    status: 'failed',
    error: String(err.message || err),
    failedAt: new Date().toISOString(),
  });
}

function isPendingPaymentReservation(data) {
  return String(data.paymentSignature || '').startsWith('pending-');
}

function statusEnteredAt(data, status) {
  if (status === 'sale_pending') return data.investedAt || data.createdAt;
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

async function processAdoptSale(doc) {
  const data = doc.data();
  const label = `adopt-stake ${data.name || doc.id}`;
  if (data.settlement !== 'adopt_stake') return;
  if (data.status !== 'sale_pending') return;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased, skipping`);
    return;
  }
  try {
    if (!data.buyerPubkey || !data.paymentSignature) {
      throw new Error('Missing buyerPubkey or paymentSignature.');
    }
    // Pre-pay reservation: wait for the buyer to attach a real signature, or release.
    if (isPendingPaymentReservation(data)) {
      const ageMin = ageMinutes(statusEnteredAt(data, 'sale_pending'));
      if (ageMin != null && ageMin * 60000 >= RESERVATION_TTL_MS) {
        // Archive before clearing. A reservation is only *presumed* unpaid —
        // the buyer may have paid and lost the write that attaches the real
        // signature. Nothing scans the escrow for unmatched transfers, so
        // dropping buyerPubkey is what makes such a payment unrecoverable.
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

    const amounts = stakeAmounts(data.priceGrow);
    const careEscrow = data.careEscrowAddress || CARE_ESCROW;
    await verifyGrowPaymentToEscrow(
      data.paymentSignature,
      careEscrow,
      amounts.total,
      data.buyerPubkey
    );
    await claimPaymentSignature(db, data.paymentSignature, doc.id, {
      buyerUid: data.buyerUid || null,
      buyerPubkey: data.buyerPubkey || null,
      source: workerId(),
    });

    const transferSignature = await transferNftFromEscrow(data.mintAddress, data.buyerPubkey);
    let immediateSig = 'zero';
    if (amounts.immediate > 0) {
      immediateSig = await transferGrowFromEscrow(
        data.sellerPubkey,
        amounts.immediate,
        careEscrow
      );
    }

    const adoptedAt = data.investedAt || new Date().toISOString();
    await doc.ref.update({
      status: 'sold',
      transferSignature,
      immediateReleaseSignature: immediateSig,
      soldAt: new Date().toISOString(),
      adoptedAt,
      totalGrow: amounts.total,
      immediateGrow: amounts.immediate,
      lockedGrow: amounts.locked,
      careStatus: 'active',
      careEscrowAddress: careEscrow,
      stakeLockedBps: 5000,
      settledBy: workerId(),
      error: FieldValue.delete(),
    });

    await db.collection('adoptStakes').doc(doc.id).set(
      {
        listingId: doc.id,
        uid: data.uid,
        sellerUid: data.uid,
        sellerPubkey: data.sellerPubkey,
        buyerUid: data.buyerUid,
        buyerPubkey: data.buyerPubkey,
        mintAddress: data.mintAddress,
        plantId: data.plantId || null,
        name: data.name || null,
        totalGrow: amounts.total,
        immediateGrow: amounts.immediate,
        lockedGrow: amounts.locked,
        careStatus: 'active',
        careEscrowAddress: careEscrow,
        adoptedAt,
        paymentSignature: data.paymentSignature,
        transferSignature,
        immediateReleaseSignature: immediateSig,
        cluster: 'devnet',
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    console.log(
      `✔ ${label}: NFT → buyer, ${amounts.immediate} $GROWTOO → grower, ${amounts.locked} locked`
    );
    try {
      if (data.uid) {
        await notifyUser(db, data.uid, {
          type: 'stake_received',
          title: 'Adopt stake settled',
          body:
            'Adopter staked ' +
            amounts.total +
            ' $GROWTOO on "' +
            (data.name || 'plant') +
            '". ' +
            amounts.immediate +
            ' released · ' +
            amounts.locked +
            ' locked until monthly care.',
          meta: {
            listingId: doc.id,
            priceGrow: amounts.total,
            lockedGrow: amounts.locked,
            key: 'adopt-sold:' + doc.id,
          },
          action: { view: 'market', listingId: doc.id },
          source: 'process-adopt-stakes',
        });
      }
      if (data.buyerUid) {
        await notifyUser(db, data.buyerUid, {
          type: 'sale_settled',
          title: 'Adopt stake active',
          body:
            'You hold "' +
            (data.name || 'plant') +
            '". Locked half unlocks when monthly care qualifies at harvest.',
          meta: { listingId: doc.id, key: 'adopt-buy:' + doc.id },
          action: { view: 'adopt' },
          source: 'process-adopt-stakes',
        });
      }
    } catch (notifyErr) {
      console.warn('notify after adopt-stake failed', notifyErr.message || notifyErr);
    }
  } catch (err) {
    await fail(doc, label, err);
  } finally {
    await clearLease(doc.ref);
  }
}

/** Journal (HR) + English stage labels → token stage key. */
const JOURNAL_STAGE_TO_TOKEN = {
  klijanje: { key: 'germination', label: 'Germination' },
  sadnica: { key: 'seedling', label: 'Seedling' },
  vegetativna: { key: 'vegetative', label: 'Vegetative' },
  cvjetanje: { key: 'flowering', label: 'Flowering' },
  susenje: { key: 'harvest', label: 'Harvest' },
  seed: { key: 'seed', label: 'Seed' },
  germination: { key: 'germination', label: 'Germination' },
  seedling: { key: 'seedling', label: 'Seedling' },
  vegetative: { key: 'vegetative', label: 'Vegetative' },
  flowering: { key: 'flowering', label: 'Flowering' },
  harvest: { key: 'harvest', label: 'Harvest' },
};

function resolveLiveStage(appState, plantId) {
  const plants = Array.isArray(appState?.plants) ? appState.plants : [];
  const plant = plants.find((p) => p && String(p.id) === String(plantId));
  if (!plant) return null;
  const raw = String(plant.stage || '').trim();
  if (!raw) {
    return {
      journalStage: null,
      liveStageKey: null,
      liveStage: null,
      harvestReady: false,
    };
  }
  const lower = raw.toLowerCase();
  const mapped = JOURNAL_STAGE_TO_TOKEN[lower];
  if (mapped) {
    return {
      journalStage: raw,
      liveStageKey: mapped.key,
      liveStage: mapped.label,
      harvestReady: mapped.key === 'harvest',
    };
  }
  if (/harvest|susenje|dry|drying/i.test(raw)) {
    return {
      journalStage: raw,
      liveStageKey: 'harvest',
      liveStage: 'Harvest',
      harvestReady: true,
    };
  }
  return {
    journalStage: raw,
    liveStageKey: null,
    liveStage: raw,
    harvestReady: false,
  };
}

/**
 * Sync live monthly care progress + journal stage onto sold adopt-stake
 * listings so Market / adopters see current unlock state without harvest claim.
 */
async function syncCareProgress(doc) {
  const data = doc.data() || {};
  const label = `care-progress ${data.name || doc.id}`;
  if (data.settlement !== 'adopt_stake') return;
  if (data.status !== 'sold') return;
  if (data.careStatus !== 'active') return;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased, skipping`);
    return;
  }
  try {
    const plantId = data.plantId;
    const adoptedAt = data.adoptedAt || data.soldAt || data.investedAt;
    if (!plantId || !adoptedAt) {
      console.log(`… ${label}: missing plantId/adoptedAt`);
      return;
    }
    const appState = await loadGrowerAppState(data.uid);
    if (!appState) {
      console.log(`… ${label}: grower journal missing`);
      return;
    }

    const proof = validateHarvestCarePath(appState, plantId, adoptedAt, Date.now());
    const curKey = monthKey(Date.now());
    const cur = validateMonthlyCareProof(appState, plantId, curKey, MONTHLY_CARE_MIN_DAYS);
    const live = resolveLiveStage(appState, plantId) || {
      journalStage: null,
      liveStageKey: null,
      liveStage: null,
      harvestReady: false,
    };
    const payload = {
      qualifyingMonthKeys: proof.qualifyingMonthKeys || [],
      qualifyingWeekKeys: proof.qualifyingMonthKeys || [],
      careMonthKeys: proof.monthKeys || [],
      currentMonthKey: curKey,
      currentMonthDaysHit: cur.daysHit,
      currentMonthMinDays: MONTHLY_CARE_MIN_DAYS,
      journalStage: live.journalStage,
      liveStage: live.liveStage,
      liveStageKey: live.liveStageKey,
      harvestReady: !!live.harvestReady,
      careProgressUpdatedAt: new Date().toISOString(),
    };

    const prevKeys = JSON.stringify(data.qualifyingMonthKeys || []);
    const nextKeys = JSON.stringify(payload.qualifyingMonthKeys);
    const unchanged =
      prevKeys === nextKeys &&
      Number(data.currentMonthDaysHit) === Number(payload.currentMonthDaysHit) &&
      String(data.currentMonthKey || '') === String(payload.currentMonthKey) &&
      String(data.liveStageKey || '') === String(payload.liveStageKey || '') &&
      Boolean(data.harvestReady) === Boolean(payload.harvestReady) &&
      String(data.journalStage || '') === String(payload.journalStage || '');

    if (unchanged) {
      console.log(`… ${label}: up to date`);
      return;
    }

    await doc.ref.update(payload);
    await db.collection('adoptStakes').doc(doc.id).set(
      {
        qualifyingMonthKeys: payload.qualifyingMonthKeys,
        careMonthKeys: payload.careMonthKeys,
        currentMonthKey: payload.currentMonthKey,
        currentMonthDaysHit: payload.currentMonthDaysHit,
        currentMonthMinDays: payload.currentMonthMinDays,
        journalStage: payload.journalStage,
        liveStage: payload.liveStage,
        liveStageKey: payload.liveStageKey,
        harvestReady: payload.harvestReady,
        careProgressUpdatedAt: payload.careProgressUpdatedAt,
        updatedAt: payload.careProgressUpdatedAt,
      },
      { merge: true }
    );
    console.log(
      `✔ ${label}: ${payload.qualifyingMonthKeys.length}/${payload.careMonthKeys.length} months · this month ${payload.currentMonthDaysHit}/${MONTHLY_CARE_MIN_DAYS}` +
        (payload.liveStage ? ` · stage ${payload.liveStage}` : '')
    );
  } catch (err) {
    console.warn(`… ${label}: ${err.message || err}`);
  } finally {
    await clearLease(doc.ref);
  }
}

async function maybeUpdateCareMetadata(mintAddress, careHistory) {
  if (!mintAddress || !careHistory?.length) return null;
  try {
    const mint = publicKey(mintAddress);
    const current = await fetchMetadataFromSeeds(mintUmi, { mint });
    let json = {};
    if (current.uri) {
      try {
        const res = await fetch(toPublicMetadataUri(String(current.uri)));
        if (res.ok) json = await res.json();
      } catch {
        json = { name: String(current.name || 'Plant'), attributes: [], rwa: {} };
      }
    }
    applyCareHistory(json, careHistory);
    const metadataUri = await uploadSeedMetadata(mintUmi, json);
    const updateResult = await updateV1(mintUmi, {
      mint,
      authority: mintUmi.identity,
      data: { ...current, uri: metadataUri },
    }).sendAndConfirm(mintUmi);
    return {
      metadataUri,
      signature: base58.deserialize(updateResult.signature)[0],
    };
  } catch (err) {
    console.warn('care metadata update skipped:', err.message || err);
    return null;
  }
}

async function processHarvestClaim(doc) {
  const data = doc.data();
  const label = `harvest ${data.listingId || doc.id}`;
  if (data.status !== 'pending') return;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased, skipping`);
    return;
  }
  try {
    const listingId = data.listingId;
    if (!listingId) throw new Error('harvestClaims requires listingId');
    const listingRef = db.collection('marketListings').doc(listingId);
    const listingSnap = await listingRef.get();
    if (!listingSnap.exists) throw new Error('Listing not found: ' + listingId);
    const listing = listingSnap.data() || {};
    if (listing.settlement !== 'adopt_stake') {
      throw new Error('Listing is not an adopt_stake offer.');
    }
    if (listing.careStatus !== 'active') {
      throw new Error(`Care stake is not active (status=${listing.careStatus}).`);
    }
    if (listing.uid !== data.uid) {
      throw new Error('Only the grower can claim harvest for this stake.');
    }

    const plantId = data.plantId || listing.plantId;
    const appState = await loadGrowerAppState(listing.uid);
    if (!appState) {
      throw new Error('Grower journal state missing — sync plants/entries first.');
    }

    const adoptedAt = listing.adoptedAt || listing.soldAt || listing.investedAt;
    const proof = validateHarvestCarePath(appState, plantId, adoptedAt, Date.now());
    const locked = Number(listing.lockedGrow || stakeAmounts(listing.priceGrow).locked);
    const careEscrow = listing.careEscrowAddress || CARE_ESCROW;

    let outcomeSig = '';
    let careStatus = 'refunded';
    if (proof.ok) {
      outcomeSig = await transferGrowFromEscrow(listing.sellerPubkey, locked, careEscrow);
      careStatus = 'released';
    } else {
      if (!listing.buyerPubkey) throw new Error('Missing buyerPubkey for refund.');
      outcomeSig = await transferGrowFromEscrow(listing.buyerPubkey, locked, careEscrow);
      careStatus = 'refunded';
    }

    const careHistory = (proof.results || [])
      .filter((r) => r.ok)
      .map((r) => ({
        monthKey: r.monthKey,
        daysHit: r.daysHit,
        ts: new Date().toISOString(),
      }));
    const meta = await maybeUpdateCareMetadata(listing.mintAddress, careHistory);

    const settledAt = new Date().toISOString();
    await listingRef.update({
      careStatus,
      harvestSettledAt: settledAt,
      harvestOutcomeSignature: outcomeSig,
      qualifyingMonthKeys: proof.qualifyingMonthKeys || [],
      qualifyingWeekKeys: proof.qualifyingMonthKeys || [],
      harvestProofSummary: {
        ok: proof.ok,
        monthKeys: proof.monthKeys,
        errors: proof.errors.slice(0, 12),
      },
      ...(meta
        ? { careMetadataUri: meta.metadataUri, careMetadataSignature: meta.signature }
        : {}),
    });

    await db.collection('adoptStakes').doc(listingId).set(
      {
        careStatus,
        harvestSettledAt: settledAt,
        harvestOutcomeSignature: outcomeSig,
        qualifyingMonthKeys: proof.qualifyingMonthKeys || [],
        updatedAt: settledAt,
      },
      { merge: true }
    );

    await doc.ref.update({
      status: careStatus === 'released' ? 'released' : 'refunded',
      careStatus,
      outcomeSignature: outcomeSig,
      proofSummary: {
        ok: proof.ok,
        monthKeys: proof.monthKeys,
        qualifyingMonthKeys: proof.qualifyingMonthKeys,
        errors: proof.errors.slice(0, 12),
      },
      settledAt,
      settledBy: workerId(),
      error: FieldValue.delete(),
    });

    console.log(
      `✔ ${label}: ${careStatus} · locked ${locked} $GROWTOO · months ${proof.qualifyingMonthKeys?.length || 0}/${proof.monthKeys?.length || 0}`
    );
    try {
      if (listing.uid) {
        await notifyUser(db, listing.uid, {
          type: 'harvest_claim',
          title: careStatus === 'released' ? 'Harvest stake released' : 'Harvest stake refunded',
          body:
            careStatus === 'released'
              ? 'Locked $GROWTOO for "' + (listing.name || 'plant') + '" released to you.'
              : 'Locked $GROWTOO for "' + (listing.name || 'plant') + '" refunded to the adopter.',
          meta: {
            listingId,
            careStatus,
            key: 'harvest-settle:' + listingId + ':' + careStatus,
          },
          action: { view: 'adopt' },
          source: 'process-adopt-stakes',
        });
      }
      if (listing.buyerUid) {
        await notifyUser(db, listing.buyerUid, {
          type: 'sale_settled',
          title: careStatus === 'released' ? 'Grower unlocked full stake' : 'Locked stake refunded',
          body: '"' + (listing.name || 'Plant') + '" monthly care settled · ' + careStatus + '.',
          meta: {
            listingId,
            careStatus,
            key: 'harvest-buyer:' + listingId + ':' + careStatus,
          },
          action: { view: 'adopt' },
          source: 'process-adopt-stakes',
        });
      }
    } catch (notifyErr) {
      console.warn('notify after harvest failed', notifyErr.message || notifyErr);
    }
  } catch (err) {
    await fail(doc, label, err);
  } finally {
    await clearLease(doc.ref);
  }
}

async function processPending() {
  const sales = await db
    .collection('marketListings')
    .where('status', '==', 'sale_pending')
    .where('settlement', '==', 'adopt_stake')
    .get();
  if (sales.size) console.log(`… adopt sale_pending: ${sales.size}`);
  for (const doc of sales.docs) {
    await processAdoptSale(doc);
  }

  const active = await db.collection('marketListings').where('careStatus', '==', 'active').get();
  const activeDocs = active.docs.filter((d) => (d.data() || {}).settlement === 'adopt_stake');
  if (activeDocs.length) console.log(`… adopt care active: ${activeDocs.length}`);
  for (const doc of activeDocs) {
    await syncCareProgress(doc);
  }

  const claims = await db.collection('harvestClaims').where('status', '==', 'pending').get();
  if (claims.size) console.log(`… harvestClaims pending: ${claims.size}`);
  for (const doc of claims.docs) {
    await processHarvestClaim(doc);
  }
  console.log('Adopt-stake queue pass complete.', monthKey(Date.now()));
}

await processPending();

if (watch) {
  console.log('Watching adopt-stake sales + harvest claims…');
  db.collection('marketListings')
    .where('status', '==', 'sale_pending')
    .where('settlement', '==', 'adopt_stake')
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          processAdoptSale(change.doc);
        }
      });
    });
  db.collection('harvestClaims')
    .where('status', '==', 'pending')
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          processHarvestClaim(change.doc);
        }
      });
    });
} else {
  process.exit(0);
}
