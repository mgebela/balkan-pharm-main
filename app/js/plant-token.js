/*
 * Adopt-a-plant: token / crypto layer (MOCK).
 *
 * This module simulates a wallet and an on-chain "grow" token using
 * localStorage. There is intentionally NO real blockchain here yet.
 *
 * The public API (window.PlantToken) is async on purpose so that the mock
 * internals can later be swapped for a real web3 provider (e.g. ethers.js /
 * a wallet connector + a smart contract) without changing the UI layer.
 *
 * To go on-chain later, replace the bodies of connect / importSeed /
 * mintGrowth / burnToken with real contract calls and keep the signatures.
 */
(function () {
  'use strict';

  const STORAGE_WALLET = 'dnevnik-live-wallet';
  const STORAGE_PLANTS = 'dnevnik-live-plants'; // shared with the main app (read-only here)

  // Lifecycle of a token. "seed" is the minted starting point; every later
  // stage is reached by minting growth, which also mints fungible GROW tokens.
  const GROWTH_STAGES = [
    { key: 'seed', label: 'Seed', emoji: '🌰', reward: 0 },
    { key: 'germination', label: 'Germination', emoji: '🌱', reward: 10 },
    { key: 'seedling', label: 'Seedling', emoji: '🌿', reward: 20 },
    { key: 'vegetative', label: 'Vegetative', emoji: '☘️', reward: 35 },
    { key: 'flowering', label: 'Flowering', emoji: '🌸', reward: 60 },
    { key: 'harvest', label: 'Harvest', emoji: '🌼', reward: 100 },
  ];

  // Map main-app plant stages (Croatian keys) onto token stages, so a token
  // linked to a real plant can suggest the matching growth level.
  const PLANT_STAGE_TO_TOKEN = {
    klijanje: 'germination',
    sadnica: 'seedling',
    vegetativna: 'vegetative',
    cvjetanje: 'flowering',
    susenje: 'harvest',
  };

  const listeners = new Set();

  function emptyWallet() {
    return { connected: false, address: '', growthBalance: 0, tokens: [] };
  }

  function readWallet() {
    try {
      const raw = localStorage.getItem(STORAGE_WALLET);
      if (!raw) return emptyWallet();
      const w = JSON.parse(raw);
      return Object.assign(emptyWallet(), w, {
        tokens: Array.isArray(w.tokens) ? w.tokens : [],
      });
    } catch {
      return emptyWallet();
    }
  }

  function writeWallet(wallet) {
    try {
      localStorage.setItem(STORAGE_WALLET, JSON.stringify(wallet));
    } catch {
      // ignore quota / serialization errors
    }
    listeners.forEach((fn) => {
      try {
        fn(wallet);
      } catch {
        // ignore listener errors
      }
    });
  }

  function readPlants() {
    try {
      const raw = localStorage.getItem(STORAGE_PLANTS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  // --- mock chain helpers -------------------------------------------------

  function randomHex(len) {
    let s = '';
    const chars = '0123456789abcdef';
    for (let i = 0; i < len; i += 1) s += chars[Math.floor(Math.random() * 16)];
    return s;
  }

  function mockAddress() {
    return '0x' + randomHex(40);
  }

  function mockTxHash() {
    return '0x' + randomHex(64);
  }

  function tokenId() {
    return 'tkn-' + Date.now().toString(36) + '-' + randomHex(6);
  }

  // Simulate network latency so the UI behaves like a real chain call.
  function chainCall(producer, delay) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(producer());
        } catch (err) {
          reject(err);
        }
      }, delay == null ? 450 : delay);
    });
  }

  // --- public API ---------------------------------------------------------

  const PlantToken = {
    GROWTH_STAGES,
    PLANT_STAGE_TO_TOKEN,

    stageByIndex(i) {
      return GROWTH_STAGES[Math.max(0, Math.min(GROWTH_STAGES.length - 1, i))];
    },

    maxStageIndex() {
      return GROWTH_STAGES.length - 1;
    },

    isConnected() {
      return readWallet().connected;
    },

    getWallet() {
      return readWallet();
    },

    getPlants() {
      return readPlants();
    },

    onChange(fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return () => listeners.delete(fn);
    },

    connect() {
      return (async function () {
        const SW = window.SolanaWallet;
        if (!SW) throw new Error('Solana wallet module failed to load. Refresh the page and try again.');
        const address = await SW.connect();
        const wallet = readWallet();
        wallet.connected = true;
        wallet.address = address;
        wallet.chain = (window.ChainConfig && window.ChainConfig.cluster) || 'devnet';
        wallet.provider = SW.getProviderName() || 'solana';
        wallet.linkError = '';
        writeWallet(wallet);
        if (window.WalletLink) {
          try {
            await WalletLink.linkWallet(address);
            wallet.linkError = '';
            writeWallet(wallet);
          } catch (linkErr) {
            console.warn('Wallet account link failed', linkErr);
            wallet.linkError =
              window.WalletLink.formatError ? WalletLink.formatError(linkErr) : linkErr.message || 'Account link failed.';
            writeWallet(wallet);
          }
        }
        return wallet;
      })();
    },

    disconnect() {
      return (async function () {
        const SW = window.SolanaWallet;
        if (SW) await SW.disconnect();
        const wallet = readWallet();
        wallet.connected = false;
        wallet.address = '';
        wallet.provider = '';
        writeWallet(wallet);
        return wallet;
      })();
    },

    // Mint a new seed token into the wallet. When signed in, also files a
    // real devnet mint request (seedMints queue) — see seed-chain.js.
    importSeed(opts) {
      const o = opts || {};
      return chainCall(() => {
        const wallet = readWallet();
        if (!wallet.connected) throw new Error('Wallet not connected.');
        const name = String(o.name || '').trim();
        if (!name) throw new Error('Seed name is required.');

        const now = Date.now();
        const tx = mockTxHash();
        const token = {
          id: tokenId(),
          name,
          strain: String(o.strain || '').trim(),
          batch: String(o.batch || '').trim(),
          plantId: o.plantId || null,
          stageIndex: 0,
          createdAt: now,
          history: [
            {
              ts: now,
              type: 'mint',
              stage: GROWTH_STAGES[0].key,
              amount: 0,
              tx,
            },
          ],
        };
        wallet.tokens.unshift(token);
        writeWallet(wallet);
        return { token, tx };
      }, 700).then(async (result) => {
        const SC = window.SeedChain;
        if (SC && SC.isEnabled()) {
          try {
            const requestId = await SC.requestSeedMint({
              name: result.token.name,
              strain: result.token.strain || result.token.name,
              batch: result.token.batch,
              plantId: result.token.plantId,
            });
            if (requestId) {
              const wallet = readWallet();
              const stored = wallet.tokens.find((t) => t.id === result.token.id);
              if (stored) {
                stored.mintRequestId = requestId;
                writeWallet(wallet);
              }
              result.mintRequestId = requestId;
            }
          } catch (err) {
            // The local token still exists; on-chain mint can be retried later.
            console.warn('Devnet seed mint request failed', err);
          }
        }
        return result;
      });
    },

    // Advance a token to the next growth stage and mint the GROW reward.
    // When the token has a real devnet Seed NFT, also files an on-chain
    // growth request (metadata update + $GROW SPL reward) — see seed-chain.js.
    mintGrowth(id) {
      return chainCall(() => {
        const wallet = readWallet();
        if (!wallet.connected) throw new Error('Wallet not connected.');
        const token = wallet.tokens.find((t) => t.id === id);
        if (!token) throw new Error('Token not found.');
        if (token.stageIndex >= GROWTH_STAGES.length - 1) {
          throw new Error('This plant is already fully grown.');
        }
        token.stageIndex += 1;
        const stage = GROWTH_STAGES[token.stageIndex];
        const tx = mockTxHash();
        wallet.growthBalance = Number(wallet.growthBalance || 0) + stage.reward;
        token.history.push({
          ts: Date.now(),
          type: 'growth',
          stage: stage.key,
          amount: stage.reward,
          tx,
        });
        writeWallet(wallet);
        return { token, reward: stage.reward, tx };
      }, 800).then(async (result) => {
        const SC = window.SeedChain;
        const token = result.token;
        const seedMint = SC && token.mintRequestId ? SC.getMint(token.mintRequestId) : null;
        if (SC && SC.isEnabled() && seedMint && seedMint.mintAddress) {
          try {
            const stage = GROWTH_STAGES[token.stageIndex];
            const requestId = await SC.requestGrowthMint({
              mintAddress: seedMint.mintAddress,
              seedMintRequestId: token.mintRequestId,
              stage: stage.key,
              name: token.name,
              strain: token.strain || token.name,
              batch: token.batch,
              plantId: token.plantId,
            });
            if (requestId) {
              const wallet = readWallet();
              const stored = wallet.tokens.find((t) => t.id === token.id);
              if (stored) {
                if (!stored.growthRequests) stored.growthRequests = {};
                stored.growthRequests[stage.key] = requestId;
                writeWallet(wallet);
              }
            }
          } catch (err) {
            console.warn('Devnet growth mint request failed', err);
          }
        }
        return result;
      });
    },

    // Burn (remove) a token from the wallet.
    burnToken(id) {
      return chainCall(() => {
        const wallet = readWallet();
        const before = wallet.tokens.length;
        wallet.tokens = wallet.tokens.filter((t) => t.id !== id);
        if (wallet.tokens.length !== before) writeWallet(wallet);
        return wallet;
      }, 300);
    },
  };

  window.PlantToken = PlantToken;

  // ========================================================================
  // Adopt-a-plant view (UI). Kept here so the whole feature lives in one
  // file and the large app.js only needs a single render() hook.
  // ========================================================================

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shortAddr(addr) {
    if (!addr) return '';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function shortTx(tx) {
    if (!tx) return '';
    return tx.slice(0, 10) + '…';
  }

  // --- Plant growth SVG (seed → harvest) ----------------------------------
  // Wallet-ready 48×48 pixel sprites (see plant-pixel-sprites.js).

  let growthPreviewStage = null;

  function buildPlantGrowSvg(stageIndex, options) {
    if (window.PlantPixelSprites && typeof window.PlantPixelSprites.renderStageSvg === 'function') {
      return window.PlantPixelSprites.renderStageSvg(stageIndex, options);
    }
    return '';
  }

  PlantToken.renderPlantSvg = buildPlantGrowSvg;

  function growthStepHint(stageIndex) {
    const stage = GROWTH_STAGES[stageIndex] || GROWTH_STAGES[0];
    if (stageIndex >= GROWTH_STAGES.length - 1) return 'Fully grown · harvest complete';
    const next = GROWTH_STAGES[stageIndex + 1];
    return 'Next mint → ' + next.label + ' (+' + next.reward + ' $GROW)';
  }

  function renderGrowthGuide(activeStageIndex) {
    const el = document.getElementById('adopt-growth-guide');
    if (!el) return;

    const fallback = activeStageIndex >= 0 ? activeStageIndex : 0;
    const preview =
      growthPreviewStage == null
        ? fallback
        : Math.max(0, Math.min(GROWTH_STAGES.length - 1, growthPreviewStage));
    const stageMeta = GROWTH_STAGES[preview];

    const stepperHtml = GROWTH_STAGES.map((s, i) => {
      const isPreview = i === preview;
      const isPast = activeStageIndex >= 0 && i < activeStageIndex;
      const cls =
        'adopt-growth-step' +
        (isPreview ? ' adopt-growth-step--active' : '') +
        (isPast ? ' adopt-growth-step--done' : '');
      const reward = i === 0 ? 'Seed' : '+' + s.reward;
      return (
        '<button type="button" class="' +
        cls +
        '" data-stage="' +
        i +
        '" aria-pressed="' +
        (isPreview ? 'true' : 'false') +
        '">' +
        '<span class="adopt-growth-step-num">' +
        (i + 1) +
        '</span>' +
        '<span class="adopt-growth-step-name">' +
        esc(s.label) +
        '</span>' +
        '<span class="adopt-growth-step-reward">' +
        esc(reward) +
        '</span>' +
        '</button>'
      );
    }).join('');

    el.innerHTML =
      '<div class="metric-panel metric-panel--adopt">' +
      '<header class="metric-panel-head"><h2 class="metric-panel-title">Growth lifecycle</h2></header>' +
      '<div class="adopt-growth-guide-inner">' +
      '<div class="adopt-growth-showcase">' +
      '<div class="adopt-growth-feature">' +
      buildPlantGrowSvg(preview, { hero: true, animate: true }) +
      '<div class="adopt-growth-feature-meta">' +
      '<span class="adopt-growth-feature-stage">' +
      esc(stageMeta.label) +
      '</span>' +
      '<span class="adopt-growth-feature-hint">' +
      esc(growthStepHint(preview)) +
      '</span>' +
      '</div>' +
      '</div>' +
      '<div class="adopt-growth-stepper" role="tablist" aria-label="Growth stages">' +
      stepperHtml +
      '</div>' +
      '</div>' +
      '</div></div>';
  }

  function networkLabel() {
    return (window.ChainConfig && window.ChainConfig.networkLabel) || 'Solana · devnet';
  }

  function devnetNotice() {
    return (
      (window.ChainConfig && window.ChainConfig.devnetNotice) ||
      'Connect a Solana wallet on devnet. Seed NFT minting and $GROW SPL rewards are still simulated locally until M2 on-chain deploy.'
    );
  }

  function explorerAddressUrl(address) {
    if (window.ChainConfig && typeof window.ChainConfig.explorerAddress === 'function') {
      return window.ChainConfig.explorerAddress(address);
    }
    return 'https://solscan.io/account/' + encodeURIComponent(address) + '?cluster=devnet';
  }

  function syncWalletFromSolana() {
    const SW = window.SolanaWallet;
    if (!SW || !SW.isConnected()) return readWallet();
    const wallet = readWallet();
    const address = SW.getPublicKey();
    if (!address) return wallet;
    wallet.connected = true;
    wallet.address = address;
    wallet.chain = (window.ChainConfig && window.ChainConfig.cluster) || 'devnet';
        wallet.provider = SW.getProviderName() || 'solana';
    writeWallet(wallet);
    return wallet;
  }

  let busy = false;

  function linkStatusHtml(wallet) {
    const WL = window.WalletLink;
    if (!WL) return '';
    const profile = WL.getProfile();
    const linked = profile.solanaPubkey === wallet.address;
    if (linked) {
      return '<p class="adopt-wallet-link-status adopt-wallet-link-status--ok">Account linked to this wallet</p>';
    }
    if (profile.solanaPubkey && profile.solanaPubkey !== wallet.address) {
      return (
        '<p class="adopt-wallet-link-status adopt-wallet-link-status--warn">Account linked to a different wallet (' +
        esc(shortAddr(profile.solanaPubkey)) +
        ')</p>'
      );
    }
    if (wallet.linkError) {
      return (
        '<p class="adopt-wallet-link-status adopt-wallet-link-status--warn">' +
        esc(wallet.linkError) +
        ' <button type="button" class="btn btn-ghost btn-sm wallet-link-btn">Link account</button></p>'
      );
    }
    return (
      '<p class="adopt-wallet-link-status">Wallet connected. ' +
      '<button type="button" class="btn btn-ghost btn-sm wallet-link-btn">Link account</button></p>'
    );
  }

  function renderWalletPanel(wallet) {
    const el = document.getElementById('adopt-wallet');
    if (!el) return;
    if (!wallet.connected) {
      el.innerHTML =
        '<div class="metric-panel metric-panel--inline">' +
        '<div class="adopt-wallet-connect">' +
        '<div class="adopt-wallet-copy">' +
        '<h3>Connect wallet</h3>' +
        '<p>' + esc(devnetNotice()) + '</p>' +
        '</div>' +
        '<button type="button" class="btn btn-primary" id="adopt-connect-btn">Connect wallet</button>' +
        '</div></div>';
      return;
    }
    const seeds = wallet.tokens.length;
    const grown = wallet.tokens.filter((t) => t.stageIndex >= GROWTH_STAGES.length - 1).length;
    const growing = seeds - grown;
    const growPct = seeds ? Math.round((grown / seeds) * 100) : 0;
    const M = window.MetricUI;

    const addrLink =
      wallet.address
        ? '<a class="adopt-wallet-explorer" href="' +
          esc(explorerAddressUrl(wallet.address)) +
          '" target="_blank" rel="noopener noreferrer" title="View on Solscan">Solscan ↗</a>'
        : '';

    if (M) {
      el.innerHTML =
        '<div class="metric-panel metric-panel--inline">' +
        '<div class="metric-cards metric-cards--wallet">' +
        M.card({
          label: 'Wallet address',
          value: esc(shortAddr(wallet.address)),
          meta: M.row('Network', esc(networkLabel()), 'metric-dot--teal'),
          modifier: 'teal',
        }) +
        M.card({
          label: '$GROW balance',
          value: Number(wallet.growthBalance || 0).toLocaleString('en-US'),
          meta:
            onchainGrowBalance != null
              ? M.row('On-chain', onchainGrowBalance.toLocaleString('en-US') + ' $GROW', 'metric-dot--amber')
              : M.row('Rewards', 'Simulated', 'metric-dot--amber'),
          donut: { pct: Math.min(100, Number(wallet.growthBalance || 0) / 2), color: '#f59e0b' },
          modifier: 'amber',
        }) +
        M.card({
          label: 'Plant tokens',
          value: String(seeds),
          meta: M.row('Growing', growing, 'metric-dot--teal') + M.row('Harvested', grown, 'metric-dot--blue'),
          donut: { pct: growPct, color: '#2dd4bf' },
          modifier: 'blue',
        }) +
        M.card({
          label: 'Growth progress',
          value: grown + ' / ' + seeds,
          meta: M.row('Complete', growPct + '%', 'metric-dot--violet'),
          donut: { pct: growPct, color: '#c79bff' },
          modifier: 'violet',
        }) +
        '</div>' +
        '<div class="adopt-wallet-actions">' +
        linkStatusHtml(wallet) +
        addrLink +
        '<button type="button" class="btn btn-ghost btn-sm" id="adopt-disconnect-btn">Disconnect</button>' +
        '</div></div>';
      return;
    }

    el.innerHTML =
      '<div class="adopt-wallet-card">' +
      '<div class="adopt-wallet-row">' +
      '<span class="adopt-wallet-dot" aria-hidden="true"></span>' +
      '<span class="adopt-wallet-addr" title="' + esc(wallet.address) + '">' + esc(shortAddr(wallet.address)) + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="adopt-disconnect-btn">Disconnect</button>' +
      '</div>' +
      '<div class="adopt-wallet-stats">' +
      '<div class="adopt-stat"><span class="adopt-stat-value">' + (Number(wallet.growthBalance || 0)) + '</span><span class="adopt-stat-label">$GROW balance</span></div>' +
      '<div class="adopt-stat"><span class="adopt-stat-value">' + seeds + '</span><span class="adopt-stat-label">Plant tokens</span></div>' +
      '<div class="adopt-stat"><span class="adopt-stat-value">' + grown + '</span><span class="adopt-stat-label">Fully grown</span></div>' +
      '</div>' +
      '</div>';
  }

  // --- On-chain $GROW balance (M3) -----------------------------------------
  // Once the $GROW mint is deployed and configured in chain-config.js, the
  // wallet's real devnet balance is shown next to the simulated one.

  let onchainGrowBalance = null;
  let onchainGrowFetchedFor = '';

  function refreshOnchainGrowBalance() {
    const SC = window.SeedChain;
    const cfg = window.ChainConfig || {};
    const wallet = readWallet();
    if (!SC || !cfg.growMint || !wallet.connected || !wallet.address) return;
    if (onchainGrowFetchedFor === wallet.address) return;
    onchainGrowFetchedFor = wallet.address;
    SC.fetchGrowBalance(wallet.address)
      .then(function (balance) {
        if (balance != null && balance !== onchainGrowBalance) {
          onchainGrowBalance = balance;
          render();
          renderGlobalWalletUI();
        }
      })
      .catch(function (err) {
        onchainGrowFetchedFor = '';
        console.warn('On-chain $GROW balance fetch failed', err);
      });
  }

  PlantToken.getOnchainGrowBalance = function () {
    return onchainGrowBalance;
  };

  PlantToken.refreshOnchainGrowBalance = function () {
    onchainGrowFetchedFor = '';
    refreshOnchainGrowBalance();
  };

  function progressPercent(stageIndex) {
    return Math.round((stageIndex / (GROWTH_STAGES.length - 1)) * 100);
  }

  function tokenCardHtml(token) {
    const stage = GROWTH_STAGES[token.stageIndex] || GROWTH_STAGES[0];
    const isMax = token.stageIndex >= GROWTH_STAGES.length - 1;
    const next = isMax ? null : GROWTH_STAGES[token.stageIndex + 1];
    const earned = (token.history || [])
      .filter((h) => h.type === 'growth')
      .reduce((sum, h) => sum + Number(h.amount || 0), 0);
    const pct = progressPercent(token.stageIndex);

    const dots = GROWTH_STAGES.map((s, i) => {
      const cls = i < token.stageIndex ? 'done' : i === token.stageIndex ? 'current' : 'todo';
      return '<span class="adopt-stage-dot adopt-stage-dot--' + cls + '" title="' + esc(s.label) + '"></span>';
    }).join('');

    const history = (token.history || [])
      .slice()
      .reverse()
      .map((h) => {
        const date = new Date(h.ts).toLocaleString('en-GB');
        const label = h.type === 'mint' ? 'Seed minted' : 'Grew to ' + (GROWTH_STAGES.find((s) => s.key === h.stage) || {}).label;
        const amt = h.amount ? ' · +' + h.amount + ' $GROW' : '';
        const real = realTxForHistoryEntry(token, h);
        const txHtml = real
          ? '<a href="' + esc(real.url) + '" target="_blank" rel="noopener noreferrer"><code title="' + esc(real.sig) + '">' + esc(shortTx(real.sig)) + '</code></a> · devnet'
          : '<code title="' + esc(h.tx) + '">' + esc(shortTx(h.tx)) + '</code>';
        return (
          '<li class="adopt-hist-item">' +
          '<span class="adopt-hist-label">' + esc(label) + esc(amt) + '</span>' +
          '<span class="adopt-hist-meta"><time>' + esc(date) + '</time> · ' + txHtml + '</span>' +
          '</li>'
        );
      })
      .join('');

    return (
      '<article class="adopt-token-card' + (isMax ? ' adopt-token-card--grown' : '') + '" data-id="' + esc(token.id) + '" data-stage="' + token.stageIndex + '">' +
      '<div class="adopt-token-banner">' +
      buildPlantGrowSvg(token.stageIndex, { compact: true, noBg: true }) +
      '<span class="adopt-stage-badge adopt-token-banner-badge">' + esc(stage.label) + '</span>' +
      '</div>' +
      '<div class="adopt-token-body">' +
      '<div class="adopt-token-head">' +
      '<div class="adopt-token-titles">' +
      '<h4>' + esc(token.name) + '</h4>' +
      (token.strain ? '<p class="adopt-token-strain">' + esc(token.strain) + '</p>' : '') +
      '</div>' +
      '</div>' +
      (token.plantId ? '<p class="adopt-token-link">🔗 linked to a journal plant</p>' : '') +
      chainMintHtml(token) +
      '<div class="adopt-progress"><div class="adopt-progress-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="adopt-stage-track">' + dots + '</div>' +
      '<div class="adopt-token-stats">' +
      '<span>Earned: <strong>' + earned + ' $GROW</strong></span>' +
      '<span class="adopt-token-id" title="' + esc(token.id) + '">#' + esc(token.id.slice(-6)) + '</span>' +
      '</div>' +
      '<div class="adopt-token-actions">' +
      (isMax
        ? '<button type="button" class="btn btn-ghost btn-sm" disabled>🌼 Fully grown</button>'
        : '<button type="button" class="btn btn-primary btn-sm adopt-mint-btn" data-id="' + esc(token.id) + '">⛏ Mint growth → ' + esc(next.label) + ' (+' + next.reward + ')</button>') +
      '<button type="button" class="btn btn-ghost btn-sm adopt-history-btn" data-id="' + esc(token.id) + '">History</button>' +
      '<button type="button" class="btn btn-ghost btn-sm adopt-burn-btn" data-id="' + esc(token.id) + '">Burn</button>' +
      '</div>' +
      '</div>' +
      '<ul class="adopt-token-history" id="adopt-hist-' + esc(token.id) + '" hidden>' + history + '</ul>' +
      '</article>'
    );
  }

  // Real devnet signature for a history entry, when the on-chain queue
  // (seedMints / growthMints) has processed it.
  function realTxForHistoryEntry(token, h) {
    const SC = window.SeedChain;
    if (!SC) return null;
    let sig = '';
    if (h.type === 'mint' && token.mintRequestId) {
      const mint = SC.getMint(token.mintRequestId);
      sig = mint && mint.signature ? mint.signature : '';
    } else if (h.type === 'growth' && token.growthRequests && token.growthRequests[h.stage]) {
      const growth = SC.getGrowth(token.growthRequests[h.stage]);
      sig = growth && growth.signature ? growth.signature : '';
    }
    if (!sig) return null;
    const url =
      window.ChainConfig && window.ChainConfig.explorerTx
        ? ChainConfig.explorerTx(sig)
        : 'https://solscan.io/tx/' + encodeURIComponent(sig) + '?cluster=devnet';
    return { sig, url };
  }

  // On-chain (devnet) mint status for a token, from the seedMints queue.
  function chainMintHtml(token) {
    const SC = window.SeedChain;
    if (!SC || !token.mintRequestId) return '';
    const mint = SC.getMint(token.mintRequestId);
    if (!mint) {
      return '<p class="adopt-token-chain adopt-token-chain--pending">⛓ Devnet mint requested…</p>';
    }
    if (mint.status === 'minted' && mint.mintAddress) {
      const explorer =
        window.ChainConfig && window.ChainConfig.explorerAddress
          ? ChainConfig.explorerAddress(mint.mintAddress)
          : 'https://solscan.io/account/' + encodeURIComponent(mint.mintAddress) + '?cluster=devnet';
      return (
        '<p class="adopt-token-chain adopt-token-chain--minted">⛓ Minted on devnet: ' +
        '<a href="' + esc(explorer) + '" target="_blank" rel="noopener noreferrer"><code>' +
        esc(shortAddr(mint.mintAddress)) + '</code></a>' +
        (mint.metadataUri
          ? ' · <a href="' + esc(mint.metadataUri) + '" target="_blank" rel="noopener noreferrer">metadata</a>'
          : '') +
        '</p>'
      );
    }
    if (mint.status === 'failed') {
      return '<p class="adopt-token-chain adopt-token-chain--failed">⛓ Devnet mint failed — it will be retried.</p>';
    }
    return '<p class="adopt-token-chain adopt-token-chain--pending">⛓ Devnet mint pending…</p>';
  }

  function renderGarden(wallet) {
    const grid = document.getElementById('adopt-token-grid');
    if (!grid) return;
    if (!wallet.tokens.length) {
      grid.innerHTML = '<div class="empty-state">No tokens yet. Mint a seed above to start growing.</div>';
      return;
    }
    grid.innerHTML = wallet.tokens.map(tokenCardHtml).join('');
  }

  function fillSeedPlantOptions() {
    const sel = document.getElementById('adopt-seed-plant');
    if (!sel) return;
    const plants = readPlants();
    const current = sel.value;
    sel.innerHTML =
      '<option value="">— none —</option>' +
      plants
        .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name || 'Plant') + '</option>')
        .join('');
    if (current) sel.value = current;
  }

  function setBusy(state) {
    busy = state;
    const view = document.getElementById('view-adopt');
    if (view) view.classList.toggle('adopt-busy', state);
  }

  function render() {
    syncWalletFromSolana();
    refreshOnchainGrowBalance();
    const wallet = readWallet();
    const seedSection = document.getElementById('adopt-seed-section');
    const gardenSection = document.getElementById('adopt-garden-section');
    const highlightStage =
      wallet.tokens.length > 0
        ? Math.max.apply(null, wallet.tokens.map((t) => t.stageIndex))
        : -1;
    if (growthPreviewStage != null && highlightStage >= 0 && growthPreviewStage > highlightStage) {
      growthPreviewStage = highlightStage;
    }
    renderGrowthGuide(highlightStage);
    renderWalletPanel(wallet);
    if (seedSection) seedSection.hidden = !wallet.connected;
    if (gardenSection) gardenSection.hidden = !wallet.connected;
    if (wallet.connected) {
      fillSeedPlantOptions();
      renderGarden(wallet);
    }
  }

  function formatWalletError(err) {
    if (window.WalletLink && typeof window.WalletLink.formatError === 'function') {
      return WalletLink.formatError(err);
    }
    if (!err) return 'Something went wrong.';
    if (typeof err === 'string') return err;
    return err.message || 'Something went wrong.';
  }

  function flashError(err) {
    const msg = formatWalletError(err);
    console.error('Wallet UI error', err);
    if (err && err.code === 'WALLET_NOT_FOUND' && window.ChainConfig && window.ChainConfig.walletDownloadUrl) {
      const hint =
        msg +
        '\n\nIf a wallet is installed, unlock it, allow dnevnik.live, then refresh this page.';
      if (confirm(hint + '\n\nBrowse Solana wallets?')) {
        window.open(window.ChainConfig.walletDownloadUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    alert(msg);
  }

  async function handleWalletLink(btn) {
    if (busy) return;
    const wallet = readWallet();
    if (!wallet.connected || !wallet.address) {
      flashError(new Error('Connect a wallet before linking your account.'));
      return;
    }
    setBusy(true);
    const original = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Linking…';
    try {
      if (window.WalletLink) {
        await WalletLink.linkWallet(wallet.address, { force: false });
        wallet.linkError = '';
        writeWallet(wallet);
      }
      render();
      renderGlobalWalletUI();
    } catch (err) {
      flashError(err);
    } finally {
      if (btn) btn.textContent = original || 'Link account';
      setBusy(false);
    }
  }

  async function handleWalletConnect(btn) {
    if (busy) return;
    setBusy(true);
    const original = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Connecting…';
    try {
      const wallet = await PlantToken.connect();
      render();
      renderGlobalWalletUI();
      if (wallet && wallet.linkError) {
        alert('Wallet connected, but account link failed:\n\n' + wallet.linkError + '\n\nUse "Link account" to try again.');
      }
    } catch (err) {
      flashError(err);
    } finally {
      if (btn) btn.textContent = original || 'Connect wallet';
      setBusy(false);
    }
  }

  async function handleWalletDisconnect(btn) {
    if (busy) return;
    setBusy(true);
    try {
      await PlantToken.disconnect();
      render();
      renderGlobalWalletUI();
    } catch (err) {
      flashError(err);
    } finally {
      setBusy(false);
    }
  }

  function isWatchOnlyProvider(provider) {
    return provider === 'watch-only' || provider === 'manual';
  }

  function walletLinkBadgeHtml() {
    const WL = window.WalletLink;
    if (!WL) return '';
    const profile = WL.getProfile();
    const wallet = readWallet();
    const watchBadge =
      wallet.connected && isWatchOnlyProvider(wallet.provider)
        ? '<span class="wallet-link-badge wallet-link-badge--muted">Watch-only</span>'
        : '';
    if (!profile.solanaPubkey) {
      return (
        watchBadge +
        '<span class="wallet-link-badge wallet-link-badge--muted">Not linked</span>' +
        '<button type="button" class="btn btn-ghost btn-sm wallet-link-btn">Link account</button>'
      );
    }
    const linkedUnverified = isWatchOnlyProvider(profile.walletProvider);
    const linkedLabel = linkedUnverified ? 'Linked · unverified' : 'Account linked';
    if (wallet.connected && wallet.address === profile.solanaPubkey) {
      return watchBadge + '<span class="wallet-link-badge wallet-link-badge--ok">' + linkedLabel + '</span>';
    }
    return watchBadge + '<span class="wallet-link-badge wallet-link-badge--ok">Linked · ' + esc(shortAddr(profile.solanaPubkey)) + '</span>';
  }

  function walletControlsHtml(variant) {
    syncWalletFromSolana();
    const wallet = readWallet();
    const compact = variant === 'compact';

    if (!wallet.connected) {
      if (compact) {
        return (
          '<div class="wallet-controls wallet-controls--compact">' +
          '<span class="wallet-controls-label">Solana</span>' +
          '<button type="button" class="btn btn-primary btn-sm wallet-connect-btn">Connect wallet</button>' +
          '</div>'
        );
      }
      return (
        '<div class="wallet-controls wallet-controls--panel">' +
        '<div class="wallet-controls-copy">' +
        '<h3>Connect wallet</h3>' +
        '<p>' + esc(devnetNotice()) + '</p>' +
        walletLinkBadgeHtml() +
        '</div>' +
        '<button type="button" class="btn btn-primary wallet-connect-btn">Connect wallet</button>' +
        '</div>'
      );
    }

    const explorer =
      wallet.address
        ? '<a class="adopt-wallet-explorer wallet-explorer-link" href="' +
          esc(explorerAddressUrl(wallet.address)) +
          '" target="_blank" rel="noopener noreferrer" title="View on Solscan">Solscan ↗</a>'
        : '';

    if (compact) {
      return (
        '<div class="wallet-controls wallet-controls--compact wallet-controls--connected">' +
        '<span class="wallet-controls-addr" title="' + esc(wallet.address) + '">' + esc(shortAddr(wallet.address)) + '</span>' +
        walletLinkBadgeHtml() +
        explorer +
        '<button type="button" class="btn btn-ghost btn-sm wallet-disconnect-btn">Disconnect</button>' +
        '</div>'
      );
    }

    return (
      '<div class="wallet-controls wallet-controls--panel wallet-controls--connected">' +
      '<div class="wallet-controls-copy">' +
      '<h3>Solana wallet</h3>' +
      '<p class="wallet-controls-addr" title="' + esc(wallet.address) + '">' + esc(wallet.address) + '</p>' +
      '<p class="wallet-controls-meta">Network: ' + esc(networkLabel()) + '</p>' +
      walletLinkBadgeHtml() +
      linkStatusHtml(wallet) +
      '</div>' +
      '<div class="wallet-controls-actions">' +
      explorer +
      '<button type="button" class="btn btn-ghost wallet-disconnect-btn">Disconnect wallet</button>' +
      '</div></div>'
    );
  }

  function renderGlobalWalletUI() {
    const headerBar = document.getElementById('app-wallet-bar');
    if (headerBar) headerBar.innerHTML = walletControlsHtml('compact');

    const adminPanel = document.getElementById('admin-wallet-panel');
    if (adminPanel) adminPanel.innerHTML = walletControlsHtml('panel');
  }

  function bindGlobalWalletControls() {
    if (document.body.dataset.walletBound === '1') return;
    document.body.dataset.walletBound = '1';

    document.addEventListener('click', async function (e) {
      const connectBtn = e.target.closest('.wallet-connect-btn');
      const disconnectBtn = e.target.closest('.wallet-disconnect-btn');
      const linkBtn = e.target.closest('.wallet-link-btn');
      if (!connectBtn && !disconnectBtn && !linkBtn) return;
      if (connectBtn && connectBtn.id === 'adopt-connect-btn') return;
      if (disconnectBtn && disconnectBtn.id === 'adopt-disconnect-btn') return;

      e.preventDefault();
      if (connectBtn) {
        await handleWalletConnect(connectBtn);
        return;
      }
      if (disconnectBtn) {
        await handleWalletDisconnect(disconnectBtn);
        return;
      }
      if (linkBtn) {
        await handleWalletLink(linkBtn);
      }
    });
  }

  function bindEvents() {
    const view = document.getElementById('view-adopt');
    if (!view || view.dataset.bound === '1') return;
    view.dataset.bound = '1';

    // Delegated clicks for everything that is re-rendered.
    view.addEventListener('click', async (e) => {
      const connectBtn = e.target.closest('#adopt-connect-btn');
      const disconnectBtn = e.target.closest('#adopt-disconnect-btn');
      const mintBtn = e.target.closest('.adopt-mint-btn');
      const histBtn = e.target.closest('.adopt-history-btn');
      const burnBtn = e.target.closest('.adopt-burn-btn');
      const stepBtn = e.target.closest('.adopt-growth-step');

      if (stepBtn) {
        growthPreviewStage = Number(stepBtn.dataset.stage);
        const wallet = readWallet();
        const highlight =
          wallet.tokens.length > 0
            ? Math.max.apply(null, wallet.tokens.map((t) => t.stageIndex))
            : -1;
        renderGrowthGuide(highlight);
        return;
      }

      if (connectBtn) {
        await handleWalletConnect(connectBtn);
        return;
      }

      if (disconnectBtn) {
        await handleWalletDisconnect(disconnectBtn);
        return;
      }

      if (mintBtn) {
        if (busy) return;
        const id = mintBtn.dataset.id;
        setBusy(true);
        const original = mintBtn.textContent;
        mintBtn.textContent = 'Minting…';
        try {
          await PlantToken.mintGrowth(id);
          render();
        } catch (err) {
          flashError(err);
          mintBtn.textContent = original;
        } finally {
          setBusy(false);
        }
        return;
      }

      if (histBtn) {
        const id = histBtn.dataset.id;
        const list = document.getElementById('adopt-hist-' + id);
        if (list) list.hidden = !list.hidden;
        return;
      }

      if (burnBtn) {
        if (busy) return;
        const id = burnBtn.dataset.id;
        if (!confirm('Burn this token? This cannot be undone.')) return;
        setBusy(true);
        try {
          await PlantToken.burnToken(id);
          render();
        } catch (err) {
          flashError(err);
        } finally {
          setBusy(false);
        }
        return;
      }
    });

    const seedForm = document.getElementById('adopt-seed-form');
    if (seedForm) {
      seedForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const nameEl = document.getElementById('adopt-seed-name');
        const batchEl = document.getElementById('adopt-seed-batch');
        const plantSel = document.getElementById('adopt-seed-plant');
        const name = nameEl ? nameEl.value.trim() : '';
        if (!name) return;
        const batch = batchEl ? batchEl.value.trim() : '';
        let plantId = plantSel ? plantSel.value : '';
        let strain = '';
        if (plantId) {
          const plant = readPlants().find((p) => p.id === plantId);
          if (plant) strain = plant.strain || '';
        }
        const submitBtn = seedForm.querySelector('button[type="submit"]');
        setBusy(true);
        if (submitBtn) submitBtn.textContent = 'Minting…';
        try {
          await PlantToken.importSeed({ name, strain, batch, plantId: plantId || null });
          seedForm.reset();
          render();
        } catch (err) {
          flashError(err);
        } finally {
          if (submitBtn) submitBtn.textContent = '🌰 Mint seed token';
          setBusy(false);
        }
      });
    }
  }

  window.AdoptPlant = {
    render() {
      bindGlobalWalletControls();
      bindEvents();
      const SW = window.SolanaWallet;
      if (SW && typeof SW.tryRestore === 'function') {
        SW.tryRestore()
          .then(async function () {
            syncWalletFromSolana();
            const w = readWallet();
            if (w.connected && window.WalletLink) {
              try {
                await WalletLink.loadProfile();
                const profile = WalletLink.getProfile();
                if (!profile.solanaPubkey || profile.solanaPubkey !== w.address) {
                  await WalletLink.linkWallet(w.address);
                }
              } catch (err) {
                console.warn('Wallet link restore', err);
              }
            }
            render();
            renderGlobalWalletUI();
          })
          .catch(function () {
            render();
            renderGlobalWalletUI();
          });
        return;
      }
      render();
      renderGlobalWalletUI();
    },

    renderGlobalWalletUI: renderGlobalWalletUI,

    renderDashboard(container, onOpen) {
      if (!container) return;
      syncWalletFromSolana();
      const wallet = readWallet();
      const maxStage = GROWTH_STAGES.length - 1;
      const M = window.MetricUI;

      if (!wallet.connected) {
        container.innerHTML =
          '<div class="metric-panel metric-panel--adopt">' +
          '<header class="metric-panel-head"><h2 class="metric-panel-title">Adopt a plant</h2></header>' +
          '<div class="dashboard-adopt-panel">' +
          '<div class="dashboard-adopt-visual">' +
          buildPlantGrowSvg(0, { hero: true, noBg: true }) +
          '</div>' +
          '<div class="dashboard-adopt-copy">' +
          '<p>' + esc(devnetNotice()) + '</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-adopt-open">Open Adopt a plant</button>' +
          '<button type="button" class="btn btn-ghost wallet-connect-btn">Connect wallet</button>' +
          '</div></div></div>';
      } else if (!wallet.tokens.length) {
        container.innerHTML =
          '<div class="metric-panel metric-panel--adopt">' +
          '<header class="metric-panel-head"><h2 class="metric-panel-title">Adopt a plant</h2></header>' +
          (M
            ? '<div class="metric-cards metric-cards--compact">' +
              M.card({
                label: '$GROW balance',
                value: Number(wallet.growthBalance || 0).toLocaleString('en-US'),
                meta: M.row('Wallet', esc(shortAddr(wallet.address)), 'metric-dot--teal'),
                donut: { pct: 0, color: '#f59e0b' },
                modifier: 'amber',
              }) +
              M.card({
                label: 'Plant tokens',
                value: '0',
                meta: M.row('Next step', 'Mint a seed', 'metric-dot--blue'),
                modifier: 'blue',
              }) +
              '</div>'
            : '') +
          '<div class="dashboard-adopt-panel">' +
          '<div class="dashboard-adopt-visual">' +
          buildPlantGrowSvg(0, { hero: true, noBg: true }) +
          '</div>' +
          '<div class="dashboard-adopt-copy">' +
          '<p>Mint your first seed to start the growth cycle and earn rewards at each stage.</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-adopt-open">Mint a seed</button>' +
          '</div></div></div>';
      } else {
        const top = wallet.tokens.reduce((best, t) => (t.stageIndex > best.stageIndex ? t : best), wallet.tokens[0]);
        const stage = GROWTH_STAGES[top.stageIndex] || GROWTH_STAGES[0];
        const pct = Math.round((top.stageIndex / maxStage) * 100);
        const growing = wallet.tokens.filter((t) => t.stageIndex < maxStage).length;

        const preview = wallet.tokens.slice(0, 3).map((token) => {
          const tStage = GROWTH_STAGES[token.stageIndex] || GROWTH_STAGES[0];
          const tPct = Math.round((token.stageIndex / maxStage) * 100);
          return (
            '<div class="dashboard-adopt-token">' +
            '<div class="dashboard-adopt-token-visual">' +
            buildPlantGrowSvg(token.stageIndex, { compact: true, noBg: true }) +
            '</div>' +
            '<div class="dashboard-adopt-token-body">' +
            '<div class="dashboard-adopt-token-head">' +
            '<strong>' + esc(token.name) + '</strong>' +
            '<span class="adopt-stage-badge">' + esc(tStage.label) + '</span>' +
            '</div>' +
            '<div class="adopt-progress"><div class="adopt-progress-bar" style="width:' + tPct + '%"></div></div>' +
            '</div></div>'
          );
        }).join('');

        const more =
          wallet.tokens.length > 3
            ? '<p class="dashboard-adopt-more">+' + (wallet.tokens.length - 3) + ' more in your garden</p>'
            : '';

        container.innerHTML =
          '<div class="metric-panel metric-panel--adopt">' +
          '<header class="metric-panel-head"><h2 class="metric-panel-title">Adopt a plant · Token garden</h2></header>' +
          (M
            ? '<div class="metric-cards metric-cards--compact">' +
              M.card({
                label: '$GROW balance',
                value: Number(wallet.growthBalance || 0).toLocaleString('en-US'),
                meta: M.row('Top plant', esc(top.name), 'metric-dot--amber'),
                donut: { pct: Math.min(100, Number(wallet.growthBalance || 0) / 2), color: '#f59e0b' },
                modifier: 'amber',
              }) +
              M.card({
                label: 'Plant tokens',
                value: String(wallet.tokens.length),
                meta: M.row('Growing', growing, 'metric-dot--teal'),
                donut: { pct: Math.round((growing / wallet.tokens.length) * 100), color: '#2dd4bf' },
                modifier: 'teal',
              }) +
              M.card({
                label: 'Lead grow',
                value: pct + '%',
                meta: M.row(esc(stage.label), esc(top.strain || '—'), 'metric-dot--violet'),
                donut: { pct: pct, color: '#c79bff' },
                modifier: 'violet',
              }) +
              '</div>'
            : '') +
          '<div class="dashboard-adopt-panel dashboard-adopt-panel--active">' +
          '<div class="dashboard-adopt-visual">' +
          buildPlantGrowSvg(top.stageIndex, { hero: true, noBg: true }) +
          '<div class="dashboard-adopt-feature-meta">' +
          '<strong>' + esc(top.name) + '</strong>' +
          '<span>' + esc(stage.label) + ' · ' + pct + '% grown</span>' +
          '</div></div>' +
          '<div class="dashboard-adopt-preview">' + preview + '</div>' +
          more +
          '<button type="button" class="btn btn-ghost" id="dashboard-adopt-open">Open token garden →</button>' +
          '</div></div>';
      }

      const openBtn = document.getElementById('dashboard-adopt-open');
      if (openBtn && typeof onOpen === 'function') openBtn.addEventListener('click', onOpen);
      renderGlobalWalletUI();
    },
  };

  bindGlobalWalletControls();
  PlantToken.onChange(renderGlobalWalletUI);
  if (window.WalletLink && typeof window.WalletLink.onChange === 'function') {
    window.WalletLink.onChange(renderGlobalWalletUI);
  }
  if (window.SeedChain && typeof window.SeedChain.onChange === 'function') {
    // Re-render token cards when devnet mint results land in Firestore.
    window.SeedChain.onChange(function () {
      render();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderGlobalWalletUI);
  } else {
    renderGlobalWalletUI();
  }
})();
