/*
 * Shared helpers for devnet deploy scripts.
 * Keys live in chain/keys/ (gitignored) — never commit them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC_URL, rpcEndpoints } from './rpc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { RPC_URL, rpcEndpoints };
export const KEYS_DIR = path.join(__dirname, 'keys');
export const AUTHORITY_KEY_PATH = path.join(KEYS_DIR, 'devnet-authority.json');
export const DEPLOYED_PATH = path.join(__dirname, 'deployed.devnet.json');

if (!process.env.SOLANA_RPC_URL) {
  console.warn(
    'SOLANA_RPC_URL unset — using public Devnet failover list. Set a Helius/QuickNode URL to avoid 429s.'
  );
}

export function loadAuthoritySecret() {
  if (!fs.existsSync(AUTHORITY_KEY_PATH)) {
    throw new Error(
      'Authority keypair not found. Run "npm run create-keypair" first (chain/keys/devnet-authority.json).'
    );
  }
  return Uint8Array.from(JSON.parse(fs.readFileSync(AUTHORITY_KEY_PATH, 'utf8')));
}

export function readDeployed() {
  if (!fs.existsSync(DEPLOYED_PATH)) return {};
  return JSON.parse(fs.readFileSync(DEPLOYED_PATH, 'utf8'));
}

export function writeDeployed(patch) {
  const current = readDeployed();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(DEPLOYED_PATH, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function solscanAddress(address) {
  return `https://solscan.io/account/${address}?cluster=devnet`;
}
