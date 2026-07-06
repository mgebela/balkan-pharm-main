/*
 * Solflare-first Solana wallet layer for dnevnik.live (devnet).
 * Loads @solana/web3.js via ESM CDN — no bundler required for static deploy.
 */
(function () {
  'use strict';

  const WEB3_CDN = 'https://esm.sh/@solana/web3.js@1.98.4';
  const cfg = function () {
    return window.ChainConfig || { rpcUrl: 'https://api.devnet.solana.com', cluster: 'devnet' };
  };

  let web3Module = null;
  let connection = null;
  let publicKey = null;
  let providerName = '';

  const listeners = new Set();

  function emit() {
    const snapshot = {
      connected: !!publicKey,
      publicKey: publicKey ? publicKey.toBase58() : '',
      provider: providerName,
    };
    listeners.forEach(function (fn) {
      try {
        fn(snapshot);
      } catch {
        // ignore
      }
    });
  }

  async function loadWeb3() {
    if (web3Module) return web3Module;
    web3Module = await import(WEB3_CDN);
    return web3Module;
  }

  function getSolflareProvider() {
    const w = window.solflare;
    if (w && (w.isSolflare || typeof w.connect === 'function')) return w;
    return null;
  }

  async function ensureProvider() {
    const provider = getSolflareProvider();
    if (!provider) {
      const err = new Error(
        'Solflare wallet not found. Install the Solflare browser extension or mobile app, then try again.'
      );
      err.code = 'WALLET_NOT_FOUND';
      throw err;
    }
    return provider;
  }

  async function getConnection() {
    const web3 = await loadWeb3();
    const c = cfg();
    if (!connection) {
      connection = new web3.Connection(c.rpcUrl, 'confirmed');
    }
    return connection;
  }

  function readPublicKey(provider) {
    if (!provider || !provider.publicKey) return null;
    if (typeof provider.publicKey.toBase58 === 'function') return provider.publicKey;
    const web3 = web3Module;
    if (web3 && web3.PublicKey) {
      return new web3.PublicKey(String(provider.publicKey));
    }
    return null;
  }

  function bindProviderEvents(provider) {
    if (!provider || provider.__dnevnikBound) return;
    provider.__dnevnikBound = true;
    if (typeof provider.on === 'function') {
      provider.on('connect', function () {
        const pk = readPublicKey(provider);
        if (pk) {
          publicKey = pk;
          providerName = 'solflare';
          emit();
        }
      });
      provider.on('disconnect', function () {
        publicKey = null;
        providerName = '';
        emit();
      });
      provider.on('accountChanged', function () {
        const pk = readPublicKey(provider);
        publicKey = pk;
        if (!pk) providerName = '';
        emit();
      });
    }
  }

  const SolanaWallet = {
    cluster: function () {
      return cfg().cluster;
    },

    rpcUrl: function () {
      return cfg().rpcUrl;
    },

    isConnected: function () {
      return !!publicKey;
    },

    getPublicKey: function () {
      return publicKey ? publicKey.toBase58() : '';
    },

    getProviderName: function () {
      return providerName;
    },

    isSolflareAvailable: function () {
      return !!getSolflareProvider();
    },

    onChange: function (fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    },

    getConnection: getConnection,

    async connect() {
      const provider = await ensureProvider();
      bindProviderEvents(provider);
      await provider.connect();
      const pk = readPublicKey(provider);
      if (!pk) throw new Error('Solflare connected but no public key was returned.');
      publicKey = pk;
      providerName = 'solflare';
      emit();
      return publicKey.toBase58();
    },

    async disconnect() {
      const provider = getSolflareProvider();
      if (provider && typeof provider.disconnect === 'function') {
        try {
          await provider.disconnect();
        } catch {
          // wallet may already be disconnected
        }
      }
      publicKey = null;
      providerName = '';
      emit();
    },

    async tryRestore() {
      const provider = getSolflareProvider();
      if (!provider) return false;
      bindProviderEvents(provider);
      try {
        if (provider.isConnected && provider.publicKey) {
          const pk = readPublicKey(provider);
          if (pk) {
            publicKey = pk;
            providerName = 'solflare';
            emit();
            return true;
          }
        }
        if (typeof provider.connect === 'function' && provider.isConnected === false) {
          return false;
        }
      } catch {
        return false;
      }
      return false;
    },

    async signTransaction(transaction) {
      const provider = await ensureProvider();
      if (!publicKey) throw new Error('Wallet not connected.');
      if (typeof provider.signTransaction !== 'function') {
        throw new Error('Solflare does not support signTransaction.');
      }
      const signed = await provider.signTransaction(transaction);
      return signed;
    },

    async signAllTransactions(transactions) {
      const provider = await ensureProvider();
      if (!publicKey) throw new Error('Wallet not connected.');
      if (typeof provider.signAllTransactions === 'function') {
        return provider.signAllTransactions(transactions);
      }
      const out = [];
      for (let i = 0; i < transactions.length; i += 1) {
        out.push(await provider.signTransaction(transactions[i]));
      }
      return out;
    },

    async signMessage(messageBytes) {
      const provider = await ensureProvider();
      if (!publicKey) throw new Error('Wallet not connected.');
      if (typeof provider.signMessage === 'function') {
        return provider.signMessage(messageBytes);
      }
      throw new Error('Solflare does not support signMessage.');
    },
  };

  window.SolanaWallet = SolanaWallet;

  // Preload web3 in background for faster first connection.
  loadWeb3().catch(function () {
    // user may connect later
  });
})();
