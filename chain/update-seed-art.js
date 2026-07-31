/*
 * Re-point seed NFT metadata image URIs to growto.live botanical art (devnet).
 *
 * Prefer hosted PNGs over Irys image uploads — Irys-devnet image links often
 * go empty in wallets. Metadata JSON still uploads via Irys; image field is
 * https://growto.live/token-metadata/images/plant-*.png.
 *
 * Usage: node update-seed-art.js [--only-mine]
 *   --only-mine  update only NFTs held by the known user wallet
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { publicKey } from '@metaplex-foundation/umi';
import {
  updateV1,
  fetchMetadataFromSeeds,
  findMetadataPda,
} from '@metaplex-foundation/mpl-token-metadata';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createMintClient, uploadSeedMetadata } from './mint-seed-lib.js';
import {
  buildSeedMetadata,
  buildStageMetadata,
  toPublicMetadataUri,
  stageImageUrl,
  SEED_IMAGE_URL,
} from './seed-metadata.js';
import { RPC_URL } from './common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MINTS_PATH = path.join(__dirname, 'mints.devnet.json');
const USER = '9k1QwNaqTmj6JvhzZiszKzCNGGe4Rw3Ezu7CQ3CqHfhi';
const onlyMine = process.argv.includes('--only-mine');
const mintArgIdx = process.argv.indexOf('--mint');
const onlyMint = mintArgIdx >= 0 ? String(process.argv[mintArgIdx + 1] || '').trim() : '';

const STAGE_LABEL_TO_KEY = {
  Seed: 'seed',
  Germination: 'germination',
  Seedling: 'seedling',
  Vegetative: 'vegetative',
  Flowering: 'flowering',
  Harvest: 'harvest',
};

function stageKeyFromRow(row) {
  if (!row?.stage) return null;
  if (STAGE_LABEL_TO_KEY[row.stage]) return STAGE_LABEL_TO_KEY[row.stage];
  const lower = String(row.stage).toLowerCase();
  if (Object.values(STAGE_LABEL_TO_KEY).includes(lower)) return lower;
  return null;
}

function stageKeyFromMetadata(json, row) {
  // Explicit row.stage wins (ops can force Flowering etc. in mints.devnet.json).
  const fromRow = stageKeyFromRow(row);
  if (fromRow) return fromRow;

  const attrs = Array.isArray(json?.attributes) ? json.attributes : [];
  const stageAttr = attrs.find((a) => a && a.trait_type === 'Stage');
  const label = stageAttr ? String(stageAttr.value || '') : '';
  if (STAGE_LABEL_TO_KEY[label]) return STAGE_LABEL_TO_KEY[label];
  const fromRwa = json?.rwa?.stage ? String(json.rwa.stage) : '';
  if (STAGE_LABEL_TO_KEY[fromRwa] || Object.values(STAGE_LABEL_TO_KEY).includes(fromRwa)) {
    return STAGE_LABEL_TO_KEY[fromRwa] || fromRwa;
  }
  // Name hints for early desk mints that never wrote Stage attrs.
  const name = String(row?.name || json?.name || '');
  if (/harvest|dry/i.test(name)) return 'harvest';
  if (/bloom|flower/i.test(name)) return 'flowering';
  if (/veg/i.test(name)) return 'vegetative';
  if (/seedling|sprout/i.test(name)) return 'seedling';
  return 'seed';
}

async function fetchJson(uri) {
  if (!uri) return null;
  const url = toPublicMetadataUri(String(uri));
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

const umi = createMintClient();
const connection = new Connection(RPC_URL, 'confirmed');
const list = JSON.parse(fs.readFileSync(MINTS_PATH, 'utf8'));

let targets = list;
if (onlyMint) {
  targets = list.filter((m) => m.mint === onlyMint);
} else if (onlyMine) {
  targets = list.filter(
    (m) =>
      m.owner === USER ||
      m.mint === '5YXmrcsBjQh7naKgD6j6vjLTiYWmCWjBsg9k6TnNbKd4' ||
      m.mint === '4XbCLB2oJz7cmSAjKicRiCoyPTjvBi1XnY2ryFKt5bao'
  );
}

console.log('Updating', targets.length, 'seed NFT(s) → growto.live botanical images…\n');

async function metadataIsBroken(mintAddress) {
  const pda = findMetadataPda(umi, { mint: publicKey(mintAddress) });
  const info = await connection.getAccountInfo(new PublicKey(String(pda[0])));
  return !info || info.data.length < 100;
}

for (const row of targets) {
  try {
    if (await metadataIsBroken(row.mint)) {
      console.error(
        '✖',
        row.name || row.mint,
        'empty/corrupt metadata PDA — remint with: npm run repair:seed-metadata -- --execute --mint',
        row.mint
      );
      continue;
    }
    const mint = publicKey(row.mint);
    const current = await fetchMetadataFromSeeds(umi, { mint });
    const existingJson = await fetchJson(current.uri || row.metadataUri);

    const seed = {
      name: row.name || existingJson?.name || 'Plant',
      strain:
        row.strain ||
        existingJson?.rwa?.strain ||
        (existingJson?.attributes || []).find((a) => a.trait_type === 'Strain')?.value ||
        'Unknown',
      batch:
        row.batch ||
        existingJson?.rwa?.batch ||
        (existingJson?.attributes || []).find((a) => a.trait_type === 'Batch')?.value ||
        'B-unknown',
      plantId: row.plantId || existingJson?.rwa?.plantId || null,
      importedAt: row.mintedAt || existingJson?.rwa?.importedAt,
    };

    const stageKey = stageKeyFromMetadata(existingJson || {}, row);
    const imageUri = stageImageUrl(stageKey);
    seed.image = imageUri;

    let metadata;
    if (stageKey === 'seed') {
      metadata = buildSeedMetadata(seed);
    } else {
      const label =
        Object.keys(STAGE_LABEL_TO_KEY).find((k) => STAGE_LABEL_TO_KEY[k] === stageKey) ||
        stageKey;
      const history = Array.isArray(existingJson?.rwa?.growthHistory)
        ? existingJson.rwa.growthHistory
        : [];
      metadata = buildStageMetadata(seed, { key: stageKey, label, reward: 0 }, history);
    }

    metadata.image = imageUri;
    metadata.properties.files = [
      { uri: imageUri, type: 'image/png' },
      { uri: SEED_IMAGE_URL, type: 'image/png' },
    ];

    const metadataUri = await uploadSeedMetadata(umi, metadata);
    const result = await updateV1(umi, {
      mint,
      authority: umi.identity,
      data: {
        ...current,
        name: metadata.name,
        symbol: current.symbol || 'SEED',
        uri: metadataUri,
      },
    }).sendAndConfirm(umi);
    const sig = base58.deserialize(result.signature)[0];

    row.metadataUri = metadataUri;
    row.imageUri = imageUri;
    row.artUpdatedAt = new Date().toISOString();
    row.artUpdateSignature = sig;
    row.artSource = 'growto.live-botanical';

    console.log('✔', row.name, `(${stageKey})`);
    console.log('  image:', imageUri);
    console.log('  metadata:', metadataUri);
    console.log('  tx:', sig);
  } catch (err) {
    console.error('✖', row.name || row.mint, err.message || err);
  }
}

fs.writeFileSync(MINTS_PATH, JSON.stringify(list, null, 2) + '\n');
console.log('\nDone. Refresh Phantom/Solflare on Devnet (Collectibles).');
console.log('Images are served from growto.live — deploy token-metadata/images/ if PNGs changed.');
