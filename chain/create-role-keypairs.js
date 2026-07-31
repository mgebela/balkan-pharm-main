/*
 * Create role-split Devnet keypairs:
 *   - mint authority  → already at keys/devnet-authority.json (not overwritten)
 *   - escrow vault    → keys/devnet-escrow.json (listed NFTs)
 *   - care escrow     → keys/devnet-care-escrow.json (locked adopt-stake $GROWTOO)
 *   - fee payer       → keys/devnet-fee-payer.json
 *
 * Then syncs public addresses into deployed.devnet.json + app/js/chain-config.js.
 */
import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import {
  KEYS_DIR,
  AUTHORITY_KEY_PATH,
  ESCROW_KEY_PATH,
  CARE_ESCROW_KEY_PATH,
  FEE_PAYER_KEY_PATH,
  LEGACY_ESCROW_ADDRESS,
  loadAuthoritySecret,
  writeDeployed,
  solscanAddress,
} from './common.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ensureKey(filePath, label) {
  if (fs.existsSync(filePath)) {
    const kp = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    );
    console.log(`${label} already exists:`, kp.publicKey.toBase58());
    return kp;
  }
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  fs.chmodSync(filePath, 0o600);
  console.log(`Created ${label}:`, kp.publicKey.toBase58());
  console.log('  saved:', filePath);
  return kp;
}

if (!fs.existsSync(AUTHORITY_KEY_PATH)) {
  console.error('Mint authority missing. Run npm run create-keypair first.');
  process.exit(1);
}

const mint = Keypair.fromSecretKey(loadAuthoritySecret());
const escrow = ensureKey(ESCROW_KEY_PATH, 'escrow vault');
const careEscrow = ensureKey(CARE_ESCROW_KEY_PATH, 'care escrow');
const feePayer = ensureKey(FEE_PAYER_KEY_PATH, 'fee payer');

const mintAuthority = mint.publicKey.toBase58();
const escrowAddress = escrow.publicKey.toBase58();
const careEscrowAddress = careEscrow.publicKey.toBase58();
const feePayerAddress = feePayer.publicKey.toBase58();

const deployed = writeDeployed({
  mintAuthority,
  authority: mintAuthority,
  escrowAddress,
  careEscrowAddress,
  feePayerAddress,
  legacyEscrowAddress: LEGACY_ESCROW_ADDRESS,
});

console.log('\nRole split');
console.log('  mint authority:', mintAuthority, solscanAddress(mintAuthority));
console.log('  escrow vault:  ', escrowAddress, solscanAddress(escrowAddress));
console.log('  care escrow:   ', careEscrowAddress, solscanAddress(careEscrowAddress));
console.log('  fee payer:     ', feePayerAddress, solscanAddress(feePayerAddress));

// Sync app chain-config.js
const configPath = path.join(__dirname, '../app/js/chain-config.js');
let src = fs.readFileSync(configPath, 'utf8');
src = src.replace(/mintAuthority: '[^']*'/, `mintAuthority: '${mintAuthority}'`);
src = src.replace(/escrowAddress: '[^']*'/, `escrowAddress: '${escrowAddress}'`);
src = src.replace(/careEscrowAddress: '[^']*'/, `careEscrowAddress: '${careEscrowAddress}'`);
src = src.replace(/feePayerAddress: '[^']*'/, `feePayerAddress: '${feePayerAddress}'`);
src = src.replace(
  /legacyEscrowAddress: '[^']*'/,
  `legacyEscrowAddress: '${LEGACY_ESCROW_ADDRESS}'`
);
fs.writeFileSync(configPath, src);
console.log('\nUpdated app/js/chain-config.js');
console.log('Updated deployed.devnet.json at', deployed.updatedAt);
console.log('\nNext:');
console.log('  1. Add GitHub secret SOLANA_CARE_ESCROW_KEY_JSON from keys/devnet-care-escrow.json');
console.log('  2. Existing sold stakes keep listing.careEscrowAddress (shared vault) until harvest');
console.log('  3. New adopt_stake listings pay the dedicated care escrow');
