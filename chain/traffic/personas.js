/**
 * Traffic agent personas for grower + adopter UX load.
 * Batch tag must match wipe / seed filters.
 *
 * Growers (cool, honest English logs):
 *   S — Zagreb apartment micro-grow
 *   M — Zadar county tent
 *   L — Osijek / Slavonia field
 */

export const TRAFFIC_BATCH = 'ux-2026-08';
export const TRAFFIC_PASSWORD = 'TrafficUX-2026-Aug!';
/** History window for seed backfill (days). */
export const HISTORY_DAYS = 21;
/** Rolling entry retention for day script. */
export const ENTRY_WINDOW_DAYS = 45;

export const STRAINS = [
  'Gold Bloom',
  'The BUD',
  'Balkan Skunk',
  'Adriatic Haze',
  'Mountain Kush',
  'Coastal CBD',
  'Valley OG',
  'Sunrise Auto',
];

/** Journal stage keys (HR) → listing English labels. */
export const STAGE_LADDER = [
  { journal: 'klijanje', label: 'Germination', tokenKey: 'germination', stageIndex: 1 },
  { journal: 'sadnica', label: 'Seedling', tokenKey: 'seedling', stageIndex: 2 },
  { journal: 'vegetativna', label: 'Vegetative', tokenKey: 'vegetative', stageIndex: 3 },
  { journal: 'cvjetanje', label: 'Flowering', tokenKey: 'flowering', stageIndex: 4 },
  { journal: 'susenje', label: 'Harvest', tokenKey: 'harvest', stageIndex: 5 },
];

export const GROWERS = [
  {
    key: 'grower-s',
    email: 'traffic+grower-s@growto.live',
    displayName: 'Luka · Zagreb micro',
    firstName: 'Luka',
    city: 'Zagreb',
    region: 'City of Zagreb',
    country: 'Croatia',
    profileType: 'grower',
    declaredPlants: 5,
    declaredHectares: null,
    environmentName: 'Trešnjevka closet',
    environmentType: 'indoor',
    notes:
      'Luka, Zagreb — five plants in a treated closet. Quiet, careful, writes what he actually sees (including the boring days).',
    personality:
      'City micro-grower. Short honest notes. Admits when he overwatered or forgot a fan night. Never hypes the plants.',
    plantRows: 5,
    countPerRow: 1,
    listRatio: 0.4,
    plantLabel: 'Plant',
    logLocale: 'en',
    /** Starts green; climbs toward 4–5 over the 21-day history + traffic:day. */
    journalSkillStart: 1,
    publicSlug: 'luka-zagreb',
    publicBio: 'Zagreb closet grower. Short honest notes — including the boring days.',
    profilePhoto: 'https://growto.live/images/traffic/logos/luka-zagreb.svg',
    plantPhotoPool: [
      'https://growto.live/images/traffic/plants/plant-seedling.png',
      'https://growto.live/images/traffic/plants/plant-vegetative.png',
      'https://growto.live/images/traffic/plants/sativa-plant.jpg',
      'https://growto.live/images/traffic/plants/cannabis-close.jpg',
    ],
    waterNotes: [
      'Watered light — runoff clear. Zagreb flat is dry from the radiator again.',
      'Skipped a full soak; media still damp from yesterday. Being honest, I almost overdid it.',
      'Morning water. Leaf tips look happier than two days ago.',
      'Quick drink after work. One lower leaf yellowing — watching, not panicking.',
      'Watered. Smell in the closet is clean; no musty note tonight.',
      'Half ration only. Soil felt cool and wet — better under-water than swamp it.',
    ],
    feedNotes: [
      'Light feed at half strength. Not chasing big numbers indoors.',
      'Fed. Runoff EC a bit high — next water plain.',
      'Skipped bloom boost; veg still wants greens. Keeping it simple.',
      'Fed after water. No leaf burn. Good.',
      'Plain tea-strength feed. One plant lagging — same mix for all, no magic.',
    ],
  },
  {
    key: 'grower-m',
    email: 'traffic+grower-m@growto.live',
    displayName: 'Ivan · Zadar tent',
    firstName: 'Ivan',
    city: 'Zadar',
    region: 'Zadar County',
    country: 'Croatia',
    profileType: 'grower',
    declaredPlants: 600,
    declaredHectares: null,
    environmentName: 'Poličnik tent A',
    environmentType: 'indoor',
    notes:
      'Ivan, Zadar County — one big tent near Poličnik. Coastal humidity is the daily fight; logs stay straight.',
    personality:
      'Coastal tent grower. Chill Dalmatian tone, blunt about humidity, salt air, and power cuts. Cool under pressure.',
    plantRows: 200,
    countPerRow: 3,
    listRatio: 0.4,
    plantLabel: 'Cohort',
    logLocale: 'en',
    journalSkillStart: 2,
    publicSlug: 'ivan-zadar',
    publicBio: 'Zadar County tent. Coastal humidity is the daily fight; logs stay straight.',
    profilePhoto: 'https://growto.live/images/traffic/logos/ivan-zadar.svg',
    plantPhotoPool: [
      'https://growto.live/images/traffic/plants/plant-vegetative.png',
      'https://growto.live/images/traffic/plants/plant-flowering.png',
      'https://growto.live/images/traffic/plants/sativa-plant.jpg',
      'https://growto.live/images/traffic/plants/cannabis-close.jpg',
    ],
    waterNotes: [
      'Watered rows 1–4. Sea fog this morning — RH climbed, dialed exhaust up.',
      'Irrigation done. Media was drier than I expected after the night breeze.',
      'Water pass. Condensation on tent walls again; wiped and cracked intake.',
      'Honest log: delayed water by ~3h (ferry day). Plants fine, me less fine.',
      'Watered. No runoff drama. Canopy still tight mid-tent.',
      'Light water only — humidity already heavy from the Adriatic air.',
    ],
    feedNotes: [
      'Fed vegetative mix. Edge plants a tad pale — bumped N slightly next cycle.',
      'Feed done. Holding cal-mag steady; Zadar water is soft this week.',
      'Fed flowering lines. Smell is getting loud — carbon filter holding.',
      'Skipped PK spike. Stretch not done. Patience > hype.',
      'Fed. One cohort slower — same light map, just genetics being genetics.',
    ],
  },
  {
    key: 'grower-l',
    email: 'traffic+grower-l@growto.live',
    displayName: 'Marko · Osijek fields',
    firstName: 'Marko',
    city: 'Osijek',
    region: 'Osijek-Baranja',
    country: 'Croatia',
    profileType: 'grower',
    declaredPlants: 10000,
    declaredHectares: 5,
    environmentName: 'Baranja north blocks',
    environmentType: 'outdoor',
    notes:
      'Marko, Osijek / Baranja — ~5 ha outdoor. Weather and soil first; English field notes for adopters.',
    personality:
      'Slavonian field grower. Practical, dry humor, weather-honest. Writes like a farm daybook in English.',
    plantRows: 200,
    countPerRow: 50,
    listRatio: 0.4,
    plantLabel: 'Row',
    logLocale: 'en',
    journalSkillStart: 3,
    publicSlug: 'marko-osijek',
    publicBio: 'Osijek / Baranja field grower. Weather and soil first — farm daybook in English.',
    profilePhoto: 'https://growto.live/images/traffic/logos/marko-osijek.svg',
    plantPhotoPool: [
      'https://growto.live/images/traffic/plants/hemp-field.jpg',
      'https://growto.live/images/traffic/plants/sativa-plant.jpg',
      'https://growto.live/images/traffic/plants/cannabis-close.jpg',
      'https://growto.live/images/traffic/plants/plant-flowering.png',
      'https://growto.live/images/traffic/plants/plant-harvest.png',
    ],
    waterNotes: [
      'Irrigation north blocks. Pannonian sun was sharp; soil crust broken before water.',
      'Watered rows after wind dried the top layer. No standing water in low spots.',
      'Skipped full irrigation — overnight rain did the job. Logging it so we do not double soak.',
      'Drip lines checked. Two emitters clogged on row edge; cleared.',
      'Morning water. Dew was heavy; cut volume ~20%.',
      'Water pass before the forecast heat. Plants look steady, not soft.',
    ],
    feedNotes: [
      'Side-dress light N on vegetative blocks. Soil test still fine for K.',
      'Fed flowering blocks. Holding off extras until we see set.',
      'Foliar only on stressed edge after wind — main feed stays in soil.',
      'Honest note: delayed fertigation one day (tractor down). Catching up now.',
      'Feed done. Birds busy in the hedgerow — not a pest spike yet.',
    ],
  },
];

