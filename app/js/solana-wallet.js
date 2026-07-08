/*
 * Multi-wallet Solana layer for dnevnik.live (devnet).
 * Wallet Standard + legacy extension adapters (Phantom, Solflare, Backpack, …).
 */
(function () {
  'use strict';

  const WEB3_CDN = 'https://esm.sh/@solana/web3.js@1.98.4';
  const WALLET_STANDARD_CDN = 'https://esm.sh/@wallet-standard/app@1.1.0';
  const SOLANA_CHAINS = ['solana:devnet', 'solana:mainnet', 'solana:testnet', 'solana:localnet'];

  const cfg = function () {
    return window.ChainConfig || { rpcUrl: 'https://api.devnet.solana.com', cluster: 'devnet' };
  };

  let web3Module = null;
  let connection = null;
  let publicKey = null;
  let providerName = '';
  let activeAdapter = null;
  let standardApi = null;
  let standardApiLoading = null;
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

  async function loadWalletStandard() {
    if (standardApi) return standardApi;
    if (standardApiLoading) return standardApiLoading;
    standardApiLoading = import(WALLET_STANDARD_CDN)
      .then(function (mod) {
        const getWallets = mod.getWallets || (mod.default && mod.default.getWallets);
        if (typeof getWallets !== 'function') {
          throw new Error('Wallet Standard failed to load.');
        }
        standardApi = getWallets();
        return standardApi;
      })
      .finally(function () {
        standardApiLoading = null;
      });
    return standardApiLoading;
  }

  function isSolanaChain(chain) {
    return typeof chain === 'string' && chain.indexOf('solana:') === 0;
  }

  function isSolanaStandardWallet(wallet) {
    return wallet && wallet.chains && wallet.chains.some(isSolanaChain);
  }

  function walletIcon(wallet) {
    if (wallet && wallet.icon) return wallet.icon;
    return '';
  }

  function slugify(name) {
    return String(name || 'wallet')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getLegacyPhantom() {
    const p = window.phantom && window.phantom.solana;
    if (p && p.isPhantom) return p;
    return null;
  }

  function getLegacySolflare() {
    const candidates = [window.solflare];
    if (window.solflare && window.solflare.solflare) candidates.push(window.solflare.solflare);
    for (let i = 0; i < candidates.length; i += 1) {
      const w = candidates[i];
      if (w && (w.isSolflare || typeof w.connect === 'function')) return w;
    }
    return null;
  }

  function getLegacyBackpack() {
    const w = window.backpack;
    if (w && (w.isBackpack || typeof w.connect === 'function')) return w;
    return null;
  }

  function legacyAdapter(id, name, provider, icon) {
    if (!provider) return null;
    return {
      id: id,
      name: name,
      icon: icon || '',
      kind: 'legacy',
      provider: provider,
      connect: async function () {
        if (!provider.publicKey) await provider.connect();
        const pk = await readLegacyPublicKey(provider);
        if (!pk) throw new Error(name + ' connected but no public key was returned.');
        return pk;
      },
      disconnect: async function () {
        if (typeof provider.disconnect === 'function') {
          try {
            await provider.disconnect();
          } catch {
            // ignore
          }
        }
      },
      signMessage: async function (bytes) {
        if (typeof provider.signMessage !== 'function') {
          throw new Error(name + ' does not support signMessage.');
        }
        const result = await provider.signMessage(bytes, 'utf8');
        if (result && result.signature) return result;
        return result;
      },
      signTransaction: async function (transaction) {
        if (typeof provider.signTransaction !== 'function') {
          throw new Error(name + ' does not support signTransaction.');
        }
        return provider.signTransaction(transaction);
      },
      signAllTransactions: async function (transactions) {
        if (typeof provider.signAllTransactions === 'function') {
          return provider.signAllTransactions(transactions);
        }
        const out = [];
        for (let i = 0; i < transactions.length; i += 1) {
          out.push(await provider.signTransaction(transactions[i]));
        }
        return out;
      },
    };
  }

  function standardAdapter(wallet) {
    const id = 'standard:' + slugify(wallet.name);
    let account = null;

    function pickAccount() {
      if (account) return account;
      const accounts = wallet.accounts || [];
      account = accounts.find(function (a) {
        return a.chains && a.chains.some(isSolanaChain);
      });
      return account || accounts[0] || null;
    }

    return {
      id: id,
      name: wallet.name || 'Wallet',
      icon: walletIcon(wallet),
      kind: 'standard',
      wallet: wallet,
      connect: async function () {
        const connect = wallet.features && wallet.features['standard:connect'];
        if (!connect || typeof connect.connect !== 'function') {
          throw new Error((wallet.name || 'Wallet') + ' does not support connect.');
        }
        await connect.connect();
        account = pickAccount();
        if (!account || !account.address) {
          throw new Error((wallet.name || 'Wallet') + ' connected but no account was returned.');
        }
        const web3 = await loadWeb3();
        return new web3.PublicKey(account.address);
      },
      disconnect: async function () {
        const disconnect = wallet.features && wallet.features['standard:disconnect'];
        account = null;
        if (disconnect && typeof disconnect.disconnect === 'function') {
          try {
            await disconnect.disconnect();
          } catch {
            // ignore
          }
        }
      },
      signMessage: async function (bytes) {
        const current = pickAccount();
        const signMessage = wallet.features && wallet.features['solana:signMessage'];
        if (!signMessage || typeof signMessage.signMessage !== 'function') {
          throw new Error((wallet.name || 'Wallet') + ' does not support signMessage.');
        }
        if (!current) throw new Error('Wallet account not available.');
        return signMessage.signMessage({ account: current, message: bytes });
      },
      signTransaction: async function (transaction) {
        const current = pickAccount();
        const signTx = wallet.features && wallet.features['solana:signTransaction'];
        if (!signTx || typeof signTx.signTransaction !== 'function') {
          throw new Error((wallet.name || 'Wallet') + ' does not support signTransaction.');
        }
        if (!current) throw new Error('Wallet account not available.');
        const out = await signTx.signTransaction({ account: current, transaction: transaction });
        return out && out.signedTransaction ? out.signedTransaction : out;
      },
      signAllTransactions: async function (transactions) {
        const current = pickAccount();
        const signTx = wallet.features && wallet.features['solana:signAndSendTransaction'];
        const signMany = wallet.features && wallet.features['solana:signTransaction'];
        if (signMany && typeof signMany.signTransaction === 'function') {
          const out = [];
          for (let i = 0; i < transactions.length; i += 1) {
            const signed = await signMany.signTransaction({
              account: current,
              transaction: transactions[i],
            });
            out.push(signed && signed.signedTransaction ? signed.signedTransaction : signed);
          }
          return out;
        }
        throw new Error((wallet.name || 'Wallet') + ' does not support signAllTransactions.');
      },
    };
  }

  async function readLegacyPublicKey(provider) {
    if (!provider || !provider.publicKey) return null;
    const raw = provider.publicKey;
    if (typeof raw.toBase58 === 'function') return raw;
    const web3 = await loadWeb3();
    const asString = typeof raw.toString === 'function' ? raw.toString() : String(raw);
    return new web3.PublicKey(asString);
  }

  async function discoverWalletAdapters() {
    const found = new Map();

    function adapterRank(adapter) {
      let rank = 0;
      if (adapter.kind === 'standard') rank += 20;
      if (adapter.icon) rank += 10;
      return rank;
    }

    function upsert(adapter) {
      if (!adapter) return;
      const key = slugify(adapter.name);
      const existing = found.get(key);
      if (!existing || adapterRank(adapter) > adapterRank(existing)) {
        found.set(key, adapter);
      }
    }

    try {
      const api = await loadWalletStandard();
      const wallets = api.get();
      wallets.filter(isSolanaStandardWallet).forEach(function (wallet) {
        upsert(standardAdapter(wallet));
      });
    } catch (err) {
      console.warn('Wallet Standard discovery failed', err);
    }

    upsert(legacyAdapter('phantom', 'Phantom', getLegacyPhantom(), ''));
    upsert(legacyAdapter('solflare', 'Solflare', getLegacySolflare(), ''));
    upsert(legacyAdapter('backpack', 'Backpack', getLegacyBackpack(), ''));

    return Array.from(found.values()).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  }

  function isValidBase58Address(value) {
    return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  }

  function manualAdapter(address) {
    function watchOnlyError() {
      return new Error(
        'Watch-only address cannot sign. Connect a wallet extension to verify ownership or make transactions.'
      );
    }
    return {
      id: 'manual',
      name: 'Watch-only',
      icon: '',
      kind: 'manual',
      connect: async function () {
        const web3 = await loadWeb3();
        return new web3.PublicKey(address);
      },
      disconnect: async function () {},
      signMessage: async function () {
        throw watchOnlyError();
      },
      signTransaction: async function () {
        throw watchOnlyError();
      },
      signAllTransactions: async function () {
        throw watchOnlyError();
      },
    };
  }

  function wrapConnectError(err, walletName) {
    if (!err) return new Error('Wallet connection failed.');
    if (err.message) return err;
    if (err.code === 4001 || err.code === '4001') {
      return new Error('Connection cancelled in ' + (walletName || 'wallet') + '.');
    }
    return new Error('Wallet connection failed. Unlock your wallet extension and try again.');
  }

  function removeWalletPicker() {
    const el = document.getElementById('wallet-picker-modal');
    if (el) el.remove();
  }

  function showWalletPicker(adapters) {
    return new Promise(function (resolve, reject) {
      removeWalletPicker();

      const overlay = document.createElement('div');
      overlay.id = 'wallet-picker-modal';
      overlay.className = 'wallet-picker-modal';
      overlay.innerHTML =
        '<div class="wallet-picker-card" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title">' +
        '<header class="wallet-picker-head">' +
        '<h2 id="wallet-picker-title">Connect wallet</h2>' +
        '<button type="button" class="wallet-picker-close" aria-label="Close">×</button>' +
        '</header>' +
        '<p class="wallet-picker-lede">Choose a Solana wallet installed in your browser.</p>' +
        '<div class="wallet-picker-list">' +
        (adapters.length
          ? adapters
              .map(function (adapter) {
                const icon = adapter.icon
                  ? '<img src="' + adapter.icon + '" alt="" class="wallet-picker-icon" />'
                  : '<span class="wallet-picker-icon wallet-picker-icon--fallback" aria-hidden="true">◎</span>';
                return (
                  '<button type="button" class="wallet-picker-item" data-wallet-id="' +
                  adapter.id +
                  '">' +
                  icon +
                  '<span class="wallet-picker-name">' +
                  adapter.name +
                  '</span>' +
                  '</button>'
                );
              })
              .join('')
          : '<p class="wallet-picker-empty">No wallet extension detected in this browser.</p>') +
        '</div>' +
        '<button type="button" class="wallet-picker-manual-toggle">Enter address manually (watch-only)</button>' +
        '<form class="wallet-picker-manual" hidden>' +
        '<label class="wallet-picker-manual-label" for="wallet-picker-manual-input">Solana address</label>' +
        '<input type="text" id="wallet-picker-manual-input" class="wallet-picker-manual-input" placeholder="e.g. 7fUAJd…Stgnd" autocomplete="off" spellcheck="false" />' +
        '<p class="wallet-picker-manual-note">Watch-only: your address is shown in the app, but ownership is not verified and signing is unavailable.</p>' +
        '<button type="submit" class="btn btn-primary wallet-picker-manual-submit">Use this address</button>' +
        '</form>' +
        '<p class="wallet-picker-foot">Need a wallet? <a href="https://solana.com/solutions/wallets" target="_blank" rel="noopener noreferrer">Browse Solana wallets</a></p>' +
        '</div>';

      function close() {
        removeWalletPicker();
        document.removeEventListener('keydown', onKey);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          close();
          reject(new Error('Wallet selection cancelled.'));
        }
      }

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          close();
          reject(new Error('Wallet selection cancelled.'));
          return;
        }
        const btn = e.target.closest('.wallet-picker-item');
        if (btn) {
          const id = btn.getAttribute('data-wallet-id');
          const adapter = adapters.find(function (a) {
            return a.id === id;
          });
          close();
          if (adapter) resolve(adapter);
          else reject(new Error('Wallet not found.'));
          return;
        }
        if (e.target.closest('.wallet-picker-manual-toggle')) {
          const form = overlay.querySelector('.wallet-picker-manual');
          if (form) {
            form.hidden = !form.hidden;
            if (!form.hidden) {
              const input = form.querySelector('.wallet-picker-manual-input');
              if (input) input.focus();
            }
          }
          return;
        }
        if (e.target.closest('.wallet-picker-close')) {
          close();
          reject(new Error('Wallet selection cancelled.'));
        }
      });

      overlay.addEventListener('submit', function (e) {
        const form = e.target.closest('.wallet-picker-manual');
        if (!form) return;
        e.preventDefault();
        const input = form.querySelector('.wallet-picker-manual-input');
        const address = input ? input.value.trim() : '';
        if (!isValidBase58Address(address)) {
          if (input) {
            input.classList.add('wallet-picker-manual-input--error');
            input.focus();
          }
          return;
        }
        close();
        resolve(manualAdapter(address));
      });

      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
    });
  }

  async function pickAdapter(preferredId) {
    const adapters = await discoverWalletAdapters();
    if (preferredId) {
      const chosen = adapters.find(function (a) {
        return a.id === preferredId;
      });
      if (chosen) return chosen;
    }
    // Always show the picker so the manual watch-only option is available.
    return showWalletPicker(adapters);
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

    async listWallets() {
      return discoverWalletAdapters();
    },

    isWalletAvailable: function () {
      return typeof window !== 'undefined';
    },

    // Back-compat alias
    isSolflareAvailable: function () {
      return SolanaWallet.isWalletAvailable();
    },

    onChange: function (fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    },

    getConnection: async function () {
      const web3 = await loadWeb3();
      const c = cfg();
      if (!connection) {
        connection = new web3.Connection(c.rpcUrl, 'confirmed');
      }
      return connection;
    },

    async connect(preferredId) {
      const adapter = await pickAdapter(preferredId);
      activeAdapter = adapter;
      try {
        const pk = await adapter.connect();
        publicKey = pk;
        providerName = slugify(adapter.name);
        emit();
        return publicKey.toBase58();
      } catch (err) {
        throw wrapConnectError(err, adapter.name);
      }
    },

    async disconnect() {
      if (activeAdapter && typeof activeAdapter.disconnect === 'function') {
        try {
          await activeAdapter.disconnect();
        } catch {
          // ignore
        }
      }
      publicKey = null;
      providerName = '';
      activeAdapter = null;
      emit();
    },

    async tryRestore() {
      const adapters = await discoverWalletAdapters();
      for (let i = 0; i < adapters.length; i += 1) {
        const adapter = adapters[i];
        if (adapter.kind !== 'legacy' || !adapter.provider) continue;
        const provider = adapter.provider;
        try {
          if (provider.isConnected && provider.publicKey) {
            const pk = await readLegacyPublicKey(provider);
            if (pk) {
              activeAdapter = adapter;
              publicKey = pk;
              providerName = slugify(adapter.name);
              emit();
              return true;
            }
          }
        } catch {
          // try next wallet
        }
      }
      return false;
    },

    async signTransaction(transaction) {
      if (!activeAdapter || !publicKey) throw new Error('Wallet not connected.');
      return activeAdapter.signTransaction(transaction);
    },

    async signAllTransactions(transactions) {
      if (!activeAdapter || !publicKey) throw new Error('Wallet not connected.');
      return activeAdapter.signAllTransactions(transactions);
    },

    async signMessage(messageBytes) {
      if (!activeAdapter || !publicKey) throw new Error('Wallet not connected.');
      return activeAdapter.signMessage(messageBytes);
    },
  };

  window.SolanaWallet = SolanaWallet;

  loadWeb3().catch(function () {
    // user may connect later
  });
})();
