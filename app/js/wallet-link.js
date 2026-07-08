/*
 * Link Firebase Auth user ↔ Solana pubkey (M1).
 * User signs a short message in Solflare; pubkey is stored on users/{uid}.
 */
(function () {
  'use strict';

  const cache = {
    uid: '',
    solanaPubkey: '',
    walletProvider: '',
    walletLinkedAt: '',
    loaded: false,
  };

  const listeners = new Set();

  function emit() {
    const snapshot = Object.assign({}, cache);
    listeners.forEach(function (fn) {
      try {
        fn(snapshot);
      } catch {
        // ignore
      }
    });
  }

  function firebaseUser() {
    return window.firebase && firebase.auth && firebase.auth().currentUser;
  }

  function db() {
    if (!window.firebase || !firebase.firestore) return null;
    return firebase.firestore();
  }

  function isValidPubkey(pk) {
    return typeof pk === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pk);
  }

  function buildLinkMessage(uid, pubkey) {
    return [
      'Link this Solana wallet to your dnevnik.live account.',
      '',
      'Domain: dnevnik.live',
      'UID: ' + uid,
      'Wallet: ' + pubkey,
      'Cluster: devnet',
      'Issued: ' + new Date().toISOString(),
    ].join('\n');
  }

  async function signLinkMessage(message) {
    const SW = window.SolanaWallet;
    if (!SW) throw new Error('Solana wallet module not loaded.');
    const bytes = new TextEncoder().encode(message);
    const result = await SW.signMessage(bytes);
    if (result && result.signature) return result.signature;
    return result;
  }

  async function assertPubkeyAvailable(pubkey, uid) {
    const firestore = db();
    if (!firestore) return;
    const snap = await firestore.collection('users').where('solanaPubkey', '==', pubkey).limit(2).get();
    const conflict = snap.docs.find(function (doc) {
      return doc.id !== uid;
    });
    if (conflict) {
      throw new Error('This Solana wallet is already linked to another dnevnik.live account.');
    }
  }

  const WalletLink = {
    isValidPubkey: isValidPubkey,

    getProfile() {
      return Object.assign({}, cache);
    },

    isLinked() {
      return !!cache.solanaPubkey;
    },

    onChange(fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    },

    async loadProfile() {
      const user = firebaseUser();
      if (!user) {
        cache.uid = '';
        cache.solanaPubkey = '';
        cache.walletProvider = '';
        cache.walletLinkedAt = '';
        cache.loaded = true;
        emit();
        return cache;
      }

      const firestore = db();
      if (!firestore) {
        cache.loaded = true;
        emit();
        return cache;
      }

      const snap = await firestore.collection('users').doc(user.uid).get();
      const data = snap.exists ? snap.data() || {} : {};
      cache.uid = user.uid;
      cache.solanaPubkey = String(data.solanaPubkey || '');
      cache.walletProvider = String(data.walletProvider || '');
      cache.walletLinkedAt = String(data.walletLinkedAt || '');
      cache.loaded = true;
      emit();
      return cache;
    },

    async linkWallet(pubkey, options) {
      const opts = options || {};
      const user = firebaseUser();
      if (!user) {
        throw new Error('Sign in to your dnevnik.live account before linking a wallet.');
      }
      if (!isValidPubkey(pubkey)) {
        throw new Error('Invalid Solana wallet address.');
      }

      await WalletLink.loadProfile();

      if (cache.solanaPubkey === pubkey && !opts.force) {
        return cache;
      }

      if (cache.solanaPubkey && cache.solanaPubkey !== pubkey && !opts.force) {
        throw new Error('A different wallet is already linked to this account. Disconnect and contact support to change it.');
      }

      await assertPubkeyAvailable(pubkey, user.uid);

      const SW = window.SolanaWallet;
      const provider = SW && SW.getProviderName ? SW.getProviderName() : 'solflare';
      const message = buildLinkMessage(user.uid, pubkey);

      if (!opts.skipSign) {
        await signLinkMessage(message);
      }

      const firestore = db();
      if (!firestore) throw new Error('Firestore is not available.');

      const now = new Date().toISOString();
      await firestore.collection('users').doc(user.uid).set(
        {
          solanaPubkey: pubkey,
          walletProvider: provider || 'solflare',
          walletLinkedAt: now,
        },
        { merge: true }
      );

      cache.uid = user.uid;
      cache.solanaPubkey = pubkey;
      cache.walletProvider = provider || 'solflare';
      cache.walletLinkedAt = now;
      cache.loaded = true;
      emit();
      return cache;
    },

    async unlinkWallet() {
      const user = firebaseUser();
      if (!user) return cache;

      const firestore = db();
      if (!firestore) return cache;

      await firestore.collection('users').doc(user.uid).update({
        solanaPubkey: firebase.firestore.FieldValue.delete(),
        walletProvider: firebase.firestore.FieldValue.delete(),
        walletLinkedAt: firebase.firestore.FieldValue.delete(),
      });

      cache.solanaPubkey = '';
      cache.walletProvider = '';
      cache.walletLinkedAt = '';
      emit();
      return cache;
    },
  };

  window.WalletLink = WalletLink;

  if (window.SolanaWallet && typeof window.SolanaWallet.onChange === 'function') {
    window.SolanaWallet.onChange(function (state) {
      if (!state.connected && cache.solanaPubkey) {
        // Keep Firestore link when wallet disconnects locally.
        emit();
      }
    });
  }
})();
