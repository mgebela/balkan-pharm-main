/*
 * Solana chain config — Devnet for Adopt-a-plant (M1).
 *
 * rpcUrl: preferred endpoint (set to a Helius/QuickNode Devnet URL when you have one).
 * rpcUrls: public failover list used by SolanaRpc / wallet connection rotation.
 */
(function () {
  'use strict';

  window.ChainConfig = {
    cluster: 'devnet',
    // Proxied QuickNode/Helius via Cloud Function (secret never in the browser).
    rpcUrl: 'https://europe-west1-balpha-9dab9.cloudfunctions.net/solanaRpc',
    rpcUrls: [
      'https://europe-west1-balpha-9dab9.cloudfunctions.net/solanaRpc',
      'https://rpc.ankr.com/solana_devnet',
      'https://endpoints.omniatech.io/v1/sol/devnet/public',
      'https://api.devnet.solana.com',
    ],
    networkLabel: 'Solana · devnet',
    walletName: 'Solana wallet',
    walletDownloadUrl: 'https://solana.com/solutions/wallets',

    // Deployed addresses (devnet) — filled in after chain/deploy scripts run.
    growMint: '3nReF8GGLdbPc4bmrgWyproVwt9taHb1yGvL5Cekrcqp',
    growDecimals: 9,
    seedCollection: '79yYy4aSRzJQq9xonvcaTw7DgndoqwPMYDd2MpT8iVZa',
    // Role-split wallets (Devnet):
    // mintAuthority — $GROWTOO + seed collection authority
    // escrowAddress — holds listed NFTs (new listings)
    // feePayerAddress — pays market settlement fees
    // legacyEscrowAddress — pre-split vault; still settled for open listings
    mintAuthority: 'F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3',
    escrowAddress: 'EmQ4nNB1YVWNKVEiPNYhLgJR2gY1deJoV2L743z945yD',
    feePayerAddress: 'Et1uJZn2GAWFdnKaVTubZYohKNJNB7gEpoQ7EHHKq975',
    legacyEscrowAddress: 'F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3',
    // Holds adopter full stake for adopt_stake (50% released now, 50% until harvest).
    // Dedicated care vault (separate from NFT escrow). Legacy sold stakes may still
    // point listing.careEscrowAddress at the NFT escrow until harvest settles.
    careEscrowAddress: 'C69K4V4921m1jYxjBoBoMYJR2fxYQpnx1w45gNGsL4ZU',
    // Instant sale default: on-chain Anchor PDA vault when escrowProgramId is set.
    // settlementMode 'legacy' forces hot-wallet queue (ops/regression only).
    escrowProgramId: 'GspPo6doBKoYmD6aCFHgo2q3CEXmWEoZXPpXAJnkjdyb',
    settlementMode: 'program',
    // Activates escrow_pending → active when NFT is already in escrow.
    marketReconcileUrl:
      'https://europe-west1-balpha-9dab9.cloudfunctions.net/reconcileMarketEscrow',
    // Settles sale_pending / cancel_requested (fee payer + escrow keys in Cloud Functions).
    marketSettleUrl:
      'https://europe-west1-balpha-9dab9.cloudfunctions.net/settleMarketQueue',
    devnetNotice:
      'Connect a Solana wallet on the test network (Devnet). Seed NFTs mint via the cloud queue; $GROWTOO rewards settle on-chain. Test assets only.',
    explorerAddress: function (address) {
      return 'https://solscan.io/account/' + encodeURIComponent(address) + '?cluster=devnet';
    },
    explorerTx: function (signature) {
      return 'https://solscan.io/tx/' + encodeURIComponent(signature) + '?cluster=devnet';
    },
  };
})();
