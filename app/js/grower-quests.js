/*
 * Grower quests — journal proof required before RWA growth mints.
 *
 * Tokenisation is tied to the growto.live grow journal: growers must log
 * stage changes, watering, and feeding before minting the next growth stage.
 * XP / level is a light gamification layer on top of that checklist.
 */
(function () {
  'use strict';

  const STORAGE_PLANTS = 'dnevnik-live-plants';
  const STORAGE_ENTRIES = 'dnevnik-live-entries';
  const STORAGE_TOOLBOX = 'dnevnik-live-toolbox';
  const STORAGE_XP = 'dnevnik-live-grower-xp';

  /** Token stage → minimum journal plant stage (Croatian keys). */
  const TOKEN_TO_PLANT_STAGE = {
    seed: null,
    germination: 'klijanje',
    seedling: 'sadnica',
    vegetative: 'vegetativna',
    flowering: 'cvjetanje',
    harvest: 'susenje',
  };

  const PLANT_STAGE_ORDER = ['klijanje', 'sadnica', 'vegetativna', 'cvjetanje', 'susenje'];

  const PLANT_STAGE_LABELS = {
    klijanje: 'Germination',
    sadnica: 'Seedling',
    vegetativna: 'Vegetative',
    cvjetanje: 'Flowering',
    susenje: 'Drying / harvest',
  };

  function plantStageLabel(stageKey) {
    if (!stageKey) return '';
    return PLANT_STAGE_LABELS[stageKey] || String(stageKey);
  }

  const QUEST_XP = {
    linkPlant: 25,
    stageLogged: 40,
    watering: 20,
    feeding: 20,
    story: 30,
    mintReady: 50,
  };

  const PLATFORM_REWARD_CAP = 50;
  const CARE_DAY_CAP = 20;
  const FEEDING_DAY_CAP = 8;
  const STORY_CAP = 2;
  const WEEK_CAP = 4;
  const NEW_PLANT_CAP = 5;
  const SEED_MINT_CAP = 3;
  const PLATFORM_RATES = {
    careDay: 1,
    feedingDay: 1,
    story: 5,
    qualifyingWeek: 3,
    newPlant: 2,
    seedMint: 5,
    flowerBonus: 10,
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function getPlants() {
    const list = readJson(STORAGE_PLANTS, []);
    return Array.isArray(list) ? list : [];
  }

  function getEntries() {
    const list = readJson(STORAGE_ENTRIES, []);
    return Array.isArray(list) ? list : [];
  }

  function getToolbox() {
    const box = readJson(STORAGE_TOOLBOX, {});
    return box && typeof box === 'object' ? box : {};
  }

  function plantStageIndex(stage) {
    const i = PLANT_STAGE_ORDER.indexOf(stage);
    return i < 0 ? -1 : i;
  }

  function plantMeetsTokenStage(plantStage, tokenStageKey) {
    const required = TOKEN_TO_PLANT_STAGE[tokenStageKey];
    if (!required) return true;
    return plantStageIndex(plantStage) >= plantStageIndex(required);
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

  function previousStageFloorMs(plant, targetTokenStage) {
    const required = TOKEN_TO_PLANT_STAGE[targetTokenStage];
    if (!required || !plant) return 0;
    const reqIdx = plantStageIndex(required);
    // Prefer date when plant reached the previous journal stage.
    const prevKey = reqIdx > 0 ? PLANT_STAGE_ORDER[reqIdx - 1] : null;
    if (prevKey && plant.stageDates && plant.stageDates[prevKey]) {
      const t = Date.parse(plant.stageDates[prevKey]);
      if (!Number.isNaN(t)) return t;
    }
    if (plant.startDate) {
      const t = Date.parse(plant.startDate);
      if (!Number.isNaN(t)) return t;
    }
    return 0;
  }

  function plantEntries(plantId) {
    return getEntries().filter((e) => e && e.plantId === plantId);
  }

  function hasStageLog(plant, entries, targetTokenStage) {
    const required = TOKEN_TO_PLANT_STAGE[targetTokenStage];
    if (!required) return { ok: true, ids: [] };
    const ids = [];
    if (plant.stage === required || plantStageIndex(plant.stage) >= plantStageIndex(required)) {
      // Stage field alone is weak proof; prefer faza entry / stageHistory.
    }
    if (Array.isArray(plant.stageHistory)) {
      const hit = plant.stageHistory.some((h) => h && h.to === required);
      if (hit) ids.push('stageHistory:' + required);
    }
    if (plant.stageDates && plant.stageDates[required]) {
      ids.push('stageDates:' + required);
    }
    entries.forEach((e) => {
      if (e.type === 'faza' && e.meta && e.meta.faza && e.meta.faza.to === required) {
        ids.push(e.id || 'faza');
      }
    });
    const ok =
      ids.length > 0 ||
      plantStageIndex(plant.stage) >= plantStageIndex(required);
    return { ok: ok, ids: ids };
  }

  function hasWatering(plantId, entries, toolbox, sinceMs) {
    const ids = [];
    entries.forEach((e) => {
      if (e.type === 'zalijevanje' && entryDateMs(e) >= sinceMs) {
        ids.push(e.id || 'zalijevanje');
      }
    });
    const watering = (toolbox && toolbox.watering) || [];
    watering.forEach((row) => {
      if (!row) return;
      const matchesPlant = String(row.value2 || row.plantId || '') === String(plantId);
      if (matchesPlant && toolboxDateMs(row) >= sinceMs) {
        ids.push(row.id || 'watering');
      }
    });
    return { ok: ids.length > 0, ids: ids };
  }

  function hasFeeding(plantId, entries, toolbox, sinceMs) {
    const ids = [];
    entries.forEach((e) => {
      if (e.type === 'gnojidba' && entryDateMs(e) >= sinceMs) {
        ids.push(e.id || 'gnojidba');
      }
    });
    const feeding = (toolbox && toolbox.feeding) || [];
    feeding.forEach((row) => {
      if (!row) return;
      const matchesPlant = String(row.plantId || '') === String(plantId);
      if (matchesPlant && toolboxDateMs(row) >= sinceMs) {
        ids.push(row.id || 'feeding');
      }
    });
    return { ok: ids.length > 0, ids: ids };
  }

  /**
   * Evaluate quests required to mint growth into `targetStageKey`.
   * @param {object} token  PlantToken token
   * @param {string} targetStageKey  e.g. 'germination'
   */
  function evaluateGrowthQuest(token, targetStageKey) {
    const items = [];
    const plantId = token && token.plantId ? String(token.plantId) : '';
    const plants = getPlants();
    const plant = plantId ? plants.find((p) => p && String(p.id) === plantId) : null;
    const entries = plantId ? plantEntries(plantId) : [];
    const toolbox = getToolbox();
    const sinceMs = plant ? previousStageFloorMs(plant, targetStageKey) : 0;

    const linkOk = !!plant;
    items.push({
      id: 'linkPlant',
      label: 'Link a journal plant',
      hint: 'Mint/link from Adopt with a plant from Plants & journal',
      ok: linkOk,
      xp: QUEST_XP.linkPlant,
      action: 'plants',
    });

    const stageCheck = plant
      ? hasStageLog(plant, entries, targetStageKey)
      : { ok: false, ids: [] };
    const requiredPlantStage = TOKEN_TO_PLANT_STAGE[targetStageKey];
    const requiredStageLabel = plantStageLabel(requiredPlantStage);
    items.push({
      id: 'stageLogged',
      label:
        'Log growth stage in journal' +
        (requiredStageLabel ? ' (' + requiredStageLabel + ')' : ''),
      hint: 'Update plant stage or add a Stage (transition) journal entry',
      ok: !!stageCheck.ok,
      xp: QUEST_XP.stageLogged,
      action: plantId ? 'growlog:' + plantId : 'plants',
      proofIds: stageCheck.ids,
    });

    const water = plant
      ? hasWatering(plantId, entries, toolbox, sinceMs)
      : { ok: false, ids: [] };
    items.push({
      id: 'watering',
      label: 'Log watering for this stage',
      hint: 'Add a Watering entry or Tools → Watering for this plant',
      ok: !!water.ok,
      xp: QUEST_XP.watering,
      action: plantId ? 'growlog:' + plantId : 'toolbox',
      proofIds: water.ids,
    });

    // Feeding optional for germination; required from seedling onward.
    const feedingRequired = targetStageKey !== 'germination';
    const feed = plant
      ? hasFeeding(plantId, entries, toolbox, sinceMs)
      : { ok: false, ids: [] };
    items.push({
      id: 'feeding',
      label: feedingRequired ? 'Log feeding / nutrients' : 'Log feeding (optional for germination)',
      hint: 'Add a Feeding entry or Tools → Feeding for this plant',
      ok: feedingRequired ? !!feed.ok : true,
      optional: !feedingRequired,
      xp: QUEST_XP.feeding,
      action: plantId ? 'growlog:' + plantId : 'toolbox',
      proofIds: feed.ids,
    });

    const required = items.filter((i) => !i.optional);
    const done = required.filter((i) => i.ok).length;
    const ready = required.every((i) => i.ok);
    const xpEarned = items.filter((i) => i.ok).reduce((s, i) => s + (i.xp || 0), 0);
    const missing = required.filter((i) => !i.ok).map((i) => i.label);

    return {
      ready: ready,
      targetStage: targetStageKey,
      plantId: plantId || null,
      plantName: plant ? plant.name : null,
      items: items,
      done: done,
      total: required.length,
      xpEarned: xpEarned,
      missing: missing,
      message: ready
        ? 'Journal proof complete — ready to mint.'
        : 'Complete grower quests first: ' + missing.join(', '),
    };
  }

  function evaluateSeedQuest(opts) {
    const plantId = opts && opts.plantId ? String(opts.plantId) : '';
    const plant = plantId ? getPlants().find((p) => p && String(p.id) === plantId) : null;
    const items = [
      {
        id: 'linkPlant',
        label: 'Choose a journal plant',
        hint: 'RWA seeds must be tied to a real plant in your journal',
        ok: !!plant,
        xp: QUEST_XP.linkPlant,
        action: 'plants',
      },
    ];
    const ready = items.every((i) => i.ok);
    return {
      ready: ready,
      plantId: plantId || null,
      plantName: plant ? plant.name : null,
      items: items,
      message: ready
        ? 'Plant linked — ready to mint seed.'
        : 'Link a journal plant before minting a seed RWA.',
    };
  }

  function buildProof(token, targetStageKey) {
    const quest = evaluateGrowthQuest(token, targetStageKey);
    return {
      plantId: quest.plantId,
      targetStage: targetStageKey,
      checkedAt: new Date().toISOString(),
      items: quest.items.map(function (i) {
        return {
          id: i.id,
          ok: !!i.ok,
          optional: !!i.optional,
          proofIds: i.proofIds || [],
        };
      }),
      ready: quest.ready,
    };
  }

  function readXp() {
    const raw = readJson(STORAGE_XP, { total: 0, events: [] });
    return {
      total: Number(raw.total || 0),
      events: Array.isArray(raw.events) ? raw.events : [],
    };
  }

  function levelFromXp(total) {
    const t = Number(total || 0);
    if (t >= 500) return { level: 5, title: 'Master grower' };
    if (t >= 300) return { level: 4, title: 'Seasoned grower' };
    if (t >= 150) return { level: 3, title: 'Dedicated grower' };
    if (t >= 60) return { level: 2, title: 'Active grower' };
    return { level: 1, title: 'New grower' };
  }

  function awardXp(reason, amount) {
    const state = readXp();
    const amt = Number(amount || 0);
    if (amt <= 0) return state;
    state.total += amt;
    state.events.unshift({
      reason: String(reason || 'quest'),
      amount: amt,
      at: new Date().toISOString(),
    });
    state.events = state.events.slice(0, 40);
    try {
      localStorage.setItem(STORAGE_XP, JSON.stringify(state));
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(
        new CustomEvent('growtoo:xp', { detail: { total: state.total, reason: reason, amount: amt } })
      );
    } catch {
      // ignore
    }
    return state;
  }

  /** One XP grant per reason+UTC day so logging 8 waterings today still pays once. */
  function awardXpOncePerDay(reason, amount) {
    const day = new Date().toISOString().slice(0, 10);
    const key = String(reason || 'quest') + ':' + day;
    const state = readXp();
    if (state.events.some(function (e) { return e && e.reason === key; })) {
      return { awarded: false, total: state.total, events: state.events, reason: key, amount: 0 };
    }
    const next = awardXp(key, amount);
    emitActivityReward(String(reason || 'quest'), Number(amount || 0), next);
    return {
      awarded: true,
      total: next.total,
      events: next.events,
      reason: key,
      amount: Number(amount || 0),
    };
  }

  function emitActivityReward(kind, xp, xpState) {
    let preview = null;
    try {
      const stories =
        window.GrowerBlog && typeof GrowerBlog.getPublishedThisMonth === 'function'
          ? Number(GrowerBlog.getPublishedThisMonth() || 0)
          : 0;
      preview = previewPlatformReward({ publishedStories: stories });
    } catch {
      preview = null;
    }
    let weekComplete = false;
    try {
      const wk = isoWeekKey(Date.now());
      const monday = weekKeyToUtcMonday(wk);
      if (monday) {
        const weekEnd = new Date(monday);
        weekEnd.setUTCDate(monday.getUTCDate() + 7);
        const slice = collectCareActivityLocal(monday.getTime(), weekEnd.getTime());
        weekComplete = slice.careDays === WEEKLY_CARE_MIN_DAYS;
      }
    } catch {
      weekComplete = false;
    }
    const detail = {
      kind: kind,
      xp: xp,
      totalXp: xpState && xpState.total,
      preview: preview,
      weekComplete: weekComplete,
    };
    try {
      window.dispatchEvent(new CustomEvent('growtoo:reward', { detail: detail }));
    } catch {
      // ignore
    }
    try {
      if (window.DnevnikNotifications && typeof DnevnikNotifications.notifyActivityReward === 'function') {
        DnevnikNotifications.notifyActivityReward(detail);
      }
    } catch {
      // ignore
    }
  }

  function getGrowerProfile() {
    const xp = readXp();
    const lvl = levelFromXp(xp.total);
    return {
      xp: xp.total,
      level: lvl.level,
      title: lvl.title,
      events: xp.events,
    };
  }

  const WEEKLY_CARE_MIN_DAYS = 5;
  const MONTHLY_CARE_MIN_DAYS = 12;

  function isoWeekKey(input) {
    const date = input instanceof Date ? input : new Date(input || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
  }

  function monthKey(input) {
    const date = input instanceof Date ? input : new Date(input || Date.now());
    if (Number.isNaN(date.getTime())) return null;
    return (
      date.getUTCFullYear() +
      '-' +
      String(date.getUTCMonth() + 1).padStart(2, '0')
    );
  }

  function weekKeyToUtcMonday(weekKey) {
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

  function monthKeyToUtcBounds(key) {
    const m = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return { start: start, end: end, startMs: start.getTime(), endMs: end.getTime() };
  }

  function enumerateWeekKeys(fromMs, toMs) {
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

  function enumerateMonthKeys(fromMs, toMs) {
    const start = monthKey(fromMs);
    const end = monthKey(toMs);
    if (!start || !end) return [];
    const keys = [];
    const startBounds = monthKeyToUtcBounds(start);
    const endBounds = monthKeyToUtcBounds(end);
    if (!startBounds || !endBounds) return [];
    let cursor = startBounds.start;
    while (cursor.getTime() <= endBounds.start.getTime()) {
      keys.push(monthKey(cursor));
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    return keys.length ? keys : [start];
  }

  function dayKeyUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function collectCareDayKeysInRange(plantId, startMs, endMs) {
    const days = {};
    plantEntries(plantId).forEach(function (e) {
      const ms = entryDateMs(e);
      if (ms >= startMs && ms < endMs) days[dayKeyUtc(ms)] = true;
    });
    const toolbox = getToolbox();
    (toolbox.watering || []).forEach(function (row) {
      if (!row) return;
      if (String(row.value2 || row.plantId || '') !== String(plantId)) return;
      const ms = toolboxDateMs(row);
      if (ms >= startMs && ms < endMs) days[dayKeyUtc(ms)] = true;
    });
    (toolbox.feeding || []).forEach(function (row) {
      if (!row) return;
      if (String(row.plantId || '') !== String(plantId)) return;
      const ms = toolboxDateMs(row);
      if (ms >= startMs && ms < endMs) days[dayKeyUtc(ms)] = true;
    });
    return Object.keys(days).sort();
  }

  function collectCareDayKeys(plantId, weekKey) {
    const monday = weekKeyToUtcMonday(weekKey);
    if (!monday) return [];
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 7);
    return collectCareDayKeysInRange(plantId, monday.getTime(), sunday.getTime());
  }

  function validateWeeklyCareProof(plantId, weekKey, minDays) {
    const need = minDays == null ? WEEKLY_CARE_MIN_DAYS : minDays;
    const dayKeys = collectCareDayKeys(plantId, weekKey || isoWeekKey(Date.now()));
    const daysHit = dayKeys.length;
    const ok = !!plantId && daysHit >= need;
    return {
      ok: ok,
      daysHit: daysHit,
      dayKeys: dayKeys,
      minDays: need,
      weekKey: weekKey || isoWeekKey(Date.now()),
      message: ok
        ? 'Strong week — ' + daysHit + '/' + need + ' care days (grower progress).'
        : 'Weekly progress: ' + daysHit + '/' + need + ' care days (grower only).',
    };
  }

  function validateMonthlyCareProof(plantId, mKey, minDays) {
    const need = minDays == null ? MONTHLY_CARE_MIN_DAYS : minDays;
    const key = mKey || monthKey(Date.now());
    const bounds = monthKeyToUtcBounds(key);
    const dayKeys = bounds
      ? collectCareDayKeysInRange(plantId, bounds.startMs, bounds.endMs)
      : [];
    const daysHit = dayKeys.length;
    const ok = !!plantId && !!bounds && daysHit >= need;
    return {
      ok: ok,
      daysHit: daysHit,
      dayKeys: dayKeys,
      minDays: need,
      monthKey: key,
      message: ok
        ? 'Month qualifies for harvest unlock (' + daysHit + '/' + need + ' days).'
        : 'Log care on ' + need + ' distinct days this month (' + daysHit + '/' + need + ').',
    };
  }

  function validateHarvestCarePath(plantId, adoptedAt, claimAt) {
    const fromMs = Date.parse(adoptedAt);
    const toMs = claimAt ? Date.parse(claimAt) || Date.now() : Date.now();
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
    const results = monthKeys.map(function (mk) {
      return validateMonthlyCareProof(plantId, mk);
    });
    const failed = results.filter(function (r) {
      return !r.ok;
    });
    const qualifyingMonthKeys = results
      .filter(function (r) {
        return r.ok;
      })
      .map(function (r) {
        return r.monthKey;
      });
    return {
      ok: failed.length === 0 && monthKeys.length > 0,
      monthKeys: monthKeys,
      weekKeys: monthKeys,
      results: results,
      qualifyingMonthKeys: qualifyingMonthKeys,
      qualifyingWeekKeys: qualifyingMonthKeys,
      errors: failed.map(function (r) {
        return r.message;
      }),
    };
  }

  function currentWeekCareProgress(plantId) {
    return validateWeeklyCareProof(plantId, isoWeekKey(Date.now()));
  }

  function currentMonthCareProgress(plantId) {
    return validateMonthlyCareProof(plantId, monthKey(Date.now()));
  }

  function computePlantRank(opts) {
    const o = opts || {};
    const score =
      Number(o.stageIndex || 0) * 18 +
      Number(o.qualifyingMonths || 0) * 25 +
      Math.min(40, Math.floor(Number(o.careDaysTotal || 0) / 3));
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
    return { tier: tier, title: title, score: score, label: 'Care level ' + tier + ' · ' + title };
  }

  function computeGrowerRank(opts) {
    const o = opts || {};
    const score =
      Math.floor(Number(o.xp || 0) / 8) +
      Number(o.qualifyingMonths || 0) * 20 +
      Number(o.seedsMinted || 0) * 10 +
      Number(o.growthMints || 0) * 8;
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
    return { tier: tier, title: title, score: score, label: 'Grower rank ' + tier + ' · ' + title };
  }

  function plantRankForToken(token, listing) {
    const plantId = token && token.plantId ? token.plantId : null;
    let qualifyingMonths = 0;
    let careDaysTotal = 0;
    if (listing && Array.isArray(listing.qualifyingMonthKeys)) {
      qualifyingMonths = listing.qualifyingMonthKeys.length;
    } else if (plantId && listing && listing.adoptedAt) {
      const path = validateHarvestCarePath(plantId, listing.adoptedAt);
      qualifyingMonths = (path.qualifyingMonthKeys || []).length;
      (path.results || []).forEach(function (r) {
        careDaysTotal += Number(r.daysHit || 0);
      });
    } else if (plantId) {
      const month = currentMonthCareProgress(plantId);
      careDaysTotal = month.daysHit || 0;
      if (month.ok) qualifyingMonths = 1;
    }
    return computePlantRank({
      stageIndex: token ? token.stageIndex || 0 : 0,
      qualifyingMonths: qualifyingMonths,
      careDaysTotal: careDaysTotal,
    });
  }

  function growerRankFromLocal() {
    const profile = getGrowerProfile();
    const plants = getPlants();
    let qualifyingMonths = 0;
    plants.forEach(function (p) {
      if (!p || !p.id) return;
      if (currentMonthCareProgress(p.id).ok) qualifyingMonths += 1;
    });
    const wallet =
      window.PlantToken && typeof PlantToken.getWallet === 'function'
        ? PlantToken.getWallet()
        : null;
    const tokens = (wallet && wallet.tokens) || [];
    const seedsMinted = tokens.filter(function (t) {
      return t && t.mintAddress && !t.adopted;
    }).length;
    const growthMints = tokens.reduce(function (n, t) {
      return n + (t && t.stageIndex ? Number(t.stageIndex) : 0);
    }, 0);
    return computeGrowerRank({
      xp: profile.xp,
      qualifyingMonths: qualifyingMonths,
      seedsMinted: seedsMinted,
      growthMints: growthMints,
    });
  }

  function collectCareActivityLocal(startMs, endMs) {
    const waterDays = {};
    const feedDays = {};
    getEntries().forEach(function (e) {
      if (!e || !e.plantId) return;
      const ms = entryDateMs(e);
      if (ms < startMs || ms >= endMs) return;
      const day = dayKeyUtc(ms);
      if (e.type === 'zalijevanje') waterDays[day] = true;
      if (e.type === 'gnojidba') feedDays[day] = true;
    });
    const toolbox = getToolbox();
    (toolbox.watering || []).forEach(function (row) {
      if (!row) return;
      const ms = toolboxDateMs(row);
      if (ms < startMs || ms >= endMs) return;
      waterDays[dayKeyUtc(ms)] = true;
    });
    (toolbox.feeding || []).forEach(function (row) {
      if (!row) return;
      const ms = toolboxDateMs(row);
      if (ms < startMs || ms >= endMs) return;
      feedDays[dayKeyUtc(ms)] = true;
    });
    const careDays = Object.assign({}, waterDays, feedDays);
    return {
      careDays: Object.keys(careDays).length,
      wateringDays: Object.keys(waterDays).length,
      feedingDays: Object.keys(feedDays).length,
    };
  }

  function countNewPlantsLocal(startMs, endMs) {
    return getPlants().filter(function (p) {
      if (!p) return false;
      const raw = p.createdAt || p.startDate || p.updatedAt;
      const t = raw ? Date.parse(raw) : NaN;
      return Number.isFinite(t) && t >= startMs && t < endMs;
    }).length;
  }

  function countQualifyingWeeksLocal(startMs, endMs) {
    const weekKeys = enumerateWeekKeys(startMs, endMs - 1);
    let count = 0;
    weekKeys.forEach(function (wk) {
      const monday = weekKeyToUtcMonday(wk);
      if (!monday) return;
      const weekEnd = new Date(monday);
      weekEnd.setUTCDate(monday.getUTCDate() + 7);
      if (weekEnd.getTime() <= startMs || monday.getTime() >= endMs) return;
      const slice = collectCareActivityLocal(monday.getTime(), weekEnd.getTime());
      if (slice.careDays >= 5) count += 1;
    });
    return count;
  }

  function scorePlatformReward(parts) {
    const careDays = Math.min(CARE_DAY_CAP, Math.max(0, Number(parts.careDays || 0)));
    const feedingDays = Math.min(FEEDING_DAY_CAP, Math.max(0, Number(parts.feedingDays || 0)));
    const stories = Math.min(STORY_CAP, Math.max(0, Number(parts.publishedStories || 0)));
    const weeks = Math.min(WEEK_CAP, Math.max(0, Number(parts.qualifyingWeeks || 0)));
    const plants = Math.min(NEW_PLANT_CAP, Math.max(0, Number(parts.newPlants || 0)));
    const seeds = Math.min(SEED_MINT_CAP, Math.max(0, Number(parts.seedMints || 0)));
    const flower = parts.flowerBonus ? PLATFORM_RATES.flowerBonus : 0;
    const raw =
      PLATFORM_RATES.careDay * careDays +
      PLATFORM_RATES.feedingDay * feedingDays +
      PLATFORM_RATES.story * stories +
      PLATFORM_RATES.qualifyingWeek * weeks +
      PLATFORM_RATES.newPlant * plants +
      PLATFORM_RATES.seedMint * seeds +
      flower;
    return Math.min(PLATFORM_REWARD_CAP, Math.max(0, raw));
  }

  /**
   * Client preview of this month's $GROWTOO (same formula as the worker).
   * Pass publishedStories from GrowerBlog when known.
   */
  function previewPlatformReward(opts) {
    const o = opts || {};
    const key = o.monthKey || monthKey(Date.now());
    const bounds = monthKeyToUtcBounds(key);
    if (!bounds) {
      return { monthKey: key, reward: 0, cap: PLATFORM_REWARD_CAP, activity: {}, lines: [] };
    }
    const care = collectCareActivityLocal(bounds.startMs, bounds.endMs);
    const activity = {
      monthKey: key,
      careDays: care.careDays,
      wateringDays: care.wateringDays,
      feedingDays: care.feedingDays,
      qualifyingWeeks: countQualifyingWeeksLocal(bounds.startMs, bounds.endMs),
      newPlants: countNewPlantsLocal(bounds.startMs, bounds.endMs),
      publishedStories: Math.max(0, Number(o.publishedStories || 0)),
      seedMints: Math.max(0, Number(o.seedMints || 0)),
      flowerBonus: !!o.flowerBonus,
    };
    const reward = scorePlatformReward(activity);
    return {
      monthKey: key,
      reward: reward,
      cap: PLATFORM_REWARD_CAP,
      activity: activity,
      loggedToday: (function () {
        const today = new Date().toISOString().slice(0, 10);
        const dayBounds = {
          start: Date.parse(today + 'T00:00:00.000Z'),
          end: Date.parse(today + 'T00:00:00.000Z') + 86400000,
        };
        return collectCareActivityLocal(dayBounds.start, dayBounds.end).careDays > 0;
      })(),
    };
  }

  /** Checklist HTML for Adopt token cards. */
  function checklistHtml(quest, escFn) {
    const esc = typeof escFn === 'function' ? escFn : function (s) { return String(s || ''); };
    if (!quest) return '';
    const rows = (quest.items || [])
      .map(function (item) {
        const mark = item.ok ? '✓' : item.optional ? '○' : '○';
        const cls =
          'grower-quest-item' +
          (item.ok ? ' grower-quest-item--ok' : '') +
          (item.optional ? ' grower-quest-item--optional' : '');
        return (
          '<li class="' +
          cls +
          '">' +
          '<span class="grower-quest-mark" aria-hidden="true">' +
          mark +
          '</span>' +
          '<span class="grower-quest-label">' +
          esc(item.label) +
          '</span>' +
          '</li>'
        );
      })
      .join('');
    const statusCls =
      (quest.ready ? 'grower-quest--ready' : 'grower-quest--blocked') +
      (quest.ready ? ' grower-quest--next' : '');
    return (
      '<div class="grower-quest ' +
      statusCls +
      '">' +
      '<div class="grower-quest-head">' +
      '<strong>' +
      (quest.ready ? 'Next action · Quests ready' : 'Grower quests') +
      '</strong>' +
      '<span>' +
      quest.done +
      '/' +
      quest.total +
      '</span>' +
      '</div>' +
      '<ul class="grower-quest-list">' +
      rows +
      '</ul>' +
      '<p class="grower-quest-msg">' +
      esc(quest.message) +
      '</p>' +
      '</div>'
    );
  }

  window.GrowerQuests = {
    TOKEN_TO_PLANT_STAGE: TOKEN_TO_PLANT_STAGE,
    QUEST_XP: QUEST_XP,
    WEEKLY_CARE_MIN_DAYS: WEEKLY_CARE_MIN_DAYS,
    MONTHLY_CARE_MIN_DAYS: MONTHLY_CARE_MIN_DAYS,
    evaluateGrowthQuest: evaluateGrowthQuest,
    evaluateSeedQuest: evaluateSeedQuest,
    buildProof: buildProof,
    getGrowerProfile: getGrowerProfile,
    awardXp: awardXp,
    awardXpOncePerDay: awardXpOncePerDay,
    previewPlatformReward: previewPlatformReward,
    scorePlatformReward: scorePlatformReward,
    PLATFORM_REWARD_CAP: PLATFORM_REWARD_CAP,
    checklistHtml: checklistHtml,
    levelFromXp: levelFromXp,
    isoWeekKey: isoWeekKey,
    monthKey: monthKey,
    enumerateWeekKeys: enumerateWeekKeys,
    enumerateMonthKeys: enumerateMonthKeys,
    validateWeeklyCareProof: validateWeeklyCareProof,
    validateMonthlyCareProof: validateMonthlyCareProof,
    validateHarvestCarePath: validateHarvestCarePath,
    currentWeekCareProgress: currentWeekCareProgress,
    currentMonthCareProgress: currentMonthCareProgress,
    computePlantRank: computePlantRank,
    computeGrowerRank: computeGrowerRank,
    plantRankForToken: plantRankForToken,
    growerRankFromLocal: growerRankFromLocal,
  };
})();
