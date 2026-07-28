/*
 * Multi-wallet Solana layer for dnevnik.live (devnet).
 * Wallet Standard + legacy extension adapters (Phantom, Solflare, Backpack, …).
 */
(function () {
  'use strict';

  // Prefer bundled CDNs — esm.sh resolves many deps and can hang in some browsers.
  const WEB3_CDNS = [
    'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.4/+esm',
    'https://esm.sh/@solana/web3.js@1.98.4?bundle',
    'https://unpkg.com/@solana/web3.js@1.98.4/lib/index.browser.esm.js',
  ];
  const WALLET_STANDARD_CDNS = [
    'https://cdn.jsdelivr.net/npm/@wallet-standard/app@1.1.0/+esm',
    'https://esm.sh/@wallet-standard/app@1.1.0?bundle',
  ];
  const IMPORT_TIMEOUT_MS = 5000;
  const CONNECT_TIMEOUT_MS = 15000;
  const WALLET_STANDARD_BUDGET_MS = 2500;
  const SOLANA_CHAINS = ['solana:devnet', 'solana:mainnet', 'solana:testnet', 'solana:localnet'];
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  const PHANTOM_INSTALL = 'https://phantom.app/download';
  const SOLFLARE_INSTALL = 'https://solflare.com/download';

  const cfg = function () {
    return window.ChainConfig || { rpcUrl: 'https://api.devnet.solana.com', cluster: 'devnet' };
  };

  let web3Module = null;
  let web3Loading = null;
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

  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(new Error(message || 'Request timed out.'));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () {
      clearTimeout(timer);
    });
  }

  async function importFirst(urls, label) {
    let lastErr = null;
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      try {
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const mod = await withTimeout(
          import(url),
          IMPORT_TIMEOUT_MS,
          label + ' load timed out (' + Math.round(IMPORT_TIMEOUT_MS / 1000) + 's).'
        );
        const ms = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
        );
        console.info('[SolanaWallet]', label, 'loaded from', url, 'in', ms + 'ms');
        return mod;
      } catch (err) {
        lastErr = err;
        console.warn('[SolanaWallet]', label, 'failed from', url, err && err.message);
      }
    }
    throw lastErr || new Error(label + ' failed to load.');
  }

  async function loadWeb3() {
    if (web3Module) return web3Module;
    if (web3Loading) return web3Loading;
    web3Loading = importFirst(WEB3_CDNS, 'web3.js')
      .then(function (mod) {
        web3Module = mod;
        return mod;
      })
      .finally(function () {
        web3Loading = null;
      });
    return web3Loading;
  }

  async function loadWalletStandard() {
    if (standardApi) return standardApi;
    if (standardApiLoading) return standardApiLoading;
    standardApiLoading = importFirst(WALLET_STANDARD_CDNS, 'Wallet Standard')
      .then(function (mod) {
        const getWallets = mod.getWallets || (mod.default && mod.default.getWallets);
        if (typeof getWallets !== 'function') {
          throw new Error('Wallet Standard failed to load.');
        }
        standardApi = getWallets();
        return standardApi;
      })
      .catch(function (err) {
        console.warn('[SolanaWallet] Wallet Standard unavailable, using legacy adapters only', err);
        return { get: function () { return []; } };
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
    if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) {
      return window.phantom.solana;
    }
    if (window.solana && window.solana.isPhantom) return window.solana;
    return null;
  }

  function getLegacySolflare() {
    const candidates = [
      window.solflare,
      window.solflare && window.solflare.provider,
      window.solflare && window.solflare.solflare,
      window.Solflare,
      window.solana && window.solana.isSolflare ? window.solana : null,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const w = candidates[i];
      if (!w) continue;
      if (w.isSolflare || typeof w.connect === 'function') return w;
    }
    return null;
  }

  function getLegacyBackpack() {
    const w = window.backpack;
    if (w && (w.isBackpack || typeof w.connect === 'function')) return w;
    return null;
  }

  function isMobileBrowser() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  function browseDeepLink(wallet) {
    const href = window.location.href;
    if (wallet === 'phantom') {
      return 'https://phantom.app/ul/browse/' + encodeURIComponent(href) + '?ref=' + encodeURIComponent(window.location.origin);
    }
    if (wallet === 'solflare') {
      return (
        'https://solflare.com/ul/v1/browse/' +
        encodeURIComponent(href) +
        '?ref=' +
        encodeURIComponent(window.location.origin)
      );
    }
    return '';
  }

  function installAdapter(id, name, installUrl) {
    return {
      id: id,
      name: name,
      icon: '',
      kind: 'install',
      connect: async function () {
        const deep = browseDeepLink(id);
        const url = isMobileBrowser() && deep ? deep : installUrl;
        window.open(url, '_blank', 'noopener,noreferrer');
        throw new Error(
          name +
            ' is not available in this browser tab. ' +
            (isMobileBrowser()
              ? 'Open this site inside the ' + name + ' in-app browser, then connect again.'
              : 'Install the ' + name + ' extension, refresh this page, then connect again.')
        );
      },
      disconnect: async function () {},
      signMessage: async function () {
        throw new Error('Install ' + name + ' first.');
      },
      signTransaction: async function () {
        throw new Error('Install ' + name + ' first.');
      },
      signAllTransactions: async function () {
        throw new Error('Install ' + name + ' first.');
      },
    };
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
        // Prefer an already-authorized session (no popup).
        let pk = await readLegacyPublicKey(provider);
        if (pk && (provider.isConnected || provider.isTrusted)) {
          return pk;
        }

        if (typeof provider.connect !== 'function') {
          throw new Error(name + ' is installed but does not support connect().');
        }

        try {
          await withTimeout(
            Promise.resolve(provider.connect({ onlyIfTrusted: false })),
            CONNECT_TIMEOUT_MS,
            name +
              ' did not respond within ' +
              Math.round(CONNECT_TIMEOUT_MS / 1000) +
              's. Unlock ' +
              name +
              ', allow the popup, then try again.'
          );
        } catch (err) {
          // Some builds reject when already connected — still try to read the key.
          pk = await readLegacyPublicKey(provider);
          if (pk) return pk;
          throw wrapConnectError(err, name);
        }

        pk = await readLegacyPublicKey(provider);
        if (!pk) {
          // Brief wait for extension to populate publicKey after approve.
          await sleep(250);
          pk = await readLegacyPublicKey(provider);
        }
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
        // Solflare often cancels if display encoding is wrong; try utf8 then bare bytes.
        try {
          const result = await provider.signMessage(bytes, 'utf8');
          if (result && result.signature) return result;
          return result;
        } catch (err) {
          const msg = String((err && err.message) || err || '');
          if (/cancel|reject|4001/i.test(msg)) throw err;
          const result = await provider.signMessage(bytes);
          if (result && result.signature) return result;
          return result;
        }
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

  function preconnectedAdapter(adapter, publicKeyObj) {
    return {
      id: adapter.id,
      name: adapter.name,
      icon: adapter.icon,
      kind: adapter.kind,
      provider: adapter.provider,
      wallet: adapter.wallet,
      connect: async function () {
        return publicKeyObj;
      },
      disconnect: function () {
        return adapter.disconnect();
      },
      signMessage: function (bytes) {
        return adapter.signMessage(bytes);
      },
      signTransaction: function (transaction) {
        return adapter.signTransaction(transaction);
      },
      signAllTransactions: function (transactions) {
        return adapter.signAllTransactions(transactions);
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
      if (adapter.kind === 'legacy') rank += 30;
      if (adapter.kind === 'standard') rank += 20;
      if (adapter.kind === 'install') rank += 1;
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

    // Legacy providers first — sync and instant (do not wait on CDN).
    upsert(legacyAdapter('phantom', 'Phantom', getLegacyPhantom(), ''));
    upsert(legacyAdapter('solflare', 'Solflare', getLegacySolflare(), ''));
    upsert(legacyAdapter('backpack', 'Backpack', getLegacyBackpack(), ''));

    // Wallet Standard with a short budget so Connect never freezes.
    try {
      const api = await withTimeout(
        loadWalletStandard(),
        WALLET_STANDARD_BUDGET_MS,
        'Wallet Standard discovery timed out'
      );
      const wallets = api && typeof api.get === 'function' ? api.get() : [];
      wallets.filter(isSolanaStandardWallet).forEach(function (wallet) {
        upsert(standardAdapter(wallet));
      });
    } catch (err) {
      console.warn('Wallet Standard discovery skipped', err && err.message);
    }

    // Always offer install / open options when the extension is missing.
    if (!found.has('phantom')) upsert(installAdapter('phantom', 'Phantom', PHANTOM_INSTALL));
    if (!found.has('solflare')) upsert(installAdapter('solflare', 'Solflare', SOLFLARE_INSTALL));

    return Array.from(found.values()).sort(function (a, b) {
      return adapterRank(b) - adapterRank(a) || a.name.localeCompare(b.name);
    });
  }

  function isValidBase58Address(value) {
    return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
  }

  function base58ToBytes(str) {
    const bytes = [0];
    for (let i = 0; i < str.length; i += 1) {
      const value = BASE58_ALPHABET.indexOf(str[i]);
      if (value < 0) throw new Error('Invalid base58 character');
      let carry = value;
      for (let j = 0; j < bytes.length; j += 1) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (let i = 0; i < str.length && str[i] === '1'; i += 1) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  function assertValidSolanaAddress(address) {
    const trimmed = String(address || '').trim();
    if (!isValidBase58Address(trimmed)) {
      throw new Error('Enter a valid Solana address (32–44 characters, base58).');
    }
    let bytes;
    try {
      bytes = base58ToBytes(trimmed);
    } catch {
      throw new Error('That address contains invalid characters.');
    }
    if (!bytes || bytes.length !== 32) {
      throw new Error(
        'That address is not a valid Solana public key. Paste the full address (usually 43–44 characters).'
      );
    }
    return trimmed;
  }

  function pubkeyStub(address) {
    return {
      toBase58: function () {
        return address;
      },
      toString: function () {
        return address;
      },
    };
  }

  async function parsePublicKey(address) {
    const trimmed = assertValidSolanaAddress(address);
    try {
      const web3 = await withTimeout(loadWeb3(), IMPORT_TIMEOUT_MS, 'Wallet library load timed out.');
      return new web3.PublicKey(trimmed);
    } catch (err) {
      // Watch-only / display still works with a lightweight key stub.
      if (err && /timed out|failed to load/i.test(String(err.message || err))) {
        console.warn('[SolanaWallet] Using lightweight pubkey stub', err.message);
        return pubkeyStub(trimmed);
      }
      throw new Error(
        'That address is not a valid Solana public key. Check you pasted the full address (usually 43–44 characters).'
      );
    }
  }

  function manualAdapter(address) {
    function watchOnlyError() {
      return new Error(
        'Watch-only address cannot sign. Install Phantom or Solflare to mint or transfer.'
      );
    }
    return {
      id: 'manual',
      name: 'Watch-only',
      icon: '',
      kind: 'manual',
      connect: async function () {
        return parsePublicKey(address);
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

      const installed = adapters.filter(function (a) {
        return a.kind !== 'install';
      });
      const installs = adapters.filter(function (a) {
        return a.kind === 'install';
      });
      const hasInstalled = installed.length > 0;

      function itemHtml(adapter) {
        const icon = adapter.icon
          ? '<img src="' + adapter.icon + '" alt="" class="wallet-picker-icon" />'
          : '<span class="wallet-picker-icon wallet-picker-icon--fallback" aria-hidden="true">◎</span>';
        const badge =
          adapter.kind === 'install'
            ? '<span class="wallet-picker-badge">' +
              (isMobileBrowser() ? 'Open app' : 'Install') +
              '</span>'
            : '';
        return (
          '<button type="button" class="wallet-picker-item' +
          (adapter.kind === 'install' ? ' wallet-picker-item--install' : '') +
          '" data-wallet-id="' +
          adapter.id +
          '">' +
          icon +
          '<span class="wallet-picker-name">' +
          adapter.name +
          '</span>' +
          badge +
          '</button>'
        );
      }

      const listHtml = hasInstalled
        ? installed.map(itemHtml).join('') +
          (installs.length
            ? '<p class="wallet-picker-divider">Not installed</p>' + installs.map(itemHtml).join('')
            : '')
        : '<p class="wallet-picker-empty">No wallet extension in this browser.</p>' +
          '<p class="wallet-picker-empty-hint">' +
          (isMobileBrowser()
            ? 'On phones, open this site inside Phantom or Solflare’s in-app browser.'
            : 'Install Phantom or Solflare, then refresh this page.') +
          '</p>' +
          installs.map(itemHtml).join('');

      const overlay = document.createElement('div');
      overlay.id = 'wallet-picker-modal';
      overlay.className = 'wallet-picker-modal';
      overlay.innerHTML =
        '<div class="wallet-picker-card" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title">' +
        '<header class="wallet-picker-head">' +
        '<h2 id="wallet-picker-title">Connect wallet</h2>' +
        '<button type="button" class="wallet-picker-close" aria-label="Close">×</button>' +
        '</header>' +
        '<p class="wallet-picker-lede">Choose Phantom or Solflare (Devnet).</p>' +
        '<div class="wallet-picker-list">' +
        listHtml +
        '</div>' +
        '<button type="button" class="wallet-picker-manual-toggle">Enter address manually (watch-only)</button>' +
        '<form class="wallet-picker-manual" hidden>' +
        '<label class="wallet-picker-manual-label" for="wallet-picker-manual-input">Solana address</label>' +
        '<input type="text" id="wallet-picker-manual-input" class="wallet-picker-manual-input" placeholder="e.g. 9k1QwNaq…Hfhi" autocomplete="off" spellcheck="false" />' +
        '<p class="wallet-picker-manual-error" id="wallet-picker-manual-error" hidden></p>' +
        '<p class="wallet-picker-manual-note">Watch-only cannot mint or sign. Prefer Phantom/Solflare.</p>' +
        '<button type="submit" class="btn btn-primary wallet-picker-manual-submit">Use this address</button>' +
        '</form>' +
        '<p class="wallet-picker-foot">Need a wallet? <a href="https://solana.com/solutions/wallets" target="_blank" rel="noopener noreferrer">Browse Solana wallets</a></p>' +
        '</div>';

      let settled = false;

      function close() {
        removeWalletPicker();
        document.removeEventListener('keydown', onKey);
      }

      function settleResolve(value) {
        if (settled) return;
        settled = true;
        close();
        resolve(value);
      }

      function settleReject(err) {
        if (settled) return;
        settled = true;
        close();
        reject(err);
      }

      function showManualError(message) {
        const errEl = overlay.querySelector('#wallet-picker-manual-error');
        const input = overlay.querySelector('.wallet-picker-manual-input');
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = message;
        }
        if (input) {
          input.classList.add('wallet-picker-manual-input--error');
          input.focus();
        }
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          settleReject(new Error('Wallet selection cancelled.'));
        }
      }

      function showPickerStatus(message, isError) {
        let status = overlay.querySelector('.wallet-picker-status');
        if (!status) {
          status = document.createElement('p');
          status.className = 'wallet-picker-status';
          const list = overlay.querySelector('.wallet-picker-list');
          if (list && list.parentNode) {
            list.parentNode.insertBefore(status, list.nextSibling);
          }
        }
        status.hidden = !message;
        status.textContent = message || '';
        status.classList.toggle('wallet-picker-status--error', !!isError);
      }

      function setPickerBusy(isBusy) {
        overlay.querySelectorAll('.wallet-picker-item, .wallet-picker-manual-toggle, .wallet-picker-manual-submit').forEach(
          function (el) {
            el.disabled = !!isBusy;
          }
        );
        overlay.classList.toggle('wallet-picker-modal--busy', !!isBusy);
      }

      async function connectFromPicker(adapter, btn) {
        if (settled) return;
        setPickerBusy(true);
        if (btn) btn.classList.add('wallet-picker-item--pending');
        showPickerStatus('Approve the connection in ' + adapter.name + '…', false);

        try {
          if (adapter.kind === 'install') {
            await adapter.connect();
            return;
          }
          const pk = await withTimeout(
            adapter.connect(),
            CONNECT_TIMEOUT_MS,
            adapter.name +
              ' did not respond. Unlock the extension, click the ' +
              adapter.name +
              ' icon in the toolbar if a popup is blocked, then try again.'
          );
          settleResolve(preconnectedAdapter(adapter, pk));
        } catch (err) {
          setPickerBusy(false);
          if (btn) btn.classList.remove('wallet-picker-item--pending');
          showPickerStatus((err && err.message) || 'Connection failed.', true);
        }
      }

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          if (overlay.classList.contains('wallet-picker-modal--busy')) return;
          settleReject(new Error('Wallet selection cancelled.'));
          return;
        }
        const btn = e.target.closest('.wallet-picker-item');
        if (btn) {
          if (overlay.classList.contains('wallet-picker-modal--busy')) return;
          const id = btn.getAttribute('data-wallet-id');
          const adapter = adapters.find(function (a) {
            return a.id === id;
          });
          if (!adapter) {
            settleReject(new Error('Wallet not found.'));
            return;
          }
          if (adapter.kind === 'install') {
            adapter
              .connect()
              .then(function () {
                settleResolve(adapter);
              })
              .catch(function (err) {
                showPickerStatus((err && err.message) || 'Install the wallet, refresh, then connect again.', true);
              });
            return;
          }
          connectFromPicker(adapter, btn);
          return;
        }
        if (e.target.closest('.wallet-picker-manual-toggle')) {
          if (overlay.classList.contains('wallet-picker-modal--busy')) return;
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
          if (overlay.classList.contains('wallet-picker-modal--busy')) return;
          settleReject(new Error('Wallet selection cancelled.'));
        }
      });

      overlay.addEventListener('submit', function (e) {
        const form = e.target.closest('.wallet-picker-manual');
        if (!form) return;
        e.preventDefault();
        if (settled) return;

        const input = form.querySelector('.wallet-picker-manual-input');
        const submitBtn = form.querySelector('.wallet-picker-manual-submit');
        const address = input ? input.value.trim() : '';
        const errEl = form.querySelector('#wallet-picker-manual-error');
        if (errEl) {
          errEl.hidden = true;
          errEl.textContent = '';
        }
        if (input) input.classList.remove('wallet-picker-manual-input--error');

        try {
          assertValidSolanaAddress(address);
        } catch (err) {
          showManualError((err && err.message) || 'Invalid address.');
          return;
        }

        const originalLabel = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Connecting…';
        }

        // Resolve immediately with manual adapter; connect() validates (no freeze on CDN).
        settleResolve(manualAdapter(address));
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel || 'Use this address';
        }
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
      if (window.SolanaRpc && typeof SolanaRpc.currentUrl === 'function') {
        return SolanaRpc.currentUrl();
      }
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

    getAdapterKind: function () {
      return activeAdapter && activeAdapter.kind ? activeAdapter.kind : '';
    },

    isWatchOnly: function () {
      return !!(activeAdapter && activeAdapter.kind === 'manual');
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

    getConnection: async function (opts) {
      const web3 = await loadWeb3();
      const forceRotate = !!(opts && opts.rotate);
      const url =
        window.SolanaRpc && typeof SolanaRpc.currentUrl === 'function'
          ? forceRotate
            ? SolanaRpc.rotateUrl()
            : SolanaRpc.currentUrl()
          : cfg().rpcUrl;
      if (
        !connection ||
        forceRotate ||
        (connection._rpcEndpoint && connection._rpcEndpoint !== url)
      ) {
        connection = new web3.Connection(url, 'confirmed');
      }
      return connection;
    },

    async connect(preferredId) {
      const adapter = await pickAdapter(preferredId);
      activeAdapter = adapter;
      try {
        const pk = await withTimeout(
          adapter.connect(),
          CONNECT_TIMEOUT_MS,
          (adapter.name || 'Wallet') +
            ' did not respond within ' +
            Math.round(CONNECT_TIMEOUT_MS / 1000) +
            's. Unlock the extension and try again.'
        );
        publicKey = pk;
        providerName = slugify(adapter.name);
        emit();
        return publicKey.toBase58();
      } catch (err) {
        activeAdapter = null;
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
