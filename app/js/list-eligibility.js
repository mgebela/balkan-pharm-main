/**
 * Market list eligibility — keep in sync with functions/list-eligibility.js
 *
 * Seed mint is not gated. Listing (and escrow activation) requires:
 *   1. A linked journal plant
 *   2. At least MIN_ELAPSED_DAYS since the first server-ish createdAt
 *      (plant.createdAt or a watering/feeding createdAt — never startDate / entry.date)
 *   3. Distinct UTC care days (watering or feeding, counted by createdAt) covering
 *      at least COVERAGE_RATIO of min(elapsedDays, EXPECTED_CYCLE_DAYS)
 *
 * Backdated journal `date` fields do not count. Dumping 90 logs in one session
 * is one care day.
 */
(function (root) {
  'use strict';

  var STORAGE_PLANTS = 'dnevnik-live-plants';
  var STORAGE_ENTRIES = 'dnevnik-live-entries';
  var STORAGE_TOOLBOX = 'dnevnik-live-toolbox';

  var LIST_ELIGIBILITY = {
    minElapsedDays: 14,
    coverageRatio: 0.5,
    expectedCycleDays: 180,
  };

  var CARE_ENTRY_TYPES = { zalijevanje: 1, gnojidba: 1 };

  function parseMs(value) {
    if (!value) return 0;
    var t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }

  function utcDayStart(ms) {
    var d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function dayKeyUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function readJson(key, fallback) {
    try {
      var raw = root.localStorage && root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function readLocalState() {
    var plants = readJson(STORAGE_PLANTS, []);
    var entries = readJson(STORAGE_ENTRIES, []);
    var toolbox = readJson(STORAGE_TOOLBOX, {});
    return {
      plants: Array.isArray(plants) ? plants : [],
      entries: Array.isArray(entries) ? entries : [],
      toolbox: toolbox && typeof toolbox === 'object' ? toolbox : {},
    };
  }

  function findPlant(state, plantId) {
    var plants = Array.isArray(state && state.plants) ? state.plants : [];
    return plants.find(function (p) {
      return p && String(p.id) === String(plantId);
    }) || null;
  }

  function collectCareCreatedAtMs(state, plantId) {
    var out = [];
    var id = String(plantId || '');
    var entries = Array.isArray(state && state.entries) ? state.entries : [];
    entries.forEach(function (e) {
      if (!e || String(e.plantId) !== id) return;
      if (!CARE_ENTRY_TYPES[e.type]) return;
      var ms = parseMs(e.createdAt);
      if (ms) out.push(ms);
    });
    var toolbox = state && state.toolbox && typeof state.toolbox === 'object' ? state.toolbox : {};
    (toolbox.watering || []).forEach(function (row) {
      if (!row) return;
      if (String(row.value2 || row.plantId || '') !== id) return;
      var ms = parseMs(row.createdAt);
      if (ms) out.push(ms);
    });
    (toolbox.feeding || []).forEach(function (row) {
      if (!row) return;
      if (String(row.plantId || '') !== id) return;
      var ms = parseMs(row.createdAt);
      if (ms) out.push(ms);
    });
    return out;
  }

  function requiredCareDays(elapsedDays) {
    var windowDays = Math.min(
      Math.max(1, Number(elapsedDays) || 1),
      LIST_ELIGIBILITY.expectedCycleDays
    );
    return Math.max(1, Math.ceil(LIST_ELIGIBILITY.coverageRatio * windowDays));
  }

  /**
   * @param {object} state  { plants, entries, toolbox }
   * @param {string} plantId
   * @param {number} [nowMs]
   * @return {{ ok: boolean, code: string, error: string, elapsedDays: number,
   *   minElapsedDays: number, careDays: number, requiredCareDays: number,
   *   coverageRatio: number, firstLoggedAt: string|null, dayKeys: string[] }}
   */
  function evaluateListEligibility(state, plantId, nowMs) {
    var now = Number.isFinite(nowMs) ? nowMs : Date.now();
    var minElapsed = LIST_ELIGIBILITY.minElapsedDays;
    var ratio = LIST_ELIGIBILITY.coverageRatio;
    var empty = {
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

    if (!plantId) {
      return empty;
    }

    var plant = findPlant(state, plantId);
    if (!plant) {
      return Object.assign({}, empty, {
        error: 'Journal plant ' + plantId + ' not found — link the token to a plant first.',
      });
    }

    var careMs = collectCareCreatedAtMs(state, plantId);
    var firstMs = parseMs(plant.createdAt);
    careMs.forEach(function (ms) {
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

    var elapsedDays = Math.floor((utcDayStart(now) - utcDayStart(firstMs)) / 86400000) + 1;
    if (elapsedDays < 1) elapsedDays = 1;
    var need = requiredCareDays(elapsedDays);
    var daySet = {};
    careMs.forEach(function (ms) {
      daySet[dayKeyUtc(ms)] = true;
    });
    var dayKeys = Object.keys(daySet).sort();
    var careDays = dayKeys.length;
    var firstLoggedAt = new Date(firstMs).toISOString();

    var base = {
      elapsedDays: elapsedDays,
      minElapsedDays: minElapsed,
      careDays: careDays,
      requiredCareDays: need,
      coverageRatio: ratio,
      firstLoggedAt: firstLoggedAt,
      dayKeys: dayKeys,
    };

    if (elapsedDays < minElapsed) {
      var wait = minElapsed - elapsedDays;
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

    return Object.assign({}, base, {
      ok: true,
      code: 'ok',
      error: '',
    });
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

  var api = {
    LIST_ELIGIBILITY: LIST_ELIGIBILITY,
    STORAGE_PLANTS: STORAGE_PLANTS,
    evaluateListEligibility: evaluateListEligibility,
    readLocalState: readLocalState,
    requiredCareDays: requiredCareDays,
    snapshot: snapshot,
  };

  root.ListEligibility = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
