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

  // --- Plant growth SVG (seed → harvest) ----------------------------------
  // Pixel-art hemp plant in a terracotta pot — one illustration per stage.

  let growthPreviewStage = null;

  function buildPlantGrowSvg(stageIndex, options) {
    const opts = options || {};
    const stage = Math.max(0, Math.min(GROWTH_STAGES.length - 1, Number(stageIndex) || 0));
    const hero = !!opts.hero;
    const compact = !!opts.compact;
    const animate = !!opts.animate;
    const noBg = !!opts.noBg;
    const uid = 'pg' + Math.random().toString(36).slice(2, 8);

    function px(x, y, w, h, fill, stroke) {
      const s = stroke ? ' stroke="' + stroke + '" stroke-width="1"' : '';
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"' + s + '/>';
    }

    function fanLeaf(cx, cy, scale, rot, tone) {
      const s = scale;
      const fill = tone === 'light' ? '#8fd46a' : tone === 'mid' ? '#5cb848' : '#2f7a3a';
      const stroke = '#1a3d24';
      const d =
        'M' + cx + ' ' + cy +
        ' L' + (cx - 9 * s) + ' ' + (cy - 3 * s) +
        ' L' + (cx - 11 * s) + ' ' + (cy - 11 * s) +
        ' L' + (cx - 5 * s) + ' ' + (cy - 16 * s) +
        ' L' + cx + ' ' + (cy - 24 * s) +
        ' L' + (cx + 5 * s) + ' ' + (cy - 16 * s) +
        ' L' + (cx + 11 * s) + ' ' + (cy - 11 * s) +
        ' L' + (cx + 9 * s) + ' ' + (cy - 3 * s) + ' Z';
      return (
        '<path class="grow-leaf" d="' + d + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="0.9" stroke-linejoin="round"' +
        (rot ? ' transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')"' : '') +
        '/>'
      );
    }

    function leafPair(y, scale, spread) {
      const sp = spread || 0;
      return fanLeaf(60 - sp, y, scale, -18, 'dark') + fanLeaf(60 + sp, y, scale, 18, 'dark');
    }

    function potAndSoil() {
      return (
        '<g class="grow-pot-group">' +
        px(34, 142, 52, 6, '#a85a2a') +
        px(30, 148, 60, 22, '#c46a32', '#8b4513') +
        px(34, 148, 8, 22, '#e08848') +
        px(78, 148, 8, 22, '#7a3e1c') +
        px(28, 140, 64, 6, '#d4844a', '#8b4513') +
        px(32, 134, 56, 8, '#3d2914') +
        px(34, 136, 52, 4, '#5c3d28') +
        '</g>'
      );
    }

    function seedBody() {
      return (
        '<g class="grow-seed-group">' +
        '<ellipse class="grow-seed" cx="60" cy="138" rx="5" ry="3.2" fill="#8b5a2b" stroke="#c49a6c" stroke-width="0.8"/>' +
        px(57, 136, 4, 2, '#d4a574') +
        '</g>'
      );
    }

    function stagePlant() {
      switch (stage) {
        case 0:
          return seedBody();
        case 1:
          return (
            seedBody() +
            '<path class="grow-sprout" d="M60 136 Q58 128 62 122 Q64 118 60 114" fill="none" stroke="#6ecf4a" stroke-width="2.5" stroke-linecap="round"/>' +
            fanLeaf(60, 114, 0.42, 0, 'light')
          );
        case 2:
          return (
            '<line class="grow-stem" x1="60" y1="134" x2="60" y2="108" stroke="#3d8f45" stroke-width="2.5" stroke-linecap="round"/>' +
            '<ellipse class="grow-cotyledon" cx="54" cy="110" rx="5" ry="3" fill="#6ecf4a" stroke="#2f7a3a" stroke-width="0.7" transform="rotate(-25 54 110)"/>' +
            '<ellipse class="grow-cotyledon" cx="66" cy="110" rx="5" ry="3" fill="#6ecf4a" stroke="#2f7a3a" stroke-width="0.7" transform="rotate(25 66 110)"/>' +
            fanLeaf(60, 104, 0.55, 0, 'mid')
          );
        case 3:
          return (
            '<line class="grow-stem" x1="60" y1="134" x2="60" y2="72" stroke="#3d8f45" stroke-width="3" stroke-linecap="round"/>' +
            leafPair(118, 0.72, 2) +
            leafPair(100, 0.82, 1) +
            leafPair(84, 0.9, 0) +
            fanLeaf(60, 74, 0.65, 0, 'mid')
          );
        case 4:
          return (
            '<line class="grow-stem" x1="60" y1="134" x2="60" y2="58" stroke="#3d8f45" stroke-width="3" stroke-linecap="round"/>' +
            leafPair(118, 0.78, 3) +
            leafPair(102, 0.88, 2) +
            leafPair(86, 0.95, 1) +
            '<g class="grow-bud">' +
            fanLeaf(60, 68, 0.7, 0, 'mid') +
            fanLeaf(52, 58, 0.55, -12, 'light') +
            fanLeaf(68, 58, 0.55, 12, 'light') +
            fanLeaf(60, 48, 0.62, 0, 'light') +
            px(54, 42, 12, 10, '#b8e86a', '#6ba83a') +
            px(56, 38, 8, 6, '#d4f080') +
            '</g>'
          );
        case 5:
        default:
          return (
            '<line class="grow-stem" x1="60" y1="134" x2="60" y2="52" stroke="#2dd4bf" stroke-width="3" stroke-linecap="round"/>' +
            leafPair(118, 0.8, 3) +
            leafPair(100, 0.9, 2) +
            leafPair(82, 0.98, 1) +
            '<g class="grow-harvest-cola">' +
            fanLeaf(48, 62, 0.6, -14, 'mid') +
            fanLeaf(72, 62, 0.6, 14, 'mid') +
            fanLeaf(60, 54, 0.72, 0, 'light') +
            '</g>' +
            '<g class="grow-flower" transform="translate(60,42)">' +
            '<ellipse class="grow-petal" cx="0" cy="-8" rx="3.2" ry="6" fill="rgba(45,212,191,0.65)" stroke="#2dd4bf" stroke-width="0.6" transform="rotate(0)"/>' +
            '<ellipse class="grow-petal" cx="0" cy="-8" rx="3.2" ry="6" fill="rgba(45,212,191,0.65)" stroke="#2dd4bf" stroke-width="0.6" transform="rotate(60)"/>' +
            '<ellipse class="grow-petal" cx="0" cy="-8" rx="3.2" ry="6" fill="rgba(45,212,191,0.65)" stroke="#2dd4bf" stroke-width="0.6" transform="rotate(120)"/>' +
            '<ellipse class="grow-petal" cx="0" cy="-8" rx="3.2" ry="6" fill="rgba(45,212,191,0.65)" stroke="#2dd4bf" stroke-width="0.6" transform="rotate(180)"/>' +
            '<ellipse class="grow-petal" cx="0" cy="-8" rx="3.2" ry="6" fill="rgba(45,212,191,0.65)" stroke="#2dd4bf" stroke-width="0.6" transform="rotate(240)"/>' +
            '<ellipse class="grow-petal" cx="0" cy="-8" rx="3.2" ry="6" fill="rgba(45,212,191,0.65)" stroke="#2dd4bf" stroke-width="0.6" transform="rotate(300)"/>' +
            '<circle class="grow-flower-center" cx="0" cy="0" r="4" fill="#f59e0b" stroke="#fcd34d" stroke-width="0.6"/>' +
            '</g>'
          );
      }
    }

    const cls =
      'plant-grow-svg plant-grow-svg--s' +
      stage +
      (hero ? ' plant-grow-svg--hero' : '') +
      (compact ? ' plant-grow-svg--compact' : '') +
      (animate ? ' plant-grow-svg--animate' : '');

    const bgHtml = noBg
      ? ''
      : '<rect class="grow-bg" x="0" y="0" width="120" height="180" rx="14"/>';

    return (
      '<svg class="' +
      cls +
      '" viewBox="0 0 120 180" role="img" aria-label="' +
      esc(GROWTH_STAGES[stage].label + ' stage') +
      '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
      '<linearGradient id="' + uid + '-bg" x1="60" y1="0" x2="60" y2="180" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="rgba(12,28,24,0.35)"/><stop offset="1" stop-color="rgba(7,16,14,0.15)"/>' +
      '</linearGradient>' +
      '</defs>' +
      bgHtml +
      (!noBg ? '<rect class="grow-scene" x="0" y="0" width="120" height="180" fill="url(#' + uid + '-bg)"/>' : '') +
      potAndSoil() +
      stagePlant() +
      '</svg>'
    );
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

  let busy = false;

  function renderWalletPanel(wallet) {
    const el = document.getElementById('adopt-wallet');
    if (!el) return;
    if (!wallet.connected) {
      el.innerHTML =
        '<div class="metric-panel metric-panel--inline">' +
        '<div class="adopt-wallet-connect">' +
        '<div class="adopt-wallet-copy">' +
        '<h3>Connect your wallet</h3>' +
        '<p>Connect a (demo) wallet to import seeds and mint growth tokens on each stage.</p>' +
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

    if (M) {
      el.innerHTML =
        '<div class="metric-panel metric-panel--inline">' +
        '<div class="metric-cards metric-cards--wallet">' +
        M.card({
          label: 'Wallet address',
          value: esc(shortAddr(wallet.address)),
          meta: M.row('Network', 'Demo · testnet', 'metric-dot--teal'),
          modifier: 'teal',
        }) +
        M.card({
          label: '$GROW balance',
          value: Number(wallet.growthBalance || 0).toLocaleString('en-US'),
          meta: M.row('Rewards', 'Simulated', 'metric-dot--amber'),
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
          '<p>Connect a wallet to mint a seed token and grow it from soil to flower — each stage mints <strong>$GROW</strong>.</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-adopt-open">Open Adopt a plant</button>' +
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
                meta: M.row('Status', 'Wallet connected', 'metric-dot--teal'),
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
    },
  };
})();
