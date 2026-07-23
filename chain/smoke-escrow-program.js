/*
 * Devnet smoke for growtoo_escrow program path (list → buy and list → cancel).
 *
 * Requires deployed + initialized program, and two funded wallets:
 *   SELLER_KEY / BUYER_KEY (json arrays) or defaults to authority as seller
 *   and a generated buyer that must hold $GROWTOO + an NFT.
 *
 * Minimal ops smoke (authority-driven after minting a test seed elsewhere):
 *   node chain/smoke-escrow-program.js --mode cancel --mint <NFT_MINT> --price 1
 *   node chain/smoke-escrow-program.js --mode buy --mint <NFT_MINT> --price 1 --buyer <buyer.json>
 */
import fs from 'node:fs';
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
  loadAuthoritySecret,
  readDeployed,
} from './common.js';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const LIST_DISC = Buffer.from([54, 174, 193, 67, 17, 41, 132, 38]);
const BUY_DISC = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const CANCEL_DISC = Buffer.from([232, 219, 223, 41, 219, 236, 220, 190]);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function loadKey(pathOrNull, fallbackSecret) {
  if (pathOrNull) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(pathOrNull, 'utf8'))));
  }
  return Keypair.fromSecretKey(fallbackSecret);
}

function ata(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  )[0];
}

function encodeU64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

async function main() {
  const deployed = readDeployed();
  const programId = new PublicKey(
    deployed.escrowProgramId || 'GspPo6doBKoYmD6aCFHgo2q3CEXmWEoZXPpXAJnkjdyb'
  );
  const growMint = new PublicKey(deployed.growMint);
  const mint = new PublicKey(arg('mint'));
  const price = Number(arg('price', '1'));
  const mode = arg('mode', 'cancel');

  const connection = new Connection(RPC_URL, 'confirmed');
  const seller = loadKey(arg('seller'), loadAuthoritySecret());
  const buyer = arg('buyer') ? loadKey(arg('buyer')) : null;

  const [marketplace] = PublicKey.findProgramAddressSync(
    [Buffer.from('marketplace')],
    programId
  );
  const [listing] = PublicKey.findProgramAddressSync(
    [Buffer.from('listing'), mint.toBuffer()],
    programId
  );
  const sellerNft = ata(seller.publicKey, mint);
  const nftVault = ata(listing, mint);

  console.log('Program', programId.toBase58());
  console.log('Seller', seller.publicKey.toBase58());
  console.log('Mint', mint.toBase58());
  console.log('Listing PDA', listing.toBase58());

  // list
  const listIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketplace, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: sellerNft, isSigner: false, isWritable: true },
      { pubkey: listing, isSigner: false, isWritable: true },
      { pubkey: nftVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([LIST_DISC, encodeU64(price)]),
  });
  const listSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(listIx),
    [seller],
    { commitment: 'confirmed' }
  );
  console.log('list ok', listSig);

  if (mode === 'cancel') {
    const cancelIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: seller.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketplace, isSigner: false, isWritable: false },
        { pubkey: listing, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: nftVault, isSigner: false, isWritable: true },
        { pubkey: sellerNft, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: CANCEL_DISC,
    });
    const cancelSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(cancelIx),
      [seller],
      { commitment: 'confirmed' }
    );
    console.log('cancel ok', cancelSig);
    return;
  }

  if (mode === 'buy') {
    if (!buyer) throw new Error('--buyer keypair required for buy mode');
    const buyerNft = ata(buyer.publicKey, mint);
    const buyerGrow = ata(buyer.publicKey, growMint);
    const sellerGrow = ata(seller.publicKey, growMint);
    const buyIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
        { pubkey: seller.publicKey, isSigner: false, isWritable: true },
        { pubkey: marketplace, isSigner: false, isWritable: false },
        { pubkey: listing, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: nftVault, isSigner: false, isWritable: true },
        { pubkey: buyerNft, isSigner: false, isWritable: true },
        { pubkey: growMint, isSigner: false, isWritable: false },
        { pubkey: buyerGrow, isSigner: false, isWritable: true },
        { pubkey: sellerGrow, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: BUY_DISC,
    });
    const buySig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(buyIx),
      [buyer],
      { commitment: 'confirmed' }
    );
    console.log('buy ok', buySig);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
