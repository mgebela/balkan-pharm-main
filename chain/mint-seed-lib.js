/*
 * Seed NFT minting (M2).
 *
 * Uploads seed RWA metadata to Arweave (via Irys devnet, paid with the
 * authority's devnet SOL) and mints a Seed NFT into the deployed
 * "dnevnik.live Seeds" collection, verified by the collection authority.
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createNft,
  verifyCollectionV1,
  findMetadataPda,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  keypairIdentity,
  percentAmount,
  publicKey,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { RPC_URL, loadAuthoritySecret, readDeployed } from './common.js';
import { buildSeedMetadata, SEED_SYMBOL } from './seed-metadata.js';

const IRYS_DEVNET = 'https://devnet.irys.xyz';

export function createMintClient() {
  const umi = createUmi(RPC_URL)
    .use(mplTokenMetadata())
    .use(irysUploader({ address: IRYS_DEVNET }));
  const authority = umi.eddsa.createKeypairFromSecretKey(loadAuthoritySecret());
  umi.use(keypairIdentity(authority));
  return umi;
}

export function requireSeedCollection() {
  const deployed = readDeployed();
  if (!deployed.seedCollection) {
    throw new Error(
      'Seed collection not deployed yet. Run "npm run deploy:collection" first (needs a funded authority wallet).'
    );
  }
  return deployed.seedCollection;
}

/**
 * Mint one seed NFT.
 * @param {object} umi        Umi client from createMintClient().
 * @param {object} seed       { name, strain, batch, plantId?, importedAt? }
 * @param {object} [options]  { recipient?: base58 pubkey, collection?: base58 pubkey }
 * @returns {Promise<{mint: string, metadataUri: string, signature: string, owner: string}>}
 */
export async function mintSeedNft(umi, seed, options) {
  const opts = options || {};
  const collection = opts.collection || requireSeedCollection();
  const metadata = buildSeedMetadata(seed);

  const metadataUri = await umi.uploader.uploadJson(metadata);

  const mint = generateSigner(umi);
  const owner = opts.recipient ? publicKey(opts.recipient) : umi.identity.publicKey;

  const created = await createNft(umi, {
    mint,
    name: metadata.name,
    symbol: SEED_SYMBOL,
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenOwner: owner,
    collection: { key: publicKey(collection), verified: false },
  }).sendAndConfirm(umi);

  await verifyCollectionV1(umi, {
    metadata: findMetadataPda(umi, { mint: mint.publicKey }),
    collectionMint: publicKey(collection),
    authority: umi.identity,
  }).sendAndConfirm(umi);

  return {
    mint: String(mint.publicKey),
    metadataUri,
    signature: base58.deserialize(created.signature)[0],
    owner: String(owner),
  };
}