/**
 * 15 adopters: 5 casual (1), 5 active (4–8), 5 serious (15–25).
 * portfolioSize is how many sold listings each receives.
 */
export const ADOPTERS = [
  ...[1, 1, 1, 1, 1].map((n, i) => ({
    key: `adopter-c${i + 1}`,
    email: `traffic+adopter-c${i + 1}@growto.live`,
    displayName: `Traffic · Casual ${i + 1}`,
    profileType: 'adopter',
    adopterIntent: 'support_growers',
    tier: 'casual',
    portfolioSize: n,
  })),
  ...[4, 5, 6, 7, 8].map((n, i) => ({
    key: `adopter-a${i + 1}`,
    email: `traffic+adopter-a${i + 1}@growto.live`,
    displayName: `Traffic · Active ${i + 1}`,
    profileType: 'adopter',
    adopterIntent: 'collect_garden',
    tier: 'active',
    portfolioSize: n,
  })),
  ...[15, 18, 20, 22, 25].map((n, i) => ({
    key: `adopter-s${i + 1}`,
    email: `traffic+adopter-s${i + 1}@growto.live`,
    displayName: `Traffic · Serious ${i + 1}`,
    profileType: 'adopter',
    adopterIntent: 'earn_rewards',
    tier: 'serious',
    portfolioSize: n,
  })),
];

export function allPersonas() {
  return [...GROWERS, ...ADOPTERS];
}

export function pickCareNote(grower, type, salt) {
  const water = grower.waterNotes || ['Watered.'];
  const feed = grower.feedNotes || ['Fed.'];
  const pool = type === 'gnojidba' ? feed : water;
  const i = Math.abs(Number(salt) || 0) % pool.length;
  return pool[i];
}
