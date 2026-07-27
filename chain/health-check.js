/*
 * Ops health check — mint queues, escrow/settlement pending, NFT custody disputes.
 *
 * Usage:
 *   node health-check.js
 *   STUCK_MINUTES=30 node health-check.js
 *
 * Exit 1 when critical issues are found (stuck pending / custody mismatch).
 * Exit 0 when clean (recent failed mints are warnings only).
 */
import { Keypair } from '@solana/web3.js';
import { initFirestore } from './firebase.js';
import {
  loadEscrowSecret,
  LEGACY_ESCROW_ADDRESS,
  readDeployed,
} from './common.js';
import { rpcFetch } from './rpc.js';

const STUCK_MINUTES = Math.max(5, Number(process.env.STUCK_MINUTES || 30));
const FAILED_LOOKBACK_HOURS = Math.max(1, Number(process.env.FAILED_LOOKBACK_HOURS || 24));
const STUCK_MS = STUCK_MINUTES * 60 * 1000;
const FAILED_LOOKBACK_MS = FAILED_LOOKBACK_HOURS * 60 * 60 * 1000;

const db = initFirestore();
const deployed = readDeployed();

function escrowPubkeys() {
  const set = new Set();
  try {
    set.add(Keypair.fromSecretKey(loadEscrowSecret()).publicKey.toBase58());
  } catch {
    // Keys optional for CI if deployed.json has addresses.
  }
  for (const key of [
    deployed.escrowAddress,
    deployed.careEscrowAddress,
    deployed.legacyEscrowAddress,
    deployed.marketplacePda,
    LEGACY_ESCROW_ADDRESS,
    process.env.MARKET_ESCROW_ADDRESS,
  ]) {
    if (key) set.add(String(key));
  }
  return [...set];
}

const CUSTODY_OWNERS = escrowPubkeys();

