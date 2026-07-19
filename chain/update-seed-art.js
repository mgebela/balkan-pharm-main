/*
 * Re-upload seed NFT artwork + metadata and update on-chain URIs (devnet).
 *
 * Fixes empty wallet thumbnails caused by Irys returning arweave.net links
 * that do not serve the JSON (use gateway.irys.xyz instead).
 *
 * Usage: node update-seed-art.js [--only-mine]
 *   --only-mine  update only NFTs currently held by the known user wallet
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenericFile, publicKey } from '@metaplex-foundation/umi';
import { updateV1, fetchMetadataFromSeeds } from '@metaplex-foundation/mpl-token-metadata';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createMintClient, uploadSeedMetadata } from './mint-seed-lib.js';
import { buildSeedMetadata, toPublicMetadataUri, SEED_IMAGE_URL } from './seed-metadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MINTS_PATH = path.join(__dirname, 'mints.devnet.json');
const IMAGE_PATH = path.join(__dirname, '../token-metadata/images/seed-rwa.png');
const USER = '9k1QwNaqTmj6JvhzZiszKzCNGGe4Rw3Ezu7CQ3CqHfhi';
const onlyMine = process.argv.includes('--only-mine');

const umi = createMintClient();
const list = JSON.parse(fs.readFileSync(MINTS_PATH, 'utf8'));

console.log('Uploading seed artwork…');
const png = fs.readFileSync(IMAGE_PATH);
const imageFile = createGenericFile(png, 'seed-rwa.png', { contentType: 'image/png' });
const [rawImageUri] = await umi.uploader.upload([imageFile]);
const imageUri = toPublicMetadataUri(rawImageUri);
console.log('Image URI:', imageUri);

const targets = onlyMine
  ? list.filter((m) => m.owner === USER || m.mint === '5YXmrcsBjQh7naKgD6j6vjLTiYWmCWjBsg9k6TnNbKd4' || m.mint === '4XbCLB2oJz7cmSAjKicRiCoyPTjvBi1XnY2ryFKt5bao')
  : list;

console.log('Updating', targets.length, 'seed NFT(s)…\n');

for (const row of targets) {
  const seed = {
    name: row.name,
    strain: row.strain,
    batch: row.batch,
    plantId: row.plantId || null,
    importedAt: row.mintedAt,
    image: imageUri,
  };
  const metadata = buildSeedMetadata(seed);
  // Prefer Irys image now; keep site URL as secondary file for after deploy.
  metadata.properties.files = [
    { uri: imageUri, type: 'image/png' },
    { uri: SEED_IMAGE_URL, type: 'image/png' },
  ];
  const metadataUri = await uploadSeedMetadata(umi, metadata);

  const mint = publicKey(row.mint);
  const current = await fetchMetadataFromSeeds(umi, { mint });
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

  console.log('✔', row.name);
  console.log('  metadata:', metadataUri);
  console.log('  tx:', sig);
}

fs.writeFileSync(MINTS_PATH, JSON.stringify(list, null, 2) + '\n');
console.log('\nDone. Refresh Phantom/Solflare on Devnet (Collectibles).');
console.log('If thumbnails lag, open the NFT on Solscan and wait ~1–2 minutes.');
