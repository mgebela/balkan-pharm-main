/*
 * M2 deliverable: batch-mint the test seeds from test-seeds.json on devnet.
 * Results (mint address, metadata URI, tx) are appended to mints.devnet.json.
 * Already-minted seeds (matched by name) are skipped, so the script is
 * safe to re-run after a partial failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMintClient, mintSeedNft } from './mint-seed-lib.js';
import { solscanAddress } from './common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_PATH = path.join(__dirname, 'test-seeds.json');
const MINTS_PATH = path.join(__dirname, 'mints.devnet.json');

const seeds = JSON.parse(fs.readFileSync(SEEDS_PATH, 'utf8'));
const minted = fs.existsSync(MINTS_PATH) ? JSON.parse(fs.readFileSync(MINTS_PATH, 'utf8')) : [];
const mintedNames = new Set(minted.map((m) => m.name));

const umi = createMintClient();
console.log('Authority:', umi.identity.publicKey);
console.log(`Minting ${seeds.length} test seeds (${mintedNames.size} already done)…\n`);

let ok = 0;
let failed = 0;

for (const seed of seeds) {
  if (mintedNames.has(seed.name)) {
    console.log(`- ${seed.name}: already minted, skipping`);
    continue;
  }
  try {
    const result = await mintSeedNft(umi, seed);
    minted.push({ ...seed, ...result, mintedAt: new Date().toISOString() });
    fs.writeFileSync(MINTS_PATH, JSON.stringify(minted, null, 2) + '\n');
    ok += 1;
    console.log(`✔ ${seed.name}: ${result.mint}`);
    console.log(`  metadata: ${result.metadataUri}`);
  } catch (err) {
    failed += 1;
    console.error(`✘ ${seed.name}: ${err.message}`);
  }
}

console.log(`\nDone. ${ok} minted, ${failed} failed, ${minted.length} total recorded in mints.devnet.json`);
if (minted.length) {
  console.log('First mint on Solscan:', solscanAddress(minted[0].mint));
}
