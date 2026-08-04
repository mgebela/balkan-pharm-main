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

  /**
   * Early desk seeds reminted after empty metadata PDAs (see repair-broken-seed-metadata.js).
   * Stub mint → healthy replacement. Kept so Tokenise can hint even before seedMints sync.
   */
  const KNOWN_MINT_REPAIRS = [
    {
      stub: '5YXmrcsBjQh7naKgD6j6vjLTiYWmCWjBsg9k6TnNbKd4',
      mint: '6x5fcn5znp2BoDdjSKJ1JB2NFrYKaD6ozeK5MncGTLxW',
    },
    {
      stub: '76MGoms6RRjJgCbkM9NSCNVK67z76vGfWp33eZbY4YLz',
      mint: '4mZF55uLFB2qVTo9tpFrezp4hruaPmU6JQC8nhJh787d',
    },
    {
      stub: '6GxDhLgVWb8rL1ZURE2EfVLdEtMLD69wHVWqFDc1nezG',
      mint: '5LsCudbhC1ZYfjtPLpSyLVVzSYvDm8m1ss1KHXsMuYpB',
    },
    {
      stub: '4XbCLB2oJz7cmSAjKicRiCoyPTjvBi1XnY2ryFKt5bao',
      mint: 'DkDpWmdpENgx16sEx2dmxZu3STgkdo9JwKgiKv1bKfro',
    },
  ];
  const KNOWN_STUB_TO_MINT = Object.create(null);
  const KNOWN_MINT_TO_STUB = Object.create(null);
  KNOWN_MINT_REPAIRS.forEach(function (row) {
    KNOWN_STUB_TO_MINT[row.stub] = row.mint;
    KNOWN_MINT_TO_STUB[row.mint] = row.stub;
  });

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
          // Remint repair: garden still on stub mint → point at healthy replacement.
          if (
            m.replacedMint &&
            existing.mintAddress &&
            existing.mintAddress === m.replacedMint &&
            m.mintAddress !== existing.mintAddress
          ) {
            existing.mintAddress = m.mintAddress;
            existing.replacedMint = m.replacedMint;
            changed = true;
          } else if (
            existing.mintAddress &&
            KNOWN_STUB_TO_MINT[existing.mintAddress] &&
            KNOWN_STUB_TO_MINT[existing.mintAddress] === m.mintAddress
          ) {
            existing.replacedMint = existing.mintAddress;
            existing.mintAddress = m.mintAddress;
            changed = true;
          } else if (existing.mintAddress !== m.mintAddress) {
            existing.mintAddress = m.mintAddress;
            changed = true;
          }
          if (existing.mintRequestId !== requestId) {
            existing.mintRequestId = requestId;
            changed = true;
          }
          if (m.replacedMint && existing.replacedMint !== m.replacedMint) {
            existing.replacedMint = m.replacedMint;
            changed = true;
          }
          return;
        }

        let stageIndex = 0;
        if (typeof m.stageIndex === 'number') stageIndex = m.stageIndex;
        else if (m.stage) stageIndex = PlantToken.stageIndexFromLabel(m.stage);
        else if (/bloom|flower|harvest/i.test(String(m.name || ''))) stageIndex = 4;

        const now = Date.now();
        const row = {
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
        };
        if (m.replacedMint) row.replacedMint = m.replacedMint;
        else if (KNOWN_MINT_TO_STUB[m.mintAddress]) {
          row.replacedMint = KNOWN_MINT_TO_STUB[m.mintAddress];
        }
        wallet.tokens.unshift(row);
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
        if (!SC || !SC.isEnabled()) {
          result.onchainStatus = 'skipped';
          return result;
        }
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
            result.onchainStatus = 'queued';
          } else {
            result.onchainStatus = 'failed';
            result.onchainError = 'Mint queue did not accept the request.';
          }
        } catch (err) {
          // Local token still exists; on-chain mint can be retried later.
          console.warn('Devnet seed mint request failed', err);
          result.onchainStatus = 'failed';
          result.onchainError =
            (err && err.message) || 'Devnet mint request failed.';
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
        if (!SC || !SC.isEnabled()) {
          result.onchainStatus = 'skipped';
          return result;
        }
        const seedMint = token.mintRequestId ? SC.getMint(token.mintRequestId) : null;
        if (!seedMint || !seedMint.mintAddress) {
          // Local stage advanced; on-chain update waits until seed NFT exists.
          result.onchainStatus = 'pending_seed';
          result.onchainError =
            'Stage saved locally. On-chain mint waits until the seed NFT is minted — use Retry if needed.';
          return result;
        }
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
            result.growthRequestId = requestId;
            result.onchainStatus = 'queued';
          } else {
            result.onchainStatus = 'failed';
            result.onchainError = 'Growth mint queue did not accept the request.';
          }
        } catch (err) {
          console.warn('Devnet growth mint request failed', err);
          result.onchainStatus = 'failed';
          result.onchainError =
            (err && err.message) || 'Devnet growth mint request failed.';
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
    if (stageIndex >= GROWTH_STAGES.length - 1) return 'Trail complete · harvest sealed';
    const next = GROWTH_STAGES[stageIndex + 1];
    return 'Next seal → ' + next.label + ' (+' + next.reward + ' $GROWTOO)';
  }

  const TRAIL_SHORT = ['Seed', 'Germ.', 'Seedl.', 'Veget.', 'Flower', 'Harvest'];

  function renderGrowthGuide(activeStageIndex) {
    const el = document.getElementById('adopt-growth-guide');
    if (!el) return;

    const sealedAt = activeStageIndex >= 0 ? activeStageIndex : -1;
    const focusIdx =
      sealedAt < 0 ? 0 : Math.min(GROWTH_STAGES.length - 1, sealedAt + 1);
    // When fully sealed, focus the harvest bar as complete.
    const focus =
      sealedAt >= GROWTH_STAGES.length - 1 ? GROWTH_STAGES.length - 1 : focusIdx;
    const maxReward = GROWTH_STAGES.reduce(function (sum, s) {
      return sum + (Number(s.reward) || 0);
    }, 0);

    const bars = GROWTH_STAGES.map(function (s, i) {
      const height = 28 + Math.round((i / Math.max(1, GROWTH_STAGES.length - 1)) * 72);
      const done = sealedAt >= 0 && i <= sealedAt && i !== focus;
      const isCurrent = i === focus;
      const future = i > focus;
      const cls =
        'trail-bar' +
        (done ? ' trail-bar--done' : '') +
        (isCurrent ? ' trail-bar--current' : '') +
        (future ? ' trail-bar--future' : '');
      let caption = '';
      if (done) {
        caption = i === 0 ? '✓' : '✓ +' + s.reward;
      } else if (isCurrent) {
        caption = i === 0 ? 'Seed' : i === GROWTH_STAGES.length - 1 ? 'Harvest +' + s.reward : '+' + s.reward;
      } else if (i === GROWTH_STAGES.length - 1) {
        caption = 'Harvest +' + s.reward;
      } else {
        caption = '+' + s.reward;
      }
      return (
        '<div class="trail-col">' +
        '<div class="' +
        cls +
        '" style="height:' +
        height +
        '%" title="' +
        esc(s.label) +
        '"></div>' +
        '<span class="trail-col-label">' +
        esc(TRAIL_SHORT[i] || s.label) +
        '</span>' +
        '<span class="trail-col-cap' +
        (isCurrent || i === GROWTH_STAGES.length - 1 ? ' trail-col-cap--accent' : '') +
        '">' +
        esc(caption) +
        '</span>' +
        '</div>'
      );
    }).join('');

    el.innerHTML =
      '<p class="shell-card-eyebrow">The trail ahead</p>' +
      '<div class="trail-chart" role="img" aria-label="Stage rewards from seed to harvest">' +
      bars +
      '</div>' +
      '<p class="trail-foot">Each sealed stage earns $GROWTOO — up to ' +
      maxReward +
      ' by harvest. Test network; no monetary value.</p>';
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

  /** Thin-stroke glyphs matching the nav/icon language. */
  const GROUPED_ICONS = {
    nft: '<svg viewBox="0 0 24 24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 3v18M5 7l7 4 7-4"/></svg>',
    card: '<svg viewBox="0 0 24 24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2.4"/><path d="M3.5 10h17"/></svg>',
  };

  /**
   * One grouped-list row: tinted icon, label, value.
   * A chevron is only rendered when the row genuinely drills out (a link).
   */
  function groupedRowHtml(icon, label, valueHtml, isLink) {
    return (
      '<div class="grouped-list-row">' +
      '<span class="grouped-list-icon" aria-hidden="true">' +
      (GROUPED_ICONS[icon] || '') +
      '</span>' +
      '<span class="grouped-list-label">' +
      esc(label) +
      '</span>' +
      '<span class="grouped-list-value">' +
      valueHtml +
      (isLink ? '<span class="grouped-list-chevron" aria-hidden="true">&rsaquo;</span>' : '') +
      '</span>' +
      '</div>'
    );
  }

  /** Collapsible mint / explorer chrome for garden cards. */
  function chainDetailsHtml(innerHtml, opts) {
    if (!innerHtml) return '';
    const o = opts || {};
    const advanced =
      window.GrowtooPlain && typeof GrowtooPlain.getMode === 'function'
        ? GrowtooPlain.getMode() === 'advanced'
        : false;
    const open = o.forceOpen === true || (advanced && o.forceClosed !== true);
    return (
      '<details class="chain-details"' +
      (open ? ' open' : '') +
      '>' +
      '<summary class="chain-details-summary">' +
      esc(o.summary || 'Chain details') +
      '</summary>' +
      '<div class="chain-details-body">' +
      innerHtml +
      '</div>' +
      '</details>'
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
    // Wallet status lives in the header pill — hide the old triple-CTA panel.
    el.innerHTML = '';
    el.hidden = true;
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

  /**
   * Detect reminted stub vs healthy replacement for Tokenise desk hints.
   * Returns { kind: 'stub'|'replacement', stubMint, mint } or null.
   */
  function resolveMintRepair(token) {
    if (!token || !token.mintAddress) return null;
    const mint = String(token.mintAddress);

    // Card still points at the empty-metadata stub.
    let replacement = KNOWN_STUB_TO_MINT[mint] || '';
    if (!replacement && window.SeedChain && typeof SeedChain.getMints === 'function') {
      const all = SeedChain.getMints() || {};
      Object.keys(all).some(function (id) {
        const rec = all[id];
        if (rec && String(rec.replacedMint || '') === mint && rec.mintAddress) {
          replacement = String(rec.mintAddress);
          return true;
        }
        return false;
      });
    }
    if (replacement) {
      return { kind: 'stub', stubMint: mint, mint: replacement };
    }

    // Healthy remint — show which stub it replaced.
    let stub = token.replacedMint ? String(token.replacedMint) : '';
    if (!stub && token.mintRequestId && window.SeedChain) {
      const rec = SeedChain.getMint(token.mintRequestId);
      if (rec && rec.replacedMint) stub = String(rec.replacedMint);
    }
    if (!stub && window.SeedChain && typeof SeedChain.getMints === 'function') {
      const all = SeedChain.getMints() || {};
      Object.keys(all).some(function (id) {
        const rec = all[id];
        if (rec && rec.mintAddress === mint && rec.replacedMint) {
          stub = String(rec.replacedMint);
          return true;
        }
        return false;
      });
    }
    if (!stub && KNOWN_MINT_TO_STUB[mint]) stub = KNOWN_MINT_TO_STUB[mint];
    if (stub && stub !== mint) {
      return { kind: 'replacement', stubMint: stub, mint: mint };
    }
    return null;
  }

  function replacedMintHtml(token) {
    const repair = resolveMintRepair(token);
    if (!repair) return '';
    if (repair.kind === 'stub') {
      return (
        '<div class="adopt-mint-repair adopt-mint-repair--stub" role="status">' +
        '<strong>Broken metadata stub</strong>' +
        '<p>This mint was reminted as <a href="' +
        esc(explorerAddressUrl(repair.mint)) +
        '" target="_blank" rel="noopener noreferrer"><code>' +
        esc(shortAddr(repair.mint)) +
        '</code></a>. Use <em>Burn</em> to remove this card — hide the empty Collectible in Phantom if it still shows.</p>' +
        '</div>'
      );
    }
    return (
      '<div class="adopt-mint-repair adopt-mint-repair--ok" role="status">' +
      '<strong>Replaces stub mint</strong>' +
      '<p>Earlier empty-metadata NFT <a href="' +
      esc(explorerAddressUrl(repair.stubMint)) +
      '" target="_blank" rel="noopener noreferrer"><code>' +
      esc(shortAddr(repair.stubMint)) +
      '</code></a> may still sit in your wallet Collectibles — safe to hide; this card is the live one.</p>' +
      '</div>'
    );
  }

  function tokenCardHtml(token) {
    const stage = GROWTH_STAGES[token.stageIndex] || GROWTH_STAGES[0];
    const isMax = token.stageIndex >= GROWTH_STAGES.length - 1;
    const next = isMax ? null : GROWTH_STAGES[token.stageIndex + 1];
    const earned = (token.history || [])
      .filter((h) => h.type === 'growth')
      .reduce((sum, h) => sum + Number(h.amount || 0), 0);
    const nameNorm = String(token.name || '').trim().toLowerCase();
    const strainNorm = String(token.strain || '').trim().toLowerCase();
    const showStrain = strainNorm && strainNorm !== nameNorm;
    const stakeListing =
      token.mintAddress && window.Market && typeof Market.findAdoptStakeForMint === 'function'
        ? Market.findAdoptStakeForMint(token.mintAddress)
        : null;
    const liveStageLabel =
      (token.adopted || isAdopterUi()) && stakeListing
        ? stakeListing.liveStage || stakeListing.stage || ''
        : '';
    const stageBadgeLabel = liveStageLabel || stage.label;
    let displayStageIndex = token.stageIndex;
    if (liveStageLabel && typeof PlantToken.stageIndexFromLabel === 'function') {
      const liveIdx = PlantToken.stageIndexFromLabel(
        stakeListing.liveStageKey || liveStageLabel
      );
      if (liveIdx > 0 || /seed|germination|harvest|flower|veget/i.test(liveStageLabel)) {
        displayStageIndex = liveIdx;
      }
    }
    const pct = progressPercent(displayStageIndex);
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
      const cls = i < displayStageIndex ? 'done' : i === displayStageIndex ? 'current' : 'todo';
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
              ? 'Seed sealed'
              : 'Sealed ' + (GROWTH_STAGES.find((s) => s.key === h.stage) || {}).label;
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

    const stageKey = GROWTH_STAGES[displayStageIndex] ? GROWTH_STAGES[displayStageIndex].key : 'seed';
    const questCounts = (function () {
      if (isAdopterUi() || !next || !window.GrowerQuests) return null;
      const q = GrowerQuests.evaluateGrowthQuest(token, next.key);
      const items = q && q.items ? q.items : [];
      return { done: items.filter((i) => i.ok).length, total: items.length };
    })();
    const dayCount = (function () {
      const since = (linkedPlant && linkedPlant.startDate) || token.createdAt;
      if (!since) return null;
      const ms = Date.now() - new Date(since).getTime();
      return ms >= 0 ? Math.floor(ms / 86400000) : null;
    })();

    return (
      '<article class="adopt-token-card' + (isMax ? ' adopt-token-card--grown' : '') + '" data-id="' + esc(token.id) + '" data-stage="' + displayStageIndex + '" data-stage-key="' + esc(stageKey) + '">' +
      '<div class="adopt-token-banner adopt-token-banner--art">' +
      buildPlantGrowSvg(displayStageIndex, { compact: true }) +
      (plantPhoto
        ? '<img class="adopt-token-banner-chip" src="' + esc(plantPhoto) + '" alt="" />'
        : '') +
      '<span class="adopt-stage-badge adopt-token-banner-badge">' + esc(stageBadgeLabel) + '</span>' +
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
      (isAdopterUi() || token.adopted ? '' : chainMintHtml(token)) +
      // Card-level summary — glanceable, matches what used to require opening
      // the full checklist below just to see "how close am I".
      '<div class="adopt-token-statrow">' +
      (dayCount != null ? '<span>Day ' + dayCount + '</span><span class="sep">·</span>' : '') +
      (questCounts ? '<span>' + questCounts.done + '/' + questCounts.total + ' quests</span>' : '') +
      rankBadgeHtml(token) +
      '</div>' +
      careToolsHtml(token, next) +
      '<div class="adopt-token-actions">' +
      (token.adopted
        ? '<button type="button" class="btn btn-ghost btn-sm adopt-action-primary" disabled>' +
          esc(investActionLabel(token)) +
          '</button>'
        : isMax
          ? '<button type="button" class="btn btn-ghost btn-sm adopt-action-primary" disabled>Fully grown</button>'
          : mintButtonHtml(token, next)) +
      '</div>' +
      '<div class="adopt-progress"><div class="adopt-progress-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="adopt-stage-track">' + dots + '</div>' +
      '<div class="adopt-token-stats">' +
      '<span>' +
      (token.adopted ? 'Invested' : 'Earned') +
      ': <strong>' +
      (token.adopted ? Number(token.investedGrow || 0) : earned) +
      ' $GROWTOO</strong></span>' +
      '</div>' +
      // Everything below is reference/secondary — the full quest checklist,
      // weekly/monthly/stake status, chain/mint specifics, and History/
      // Journal/Burn. Grouped behind one "grow trail" toggle so the card
      // leads with identity + today's actions, same idea as the Progress &
      // stake details dropdown, just extended to the whole card.
      '<details class="adopt-token-trail">' +
      '<summary class="adopt-token-trail-summary">Show grow trail</summary>' +
      '<div class="adopt-token-trail-body">' +
      growerQuestHtml(token, next) +
      (function () {
        // Force open when there's a real claim button inside, so an
        // actionable "Claim locked stake" is never left an extra tap deep.
        // Deliberately NOT chainDetailsHtml/.chain-details — that class is
        // fully display:none in crypto-simple mode, which would hide a real
        // claim action, not just collapse it.
        const stakeHtml = adoptStakeActionsHtml(token);
        const body = careWeekHtml(token) + careMonthHtml(token) + stakeHtml + redeemComingLaterHtml(token);
        if (!body) return '';
        const hasClaimAction = stakeHtml.indexOf('adopt-harvest-claim-btn') !== -1;
        return (
          '<details class="progress-details"' +
          (hasClaimAction ? ' open' : '') +
          '>' +
          '<summary class="progress-details-summary">Progress &amp; stake details</summary>' +
          '<div class="progress-details-body">' +
          body +
          '</div>' +
          '</details>'
        );
      })() +
      chainDetailsHtml(
        (isAdopterUi() || token.adopted ? chainMintHtml(token) : '') +
          replacedMintHtml(token) +
          '<div class="grouped-list">' +
          (token.mintAddress
            ? groupedRowHtml(
                'nft',
                'NFT',
                '<a href="' +
                  esc(explorerAddressUrl(token.mintAddress)) +
                  '" target="_blank" rel="noopener noreferrer"><code>' +
                  esc(shortAddr(token.mintAddress)) +
                  '</code></a>',
                true
              )
            : '') +
          groupedRowHtml(
            'card',
            'Card id',
            '<code title="' + esc(token.id) + '">#' + esc(token.id.slice(-6)) + '</code>',
            false
          ) +
          '</div>',
        {
          // Simple: hidden via CSS. Advanced: open so mint / explorer are visible.
          summary: 'Chain details',
        }
      ) +
      '<div class="adopt-token-actions-secondary">' +
      '<button type="button" class="btn btn-ghost btn-sm adopt-history-btn" data-id="' + esc(token.id) + '">History</button>' +
      (token.plantId && !isAdopterUi()
        ? '<button type="button" class="btn btn-ghost btn-sm adopt-open-journal-btn" data-plant-id="' +
          esc(token.plantId) +
          '">Journal</button>'
        : '') +
      '<button type="button" class="btn btn-ghost btn-sm adopt-burn-btn" data-id="' + esc(token.id) + '">Burn</button>' +
      '</div>' + // .adopt-token-actions-secondary
      '</div>' + // .adopt-token-trail-body
      '</details>' + // .adopt-token-trail
      '</div>' + // .adopt-token-body
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

  function adoptUnlockMeter(done, total) {
    const t = Math.max(1, Number(total) || 1);
    const d = Math.max(0, Math.min(t, Number(done) || 0));
    const pct = Math.round((d / t) * 100);
    return (
      '<div class="adopt-unlock-meter" role="progressbar" aria-valuemin="0" aria-valuemax="' +
      t +
      '" aria-valuenow="' +
      d +
      '">' +
      '<span class="adopt-unlock-meter-fill" style="width:' +
      pct +
      '%"></span>' +
      '</div>'
    );
  }

  /** YYYY-MM → Jul / Jul ’26 */
  function formatMonthKeyLabel(key) {
    const m = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return String(key || '');
    const names = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const month = names[parseInt(m[2], 10) - 1] || m[2];
    const year = parseInt(m[1], 10);
    const nowY = new Date().getUTCFullYear();
    return year === nowY ? month : month + ' ’' + String(year).slice(-2);
  }

  /**
   * Month path story for adopters: Jul qualify · Aug 4/12 · Sep —
   */
  function careUnlockTimelineHtml(listing) {
    if (!listing) return '';
    let keys = Array.isArray(listing.careMonthKeys) ? listing.careMonthKeys.slice() : [];
    if (
      !keys.length &&
      listing.harvestProofSummary &&
      Array.isArray(listing.harvestProofSummary.monthKeys)
    ) {
      keys = listing.harvestProofSummary.monthKeys.slice();
    }
    if (!keys.length && window.GrowerQuests && typeof GrowerQuests.enumerateMonthKeys === 'function') {
      const adoptedAt = listing.adoptedAt || listing.soldAt || listing.investedAt;
      const fromMs = adoptedAt ? Date.parse(adoptedAt) : NaN;
      if (Number.isFinite(fromMs)) {
        keys = GrowerQuests.enumerateMonthKeys(fromMs, Date.now());
      }
    }
    if (!keys.length) return '';

    const qualify = Object.create(null);
    (Array.isArray(listing.qualifyingMonthKeys) ? listing.qualifyingMonthKeys : []).forEach(
      function (k) {
        if (k) qualify[String(k)] = true;
      }
    );
    const cur = listing.currentMonthKey != null ? String(listing.currentMonthKey) : '';
    const hasSync =
      listing.currentMonthKey != null && listing.currentMonthDaysHit != null;
    const daysHit = hasSync ? Number(listing.currentMonthDaysHit) || 0 : 0;
    const minDays =
      listing.currentMonthMinDays != null
        ? Number(listing.currentMonthMinDays)
        : (window.GrowerQuests && GrowerQuests.MONTHLY_CARE_MIN_DAYS) || 12;

    const items = keys
      .map(function (rawKey) {
        const key = String(rawKey);
        const label = formatMonthKeyLabel(key);
        let state = 'todo';
        let detail = '—';
        if (qualify[key]) {
          state = 'ok';
          detail = 'qualify';
        } else if (cur && key === cur) {
          if (!hasSync) {
            state = 'lag';
            detail = 'sync…';
          } else if (daysHit >= minDays) {
            state = 'ok';
            detail = daysHit + '/' + minDays;
          } else {
            state = 'current';
            detail = daysHit + '/' + minDays;
          }
        } else if (cur && key < cur) {
          state = 'short';
          detail = 'short';
        }
        return (
          '<li class="adopt-unlock-tl-item adopt-unlock-tl-item--' +
          state +
          '"' +
          (key === cur ? ' aria-current="step"' : '') +
          '>' +
          '<span class="adopt-unlock-tl-dot" aria-hidden="true"></span>' +
          '<span class="adopt-unlock-tl-label">' +
          esc(label) +
          '</span>' +
          '<span class="adopt-unlock-tl-detail">' +
          esc(detail) +
          '</span>' +
          '</li>'
        );
      })
      .join('');

    return (
      '<ol class="adopt-unlock-timeline" aria-label="Care month path">' + items + '</ol>'
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
      const status = String(listing.careStatus || 'active');
      const months = Array.isArray(listing.qualifyingMonthKeys)
        ? listing.qualifyingMonthKeys.length
        : 0;
      let needed = null;
      if (Array.isArray(listing.careMonthKeys) && listing.careMonthKeys.length) {
        needed = listing.careMonthKeys.length;
      } else if (
        listing.harvestProofSummary &&
        Array.isArray(listing.harvestProofSummary.monthKeys)
      ) {
        needed = listing.harvestProofSummary.monthKeys.length;
      } else {
        const adoptedAt = listing.adoptedAt || listing.soldAt || listing.investedAt;
        if (adoptedAt && typeof GrowerQuests.enumerateMonthKeys === 'function') {
          const fromMs = Date.parse(adoptedAt);
          if (Number.isFinite(fromMs)) {
            needed = GrowerQuests.enumerateMonthKeys(fromMs, Date.now()).length || 1;
          }
        }
      }
      const neededNum = Number(needed);
      const neededLabel = Number.isFinite(neededNum) && neededNum > 0 ? neededNum : '…';
      const minDays =
        listing.currentMonthMinDays != null
          ? Number(listing.currentMonthMinDays)
          : GrowerQuests.MONTHLY_CARE_MIN_DAYS || 12;
      const hasMonthSync =
        listing.currentMonthKey != null && listing.currentMonthDaysHit != null;
      const daysHit = hasMonthSync ? Number(listing.currentMonthDaysHit) || 0 : null;
      const stageLabel = listing.liveStage || listing.stage || '';
      const locked =
        listing.lockedGrow != null
          ? Number(listing.lockedGrow)
          : Math.floor(Number(listing.priceGrow || 0) / 2);
      const syncedAt = listing.careProgressUpdatedAt
        ? Date.parse(listing.careProgressUpdatedAt)
        : NaN;
      const syncLag =
        status === 'active' &&
        (!hasMonthSync ||
          !Number.isFinite(syncedAt) ||
          Date.now() - syncedAt > 2 * 60 * 60 * 1000);

      let statusTone = 'active';
      let statusCopy = 'Care stake active';
      if (status === 'released') {
        statusTone = 'released';
        statusCopy = 'Unlocked — locked half paid to grower';
      } else if (status === 'refunded') {
        statusTone = 'refunded';
        statusCopy = 'Refunded — locked half returned to you';
      } else if (syncLag) {
        statusTone = 'lag';
        statusCopy = 'Waiting for care sync';
      }

      const monthMeter =
        Number.isFinite(neededNum) && neededNum > 0
          ? adoptUnlockMeter(months, neededNum)
          : '';
      const dayMeter = hasMonthSync ? adoptUnlockMeter(daysHit, minDays) : '';

      return (
        '<div class="adopt-unlock-panel adopt-unlock-panel--' +
        esc(statusTone) +
        '" aria-label="Monthly care unlock">' +
        '<div class="adopt-unlock-head">' +
        '<strong>Care unlock</strong>' +
        '<span class="adopt-unlock-status">' +
        esc(statusCopy) +
        '</span>' +
        '</div>' +
        careUnlockTimelineHtml(listing) +
        '<div class="adopt-unlock-grid">' +
        (stageLabel
          ? '<div class="adopt-unlock-row">' +
            '<span class="adopt-unlock-label">Stage</span>' +
            '<strong class="adopt-unlock-value">' +
            esc(String(stageLabel)) +
            (listing.harvestReady ? ' · harvest ready' : '') +
            '</strong>' +
            '</div>'
          : '') +
        '<div class="adopt-unlock-row">' +
        '<span class="adopt-unlock-label">Path</span>' +
        '<strong class="adopt-unlock-value">' +
        esc(String(months)) +
        '/' +
        esc(String(neededLabel)) +
        ' months qualify</strong>' +
        monthMeter +
        '</div>' +
        (locked
          ? '<div class="adopt-unlock-row">' +
            '<span class="adopt-unlock-label">Locked</span>' +
            '<strong class="adopt-unlock-value">' +
            esc(String(locked)) +
            ' $GROWTOO</strong>' +
            '</div>'
          : '') +
        '</div>' +
        (hasMonthSync || syncLag
          ? '<div class="adopt-unlock-current">' +
            '<p>' +
            (hasMonthSync
              ? 'This month <strong>' +
                esc(formatMonthKeyLabel(listing.currentMonthKey)) +
                '</strong>: ' +
                esc(String(daysHit)) +
                '/' +
                esc(String(minDays)) +
                ' care days'
              : 'This month: waiting for care sync') +
            '</p>' +
            (hasMonthSync ? dayMeter : '') +
            '</div>'
          : '') +
        '<p class="adopt-unlock-foot">' +
        (status === 'active'
          ? syncLag
            ? 'Progress updates after the adopt queue runs (about every 5 minutes).'
            : 'All months need ≥12 care days. Locked half releases to the grower only if every month qualifies at harvest — otherwise it refunds to you.'
          : status === 'released'
            ? 'Harvest claim settled in the grower’s favor.'
            : 'Harvest claim settled — your locked stake was returned.') +
        '</p>' +
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
    if (!listing) return '';
    const care = String(listing.careStatus || '');
    if (care !== 'active' && care !== 'released' && care !== 'refunded') return '';

    const claim =
      typeof Market.getHarvestClaim === 'function' ? Market.getHarvestClaim(listing.id) : null;
    const claimRail =
      window.StatusRail && typeof StatusRail.harvestClaimPipeline === 'function'
        ? StatusRail.harvestClaimPipeline({ claim: claim, listing: listing })
        : '';

    if (care === 'released' || care === 'refunded') {
      return (
        '<div class="adopt-stake-panel">' +
        claimRail +
        '<p class="adopt-care-hint">Locked stake settled · ' +
        esc(care) +
        '.</p>' +
        '</div>'
      );
    }

    const locked =
      listing.lockedGrow != null
        ? listing.lockedGrow
        : Math.floor(Number(listing.priceGrow || 0) / 2);
    const isHarvest =
      listing.harvestReady === true ||
      listing.liveStageKey === 'harvest' ||
      token.stageIndex >= GROWTH_STAGES.length - 1 ||
      (GROWTH_STAGES[token.stageIndex] && GROWTH_STAGES[token.stageIndex].key === 'harvest');
    const claimPending = !!(claim && (claim.status === 'pending' || claim.optimisticPending));
    let pathMsg = '';
    if (token.plantId && window.GrowerQuests && listing.adoptedAt) {
      const path = GrowerQuests.validateHarvestCarePath(token.plantId, listing.adoptedAt);
      pathMsg =
        (path.qualifyingMonthKeys || []).length +
        '/' +
        (path.monthKeys || []).length +
        ' months qualify';
    }
    const stageHint = listing.liveStage ? ' · stage ' + listing.liveStage : '';
    return (
      '<div class="adopt-stake-panel">' +
      claimRail +
      '<p class="adopt-care-hint">Adopt stake locked: <strong>' +
      esc(String(locked)) +
      ' $GROWTOO</strong>' +
      (pathMsg ? ' · ' + esc(pathMsg) : '') +
      (stageHint ? esc(stageHint) : '') +
      '</p>' +
      (claimPending
        ? '<p class="adopt-care-hint">Claim queued — waiting for the adopt worker.</p>'
        : isHarvest
          ? '<button type="button" class="btn btn-primary btn-sm adopt-harvest-claim-btn" data-listing-id="' +
            esc(listing.id) +
            '" data-plant-id="' +
            esc(token.plantId || '') +
            '">Claim locked stake ($GROWTOO)</button>' +
            '<p class="adopt-care-hint">Settles locked $GROWTOO only — physical harvest redemption is coming later.</p>'
          : '<p class="adopt-care-hint">Reach harvest stage to claim the locked $GROWTOO half (all months must qualify).</p>') +
      '</div>'
    );
  }

  function redeemComingLaterHtml(token) {
    const atHarvest =
      token.stageIndex >= GROWTH_STAGES.length - 1 ||
      (GROWTH_STAGES[token.stageIndex] && GROWTH_STAGES[token.stageIndex].key === 'harvest');
    const listing =
      token.mintAddress && window.Market && typeof Market.findAdoptStakeForMint === 'function'
        ? Market.findAdoptStakeForMint(token.mintAddress)
        : null;
    const liveHarvest =
      listing &&
      (listing.harvestReady === true ||
        listing.liveStageKey === 'harvest' ||
        /harvest|susenje|drying/i.test(String(listing.liveStage || '')));
    if (!atHarvest && !liveHarvest) return '';
    return (
      '<div class="adopt-redeem-later" role="status">' +
      '<strong>Redeem physical harvest</strong>' +
      '<span>Coming later</span>' +
      '<p>Not available on Devnet. Care unlock and locked-stake claim are the practice path today.</p>' +
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
      // Environment/Transplant/Stress note are occasional, not daily — reach
      // them via "All tools" (Toolbox has a dedicated section for each)
      // instead of every card carrying all 8 buttons inline.
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
        '>Log care to seal → ' +
        esc(next.label) +
        '</button>'
      );
    }
    return (
      '<button type="button" class="btn btn-primary btn-sm adopt-mint-btn adopt-action-primary" data-id="' +
      esc(token.id) +
      '">Seal → ' +
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

  function linkedWalletPubkey() {
    try {
      if (window.WalletLink && typeof WalletLink.getProfile === 'function') {
        return String((WalletLink.getProfile() || {}).solanaPubkey || '');
      }
    } catch {
      // ignore
    }
    return '';
  }

  /** Intro complete once the garden has an adopted plant (wallet link optional). */
  function adopterIntroComplete(wallet) {
    const w = wallet || readWallet() || {};
    if (Array.isArray(w.tokens) && w.tokens.length > 0) return true;
    try {
      if (window.Market && typeof Market.getListings === 'function') {
        const uid =
          (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) ||
          accountUid ||
          '';
        if (uid) {
          const mine = (Market.getListings() || []).some(function (l) {
            return (
              l &&
              l.buyerUid === uid &&
              (l.status === 'sold' || l.status === 'sale_pending')
            );
          });
          if (mine) return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  }

  function applyProfileChrome(wallet) {
    const marketCta = document.getElementById('adopt-market-cta');
    if (marketCta) {
      marketCta.hidden = !isAdopterUi();
    }
    const guide = document.getElementById('adopter-guide');
    if (guide) {
      const w = wallet || readWallet() || {};
      const hasWallet = !!(w.connected || w.address || linkedWalletPubkey());
      const introDone = adopterIntroComplete(w);
      // Intro only — hide as soon as a plant is in the garden / adopted.
      guide.hidden = !isAdopterUi() || introDone;
      const guideWalletBtn = document.getElementById('adopter-guide-wallet-btn');
      if (guideWalletBtn) {
        guideWalletBtn.hidden = guide.hidden || hasWallet;
      }
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
          '<div class="empty-state empty-state--next adopt-empty-adopter">' +
          '<p class="adopt-empty-lead">No adopted plants yet</p>' +
          '<p class="adopt-empty-body">' +
          esc(emptyCopy) +
          '</p>' +
          '<button type="button" class="btn btn-primary" id="adopt-empty-market-btn">Browse market</button>' +
          '</div>';
      } else {
        grid.innerHTML =
          '<div class="empty-state empty-state--next">' +
          '<p class="adopt-empty-lead">No sealed plants yet</p>' +
          '<p class="adopt-empty-body">Pick a journal plant and seal the first stage to mint your RWA.</p>' +
          '<button type="button" class="btn btn-primary" id="adopt-empty-seal-btn">Seal a stage</button>' +
          '</div>';
      }
      return;
    }
    grid.innerHTML = wallet.tokens.map(tokenCardHtml).join('');
  }

  function journalStageLabel(plant) {
    const key = plant && plant.stage ? String(plant.stage) : '';
    const map = {
      klijanje: 'germination',
      sadnica: 'seedling',
      vegetativna: 'vegetative',
      cvjetanje: 'flowering',
      susenje: 'harvest',
    };
    if (map[key]) return map[key];
    const tokenKey = PLANT_STAGE_TO_TOKEN[key];
    if (tokenKey) return tokenKey;
    return key || 'growing';
  }

  function plantDayCount(plant) {
    if (!plant) return null;
    const raw =
      (plant.stageDates && plant.stage && plant.stageDates[plant.stage]) ||
      plant.startDate ||
      plant.createdAt ||
      '';
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  function plantSpecimenNo(index) {
    const n = String((index || 0) + 1);
    return n.length >= 4 ? n : ('0000' + n).slice(-4);
  }

  function tokenForPlant(wallet, plantId) {
    if (!wallet || !plantId) return null;
    return (wallet.tokens || []).find(function (t) {
      return t && t.plantId === plantId;
    }) || null;
  }

  function sealActionForPlant(plant, wallet) {
    if (!plant) return null;
    const token = tokenForPlant(wallet, plant.id);
    if (!token) {
      return {
        kind: 'seed',
        stage: GROWTH_STAGES[0],
        label: 'Seal seed stage · +0 $GROWTOO',
        token: null,
      };
    }
    const nextIdx = Number(token.stageIndex || 0) + 1;
    if (nextIdx >= GROWTH_STAGES.length) {
      return {
        kind: 'done',
        stage: GROWTH_STAGES[GROWTH_STAGES.length - 1],
        label: 'Trail complete',
        token: token,
      };
    }
    const next = GROWTH_STAGES[nextIdx];
    let ready = true;
    let lockMsg = '';
    if (window.GrowerQuests) {
      const quest = GrowerQuests.evaluateGrowthQuest(token, next.key);
      ready = !!quest.ready;
      lockMsg = quest.message || '';
    }
    return {
      kind: 'growth',
      stage: next,
      label: 'Seal ' + String(next.label || '').toLowerCase() + ' stage · +' + next.reward + ' $GROWTOO',
      token: token,
      ready: ready,
      lockMsg: lockMsg,
    };
  }

  function fillSeedPlantOptions() {
    const sel = document.getElementById('adopt-seed-plant');
    if (!sel) return;
    const plants = readPlants();
    const current = sel.value;
    sel.innerHTML =
      '<option value="">Choose a plant from your journal</option>' +
      plants
        .map(function (p, i) {
          const stage = journalStageLabel(p);
          const day = plantDayCount(p);
          const dayBit = day == null ? '' : ', day ' + day;
          const label =
            (p.name || 'Plant') +
            ' №' +
            plantSpecimenNo(i) +
            ' — ' +
            stage +
            dayBit;
          return '<option value="' + esc(p.id) + '">' + esc(label) + '</option>';
        })
        .join('');
    if (current) sel.value = current;
    syncSealStageCta();
  }

  function syncSealStageCta() {
    const plantSel = document.getElementById('adopt-seed-plant');
    const submitBtn = document.getElementById('seal-stage-submit');
    const statusEl = document.getElementById('seal-stage-status');
    const nameEl = document.getElementById('adopt-seed-name');
    const batchEl = document.getElementById('adopt-seed-batch');
    if (!submitBtn) return;
    const wallet = readWallet();
    if (!wallet.connected) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Connect wallet to seal';
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = 'Tap the wallet pill in the header to connect on the test network.';
      }
      return;
    }
    const plantId = plantSel ? plantSel.value : '';
    const plant = readPlants().find(function (p) {
      return p && p.id === plantId;
    });
    if (nameEl && plant) nameEl.value = String(plant.name || '').trim().slice(0, 32);
    if (batchEl && plant) batchEl.value = String(plant.batch || plant.batchLabel || '').trim().slice(0, 32);
    const action = sealActionForPlant(plant, wallet);
    if (!action) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Seal a stage';
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = 'Pick a plant from your journal.';
      }
      return;
    }
    if (action.kind === 'done') {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Trail complete · harvest sealed';
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = 'This plant’s trail is fully sealed. List it on Market when you are ready.';
      }
      return;
    }
    if (action.kind === 'growth' && action.ready === false) {
      submitBtn.disabled = true;
      submitBtn.textContent = action.label;
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = action.lockMsg || 'Log more care before sealing the next stage.';
      }
      return;
    }
    submitBtn.disabled = false;
    submitBtn.textContent = action.label;
    if (statusEl) {
      statusEl.hidden = true;
      statusEl.textContent = '';
    }
  }

  function syncSeedNameFromPlant() {
    syncSealStageCta();
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

  function signingWalletReady() {
    const SW = window.SolanaWallet;
    if (!SW || typeof SW.isConnected !== 'function' || !SW.isConnected()) return false;
    if (typeof SW.getPublicKey !== 'function' || !SW.getPublicKey()) return false;
    const provider =
      typeof SW.getProviderName === 'function' ? SW.getProviderName() : '';
    if (provider === 'watch-only' || provider === 'manual') return false;
    if (typeof SW.isWatchOnly === 'function' && SW.isWatchOnly()) return false;
    return true;
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
    const canSign = signingWalletReady();
    let body =
      '<p class="market-hint">Monthly activity bonus — earn up to <strong>50 $GROWTOO</strong> based on plants, seed mints, care weeks, and flowering progress. Platform-funded (Devnet). Paid to your connected wallet.</p>' +
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
        '</p>';
      if (canSign) {
        body +=
          '<button type="button" class="btn btn-primary btn-sm" id="platform-bonus-claim-btn">Retry claim</button>';
      } else {
        body +=
          '<p class="market-hint">Reconnect Phantom or Solflare, then retry.</p>' +
          '<button type="button" class="btn btn-primary btn-sm" id="platform-bonus-connect-btn">Connect wallet to retry</button>';
      }
    } else if (!canSign) {
      body +=
        '<p class="market-hint">Bonus is ready to claim — connect a Devnet wallet first so we know where to send the $GROWTOO. Your journal stays free without one.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" id="platform-bonus-connect-btn">Connect wallet to claim</button>';
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
      // Seal card is always available for growers (CTA prompts connect if needed).
      if (seedSection) seedSection.hidden = isAdopterUi();
      // Adopters always see the garden (empty state guides them). Growers when connected/tokens.
      if (gardenSection) {
        gardenSection.hidden = isAdopterUi()
          ? false
          : !(wallet.connected || (wallet.tokens && wallet.tokens.length > 0));
      }
      applyProfileChrome(wallet);
      if (!isAdopterUi()) {
        fillSeedPlantOptions();
      }
      if (isAdopterUi() || wallet.connected || (wallet.tokens && wallet.tokens.length > 0)) {
        renderGarden(wallet);
      }
      try {
        if (window.DailyStatus && typeof DailyStatus.renderStrip === 'function') {
          DailyStatus.renderStrip();
        }
      } catch {
        // ignore
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
      askConfirm({
        title: 'Wallet not found',
        body:
          msg +
          '\n\nIf a wallet is installed, unlock it, allow growto.live, then refresh this page.',
        confirmLabel: 'Browse wallets',
      }).then(function (ok) {
        if (ok) {
          window.open(window.ChainConfig.walletDownloadUrl, '_blank', 'noopener,noreferrer');
        }
      });
      return;
    }
    if (window.DnevnikNotifications) DnevnikNotifications.toast(msg, 'error');
    else alert(msg);
  }

  function flashOk(msg) {
    if (window.DnevnikNotifications) DnevnikNotifications.toast(msg || 'Done.', 'success');
    else alert(msg || 'Done.');
  }

  function flashWarn(msg) {
    if (window.DnevnikNotifications) DnevnikNotifications.toast(msg || 'Check status.', 'warn');
    else alert(msg || 'Check status.');
  }

  function sealOutcomeFlash(result) {
    const status = result && result.onchainStatus;
    if (status === 'queued' || status === 'skipped' || !status) {
      flashOk(
        status === 'queued'
          ? 'Stage sealed. Mint queued on Devnet — watch the card until it shows Minted.'
          : 'Stage sealed.'
      );
      return;
    }
    if (status === 'pending_seed') {
      flashWarn(
        (result && result.onchainError) ||
          'Stage saved locally. On-chain mint waits for the seed NFT — use Retry if needed.'
      );
      return;
    }
    flashWarn(
      'Saved in your garden, but the Devnet mint did not queue. Use Retry mint on the card. ' +
        ((result && result.onchainError) || '')
    );
  }

  function askConfirm(opts) {
    if (window.AppConfirm && typeof AppConfirm.ask === 'function') {
      return AppConfirm.ask(opts);
    }
    const fallback =
      ((opts && opts.title) || 'Confirm') +
      '\n\n' +
      ((opts && opts.body) || 'Continue?');
    return Promise.resolve(window.confirm(fallback));
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
      profile.walletVerified !== true ||
      isWatchOnlyProvider(profile.walletProvider) ||
      profile.walletProvider === 'watch-only';
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
        '<button type="button" class="wallet-status-chip wallet-status-chip--off wallet-status-connect" title="Connect Devnet wallet" aria-label="Connect wallet">' +
        '<span class="wallet-status-dot wallet-status-dot--off" aria-hidden="true"></span>' +
        '<span class="wallet-status-addr">Connect</span>' +
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
        '<button type="button" class="wallet-status-chip wallet-status-chip--on wallet-status-toggle" title="Connected — tap to disconnect" aria-label="Wallet connected, tap to disconnect">' +
        '<span class="wallet-status-dot" aria-hidden="true"></span>' +
        '<span class="wallet-status-addr">' +
        esc(shortAddr(wallet.address)) +
        '</span>' +
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
      const statusToggle = e.target.closest('.wallet-status-toggle');
      if (statusToggle) {
        e.preventDefault();
        const wallet = readWallet();
        if (wallet.connected) {
          if (
            window.confirm(
              'Disconnect ' +
                shortAddr(wallet.address) +
                ' from this account?\n\nYou can reconnect anytime from this pill.'
            )
          ) {
            await handleWalletDisconnect(statusToggle);
          }
        } else {
          await handleWalletConnect(statusToggle);
        }
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

  /**
   * Long-press a card for its most common actions without opening it.
   *
   * The menu mirrors the card's own Water / Feed / Ask Coach buttons rather than
   * defining its own list, so it can never offer an action the card itself
   * doesn't have (adopter view, adopted tokens, and unlinked plants render no
   * care buttons at all, and therefore get no menu).
   */
  function bindLongPressMenu(view) {
    const HOLD_MS = 480;
    const MOVE_CANCEL = 10;
    let timer = null;
    let menu = null;
    let startX = 0;
    let startY = 0;

    function closeMenu() {
      if (menu) {
        menu.remove();
        menu = null;
      }
    }

    function cancelPress() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function openMenu(card, x, y) {
      closeMenu();
      const wanted = ['water', 'feed', 'coach'];
      const items = [];
      wanted.forEach(function (action) {
        const src = card.querySelector('.adopt-care-btn[data-care="' + action + '"]');
        if (!src || src.disabled) return;
        items.push(
          '<button type="button" class="adopt-care-btn longpress-menu-item" data-care="' +
            esc(action) +
            '" data-token-id="' +
            esc(src.dataset.tokenId || '') +
            '">' +
            esc(src.getAttribute('title') || action) +
            '</button>'
        );
      });
      if (!items.length) return;

      menu = document.createElement('div');
      menu.className = 'longpress-menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = items.join('');
      view.appendChild(menu);

      // Keep it on screen near the press point.
      const rect = menu.getBoundingClientRect();
      const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      menu.classList.add('is-open');
    }

    view.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (menu && menu.contains(e.target)) return;
      closeMenu();
      const card = e.target.closest('.adopt-token-card');
      if (!card) return;
      // A press that starts on a real control belongs to that control.
      if (e.target.closest('button, a, input, textarea, select, summary, details')) return;
      startX = e.clientX;
      startY = e.clientY;
      cancelPress();
      timer = setTimeout(function () {
        timer = null;
        openMenu(card, startX, startY);
      }, HOLD_MS);
    });

    view.addEventListener('pointermove', (e) => {
      if (!timer) return;
      if (
        Math.abs(e.clientX - startX) > MOVE_CANCEL ||
        Math.abs(e.clientY - startY) > MOVE_CANCEL
      ) {
        cancelPress();
      }
    });

    view.addEventListener('pointerup', cancelPress);
    view.addEventListener('pointercancel', cancelPress);

    // Menu items are .adopt-care-btn, so the existing delegated click handler
    // runs them — this only has to dismiss the menu afterwards.
    view.addEventListener('click', (e) => {
      if (menu && e.target.closest('.longpress-menu-item')) closeMenu();
    });

    document.addEventListener('pointerdown', (e) => {
      if (menu && !menu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
    window.addEventListener('scroll', closeMenu, true);

    // Suppress the OS text-selection callout on a real touch long-press.
    view.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.adopt-token-card')) e.preventDefault();
    });
  }

  function bindEvents() {
    const view = document.getElementById('view-adopt');
    if (!view || view.dataset.bound === '1') return;
    view.dataset.bound = '1';
    bindLongPressMenu(view);

    // Delegated clicks for everything that is re-rendered.
    view.addEventListener('click', async (e) => {
      const connectBtn = e.target.closest('#adopt-connect-btn');
      const disconnectBtn = e.target.closest('#adopt-disconnect-btn');
      const mintBtn = e.target.closest('.adopt-mint-btn');
      const histBtn = e.target.closest('.adopt-history-btn');
      const burnBtn = e.target.closest('.adopt-burn-btn');
      const stepBtn = e.target.closest('.adopt-growth-step');

      if (stepBtn) {
        // Trail chart is display-only — sealing happens from the plant picker CTA.
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
        const claimOk = await askConfirm({
          title: 'Claim locked stake ($GROWTOO)?',
          body:
            'If every monthly care month qualifies (≥12 care days each), the locked 50% releases to you. Otherwise it refunds to the adopter (all-or-nothing).\n\nThis is not physical harvest redemption — that is coming later.',
          confirmLabel: 'Claim locked stake',
        });
        if (!claimOk) return;
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

      const platformConnectBtn = e.target.closest('#platform-bonus-connect-btn');
      if (platformConnectBtn) {
        if (busy || platformConnectBtn.disabled) return;
        const ok = await askConfirm({
          title: 'Connect wallet to claim?',
          body:
            'Your monthly bonus is paid in test $GROWTOO on Solana Devnet. Next you’ll pick Phantom or Solflare so we can send it to that address.\n\nYour journal stays free without a wallet — this step is only for the bonus.',
          confirmLabel: 'Connect wallet',
        });
        if (!ok) return;
        await handleWalletConnect(platformConnectBtn);
        renderPlatformBonusPanel();
        return;
      }

      const platformBtn = e.target.closest('#platform-bonus-claim-btn');
      if (platformBtn) {
        if (busy || platformBtn.disabled) return;
        if (!window.Market || typeof Market.claimPlatformBonus !== 'function') {
          flashError(new Error('Platform bonus is not available.'));
          return;
        }
        if (!signingWalletReady()) {
          flashError(
            new Error('Connect Phantom or Solflare first, then claim the bonus.')
          );
          renderPlatformBonusPanel();
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
        mintBtn.classList.add('is-sealing');
        mintBtn.textContent = 'Sealing…';
        try {
          await PlantToken.mintGrowth(id);
          mintBtn.classList.remove('is-sealing');
          mintBtn.classList.add('is-sealed');
          render();
          requestAnimationFrame(function () {
            const bar = document.querySelector('.trail-bar--current');
            if (bar) {
              bar.classList.add('is-just-sealed');
              window.setTimeout(function () {
                bar.classList.remove('is-just-sealed');
              }, 1200);
            }
          });
        } catch (err) {
          flashError(err);
          mintBtn.classList.remove('is-sealing');
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
        const wallet = PlantToken.getWallet ? PlantToken.getWallet() : null;
        const burnTok =
          wallet && Array.isArray(wallet.tokens)
            ? wallet.tokens.find(function (t) {
                return t && t.id === id;
              })
            : null;
        const repair = burnTok ? resolveMintRepair(burnTok) : null;
        const burnOk = await askConfirm({
          title:
            repair && repair.kind === 'stub'
              ? 'Remove stub mint from garden?'
              : 'Burn this token?',
          body:
            repair && repair.kind === 'stub'
              ? 'Removes this card from your garden. Does not burn the on-chain NFT — hide the empty Collectible in Phantom if it still appears.'
              : 'Removes this plant from your garden. This cannot be undone.',
          confirmLabel: repair && repair.kind === 'stub' ? 'Remove stub' : 'Burn',
          danger: true,
        });
        if (!burnOk) return;
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

      const sealEmptyBtn = e.target.closest('#adopt-empty-seal-btn');
      if (sealEmptyBtn) {
        const seal = document.getElementById('adopt-seed-section');
        if (seal) {
          seal.hidden = false;
          seal.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        const plantSel = document.getElementById('adopt-seed-plant');
        if (plantSel) {
          try {
            plantSel.focus();
          } catch (_) {
            /* ignore */
          }
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
      if (plantSel && plantSel.dataset.bound !== '1') {
        plantSel.dataset.bound = '1';
        plantSel.addEventListener('change', syncSealStageCta);
      }
      seedForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const plantSelect = document.getElementById('adopt-seed-plant');
        const plantId = plantSelect ? plantSelect.value : '';
        if (!plantId) {
          flashError(new Error('Choose a journal plant to seal.'));
          return;
        }
        const plant = readPlants().find((p) => p.id === plantId);
        if (!plant) {
          flashError(new Error('Plant not found in your journal.'));
          return;
        }
        const wallet = readWallet();
        if (!wallet.connected) {
          flashError(new Error('Connect a wallet first (header pill).'));
          return;
        }
        const action = sealActionForPlant(plant, wallet);
        const submitBtn = document.getElementById('seal-stage-submit') || seedForm.querySelector('button[type="submit"]');
        const originalLabel = submitBtn ? submitBtn.textContent : '';
        setBusy(true);
        if (submitBtn) {
          submitBtn.classList.add('is-sealing');
          submitBtn.textContent = 'Sealing…';
        }
        try {
          if (!action || action.kind === 'done') {
            throw new Error('This plant’s trail is already fully sealed.');
          }
          let sealResult = null;
          if (action.kind === 'seed') {
            const name = String(plant.name || '').trim().slice(0, 32);
            if (!name) throw new Error('Plant needs a name in the journal before sealing.');
            sealResult = await PlantToken.importSeed({
              name: name,
              strain: plant.strain || '',
              batch: plant.batch || plant.batchLabel || '',
              plantId: plantId,
            });
          } else if (action.kind === 'growth' && action.token) {
            if (action.ready === false) {
              throw new Error(action.lockMsg || 'Log more care before sealing the next stage.');
            }
            sealResult = await PlantToken.mintGrowth(action.token.id);
          } else {
            throw new Error('Nothing to seal for this plant.');
          }
          if (submitBtn) {
            submitBtn.classList.remove('is-sealing');
            submitBtn.classList.add('is-sealed');
          }
          render();
          sealOutcomeFlash(sealResult);
          requestAnimationFrame(function () {
            const bar = document.querySelector('.trail-bar--current');
            if (bar) {
              bar.classList.add('is-just-sealed');
              window.setTimeout(function () {
                bar.classList.remove('is-just-sealed');
              }, 1200);
            }
          });
        } catch (err) {
          flashError(err);
          if (submitBtn) submitBtn.classList.remove('is-sealing');
        } finally {
          if (submitBtn) submitBtn.textContent = originalLabel || 'Seal stage';
          setBusy(false);
          syncSealStageCta();
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
