/*
 * Create the dnevnik.live seed NFT collection on Solana devnet (Metaplex).
 * Future plant NFTs (M2) will be verified members of this collection.
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNft, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  keypairIdentity,
  percentAmount,
} from '@metaplex-foundation/umi';
import { RPC_URL, loadAuthoritySecret, readDeployed, writeDeployed, solscanAddress } from './common.js';

const METADATA_URI = 'https://dnevnik.live/token-metadata/seed-collection.json';

const existing = readDeployed();
if (existing.seedCollection) {
  console.log('Seed collection already deployed:', existing.seedCollection);
  console.log('Solscan:', solscanAddress(existing.seedCollection));
  process.exit(0);
}

const umi = createUmi(RPC_URL).use(mplTokenMetadata());
const authority = umi.eddsa.createKeypairFromSecretKey(loadAuthoritySecret());
umi.use(keypairIdentity(authority));

console.log('Authority:', authority.publicKey);
console.log('Creating seed NFT collection…');

const collectionMint = generateSigner(umi);

await createNft(umi, {
  mint: collectionMint,
  name: 'dnevnik.live Seeds',
  symbol: 'SEED',
  uri: METADATA_URI,
  sellerFeeBasisPoints: percentAmount(0),
  isCollection: true,
}).sendAndConfirm(umi);

const record = writeDeployed({
  cluster: 'devnet',
  authority: String(authority.publicKey),
  seedCollection: String(collectionMint.publicKey),
  seedCollectionMetadataUri: METADATA_URI,
});

console.log('\nSeed collection deployed on devnet.');
console.log('Collection address:', record.seedCollection);
console.log('Solscan:', solscanAddress(record.seedCollection));
