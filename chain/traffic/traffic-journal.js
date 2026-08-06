#!/usr/bin/env node
/**
 * Publish sample Stories for existing traffic growers (no full re-seed).
 *
 * Usage (from chain/): npm run traffic:journal
 */
import { initTraffic, commitBatches, readCredsFile } from './helpers.js';
import { GROWERS } from './personas.js';
import { buildJournalSeedWrites } from './journal-posts.js';

async function main() {
  const { db } = initTraffic();
  const creds = readCredsFile();
  if (!creds || !Array.isArray(creds.accounts)) {
    throw new Error('Missing chain/keys/traffic-agents.json — run traffic:seed first.');
  }

  const byKey = new Map(
    creds.accounts.filter((a) => a && a.role === 'grower').map((a) => [a.key, a])
  );

  const writes = [];
  for (const g of GROWERS) {
    const acc = byKey.get(g.key);
    if (!acc || !acc.uid) {
      console.warn(`… skip ${g.key}: no uid in creds`);
      continue;
    }
    const grower = { ...g, uid: acc.uid };
    const batch = buildJournalSeedWrites(db, grower);
    writes.push(...batch);
    console.log(`✔ ${g.key} (${acc.displayName || g.displayName}) · ${batch.length} writes · ${g.publicSlug}`);
  }

  if (!writes.length) throw new Error('No grower journal writes prepared.');
  await commitBatches(db, writes);
  console.log(`Done · ${writes.length} docs → publicJournalPosts + profiles`);
  console.log('Read at https://journal.growto.live/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
