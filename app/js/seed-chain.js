/*
 * Seed NFT mint requests (M2).
 *
 * importSeed() files a mint request in Firestore (`seedMints`); the devnet
 * minter (chain/process-seed-mints.js) picks it up, mints a real Seed NFT
 * on Solana devnet and writes back mintAddress + metadataUri. This module
 * watches the user's requests so the UI can show live on-chain status.
 */
(function () {
  'use strict';

  const cache = {
    uid: '',
    mints: {}, // requestId -> seedMints doc data
    growth: {}, // requestId -> growthMints doc data
  };

  const listeners = new Set();
  let unsubscribeSnapshot = null;
  let unsubscribeGrowth = null;

  function emit() {
    listeners.forEach(function (fn) {
      try {
        fn(Object.assign({}, cache.mints));
      } catch {
        // ignore listener errors
      }
    });
  }

  function firebaseReady() {
    return !!(window.firebase && firebase.auth && firebase.firestore);
  }

  function currentUser() {
    return firebaseReady() ? firebase.auth().currentUser : null;
  }

  function defaultBatch() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return 'B-' + d.getFullYear() + '-' + month;
  }

  function startWatch(uid) {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    if (unsubscribeGrowth) {
      unsubscribeGrowth();
      unsubscribeGrowth = null;
    }
    cache.uid = uid || '';
    cache.mints = {};
    cache.growth = {};
    if (!uid) {
      emit();
      return;
    }
    unsubscribeSnapshot = firebase
      .firestore()
      .collection('seedMints')
      .where('uid', '==', uid)
      .onSnapshot(
        function (snap) {
          const next = {};
          snap.forEach(function (doc) {
            next[doc.id] = Object.assign({ id: doc.id }, doc.data());
          });
          cache.mints = next;
          emit();
        },
        function (err) {
          console.warn('seedMints watch failed', err);
        }
      );
    unsubscribeGrowth = firebase
      .firestore()
      .collection('growthMints')
      .where('uid', '==', uid)
      .onSnapshot(
        function (snap) {
          const next = {};
          snap.forEach(function (doc) {
            next[doc.id] = Object.assign({ id: doc.id }, doc.data());
          });
          cache.growth = next;
          emit();
        },
        function (err) {
          console.warn('growthMints watch failed', err);
        }
      );
  }

  const SeedChain = {
    defaultBatch: defaultBatch,

    isEnabled() {
      return firebaseReady() && !!currentUser();
    },

    onChange(fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    },

    getMints() {
      return Object.assign({}, cache.mints);
    },

    getMint(requestId) {
      return requestId ? cache.mints[requestId] || null : null;
    },

    /*
     * File a mint request. Returns the Firestore request id, or null when
     * the user is not signed in (local mock continues to work offline).
     */
    async requestSeedMint(seed) {
      const user = currentUser();
      if (!user) return null;
      if (!seed || !seed.plantId) {
        throw new Error('Link a journal plant before minting a seed RWA.');
      }

      const linked = window.WalletLink ? WalletLink.getProfile() : {};
      const request = {
        uid: user.uid,
        name: String(seed.name || '').trim().slice(0, 32),
        strain: String(seed.strain || seed.name || '').trim(),
        batch: String(seed.batch || '').trim() || defaultBatch(),
        plantId: String(seed.plantId),
        status: 'pending',
        cluster: 'devnet',
        requestedAt: new Date().toISOString(),
      };
      if (linked.solanaPubkey) {
        request.recipient = linked.solanaPubkey;
      }

      const ref = await firebase.firestore().collection('seedMints').add(request);
      return ref.id;
    },

    getGrowth(requestId) {
      return requestId ? cache.growth[requestId] || null : null;
    },

    /*
     * File an on-chain growth request (M3): the minter updates the seed
     * NFT's stage metadata and mints the $GROWTOO reward to the holder.
     * Returns the request id, or null when not signed in.
     */
    async requestGrowthMint(params) {
      const user = currentUser();
      if (!user) return null;
      if (!params || !params.mintAddress) {
        throw new Error('Seed NFT is not minted on devnet yet.');
      }
      if (!params.plantId) {
        throw new Error('Growth mint requires a linked journal plant.');
      }

      const linked = window.WalletLink ? WalletLink.getProfile() : {};
      const request = {
        uid: user.uid,
        mintAddress: String(params.mintAddress),
        seedMintRequestId: params.seedMintRequestId || null,
        stage: String(params.stage),
        name: String(params.name || '').trim().slice(0, 32),
        strain: String(params.strain || params.name || '').trim(),
        batch: String(params.batch || '').trim() || defaultBatch(),
        plantId: String(params.plantId),
        status: 'pending',
        cluster: 'devnet',
        requestedAt: new Date().toISOString(),
      };
      if (params.journalProof && typeof params.journalProof === 'object') {
        request.journalProof = {
          plantId: params.journalProof.plantId || params.plantId || null,
          targetStage: params.journalProof.targetStage || params.stage,
          checkedAt: params.journalProof.checkedAt || new Date().toISOString(),
          ready: !!params.journalProof.ready,
          items: Array.isArray(params.journalProof.items)
            ? params.journalProof.items.slice(0, 12)
            : [],
        };
      }
      if (linked.solanaPubkey) {
        request.recipient = linked.solanaPubkey;
      }

      const ref = await firebase.firestore().collection('growthMints').add(request);
      return ref.id;
    },

    /*
     * On-chain $GROWTOO balance (whole tokens) for a wallet address.
     * Returns null when the $GROWTOO mint is not deployed/configured yet.
     */
    async fetchGrowBalance(ownerAddress) {
      const cfg = window.ChainConfig || {};
      if (!cfg.growMint || !ownerAddress) return null;
      const res = await fetch(cfg.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [ownerAddress, { mint: cfg.growMint }, { encoding: 'jsonParsed' }],
        }),
      });
      const json = await res.json();
      const accounts = (json.result && json.result.value) || [];
      let total = 0;
      accounts.forEach(function (a) {
        try {
          total += Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0);
        } catch {
          // ignore malformed accounts
        }
      });
      return total;
    },
  };

  window.SeedChain = SeedChain;

  if (firebaseReady()) {
    firebase.auth().onAuthStateChanged(function (user) {
      startWatch(user ? user.uid : '');
    });
  }
})();
