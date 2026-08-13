/*
 * Platform monthly $GROWTOO bonus (marketing / UA).
 *
 * Separate from adopter escrow. Growers file platformRewards/{id} with
 * status pending + monthKey; this worker scores activity and mints reward.
 *
 * Formula (Devnet, capped at 50) — see platform-reward-score.js:
 *   +1 per distinct watering/feeding day (max 20)
 *   +1 per distinct feeding day (max 8)
 *   +5 per published story (max 2)
 *   +3 per ISO week with 5+ care days (max 4)
 *   +2 per new plant, +5 per seed mint, +10 flower/harvest seal
 *
 * Also processes source: 'adopter_faucet' docs (fixed test mint, no scoring).
 *
 * Usage: node process-platform-rewards.js [--watch]
 */
import { publicKey, transactionBuilder } from '@metaplex-foundation/umi';
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
import { readDeployed } from './common.js';
import { tryClaimLease, clearLease, workerId } from './queue-lease.js';
import { isRetryableChainError } from './retryable.js';
import { isoWeekKey } from './weekly-care.js';
import { collectMonthlyActivity, scorePlatformReward } from './platform-reward-score.js';
import { notifyUser } from './notify-user.js';

const db = initFirestore();
const umi = createMintClient().use(mplToolbox());
const watch = process.argv.includes('--watch');

const deployed = readDeployed();
if (!deployed.growMint) {
  console.error('$GROWTOO mint not deployed yet. Run "npm run deploy:grow" first.');
  process.exit(1);
}
const GROW_MINT = publicKey(deployed.growMint);
const GROW_DECIMALS = Number(deployed.growDecimals || 9);
console.log('Authority:', String(umi.identity.publicKey));
console.log('Worker:', workerId());

function monthBounds(monthKey) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end, startMs: start.getTime(), endMs: end.getTime() };
}

function currentMonthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function loadGrowerAppState(uid) {
  const snap = await db.collection('users').doc(uid).collection('app').doc('state').get();
  if (!snap.exists) return null;
  return snap.data() || {};
}

async function countPublishedStories(uid, startMs, endMs) {
  const snap = await db.collection('users').doc(uid).collection('growerPosts').get();
  let n = 0;
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (d.status !== 'published') return;
    const t = Date.parse(d.publishedAt || d.createdAt || '');
    if (Number.isFinite(t) && t >= startMs && t < endMs) n += 1;
  });
  return n;
}

async function countSeedMints(uid, startMs, endMs) {
  const snap = await db
    .collection('seedMints')
    .where('uid', '==', uid)
    .where('status', '==', 'minted')
    .get();
  let n = 0;
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const t = Date.parse(d.mintedAt || d.requestedAt || '');
    if (Number.isFinite(t) && t >= startMs && t < endMs) n += 1;
  });
  return n;
}

async function hasFloweringOrHarvest(uid, startMs, endMs) {
  const snap = await db
    .collection('growthMints')
    .where('uid', '==', uid)
    .where('status', '==', 'minted')
    .get();
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (d.stage !== 'flowering' && d.stage !== 'harvest') continue;
    const t = Date.parse(d.mintedAt || d.requestedAt || '');
    if (Number.isFinite(t) && t >= startMs && t < endMs) return true;
  }
  return false;
}

