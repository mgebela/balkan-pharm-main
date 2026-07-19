/*
 * Process pending growth mint requests from Firestore (M3).
 *
 * The app (mintGrowth) writes requests to `growthMints` when a plant token
 * that already has a real devnet Seed NFT advances a stage. For each request
 * this script:
 *   1. uploads new stage metadata to Arweave (Stage trait + growthHistory),
 *   2. updates the NFT's on-chain metadata URI (updateV1),
 *   3. mints the $GROW SPL stage reward to the holder's wallet.
 *
 * Rewards are computed server-side from stages.js — the client-sent reward
 * is ignored.
 *
 * Usage: node process-growth-mints.js [--watch]
 */
import { publicKey, transactionBuilder } from '@metaplex-foundation/umi';
import {
  updateV1,
  fetchMetadataFromSeeds,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  mplToolbox,
  createTokenIfMissing,
  mintTokensTo,
  findAssociatedTokenPda,
} from '@metaplex-foundation/mpl-toolbox';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirestore } from './firebase.js';
import { createMintClient } from './mint-seed-lib.js';
import { buildStageMetadata, toPublicMetadataUri } from './seed-metadata.js';
import { stageByKey, stageIndexByKey } from './stages.js';
import { readDeployed } from './common.js';
import { validateJournalProof } from './grower-quests.js';

const db = initFirestore();
const umi = createMintClient().use(mplToolbox());
const watch = process.argv.includes('--watch');

const deployed = readDeployed();
if (!deployed.growMint) {
  console.error('$GROW mint not deployed yet. Run "npm run deploy:grow" first.');
  process.exit(1);
}
const GROW_MINT = publicKey(deployed.growMint);
const GROW_DECIMALS = Number(deployed.growDecimals || 9);

console.log('Authority:', String(umi.identity.publicKey));
console.log('$GROW mint:', deployed.growMint);

async function loadSeedData(data) {
  if (data.seedMintRequestId) {
    const seedDoc = await db.collection('seedMints').doc(data.seedMintRequestId).get();
    if (seedDoc.exists) {
      const seed = seedDoc.data();
      return {
        name: seed.name,
        strain: seed.strain,
        batch: seed.batch,
        plantId: seed.plantId || null,
        importedAt: seed.requestedAt || undefined,
        recipient: seed.recipient || seed.owner || null,
      };
    }
  }
  return {
    name: data.name,
    strain: data.strain,
    batch: data.batch,
    plantId: data.plantId || null,
    importedAt: undefined,
    recipient: data.recipient || null,
  };
}

async function loadGrowerAppState(uid) {
  if (!uid) return null;
  const snap = await db.collection('users').doc(uid).collection('app').doc('state').get();
  if (!snap.exists) return null;
  return snap.data() || {};
}

async function loadGrowthHistory(mintAddress) {
  const snap = await db
    .collection('growthMints')
    .where('mintAddress', '==', mintAddress)
    .where('status', '==', 'minted')
    .get();
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => stageIndexByKey(a.stage) - stageIndexByKey(b.stage))
    .map((d) => ({ stage: d.stage, reward: d.reward, ts: d.mintedAt, signature: d.signature }));
}

async function processDoc(doc) {
  const data = doc.data();
  const stage = stageByKey(data.stage);
  const label = `${data.name || doc.id} → ${data.stage} (uid ${data.uid || '?'})`;

  try {
    if (!stage || stage.key === 'seed') {
      throw new Error(`Invalid growth stage "${data.stage}".`);
    }
    if (!data.mintAddress) {
      throw new Error('Request has no mintAddress (seed NFT not minted yet).');
    }

    console.log(`Processing ${label}…`);
    const mint = publicKey(data.mintAddress);
    const seed = await loadSeedData(data);
    const plantId = data.plantId || seed.plantId || null;
    const appState = await loadGrowerAppState(data.uid);
    if (!appState) {
      throw new Error(
        'Grower journal state missing — sync plants/entries to dnevnik.live before minting.'
      );
    }
    const proof = validateJournalProof(appState, plantId, stage.key);
    if (!proof.ok) {
      throw new Error('Journal proof failed: ' + proof.errors.join('; '));
    }
    console.log(
      `  journal proof ok · plant ${proof.summary.plantName || plantId} · water ${proof.summary.wateringCount} · feed ${proof.summary.feedingCount}`
    );

    const recipient = publicKey(data.recipient || seed.recipient || umi.identity.publicKey);
    const reward = stage.reward;

    // 1. New stage metadata on Arweave.
    const history = await loadGrowthHistory(data.mintAddress);
    history.push({ stage: stage.key, reward, ts: new Date().toISOString(), signature: null });
    const metadata = buildStageMetadata(seed, stage, history);
    const metadataUri = toPublicMetadataUri(await umi.uploader.uploadJson(metadata));

    // 2. Point the NFT at the new metadata.
    const current = await fetchMetadataFromSeeds(umi, { mint });
    const updateResult = await updateV1(umi, {
      mint,
      authority: umi.identity,
      data: { ...current, uri: metadataUri },
    }).sendAndConfirm(umi);
    const updateSignature = base58.deserialize(updateResult.signature)[0];

    // 3. Mint the $GROW reward to the holder.
    let rewardSignature = '';
    if (reward > 0) {
      const token = findAssociatedTokenPda(umi, { mint: GROW_MINT, owner: recipient });
      const rewardResult = await transactionBuilder()
        .add(createTokenIfMissing(umi, { mint: GROW_MINT, owner: recipient }))
        .add(
          mintTokensTo(umi, {
            mint: GROW_MINT,
            token,
            amount: BigInt(reward) * 10n ** BigInt(GROW_DECIMALS),
          })
        )
        .sendAndConfirm(umi);
      rewardSignature = base58.deserialize(rewardResult.signature)[0];
    }

    await doc.ref.update({
      status: 'minted',
      reward,
      plantId: plantId || null,
      journalValidatedAt: new Date().toISOString(),
      journalSummary: proof.summary,
      metadataUri,
      signature: updateSignature,
      rewardSignature,
      recipient: String(recipient),
      mintedAt: new Date().toISOString(),
      error: FieldValue.delete(),
    });
    console.log(`✔ ${label}: metadata ${metadataUri}`);
    console.log(`  update tx: ${updateSignature}${rewardSignature ? ` · reward tx: ${rewardSignature}` : ''}`);
  } catch (err) {
    console.error(`✘ ${label}: ${err.message}`);
    await doc.ref.update({
      status: 'failed',
      error: String(err.message || err),
      failedAt: new Date().toISOString(),
    });
  }
}

async function processPending() {
  const snap = await db.collection('growthMints').where('status', '==', 'pending').get();
  if (snap.empty) {
    console.log('No pending growth mint requests.');
    return;
  }
  for (const doc of snap.docs) {
    await processDoc(doc);
  }
}

await processPending();

if (watch) {
  console.log('Watching for new growth mint requests (Ctrl+C to stop)…');
  db.collection('growthMints')
    .where('status', '==', 'pending')
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') processDoc(change.doc);
      });
    });
} else {
  process.exit(0);
}
