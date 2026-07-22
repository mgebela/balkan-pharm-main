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
    rpcUrl: 'https://api.devnet.solana.com',
    rpcUrls: [
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
    // Activates escrow_pending → active when NFT is already in escrow.
    marketReconcileUrl:
      'https://europe-west1-balpha-9dab9.cloudfunctions.net/reconcileMarketEscrow',
    devnetNotice:
      'Connect a Solana wallet on Devnet. Seed NFTs mint via the cloud queue; $GROWTOO rewards settle on-chain.',
    explorerAddress: function (address) {
      return 'https://solscan.io/account/' + encodeURIComponent(address) + '?cluster=devnet';
    },
    explorerTx: function (signature) {
      return 'https://solscan.io/tx/' + encodeURIComponent(signature) + '?cluster=devnet';
    },
  };
})();