async function processDoc(doc) {
  const data = doc.data();
  const label = `platform ${data.uid || doc.id} ${data.monthKey || data.dayKey || ''}`;
  if (data.status !== 'pending') return;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased, skipping`);
    return;
  }
  try {
    if (!data.uid) throw new Error('uid required');
    if (!data.recipient) throw new Error('recipient pubkey required');

    // Adopter Devnet test faucet — fixed mint, no grower activity scoring.
    if (data.source === 'adopter_faucet') {
      if (!data.dayKey) throw new Error('Faucet claim requires a dayKey.');

      // Idempotency: one minted faucet claim per uid+dayKey. The rules bind the
      // doc id to the day, which stops a user creating extras — this is the
      // second lock, and it also catches anything created before that rule
      // landed. Equality-only filters, so no composite index needed.
      const priorFaucet = await db
        .collection('platformRewards')
        .where('uid', '==', data.uid)
        .where('source', '==', 'adopter_faucet')
        .where('dayKey', '==', data.dayKey)
        .where('status', '==', 'minted')
        .get();
      if (priorFaucet.docs.some((d) => d.id !== doc.id)) {
        throw new Error(`Faucet already minted for ${data.uid} on ${data.dayKey}.`);
      }

      const amount = Math.max(1, Math.min(500, Number(data.amount || 100)));
      const recipient = publicKey(data.recipient);
      const token = findAssociatedTokenPda(umi, { mint: GROW_MINT, owner: recipient });
      const rewardResult = await transactionBuilder()
        .add(createTokenIfMissing(umi, { mint: GROW_MINT, owner: recipient }))
        .add(
          mintTokensTo(umi, {
            mint: GROW_MINT,
            token,
            amount: BigInt(amount) * 10n ** BigInt(GROW_DECIMALS),
          })
        )
        .sendAndConfirm(umi);
      const rewardSignature = base58.deserialize(rewardResult.signature)[0];

      await doc.ref.update({
        status: 'minted',
        reward: amount,
        rewardSignature,
        mintedAt: new Date().toISOString(),
        mintedBy: workerId(),
        source: 'adopter_faucet',
        error: FieldValue.delete(),
      });
      console.log(`✔ faucet ${label}: minted ${amount} $GROWTOO → ${data.recipient}`);
      try {
        await notifyUser(db, data.uid, {
          type: 'test_faucet',
          title: 'Test $GROWTOO claimed',
          body:
            '+' +
            amount +
            ' $GROWTOO sent to your Devnet wallet. You can Invest on the market.',
          meta: { dayKey: data.dayKey, reward: amount, key: 'faucet-mint:' + doc.id },
          action: { view: 'market' },
          source: 'process-platform-rewards',
        });
      } catch (notifyErr) {
        console.warn('notify faucet failed', notifyErr.message || notifyErr);
      }
      return;
    }

    const bounds = monthBounds(data.monthKey);
    if (!bounds) throw new Error('Invalid monthKey (expected YYYY-MM)');

    // Idempotency: only one minted *platform* reward per uid+monthKey (faucets excluded).
    const prior = await db
      .collection('platformRewards')
      .where('uid', '==', data.uid)
      .where('monthKey', '==', data.monthKey)
      .where('status', '==', 'minted')
      .get();
    const conflict = prior.docs.find((d) => {
      if (d.id === doc.id) return false;
      return (d.data() || {}).source !== 'adopter_faucet';
    });
    if (conflict) {
      throw new Error('Platform bonus already minted for this month.');
    }

    const state = (await loadGrowerAppState(data.uid)) || {};
    const publishedStories = await countPublishedStories(
      data.uid,
      bounds.startMs,
      bounds.endMs
    );
    const seedMints = await countSeedMints(data.uid, bounds.startMs, bounds.endMs);
    const flowerBonus = await hasFloweringOrHarvest(data.uid, bounds.startMs, bounds.endMs);
    const breakdown = collectMonthlyActivity(state, data.monthKey, {
      publishedStories,
      seedMints,
      flowerBonus,
    });
    const reward = scorePlatformReward(breakdown);
    if (reward <= 0) {
      throw new Error(
        'No activity this month to reward. Log watering or feeding, then claim again.'
      );
    }

    const recipient = publicKey(data.recipient);
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
    const rewardSignature = base58.deserialize(rewardResult.signature)[0];

    await doc.ref.update({
      status: 'minted',
      reward,
      breakdown,
      rewardSignature,
      mintedAt: new Date().toISOString(),
      mintedBy: workerId(),
      source: 'platform',
      error: FieldValue.delete(),
    });
    console.log(`✔ ${label}: minted ${reward} $GROWTOO → ${data.recipient}`);
    try {
      await notifyUser(db, data.uid, {
        type: 'platform_bonus',
        title: 'Platform bonus minted',
        body:
          '+' +
          reward +
          ' $GROWTOO for ' +
          (breakdown.careDays || 0) +
          ' care days in ' +
          (data.monthKey || 'this month') +
          '.',
        meta: { monthKey: data.monthKey, reward, key: 'platform-mint:' + doc.id },
        action: { view: 'adopt' },
        source: 'process-platform-rewards',
      });
    } catch (notifyErr) {
      console.warn('notify platform bonus failed', notifyErr.message || notifyErr);
    }
  } catch (err) {
    console.error(`✘ ${label}: ${err.message}`);
    if (isRetryableChainError(err)) {
      await doc.ref.update({
        lastError: String(err.message || err),
        lastErrorAt: new Date().toISOString(),
      });
    } else {
      await doc.ref.update({
        status: 'failed',
        error: String(err.message || err),
        failedAt: new Date().toISOString(),
      });
    }
  } finally {
    await clearLease(doc.ref);
  }
}

async function processPending() {
  const snap = await db.collection('platformRewards').where('status', '==', 'pending').get();
  if (snap.size) console.log(`… platformRewards pending: ${snap.size}`);
  for (const doc of snap.docs) {
    await processDoc(doc);
  }
  console.log('Platform rewards pass complete.', currentMonthKey(), isoWeekKey(Date.now()));
}

await processPending();

if (watch) {
  console.log('Watching platformRewards…');
  db.collection('platformRewards')
    .where('status', '==', 'pending')
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          processDoc(change.doc);
        }
      });
    });
} else {
  process.exit(0);
}
