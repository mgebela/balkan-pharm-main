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
  };

  const listeners = new Set();
  let unsubscribeSnapshot = null;

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
    cache.uid = uid || '';
    cache.mints = {};
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

      const linked = window.WalletLink ? WalletLink.getProfile() : {};
      const request = {
        uid: user.uid,
        name: String(seed.name || '').trim().slice(0, 32),
        strain: String(seed.strain || seed.name || '').trim(),
        batch: String(seed.batch || '').trim() || defaultBatch(),
        plantId: seed.plantId || null,
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
  };

  window.SeedChain = SeedChain;

  if (firebaseReady()) {
    firebase.auth().onAuthStateChanged(function (user) {
      startWatch(user ? user.uid : '');
    });
  }
})();
