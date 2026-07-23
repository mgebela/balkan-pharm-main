/*
 * Platform monthly $GROWTOO bonus (marketing / UA).
 *
 * Separate from adopter escrow. Growers file platformRewards/{id} with
 * status pending + monthKey; this worker scores activity and mints reward.
 *
 * Formula (Devnet, capped at 50):
 *   base 5
 *   + 2 per new plant created that month
 *   + 5 per seed minted that month
 *   + 3 per qualifying care week that month
 *   + 10 if any linked growth mint reached flowering or harvest that month
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
import {
  isoWeekKey,
  enumerateWeekKeys,
  validateWeeklyCareProof,
  weekKeyToUtcMonday,
} from './weekly-care.js';

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
const CAP = 50;

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

function countNewPlants(state, startMs, endMs) {
  const plants = Array.isArray(state?.plants) ? state.plants : [];
  return plants.filter((p) => {
    if (!p) return false;
    const raw = p.createdAt || p.startDate || p.updatedAt;
    const t = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(t) && t >= startMs && t < endMs;
  }).length;
}

function countQualifyingWeeksInMonth(state, startMs, endMs) {
  const plants = Array.isArray(state?.plants) ? state.plants : [];
  const weekKeys = enumerateWeekKeys(startMs, endMs - 1);
  let count = 0;
  const details = [];
  for (const plant of plants) {
    if (!plant?.id) continue;
    for (const wk of weekKeys) {
      const monday = weekKeyToUtcMonday(wk);
      if (!monday) continue;
      const weekEnd = new Date(monday);
      weekEnd.setUTCDate(monday.getUTCDate() + 7);
      // Count week if it overlaps the month window
      if (weekEnd.getTime() <= startMs || monday.getTime() >= endMs) continue;
      const proof = validateWeeklyCareProof(state, plant.id, wk);
      if (proof.ok) {
        count += 1;
        details.push({ plantId: plant.id, weekKey: wk, daysHit: proof.daysHit });
      }
    }
  }
  return { count, details };
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

function scorePlatformReward(parts) {
  const base = 5;
  const plants = 2 * Number(parts.newPlants || 0);
  const seeds = 5 * Number(parts.seedMints || 0);
  const weeks = 3 * Number(parts.qualifyingWeeks || 0);
  const flower = parts.flowerBonus ? 10 : 0;
  const raw = base + plants + seeds + weeks + flower;
  return Math.min(CAP, Math.max(0, raw));
}

async function processDoc(doc) {
  const data = doc.data();
  const label = `platform ${data.uid || doc.id} ${data.monthKey || ''}`;
  if (data.status !== 'pending') return;
  if (!(await tryClaimLease(doc.ref))) {
    console.log(`… ${label}: leased, skipping`);
    return;
  }
  try {
    const bounds = monthBounds(data.monthKey);
    if (!bounds) throw new Error('Invalid monthKey (expected YYYY-MM)');
    if (!data.uid) throw new Error('uid required');
    if (!data.recipient) throw new Error('recipient pubkey required');

    // Idempotency: only one minted reward per uid+monthKey
    const prior = await db
      .collection('platformRewards')
      .where('uid', '==', data.uid)
      .where('monthKey', '==', data.monthKey)
      .where('status', '==', 'minted')
      .limit(1)
      .get();
    if (!prior.empty && prior.docs[0].id !== doc.id) {
      throw new Error('Platform bonus already minted for this month.');
    }

    const state = (await loadGrowerAppState(data.uid)) || {};
    const newPlants = countNewPlants(state, bounds.startMs, bounds.endMs);
    const seedMints = await countSeedMints(data.uid, bounds.startMs, bounds.endMs);
    const weekInfo = countQualifyingWeeksInMonth(state, bounds.startMs, bounds.endMs);
    const flowerBonus = await hasFloweringOrHarvest(data.uid, bounds.startMs, bounds.endMs);

    const breakdown = {
      base: 5,
      newPlants,
      seedMints,
      qualifyingWeeks: weekInfo.count,
      flowerBonus,
      weekDetails: weekInfo.details.slice(0, 40),
    };
    const reward = scorePlatformReward(breakdown);
    if (reward <= 0) throw new Error('Computed reward is zero.');

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
