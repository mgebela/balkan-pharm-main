/*
 * Mint a single seed NFT on devnet.
 *
 * Usage:
 *   node mint-seed.js --name "CBD Auto #1" --strain "CBD Auto" --batch B-2026-07 [--plant plant-id] [--to <pubkey>]
 *
 * Without --to the NFT is minted into the authority wallet.
 */
import { createMintClient, mintSeedNft } from './mint-seed-lib.js';
import { solscanAddress } from './common.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.name || !args.strain || !args.batch) {
  console.error('Usage: node mint-seed.js --name <name> --strain <strain> --batch <batch> [--plant <plantId>] [--to <pubkey>]');
  process.exit(1);
}

const umi = createMintClient();
console.log('Authority:', umi.identity.publicKey);
console.log('Minting seed NFT:', args.name, '(strain:', args.strain + ', batch:', args.batch + ')');

const result = await mintSeedNft(
  umi,
  { name: args.name, strain: args.strain, batch: args.batch, plantId: args.plant || null },
  { recipient: args.to }
);

console.log('\nSeed NFT minted on devnet.');
console.log('Mint address:', result.mint);
console.log('Owner:', result.owner);
console.log('Metadata URI:', result.metadataUri);
console.log('Tx:', result.signature);
console.log('Solscan:', solscanAddress(result.mint));
