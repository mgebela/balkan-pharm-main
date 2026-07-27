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
import {
  RPC_URL,
  loadMintSecret,
  loadEscrowSecret,
  loadFeePayerSecret,
  LEGACY_ESCROW_ADDRESS,
  readDeployed,
} from './common.js';
import { buildSeedMetadata, SEED_SYMBOL, toPublicMetadataUri } from './seed-metadata.js';

const IRYS_DEVNET = 'https://devnet.irys.xyz';

/** Umi client signed by the mint / collection / $GROWTOO authority. */
export function createMintClient() {
  const umi = createUmi(RPC_URL)
    .use(mplTokenMetadata())
    .use(irysUploader({ address: IRYS_DEVNET }));
  const authority = umi.eddsa.createKeypairFromSecretKey(loadMintSecret());
  umi.use(keypairIdentity(authority));
  return umi;
}

/**
 * Market client: fee payer is umi.identity; escrow vault is a separate signer.
 * Falls back to mint authority for either role if role key files are missing.
 */
export function createMarketClient() {
  const umi = createUmi(RPC_URL).use(mplTokenMetadata());
  const feeKp = umi.eddsa.createKeypairFromSecretKey(loadFeePayerSecret());
  const escrowKp = umi.eddsa.createKeypairFromSecretKey(loadEscrowSecret());
  umi.use(keypairIdentity(feeKp));
  const deployed = readDeployed();
  return {
    umi,
    escrowSigner: escrowKp,
    escrowAddress: String(escrowKp.publicKey),
    feePayerAddress: String(feeKp.publicKey),
    legacyEscrowAddress: deployed.legacyEscrowAddress || LEGACY_ESCROW_ADDRESS,
    mintAuthoritySecret: loadMintSecret(),
  };
}

export async function uploadSeedMetadata(umi, metadata) {
  const rawUri = await umi.uploader.uploadJson(metadata);
  return toPublicMetadataUri(rawUri);
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

  const metadataUri = await uploadSeedMetadata(umi, metadata);

  const mint = generateSigner(umi);
  const owner = opts.recipient ? publicKey(opts.recipient) : umi.identity.publicKey;

  // Devnet RPCs often lag: verifyCollectionV1 right after createNft throws
  // "Incorrect account owner" (0x39). Finalize create, then retry verify.
  const created = await createNft(umi, {
    mint,
    name: metadata.name,
    symbol: SEED_SYMBOL,
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenOwner: owner,
    collection: { key: publicKey(collection), verified: false },
  }).sendAndConfirm(umi, {
    send: { commitment: 'confirmed' },
    confirm: { commitment: 'finalized' },
  });

  const metadataPda = findMetadataPda(umi, { mint: mint.publicKey });
  let verified = false;
  let lastVerifyErr = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await verifyCollectionV1(umi, {
        metadata: metadataPda,
        collectionMint: publicKey(collection),
        authority: umi.identity,
      }).sendAndConfirm(umi, {
        send: { commitment: 'confirmed' },
        confirm: { commitment: 'confirmed' },
      });
      verified = true;
      break;
    } catch (err) {
      lastVerifyErr = err;
      const msg = String((err && err.message) || err || '');
      const retryable = /Incorrect account owner|0x39|not found|timed out|block height|expired|429|Too Many Requests/i.test(
        msg
      );
      if (!retryable || attempt === 6) break;
      await new Promise(function (resolve) {
        setTimeout(resolve, 1500 * attempt);
      });
    }
  }

  if (!verified) {
    // NFT exists; leave it minted rather than failing the whole request.
    // Collection can be verified later; grower already holds the token.
    console.warn(
      'verifyCollectionV1 failed after createNft; returning mint unverified:',
      lastVerifyErr && lastVerifyErr.message ? lastVerifyErr.message : lastVerifyErr
    );
  }

  return {
    mint: String(mint.publicKey),
    metadataUri,
    signature: base58.deserialize(created.signature)[0],
    owner: String(owner),
    collectionVerified: verified,
  };
}
