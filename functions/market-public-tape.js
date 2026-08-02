/*
 * Scrubbed public market tape for the landing page (no auth).
 * Mirrors only board-safe fields from marketListings — never uids, wallets,
 * signatures, escrow addresses, journal notes, or photos.
 */
'use strict';

const {getFirestore} = require('firebase-admin/firestore');

const PUBLIC_COLLECTION = 'marketPublicTape';

/** Statuses the landing board / stake totals may show. */
const PUBLIC_STATUSES = new Set([
  'active',
  'escrow_pending',
  'sale_pending',
  'sold',
]);

/**
 * @param {FirebaseFirestore.DocumentData|null|undefined} listing
 * @return {object|null}
 */
function scrubPublicListing(listing) {
  if (!listing || typeof listing !== 'object') return null;
  const status = String(listing.status || '');
  if (!PUBLIC_STATUSES.has(status)) return null;

  const price = Number(listing.priceGrow);
  if (!Number.isFinite(price) || price <= 0) return null;

  const name = String(listing.name || '').trim();
  if (!name) return null;

  const out = {
    name: name.slice(0, 120),
    status,
    priceGrow: Math.round(price),
    createdAt: typeof listing.createdAt === 'string' ? listing.createdAt : null,
    updatedAt: new Date().toISOString(),
  };

  if (typeof listing.strain === 'string' && listing.strain.trim()) {
    out.strain = listing.strain.trim().slice(0, 80);
  }
  if (typeof listing.batch === 'string' && listing.batch.trim()) {
    out.batch = listing.batch.trim().slice(0, 40);
  }
  if (typeof listing.stage === 'string' && listing.stage.trim()) {
    out.stage = listing.stage.trim().slice(0, 40);
  }
  if (listing.assetType === 'flower' || listing.assetType === 'seed') {
    out.assetType = listing.assetType;
  }
  if (typeof listing.offerType === 'string' && listing.offerType.trim()) {
    out.offerType = listing.offerType.trim().slice(0, 40);
  }
  if (typeof listing.settlement === 'string' && listing.settlement.trim()) {
    out.settlement = listing.settlement.trim().slice(0, 40);
  }
  // Mint address is already public on Solana explorers; used for ticker links.
  if (typeof listing.mintAddress === 'string' && listing.mintAddress.length >= 32) {
    out.mintAddress = listing.mintAddress;
  }

  return out;
}

/**
 * Upsert or delete the public mirror for one listing.
 * @param {string} listingId
 * @param {FirebaseFirestore.DocumentData|null|undefined} listing after-image (null = deleted)
 */
async function syncMarketPublicTape(listingId, listing) {
  if (!listingId) return;
  const db = getFirestore();
  const ref = db.collection(PUBLIC_COLLECTION).doc(listingId);
  const scrubbed = scrubPublicListing(listing);
  if (!scrubbed) {
    await ref.delete().catch(() => null);
    return;
  }
  await ref.set(scrubbed, {merge: false});
}

/**
 * One-shot backfill (admin / chain script). Returns counts.
 */
async function backfillMarketPublicTape() {
  const db = getFirestore();
  const snap = await db.collection('marketListings').get();
  let upserted = 0;
  let removed = 0;
  const batchSize = 400;
  let batch = db.batch();
  let ops = 0;

  async function flush() {
    if (!ops) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }

  for (const doc of snap.docs) {
    const scrubbed = scrubPublicListing(doc.data());
    const ref = db.collection(PUBLIC_COLLECTION).doc(doc.id);
    if (scrubbed) {
      batch.set(ref, scrubbed, {merge: false});
      upserted += 1;
    } else {
      batch.delete(ref);
      removed += 1;
    }
    ops += 1;
    if (ops >= batchSize) await flush();
  }
  await flush();
  return {scanned: snap.size, upserted, removed};
}

module.exports = {
  PUBLIC_COLLECTION,
  scrubPublicListing,
  syncMarketPublicTape,
  backfillMarketPublicTape,
};
