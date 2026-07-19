/*
 * Copy deployed devnet addresses into app/js/chain-config.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeployed } from './common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../app/js/chain-config.js');
const deployed = readDeployed();

if (!deployed.growMint || !deployed.seedCollection) {
  console.error('Nothing to sync — run deploy-all.js first.');
  process.exit(1);
}

let src = fs.readFileSync(configPath, 'utf8');
src = src.replace(/growMint: '[^']*'/, `growMint: '${deployed.growMint}'`);
src = src.replace(/growDecimals: \d+/, `growDecimals: ${deployed.growDecimals || 9}`);
src = src.replace(/seedCollection: '[^']*'/, `seedCollection: '${deployed.seedCollection}'`);
if (deployed.authority) {
  src = src.replace(/escrowAddress: '[^']*'/, `escrowAddress: '${deployed.authority}'`);
}

fs.writeFileSync(configPath, src);
console.log('Updated app/js/chain-config.js');
console.log('  growMint:', deployed.growMint);
console.log('  seedCollection:', deployed.seedCollection);
