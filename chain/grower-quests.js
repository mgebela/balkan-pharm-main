/*
 * Server-side journal proof validation for growth mints.
 * Mirrors app/js/grower-quests.js rules against users/{uid}/app/state.
 */
export const TOKEN_TO_PLANT_STAGE = {
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

function plantStageIndex(stage) {
  const i = PLANT_STAGE_ORDER.indexOf(stage);
  return i < 0 ? -1 : i;
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

/**
 * @param {object} state  { plants, entries, toolbox }
 * @param {string} plantId
 * @param {string} targetStage  token stage key
 * @returns {{ ok: boolean, errors: string[], summary: object }}
 */
export function validateJournalProof(state, plantId, targetStage) {
  const errors = [];
  const plants = Array.isArray(state?.plants) ? state.plants : [];
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  const toolbox = state?.toolbox && typeof state.toolbox === 'object' ? state.toolbox : {};

  if (!plantId) {
    return { ok: false, errors: ['plantId is required — link a journal plant'], summary: {} };
  }

  const plant = plants.find((p) => p && String(p.id) === String(plantId));
  if (!plant) {
    return {
      ok: false,
      errors: [`Journal plant ${plantId} not found in grower app state`],
      summary: {},
    };
  }

  const requiredPlantStage = TOKEN_TO_PLANT_STAGE[targetStage];
  if (requiredPlantStage) {
    const stageOk =
      plantStageIndex(plant.stage) >= plantStageIndex(requiredPlantStage) ||
      (plant.stageDates && plant.stageDates[requiredPlantStage]) ||
      (Array.isArray(plant.stageHistory) &&
        plant.stageHistory.some((h) => h && h.to === requiredPlantStage)) ||
      entries.some(
        (e) =>
          e &&
          e.plantId === plantId &&
          e.type === 'faza' &&
          e.meta?.faza?.to === requiredPlantStage
      );
    if (!stageOk) {
      errors.push(
        'Plant stage must reach "' +
          plantStageLabel(requiredPlantStage) +
          '" (or log a Stage transition entry) before minting ' +
          targetStage
      );
    }
  }

  const sinceMs = previousStageFloorMs(plant, targetStage);
  const plantEntries = entries.filter((e) => e && String(e.plantId) === String(plantId));

  const wateringIds = [];
  plantEntries.forEach((e) => {
    if (e.type === 'zalijevanje' && entryDateMs(e) >= sinceMs) wateringIds.push(e.id || 'zalijevanje');
  });
  (toolbox.watering || []).forEach((row) => {
    if (!row) return;
    const matches = String(row.value2 || row.plantId || '') === String(plantId);
    if (matches && toolboxDateMs(row) >= sinceMs) wateringIds.push(row.id || 'watering');
  });
  if (!wateringIds.length) {
    errors.push(
      'Missing watering log (Watering entry or Tools watering) for this stage window'
    );
  }

  const feedingRequired = targetStage !== 'germination';
  const feedingIds = [];
  plantEntries.forEach((e) => {
    if (e.type === 'gnojidba' && entryDateMs(e) >= sinceMs) feedingIds.push(e.id || 'gnojidba');
  });
  (toolbox.feeding || []).forEach((row) => {
    if (!row) return;
    if (String(row.plantId || '') === String(plantId) && toolboxDateMs(row) >= sinceMs) {
      feedingIds.push(row.id || 'feeding');
    }
  });
  if (feedingRequired && !feedingIds.length) {
    errors.push(
      'Missing feeding/nutrient log (Feeding entry or Tools feeding) for this stage window'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      plantId: String(plantId),
      plantName: plant.name || null,
      plantStage: plant.stage || null,
      targetStage,
      wateringCount: wateringIds.length,
      feedingCount: feedingIds.length,
    },
  };
}

export {
  validateWeeklyCareProof,
  validateMonthlyCareProof,
  validateHarvestCarePath,
  isoWeekKey,
  monthKey,
  enumerateWeekKeys,
  enumerateMonthKeys,
  computePlantRank,
  computeGrowerRank,
  WEEKLY_CARE_MIN_DAYS,
  MONTHLY_CARE_MIN_DAYS,
} from './weekly-care.js';