function parseTime(raw) {
  if (!raw) return null;
  if (typeof raw.toDate === 'function') return raw.toDate().getTime();
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function ageMinutes(raw) {
  const ms = parseTime(raw);
  if (ms == null) return null;
  return Math.round((Date.now() - ms) / 60000);
}

function isStuck(raw) {
  const ms = parseTime(raw);
  if (ms == null) return true;
  return Date.now() - ms >= STUCK_MS;
}

function statusEnteredAt(data, status) {
  if (status === 'sale_pending') return data.investedAt || data.createdAt;
  if (status === 'cancel_requested') {
    return data.cancelRequestedAt || data.updatedAt || data.createdAt;
  }
  if (status === 'escrow_pending') return data.createdAt;
  if (status === 'pending') {
    return data.requestedAt || data.createdAt || data.queuedAt;
  }
  return data.createdAt;
}

function isPendingPaymentReservation(data) {
  return String(data.paymentSignature || '').startsWith('pending-');
}

function shortId(id) {
  return String(id || '').slice(0, 10);
}

async function ownerHoldsMint(owner, mintAddress) {
  const result = await rpcFetch('getTokenAccountsByOwner', [
    owner,
    { mint: mintAddress },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);
  const values = (result && result.value) || [];
  return values.some((a) => {
    const amount =
      a &&
      a.account &&
      a.account.data &&
      a.account.data.parsed &&
      a.account.data.parsed.info &&
      a.account.data.parsed.info.tokenAmount &&
      a.account.data.parsed.info.tokenAmount.amount;
    return Number(amount || 0) >= 1;
  });
}

async function expectedCustodyHolds(row) {
  const owners = new Set();
  if (row.settlement === 'program' && row.listingPda) {
    owners.add(String(row.listingPda));
  }
  for (const owner of CUSTODY_OWNERS) owners.add(owner);
  for (const owner of owners) {
    if (await ownerHoldsMint(owner, row.mintAddress)) {
      return { held: true, owner, checked: [...owners] };
    }
  }
  return { held: false, owner: null, checked: [...owners] };
}

async function largestTokenOwner(mintAddress) {
  try {
    const result = await rpcFetch('getTokenLargestAccounts', [
      mintAddress,
      { commitment: 'confirmed' },
    ]);
    const values = (result && result.value) || [];
    const top = values.find((v) => Number(v.amount || 0) >= 1);
    if (!top || !top.address) return null;
    const info = await rpcFetch('getAccountInfo', [
      top.address,
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    const owner =
      info &&
      info.value &&
      info.value.data &&
      info.value.data.parsed &&
      info.value.data.parsed.info &&
      info.value.data.parsed.info.owner;
    return owner || null;
  } catch {
    return null;
  }
}

async function collectByStatus(collection, status) {
  const snap = await db.collection(collection).where('status', '==', status).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function issue(severity, kind, message, meta) {
  findings.push({ severity, kind, message, meta: meta || {} });
}

const findings = [];

async function checkMintQueue(collection, label) {
  const pending = await collectByStatus(collection, 'pending');
  for (const row of pending) {
    const entered = statusEnteredAt(row, 'pending');
    const age = ageMinutes(entered);
    if (isStuck(entered)) {
      issue('critical', 'mint_stuck', `${label} pending too long`, {
        id: row.id,
        name: row.name || null,
        uid: row.uid || null,
        ageMinutes: age,
        lastError: row.lastError || row.error || null,
      });
    }
  }

  const failed = await collectByStatus(collection, 'failed');
  let failedRecent = 0;
  for (const row of failed) {
    const failedAt = parseTime(row.failedAt || row.updatedAt || row.createdAt);
    if (failedAt != null && Date.now() - failedAt <= FAILED_LOOKBACK_MS) {
      failedRecent += 1;
      issue('warning', 'mint_failed', `${label} failed recently`, {
        id: row.id,
        name: row.name || null,
        uid: row.uid || null,
        error: row.error || null,
        failedAt: row.failedAt || null,
      });
    }
  }

  return { pending: pending.length, failedRecent };
}

async function checkMarketPending() {
  const counts = {
    escrow_pending: 0,
    sale_pending: 0,
    cancel_requested: 0,
  };

  for (const status of Object.keys(counts)) {
    const rows = await collectByStatus('marketListings', status);
    counts[status] = rows.length;
    for (const row of rows) {
      if (status === 'sale_pending' && isPendingPaymentReservation(row)) {
        // Unpaid reservation — queue should reopen; only flag if very stuck.
        const entered = statusEnteredAt(row, status);
        if (isStuck(entered) && (ageMinutes(entered) || 0) >= STUCK_MINUTES * 2) {
          issue('warning', 'sale_reservation_stuck', 'Unpaid sale reservation lingering', {
            id: row.id,
            name: row.name || null,
            ageMinutes: ageMinutes(entered),
          });
        }
        continue;
      }
      const entered = statusEnteredAt(row, status);
      if (isStuck(entered)) {
        issue('critical', status, `Listing stuck in ${status}`, {
          id: row.id,
          name: row.name || null,
          settlement: row.settlement || null,
          mintAddress: row.mintAddress || null,
          ageMinutes: ageMinutes(entered),
          lastError: row.lastError || row.error || null,
        });
      }
    }
  }
  return counts;
}

async function checkCustodyDisputes() {
  const active = await collectByStatus('marketListings', 'active');
  const escrowPending = await collectByStatus('marketListings', 'escrow_pending');
  const toCheck = active.concat(
    escrowPending.filter((r) => isStuck(statusEnteredAt(r, 'escrow_pending')))
  );

  let checked = 0;
  for (const row of toCheck) {
    if (!row.mintAddress) {
      issue('critical', 'token_dispute', 'Listing missing mintAddress', {
        id: row.id,
        name: row.name || null,
        status: row.status,
      });
      continue;
    }
    checked += 1;
    const custody = await expectedCustodyHolds(row);
    if (custody.held) continue;

    const actualOwner = await largestTokenOwner(row.mintAddress);
    const sellerStillHolds =
      row.sellerPubkey && actualOwner && actualOwner === row.sellerPubkey;

    issue('critical', 'token_dispute', 'NFT not in expected escrow/marketplace custody', {
      id: row.id,
      name: row.name || null,
      status: row.status,
      settlement: row.settlement || null,
      mintAddress: row.mintAddress,
      listingPda: row.listingPda || null,
      actualOwner: actualOwner || 'unknown',
      sellerStillHolds: !!sellerStillHolds,
      expectedOwners: custody.checked,
    });
  }
  return { checked, active: active.length };
}

async function printReport(summary) {
  const critical = findings.filter((f) => f.severity === 'critical');
  const warnings = findings.filter((f) => f.severity === 'warning');

  console.log('=== growtoo chain health ===');
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        stuckMinutes: STUCK_MINUTES,
        custodyOwners: CUSTODY_OWNERS,
        summary,
        critical: critical.length,
        warnings: warnings.length,
      },
      null,
      2
    )
  );

  for (const f of critical) {
    console.error(
      `✘ [${f.kind}] ${f.message} · ${shortId(f.meta.id)} ${f.meta.name || ''}`.trim()
    );
    console.error('  ', JSON.stringify(f.meta));
  }
  for (const f of warnings) {
    console.warn(
      `⚠ [${f.kind}] ${f.message} · ${shortId(f.meta.id)} ${f.meta.name || ''}`.trim()
    );
    console.warn('  ', JSON.stringify(f.meta));
  }

  if (!critical.length && !warnings.length) {
    console.log('✔ No mint / escrow / custody issues above thresholds.');
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const fs = await import('node:fs');
    const lines = [
      '## Chain health check',
      '',
      `- Stuck threshold: **${STUCK_MINUTES} min**`,
      `- Critical: **${critical.length}**`,
      `- Warnings: **${warnings.length}**`,
      '',
      '```json',
      JSON.stringify({ summary, critical, warnings }, null, 2),
      '```',
      '',
    ];
    fs.appendFileSync(summaryPath, lines.join('\n'));
  }

  return critical.length;
}

async function main() {
  console.log('Custody owners:', CUSTODY_OWNERS.join(', ') || '(none)');
  console.log(`Stuck threshold: ${STUCK_MINUTES} minutes`);

  const seed = await checkMintQueue('seedMints', 'Seed mint');
  const growth = await checkMintQueue('growthMints', 'Growth mint');
  const market = await checkMarketPending();
  const custody = await checkCustodyDisputes();

  const platformPending = await collectByStatus('platformRewards', 'pending');
  for (const row of platformPending) {
    const entered = statusEnteredAt(row, 'pending');
    if (isStuck(entered)) {
      issue('warning', 'platform_reward_stuck', 'Platform reward pending too long', {
        id: row.id,
        uid: row.uid || null,
        ageMinutes: ageMinutes(entered),
      });
    }
  }

  const criticalCount = await printReport({
    seedMints: seed,
    growthMints: growth,
    market,
    custody,
    platformRewardsPending: platformPending.length,
  });

  if (criticalCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('health-check failed:', err);
  process.exit(2);
});
