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
          throw new Error('Sign in to your growtoo account before connecting a wallet.');
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
            const alreadyLinked =
              !!profile.solanaPubkey && profile.solanaPubkey === address;
            if (alreadyLinked) {
              wallet.linkError = '';
              writeWallet(wallet);
              return wallet;
            }
            const force =
              !!profile.solanaPubkey && profile.solanaPubkey !== address;
            if (force) {
              // Replacing this account's linked wallet after an explicit connect.
              await WalletLink.unlinkWallet();
            }
            // Let Solflare/Phantom finish the connect popup before signMessage.
            // Immediate second prompts often return "Cancelled" and confuse users.
            await new Promise(function (resolve) {
              setTimeout(resolve, 700);
            });
            await WalletLink.linkWallet(address);
            wallet.linkError = '';
            writeWallet(wallet);
          } catch (linkErr) {
            console.warn('Wallet account link failed', linkErr);
            wallet.linkError =
              window.WalletLink.formatError
                ? WalletLink.formatError(linkErr)
                : linkErr.message || 'Account link failed.';
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
        if (listing.paymentSignature || listing.buySignature) {
          existing.paymentSignature =
            listing.paymentSignature || listing.buySignature || existing.paymentSignature;
        }
        writeWallet(wallet);
        return existing;
      }

      const now = Date.now();
      const stageIndex = PlantToken.stageIndexFromLabel(listing.stage);
      const token = {
        id: tokenId(),
        name: String(listing.name || 'Adopted plant').trim(),
        strain: String(listing.strain || '').trim(),
        batch: String(listing.batch || '').trim(),
        plantId: listing.plantId || null,
        mintAddress: listing.mintAddress,
        mintRequestId: listing.mintRequestId || null,
        listingId: listing.id || null,
        adopted: true,
        investedGrow: Number(listing.priceGrow || 0),
        investStatus: listing.status || 'sale_pending',
        paymentSignature: listing.paymentSignature || listing.buySignature || '',
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

    /**
     * Drop local adopted cards that never settled: listing is open again,
     * cancelled, or no longer reserved to this adopter (failed / cancelled pay).
     */
    pruneAbandonedAdoptions(listings, uid) {
      if (!uid) return;
      const byId = {};
      (listings || []).forEach(function (l) {
        if (l && l.id) byId[l.id] = l;
      });
      const wallet = readWallet();
      let changed = false;
      wallet.tokens = wallet.tokens.filter(function (t) {
        if (!t.adopted || !t.listingId) return true;
        if (t.investStatus === 'sold') return true;
        const l = byId[t.listingId];
        if (!l) {
          // Listing gone — keep sold-like history only if we have a real payment sig.
          const sig = String(t.paymentSignature || '');
          if (sig && sig.indexOf('pending-') !== 0 && sig.length >= 32) return true;
          changed = true;
          return false;
        }
        const stillMine =
          l.buyerUid === uid && (l.status === 'sold' || l.status === 'sale_pending');
        if (stillMine) return true;
        // active / cancelled / someone else — orphan from a failed reservation.
        changed = true;
        return false;
      });
      if (changed) writeWallet(wallet);
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

        let existing = wallet.tokens.find(function (t) {
          return (
            t.mintRequestId === requestId ||
            t.mintAddress === m.mintAddress
          );
        });

        // After Retry mint, the garden row may still point at a failed requestId.
        // Attach the successful mint to the same plant / same name token.
        if (!existing && m.plantId) {
          existing = wallet.tokens.find(function (t) {
            return (
              !t.adopted &&
              t.plantId === m.plantId &&
              (!t.mintAddress || t.mintRequestId)
            );
          });
        }
        if (!existing && m.name) {
          existing = wallet.tokens.find(function (t) {
            return (
              !t.adopted &&
              !t.mintAddress &&
              String(t.name || '').trim().toLowerCase() ===
                String(m.name || '').trim().toLowerCase()
            );
          });
        }

        if (existing) {
          if (existing.mintAddress !== m.mintAddress) {
            existing.mintAddress = m.mintAddress;
            changed = true;
          }
          if (existing.mintRequestId !== requestId) {
            existing.mintRequestId = requestId;
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
          throw new Error('Link a journal plant before minting a seed token.');
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
    // growth request (metadata update + $GROWTOO SPL reward) — see seed-chain.js.
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
  // Botanical line-art cards (see token-botanical-art.js / plant-botanical-sprites.js).

  let growthPreviewStage = null;

  function buildPlantGrowSvg(stageIndex, options) {
    // Prefer botanical art explicitly — never fall back to legacy pixel modules.
    if (window.TokenBotanicalArt && typeof window.TokenBotanicalArt.renderStageSvg === 'function') {
      return window.TokenBotanicalArt.renderStageSvg(stageIndex, options);
    }
    if (window.PlantBotanicalSprites && typeof window.PlantBotanicalSprites.renderStageSvg === 'function') {
      return window.PlantBotanicalSprites.renderStageSvg(stageIndex, options);
    }
    return '';
  }

  PlantToken.renderPlantSvg = buildPlantGrowSvg;

  function growthStepHint(stageIndex) {
    const stage = GROWTH_STAGES[stageIndex] || GROWTH_STAGES[0];
    if (stageIndex >= GROWTH_STAGES.length - 1) return 'Fully grown · harvest complete';
    const next = GROWTH_STAGES[stageIndex + 1];
    return 'Next mint → ' + next.label + ' (+' + next.reward + ' $GROWTOO)';
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
      '<p class="metric-panel-sub">Seed → Harvest · tap a stage, or swipe / use arrows on small screens</p>' +
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
      '<div class="adopt-growth-stepper-wrap">' +
      '<button type="button" class="adopt-growth-scroll adopt-growth-scroll--prev" id="adopt-growth-scroll-prev" aria-label="Previous stages">‹</button>' +
      '<div class="adopt-growth-stepper" id="adopt-growth-stepper" role="tablist" aria-label="Growth stages">' +
      stepperHtml +
      '</div>' +
      '<button type="button" class="adopt-growth-scroll adopt-growth-scroll--next" id="adopt-growth-scroll-next" aria-label="Next stages">›</button>' +
      '<p class="adopt-growth-scroll-hint" id="adopt-growth-scroll-hint">Swipe for all stages →</p>' +
      '</div>' +
      '</div>' +
      '</div></div>';

    const stepper = document.getElementById('adopt-growth-stepper');
    const prevBtn = document.getElementById('adopt-growth-scroll-prev');
    const nextBtn = document.getElementById('adopt-growth-scroll-next');
    const scrollHint = document.getElementById('adopt-growth-scroll-hint');
    function updateScrollChrome() {
      if (!stepper) return;
      const max = stepper.scrollWidth - stepper.clientWidth;
      const canScroll = max > 8;
      if (prevBtn) prevBtn.hidden = !canScroll;
      if (nextBtn) nextBtn.hidden = !canScroll;
      if (scrollHint) scrollHint.hidden = !canScroll || stepper.scrollLeft > 12;
      if (prevBtn) prevBtn.disabled = stepper.scrollLeft <= 4;
      if (nextBtn) nextBtn.disabled = stepper.scrollLeft >= max - 4;
    }
    if (stepper) {
      stepper.addEventListener('scroll', updateScrollChrome, { passive: true });
      updateScrollChrome();
      window.setTimeout(updateScrollChrome, 50);
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (!stepper) return;
        stepper.scrollBy({ left: -140, behavior: 'smooth' });
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (!stepper) return;
        stepper.scrollBy({ left: 140, behavior: 'smooth' });
      });
    }
  }

  function networkLabel() {
    return (window.ChainConfig && window.ChainConfig.networkLabel) || 'Solana · devnet';
  }

  function devnetNotice() {
    return (
      (window.ChainConfig && window.ChainConfig.devnetNotice) ||
      'Connect a Solana wallet on the test network. Plant tokens and $GROWTOO rewards still use local simulation until full on-chain deploy.'
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

    // Clear stale "connected" flags after refresh — header must match a live signing session.
    if (!SW || !SW.isConnected()) {
      if (wallet.connected || wallet.address) {
        wallet.connected = false;
        wallet.address = '';
        wallet.provider = '';
        writeWallet(wallet);
      }
      return readWallet();
    }

    const address = SW.getPublicKey();
    if (!address) {
      if (wallet.connected || wallet.address) {
        wallet.connected = false;
        wallet.address = '';
        wallet.provider = '';
        writeWallet(wallet);
      }
      return readWallet();
    }

    // Only mirror the extension when this account has linked that pubkey.
    const linked =
      window.WalletLink && WalletLink.getProfile
        ? String(WalletLink.getProfile().solanaPubkey || '')
        : '';
    if (!linked || linked !== address) {
      if (wallet.connected && wallet.address && wallet.address !== linked) {
        wallet.connected = false;
        wallet.address = '';
        wallet.provider = '';
        writeWallet(wallet);
      }
      return readWallet();
    }

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
    const rank =
      typeof GrowerQuests.growerRankFromLocal === 'function'
        ? GrowerQuests.growerRankFromLocal()
        : null;
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
      (rank
        ? '<p class="adopt-rank-badge adopt-rank-badge--grower adopt-rank-badge--tier-' +
          esc(String(rank.tier)) +
          '">' +
          esc(rank.label) +
          '</p>'
        : '') +
      '<p class="grower-profile-hint">Weekly progress is private to you. Monthly care unlocks the locked adopt stake; ranks rise with care + mints.</p>' +
      '</div>'
    );
  }

  function renderWalletPanel(wallet) {
    const el = document.getElementById('adopt-wallet');
    if (!el) return;
    if (!wallet.connected) {
      el.innerHTML =
        '<div class="metric-panel metric-panel--inline adopt-wallet-panel adopt-wallet-panel--hint">' +
        '<div class="adopt-wallet-connect">' +
        '<div class="adopt-wallet-copy">' +
        '<h3>Wallet optional</h3>' +
        '<p>' +
        (isAdopterUi()
          ? 'Browse anytime. When you’re ready to invest, tap <strong>Wallet · Off</strong> in the header to connect a test-network wallet — no pressure until then.'
          : 'Your journal works without crypto. When you want to mint a plant token, tap <strong>Wallet · Off</strong> in the header to connect on the test network.') +
        '</p>' +
        '</div>' +
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
          label: '$GROWTOO balance',
          value: Number(wallet.growthBalance || 0).toLocaleString('en-US'),
          meta:
            onchainGrowBalance != null
              ? M.row('On-chain', onchainGrowBalance.toLocaleString('en-US') + ' $GROWTOO', 'metric-dot--amber')
              : M.row('Rewards', 'Simulated', 'metric-dot--amber'),
          modifier: 'amber',
        }) +
        M.card({
          label: 'Plant tokens',
          value: String(seeds),
          meta: M.row('Growing', growing, 'metric-dot--teal') + M.row('Harvested', grown, 'metric-dot--blue'),
          modifier: 'blue',
        }) +
        M.card({
          label: 'Growth progress',
          value: grown + ' / ' + seeds,
          meta: M.row('Complete', growPct + '%', 'metric-dot--violet'),
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
      '<div class="adopt-stat"><span class="adopt-stat-value">' + (Number(wallet.growthBalance || 0)) + '</span><span class="adopt-stat-label">$GROWTOO balance</span></div>' +
      '<div class="adopt-stat"><span class="adopt-stat-value">' + seeds + '</span><span class="adopt-stat-label">Plant tokens</span></div>' +
      '<div class="adopt-stat"><span class="adopt-stat-value">' + grown + '</span><span class="adopt-stat-label">Fully grown</span></div>' +
      '</div>' +
      growerProfileHtml() +
      '</div>';
  }

  // --- On-chain $GROWTOO balance (M3) -----------------------------------------
  // Once the $GROWTOO mint is deployed and configured in chain-config.js, the
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
        console.warn('On-chain $GROWTOO balance fetch failed', err);
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
    const nameNorm = String(token.name || '').trim().toLowerCase();
    const strainNorm = String(token.strain || '').trim().toLowerCase();
    const showStrain = strainNorm && strainNorm !== nameNorm;
    const linkedPlant = (function () {
      if (!token.plantId) return null;
      let plants = [];
      if (window.DnevnikJournal && typeof DnevnikJournal.getPlants === 'function') {
        plants = DnevnikJournal.getPlants() || [];
      } else {
        try {
          plants = JSON.parse(localStorage.getItem('dnevnik-live-plants') || '[]') || [];
        } catch (e) {
          plants = [];
        }
      }
      return (
        plants.find(function (p) {
          return p && String(p.id) === String(token.plantId);
        }) || null
      );
    })();
    const plantPhoto = linkedPlant && linkedPlant.photo ? linkedPlant.photo : '';

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
              ? ' · ' + h.amount + ' $GROWTOO'
              : ''
            : h.amount
              ? ' · +' + h.amount + ' $GROWTOO'
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
      '<div class="adopt-token-banner' + (plantPhoto ? '' : ' adopt-token-banner--art') + '">' +
      (plantPhoto
        ? '<img class="adopt-token-banner-photo" src="' + esc(plantPhoto) + '" alt="" />'
        : buildPlantGrowSvg(token.stageIndex, { compact: true })) +
      (plantPhoto
        ? '<span class="adopt-stage-badge adopt-token-banner-badge">' + esc(stage.label) + '</span>'
        : '') +
      '</div>' +
      '<div class="adopt-token-body">' +
      '<div class="adopt-token-head">' +
      '<div class="adopt-token-titles">' +
      '<h4>' + esc(token.name) + '</h4>' +
      (showStrain ? '<p class="adopt-token-strain">' + esc(token.strain) + '</p>' : '') +
      '</div>' +
      '</div>' +
      (token.adopted
        ? '<p class="adopt-token-link">Market investment' +
          (token.investedGrow ? ' · ' + Number(token.investedGrow).toLocaleString('en-US') + ' $GROWTOO' : '') +
          '</p>' +
          investPhaseHtml(token)
        : token.plantId
          ? '<p class="adopt-token-link">Linked journal plant</p>'
          : linkPlantControlHtml(token)) +
      chainMintHtml(token) +
      (token.mintAddress
        ? '<p class="adopt-token-chain adopt-token-chain--ok">⛓ NFT <a href="' +
          esc(explorerAddressUrl(token.mintAddress)) +
          '" target="_blank" rel="noopener noreferrer"><code>' +
          esc(shortAddr(token.mintAddress)) +
          '</code></a></p>'
        : '') +
      growerQuestHtml(token, next) +
      careWeekHtml(token) +
      careMonthHtml(token) +
      rankBadgeHtml(token) +
      careToolsHtml(token, next) +
      adoptStakeActionsHtml(token) +
      '<div class="adopt-progress"><div class="adopt-progress-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="adopt-stage-track">' + dots + '</div>' +
      '<div class="adopt-token-stats">' +
      '<span>' +
      (token.adopted ? 'Invested' : 'Earned') +
      ': <strong>' +
      (token.adopted ? Number(token.investedGrow || 0) : earned) +
      ' $GROWTOO</strong></span>' +
      '<span class="adopt-token-id" title="' + esc(token.id) + '">#' + esc(token.id.slice(-6)) + '</span>' +
      '</div>' +
      '<div class="adopt-token-actions">' +
      (token.adopted
        ? '<button type="button" class="btn btn-ghost btn-sm adopt-action-primary" disabled>' +
          esc(investActionLabel(token)) +
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

  function careWeekHtml(token) {
    // Grower-only weekly progress (not the harvest unlock rule).
    if (isAdopterUi() || token.adopted || !token.plantId || !window.GrowerQuests) return '';
    const week = GrowerQuests.currentWeekCareProgress(token.plantId);
    if (!week) return '';
    const cls = week.ok ? 'grower-quest--ready' : 'grower-quest--blocked';
    return (
      '<div class="grower-quest ' +
      cls +
      ' grower-quest--care grower-quest--weekly">' +
      '<div class="grower-quest-head">' +
      '<strong>Weekly progress</strong>' +
      '<span>' +
      week.daysHit +
      '/' +
      week.minDays +
      ' · ' +
      esc(week.weekKey) +
      '</span>' +
      '</div>' +
      '<p class="grower-quest-msg">' +
      esc(week.message) +
      ' Visible to you only — harvest unlock uses monthly care.</p>' +
      '</div>'
    );
  }

  function careMonthHtml(token) {
    if (!window.GrowerQuests) return '';
    const listing =
      token.mintAddress && window.Market && typeof Market.findAdoptStakeForMint === 'function'
        ? Market.findAdoptStakeForMint(token.mintAddress)
        : null;

    // Adopters: monthly unlock view only (no weekly).
    if (isAdopterUi() || token.adopted) {
      if (!listing || listing.settlement !== 'adopt_stake') return '';
      const months =
        (listing.qualifyingMonthKeys && listing.qualifyingMonthKeys.length) ||
        (listing.harvestProofSummary &&
          listing.harvestProofSummary.monthKeys &&
          listing.qualifyingMonthKeys &&
          listing.qualifyingMonthKeys.length) ||
        0;
      const needed =
        (listing.harvestProofSummary && listing.harvestProofSummary.monthKeys
          ? listing.harvestProofSummary.monthKeys.length
          : null) || (listing.adoptedAt ? '…' : '1+');
      const status = listing.careStatus || 'active';
      return (
        '<div class="grower-quest grower-quest--care grower-quest--monthly">' +
        '<div class="grower-quest-head">' +
        '<strong>Monthly care unlock</strong>' +
        '<span>' +
        esc(String(status)) +
        '</span>' +
        '</div>' +
        '<p class="grower-quest-msg">Grower must qualify each calendar month (≥12 care days). ' +
        'Progress: ' +
        esc(String(months)) +
        '/' +
        esc(String(needed)) +
        ' months. Locked stake releases only if all months pass at harvest.</p>' +
        '</div>'
      );
    }

    if (!token.plantId) return '';
    const month = GrowerQuests.currentMonthCareProgress(token.plantId);
    if (!month) return '';
    const cls = month.ok ? 'grower-quest--ready' : 'grower-quest--blocked';
    let pathExtra = '';
    if (listing && listing.careStatus === 'active' && listing.adoptedAt) {
      const path = GrowerQuests.validateHarvestCarePath(token.plantId, listing.adoptedAt);
      pathExtra =
        ' Stake path: ' +
        (path.qualifyingMonthKeys || []).length +
        '/' +
        (path.monthKeys || []).length +
        ' months qualify.';
    }
    return (
      '<div class="grower-quest ' +
      cls +
      ' grower-quest--care grower-quest--monthly">' +
      '<div class="grower-quest-head">' +
      '<strong>Monthly care unlock</strong>' +
      '<span>' +
      month.daysHit +
      '/' +
      month.minDays +
      ' · ' +
      esc(month.monthKey) +
      '</span>' +
      '</div>' +
      '<p class="grower-quest-msg">' +
      esc(month.message) +
      pathExtra +
      '</p>' +
      '</div>'
    );
  }

  function rankBadgeHtml(token) {
    if (!window.GrowerQuests || typeof GrowerQuests.plantRankForToken !== 'function') return '';
    const listing =
      token.mintAddress && window.Market && typeof Market.findAdoptStakeForMint === 'function'
        ? Market.findAdoptStakeForMint(token.mintAddress)
        : null;
    const rank = GrowerQuests.plantRankForToken(token, listing);
    if (!rank) return '';
    return (
      '<p class="adopt-rank-badge adopt-rank-badge--tier-' +
      esc(String(rank.tier)) +
      '" title="Rises with stage progress and qualifying care months. Score ' +
      esc(String(rank.score)) +
      '">' +
      esc(rank.label) +
      '</p>'
    );
  }

  function adoptStakeActionsHtml(token) {
    if (isAdopterUi() || token.adopted || !token.mintAddress || !window.Market) return '';
    const listing =
      typeof Market.findAdoptStakeForMint === 'function'
        ? Market.findAdoptStakeForMint(token.mintAddress)
        : null;
    if (!listing || listing.careStatus !== 'active') return '';
    const locked = listing.lockedGrow != null ? listing.lockedGrow : Math.floor(Number(listing.priceGrow || 0) / 2);
    const isHarvest =
      token.stageIndex >= GROWTH_STAGES.length - 1 ||
      (GROWTH_STAGES[token.stageIndex] && GROWTH_STAGES[token.stageIndex].key === 'harvest');
    let pathMsg = '';
    if (token.plantId && window.GrowerQuests && listing.adoptedAt) {
      const path = GrowerQuests.validateHarvestCarePath(token.plantId, listing.adoptedAt);
      pathMsg =
        (path.qualifyingMonthKeys || []).length +
        '/' +
        (path.monthKeys || []).length +
        ' months qualify';
    }
    return (
      '<div class="adopt-stake-panel">' +
      '<p class="adopt-care-hint">Adopt stake locked: <strong>' +
      esc(String(locked)) +
      ' $GROWTOO</strong>' +
      (pathMsg ? ' · ' + esc(pathMsg) : '') +
      '</p>' +
      (isHarvest
        ? '<button type="button" class="btn btn-primary btn-sm adopt-harvest-claim-btn" data-listing-id="' +
          esc(listing.id) +
          '" data-plant-id="' +
          esc(token.plantId || '') +
          '">Claim harvest stake</button>'
        : '<p class="adopt-care-hint">Reach harvest stage to claim the locked half (all months must qualify).</p>') +
      '</div>'
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

  function careToolBtn(tokenId, action, label, done, opts) {
    const o = opts || {};
    return (
      '<button type="button" class="adopt-care-btn' +
      (done ? ' adopt-care-btn--done' : '') +
      (o.primary ? ' adopt-care-btn--primary' : '') +
      '" data-care="' +
      esc(action) +
      '" data-token-id="' +
      esc(tokenId) +
      '"' +
      (o.disabled ? ' disabled' : '') +
      (o.title ? ' title="' + esc(o.title) + '"' : '') +
      '>' +
      (done ? '<span class="adopt-care-check" aria-hidden="true">✓</span> ' : '') +
      esc(label) +
      (o.xp && !done ? '<span class="adopt-care-xp">+' + o.xp + ' XP</span>' : '') +
      '</button>'
    );
  }

  /** Quick Tools row — same care actions as dashboard Tools / journal, on the card. */
  function careToolsHtml(token, nextStage) {
    if (isAdopterUi() || token.adopted) return '';

    if (!token.plantId) {
      return (
        '<div class="adopt-care-tools">' +
        '<div class="adopt-care-tools-head"><strong>Grower tools</strong></div>' +
        '<p class="adopt-care-hint">Link a journal plant above to unlock watering, feeding, stage, and environment logs.</p>' +
        '</div>'
      );
    }

    const quest =
      nextStage && window.GrowerQuests
        ? GrowerQuests.evaluateGrowthQuest(token, nextStage.key)
        : null;
    const byId = {};
    (quest && quest.items ? quest.items : []).forEach(function (item) {
      byId[item.id] = item;
    });
    const xp = (window.GrowerQuests && GrowerQuests.QUEST_XP) || {};

    return (
      '<div class="adopt-care-tools" aria-label="Grower tools">' +
      '<div class="adopt-care-tools-head">' +
      '<strong>Grower tools</strong>' +
      '<span>Log care here to unlock the next mint</span>' +
      '</div>' +
      '<div class="adopt-care-tools-grid">' +
      careToolBtn(token.id, 'water', 'Water', !!(byId.watering && byId.watering.ok), {
        xp: xp.watering,
        title: 'Log watering for this plant',
      }) +
      careToolBtn(token.id, 'feed', 'Feed', !!(byId.feeding && byId.feeding.ok), {
        xp: xp.feeding,
        title: 'Log feeding / nutrients',
      }) +
      careToolBtn(
        token.id,
        'stage',
        nextStage ? 'Set stage → ' + nextStage.label : 'Set stage',
        !!(byId.stageLogged && byId.stageLogged.ok),
        {
          xp: xp.stageLogged,
          disabled: !nextStage,
          title: nextStage
            ? 'Update journal stage for ' + nextStage.label
            : 'Fully grown',
        }
      ) +
      careToolBtn(token.id, 'environment', 'Environment', false, {
        title: 'Log an environment check',
      }) +
      careToolBtn(token.id, 'transplant', 'Transplant', false, {
        title: 'Log a transplant note',
      }) +
      careToolBtn(token.id, 'stress', 'Stress note', false, {
        title: 'Log pests / stress observation',
      }) +
      careToolBtn(token.id, 'tools', 'All tools', false, {
        title: 'Open the full Tools dashboard',
      }) +
      careToolBtn(token.id, 'coach', 'Ask Coach', false, {
        primary: true,
        title: 'Open Grower Coach for this plant',
      }) +
      '</div></div>'
    );
  }

  async function runCareAction(action, tokenId) {
    const wallet = readWallet();
    const token = wallet.tokens.find(function (t) {
      return t.id === tokenId;
    });
    if (!token) throw new Error('Token not found.');

    if (action === 'tools') {
      const nav = document.querySelector('.nav-item[data-view="toolbox"]');
      if (nav) nav.click();
      return;
    }
    if (action === 'coach') {
      if (window.AICoach) {
        AICoach.open();
        const name = token.name || 'my plant';
        setTimeout(function () {
          AICoach.ask(
            'Help me complete grower quests for ' +
              name +
              (token.plantId ? ' (plant linked)' : '') +
              '. What should I log next?'
          );
        }, 200);
      }
      return;
    }

    if (!token.plantId) throw new Error('Link a journal plant first.');
    const DJ = window.DnevnikJournal;
    if (!DJ || typeof DJ.addEntry !== 'function') {
      throw new Error('Journal tools are not ready. Refresh the page.');
    }

    const next =
      token.stageIndex < GROWTH_STAGES.length - 1
        ? GROWTH_STAGES[token.stageIndex + 1]
        : null;
    const stageMap =
      (window.GrowerQuests && GrowerQuests.TOKEN_TO_PLANT_STAGE) || {
        germination: 'klijanje',
        seedling: 'sadnica',
        vegetative: 'vegetativna',
        flowering: 'cvjetanje',
        harvest: 'susenje',
      };

    if (action === 'water') {
      DJ.addEntry({
        plantId: token.plantId,
        type: 'zalijevanje',
        note: 'Watering logged from Tokenise',
        meta: { source: 'tokenise-tools' },
      });
      if (window.GrowerQuests) {
        GrowerQuests.awardXp(
          'water_' + token.id + '_' + Date.now(),
          GrowerQuests.QUEST_XP.watering
        );
      }
      return;
    }
    if (action === 'feed') {
      DJ.addEntry({
        plantId: token.plantId,
        type: 'gnojidba',
        note: 'Feeding logged from Tokenise',
        meta: { source: 'tokenise-tools' },
      });
      if (window.GrowerQuests) {
        GrowerQuests.awardXp(
          'feed_' + token.id + '_' + Date.now(),
          GrowerQuests.QUEST_XP.feeding
        );
      }
      return;
    }
    if (action === 'stage') {
      if (!next) throw new Error('Already at final stage.');
      const plantStage = stageMap[next.key];
      if (!plantStage) throw new Error('Unknown target stage.');
      if (typeof DJ.setPlantStage !== 'function') {
        throw new Error('Stage update is not available.');
      }
      DJ.setPlantStage(token.plantId, plantStage, 'Stage set from Tokenise for ' + next.label);
      if (window.GrowerQuests) {
        GrowerQuests.awardXp(
          'stage_' + token.id + '_' + next.key,
          GrowerQuests.QUEST_XP.stageLogged
        );
      }
      return;
    }
    if (action === 'environment') {
      DJ.addEntry({
        plantId: token.plantId,
        type: 'okolis',
        note: 'Environment check logged from Tokenise',
        meta: { source: 'tokenise-tools' },
      });
      return;
    }
    if (action === 'transplant') {
      DJ.addEntry({
        plantId: token.plantId,
        type: 'opcenito',
        note: 'Transplant / pot-up logged from Tokenise',
        meta: { source: 'tokenise-tools', tool: 'transplant' },
      });
      return;
    }
    if (action === 'stress') {
      DJ.addEntry({
        plantId: token.plantId,
        type: 'opcenito',
        note: 'Stress / pest observation logged from Tokenise',
        meta: { source: 'tokenise-tools', tool: 'stressors' },
      });
      return;
    }
    throw new Error('Unknown care action.');
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

  function resolveInvestSource(token) {
    const src = {
      status: token.investStatus || '',
      settlement: token.settlement || '',
      paymentSignature: token.paymentSignature || '',
      buySignature: token.buySignature || '',
      error: token.error || '',
    };
    if (token.listingId && window.Market && typeof Market.getListings === 'function') {
      const listings = Market.getListings() || [];
      for (let i = 0; i < listings.length; i += 1) {
        if (listings[i].id === token.listingId) {
          const l = listings[i];
          return {
            status: l.status || src.status,
            settlement: l.settlement || src.settlement,
            paymentSignature: l.paymentSignature || src.paymentSignature,
            buySignature: l.buySignature || src.buySignature,
            error: l.error || l.lastError || src.error,
          };
        }
      }
    }
    return src;
  }

  function investPhaseHtml(token) {
    if (!token || !token.adopted || !window.StatusRail) return '';
    return StatusRail.investPipeline(resolveInvestSource(token)) || '';
  }

  function investActionLabel(token) {
    const src = resolveInvestSource(token);
    const status = String(src.status || '');
    if (status === 'failed') return 'Investment failed';
    if (status === 'sold') return 'Adopted';
    if (status === 'sale_pending') {
      if (window.StatusRail && StatusRail.hasConfirmedPayment(src)) return 'Settling…';
      return 'Payment pending…';
    }
    return 'Adopted';
  }

  // On-chain (devnet) mint status for a token, from the seedMints queue.
  function chainMintHtml(token) {
    // Adopter cards already have the NFT mint — don't mirror the grower's mint queue.
    if (token.mintAddress) return '';
    if (!token.mintRequestId) return '';
    const SC = window.SeedChain;
    const mint = SC && typeof SC.getMint === 'function' ? SC.getMint(token.mintRequestId) : null;

    const rail =
      window.StatusRail && typeof StatusRail.mintPipeline === 'function'
        ? StatusRail.mintPipeline(mint)
        : '';

    if (mint && mint.status === 'minted' && mint.mintAddress) {
      const explorer =
        window.ChainConfig && window.ChainConfig.explorerAddress
          ? ChainConfig.explorerAddress(mint.mintAddress)
          : 'https://solscan.io/account/' + encodeURIComponent(mint.mintAddress) + '?cluster=devnet';
      return (
        rail +
        '<p class="adopt-token-chain adopt-token-chain--minted">⛓ Minted on devnet: ' +
        '<a href="' +
        esc(explorer) +
        '" target="_blank" rel="noopener noreferrer"><code>' +
        esc(shortAddr(mint.mintAddress)) +
        '</code></a>' +
        (mint.metadataUri
          ? ' · <a href="' +
            esc(mint.metadataUri) +
            '" target="_blank" rel="noopener noreferrer">metadata</a>'
          : '') +
        '</p>'
      );
    }
    if (mint && mint.status === 'failed') {
      return (
        rail +
        '<div class="adopt-token-chain adopt-token-chain--failed">' +
        '<button type="button" class="btn btn-ghost btn-sm adopt-retry-mint-btn" data-token-id="' +
        esc(token.id) +
        '">Retry mint</button>' +
        '<p class="adopt-mint-hint">Queues a new mint to your linked wallet. Connect the same Devnet wallet you want to own the NFT.</p>' +
        '</div>'
      );
    }
    if (rail) return rail;
    return '<p class="adopt-token-chain adopt-token-chain--pending">⛓ Devnet mint requested…</p>';
  }

  function isAdopterUi() {
    if (window.DnevnikProfile && typeof DnevnikProfile.isAdopter === 'function') {
      return DnevnikProfile.isAdopter();
    }
    return document.body.classList.contains('profile-adopter');
  }

  function renderAdopterSummary(wallet) {
    const el = document.getElementById('adopter-summary');
    if (!el) return;
    if (!isAdopterUi()) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    // Garden tokens for adopters are adopted / investment plants
    const count = (wallet.tokens || []).length;
    const growBal = Number(wallet.growthBalance || 0);
    const onchain =
      onchainGrowBalance != null ? onchainGrowBalance : null;
    const balLabel =
      onchain != null ? onchain.toLocaleString('en-US') : growBal.toLocaleString('en-US');
    const balMeta = onchain != null ? 'on-chain' : wallet.connected ? 'wallet' : 'connect to see';

    el.innerHTML =
      '<div class="adopter-summary-inner">' +
      '<div class="adopter-summary-stat">' +
      '<span class="adopter-summary-label">Adopted</span>' +
      '<div class="adopter-summary-row">' +
      '<strong class="adopter-summary-value">' +
      count +
      '</strong>' +
      '<span class="adopter-summary-meta">' +
      (count === 1 ? 'plant' : 'plants') +
      '</span>' +
      '</div>' +
      '</div>' +
      '<div class="adopter-summary-divider" aria-hidden="true"></div>' +
      '<div class="adopter-summary-stat">' +
      '<span class="adopter-summary-label">Balance</span>' +
      '<div class="adopter-summary-row">' +
      '<strong class="adopter-summary-value">' +
      esc(balLabel) +
      '</strong>' +
      '<span class="adopter-summary-meta">$GROWTOO · ' +
      esc(balMeta) +
      '</span>' +
      '</div>' +
      '</div>' +
      '<div class="adopter-summary-stat adopter-summary-stat--action">' +
      '<button type="button" class="btn btn-primary btn-sm" id="adopter-summary-market-btn">' +
      (count ? 'Adopt another' : 'Browse market') +
      '</button>' +
      '</div>' +
      '</div>';
  }

  var TOKENISE_EXPLAINER_KEY = 'dnevnik-live-tokenise-explainer-seen';

  function renderTokeniseExplainer() {
    const el = document.getElementById('tokenise-explainer');
    if (!el) return;
    if (isAdopterUi()) {
      el.hidden = true;
      return;
    }
    let seen = false;
    try {
      seen = localStorage.getItem(TOKENISE_EXPLAINER_KEY) === '1';
    } catch {
      seen = false;
    }
    el.hidden = seen;
    const dismiss = document.getElementById('tokenise-explainer-dismiss');
    if (dismiss && dismiss.dataset.bound !== '1') {
      dismiss.dataset.bound = '1';
      dismiss.addEventListener('click', function () {
        try {
          localStorage.setItem(TOKENISE_EXPLAINER_KEY, '1');
        } catch {
          // ignore
        }
        el.hidden = true;
      });
    }
  }

  function applyProfileChrome() {
    const marketCta = document.getElementById('adopt-market-cta');
    if (marketCta) {
      marketCta.hidden = !isAdopterUi();
    }
    const guide = document.getElementById('adopter-guide');
    if (guide) {
      guide.hidden = !isAdopterUi();
    }
    renderTokeniseExplainer();
  }

  function renderGarden(wallet) {
    const grid = document.getElementById('adopt-token-grid');
    if (!grid) return;
    if (!wallet.tokens.length) {
      if (isAdopterUi()) {
        const emptyCopy =
          window.GrowtooProfile && typeof window.GrowtooProfile.adopterIntentCopy === 'function'
            ? window.GrowtooProfile.adopterIntentCopy().empty
            : 'Browse the market and stake $GROWTOO when you are ready to support a grow.';
        grid.innerHTML =
          '<div class="empty-state adopt-empty-adopter">' +
          '<p class="adopt-empty-lead">No adopted plants yet</p>' +
          '<p class="adopt-empty-body">' +
          esc(emptyCopy) +
          '</p>' +
          '<ol class="adopt-empty-steps">' +
          '<li>Open Market and pick a live offer</li>' +
          '<li>Tap Invest and confirm with your Devnet wallet</li>' +
          '<li>The plant appears here after settlement</li>' +
          '</ol>' +
          '<button type="button" class="btn btn-primary" id="adopt-empty-market-btn">Browse market</button>' +
          '</div>';
      } else {
        grid.innerHTML = '<div class="empty-state">No tokens yet. Add a plant from Plants and turn on “also mint on-chain”, or use the advanced mint form above.</div>';
      }
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
      '<option value="">— choose a journal plant —</option>' +
      plants
        .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name || 'Plant') + '</option>')
        .join('');
    if (current) sel.value = current;
  }

  function syncSeedNameFromPlant() {
    const plantSel = document.getElementById('adopt-seed-plant');
    const nameEl = document.getElementById('adopt-seed-name');
    if (!plantSel || !nameEl) return;
    const plant = readPlants().find((p) => p && p.id === plantSel.value);
    if (!plant) return;
    const suggested = String(plant.name || '').trim().slice(0, 32);
    if (!suggested) return;
    // Prefill when empty or still matching the previous plant name pattern.
    if (!nameEl.value.trim() || nameEl.dataset.autofilled === '1') {
      nameEl.value = suggested;
      nameEl.dataset.autofilled = '1';
    }
  }

  function setBusy(state) {
    busy = state;
    const view = document.getElementById('view-adopt');
    if (view) view.classList.toggle('adopt-busy', state);
  }

  let renderAdoptBusy = false;
  let renderWalletUiBusy = false;

  function renderTestFaucetPanel() {
    const el = document.getElementById('test-faucet-panel');
    if (!el) return;
    if (!isAdopterUi()) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const amount =
      window.Market && Market.testFaucetAmount != null ? Number(Market.testFaucetAmount) : 100;
    const status =
      window.Market && typeof Market.testFaucetStatus === 'function'
        ? Market.testFaucetStatus()
        : null;
    let body =
      '<div class="test-faucet-card">' +
      '<div class="test-faucet-copy">' +
      '<strong>Test-network faucet</strong>' +
      '<p>Claim <strong>' +
      esc(String(amount)) +
      ' $GROWTOO</strong> once per UTC day to your connected wallet — enough to try Invest / adopt stake.</p>' +
      '</div>';

    if (status && status.status === 'minted') {
      body +=
        '<p class="adopt-token-chain adopt-token-chain--ok">Claimed today: <strong>+' +
        esc(String(status.reward || amount)) +
        ' $GROWTOO</strong>. Next claim after UTC midnight.</p>';
    } else if (status && status.status === 'pending') {
      body +=
        '<p class="market-hint">Faucet pending in the rewards queue… usually within a few minutes.</p>';
    } else if (status && status.status === 'failed') {
      body +=
        '<p class="market-card-error">' +
        esc(status.error || 'Claim failed') +
        '</p>' +
        '<button type="button" class="btn btn-primary btn-sm" id="test-faucet-claim-btn">Retry faucet</button>';
    } else {
      body +=
        '<button type="button" class="btn btn-primary btn-sm" id="test-faucet-claim-btn">Claim ' +
        esc(String(amount)) +
        ' $GROWTOO</button>';
    }
    body += '</div>';
    el.innerHTML = body;
  }

  function renderPlatformBonusPanel() {
    const el = document.getElementById('platform-bonus-panel');
    if (!el) return;
    if (isAdopterUi()) {
      el.innerHTML = '';
      return;
    }
    const monthKey =
      window.Market && typeof Market.currentMonthKey === 'function'
        ? Market.currentMonthKey()
        : new Date().toISOString().slice(0, 7);
    const status =
      window.Market && typeof Market.platformBonusStatus === 'function'
        ? Market.platformBonusStatus()
        : null;
    let body =
      '<p class="market-hint">Monthly activity bonus — earn up to <strong>50 $GROWTOO</strong> based on plants, seed mints, care weeks, and flowering progress. Platform-funded (Devnet).</p>' +
      '<details class="platform-bonus-disclosure">' +
      '<summary>How is this calculated?</summary>' +
      '<p>Base 5, plus points for new plants, seed mints, qualifying care weeks, and reaching flower — capped at 50 for ' +
      esc(monthKey) +
      '.</p>' +
      '</details>';
    if (status && status.status === 'minted') {
      body +=
        '<p class="adopt-token-chain adopt-token-chain--ok">Claimed this month: <strong>' +
        esc(String(status.reward || 0)) +
        ' $GROWTOO</strong>. Next claim opens next calendar month.</p>';
    } else if (status && status.status === 'pending') {
      body +=
        '<p class="market-hint">Claim pending in the platform rewards queue… Estimated reward: <strong>' +
        esc(String(status.reward || '…')) +
        ' $GROWTOO</strong></p>';
    } else if (status && status.status === 'failed') {
      body +=
        '<p class="market-card-error">' +
        esc(status.error || 'Claim failed') +
        '</p>' +
        '<button type="button" class="btn btn-primary btn-sm" id="platform-bonus-claim-btn">Retry claim</button>';
    } else {
      body +=
        '<p class="market-hint">You have an unclaimed monthly bonus available.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" id="platform-bonus-claim-btn">Claim this month’s bonus</button>';
    }
    el.innerHTML = body;
  }

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
      renderPlatformBonusPanel();
      renderTestFaucetPanel();
      renderAdopterSummary(wallet);
      if (seedSection) seedSection.hidden = !wallet.connected || isAdopterUi();
      // Adopters always see the garden (empty state guides them). Growers when connected/tokens.
      if (gardenSection) {
        gardenSection.hidden = isAdopterUi()
          ? false
          : !(wallet.connected || (wallet.tokens && wallet.tokens.length > 0));
      }
      applyProfileChrome();
      if (isAdopterUi() || wallet.connected || (wallet.tokens && wallet.tokens.length > 0)) {
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
        '\n\nIf a wallet is installed, unlock it, allow growto.live, then refresh this page.';
      if (confirm(hint + '\n\nBrowse Solana wallets?')) {
        window.open(window.ChainConfig.walletDownloadUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (window.DnevnikNotifications) DnevnikNotifications.toast(msg, 'error');
    else alert(msg);
  }

  function flashOk(msg) {
    if (window.DnevnikNotifications) DnevnikNotifications.toast(msg || 'Done.', 'success');
    else alert(msg || 'Done.');
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
    const existing = readWallet();
    // Already connected but not linked: don't re-open a dead Solflare popup —
    // go straight to the link signature (or tell the user to disconnect first).
    if (
      existing.connected &&
      existing.address &&
      window.WalletLink &&
      !WalletLink.isLinked()
    ) {
      await handleWalletLink(btn);
      return;
    }
    const original = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Choose wallet…';
    // Do not set global busy while the picker is open — Solflare may stay
    // pending until the user approves, cancels, or the timeout fires.
    try {
      const wallet = await PlantToken.connect();
      busy = true;
      render();
      renderGlobalWalletUI();
      if (
        wallet &&
        wallet.address &&
        window.DnevnikNotifications &&
        typeof DnevnikNotifications.clearWalletReconnectPrompt === 'function'
      ) {
        const uid =
          window.PlantToken && typeof PlantToken.getAccountUid === 'function'
            ? PlantToken.getAccountUid()
            : '';
        DnevnikNotifications.clearWalletReconnectPrompt(uid);
      }
      if (wallet && wallet.linkError) {
        const soft = /cancel|signature cancelled/i.test(String(wallet.linkError));
        const msg =
          'Wallet connected.\n\n' +
          wallet.linkError +
          (soft
            ? '\n\nSolflare stays connected — tap Link account and approve the signature (no new connect popup).'
            : '\n\nUse "Link account" to try again.');
        if (window.DnevnikNotifications) {
          DnevnikNotifications.toast(wallet.linkError, soft ? 'warn' : 'error');
        } else {
          alert(msg);
        }
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
    // Link is a post-connect step — never show it as a third "Connect" CTA when disconnected.
    if (!wallet.connected) return '';
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

  /** Header is status-only; Market may still offer a direct Connect for invest flows. */
  var HEADER_WALLET_VIEWS = { market: 1, admin: 1 };

  function currentAppViewId() {
    var active = document.querySelector('.view.active');
    if (!active || !active.id || active.id.indexOf('view-') !== 0) return '';
    return active.id.slice(5);
  }

  function headerNeedsWalletPrompt(wallet) {
    // Connect lives on the status chip click — never a second header button.
    return false;
  }

  function walletControlsHtml(variant) {
    syncWalletFromSolana();
    const wallet = readWallet();
    const compact = variant === 'compact';
    const profileHint = 'Each growtoo account links its own Solana wallet.';
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
          '<button type="button" class="wallet-status-chip wallet-status-chip--off wallet-status-connect" title="Connect wallet">' +
          'Wallet · Off' +
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

    if (compact) {
      return (
        '<div class="wallet-controls wallet-controls--compact">' +
        '<button type="button" class="wallet-status-chip wallet-status-chip--on wallet-goto-tokenise" title="' +
        esc(wallet.address || '') +
        '">' +
        'Wallet · ' +
        esc(shortAddr(wallet.address)) +
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
      if (headerBar) {
        headerBar.innerHTML = walletControlsHtml('compact');
        headerBar.hidden = !headerBar.innerHTML.trim();
      }

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
      const statusConnect = e.target.closest('.wallet-status-connect');
      if (statusConnect) {
        e.preventDefault();
        await handleWalletConnect(statusConnect);
        return;
      }
      const gotoTokenise = e.target.closest('.wallet-goto-tokenise');
      if (gotoTokenise) {
        e.preventDefault();
        if (typeof window.showAppView === 'function') window.showAppView('adopt');
        return;
      }
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

      const careBtn = e.target.closest('.adopt-care-btn');
      if (careBtn) {
        if (busy || careBtn.disabled) return;
        const action = careBtn.dataset.care;
        const tokenId = careBtn.dataset.tokenId;
        if (!action || !tokenId) return;
        setBusy(true);
        const original = careBtn.innerHTML;
        careBtn.textContent = '…';
        try {
          await runCareAction(action, tokenId);
          render();
        } catch (err) {
          flashError(err);
          careBtn.innerHTML = original;
        } finally {
          setBusy(false);
        }
        return;
      }

      const retryMintBtn = e.target.closest('.adopt-retry-mint-btn');
      if (retryMintBtn) {
        if (busy || retryMintBtn.disabled) return;
        const tokenId = retryMintBtn.dataset.tokenId;
        const wallet = readWallet();
        const token = wallet.tokens.find(function (t) {
          return t.id === tokenId;
        });
        if (!token || !token.mintRequestId || !window.SeedChain) {
          flashError(new Error('Mint request not found for this token.'));
          return;
        }
        if (!token.plantId) {
          flashError(new Error('Link a journal plant before retrying the mint.'));
          return;
        }
        setBusy(true);
        const original = retryMintBtn.textContent;
        retryMintBtn.textContent = 'Retrying…';
        retryMintBtn.disabled = true;
        try {
          const newId = await SeedChain.retrySeedMint(token.mintRequestId, {
            name: token.name,
            strain: token.strain || token.name,
            batch: token.batch,
            plantId: token.plantId,
          });
          if (!newId) throw new Error('Could not file a new mint request. Sign in and try again.');
          mutate(function (w) {
            const stored = w.tokens.find(function (t) {
              return t.id === tokenId;
            });
            if (stored) stored.mintRequestId = newId;
          });
          flashOk('Mint queued again. Keep this wallet connected until it shows “Minted on devnet”.');
          render();
        } catch (err) {
          flashError(err);
          retryMintBtn.textContent = original;
          retryMintBtn.disabled = false;
        } finally {
          setBusy(false);
        }
        return;
      }

      const harvestBtn = e.target.closest('.adopt-harvest-claim-btn');
      if (harvestBtn) {
        if (busy || harvestBtn.disabled) return;
        const listingId = harvestBtn.dataset.listingId;
        if (!listingId || !window.Market || typeof Market.requestHarvestClaim !== 'function') {
          flashError(new Error('Harvest claim is not available.'));
          return;
        }
        if (
          !confirm(
            'Claim harvest stake?\n\nIf every monthly care month qualifies (≥12 care days each), the locked 50% $GROWTOO releases to you. Otherwise it refunds to the adopter (all-or-nothing).'
          )
        ) {
          return;
        }
        setBusy(true);
        const original = harvestBtn.textContent;
        harvestBtn.textContent = 'Claiming…';
        try {
          await Market.requestHarvestClaim(listingId, harvestBtn.dataset.plantId || null);
          flashOk('Harvest claim submitted. Queue will settle release or refund.');
          if (window.DnevnikNotifications) {
            DnevnikNotifications.push({
              type: 'harvest_claim',
              title: 'Harvest claim filed',
              body: 'Waiting for monthly care proof settle.',
              meta: { key: 'hclaim-pending:' + listingId, listingId: listingId },
              action: { view: 'adopt' },
              kind: 'info',
              dedupKey: 'hclaim-pending:' + listingId,
              toast: false,
            });
          }
          render();
        } catch (err) {
          flashError(err);
          harvestBtn.textContent = original;
        } finally {
          setBusy(false);
        }
        return;
      }

      const platformBtn = e.target.closest('#platform-bonus-claim-btn');
      if (platformBtn) {
        if (busy || platformBtn.disabled) return;
        if (!window.Market || typeof Market.claimPlatformBonus !== 'function') {
          flashError(new Error('Platform bonus is not available.'));
          return;
        }
        setBusy(true);
        const original = platformBtn.textContent;
        platformBtn.textContent = 'Claiming…';
        try {
          await Market.claimPlatformBonus();
          flashOk('Platform bonus requested for this month.');
          if (window.DnevnikNotifications) {
            DnevnikNotifications.push({
              type: 'platform_bonus',
              title: 'Platform bonus claimed',
              body: 'Queue will mint $GROWTOO when scored.',
              meta: { key: 'platform-pending:' + (Market.currentMonthKey ? Market.currentMonthKey() : '') },
              action: { view: 'adopt' },
              kind: 'info',
              dedupKey: 'platform-pending:' + (Market.currentMonthKey ? Market.currentMonthKey() : ''),
              toast: false,
            });
          }
          renderPlatformBonusPanel();
        } catch (err) {
          flashError(err);
          platformBtn.textContent = original;
        } finally {
          setBusy(false);
        }
        return;
      }

      const faucetBtn = e.target.closest('#test-faucet-claim-btn');
      if (faucetBtn) {
        if (busy || faucetBtn.disabled) return;
        if (!window.Market || typeof Market.claimTestFaucet !== 'function') {
          flashError(new Error('Test faucet is not available.'));
          return;
        }
        setBusy(true);
        const original = faucetBtn.textContent;
        faucetBtn.textContent = 'Claiming…';
        try {
          const result = await Market.claimTestFaucet();
          flashOk(
            'Test faucet queued: +' +
              (result && result.amount ? result.amount : 100) +
              ' $GROWTOO. Mint usually lands within a few minutes.'
          );
          if (window.DnevnikNotifications) {
            DnevnikNotifications.push({
              type: 'test_faucet',
              title: 'Test faucet claimed',
              body: 'Queue is minting $GROWTOO to your Devnet wallet…',
              meta: { key: 'faucet-pending:' + (result && result.dayKey ? result.dayKey : '') },
              action: { view: 'market' },
              kind: 'info',
              dedupKey: 'faucet-pending:' + (result && result.dayKey ? result.dayKey : ''),
              toast: false,
            });
          }
          renderTestFaucetPanel();
        } catch (err) {
          flashError(err);
          faucetBtn.textContent = original;
        } finally {
          setBusy(false);
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

      const marketBtn = e.target.closest(
        '#adopt-open-market-btn, #adopter-guide-market-btn, #adopt-empty-market-btn, #adopter-summary-market-btn'
      );
      if (marketBtn) {
        const marketNav = document.querySelector('.nav-item[data-view="market"]');
        if (marketNav) marketNav.click();
        return;
      }

      const guideWalletBtn = e.target.closest('#adopter-guide-wallet-btn');
      if (guideWalletBtn) {
        const connectBtn = document.getElementById('adopt-connect-btn');
        if (connectBtn) {
          connectBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          connectBtn.focus();
          if (!busy) await handleWalletConnect(connectBtn);
        } else {
          const walletSec = document.getElementById('adopt-wallet');
          if (walletSec) walletSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
    });

    const seedForm = document.getElementById('adopt-seed-form');
    if (seedForm) {
      const plantSel = document.getElementById('adopt-seed-plant');
      const nameEl = document.getElementById('adopt-seed-name');
      if (plantSel && plantSel.dataset.bound !== '1') {
        plantSel.dataset.bound = '1';
        plantSel.addEventListener('change', syncSeedNameFromPlant);
      }
      if (nameEl && nameEl.dataset.bound !== '1') {
        nameEl.dataset.bound = '1';
        nameEl.addEventListener('input', function () {
          nameEl.dataset.autofilled = '0';
        });
      }
      seedForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const nameInput = document.getElementById('adopt-seed-name');
        const batchEl = document.getElementById('adopt-seed-batch');
        const plantSelect = document.getElementById('adopt-seed-plant');
        let plantId = plantSelect ? plantSelect.value : '';
        if (!plantId) {
          flashError(new Error('Choose a journal plant to link this token to.'));
          return;
        }
        const plant = readPlants().find((p) => p.id === plantId);
        let name = nameInput ? nameInput.value.trim() : '';
        if (!name && plant) name = String(plant.name || '').trim();
        if (!name) {
          flashError(new Error('Enter a token name (or pick a plant with a name).'));
          return;
        }
        const batch = batchEl ? batchEl.value.trim() : '';
        let strain = '';
        if (plant) strain = plant.strain || '';
        const submitBtn = seedForm.querySelector('button[type="submit"]');
        setBusy(true);
        if (submitBtn) submitBtn.textContent = 'Minting…';
        try {
          await PlantToken.importSeed({ name, strain, batch, plantId: plantId || null });
          seedForm.reset();
          if (nameInput) nameInput.dataset.autofilled = '0';
          render();
        } catch (err) {
          flashError(err);
        } finally {
          if (submitBtn) submitBtn.textContent = 'Mint seed token';
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
    renderTestFaucetPanel: renderTestFaucetPanel,

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
      const intentCopy =
        adopter && window.GrowtooProfile && typeof window.GrowtooProfile.adopterIntentCopy === 'function'
          ? window.GrowtooProfile.adopterIntentCopy()
          : null;
      const emptyCopy = adopter
        ? (intentCopy && intentCopy.empty) ||
          'Adopt your first plant from the market and track growth & $GROWTOO here.'
        : 'Mint your first seed to start the growth cycle and earn rewards at each stage.';

      if (!wallet.connected) {
        container.innerHTML =
          '<div class="metric-panel metric-panel--adopt">' +
          '<header class="metric-panel-head"><h2 class="metric-panel-title">' +
          esc(panelTitle) +
          '</h2></header>' +
          '<div class="dashboard-adopt-panel">' +
          '<div class="dashboard-adopt-visual">' +
          buildPlantGrowSvg(0, { hero: true, animate: true }) +
          '</div>' +
          '<div class="dashboard-adopt-copy">' +
          '<p>' +
          esc(
            adopter
              ? (intentCopy && intentCopy.empty) ||
                  'Browse the market and connect your wallet when you are ready to stake $GROWTOO.'
              : 'Open Tokenise to mint seeds. Connect your wallet when you are ready to sign.'
          ) +
          '</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-adopt-open">' +
          esc(adopter ? 'Browse market' : openLabel) +
          '</button>' +
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
                label: '$GROWTOO balance',
                value: Number(wallet.growthBalance || 0).toLocaleString('en-US'),
                meta: M.row('Wallet', esc(shortAddr(wallet.address)), 'metric-dot--teal'),
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
          buildPlantGrowSvg(0, { hero: true, animate: true }) +
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
          const tPct = Math.round((token.stageIndex / maxStage) * 100);
          return (
            '<div class="dashboard-adopt-token">' +
            '<div class="dashboard-adopt-token-visual">' +
            buildPlantGrowSvg(token.stageIndex, { compact: true }) +
            '</div>' +
            '<div class="dashboard-adopt-token-body">' +
            '<div class="dashboard-adopt-token-head">' +
            '<strong>' + esc(token.name) + '</strong>' +
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
                label: '$GROWTOO balance',
                value: Number(wallet.growthBalance || 0).toLocaleString('en-US'),
                meta: M.row('Top plant', esc(top.name), 'metric-dot--amber'),
                modifier: 'amber',
              }) +
              M.card({
                label: 'Plant tokens',
                value: String(wallet.tokens.length),
                meta: M.row('Growing', growing, 'metric-dot--teal'),
                modifier: 'teal',
              }) +
              M.card({
                label: 'Lead grow',
                value: pct + '%',
                meta: M.row(esc(stage.label), esc(top.strain || '—'), 'metric-dot--violet'),
                modifier: 'violet',
              }) +
              '</div>'
            : '') +
          '<div class="dashboard-adopt-panel dashboard-adopt-panel--active">' +
          '<div class="dashboard-adopt-visual">' +
          buildPlantGrowSvg(top.stageIndex, { hero: true, animate: true }) +
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
      if (openBtn) {
        openBtn.addEventListener('click', function () {
          if (!wallet.connected && adopter && window.showAppView) {
            window.showAppView('market');
            return;
          }
          if (typeof onOpen === 'function') onOpen();
        });
      }
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
  if (window.Market && typeof window.Market.onChange === 'function') {
    // Keep invest phase rails in sync with listing settlement status.
    window.Market.onChange(function () {
      try {
        render();
      } catch {
        // ignore
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderGlobalWalletUI);
  } else {
    renderGlobalWalletUI();
  }
})();
