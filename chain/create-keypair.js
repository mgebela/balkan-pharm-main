/*
 * Generate the devnet authority keypair (mint authority for $GROW + collection).
 * Saved to chain/keys/devnet-authority.json — gitignored, keep a backup.
 */
import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { KEYS_DIR, AUTHORITY_KEY_PATH, solscanAddress } from './common.js';

if (fs.existsSync(AUTHORITY_KEY_PATH)) {
  const existing = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(AUTHORITY_KEY_PATH, 'utf8')))
  );
  console.log('Authority keypair already exists — not overwriting.');
  console.log('Address:', existing.publicKey.toBase58());
  console.log('Solscan:', solscanAddress(existing.publicKey.toBase58()));
  process.exit(0);
}

fs.mkdirSync(KEYS_DIR, { recursive: true });
const keypair = Keypair.generate();
fs.writeFileSync(AUTHORITY_KEY_PATH, JSON.stringify(Array.from(keypair.secretKey)));
fs.chmodSync(AUTHORITY_KEY_PATH, 0o600);

console.log('New devnet authority keypair created.');
console.log('Address:', keypair.publicKey.toBase58());
console.log('Saved to:', AUTHORITY_KEY_PATH);
console.log('Solscan:', solscanAddress(keypair.publicKey.toBase58()));
console.log('\nNext: fund it with devnet SOL → npm run airdrop');
