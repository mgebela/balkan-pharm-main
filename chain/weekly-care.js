/*
 * Care proof helpers for adopt-stake unlock + grower progress.
 *
 * Harvest unlock (eased): calendar MONTHS, not weeks.
 * Qualifying month: ≥12 distinct days with plant-linked journal entry
 * or toolbox watering/feeding.
 *
 * Weekly helpers remain for grower-only progress / platform UA scoring.
 */

const WEEKLY_MIN_DAYS = 5;
const MONTHLY_MIN_DAYS = 12;

export function isoWeekKey(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function monthKey(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Monday 00:00 UTC of an ISO week key. */
export function weekKeyToUtcMonday(weekKey) {
  const m = String(weekKey || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

export function monthKeyToUtcBounds(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end, startMs: start.getTime(), endMs: end.getTime() };
}

export function enumerateWeekKeys(fromMs, toMs) {
  const start = isoWeekKey(fromMs);
  const end = isoWeekKey(toMs);
  if (!start || !end) return [];
  const keys = [];
  let cursor = weekKeyToUtcMonday(start);
  const endMonday = weekKeyToUtcMonday(end);
  if (!cursor || !endMonday) return [];
  while (cursor.getTime() <= endMonday.getTime()) {
    keys.push(isoWeekKey(cursor));
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return keys.length ? keys : [start];
}

export function enumerateMonthKeys(fromMs, toMs) {
  const start = monthKey(fromMs);
  const end = monthKey(toMs);
  if (!start || !end) return [];
  const keys = [];
  let cursor = monthKeyToUtcBounds(start)?.start;
  const endBounds = monthKeyToUtcBounds(end);
  if (!cursor || !endBounds) return [];
  while (cursor.getTime() <= endBounds.start.getTime()) {
    keys.push(monthKey(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return keys.length ? keys : [start];
}

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

function collectCareDayKeysInRange(state, plantId, startMs, endMs) {
  const days = new Set();
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  entries.forEach((e) => {
    if (!e || String(e.plantId) !== String(plantId)) return;
    const ms = entryDateMs(e);
    if (ms >= startMs && ms < endMs) days.add(dayKeyUtc(ms));
  });

  const toolbox = state?.toolbox && typeof state.toolbox === 'object' ? state.toolbox : {};
  (toolbox.watering || []).forEach((row) => {
    if (!row) return;
    if (String(row.value2 || row.plantId || '') !== String(plantId)) return;
    const ms = toolboxDateMs(row);
    if (ms >= startMs && ms < endMs) days.add(dayKeyUtc(ms));
  });
  (toolbox.feeding || []).forEach((row) => {
    if (!row) return;
    if (String(row.plantId || '') !== String(plantId)) return;
    const ms = toolboxDateMs(row);
    if (ms >= startMs && ms < endMs) days.add(dayKeyUtc(ms));
  });

  return days;
}

function collectCareDayKeys(state, plantId, weekKey) {
  const monday = weekKeyToUtcMonday(weekKey);
  if (!monday) return new Set();
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 7);
  return collectCareDayKeysInRange(state, plantId, monday.getTime(), sunday.getTime());
}

/**
 * Grower-only weekly progress (not used for harvest unlock).
 */
export function validateWeeklyCareProof(state, plantId, weekKey, minDays = WEEKLY_MIN_DAYS) {
  const errors = [];
  if (!plantId) {
    return {
      ok: false,
      daysHit: 0,
      dayKeys: [],
      minDays,
      weekKey: String(weekKey || ''),
      errors: ['plantId is required'],
    };
  }
  if (!weekKey || !weekKeyToUtcMonday(weekKey)) {
    return {
      ok: false,
      daysHit: 0,
      dayKeys: [],
      minDays,
      weekKey: String(weekKey || ''),
      errors: ['Invalid ISO weekKey'],
    };
  }

  const plants = Array.isArray(state?.plants) ? state.plants : [];
  const plant = plants.find((p) => p && String(p.id) === String(plantId));
  if (!plant) errors.push(`Journal plant ${plantId} not found`);

  const dayKeys = Array.from(collectCareDayKeys(state, plantId, weekKey)).sort();
  const daysHit = dayKeys.length;
  if (daysHit < minDays) {
    errors.push(`Need ${minDays} distinct care days in ${weekKey}, found ${daysHit}`);
  }

  return {
    ok: errors.length === 0,
    daysHit,
    dayKeys,
    minDays,
    weekKey: String(weekKey),
    plantName: plant ? plant.name || null : null,
    errors,
  };
}

/**
 * Monthly care proof — authoritative for harvest unlock.
 */
export function validateMonthlyCareProof(state, plantId, mKey, minDays = MONTHLY_MIN_DAYS) {
  const errors = [];
  const bounds = monthKeyToUtcBounds(mKey);
  if (!plantId) {
    return {
      ok: false,
      daysHit: 0,
      dayKeys: [],
      minDays,
      monthKey: String(mKey || ''),
      errors: ['plantId is required'],
    };
  }
  if (!bounds) {
    return {
      ok: false,
      daysHit: 0,
      dayKeys: [],
      minDays,
      monthKey: String(mKey || ''),
      errors: ['Invalid monthKey (YYYY-MM)'],
    };
  }

  const plants = Array.isArray(state?.plants) ? state.plants : [];
  const plant = plants.find((p) => p && String(p.id) === String(plantId));
  if (!plant) errors.push(`Journal plant ${plantId} not found`);

  const dayKeys = Array.from(
    collectCareDayKeysInRange(state, plantId, bounds.startMs, bounds.endMs)
  ).sort();
  const daysHit = dayKeys.length;
  if (daysHit < minDays) {
    errors.push(`Need ${minDays} distinct care days in ${mKey}, found ${daysHit}`);
  }

  return {
    ok: errors.length === 0,
    daysHit,
    dayKeys,
    minDays,
    monthKey: String(mKey),
    plantName: plant ? plant.name || null : null,
    errors,
  };
}

/**
 * All-or-nothing harvest: every calendar month from adopt → claim must qualify.
 */
export function validateHarvestCarePath(state, plantId, adoptedAt, claimAt = Date.now()) {
  const fromMs = Date.parse(adoptedAt);
  const toMs = claimAt instanceof Date ? claimAt.getTime() : Date.parse(claimAt) || Date.now();
  if (!Number.isFinite(fromMs)) {
    return {
      ok: false,
      monthKeys: [],
      weekKeys: [],
      results: [],
      qualifyingMonthKeys: [],
      qualifyingWeekKeys: [],
      errors: ['Invalid adoptedAt'],
    };
  }
  const monthKeys = enumerateMonthKeys(fromMs, toMs);
  const results = monthKeys.map((mk) => validateMonthlyCareProof(state, plantId, mk));
  const failed = results.filter((r) => !r.ok);
  const qualifyingMonthKeys = results.filter((r) => r.ok).map((r) => r.monthKey);
  return {
    ok: failed.length === 0 && monthKeys.length > 0,
    monthKeys,
    weekKeys: monthKeys, // back-compat alias for older callers
    results,
    qualifyingMonthKeys,
    qualifyingWeekKeys: qualifyingMonthKeys,
    errors: failed.flatMap((r) => r.errors),
  };
}

/** Plant rank from stage + care months + care intensity. */
export function computePlantRank({ stageIndex = 0, qualifyingMonths = 0, careDaysTotal = 0 } = {}) {
  const score =
    Number(stageIndex || 0) * 18 +
    Number(qualifyingMonths || 0) * 25 +
    Math.min(40, Math.floor(Number(careDaysTotal || 0) / 3));
  let tier = 1;
  let title = 'Sprout';
  if (score >= 160) {
    tier = 5;
    title = 'Legendary';
  } else if (score >= 120) {
    tier = 4;
    title = 'Elite';
  } else if (score >= 80) {
    tier = 3;
    title = 'Proven';
  } else if (score >= 40) {
    tier = 2;
    title = 'Rising';
  }
  return { tier, title, score, label: `Plant rank ${tier} · ${title}` };
}

/** Grower rank from XP + care months + tokenised stages. */
export function computeGrowerRank({
  xp = 0,
  qualifyingMonths = 0,
  seedsMinted = 0,
  growthMints = 0,
} = {}) {
  const score =
    Math.floor(Number(xp || 0) / 8) +
    Number(qualifyingMonths || 0) * 20 +
    Number(seedsMinted || 0) * 10 +
    Number(growthMints || 0) * 8;
  let tier = 1;
  let title = 'New grower';
  if (score >= 200) {
    tier = 5;
    title = 'Elite cultivator';
  } else if (score >= 140) {
    tier = 4;
    title = 'Master grower';
  } else if (score >= 90) {
    tier = 3;
    title = 'Seasoned grower';
  } else if (score >= 45) {
    tier = 2;
    title = 'Active grower';
  }
  return { tier, title, score, label: `Grower rank ${tier} · ${title}` };
}

export const WEEKLY_CARE_MIN_DAYS = WEEKLY_MIN_DAYS;
export const MONTHLY_CARE_MIN_DAYS = MONTHLY_MIN_DAYS;
