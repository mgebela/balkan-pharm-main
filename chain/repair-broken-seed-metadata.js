/*
 * Remint seed NFTs whose Metaplex metadata PDA is empty/corrupt (1-byte stub).
 *
 * Those accounts cannot be updateV1'd — fetchMetadataFromSeeds throws
 * UnexpectedAccountError / MetadataAccountData. Replacement mints use the
 * normal createNft path with growto.live botanical images.
 *
 * Usage:
 *   node repair-broken-seed-metadata.js              # dry-run
 *   node repair-broken-seed-metadata.js --execute     # remint broken rows
 *   node repair-broken-seed-metadata.js --execute --mint <ADDR>
 *   node repair-broken-seed-metadata.js --execute --only-mine
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { publicKey } from '@metaplex-foundation/umi';
import { findMetadataPda, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { FieldValue } from 'firebase-admin/firestore';
import { createMintClient, mintSeedNft } from './mint-seed-lib.js';
import { SEED_IMAGE_URL } from './seed-metadata.js';
import { RPC_URL } from './common.js';
import { initFirestore } from './firebase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MINTS_PATH = path.join(__dirname, 'mints.devnet.json');
const USER = '9k1QwNaqTmj6JvhzZiszKzCNGGe4Rw3Ezu7CQ3CqHfhi';
const META_MIN_HEALTHY = 100;

const execute = process.argv.includes('--execute');
const onlyMine = process.argv.includes('--only-mine');
const mintArgIdx = process.argv.indexOf('--mint');
const onlyMint = mintArgIdx >= 0 ? String(process.argv[mintArgIdx + 1] || '').trim() : '';

const connection = new Connection(RPC_URL, 'confirmed');
const probeUmi = createUmi(RPC_URL).use(mplTokenMetadata());

async function metadataByteLength(mintAddress) {
  const pda = findMetadataPda(probeUmi, { mint: publicKey(mintAddress) });
  const info = await connection.getAccountInfo(new PublicKey(String(pda[0])));
  return info?.data?.length ?? 0;
}

async function isBrokenMetadata(mintAddress) {
  try {
    const len = await metadataByteLength(mintAddress);
    return { broken: len < META_MIN_HEALTHY, len };
  } catch (err) {
    return { broken: true, len: 0, error: String(err.message || err) };
  }
}

async function patchFirestoreRefs(oldMint, newMint, row) {
  const db = initFirestore();
  let seedHits = 0;
  let listingHits = 0;

  const seeds = await db.collection('seedMints').where('mintAddress', '==', oldMint).get();
  for (const doc of seeds.docs) {
    await doc.ref.set(
      {
        mintAddress: newMint,
        metadataUri: row.metadataUri || null,
        replacedMint: oldMint,
        replacedAt: row.replacedAt,
        repairNote: 'Reminted — previous metadata PDA was empty/corrupt',
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    seedHits += 1;
  }

  const listings = await db.collection('marketListings').where('mintAddress', '==', oldMint).get();
  for (const doc of listings.docs) {
    const data = doc.data() || {};
    // Do not rewrite sold / active custody paths — only pending list docs.
    if (data.status === 'sold' || data.status === 'sale_pending') {
      console.log(`  … skip listing ${doc.id} (status=${data.status})`);
      continue;
    }
    await doc.ref.update({
      mintAddress: newMint,
      replacedMint: oldMint,
      replacedAt: row.replacedAt,
      error: FieldValue.delete(),
    });
    listingHits += 1;
  }

  return { seedHits, listingHits };
}

const list = JSON.parse(fs.readFileSync(MINTS_PATH, 'utf8'));
if (!Array.isArray(list)) {
  console.error('mints.devnet.json must be an array');
  process.exit(1);
}

let targets = list;
if (onlyMint) {
  targets = list.filter((m) => m.mint === onlyMint);
} else if (onlyMine) {
  targets = list.filter((m) => m.owner === USER);
}

console.log(execute ? 'EXECUTE remint for broken metadata' : 'DRY-RUN (pass --execute to remint)');
console.log('Scanning', targets.length, 'mint(s)…\n');

const umi = execute ? createMintClient() : null;
let repaired = 0;
let skipped = 0;
let failed = 0;

for (const row of targets) {
  const mint = row.mint;
  if (!mint) continue;
  const probe = await isBrokenMetadata(mint);
  if (!probe.broken) {
    console.log('· ok   ', row.name, `metaLen=${probe.len}`);
    skipped += 1;
    continue;
  }

  console.log('✖ broken', row.name, mint, `metaLen=${probe.len}`);
  if (!execute) {
    console.log('  would remint → owner', row.owner || umi?.identity?.publicKey || USER);
    repaired += 1;
    continue;
  }

  try {
    const recipient = row.owner || USER;
    const result = await mintSeedNft(
      umi,
      {
        name: row.name,
        strain: row.strain || row.name,
        batch: row.batch || 'B-repair',
        plantId: row.plantId || null,
        image: SEED_IMAGE_URL,
      },
      { recipient }
    );

    const replacedAt = new Date().toISOString();
    const oldMint = row.mint;
    row.replacedMint = oldMint;
    row.replacedAt = replacedAt;
    row.mint = result.mint;
    row.metadataUri = result.metadataUri;
    row.signature = result.signature;
    row.owner = result.owner;
    row.mintedAt = replacedAt;
    row.imageUri = SEED_IMAGE_URL;
    row.artSource = 'growto.live-botanical';
    row.artUpdatedAt = replacedAt;
    row.repairNote = 'Reminted — previous metadata PDA was empty/corrupt';
    delete row.artUpdateSignature;

    console.log('  ✔ new mint', result.mint);
    console.log('  metadata', result.metadataUri);
    console.log('  replaced', oldMint);

    try {
      const hits = await patchFirestoreRefs(oldMint, result.mint, row);
      console.log('  firestore seedMints', hits.seedHits, 'listings', hits.listingHits);
    } catch (fsErr) {
      console.warn('  firestore patch skipped:', fsErr.message || fsErr);
    }

    repaired += 1;
  } catch (err) {
    failed += 1;
    console.error('  ✘ remint failed:', err.message || err);
  }
}

if (execute) {
  fs.writeFileSync(MINTS_PATH, JSON.stringify(list, null, 2) + '\n');
  console.log('\nWrote', MINTS_PATH);
}

console.log(
  `\nDone. broken/repaired=${repaired} healthy=${skipped} failed=${failed}` +
    (execute ? '' : ' (dry-run)')
);
if (!execute && repaired) {
  console.log('Re-run with --execute to mint replacements.');
}
