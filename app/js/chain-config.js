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
    devnetNotice:
      'Connect a Solana wallet on devnet. Seed NFT minting and $GROW SPL rewards are still simulated locally until M2 on-chain deploy.',
    explorerAddress: function (address) {
      return 'https://solscan.io/account/' + encodeURIComponent(address) + '?cluster=devnet';
    },
    explorerTx: function (signature) {
      return 'https://solscan.io/tx/' + encodeURIComponent(signature) + '?cluster=devnet';
    },
  };
})();
