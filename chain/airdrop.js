/*
 * Request devnet SOL for the authority keypair (faucet, free).
 * Devnet faucet rate-limits aggressively; retries with backoff.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { RPC_URL, loadAuthoritySecret } from './common.js';

const connection = new Connection(RPC_URL, 'confirmed');
const authority = Keypair.fromSecretKey(loadAuthoritySecret());
const target = Number(process.env.AIRDROP_SOL || 2);

const balance = (await connection.getBalance(authority.publicKey)) / LAMPORTS_PER_SOL;
console.log('Authority:', authority.publicKey.toBase58());
console.log('Current balance:', balance, 'SOL');

if (balance >= target) {
  console.log(`Already funded (>= ${target} SOL).`);
  process.exit(0);
}

const need = target - balance;
console.log(`Requesting ${need} SOL from devnet faucet…`);

let lastErr = null;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    const sig = await connection.requestAirdrop(authority.publicKey, Math.ceil(need * LAMPORTS_PER_SOL));
    await connection.confirmTransaction(sig, 'confirmed');
    const after = (await connection.getBalance(authority.publicKey)) / LAMPORTS_PER_SOL;
    console.log('Airdrop confirmed. New balance:', after, 'SOL');
    process.exit(0);
  } catch (err) {
    lastErr = err;
    console.warn(`Attempt ${attempt} failed: ${err.message}`);
    await new Promise((r) => setTimeout(r, attempt * 4000));
  }
}

console.error('\nAirdrop failed after retries:', lastErr && lastErr.message);
console.error('Fallback: use https://faucet.solana.com with address', authority.publicKey.toBase58());
process.exit(1);
