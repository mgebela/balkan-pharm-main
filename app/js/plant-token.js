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

  const STORAGE_WALLET_LEGACY = 'dnevnik-live-wallet';
  const STORAGE_PLANTS = 'dnevnik-live-plants'; // shared with the main app (read-only here)

  /** Active Firebase uid — wallet localStorage is scoped per account. */
  let accountUid = '';

  function walletStorageKey() {
    return accountUid ? STORAGE_WALLET_LEGACY + ':' + accountUid : STORAGE_WALLET_LEGACY;
  }

  function currentAuthUid() {
    try {
      const user = window.firebase && firebase.auth && firebase.auth().currentUser;
      return user && user.uid ? String(user.uid) : '';
    } catch {
      return '';
    }
  }

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
      const raw = localStorage.getItem(walletStorageKey());
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
    const normalized = Object.assign(emptyWallet(), wallet || {}, {
      tokens: Array.isArray(wallet && wallet.tokens) ? wallet.tokens : [],
    });
    let next;
    try {
      next = JSON.stringify(normalized);
    } catch {
      return;
    }
    try {
      const prev = localStorage.getItem(walletStorageKey());
      if (prev === next) return; // unchanged — do not re-emit (prevents render loops)
      localStorage.setItem(walletStorageKey(), next);
    } catch {
      // ignore quota / serialization errors
      return;
    }
    listeners.forEach((fn) => {
      try {
        fn(normalized);
      } catch {
        // ignore listener errors
      }
    });
  }

  /**
   * Only migrate the old shared wallet blob when it matches this account's
   * linked pubkey — never copy another profile's garden into an empty account.
   */
  function migrateLegacyWalletIfNeeded(uid, linkedPubkey) {
    if (!uid || !linkedPubkey) return;
    const scopedKey = STORAGE_WALLET_LEGACY + ':' + uid;
    try {
      if (localStorage.getItem(scopedKey)) return;
      const legacyRaw = localStorage.getItem(STORAGE_WALLET_LEGACY);
      if (!legacyRaw) return;
      const legacy = JSON.parse(legacyRaw);
      if (!legacy || legacy.address !== linkedPubkey) return;
      localStorage.setItem(scopedKey, legacyRaw);
      localStorage.removeItem(STORAGE_WALLET_LEGACY);
    } catch {
      // ignore
    }
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

    getAccountUid() {
      return accountUid;
    },

    /**
     * Bind wallet storage to a Firebase account.
     * Switching accounts disconnects the shared browser wallet session
     * so each profile connects its own wallet.
     */
    bindAccount(uid) {
      return (async function () {
        const next = uid ? String(uid) : '';
        const prev = accountUid;
        if (prev && next && prev !== next) {
          const SW = window.SolanaWallet;
          if (SW && typeof SW.disconnect === 'function') {
            try {
              await SW.disconnect();
            } catch {
              // ignore
            }
          }
        }
        accountUid = next;
        try {
          if (typeof document !== 'undefined' && document.body) {
            document.body.dataset.walletRestored = '';
          }
        } catch {
          // ignore
        }
        const wallet = readWallet();
        listeners.forEach((fn) => {
          try {
            fn(wallet);
          } catch {
            // ignore
          }
        });
        return wallet;
      })();
    },

    clearAccount() {
      return PlantToken.bindAccount('');
    },

    /**
     * After WalletLink.loadProfile(): keep this account empty unless it has
     * its own linked Solana pubkey. Drops leaked shared-session data.
     */
    reconcileWithProfile() {
      return (async function () {
        const uid = accountUid || currentAuthUid();
        if (uid && accountUid !== uid) {
          await PlantToken.bindAccount(uid);
        }

        const linked =
          window.WalletLink && WalletLink.getProfile
            ? String(WalletLink.getProfile().solanaPubkey || '')
            : '';

        if (uid) migrateLegacyWalletIfNeeded(uid, linked);

        const SW = window.SolanaWallet;

        if (!linked) {
          if (SW && typeof SW.isConnected === 'function' && SW.isConnected()) {
            try {
              await SW.disconnect();
            } catch {
              // ignore
            }
          }
          const current = readWallet();
          const hasLocalData =
            current.connected ||
            !!current.address ||
            Number(current.growthBalance || 0) > 0 ||
            (current.tokens && current.tokens.length > 0);
          if (hasLocalData) writeWallet(emptyWallet());
          return readWallet();
        }

        let wallet = readWallet();
        if (wallet.address && wallet.address !== linked) {
          wallet = emptyWallet();
          writeWallet(wallet);
          wallet = readWallet();
        }

        if (SW && typeof SW.isConnected === 'function' && SW.isConnected()) {
          const live = SW.getPublicKey && SW.getPublicKey();
          if (live && live !== linked) {
            try {
              await SW.disconnect();
            } catch {
              // ignore
            }
            if (wallet.connected || wallet.address) {
              wallet.connected = false;
              wallet.address = '';
              wallet.provider = '';
              writeWallet(wallet);
              wallet = readWallet();
            }
          }
        }

        // Linked but session disconnected: clear stale session address only.
        if (!wallet.connected && wallet.address) {
          wallet.address = '';
          wallet.provider = '';
          writeWallet(wallet);
        }

        return readWallet();
      })();
    },

    connect() {
      return (async function () {
        const uid = currentAuthUid();
        if (!uid) {
          throw new Error('Sign in to your dnevnik.live account before connecting a wallet.');
        }
        if (accountUid !== uid) {
          await PlantToken.bindAccount(uid);
        }
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
            const profile = WalletLink.getProfile();
            const force =
              !!profile.solanaPubkey && profile.solanaPubkey !== address;
            if (force) {
              // Replacing this account's linked wallet after an explicit connect.
              await WalletLink.unlinkWallet();
            }
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
        if (window.WalletLink && typeof WalletLink.unlinkWallet === 'function') {
          try {
            await WalletLink.unlinkWallet();
          } catch (err) {
            console.warn('Wallet unlink failed', err);
          }
        }
        const wallet = readWallet();
        wallet.connected = false;
        wallet.address = '';
        wallet.provider = '';
        wallet.linkError = '';
        writeWallet(wallet);
        return wallet;
      })();
    },

    /** Stage index from market listing stage label. */
    stageIndexFromLabel(label) {
      const key = String(label || '').trim().toLowerCase();
      const idx = GROWTH_STAGES.findIndex(function (s) {
        return s.label.toLowerCase() === key || s.key === key;
      });
      return idx >= 0 ? idx : 0;
    },

    /**
     * Record an adopter investment (market purchase) in this account's garden.
     */
    adoptFromListing(listing) {
      if (!listing || !listing.mintAddress) return null;
      const wallet = readWallet();
      const existing = wallet.tokens.find(function (t) {
        return (
          t.mintAddress === listing.mintAddress ||
          (listing.id && t.listingId === listing.id)
        );
      });
      if (existing) {
        existing.mintAddress = listing.mintAddress;
        existing.listingId = listing.id || existing.listingId;
        existing.adopted = true;
        existing.investStatus = listing.status || existing.investStatus;
        writeWallet(wallet);
        return existing;
      }

      const now = Date.now();
      const stageIndex = PlantToken.stageIndexFromLabel(listing.stage);
      const token = {
        id: tokenId(),
        name: String(listing.name || 'Adopted RWA').trim(),
        strain: String(listing.strain || '').trim(),
        batch: String(listing.batch || '').trim(),
        plantId: listing.plantId || null,
        mintAddress: listing.mintAddress,
        mintRequestId: listing.mintRequestId || null,
        listingId: listing.id || null,
        adopted: true,
        investedGrow: Number(listing.priceGrow || 0),
        investStatus: listing.status || 'sale_pending',
        sellerPubkey: listing.sellerPubkey || '',
        stageIndex: stageIndex,
        createdAt: now,
        history: [
          {
            ts: now,
            type: 'invest',
            stage: GROWTH_STAGES[stageIndex].key,
            amount: Number(listing.priceGrow || 0),
            tx: listing.paymentSignature || listing.transferSignature || mockTxHash(),
          },
        ],
      };
      wallet.tokens.unshift(token);
      writeWallet(wallet);
      return token;
    },

    /** Remove / lock a token after the grower posts it to the market. */
    markTokenListed(mintAddress, mintRequestId) {
      const wallet = readWallet();
      const before = wallet.tokens.length;
      wallet.tokens = wallet.tokens.filter(function (t) {
        if (mintAddress && t.mintAddress === mintAddress) return false;
        if (mintRequestId && t.mintRequestId === mintRequestId) return false;
        // Also match via SeedChain when only mintRequestId is on the token.
        if (mintAddress && t.mintRequestId && window.SeedChain) {
          const mint = SeedChain.getMint(t.mintRequestId);
          if (mint && mint.mintAddress === mintAddress) return false;
        }
        return true;
      });
      if (wallet.tokens.length !== before) writeWallet(wallet);
      return wallet;
    },

    /**
     * Pull minted seedMints for this account into the Tokenise garden
     * (e.g. externally registered RWAs assigned to a grower).
     */
    syncFromSeedMints() {
      const SC = window.SeedChain;
      if (!SC || typeof SC.getMints !== 'function') return readWallet();
      const mints = SC.getMints() || {};
      const wallet = readWallet();
      let changed = false;

      Object.keys(mints).forEach(function (requestId) {
        const m = mints[requestId];
        if (!m || m.status !== 'minted' || !m.mintAddress) return;

        const existing = wallet.tokens.find(function (t) {
          return (
            t.mintRequestId === requestId ||
            t.mintAddress === m.mintAddress
          );
        });
        if (existing) {
          if (!existing.mintAddress) {
            existing.mintAddress = m.mintAddress;
            existing.mintRequestId = existing.mintRequestId || requestId;
            changed = true;
          }
          return;
        }

        let stageIndex = 0;
        if (typeof m.stageIndex === 'number') stageIndex = m.stageIndex;
        else if (m.stage) stageIndex = PlantToken.stageIndexFromLabel(m.stage);
        else if (/bloom|flower|harvest/i.test(String(m.name || ''))) stageIndex = 4;

        const now = Date.now();
        wallet.tokens.unshift({
          id: tokenId(),
          name: String(m.name || 'Seed RWA').trim(),
          strain: String(m.strain || '').trim(),
          batch: String(m.batch || '').trim(),
          plantId: m.plantId || null,
          mintRequestId: requestId,
          mintAddress: m.mintAddress,
          stageIndex: stageIndex,
          createdAt: now,
          importedExternal: !!m.importedExternal,
          history: [
            {
              ts: now,
              type: 'mint',
              stage: GROWTH_STAGES[stageIndex].key,
              amount: 0,
              tx: m.signature || mockTxHash(),
            },
          ],
        });
        changed = true;
      });

      if (changed) writeWallet(wallet);
      return wallet;
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

        const plantId = o.plantId || null;
        if (window.GrowerQuests) {
          const seedQuest = GrowerQuests.evaluateSeedQuest({ plantId: plantId });
          if (!seedQuest.ready) {
            throw new Error(seedQuest.message || 'Link a journal plant before minting.');
          }
        } else if (!plantId) {
          throw new Error('Link a journal plant before minting a seed RWA.');
        }

        const now = Date.now();
        const tx = mockTxHash();
        const token = {
          id: tokenId(),
          name,
          strain: String(o.strain || '').trim(),
          batch: String(o.batch || '').trim(),
          plantId: plantId,
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
        if (window.GrowerQuests) {
          GrowerQuests.awardXp('seed_mint_linked', GrowerQuests.QUEST_XP.linkPlant);
        }
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
        const nextStage = GROWTH_STAGES[token.stageIndex + 1];
        if (window.GrowerQuests) {
          const quest = GrowerQuests.evaluateGrowthQuest(token, nextStage.key);
          if (!quest.ready) {
            throw new Error(quest.message || 'Complete grower journal quests first.');
          }
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
        if (window.GrowerQuests) {
          GrowerQuests.awardXp('growth_mint_' + stage.key, GrowerQuests.QUEST_XP.mintReady);
        }
        return { token, reward: stage.reward, tx, targetStage: stage.key };
      }, 800).then(async (result) => {
        const SC = window.SeedChain;
        const token = result.token;
        const seedMint = SC && token.mintRequestId ? SC.getMint(token.mintRequestId) : null;
        if (SC && SC.isEnabled() && seedMint && seedMint.mintAddress) {
          try {
            const stage = GROWTH_STAGES[token.stageIndex];
            const journalProof =
              window.GrowerQuests && typeof GrowerQuests.buildProof === 'function'
                ? GrowerQuests.buildProof(token, stage.key)
                : null;
            const requestId = await SC.requestGrowthMint({
              mintAddress: seedMint.mintAddress,
              seedMintRequestId: token.mintRequestId,
              stage: stage.key,
              name: token.name,
              strain: token.strain || token.name,
              batch: token.batch,
              plantId: token.plantId,
              journalProof: journalProof,
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

    // Attach an existing journal plant to a token (required for growth mints).
    linkPlant(tokenId, plantId) {
      return chainCall(() => {
        const wallet = readWallet();
        const token = wallet.tokens.find((t) => t.id === tokenId);
        if (!token) throw new Error('Token not found.');
        const plant = readPlants().find((p) => p && String(p.id) === String(plantId));
        if (!plant) throw new Error('Journal plant not found.');
        token.plantId = String(plant.id);
        if (!token.strain && plant.strain) token.strain = plant.strain;
        writeWallet(wallet);
        if (window.GrowerQuests) {
          GrowerQuests.awardXp('link_plant_' + token.id, GrowerQuests.QUEST_XP.linkPlant);
        }
        return token;
      }, 200);
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
      '<header class="metric-panel-head">' +
      '<h2 class="metric-panel-title">How growth works</h2>' +
      '<p class="metric-panel-sub">Tap a stage to preview rewards</p>' +
      '</header>' +
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
    const wallet = readWallet();
    if (!SW || !SW.isConnected()) return wallet;
    const address = SW.getPublicKey();
    if (!address) return wallet;

    // Only mirror the extension when this account has linked that pubkey.
    // Never auto-attach a shared Phantom session to an empty / unlinked profile.
    const linked =
      window.WalletLink && WalletLink.getProfile
        ? String(WalletLink.getProfile().solanaPubkey || '')
        : '';
    if (!linked || linked !== address) return wallet;

    const provider = SW.getProviderName() || 'solana';
    const chain = (window.ChainConfig && window.ChainConfig.cluster) || 'devnet';
    if (
      wallet.connected &&
      wallet.address === address &&
      wallet.provider === provider &&
      wallet.chain === chain
    ) {
      return wallet;
    }

    wallet.connected = true;
    wallet.address = address;
    wallet.chain = chain;
    wallet.provider = provider;
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

  function growerProfileHtml() {
    if (isAdopterUi()) return '';
    if (!window.GrowerQuests || typeof GrowerQuests.getGrowerProfile !== 'function') return '';
    const profile = GrowerQuests.getGrowerProfile();
    return (
      '<div class="grower-profile" aria-label="Grower level">' +
      '<div class="grower-profile-row">' +
      '<span class="grower-profile-level">Lv ' +
      profile.level +
      '</span>' +
      '<strong class="grower-profile-title">' +
      esc(profile.title) +
      '</strong>' +
      '<span class="grower-profile-xp">' +
      profile.xp +
      ' XP</span>' +
      '</div>' +
      '<p class="grower-profile-hint">Log stages, watering, and feeding in the journal to unlock growth mints.</p>' +
      '</div>'
    );
  }

  function renderWalletPanel(wallet) {
    const el = document.getElementById('adopt-wallet');
    if (!el) return;
    if (!wallet.connected) {
      el.innerHTML =
        '<div class="metric-panel metric-panel--inline adopt-wallet-panel">' +
        '<div class="adopt-wallet-connect">' +
        '<div class="adopt-wallet-copy">' +
        '<h3>Connect to start</h3>' +
        '<p>Link a Solana wallet on Devnet to mint seed NFTs and earn $GROW.</p>' +
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
        '</div>' +
        growerProfileHtml() +
        '</div>';
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
      growerProfileHtml() +
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
        const label =
          h.type === 'invest'
            ? 'Invested / adopted'
            : h.type === 'mint'
              ? 'Seed minted'
              : 'Grew to ' + (GROWTH_STAGES.find((s) => s.key === h.stage) || {}).label;
        const amt =
          h.type === 'invest'
            ? h.amount
              ? ' · ' + h.amount + ' $GROW'
              : ''
            : h.amount
              ? ' · +' + h.amount + ' $GROW'
              : '';
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
      (token.adopted
        ? '<p class="adopt-token-link">Market investment' +
          (token.investedGrow ? ' · ' + Number(token.investedGrow).toLocaleString('en-US') + ' $GROW' : '') +
          (token.investStatus === 'sale_pending' ? ' · settling…' : '') +
          (token.investStatus === 'sold' ? ' · NFT adopted' : '') +
          '</p>'
        : token.plantId
          ? '<p class="adopt-token-link">Linked journal plant</p>'
          : linkPlantControlHtml(token)) +
      chainMintHtml(token) +
      (token.mintAddress && !token.mintRequestId
        ? '<p class="adopt-token-chain adopt-token-chain--ok">⛓ NFT <a href="' +
          esc(explorerAddressUrl(token.mintAddress)) +
          '" target="_blank" rel="noopener noreferrer"><code>' +
          esc(shortAddr(token.mintAddress)) +
          '</code></a></p>'
        : '') +
      growerQuestHtml(token, next) +
      '<div class="adopt-progress"><div class="adopt-progress-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="adopt-stage-track">' + dots + '</div>' +
      '<div class="adopt-token-stats">' +
      '<span>' +
      (token.adopted ? 'Invested' : 'Earned') +
      ': <strong>' +
      (token.adopted ? Number(token.investedGrow || 0) : earned) +
      ' $GROW</strong></span>' +
      '<span class="adopt-token-id" title="' + esc(token.id) + '">#' + esc(token.id.slice(-6)) + '</span>' +
      '</div>' +
      '<div class="adopt-token-actions">' +
      (token.adopted
        ? '<button type="button" class="btn btn-ghost btn-sm adopt-action-primary" disabled>' +
          (token.investStatus === 'sale_pending' ? 'Settlement pending' : 'Adopted RWA') +
          '</button>'
        : isMax
          ? '<button type="button" class="btn btn-ghost btn-sm adopt-action-primary" disabled>Fully grown</button>'
          : mintButtonHtml(token, next)) +
      '<div class="adopt-token-actions-secondary">' +
      '<button type="button" class="btn btn-ghost btn-sm adopt-history-btn" data-id="' + esc(token.id) + '">History</button>' +
      (token.plantId && !isAdopterUi()
        ? '<button type="button" class="btn btn-ghost btn-sm adopt-open-journal-btn" data-plant-id="' +
          esc(token.plantId) +
          '">Journal</button>'
        : '') +
      '<button type="button" class="btn btn-ghost btn-sm adopt-burn-btn" data-id="' + esc(token.id) + '">Burn</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<ul class="adopt-token-history" id="adopt-hist-' + esc(token.id) + '" hidden>' + history + '</ul>' +
      '</article>'
    );
  }

  function growerQuestHtml(token, nextStage) {
    if (isAdopterUi()) {
      if (!nextStage) return '';
      return (
        '<div class="grower-quest grower-quest--blocked">' +
        '<div class="grower-quest-head"><strong>Growth tracking</strong></div>' +
        '<p class="grower-quest-msg">Stage advances are minted by the linked grower’s journal proof. Track progress here or buy later stages on the market.</p>' +
        '</div>'
      );
    }
    if (!nextStage || !window.GrowerQuests) return '';
    const quest = GrowerQuests.evaluateGrowthQuest(token, nextStage.key);
    return GrowerQuests.checklistHtml(quest, esc);
  }

  function linkPlantControlHtml(token) {
    if (isAdopterUi()) {
      return '<p class="adopt-token-link adopt-token-link--warn">Adopted asset — growth updates from the grower / market</p>';
    }
    const plants = readPlants();
    if (!plants.length) {
      return (
        '<p class="adopt-token-link adopt-token-link--warn">Not linked — add a plant in Plants &amp; journal first</p>'
      );
    }
    const opts = plants
      .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name || 'Plant') + '</option>')
      .join('');
    return (
      '<div class="adopt-link-plant">' +
      '<p class="adopt-token-link adopt-token-link--warn">Not linked to a journal plant</p>' +
      '<label class="adopt-link-plant-label">Link plant' +
      '<select class="adopt-link-plant-select" data-token-id="' +
      esc(token.id) +
      '">' +
      '<option value="">— choose —</option>' +
      opts +
      '</select></label>' +
      '<button type="button" class="btn btn-ghost btn-sm adopt-link-plant-btn" data-token-id="' +
      esc(token.id) +
      '">Link</button>' +
      '</div>'
    );
  }

  function mintButtonHtml(token, next) {
    if (!next) return '';
    if (isAdopterUi()) {
      return (
        '<button type="button" class="btn btn-ghost btn-sm adopt-action-primary" disabled>Awaiting grower stage mint</button>'
      );
    }
    let ready = true;
    let title = '';
    if (window.GrowerQuests) {
      const quest = GrowerQuests.evaluateGrowthQuest(token, next.key);
      ready = quest.ready;
      title = quest.ready ? '' : ' title="' + esc(quest.message) + '"';
    }
    if (!ready) {
      return (
        '<button type="button" class="btn btn-ghost btn-sm adopt-action-primary adopt-mint-btn adopt-mint-btn--locked" data-id="' +
        esc(token.id) +
        '" disabled' +
        title +
        '>Complete quests to mint → ' +
        esc(next.label) +
        '</button>'
      );
    }
    return (
      '<button type="button" class="btn btn-primary btn-sm adopt-mint-btn adopt-action-primary" data-id="' +
      esc(token.id) +
      '">Mint → ' +
      esc(next.label) +
      ' (+' +
      next.reward +
      ')</button>'
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

  function isAdopterUi() {
    if (window.DnevnikProfile && typeof DnevnikProfile.isAdopter === 'function') {
      return DnevnikProfile.isAdopter();
    }
    return document.body.classList.contains('profile-adopter');
  }

  function applyProfileChrome() {
    const marketCta = document.getElementById('adopt-market-cta');
    if (marketCta) {
      marketCta.hidden = !isAdopterUi();
    }
  }

  function renderGarden(wallet) {
    const grid = document.getElementById('adopt-token-grid');
    if (!grid) return;
    if (!wallet.tokens.length) {
      grid.innerHTML = isAdopterUi()
        ? '<div class="empty-state">No adopted plants yet. Open the market to find one.</div>'
        : '<div class="empty-state">No tokens yet. Mint a seed above to start growing.</div>';
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
      '<option value="">— choose a plant —</option>' +
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

  let renderAdoptBusy = false;
  let renderWalletUiBusy = false;

  function render() {
    if (renderAdoptBusy) return;
    renderAdoptBusy = true;
    try {
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
      if (!isAdopterUi()) {
        renderGrowthGuide(highlightStage);
      }
      renderWalletPanel(wallet);
      if (seedSection) seedSection.hidden = !wallet.connected || isAdopterUi();
      // Show garden when connected OR when this account already has tokens (e.g. synced mints).
      if (gardenSection) {
        gardenSection.hidden = !(wallet.connected || (wallet.tokens && wallet.tokens.length > 0));
      }
      applyProfileChrome();
      if (wallet.connected || (wallet.tokens && wallet.tokens.length > 0)) {
        if (!isAdopterUi() && wallet.connected) fillSeedPlantOptions();
        renderGarden(wallet);
      }
    } finally {
      renderAdoptBusy = false;
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
    const original = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Choose wallet…';
    // Do not set global busy while the picker is open — Solflare may stay
    // pending until the user approves, cancels, or the timeout fires.
    try {
      const wallet = await PlantToken.connect();
      busy = true;
      render();
      renderGlobalWalletUI();
      if (wallet && wallet.linkError) {
        alert(
          'Wallet connected, but account link failed:\n\n' +
            wallet.linkError +
            '\n\nUse "Link account" to try again.'
        );
      }
    } catch (err) {
      // Ignore cancel; surface real errors.
      if (!err || !/cancel/i.test(String(err.message || ''))) {
        flashError(err);
      }
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
    if (window.SolanaWallet && typeof window.SolanaWallet.isWatchOnly === 'function' && SolanaWallet.isWatchOnly()) {
      return true;
    }
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
        '<span class="wallet-link-badge wallet-link-badge--warn">Not linked</span>' +
        '<button type="button" class="btn btn-ghost btn-sm wallet-link-btn">Link account</button>'
      );
    }
    const linkedUnverified =
      isWatchOnlyProvider(profile.walletProvider) || profile.walletProvider === 'watch-only';
    const linkedLabel = linkedUnverified ? 'Linked · unverified' : 'Account linked';
    if (wallet.connected && wallet.address === profile.solanaPubkey) {
      return watchBadge + '<span class="wallet-link-badge wallet-link-badge--ok">' + linkedLabel + '</span>';
    }
    return (
      watchBadge +
      '<span class="wallet-link-badge wallet-link-badge--ok">Linked · ' +
      esc(shortAddr(profile.solanaPubkey)) +
      '</span>'
    );
  }

  function walletControlsHtml(variant) {
    syncWalletFromSolana();
    const wallet = readWallet();
    const compact = variant === 'compact';
    const profileHint = 'Each dnevnik.live account links its own Solana wallet.';
    const linkedPubkey =
      window.WalletLink && WalletLink.getProfile
        ? String(WalletLink.getProfile().solanaPubkey || '')
        : '';

    if (!wallet.connected) {
      const linkedHint = linkedPubkey
        ? '<p class="wallet-controls-meta">Linked to this account: ' +
          esc(shortAddr(linkedPubkey)) +
          ' — reconnect to sign.</p>'
        : '';
      if (compact) {
        return (
          '<div class="wallet-controls wallet-controls--compact">' +
          '<span class="wallet-controls-label">Solana</span>' +
          (linkedPubkey
            ? '<span class="wallet-controls-addr" title="' +
              esc(linkedPubkey) +
              '">' +
              esc(shortAddr(linkedPubkey)) +
              '</span>'
            : '') +
          walletLinkBadgeHtml() +
          '<button type="button" class="btn btn-primary btn-sm wallet-connect-btn">' +
          (linkedPubkey ? 'Reconnect' : 'Connect') +
          '</button>' +
          '</div>'
        );
      }
      return (
        '<div class="wallet-controls wallet-controls--panel">' +
        '<div class="wallet-controls-copy">' +
        '<h3>Connect wallet for this account</h3>' +
        '<p>' + esc(devnetNotice()) + '</p>' +
        '<p class="wallet-controls-hint">' + esc(profileHint) + '</p>' +
        linkedHint +
        walletLinkBadgeHtml() +
        '</div>' +
        '<button type="button" class="btn btn-primary wallet-connect-btn">' +
        (linkedPubkey ? 'Reconnect wallet' : 'Connect wallet') +
        '</button>' +
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
    if (renderWalletUiBusy) return;
    renderWalletUiBusy = true;
    try {
      const headerBar = document.getElementById('app-wallet-bar');
      if (headerBar) headerBar.innerHTML = walletControlsHtml('compact');

      const adminPanel = document.getElementById('admin-wallet-panel');
      if (adminPanel) adminPanel.innerHTML = walletControlsHtml('panel');
    } finally {
      renderWalletUiBusy = false;
    }
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

      const journalBtn = e.target.closest('.adopt-open-journal-btn');
      if (journalBtn) {
        const plantId = journalBtn.dataset.plantId;
        if (plantId) {
          window.dispatchEvent(
            new CustomEvent('dnevnik:open-growlog', { detail: { plantId: plantId } })
          );
        }
        return;
      }

      const linkPlantBtn = e.target.closest('.adopt-link-plant-btn');
      if (linkPlantBtn) {
        if (busy) return;
        const tokenId = linkPlantBtn.dataset.tokenId;
        const card = linkPlantBtn.closest('.adopt-token-card');
        const sel = card ? card.querySelector('.adopt-link-plant-select') : null;
        const plantId = sel ? sel.value : '';
        if (!plantId) {
          flashError(new Error('Choose a journal plant to link.'));
          return;
        }
        setBusy(true);
        try {
          await PlantToken.linkPlant(tokenId, plantId);
          render();
        } catch (err) {
          flashError(err);
        } finally {
          setBusy(false);
        }
        return;
      }

      if (mintBtn) {
        if (busy || mintBtn.disabled || mintBtn.classList.contains('adopt-mint-btn--locked')) return;
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

      const marketBtn = e.target.closest('#adopt-open-market-btn');
      if (marketBtn) {
        const marketNav = document.querySelector('.nav-item[data-view="market"]');
        if (marketNav) marketNav.click();
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
      applyProfileChrome();
      const SW = window.SolanaWallet;
      const alreadyRestored =
        typeof document !== 'undefined' &&
        document.body &&
        document.body.dataset.walletRestored === '1';

      if (!alreadyRestored && SW && typeof SW.tryRestore === 'function') {
        if (document.body) document.body.dataset.walletRestored = '1';
        SW.tryRestore()
          .then(async function () {
            if (window.WalletLink) {
              try {
                await WalletLink.loadProfile();
              } catch {
                // ignore
              }
            }
            const linked =
              window.WalletLink && WalletLink.getProfile
                ? String(WalletLink.getProfile().solanaPubkey || '')
                : '';
            const live = SW.isConnected() ? SW.getPublicKey() : '';

            // Only keep a restored extension session if this account linked it.
            if (!linked || !live || live !== linked) {
              if (SW.isConnected()) {
                try {
                  await SW.disconnect();
                } catch {
                  // ignore
                }
              }
              if (window.PlantToken && typeof PlantToken.reconcileWithProfile === 'function') {
                await PlantToken.reconcileWithProfile();
              }
              render();
              renderGlobalWalletUI();
              return;
            }

            syncWalletFromSolana();
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

    applyProfileType(type) {
      applyProfileChrome();
      const adoptView = document.getElementById('view-adopt');
      if (adoptView && adoptView.classList.contains('active')) {
        render();
      }
    },

    renderDashboard(container, onOpen) {
      if (!container) return;
      syncWalletFromSolana();
      const wallet = readWallet();
      const maxStage = GROWTH_STAGES.length - 1;
      const M = window.MetricUI;
      const adopter = isAdopterUi();
      const panelTitle = adopter ? 'My garden' : 'Tokenise';
      const openLabel = adopter ? 'Open garden' : 'Open Tokenise';
      const emptyCta = adopter ? 'Browse market' : 'Mint a seed';
      const emptyCopy = adopter
        ? 'Adopt your first plant from the market and track growth & $GROW here.'
        : 'Mint your first seed to start the growth cycle and earn rewards at each stage.';

      if (!wallet.connected) {
        container.innerHTML =
          '<div class="metric-panel metric-panel--adopt">' +
          '<header class="metric-panel-head"><h2 class="metric-panel-title">' +
          esc(panelTitle) +
          '</h2></header>' +
          '<div class="dashboard-adopt-panel">' +
          '<div class="dashboard-adopt-visual">' +
          buildPlantGrowSvg(0, { hero: true, noBg: true }) +
          '</div>' +
          '<div class="dashboard-adopt-copy">' +
          '<p>' + esc(devnetNotice()) + '</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-adopt-open">' +
          esc(openLabel) +
          '</button>' +
          '<button type="button" class="btn btn-ghost wallet-connect-btn">Connect wallet</button>' +
          '</div></div></div>';
      } else if (!wallet.tokens.length) {
        container.innerHTML =
          '<div class="metric-panel metric-panel--adopt">' +
          '<header class="metric-panel-head"><h2 class="metric-panel-title">' +
          esc(panelTitle) +
          '</h2></header>' +
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
                meta: M.row('Next step', esc(emptyCta), 'metric-dot--blue'),
                modifier: 'blue',
              }) +
              '</div>'
            : '') +
          '<div class="dashboard-adopt-panel">' +
          '<div class="dashboard-adopt-visual">' +
          buildPlantGrowSvg(0, { hero: true, noBg: true }) +
          '</div>' +
          '<div class="dashboard-adopt-copy">' +
          '<p>' +
          esc(emptyCopy) +
          '</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-adopt-open">' +
          esc(emptyCta) +
          '</button>' +
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
          '<header class="metric-panel-head"><h2 class="metric-panel-title">' +
          esc(panelTitle) +
          ' · Token garden</h2></header>' +
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
      try {
        PlantToken.syncFromSeedMints();
      } catch (err) {
        console.warn('syncFromSeedMints', err);
      }
      render();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderGlobalWalletUI);
  } else {
    renderGlobalWalletUI();
  }
})();
