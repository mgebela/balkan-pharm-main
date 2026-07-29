/*
 * Link Firebase Auth user ↔ Solana pubkey (M1).
 * User signs a short message in their wallet; pubkey is stored on users/{uid}.
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
      'Link this Solana wallet to your growtoo account.',
      '',
      'Domain: growto.live',
      'UID: ' + uid,
      'Wallet: ' + pubkey,
      'Cluster: devnet',
      'Issued: ' + new Date().toISOString(),
    ].join('\n');
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

  const FIRESTORE_TIMEOUT_MS = 12000;

  async function signLinkMessage(message) {
    const SW = window.SolanaWallet;
    if (!SW) throw new Error('Solana wallet module not loaded.');
    const bytes = new TextEncoder().encode(message);
    const result = await withTimeout(
      SW.signMessage(bytes),
      45000,
      'Wallet did not respond to the sign request. Unlock the extension and try again.'
    );
    if (result && result.signature) return result.signature;
    return result;
  }

  function normalizeWalletError(err) {
    if (!err) return 'Something went wrong.';
    if (typeof err === 'string') return err;
    const raw = String(err.message || err.error || '');
    if (
      err.code === 4001 ||
      err.code === '4001' ||
      /^(cancelled|canceled|user rejected|rejected by user)/i.test(raw.trim()) ||
      /user rejected|request rejected|user cancelled|user canceled/i.test(raw)
    ) {
      return 'Signature cancelled in wallet. Tap Link account and approve the message to finish.';
    }
    if (err.message) return err.message;
    if (err.code === 'permission-denied') {
      return 'Could not save wallet link. Deploy the latest Firestore rules: firebase deploy --only firestore:rules';
    }
    if (err.code === 'WALLET_NOT_FOUND') {
      return 'No Solana wallet found. Install Phantom, Solflare, or another wallet, then refresh.';
    }
    try {
      const details = err.details || err.reason || err.error;
      if (typeof details === 'string' && details) return details;
    } catch {
      // ignore
    }
    console.error('Wallet error', err);
    return 'Something went wrong. Open the browser console (F12) for details.';
  }

  async function assertPubkeyAvailable() {
    // Cross-user pubkey lookup is blocked by Firestore rules for normal users.
    // Uniqueness will be enforced server-side in a later milestone.
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

      const snap = await withTimeout(
        firestore.collection('users').doc(user.uid).get(),
        FIRESTORE_TIMEOUT_MS,
        'Firestore timed out loading your profile. Check your connection and try again.'
      );
      const data = snap.exists ? snap.data() || {} : {};
      cache.uid = user.uid;
      cache.solanaPubkey = String(data.solanaPubkey || '');
      cache.walletProvider = String(data.walletProvider || '');
      cache.walletLinkedAt = String(data.walletLinkedAt || '');
      cache.loaded = true;
      emit();
      return cache;
    },

    formatError: normalizeWalletError,

    async linkWallet(pubkey, options) {
      const opts = options || {};
      const user = firebaseUser();
      if (!user) {
        throw new Error('Sign in to your growtoo account before linking a wallet.');
      }
      if (!isValidPubkey(pubkey)) {
        throw new Error('Invalid Solana wallet address.');
      }

      await WalletLink.loadProfile();

      if (cache.solanaPubkey === pubkey && !opts.force) {
        return cache;
      }

      if (cache.solanaPubkey && cache.solanaPubkey !== pubkey && !opts.force) {
        throw new Error(
          'A different wallet is already linked to this account. Disconnect and contact support to change it.'
        );
      }

      await assertPubkeyAvailable();

      const SW = window.SolanaWallet;
      let provider = SW && SW.getProviderName ? SW.getProviderName() : 'solana';
      const adapterKind = SW && typeof SW.getAdapterKind === 'function' ? SW.getAdapterKind() : '';
      const isWatchOnly =
        opts.skipSign ||
        adapterKind === 'manual' ||
        provider === 'watch-only' ||
        provider === 'manual' ||
        (SW && typeof SW.isWatchOnly === 'function' && SW.isWatchOnly());

      if (isWatchOnly && (!provider || provider === 'solana')) {
        provider = 'watch-only';
      }

      const message = buildLinkMessage(user.uid, pubkey);

      if (!opts.skipSign && !isWatchOnly) {
        try {
          await signLinkMessage(message);
        } catch (err) {
          const msg = normalizeWalletError(err);
          // If the session is watch-only / cannot sign, fall back to unverified link.
          if (/watch-only|cannot sign|does not support signMessage/i.test(msg)) {
            provider = 'watch-only';
          } else {
            const wrapped = new Error(msg);
            wrapped.code = err && err.code;
            throw wrapped;
          }
        }
      }

      const firestore = db();
      if (!firestore) throw new Error('Firestore is not available.');

      const now = new Date().toISOString();
      const patch = {
        solanaPubkey: pubkey,
        walletProvider: provider || (isWatchOnly ? 'watch-only' : 'solana'),
        walletLinkedAt: now,
      };

      const userRef = firestore.collection('users').doc(user.uid);
      try {
        await withTimeout(
          userRef.set(patch, { merge: true }),
          FIRESTORE_TIMEOUT_MS,
          'Firestore timed out saving the wallet link. Check your connection and try again.'
        );
      } catch (err) {
        const wrapped = new Error(normalizeWalletError(err));
        wrapped.code = err && err.code;
        throw wrapped;
      }

      // Re-read to confirm the write landed (rules / offline can look successful otherwise).
      const confirm = await withTimeout(
        userRef.get(),
        FIRESTORE_TIMEOUT_MS,
        'Firestore timed out confirming the wallet link.'
      );
      const saved = confirm.exists ? confirm.data() || {} : {};
      if (String(saved.solanaPubkey || '') !== pubkey) {
        throw new Error(
          'Wallet link did not save. Check Firestore rules for users/{uid} wallet fields, then try again.'
        );
      }

      cache.uid = user.uid;
      cache.solanaPubkey = pubkey;
      cache.walletProvider = String(saved.walletProvider || patch.walletProvider);
      cache.walletLinkedAt = String(saved.walletLinkedAt || now);
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
