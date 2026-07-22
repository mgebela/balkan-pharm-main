/*
 * Shared helpers for Devnet deploy / queue scripts.
 * Keys live in chain/keys/ (gitignored) — never commit them.
 *
 * Roles:
 *   mint / authority — $GROWTOO + seed collection authority (process mint/grow)
 *   escrow           — holds listed NFTs (app sends here; market releases from here)
 *   feePayer         — pays SOL fees for market settlement txs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC_URL, rpcEndpoints } from './rpc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { RPC_URL, rpcEndpoints };
export const KEYS_DIR = path.join(__dirname, 'keys');
export const AUTHORITY_KEY_PATH = path.join(KEYS_DIR, 'devnet-authority.json');
export const MINT_KEY_PATH = AUTHORITY_KEY_PATH;
export const ESCROW_KEY_PATH = path.join(KEYS_DIR, 'devnet-escrow.json');
export const FEE_PAYER_KEY_PATH = path.join(KEYS_DIR, 'devnet-fee-payer.json');
export const DEPLOYED_PATH = path.join(__dirname, 'deployed.devnet.json');

/** Legacy single-wallet escrow (pre role-split). Still checked for open listings. */
export const LEGACY_ESCROW_ADDRESS = 'F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3';

if (!process.env.SOLANA_RPC_URL) {
  console.warn(
    'SOLANA_RPC_URL unset — using public Devnet failover list. Set a Helius/QuickNode URL to avoid 429s.'
  );
}

function readSecretFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} keypair not found at ${filePath}.`);
  }
  return Uint8Array.from(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function loadAuthoritySecret() {
  if (!fs.existsSync(AUTHORITY_KEY_PATH)) {
    throw new Error(
      'Mint authority keypair not found. Run "npm run create-keypair" first (chain/keys/devnet-authority.json).'
    );
  }
  return readSecretFile(AUTHORITY_KEY_PATH, 'Mint authority');
}

/** Alias — mint queue / collection / $GROWTOO authority. */
export function loadMintSecret() {
  return loadAuthoritySecret();
}

/**
 * Escrow vault secret. Falls back to mint authority if role key missing
 * (pre-split installs keep working).
 */
export function loadEscrowSecret() {
  if (fs.existsSync(ESCROW_KEY_PATH)) {
    return readSecretFile(ESCROW_KEY_PATH, 'Escrow');
  }
  console.warn(
    'devnet-escrow.json missing — using mint authority as escrow (run npm run create-role-keypairs to split).'
  );
  return loadAuthoritySecret();
}

/**
 * Market fee-payer secret. Falls back to mint authority if role key missing.
 */
export function loadFeePayerSecret() {
  if (fs.existsSync(FEE_PAYER_KEY_PATH)) {
    return readSecretFile(FEE_PAYER_KEY_PATH, 'Fee payer');
  }
  console.warn(
    'devnet-fee-payer.json missing — using mint authority as fee payer (run npm run create-role-keypairs to split).'
  );
  return loadAuthoritySecret();
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

/** Pubkeys for app config / ops (from key files + deployed). */
export function resolveRoleAddresses() {
  const deployed = readDeployed();
  const { Keypair } = requireKeypair();
  const mint = Keypair.fromSecretKey(loadMintSecret()).publicKey.toBase58();
  const escrow = Keypair.fromSecretKey(loadEscrowSecret()).publicKey.toBase58();
  const feePayer = Keypair.fromSecretKey(loadFeePayerSecret()).publicKey.toBase58();
  return {
    mintAuthority: deployed.mintAuthority || deployed.authority || mint,
    escrowAddress: deployed.escrowAddress || escrow,
    feePayerAddress: deployed.feePayerAddress || feePayer,
    legacyEscrowAddress: deployed.legacyEscrowAddress || LEGACY_ESCROW_ADDRESS,
  };
}

function requireKeypair() {
  // Lazy require so common.js stays usable in pure ESM without circular weight.
  return import('@solana/web3.js');
}
