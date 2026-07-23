/*
 * Deploy growtoo_escrow to Devnet, initialize marketplace, sync configs.
 *
 * Requires:
 *   - target/deploy/growtoo_escrow.so (anchor build --no-idl)
 *   - chain/keys/devnet-authority.json funded (~2+ SOL for program rent)
 *   - SOLANA_RPC_URL optional (defaults to public Devnet)
 *
 *   node chain/deploy-escrow-program.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  RPC_URL,
  AUTHORITY_KEY_PATH,
  DEPLOYED_PATH,
  loadAuthoritySecret,
  readDeployed,
  writeDeployed,
} from './common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROGRAM_ID = 'GspPo6doBKoYmD6aCFHgo2q3CEXmWEoZXPpXAJnkjdyb';
const SO_PATH = path.join(ROOT, 'target/deploy/growtoo_escrow.so');
const KEYPAIR_PATH = path.join(ROOT, 'target/deploy/growtoo_escrow-keypair.json');
const IDL_SRC = path.join(ROOT, 'idl/growtoo_escrow.json');
const INIT_DISC = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

function run(cmd, args, opts = {}) {
  console.log('>', cmd, args.join(' '));
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    ...opts,
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} failed with status ${res.status}`);
  }
}

function encodeU16Le(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

async function initializeMarketplace(connection, authority, growMint) {
  const programId = new PublicKey(PROGRAM_ID);
  const [marketplace] = PublicKey.findProgramAddressSync(
    [Buffer.from('marketplace')],
    programId
  );

  const existing = await connection.getAccountInfo(marketplace);
  if (existing) {
    console.log('Marketplace already initialized:', marketplace.toBase58());
    return marketplace.toBase58();
  }

  const data = Buffer.concat([INIT_DISC, encodeU16Le(0)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(growMint), isSigner: false, isWritable: false },
      { pubkey: marketplace, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [authority],
    { commitment: 'confirmed' }
  );
  console.log('Initialized marketplace', marketplace.toBase58(), 'sig', sig);
  return marketplace.toBase58();
}

function syncChainConfig(escrowProgramId, marketplacePda) {
  const configPath = path.join(ROOT, 'app/js/chain-config.js');
  let src = fs.readFileSync(configPath, 'utf8');
  if (/escrowProgramId:/.test(src)) {
    src = src.replace(/escrowProgramId: '[^']*'/, `escrowProgramId: '${escrowProgramId}'`);
  } else {
    src = src.replace(
      /legacyEscrowAddress: '[^']*'/,
      (m) => `${m},\n    escrowProgramId: '${escrowProgramId}'`
    );
  }
  if (/settlementMode:/.test(src)) {
    src = src.replace(/settlementMode: '[^']*'/, `settlementMode: 'program'`);
  } else {
    src = src.replace(
      /escrowProgramId: '[^']*'/,
      (m) => `${m},\n    settlementMode: 'program'`
    );
  }
  fs.writeFileSync(configPath, src);
  console.log('Synced app/js/chain-config.js');
  if (marketplacePda) {
    console.log('  marketplacePda:', marketplacePda);
  }
}

async function main() {
  if (!fs.existsSync(SO_PATH)) {
    throw new Error(`Missing ${SO_PATH}. Run: anchor build --no-idl`);
  }
  if (!fs.existsSync(KEYPAIR_PATH)) {
    throw new Error(`Missing program keypair ${KEYPAIR_PATH}`);
  }
  if (!fs.existsSync(AUTHORITY_KEY_PATH)) {
    throw new Error('Missing authority keypair. Run chain create-keypair first.');
  }

  const authority = Keypair.fromSecretKey(loadAuthoritySecret());
  const connection = new Connection(RPC_URL, 'confirmed');
  const bal = (await connection.getBalance(authority.publicKey)) / 1e9;
  console.log('Authority:', authority.publicKey.toBase58());
  console.log('Balance:', bal, 'SOL');
  console.log('RPC:', RPC_URL);

  const rentNeeded = 3.5;
  if (bal < rentNeeded) {
    throw new Error(
      `Need ~${rentNeeded}+ SOL to deploy upgradeable program (have ${bal}). Peak rent is ~2× binary size. Fund ${authority.publicKey.toBase58()} then re-run.`
    );
  }

  // Prefer solana CLI deploy with configured keypair
  run('solana', [
    'program',
    'deploy',
    SO_PATH,
    '--program-id',
    KEYPAIR_PATH,
    '--url',
    RPC_URL,
    '--keypair',
    AUTHORITY_KEY_PATH,
  ]);

  const deployed = readDeployed() || {};
  const growMint = deployed.growMint || '3nReF8GGLdbPc4bmrgWyproVwt9taHb1yGvL5Cekrcqp';
  const marketplacePda = await initializeMarketplace(connection, authority, growMint);

  writeDeployed({
    escrowProgramId: PROGRAM_ID,
    marketplacePda,
    settlementMode: 'program',
    escrowProgramDeployedAt: new Date().toISOString(),
  });

  if (fs.existsSync(IDL_SRC)) {
    const idlOut = path.join(__dirname, 'idl/growtoo_escrow.json');
    fs.mkdirSync(path.dirname(idlOut), { recursive: true });
    fs.copyFileSync(IDL_SRC, idlOut);
  }

  syncChainConfig(PROGRAM_ID, marketplacePda);
  console.log('Done. Program', PROGRAM_ID);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
