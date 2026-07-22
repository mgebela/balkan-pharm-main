/*
 * Run the full devnet deploy pipeline (M1 + M2 deliverable):
 *   1. $GROWTOO SPL mint
 *   2. Seed NFT collection
 *   3. 12 test seed mints
 * Skips steps already recorded in deployed.devnet.json / mints.devnet.json.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(__dirname, script)], {
      stdio: 'inherit',
      cwd: __dirname,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

console.log('=== dnevnik.live devnet deploy ===\n');
await run('deploy-grow-token.js');
await run('deploy-seed-collection.js');
await run('mint-test-seeds.js');
console.log('\n=== Deploy pipeline complete ===');
console.log('Next: node sync-chain-config.js');
