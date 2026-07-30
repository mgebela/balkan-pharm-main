/*
 * Update on-chain $GROWTOO Metaplex name, symbol, image, and metadata URI.
 * Uploads the growtoo logo + JSON via Irys (devnet), then updateV1 on the mint.
 *
 * Usage: node update-grow-metadata.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenericFile } from '@metaplex-foundation/umi';
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
const IMAGE_PATH = path.join(__dirname, '../token-metadata/images/growtoo.png');
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
console.log('Uploading growtoo logo…');
const png = fs.readFileSync(IMAGE_PATH);
const imageFile = createGenericFile(png, 'growtoo.png', { contentType: 'image/png' });
const [rawImageUri] = await umi.uploader.upload([imageFile]);
const imageUri = toPublicMetadataUri(rawImageUri);
console.log('Image URI:', imageUri);

const metadata = {
  name: NAME,
  symbol: SYMBOL,
  description:
    '$GROWTOO is the growth reward token of growtoo — earned as adopted CBD plants advance through real growth stages documented in the grow journal. Devnet deployment.',
  image: imageUri,
  external_url: 'https://growto.live',
  attributes: [
    { trait_type: 'Network', value: 'Solana devnet' },
    { trait_type: 'Project', value: 'growtoo' },
  ],
  properties: {
    category: 'image',
    files: [
      { uri: imageUri, type: 'image/png' },
      { uri: SITE_IMAGE, type: 'image/png' },
    ],
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
writeDeployed({
  growMetadataUri: metadataUri,
  growImageUri: imageUri,
  growSiteMetadataUri: SITE_JSON,
  growName: NAME,
  growSymbol: SYMBOL,
  growMetadataUpdatedAt: new Date().toISOString(),
  growMetadataUpdateSignature: sig,
});

console.log('\n$GROWTOO metadata updated.');
console.log('Name/symbol:', NAME);
console.log('Tx:', sig);
console.log('Solscan:', solscanAddress(deployed.growMint));
