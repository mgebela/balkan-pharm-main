/*
 * Solana chain config — devnet for Adopt-a-plant (M1).
 * Replace rpcUrl with a dedicated RPC (Helius, QuickNode) for production load.
 */
(function () {
  'use strict';

  window.ChainConfig = {
    cluster: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    networkLabel: 'Solana · devnet',
    walletName: 'Solana wallet',
    walletDownloadUrl: 'https://solana.com/solutions/wallets',

    // Deployed addresses (devnet) — filled in after chain/deploy scripts run.
    growMint: '3nReF8GGLdbPc4bmrgWyproVwt9taHb1yGvL5Cekrcqp',
    growDecimals: 9,
    seedCollection: '79yYy4aSRzJQq9xonvcaTw7DgndoqwPMYDd2MpT8iVZa',
    // Authority wallet; also acts as the marketplace escrow on devnet.
    escrowAddress: 'F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3',
    // Activates escrow_pending → active when NFT is already in escrow.
    marketReconcileUrl:
      'https://europe-west1-balpha-9dab9.cloudfunctions.net/reconcileMarketEscrow',
    devnetNotice:
      'Connect a Solana wallet on devnet. Seed NFTs are minted for real on devnet via the mint queue; $GROWTOO SPL rewards are still simulated locally.',
    explorerAddress: function (address) {
      return 'https://solscan.io/account/' + encodeURIComponent(address) + '?cluster=devnet';
    },
    explorerTx: function (signature) {
      return 'https://solscan.io/tx/' + encodeURIComponent(signature) + '?cluster=devnet';
    },
  };
})();
