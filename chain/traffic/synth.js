/**
 * Factories for traffic plants, entries, listings, and adopter tokens.
 * Synthetic mint ids use a TrafficMint_ prefix so chain workers skip real RPC.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  STAGE_LADDER,
  STRAINS,
  TRAFFIC_BATCH,
  HISTORY_DAYS,
  pickCareNote,
} from './personas.js';
import {
  enrichNoteForSkill,
  levelFromJournalXp,
  skillTitle,
  xpForLevel,
} from './journal-skill.js';

export function stableId(...parts) {
  return parts.map((p) => String(p).replace(/[^a-zA-Z0-9_-]/g, '_')).join('_');
}

export function trafficMintId(listingKey) {
  const hash = createHash('sha256').update(String(listingKey)).digest('hex').slice(0, 40);
  return `TrafficMint_${hash}`;
}

export function trafficPubkey(seed) {
  const hex = createHash('sha256').update(`pk:${seed}`).digest('hex');
  // Fake base58-ish display key — not a valid on-chain address; UI only.
  return `TrafficPk${hex.slice(0, 36)}`;
}

export function trafficPaySig(listingKey) {
  const hex = createHash('sha256').update(`pay:${listingKey}`).digest('hex');
  return `traffic-sim-pay-${hex}`;
}

export function ymdUTC(d) {
  return d.toISOString().slice(0, 10);
}

export function daysAgoUTC(n, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function dateRangeBack(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(ymdUTC(daysAgoUTC(i)));
  return out;
}

function pickStrain(i) {
  return STRAINS[i % STRAINS.length];
}

function pickStage(i) {
  // Bias toward mid/late stages for market interest
  const idx = Math.min(STAGE_LADDER.length - 1, 1 + (i % (STAGE_LADDER.length - 1)));
  return STAGE_LADDER[idx];
}

function priceForStage(stage, growerKey) {
  const base = 8 + stage.stageIndex * 7;
  const bump = growerKey === 'grower-l' ? 4 : growerKey === 'grower-m' ? 2 : 0;
  return base + bump + (stage.stageIndex % 3);
}

/**
 * Build cohort plant rows for a grower persona.
 */
export function buildPlants(grower) {
  const plants = [];
  const start = ymdUTC(daysAgoUTC(HISTORY_DAYS + 10));
  const label = grower.plantLabel || (grower.key === 'grower-l' ? 'Row' : 'Plant');
  const nicknames =
    grower.key === 'grower-s'
      ? ['Mila', 'Bruno', 'Sara', 'Leo', 'Nika']
      : null;
  for (let i = 0; i < grower.plantRows; i += 1) {
    const stage = pickStage(i);
    const id = stableId('traffic', 'plant', grower.key, String(i).padStart(4, '0'));
    const strain = pickStrain(i);
    const nick = nicknames ? nicknames[i % nicknames.length] : null;
    const name = nick
      ? `${nick} · ${strain}`
      : `${strain} · ${label} ${i + 1}`;
    const pool = Array.isArray(grower.plantPhotoPool) ? grower.plantPhotoPool : [];
    const photo = pool.length ? pool[i % pool.length] : null;
    plants.push({
      id,
      name,
      strain,
      count: grower.countPerRow,
      stage: stage.journal,
      subphase: null,
      startDate: start,
      environmentName: grower.environmentName,
      environmentType: grower.environmentType,
      fieldLocation:
        grower.environmentType === 'outdoor'
          ? `${grower.city || 'Field'} · ${grower.environmentName}`
          : null,
      plantingLocation: grower.environmentName,
      exposureHours: grower.environmentType === 'outdoor' ? 12 : 18,
      notes: grower.notes || '',
      photo: photo,
      updatedAt: new Date().toISOString(),
      views: 0,
      stageHistory: [{ from: null, to: stage.journal, date: start }],
      stageDates: { [stage.journal]: start },
      subphaseHistory: [],
      trafficCity: grower.city || null,
      trafficRegion: grower.region || null,
      trafficAgent: true,
      trafficBatch: TRAFFIC_BATCH,
    });
  }
  return plants;
}

/**
 * Care entries for listed plants over HISTORY_DAYS.
 * Note quality climbs with journal skill as days advance (skillset growth).
 */
