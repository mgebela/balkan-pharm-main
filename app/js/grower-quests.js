/*
 * Grower quests — journal proof required before RWA growth mints.
 *
 * Tokenisation is tied to the dnevnik.live grow journal: growers must log
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

  const QUEST_XP = {
    linkPlant: 25,
    stageLogged: 40,
    watering: 20,
    feeding: 20,
    mintReady: 50,
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
    items.push({
      id: 'stageLogged',
      label: 'Log growth stage in journal' + (requiredPlantStage ? ' (' + requiredPlantStage + ')' : ''),
      hint: 'Update plant stage or add a “faza” journal entry',
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
      hint: 'Add a zalijevanje entry or Tools → Watering for this plant',
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
      hint: 'Add a gnojidba entry or Tools → Feeding for this plant',
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
    return state;
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
    const statusCls = quest.ready ? 'grower-quest--ready' : 'grower-quest--blocked';
    return (
      '<div class="grower-quest ' +
      statusCls +
      '">' +
      '<div class="grower-quest-head">' +
      '<strong>Grower quests</strong>' +
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
    evaluateGrowthQuest: evaluateGrowthQuest,
    evaluateSeedQuest: evaluateSeedQuest,
    buildProof: buildProof,
    getGrowerProfile: getGrowerProfile,
    awardXp: awardXp,
    checklistHtml: checklistHtml,
    levelFromXp: levelFromXp,
  };
})();
