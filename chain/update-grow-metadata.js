/*
 * Update on-chain $GROWTOO Metaplex name, symbol, image, and metadata URI.
 * Image points at growto.live brass mark (reliable); JSON uploads via Irys.
 *
 * Usage: node update-grow-metadata.js
 * Prerequisite: deploy token-metadata/images/growtoo.png to growto.live
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  updateV1,
  fetchMetadataFromSeeds,
} from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createMintClient } from './mint-seed-lib.js';
import { toPublicMetadataUri } from './seed-metadata.js';
import { readDeployed, writeDeployed, solscanAddress } from './common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void __dirname;

const SITE_JSON = 'https://growto.live/token-metadata/grow.json';
const SITE_IMAGE = 'https://growto.live/token-metadata/images/growtoo.png';
const NAME = 'GROWTOO';
const SYMBOL = 'GROWTOO';

const deployed = readDeployed();
if (!deployed.growMint) {
  console.error('No growMint in deployed.devnet.json — run deploy:grow first.');
  process.exit(1);
}

const umi = createMintClient();
const mint = publicKey(deployed.growMint);

console.log('Mint:', String(mint));
console.log('Using hosted brass mark:', SITE_IMAGE);

const metadata = {
  name: NAME,
  symbol: SYMBOL,
  description:
    '$GROWTOO is the growth reward token of growtoo — earned as adopted CBD plants advance through real growth stages documented in the grow journal. Devnet deployment.',
  image: SITE_IMAGE,
  external_url: 'https://growto.live',
  attributes: [
    { trait_type: 'Network', value: 'Solana Devnet' },
    { trait_type: 'Project', value: 'growtoo' },
  ],
  properties: {
    category: 'image',
    files: [{ uri: SITE_IMAGE, type: 'image/png' }],
  },
};

console.log('Uploading metadata JSON…');
const metadataUri = toPublicMetadataUri(await umi.uploader.uploadJson(metadata));
console.log('Metadata URI:', metadataUri);

const current = await fetchMetadataFromSeeds(umi, { mint });
console.log('Updating on-chain metadata…');
const result = await updateV1(umi, {
  mint,
  authority: umi.identity,
  data: {
    ...current,
    name: NAME,
    symbol: SYMBOL,
    uri: metadataUri,
  },
}).sendAndConfirm(umi);

const sig = base58.deserialize(result.signature)[0];
deployed.growMetadataUri = metadataUri;
deployed.growImageUri = SITE_IMAGE;
deployed.growUpdatedAt = new Date().toISOString();
deployed.growUpdateSignature = sig;
writeDeployed(deployed);

console.log('✔ Updated');
console.log('  metadata:', metadataUri);
console.log('  site JSON:', SITE_JSON);
console.log('  image:', SITE_IMAGE);
console.log('  tx:', sig);
console.log('  mint:', solscanAddress(String(mint)));
