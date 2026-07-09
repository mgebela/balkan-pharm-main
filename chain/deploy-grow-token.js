/*
 * Deploy the $GROW SPL fungible token on Solana devnet with Metaplex metadata.
 * One-time script — records the mint address in deployed.devnet.json.
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createFungible,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  keypairIdentity,
  percentAmount,
} from '@metaplex-foundation/umi';
import { RPC_URL, loadAuthoritySecret, readDeployed, writeDeployed, solscanAddress } from './common.js';

const METADATA_URI = 'https://dnevnik.live/token-metadata/grow.json';
const DECIMALS = 9;

const existing = readDeployed();
if (existing.growMint) {
  console.log('$GROW mint already deployed:', existing.growMint);
  console.log('Solscan:', solscanAddress(existing.growMint));
  process.exit(0);
}

const umi = createUmi(RPC_URL).use(mplTokenMetadata());
const authority = umi.eddsa.createKeypairFromSecretKey(loadAuthoritySecret());
umi.use(keypairIdentity(authority));

console.log('Authority:', authority.publicKey);
console.log('Deploying $GROW fungible token (decimals:', DECIMALS + ')…');

const mint = generateSigner(umi);

await createFungible(umi, {
  mint,
  name: 'GROW',
  symbol: 'GROW',
  uri: METADATA_URI,
  sellerFeeBasisPoints: percentAmount(0),
  decimals: DECIMALS,
}).sendAndConfirm(umi);

const record = writeDeployed({
  cluster: 'devnet',
  authority: String(authority.publicKey),
  growMint: String(mint.publicKey),
  growDecimals: DECIMALS,
  growMetadataUri: METADATA_URI,
});

console.log('\n$GROW deployed on devnet.');
console.log('Mint address:', record.growMint);
console.log('Solscan:', solscanAddress(record.growMint));
