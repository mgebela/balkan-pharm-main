/*
 * Link Firebase Auth user ↔ Solana pubkey.
 * Ownership is proven by signing a challenge; Cloud Function `linkWallet`
 * verifies the ed25519 signature and writes users/{uid} via Admin SDK.
 * Clients cannot set solanaPubkey directly (Firestore rules).
 */
(function () {
  'use strict';

  function linkWalletUrl() {
    try {
      if (window.ChainConfig && ChainConfig.linkWalletUrl) {
        return String(ChainConfig.linkWalletUrl);
      }
    } catch (_) {
      /* ignore */
    }
    return 'https://europe-west1-balpha-9dab9.cloudfunctions.net/linkWallet';
  }

  const cache = {
    uid: '',
    solanaPubkey: '',
    walletProvider: '',
    walletLinkedAt: '',
    walletVerified: false,
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

  /**
   * The wallet signs this text and functions/link-wallet.js verifies the
   * signature against the exact same string — it checks for the English
   * preamble, "Domain: growto.live" and "Cluster: devnet" literally. This is
   * a protocol message, not copy: translating it would make every signature
   * fail verification. i18n-ignore, deliberately, for the whole block.
   */
  function buildLinkMessage(uid, pubkey) {
    return [
      'Link this Solana wallet to your growtoo account.', // i18n-ignore
      '',
      'Domain: growto.live', // i18n-ignore
      'UID: ' + uid, // i18n-ignore
      'Wallet: ' + pubkey, // i18n-ignore
      'Cluster: devnet', // i18n-ignore
      'Issued: ' + new Date().toISOString(), // i18n-ignore
    ].join('\n');
  }

  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(new Error(message || T('app.wallet.timedOut', 'Request timed out.')));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () {
      clearTimeout(timer);
    });
  }

  const FIRESTORE_TIMEOUT_MS = 12000;

  function encodeSignature(result) {
    var sig = result && result.signature != null ? result.signature : result;
    if (!sig) {
      throw new Error(T('app.wallet.emptySignature', 'Wallet returned an empty signature.'));
    }
    if (typeof sig === 'string') return sig;
    var bytes =
      sig instanceof Uint8Array
        ? sig
        : Array.isArray(sig)
          ? Uint8Array.from(sig)
          : sig.data
            ? Uint8Array.from(sig.data)
            : null;
    if (!bytes || !bytes.length) {
      throw new Error(
      T('app.wallet.badSignatureFormat', 'Wallet signature format not recognized.')
    );
    }
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function signLinkMessage(message) {
    const SW = window.SolanaWallet;
    // i18n-ignore — a loading failure, reported through formatError below.
    if (!SW) throw new Error('Solana wallet module not loaded.');
    const bytes = new TextEncoder().encode(message);
    const result = await withTimeout(
      SW.signMessage(bytes),
      45000,
      T(
        'app.wallet.signNoResponse',
        'Wallet did not respond to the sign request. Unlock the extension and try again.'
      )
    );
    return encodeSignature(result);
  }

  async function getIdToken() {
    const user = firebaseUser();
    if (!user) return null;
    return user.getIdToken();
  }

  async function callLinkWallet(body) {
    const token = await getIdToken();
    if (!token) {
      throw new Error(
        T('app.wallet.signInFirst', 'Sign in to your growtoo account before linking a wallet.')
      );
    }
    const res = await withTimeout(
      fetch(linkWalletUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token, // i18n-ignore — HTTP scheme.
        },
        body: JSON.stringify(body),
      }),
      30000,
      T('app.wallet.linkTimeout', 'Wallet link service timed out. Try again.')
    );
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.ok) {
      const err = new Error(
        data.error ||
          T('app.wallet.linkFailed', 'Wallet link failed ({status})', { status: res.status })
      );
      err.code = res.status === 401 ? 'auth' : data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function normalizeWalletError(err) {
    if (!err) return T('app.wallet.generic', 'Something went wrong.');
    if (typeof err === 'string') return err;
    const raw = String(err.message || err.error || '');
    if (
      err.code === 4001 ||
      err.code === '4001' ||
      /^(cancelled|canceled|user rejected|rejected by user)/i.test(raw.trim()) ||
      /user rejected|request rejected|user cancelled|user canceled/i.test(raw)
    ) {
      return T(
        'app.wallet.signatureCancelled',
        'Signature cancelled in wallet. Tap Link account and approve the message to finish.'
      );
    }
    if (err.message) return err.message;
    if (err.code === 'permission-denied') {
      return T(
        'app.wallet.saveFailed',
        'Could not save wallet link. Refresh and try again, or contact support.'
      );
    }
    if (err.code === 'WALLET_NOT_FOUND') {
      return T(
        'app.wallet.notFound',
        'No Solana wallet found. Install Phantom, Solflare, or another wallet, then refresh.'
      );
    }
    try {
      const details = err.details || err.reason || err.error;
      if (typeof details === 'string' && details) return details;
    } catch {
      // ignore
    }
    console.error('Wallet error', err);
    return T(
      'app.wallet.genericConsole',
      'Something went wrong. Open the browser console (F12) for details.'
    );
  }

  const WalletLink = {
    isValidPubkey: isValidPubkey,

    getProfile() {
      return Object.assign({}, cache);
    },

    isLinked() {
      return !!cache.solanaPubkey;
    },

    isVerified() {
      return !!cache.solanaPubkey && !!cache.walletVerified;
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
        cache.walletVerified = false;
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
        T(
          'app.wallet.profileTimeout',
          'Firestore timed out loading your profile. Check your connection and try again.'
        )
      );
      const data = snap.exists ? snap.data() || {} : {};
      cache.uid = user.uid;
      cache.solanaPubkey = String(data.solanaPubkey || '');
      cache.walletProvider = String(data.walletProvider || '');
      cache.walletLinkedAt = String(data.walletLinkedAt || '');
      cache.walletVerified = data.walletVerified === true;
      cache.loaded = true;
      emit();
      return cache;
    },

    formatError: normalizeWalletError,

    async linkWallet(pubkey, options) {
      const opts = options || {};
      const user = firebaseUser();
      if (!user) {
        throw new Error(
          T('app.wallet.signInFirst', 'Sign in to your growtoo account before linking a wallet.')
        );
      }
      if (!isValidPubkey(pubkey)) {
        throw new Error(T('app.wallet.invalidAddress', 'Invalid Solana wallet address.'));
      }

      await WalletLink.loadProfile();

      if (cache.solanaPubkey === pubkey && cache.walletVerified && !opts.force) {
        return cache;
      }

      if (cache.solanaPubkey && cache.solanaPubkey !== pubkey && !opts.force) {
        throw new Error(
          T(
            'app.wallet.alreadyLinked',
            'A different wallet is already linked to this account. Disconnect and contact support to change it.'
          )
        );
      }

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

      let saved;
      if (isWatchOnly || opts.skipSign) {
        saved = await callLinkWallet({
          pubkey: pubkey,
          mode: 'watch-only',
          walletProvider: 'watch-only',
          force: !!opts.force,
        });
      } else {
        const message = buildLinkMessage(user.uid, pubkey);
        let signature;
        try {
          signature = await signLinkMessage(message);
        } catch (err) {
          const msg = normalizeWalletError(err);
          if (/watch-only|cannot sign|does not support signMessage/i.test(msg)) {
            saved = await callLinkWallet({
              pubkey: pubkey,
              mode: 'watch-only',
              walletProvider: 'watch-only',
              force: !!opts.force,
            });
          } else {
            const wrapped = new Error(msg);
            wrapped.code = err && err.code;
            throw wrapped;
          }
        }
        if (!saved) {
          saved = await callLinkWallet({
            pubkey: pubkey,
            message: message,
            signature: signature,
            walletProvider: provider || 'solana',
            force: !!opts.force,
          });
        }
      }

      cache.uid = user.uid;
      cache.solanaPubkey = String(saved.solanaPubkey || pubkey);
      cache.walletProvider = String(saved.walletProvider || provider || 'solana');
      cache.walletLinkedAt = String(saved.walletLinkedAt || '');
      cache.walletVerified = saved.walletVerified === true;
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
        walletVerified: firebase.firestore.FieldValue.delete(),
        walletLinkSignature: firebase.firestore.FieldValue.delete(),
        walletLinkMessage: firebase.firestore.FieldValue.delete(),
      });

      cache.solanaPubkey = '';
      cache.walletProvider = '';
      cache.walletLinkedAt = '';
      cache.walletVerified = false;
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
