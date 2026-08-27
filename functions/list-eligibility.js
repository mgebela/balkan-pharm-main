/**
 * Market list eligibility — keep in sync with app/js/list-eligibility.js
 *
 * Seed mint is not gated. Listing requires a journal plant, MIN_ELAPSED_DAYS
 * since the first createdAt care log, and distinct UTC care days covering
 * COVERAGE_RATIO of min(elapsedDays, EXPECTED_CYCLE_DAYS). entry.date is ignored.
 */
'use strict';

const LIST_ELIGIBILITY = {
  minElapsedDays: 14,
  coverageRatio: 0.5,
  expectedCycleDays: 180,
};

const CARE_ENTRY_TYPES = {zalijevanje: 1, gnojidba: 1};

function parseMs(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function utcDayStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dayKeyUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function findPlant(state, plantId) {
  const plants = Array.isArray(state && state.plants) ? state.plants : [];
  return plants.find((p) => p && String(p.id) === String(plantId)) || null;
}

function collectCareCreatedAtMs(state, plantId) {
  const out = [];
  const id = String(plantId || '');
  const entries = Array.isArray(state && state.entries) ? state.entries : [];
  entries.forEach((e) => {
    if (!e || String(e.plantId) !== id) return;
    if (!CARE_ENTRY_TYPES[e.type]) return;
    const ms = parseMs(e.createdAt);
    if (ms) out.push(ms);
  });
  const toolbox = state && state.toolbox && typeof state.toolbox === 'object' ? state.toolbox : {};
  (toolbox.watering || []).forEach((row) => {
    if (!row) return;
    if (String(row.value2 || row.plantId || '') !== id) return;
    const ms = parseMs(row.createdAt);
    if (ms) out.push(ms);
  });
  (toolbox.feeding || []).forEach((row) => {
    if (!row) return;
    if (String(row.plantId || '') !== id) return;
    const ms = parseMs(row.createdAt);
    if (ms) out.push(ms);
  });
  return out;
}

function requiredCareDays(elapsedDays) {
  const windowDays = Math.min(
      Math.max(1, Number(elapsedDays) || 1),
      LIST_ELIGIBILITY.expectedCycleDays,
  );
  return Math.max(1, Math.ceil(LIST_ELIGIBILITY.coverageRatio * windowDays));
}

/**
 * @param {object} state
 * @param {string} plantId
 * @param {number=} nowMs
 * @return {object}
 */
function evaluateListEligibility(state, plantId, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const minElapsed = LIST_ELIGIBILITY.minElapsedDays;
  const ratio = LIST_ELIGIBILITY.coverageRatio;
  const empty = {
    ok: false,
    code: 'no_plant',
    error: 'Link a journal plant before listing on the market.',
    elapsedDays: 0,
    minElapsedDays: minElapsed,
    careDays: 0,
    requiredCareDays: requiredCareDays(minElapsed),
    coverageRatio: ratio,
    firstLoggedAt: null,
    dayKeys: [],
  };

  if (!plantId) return empty;

  const plant = findPlant(state, plantId);
  if (!plant) {
    return Object.assign({}, empty, {
      error: 'Journal plant ' + plantId + ' not found — link the token to a plant first.',
    });
  }

  const careMs = collectCareCreatedAtMs(state, plantId);
  let firstMs = parseMs(plant.createdAt);
  careMs.forEach((ms) => {
    if (!firstMs || ms < firstMs) firstMs = ms;
  });

  if (!firstMs || !careMs.length) {
    return Object.assign({}, empty, {
      code: 'no_logs',
      error:
        'Log watering or feeding on this plant over time before listing. Same-day token mint is not enough.',
      requiredCareDays: requiredCareDays(minElapsed),
    });
  }

  let elapsedDays = Math.floor((utcDayStart(now) - utcDayStart(firstMs)) / 86400000) + 1;
  if (elapsedDays < 1) elapsedDays = 1;
  const need = requiredCareDays(elapsedDays);
  const daySet = {};
  careMs.forEach((ms) => {
    daySet[dayKeyUtc(ms)] = true;
  });
  const dayKeys = Object.keys(daySet).sort();
  const careDays = dayKeys.length;
  const firstLoggedAt = new Date(firstMs).toISOString();
  const base = {
    elapsedDays,
    minElapsedDays: minElapsed,
    careDays,
    requiredCareDays: need,
    coverageRatio: ratio,
    firstLoggedAt,
    dayKeys,
  };

  if (elapsedDays < minElapsed) {
    const wait = minElapsed - elapsedDays;
    return Object.assign({}, base, {
      ok: false,
      code: 'too_soon',
      error:
        'Journal trail is too short to list. Need ' +
        minElapsed +
        ' days since the first care log, have ' +
        elapsedDays +
        ' (about ' +
        wait +
        ' more day' +
        (wait === 1 ? '' : 's') +
        ').',
    });
  }

  if (careDays < need) {
    return Object.assign({}, base, {
      ok: false,
      code: 'low_coverage',
      error:
        'Need care logs on at least half of the trail (' +
        need +
        ' of ' +
        Math.min(elapsedDays, LIST_ELIGIBILITY.expectedCycleDays) +
        ' days). This plant has ' +
        careDays +
        '.',
    });
  }

  return Object.assign({}, base, {ok: true, code: 'ok', error: ''});
}

function snapshot(result) {
  if (!result) return null;
  return {
    ok: !!result.ok,
    code: result.code || '',
    elapsedDays: result.elapsedDays || 0,
    minElapsedDays: result.minElapsedDays || LIST_ELIGIBILITY.minElapsedDays,
    careDays: result.careDays || 0,
    requiredCareDays: result.requiredCareDays || 0,
    coverageRatio: result.coverageRatio || LIST_ELIGIBILITY.coverageRatio,
    firstLoggedAt: result.firstLoggedAt || null,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  LIST_ELIGIBILITY,
  evaluateListEligibility,
  requiredCareDays,
  snapshot,
};
