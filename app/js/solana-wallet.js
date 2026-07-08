/*
 * Solflare-first Solana wallet layer for dnevnik.live (devnet).
 * Uses @solflare-wallet/sdk (extension + web wallet) with window.solflare fallback.
 */
(function () {
  'use strict';

  const WEB3_CDN = 'https://esm.sh/@solana/web3.js@1.98.4';
  const SOLFLARE_SDK_CDN = 'https://esm.sh/@solflare-wallet/sdk@1.4.2';
  const PROVIDER_WAIT_MS = 2500;
  const cfg = function () {
    return window.ChainConfig || { rpcUrl: 'https://api.devnet.solana.com', cluster: 'devnet' };
  };

  let web3Module = null;
  let solflareSdk = null;
  let solflareSdkLoading = null;
  let connection = null;
  let publicKey = null;
  let providerName = '';
  let activeProvider = null;

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

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function loadWeb3() {
    if (web3Module) return web3Module;
    web3Module = await import(WEB3_CDN);
    return web3Module;
  }

  function getLegacySolflareProvider() {
    const candidates = [window.solflare];
    if (window.solflare && window.solflare.solflare) candidates.push(window.solflare.solflare);
    for (let i = 0; i < candidates.length; i += 1) {
      const w = candidates[i];
      if (w && (w.isSolflare || typeof w.connect === 'function')) return w;
    }
    return null;
  }

  async function waitForLegacyProvider(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || PROVIDER_WAIT_MS);
    while (Date.now() < deadline) {
      const provider = getLegacySolflareProvider();
      if (provider) return provider;
      await sleep(120);
    }
    return getLegacySolflareProvider();
  }

  function bindLegacyProviderEvents(provider) {
    if (!provider || provider.__dnevnikBound) return;
    provider.__dnevnikBound = true;
    if (typeof provider.on !== 'function') return;
    provider.on('connect', function () {
      const pk = readPublicKey(provider);
      if (pk) {
        publicKey = pk;
        providerName = 'solflare';
        activeProvider = provider;
        emit();
      }
    });
    provider.on('disconnect', function () {
      publicKey = null;
      providerName = '';
      activeProvider = null;
      emit();
    });
    provider.on('accountChanged', function () {
      const pk = readPublicKey(provider);
      publicKey = pk;
      if (!pk) {
        providerName = '';
        activeProvider = null;
      }
      emit();
    });
  }

  function bindSdkEvents(wallet) {
    if (!wallet || wallet.__dnevnikBound) return;
    wallet.__dnevnikBound = true;
    if (typeof wallet.on !== 'function') return;
    wallet.on('connect', function () {
      const pk = readPublicKey(wallet);
      if (pk) {
        publicKey = pk;
        providerName = 'solflare';
        activeProvider = wallet;
        emit();
      }
    });
    wallet.on('disconnect', function () {
      publicKey = null;
      providerName = '';
      activeProvider = null;
      emit();
    });
  }

  async function loadSolflareSdk() {
    if (solflareSdk) return solflareSdk;
    if (solflareSdkLoading) return solflareSdkLoading;
    solflareSdkLoading = import(SOLFLARE_SDK_CDN)
      .then(function (mod) {
        const Solflare = mod.default || mod.Solflare || mod;
        if (typeof Solflare !== 'function') {
          throw new Error('Solflare SDK failed to load.');
        }
        const cluster = cfg().cluster || 'devnet';
        solflareSdk = new Solflare({ network: cluster });
        bindSdkEvents(solflareSdk);
        return solflareSdk;
      })
      .finally(function () {
        solflareSdkLoading = null;
      });
    return solflareSdkLoading;
  }

  async function getConnectableProvider() {
    try {
      const sdk = await loadSolflareSdk();
      if (sdk) return sdk;
    } catch (err) {
      console.warn('Solflare SDK unavailable, falling back to extension', err);
    }
    const legacy = await waitForLegacyProvider(PROVIDER_WAIT_MS);
    if (legacy) {
      bindLegacyProviderEvents(legacy);
      return legacy;
    }
    const err = new Error(
      'Solflare wallet not found. Install the Solflare browser extension, allow it on this site, then refresh and try again.'
    );
    err.code = 'WALLET_NOT_FOUND';
    throw err;
  }

  async function getActiveProvider() {
    if (activeProvider) return activeProvider;
    if (solflareSdk && (solflareSdk.isConnected || solflareSdk.publicKey)) return solflareSdk;
    const legacy = getLegacySolflareProvider();
    if (legacy) return legacy;
    return getConnectableProvider();
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
      return !!getLegacySolflareProvider() || typeof window !== 'undefined';
    },

    onChange: function (fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    },

    getConnection: getConnection,

    async connect() {
      const provider = await getConnectableProvider();
      activeProvider = provider;
      if (!readPublicKey(provider)) {
        await provider.connect();
      }
      const pk = readPublicKey(provider);
      if (!pk) throw new Error('Solflare connected but no public key was returned.');
      publicKey = pk;
      providerName = 'solflare';
      emit();
      return publicKey.toBase58();
    },

    async disconnect() {
      const provider = activeProvider || solflareSdk || getLegacySolflareProvider();
      if (provider && typeof provider.disconnect === 'function') {
        try {
          await provider.disconnect();
        } catch {
          // wallet may already be disconnected
        }
      }
      publicKey = null;
      providerName = '';
      activeProvider = null;
      emit();
    },

    async tryRestore() {
      try {
        const sdk = await loadSolflareSdk();
        if (sdk && sdk.isConnected && sdk.publicKey) {
          const pk = readPublicKey(sdk);
          if (pk) {
            publicKey = pk;
            providerName = 'solflare';
            activeProvider = sdk;
            emit();
            return true;
          }
        }
      } catch {
        // fall through to legacy restore
      }

      const legacy = getLegacySolflareProvider();
      if (!legacy) return false;
      bindLegacyProviderEvents(legacy);
      try {
        if (legacy.isConnected && legacy.publicKey) {
          const pk = readPublicKey(legacy);
          if (pk) {
            publicKey = pk;
            providerName = 'solflare';
            activeProvider = legacy;
            emit();
            return true;
          }
        }
      } catch {
        return false;
      }
      return false;
    },

    async signTransaction(transaction) {
      const provider = await getActiveProvider();
      if (!publicKey) throw new Error('Wallet not connected.');
      if (typeof provider.signTransaction !== 'function') {
        throw new Error('Solflare does not support signTransaction.');
      }
      return provider.signTransaction(transaction);
    },

    async signAllTransactions(transactions) {
      const provider = await getActiveProvider();
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
      const provider = await getActiveProvider();
      if (!publicKey) throw new Error('Wallet not connected.');
      if (typeof provider.signMessage === 'function') {
        const result = await provider.signMessage(messageBytes, 'utf8');
        if (result && result.signature) return result;
        return result;
      }
      throw new Error('Solflare does not support signMessage.');
    },
  };

  window.SolanaWallet = SolanaWallet;

  loadWeb3().catch(function () {
    // user may connect later
  });
})();
