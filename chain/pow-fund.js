/*
 * Claim Devnet SOL from the on-chain PoW faucet (difficulty 3 / 0.02 SOL).
 *   node chain/pow-fund.js
 */
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPC_URL, AUTHORITY_KEY_PATH } from './common.js';

const PROGRAM = new PublicKey('PoWSNH2hEZogtCg1Zgm51FnkmJperzYDgPK4fvs8taL');
const DIFFICULTY = 3;
const AMOUNT = 20_000_000n;
const TARGET_SOL = Number(process.env.POW_TARGET_SOL || 3.6);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connection = new Connection(RPC_URL, 'confirmed');
const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(AUTHORITY_KEY_PATH, 'utf8')))
);
const AIRDROP_DISC = crypto.createHash('sha256').update('global:airdrop').digest().subarray(0, 8);

const dBuf = Buffer.alloc(1);
dBuf.writeUInt8(DIFFICULTY);
const aBuf = Buffer.alloc(8);
aBuf.writeBigUInt64LE(AMOUNT);
const [spec] = PublicKey.findProgramAddressSync([Buffer.from('spec'), dBuf, aBuf], PROGRAM);
const [source] = PublicKey.findProgramAddressSync(
  [Buffer.from('source'), spec.toBuffer()],
  PROGRAM
);

function grindAAA() {
  for (;;) {
    const kp = Keypair.generate();
    if (kp.publicKey.toBase58().startsWith('AAA')) return kp;
  }
}

let bal = (await connection.getBalance(authority.publicKey)) / 1e9;
console.log('Authority', authority.publicKey.toBase58());
console.log('Start balance', bal, 'SOL — target', TARGET_SOL);
console.log('Faucet source', source.toBase58());

let claims = 0;
const t0 = Date.now();
while (bal < TARGET_SOL) {
  const signer = grindAAA();
  const [receipt] = PublicKey.findProgramAddressSync(
    [Buffer.from('receipt'), signer.publicKey.toBuffer(), Buffer.from([DIFFICULTY])],
    PROGRAM
  );
  const ix = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: false },
      { pubkey: receipt, isSigner: false, isWritable: true },
      { pubkey: spec, isSigner: false, isWritable: false },
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: AIRDROP_DISC,
  });
  try {
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ix),
      [authority, signer],
      { commitment: 'confirmed' }
    );
    claims += 1;
    bal = (await connection.getBalance(authority.publicKey)) / 1e9;
    console.log(
      `claim #${claims} bal=${bal.toFixed(4)} SOL (+${((Date.now() - t0) / 1000).toFixed(0)}s) ${sig.slice(0, 12)}…`
    );
  } catch (err) {
    console.warn('claim failed:', err.message || err);
  }
}

console.log(`DONE balance=${bal} claims=${claims} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
