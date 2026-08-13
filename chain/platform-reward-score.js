/*
 * Monthly platform $GROWTOO from journal activity.
 *
 * Growers claim once per calendar month (process-platform-rewards.js).
 * Score from synced app state + published stories — never from client XP.
 * Distinct UTC days, not log count, so flooding the journal does not pay more.
 *
 * Keep in sync with app/js/grower-quests.js (previewPlatformReward).
 */
import {
  monthKeyToUtcBounds,
  enumerateWeekKeys,
  weekKeyToUtcMonday,
} from './weekly-care.js';

export const PLATFORM_REWARD_CAP = 50;
export const CARE_DAY_CAP = 20;
export const FEEDING_DAY_CAP = 8;
export const STORY_CAP = 2;
export const WEEK_CAP = 4;
export const NEW_PLANT_CAP = 5;
export const SEED_MINT_CAP = 3;

export const RATES = {
  careDay: 1,
  feedingDay: 1,
  story: 5,
  qualifyingWeek: 3,
  newPlant: 2,
  seedMint: 5,
  flowerBonus: 10,
};

function entryDateMs(entry) {
  if (!entry) return 0;
  if (entry.date) {
    const t = Date.parse(entry.date);
    if (!Number.isNaN(t)) return t;
  }
  if (entry.createdAt) {
    const t = Date.parse(entry.createdAt);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function toolboxDateMs(row) {
  if (!row || !row.date) return 0;
  const t = Date.parse(row.date);
  return Number.isNaN(t) ? 0 : t;
}

function dayKeyUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function isWateringEntry(entry) {
  return entry && entry.type === 'zalijevanje';
}

function isFeedingEntry(entry) {
  return entry && entry.type === 'gnojidba';
}

/**
 * Union of watering/feeding days across all plants in [startMs, endMs).
 * One day with five plants still counts as one day.
 */
export function collectCareActivity(state, startMs, endMs) {
  const waterDays = new Set();
  const feedDays = new Set();
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  entries.forEach((e) => {
    if (!e || !e.plantId) return;
    const ms = entryDateMs(e);
    if (ms < startMs || ms >= endMs) return;
    const day = dayKeyUtc(ms);
    if (isWateringEntry(e)) waterDays.add(day);
    if (isFeedingEntry(e)) feedDays.add(day);
  });

  const toolbox = state?.toolbox && typeof state.toolbox === 'object' ? state.toolbox : {};
  (toolbox.watering || []).forEach((row) => {
    if (!row) return;
    const ms = toolboxDateMs(row);
    if (ms < startMs || ms >= endMs) return;
    waterDays.add(dayKeyUtc(ms));
  });
  (toolbox.feeding || []).forEach((row) => {
    if (!row) return;
    const ms = toolboxDateMs(row);
    if (ms < startMs || ms >= endMs) return;
    feedDays.add(dayKeyUtc(ms));
  });

  const careDays = new Set([...waterDays, ...feedDays]);
  return {
    careDays: careDays.size,
    wateringDays: waterDays.size,
    feedingDays: feedDays.size,
    careDayKeys: Array.from(careDays).sort(),
    wateringDayKeys: Array.from(waterDays).sort(),
    feedingDayKeys: Array.from(feedDays).sort(),
  };
}

function countQualifyingWeeks(state, startMs, endMs) {
  const weekKeys = enumerateWeekKeys(startMs, endMs - 1);
  let count = 0;
  const details = [];
  for (const wk of weekKeys) {
    const monday = weekKeyToUtcMonday(wk);
    if (!monday) continue;
    const weekEnd = new Date(monday);
    weekEnd.setUTCDate(monday.getUTCDate() + 7);
    if (weekEnd.getTime() <= startMs || monday.getTime() >= endMs) continue;
    const slice = collectCareActivity(state, monday.getTime(), weekEnd.getTime());
    if (slice.careDays >= 5) {
      count += 1;
      details.push({ weekKey: wk, daysHit: slice.careDays });
    }
  }
  return { count, details };
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

export function collectMonthlyActivity(state, monthKey, extras = {}) {
  const bounds = monthKeyToUtcBounds(monthKey);
  if (!bounds) {
    return {
      monthKey: String(monthKey || ''),
      careDays: 0,
      wateringDays: 0,
      feedingDays: 0,
      qualifyingWeeks: 0,
      newPlants: 0,
      publishedStories: 0,
      seedMints: 0,
      flowerBonus: false,
      weekDetails: [],
    };
  }
  const care = collectCareActivity(state, bounds.startMs, bounds.endMs);
  const weeks = countQualifyingWeeks(state, bounds.startMs, bounds.endMs);
  return {
    monthKey: String(monthKey),
    careDays: care.careDays,
    wateringDays: care.wateringDays,
    feedingDays: care.feedingDays,
    careDayKeys: care.careDayKeys,
    qualifyingWeeks: weeks.count,
    weekDetails: weeks.details.slice(0, 12),
    newPlants: countNewPlants(state, bounds.startMs, bounds.endMs),
    publishedStories: Math.max(0, Number(extras.publishedStories || 0)),
    seedMints: Math.max(0, Number(extras.seedMints || 0)),
    flowerBonus: !!extras.flowerBonus,
  };
}

export function scorePlatformReward(parts) {
  const careDays = Math.min(CARE_DAY_CAP, Math.max(0, Number(parts.careDays || 0)));
  const feedingDays = Math.min(FEEDING_DAY_CAP, Math.max(0, Number(parts.feedingDays || 0)));
  const stories = Math.min(STORY_CAP, Math.max(0, Number(parts.publishedStories || 0)));
  const weeks = Math.min(WEEK_CAP, Math.max(0, Number(parts.qualifyingWeeks || 0)));
  const plants = Math.min(NEW_PLANT_CAP, Math.max(0, Number(parts.newPlants || 0)));
  const seeds = Math.min(SEED_MINT_CAP, Math.max(0, Number(parts.seedMints || 0)));
  const flower = parts.flowerBonus ? RATES.flowerBonus : 0;
  const raw =
    RATES.careDay * careDays +
    RATES.feedingDay * feedingDays +
    RATES.story * stories +
    RATES.qualifyingWeek * weeks +
    RATES.newPlant * plants +
    RATES.seedMint * seeds +
    flower;
  return Math.min(PLATFORM_REWARD_CAP, Math.max(0, raw));
}

export function breakdownLines(parts) {
  const reward = scorePlatformReward(parts);
  return {
    reward,
    cap: PLATFORM_REWARD_CAP,
    lines: [
      {
        id: 'care',
        label: 'Care days (water or feed)',
        count: Number(parts.careDays || 0),
        capped: Math.min(CARE_DAY_CAP, Number(parts.careDays || 0)),
        max: CARE_DAY_CAP,
        points: RATES.careDay * Math.min(CARE_DAY_CAP, Number(parts.careDays || 0)),
      },
      {
        id: 'feed',
        label: 'Feeding days',
        count: Number(parts.feedingDays || 0),
        capped: Math.min(FEEDING_DAY_CAP, Number(parts.feedingDays || 0)),
        max: FEEDING_DAY_CAP,
        points: RATES.feedingDay * Math.min(FEEDING_DAY_CAP, Number(parts.feedingDays || 0)),
      },
      {
        id: 'story',
        label: 'Stories published',
        count: Number(parts.publishedStories || 0),
        capped: Math.min(STORY_CAP, Number(parts.publishedStories || 0)),
        max: STORY_CAP,
        points: RATES.story * Math.min(STORY_CAP, Number(parts.publishedStories || 0)),
      },
      {
        id: 'week',
        label: 'Weeks with 5+ care days',
        count: Number(parts.qualifyingWeeks || 0),
        capped: Math.min(WEEK_CAP, Number(parts.qualifyingWeeks || 0)),
        max: WEEK_CAP,
        points: RATES.qualifyingWeek * Math.min(WEEK_CAP, Number(parts.qualifyingWeeks || 0)),
      },
      {
        id: 'plant',
        label: 'New plants',
        count: Number(parts.newPlants || 0),
        capped: Math.min(NEW_PLANT_CAP, Number(parts.newPlants || 0)),
        max: NEW_PLANT_CAP,
        points: RATES.newPlant * Math.min(NEW_PLANT_CAP, Number(parts.newPlants || 0)),
      },
      {
        id: 'seed',
        label: 'Seed stages sealed',
        count: Number(parts.seedMints || 0),
        capped: Math.min(SEED_MINT_CAP, Number(parts.seedMints || 0)),
        max: SEED_MINT_CAP,
        points: RATES.seedMint * Math.min(SEED_MINT_CAP, Number(parts.seedMints || 0)),
      },
      {
        id: 'flower',
        label: 'Flower or harvest sealed',
        count: parts.flowerBonus ? 1 : 0,
        capped: parts.flowerBonus ? 1 : 0,
        max: 1,
        points: parts.flowerBonus ? RATES.flowerBonus : 0,
      },
    ],
  };
}
