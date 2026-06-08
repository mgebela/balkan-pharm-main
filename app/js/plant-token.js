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
      return chainCall(() => {
        const wallet = readWallet();
        if (!wallet.connected) {
          wallet.connected = true;
          wallet.address = wallet.address || mockAddress();
          writeWallet(wallet);
        }
        return wallet;
      }, 600);
    },

    disconnect() {
      return chainCall(() => {
        const wallet = readWallet();
        wallet.connected = false;
        writeWallet(wallet);
        return wallet;
      }, 200);
    },

    // Mint a new seed token into the wallet.
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
      }, 700);
    },

    // Advance a token to the next growth stage and mint the GROW reward.
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
      }, 800);
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

  let busy = false;

  function renderWalletPanel(wallet) {
    const el = document.getElementById('adopt-wallet');
    if (!el) return;
    if (!wallet.connected) {
      el.innerHTML =
        '<div class="adopt-wallet-card adopt-wallet-card--disconnected">' +
        '<div class="adopt-wallet-icon" aria-hidden="true">👛</div>' +
        '<div class="adopt-wallet-copy">' +
        '<h3>Connect your wallet</h3>' +
        '<p>Connect a (demo) wallet to import seeds and mint growth.</p>' +
        '</div>' +
        '<button type="button" class="btn btn-primary" id="adopt-connect-btn">Connect wallet</button>' +
        '</div>';
      return;
    }
    const seeds = wallet.tokens.length;
    const grown = wallet.tokens.filter((t) => t.stageIndex >= GROWTH_STAGES.length - 1).length;
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
        return (
          '<li class="adopt-hist-item">' +
          '<span class="adopt-hist-label">' + esc(label) + esc(amt) + '</span>' +
          '<span class="adopt-hist-meta"><time>' + esc(date) + '</time> · <code title="' + esc(h.tx) + '">' + esc(shortTx(h.tx)) + '</code></span>' +
          '</li>'
        );
      })
      .join('');

    return (
      '<article class="adopt-token-card' + (isMax ? ' adopt-token-card--grown' : '') + '" data-id="' + esc(token.id) + '">' +
      '<div class="adopt-token-head">' +
      '<span class="adopt-token-emoji" aria-hidden="true">' + stage.emoji + '</span>' +
      '<div class="adopt-token-titles">' +
      '<h4>' + esc(token.name) + '</h4>' +
      (token.strain ? '<p class="adopt-token-strain">' + esc(token.strain) + '</p>' : '') +
      '</div>' +
      '<span class="adopt-stage-badge">' + esc(stage.label) + '</span>' +
      '</div>' +
      (token.plantId ? '<p class="adopt-token-link">🔗 linked to a journal plant</p>' : '') +
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
      '<ul class="adopt-token-history" id="adopt-hist-' + esc(token.id) + '" hidden>' + history + '</ul>' +
      '</article>'
    );
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
    const wallet = readWallet();
    const seedSection = document.getElementById('adopt-seed-section');
    const gardenSection = document.getElementById('adopt-garden-section');
    renderWalletPanel(wallet);
    if (seedSection) seedSection.hidden = !wallet.connected;
    if (gardenSection) gardenSection.hidden = !wallet.connected;
    if (wallet.connected) {
      fillSeedPlantOptions();
      renderGarden(wallet);
    }
  }

  function flashError(err) {
    const msg = (err && err.message) || 'Something went wrong.';
    alert(msg);
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

      if (connectBtn) {
        if (busy) return;
        setBusy(true);
        connectBtn.textContent = 'Connecting…';
        try {
          await PlantToken.connect();
          render();
        } catch (err) {
          flashError(err);
        } finally {
          setBusy(false);
        }
        return;
      }

      if (disconnectBtn) {
        if (busy) return;
        setBusy(true);
        try {
          await PlantToken.disconnect();
          render();
        } catch (err) {
          flashError(err);
        } finally {
          setBusy(false);
        }
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
        const plantSel = document.getElementById('adopt-seed-plant');
        const name = nameEl ? nameEl.value.trim() : '';
        if (!name) return;
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
          await PlantToken.importSeed({ name, strain, plantId: plantId || null });
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
      bindEvents();
      render();
    },

    renderDashboard(container, onOpen) {
      if (!container) return;
      const wallet = readWallet();
      const maxStage = GROWTH_STAGES.length - 1;

      if (!wallet.connected) {
        container.innerHTML =
          '<div class="dashboard-adopt-empty">' +
          '<p>Connect a wallet to mint seeds and track plant growth as tokens.</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-adopt-open">Open Adopt a plant</button>' +
          '</div>';
      } else if (!wallet.tokens.length) {
        container.innerHTML =
          '<div class="dashboard-adopt-empty">' +
          '<p>Wallet connected · no plant tokens yet. Mint your first seed to start earning <strong>$GROW</strong>.</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-adopt-open">Mint a seed</button>' +
          '</div>';
      } else {
        const preview = wallet.tokens.slice(0, 3).map((token) => {
          const stage = GROWTH_STAGES[token.stageIndex] || GROWTH_STAGES[0];
          const pct = Math.round((token.stageIndex / maxStage) * 100);
          return (
            '<div class="dashboard-adopt-token">' +
            '<span class="dashboard-adopt-token-emoji" aria-hidden="true">' + stage.emoji + '</span>' +
            '<div class="dashboard-adopt-token-body">' +
            '<div class="dashboard-adopt-token-head">' +
            '<strong>' + esc(token.name) + '</strong>' +
            '<span class="adopt-stage-badge">' + esc(stage.label) + '</span>' +
            '</div>' +
            '<div class="adopt-progress"><div class="adopt-progress-bar" style="width:' + pct + '%"></div></div>' +
            '</div>' +
            '</div>'
          );
        }).join('');

        const more = wallet.tokens.length > 3 ? '<p class="dashboard-adopt-more">+' + (wallet.tokens.length - 3) + ' more in your garden</p>' : '';

        container.innerHTML =
          '<div class="dashboard-adopt-preview">' + preview + '</div>' +
          more +
          '<button type="button" class="btn btn-ghost" id="dashboard-adopt-open">Open token garden →</button>';
      }

      const openBtn = document.getElementById('dashboard-adopt-open');
      if (openBtn && typeof onOpen === 'function') openBtn.addEventListener('click', onOpen);
    },
  };
})();
