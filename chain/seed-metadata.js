/*
 * Seed RWA metadata (M2).
 *
 * Builds Metaplex-standard NFT metadata JSON for a dnevnik.live seed NFT.
 * Schema reference: token-metadata/seed-rwa.schema.json
 *
 * Each seed NFT is a real-world-asset (RWA) record for one physical seed /
 * plant: strain name, batch code and the linked dnevnik.live plant ID are
 * embedded both as Metaplex attributes (wallet-visible) and in a structured
 * `rwa` block (machine-readable).
 */

export const SEED_RWA_STANDARD = 'dnevnik.live/seed-rwa';
export const SEED_RWA_VERSION = '1.0.0';
export const SEED_SYMBOL = 'SEED';
export const SEED_IMAGE_URL = 'https://dnevnik.live/images/bp.png';
export const EXTERNAL_URL = 'https://dnevnik.live';

export function validateSeedInput(seed) {
  const errors = [];
  if (!seed || typeof seed !== 'object') {
    return ['Seed input must be an object.'];
  }
  if (!seed.name || !String(seed.name).trim()) errors.push('name is required');
  if (!seed.strain || !String(seed.strain).trim()) errors.push('strain is required');
  if (!seed.batch || !String(seed.batch).trim()) errors.push('batch is required');
  if (String(seed.name).length > 32) errors.push('name must be ≤ 32 chars (Metaplex limit)');
  return errors;
}

export function buildSeedMetadata(seed) {
  const errors = validateSeedInput(seed);
  if (errors.length) {
    throw new Error('Invalid seed input: ' + errors.join(', '));
  }

  const name = String(seed.name).trim();
  const strain = String(seed.strain).trim();
  const batch = String(seed.batch).trim();
  const plantId = seed.plantId ? String(seed.plantId).trim() : null;
  const importedAt = seed.importedAt || new Date().toISOString();

  const attributes = [
    { trait_type: 'Strain', value: strain },
    { trait_type: 'Batch', value: batch },
    { trait_type: 'Stage', value: 'Seed' },
    { trait_type: 'Network', value: 'Solana devnet' },
    { trait_type: 'Imported', value: importedAt.slice(0, 10) },
  ];
  if (plantId) {
    attributes.push({ trait_type: 'Plant ID', value: plantId });
  }

  return {
    name,
    symbol: SEED_SYMBOL,
    description:
      `dnevnik.live seed RWA — strain "${strain}", batch ${batch}. ` +
      'This NFT records a physical CBD seed adopted on dnevnik.live. ' +
      'Its growth from seed to harvest is documented in the public grow journal.',
    image: seed.image || SEED_IMAGE_URL,
    external_url: plantId ? `${EXTERNAL_URL}/?plant=${encodeURIComponent(plantId)}` : EXTERNAL_URL,
    attributes,
    properties: {
      category: 'image',
      files: [{ uri: seed.image || SEED_IMAGE_URL, type: 'image/png' }],
    },
    rwa: {
      standard: SEED_RWA_STANDARD,
      version: SEED_RWA_VERSION,
      assetType: 'seed',
      strain,
      batch,
      plantId,
      journalUrl: EXTERNAL_URL,
      cluster: 'devnet',
      importedAt,
    },
  };
}

/**
 * Metadata for an already-minted seed NFT that advanced to a new growth
 * stage (M3). Same schema as the seed metadata, with the Stage trait
 * updated and a growthHistory log in the `rwa` block.
 *
 * @param {object} seed    { name, strain, batch, plantId?, importedAt? }
 * @param {object} stage   { key, label, reward }
 * @param {Array}  history [{ stage, reward, ts, signature? }, …] oldest first
 */
export function buildStageMetadata(seed, stage, history) {
  const metadata = buildSeedMetadata(seed);
  const assetType = stage.key === 'flowering' || stage.key === 'harvest' ? 'flower' : 'seed';

  metadata.description =
    `dnevnik.live plant RWA — strain "${metadata.rwa.strain}", batch ${metadata.rwa.batch}, ` +
    `stage: ${stage.label}. Growth from seed to harvest is documented in the public grow journal.`;

  const stageAttr = metadata.attributes.find((a) => a.trait_type === 'Stage');
  if (stageAttr) stageAttr.value = stage.label;

  metadata.rwa.assetType = assetType;
  metadata.rwa.stage = stage.key;
  metadata.rwa.growthHistory = (history || []).map((h) => ({
    stage: h.stage,
    reward: Number(h.reward || 0),
    ts: h.ts || null,
    signature: h.signature || null,
  }));

  return metadata;
}
