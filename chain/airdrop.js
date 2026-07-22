/*
 * Request Devnet SOL for a role wallet (faucet).
 *
 *   npm run airdrop                        # mint authority
 *   AIRDROP_ROLE=feePayer npm run airdrop  # market fee payer
 *   AIRDROP_ROLE=escrow npm run airdrop    # escrow vault (usually low SOL ok)
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  RPC_URL,
  loadMintSecret,
  loadEscrowSecret,
  loadFeePayerSecret,
} from './common.js';

const role = String(process.env.AIRDROP_ROLE || 'mint').toLowerCase();
const loaders = {
  mint: loadMintSecret,
  authority: loadMintSecret,
  escrow: loadEscrowSecret,
  feepayer: loadFeePayerSecret,
  'fee-payer': loadFeePayerSecret,
};

const load = loaders[role];
if (!load) {
  console.error('Unknown AIRDROP_ROLE. Use mint | escrow | feePayer');
  process.exit(1);
}

const connection = new Connection(
  // Faucets usually only work on the public Devnet endpoint, not private RPCs.
  process.env.SOLANA_AIRDROP_RPC || 'https://api.devnet.solana.com',
  'confirmed'
);
const wallet = Keypair.fromSecretKey(load());
const target = Number(process.env.AIRDROP_SOL || 1);
const perRequest = Math.min(1, target);

const balance = (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
console.log('Role:', role);
console.log('Address:', wallet.publicKey.toBase58());
console.log('Current balance:', balance, 'SOL');

if (balance >= target) {
  console.log(`Already funded (>= ${target} SOL).`);
  process.exit(0);
}

const need = Math.min(perRequest, target - balance);
console.log(`Requesting ${need} SOL from Devnet faucet…`);

let lastErr = null;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    const sig = await connection.requestAirdrop(
      wallet.publicKey,
      Math.floor(need * LAMPORTS_PER_SOL)
    );
    await connection.confirmTransaction(sig, 'confirmed');
    const after = (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
    console.log('Airdrop confirmed. New balance:', after, 'SOL');
    process.exit(0);
  } catch (err) {
    lastErr = err;
    console.warn(`Attempt ${attempt} failed: ${err.message}`);
    await new Promise((r) => setTimeout(r, attempt * 4000));
  }
}

console.error('\nAirdrop failed after retries:', lastErr && lastErr.message);
console.error('Fallback: use https://faucet.solana.com with address', wallet.publicKey.toBase58());
process.exit(1);
