/*
 * Growth stage table — single source of truth for the chain scripts.
 * Mirrors GROWTH_STAGES in app/js/plant-token.js; rewards are $GROW
 * (whole tokens, converted with growDecimals at mint time).
 */
export const GROWTH_STAGES = [
  { key: 'seed', label: 'Seed', reward: 0 },
  { key: 'germination', label: 'Germination', reward: 10 },
  { key: 'seedling', label: 'Seedling', reward: 20 },
  { key: 'vegetative', label: 'Vegetative', reward: 35 },
  { key: 'flowering', label: 'Flowering', reward: 60 },
  { key: 'harvest', label: 'Harvest', reward: 100 },
];

export function stageByKey(key) {
  return GROWTH_STAGES.find((s) => s.key === key) || null;
}

export function stageIndexByKey(key) {
  return GROWTH_STAGES.findIndex((s) => s.key === key);
}