export function buildEntries(plants, listedPlantIds, grower, historyDays = HISTORY_DAYS) {
  const listed = new Set(listedPlantIds);
  const dates = dateRangeBack(historyDays);
  const entries = [];
  const g = grower || {};
  const startSkill = Math.max(1, Math.min(5, Number(g.journalSkillStart) || 1));
  // End near start+2 (capped at 5) after full history — visible growth in the journal.
  const endSkill = Math.min(5, startSkill + 2);

  plants.forEach((plant, pi) => {
    if (!listed.has(plant.id)) return;
    dates.forEach((date, di) => {
      const type = di % 3 === 1 ? 'gnojidba' : 'zalijevanje';
      const id = stableId('traffic', 'entry', plant.id, date, type);
      const progress = dates.length <= 1 ? 1 : di / (dates.length - 1);
      const skillLevel = Math.max(
        startSkill,
        Math.min(endSkill, Math.round(startSkill + progress * (endSkill - startSkill)))
      );
      const base = pickCareNote(g, type, pi * 17 + di * 3);
      const note = enrichNoteForSkill(base, skillLevel, type, pi * 17 + di * 3);
      entries.push({
        id,
        plantId: plant.id,
        date,
        type,
        note,
        photo: null,
        video: null,
        meta: {
          city: g.city || null,
          region: g.region || null,
          growerKey: g.key || null,
          journalSkill: skillLevel,
          journalSkillTitle: skillTitle(skillLevel),
        },
        createdAt: `${date}T08:${String(10 + (di % 40)).padStart(2, '0')}:00.000Z`,
        source: 'traffic-agent',
        trafficAgent: true,
        trafficBatch: TRAFFIC_BATCH,
      });
    });
  });
  return entries;
}

/** Snapshot of current journaling skill for profile / coach. */
export function buildJournalSkillProfile(grower, dayIndexFromStart) {
  const startSkill = Math.max(1, Math.min(5, Number(grower.journalSkillStart) || 1));
  const endSkill = Math.min(5, startSkill + 2);
  const di = Math.max(0, Number(dayIndexFromStart) || 0);
  const progress = Math.min(1, di / Math.max(1, HISTORY_DAYS));
  const level = Math.max(
    startSkill,
    Math.min(endSkill, Math.round(startSkill + progress * (endSkill - startSkill)))
  );
  const xp = xpForLevel(level) + Math.round(progress * 40);
  return {
    level,
    title: skillTitle(level),
    xp,
    startedAtSkill: startSkill,
    city: grower.city || null,
    region: grower.region || null,
    personality: grower.personality || null,
  };
}

export function resolveSkillFromXp(xp) {
  const level = levelFromJournalXp(xp);
  return { level, title: skillTitle(level), xp: Number(xp) || 0 };
}

