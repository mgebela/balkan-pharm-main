/*
 * Copy deployed Devnet addresses into app/js/chain-config.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeployed, LEGACY_ESCROW_ADDRESS } from './common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../app/js/chain-config.js');
const deployed = readDeployed();

if (!deployed.growMint || !deployed.seedCollection) {
  console.error('Nothing to sync — run deploy-all.js first.');
  process.exit(1);
}

const mintAuthority = deployed.mintAuthority || deployed.authority || '';
const escrowAddress = deployed.escrowAddress || mintAuthority;
const feePayerAddress = deployed.feePayerAddress || mintAuthority;
const legacyEscrow = deployed.legacyEscrowAddress || LEGACY_ESCROW_ADDRESS;

let src = fs.readFileSync(configPath, 'utf8');
src = src.replace(/growMint: '[^']*'/, `growMint: '${deployed.growMint}'`);
src = src.replace(/growDecimals: \d+/, `growDecimals: ${deployed.growDecimals || 9}`);
src = src.replace(/seedCollection: '[^']*'/, `seedCollection: '${deployed.seedCollection}'`);

if (/mintAuthority:/.test(src)) {
  src = src.replace(/mintAuthority: '[^']*'/, `mintAuthority: '${mintAuthority}'`);
  src = src.replace(/escrowAddress: '[^']*'/, `escrowAddress: '${escrowAddress}'`);
  src = src.replace(/feePayerAddress: '[^']*'/, `feePayerAddress: '${feePayerAddress}'`);
  src = src.replace(/legacyEscrowAddress: '[^']*'/, `legacyEscrowAddress: '${legacyEscrow}'`);
} else if (mintAuthority) {
  src = src.replace(
    /escrowAddress: '[^']*'/,
    `mintAuthority: '${mintAuthority}',\n    escrowAddress: '${escrowAddress}',\n    feePayerAddress: '${feePayerAddress}',\n    legacyEscrowAddress: '${legacyEscrow}'`
  );
}

fs.writeFileSync(configPath, src);
console.log('Updated app/js/chain-config.js');
console.log('  growMint:', deployed.growMint);
console.log('  seedCollection:', deployed.seedCollection);
console.log('  mintAuthority:', mintAuthority);
console.log('  escrowAddress:', escrowAddress);
console.log('  feePayerAddress:', feePayerAddress);