export function selectListedPlants(plants, listRatio) {
  const n = Math.max(1, Math.round(plants.length * listRatio));
  // Spread across the array so strains/stages vary
  const step = plants.length / n;
  const picked = [];
  for (let i = 0; i < n; i += 1) {
    picked.push(plants[Math.min(plants.length - 1, Math.floor(i * step))]);
  }
  // Unique
  const seen = new Set();
  return picked.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export function buildListingDoc({ grower, plant, index, sold, buyer }) {
  const stage =
    STAGE_LADDER.find((s) => s.journal === plant.stage) || STAGE_LADDER[2];
  const listingKey = stableId('traffic', 'listing', grower.key, String(index).padStart(4, '0'));
  const priceGrow = priceForStage(stage, grower.key);
  const lockedGrow = Math.floor(priceGrow / 2);
  const immediateGrow = priceGrow - lockedGrow;
  const mintAddress = trafficMintId(listingKey);
  const adoptedAt = sold
    ? `${ymdUTC(daysAgoUTC(Math.min(HISTORY_DAYS - 1, 5 + (index % 10))))}T12:00:00.000Z`
    : null;
  const monthKeys = sold ? enumerateMonths(adoptedAt, new Date().toISOString()) : [];
  const curKey = monthKey(new Date());
  const daysHit = sold ? Math.min(12, 4 + (index % 9)) : 0;

  const doc = {
    id: listingKey,
    uid: grower.uid,
    sellerPubkey: grower.sellerPubkey,
    mintAddress,
    mintRequestId: null,
    plantId: plant.id,
    name: plant.name,
    strain: plant.strain,
    batch: `${grower.key}-${String(index).padStart(3, '0')}`,
    stage: stage.label,
    assetType: stage.tokenKey === 'flowering' || stage.tokenKey === 'harvest' ? 'flower' : 'seed',
    offerType: 'adopt_stake',
    priceGrow,
    status: sold ? 'sold' : 'active',
    settlement: 'adopt_stake',
    cluster: 'devnet',
    createdAt: ymdUTC(daysAgoUTC(HISTORY_DAYS)) + 'T10:00:00.000Z',
    stakeLockedBps: 5000,
    immediateGrow,
    lockedGrow,
    totalGrow: priceGrow,
    careEscrowAddress: 'TrafficCareEscrowSim',
    careStatus: sold ? 'active' : 'listed',
    journalStage: plant.stage,
    liveStage: stage.label,
    liveStageKey: stage.tokenKey,
    harvestReady: stage.tokenKey === 'harvest',
    trafficAgent: true,
    trafficBatch: TRAFFIC_BATCH,
    sim: true,
    sellerDisplayName: grower.displayName || null,
    sellerCity: grower.city || null,
    sellerRegion: grower.region || null,
    photo: plant.photo || null,
  };

  if (sold && buyer) {
    Object.assign(doc, {
      buyerUid: buyer.uid,
      buyerPubkey: buyer.buyerPubkey,
      paymentSignature: trafficPaySig(listingKey),
      investedAt: adoptedAt,
      soldAt: adoptedAt,
      adoptedAt,
      careMonthKeys: monthKeys,
      qualifyingMonthKeys: monthKeys.slice(0, Math.max(0, monthKeys.length - 1)),
      currentMonthKey: curKey,
      currentMonthDaysHit: daysHit,
      currentMonthMinDays: 12,
      careProgressUpdatedAt: new Date().toISOString(),
    });
  }

  return doc;
}

function monthKey(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function enumerateMonths(fromIso, toIso) {
  const start = monthKey(fromIso);
  const end = monthKey(toIso);
  if (!start || !end) return [];
  const keys = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

export function buildAdopterToken(listing) {
  const stage =
    STAGE_LADDER.find((s) => s.label === listing.stage) ||
    STAGE_LADDER.find((s) => s.tokenKey === listing.liveStageKey) ||
    STAGE_LADDER[2];
  const now = Date.now();
  return {
    id: stableId('traffic', 'token', listing.id),
    name: listing.name,
    strain: listing.strain || '',
    batch: listing.batch || '',
    plantId: listing.plantId || null,
    mintAddress: listing.mintAddress,
    mintRequestId: null,
    listingId: listing.id,
    adopted: true,
    investedGrow: Number(listing.priceGrow || 0),
    investStatus: 'sold',
    paymentSignature: listing.paymentSignature || '',
    sellerPubkey: listing.sellerPubkey || '',
    stageIndex: stage.stageIndex,
    createdAt: now,
    history: [
      {
        ts: now,
        type: 'invest',
        stage: stage.tokenKey,
        amount: Number(listing.priceGrow || 0),
        tx: listing.paymentSignature || 'traffic-sim',
      },
    ],
    trafficAgent: true,
    trafficBatch: TRAFFIC_BATCH,
  };
}

export function buildTodayCareEntry(plant, dateYmd, grower) {
  const type = randomBytes(1)[0] % 3 === 1 ? 'gnojidba' : 'zalijevanje';
  const g = grower || {};
  const skillLevel = Math.max(
    1,
    Math.min(5, Number(g.journalSkill?.level || g.journalSkillLevel || g.journalSkillStart) || 2)
  );
  const salt = createHash('sha256').update(`${plant.id}:${dateYmd}:${type}`).digest();
  const base = pickCareNote(g, type, salt[0] + salt[1] * 16);
  return {
    id: stableId('traffic', 'entry', plant.id, dateYmd, type),
    plantId: plant.id,
    date: dateYmd,
    type,
    note: enrichNoteForSkill(base, skillLevel, type, salt[0] + salt[1] * 16),
    photo: null,
    video: null,
    meta: {
      city: g.city || null,
      region: g.region || null,
      growerKey: g.key || null,
      journalSkill: skillLevel,
      journalSkillTitle: skillTitle(skillLevel),
    },
    createdAt: new Date().toISOString(),
    source: 'traffic-agent-day',
    trafficAgent: true,
    trafficBatch: TRAFFIC_BATCH,
  };
}

export function trimEntries(entries, windowDays = 45) {
  const cutoff = ymdUTC(daysAgoUTC(windowDays));
  return (entries || []).filter((e) => e && e.date && String(e.date) >= cutoff);
}
