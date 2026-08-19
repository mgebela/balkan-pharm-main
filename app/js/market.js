/*
 * Marketplace (devnet): growers post real RWA NFTs; adopters invest with $GROWTOO.
 *
 * Default Instant sale → on-chain Anchor escrow (`settlement: program`):
 *   list/buy/cancel are atomic wallet txs (PDA vault). No CF settle queue.
 * Adopt stake → hot-wallet NFT escrow + care vault (process-adopt-stakes).
 * Legacy hot-wallet path remains for open listings / explicit settlementMode legacy.
 */
(function () {
  'use strict';

  const listeners = new Set();
  let listings = [];
  let platformRewards = [];
  let harvestClaims = [];
  let unsubscribe = null;
  let mineUnsub = null;
  let ownUnsub = null;
  let tapeUnsub = null;
  let platformUnsub = null;
  let harvestUnsub = null;
  let watchedUid = '';
  let busy = false;
  let reconcileTimer = null;
  let lastReconcileAt = 0;
  const HCLAIM_OPT_KEY = 'growtoo-hclaim-optimistic';
  /** Public tape (no Firebase uids) + this user's full asks/buys. */
  let boardListings = [];
  let mineListings = [];
  let ownListings = [];

  function mergeMarketListings() {
    const byId = Object.create(null);
    boardListings.forEach(function (l) {
      if (l && l.id) byId[l.id] = l;
    });
    ownListings.forEach(function (l) {
      if (l && l.id) byId[l.id] = l;
    });
    mineListings.forEach(function (l) {
      if (l && l.id) byId[l.id] = l;
    });
    const next = Object.keys(byId).map(function (id) {
      return byId[id];
    });
    next.sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    listings = next;
    syncMyInvestments();
    emit();
    maybeRequestEscrowReconcile(next);
    maybeRequestMarketSettle(next);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shortAddr(addr) {
    if (!addr) return '';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function firebaseReady() {
    return !!(window.firebase && firebase.auth && firebase.firestore);
  }

  function currentUser() {
    return firebaseReady() ? firebase.auth().currentUser : null;
  }

  function cfg() {
    return window.ChainConfig || {};
  }

  function isAdopterUi() {
    return document.body.classList.contains('profile-adopter');
  }

  function isGrowerUi() {
    return document.body.classList.contains('profile-grower') || !isAdopterUi();
  }

  function explorerAddress(addr) {
    return cfg().explorerAddress
      ? cfg().explorerAddress(addr)
      : 'https://solscan.io/account/' + encodeURIComponent(addr) + '?cluster=devnet';
  }

  function startPlatformWatch(uid) {
    if (platformUnsub) {
      platformUnsub();
      platformUnsub = null;
    }
    platformRewards = [];
    if (!uid || !firebaseReady()) return;
    platformUnsub = firebase
      .firestore()
      .collection('platformRewards')
      .where('uid', '==', uid)
      .limit(24)
      .onSnapshot(
        function (snap) {
          const next = [];
          snap.forEach(function (doc) {
            next.push(Object.assign({ id: doc.id }, doc.data()));
          });
          next.sort(function (a, b) {
            return String(b.monthKey || '').localeCompare(String(a.monthKey || ''));
          });
          platformRewards = next;
          if (window.PlantToken && typeof PlantToken.render === 'function') {
            try {
              PlantToken.render();
            } catch {
              // ignore
            }
          }
        },
        function (err) {
          console.warn('platformRewards watch failed', err);
        }
      );
  }

  function readOptimisticHarvestClaims() {
    try {
      const raw = sessionStorage.getItem(HCLAIM_OPT_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeOptimisticHarvestClaims(map) {
    try {
      sessionStorage.setItem(HCLAIM_OPT_KEY, JSON.stringify(map || {}));
    } catch (_) {
      /* ignore */
    }
  }

  function markOptimisticHarvestClaim(listingId) {
    if (!listingId) return;
    const map = readOptimisticHarvestClaims();
    map[listingId] = { status: 'pending', requestedAt: new Date().toISOString() };
    writeOptimisticHarvestClaims(map);
  }

  function clearOptimisticHarvestClaim(listingId) {
    if (!listingId) return;
    const map = readOptimisticHarvestClaims();
    if (!map[listingId]) return;
    delete map[listingId];
    writeOptimisticHarvestClaims(map);
  }

  function getHarvestClaim(listingId) {
    if (!listingId) return null;
    const live = harvestClaims.find(function (c) {
      return c && (c.id === listingId || c.listingId === listingId);
    });
    if (live) {
      clearOptimisticHarvestClaim(listingId);
      return live;
    }
    const opt = readOptimisticHarvestClaims()[listingId];
    if (opt) {
      return {
        id: listingId,
        listingId: listingId,
        status: opt.status || 'pending',
        requestedAt: opt.requestedAt || null,
        optimisticPending: true,
      };
    }
    return null;
  }

  function startHarvestWatch(uid) {
    if (harvestUnsub) {
      harvestUnsub();
      harvestUnsub = null;
    }
    harvestClaims = [];
    if (!uid || !firebaseReady()) return;
    harvestUnsub = firebase
      .firestore()
      .collection('harvestClaims')
      .where('uid', '==', uid)
      .limit(24)
      .onSnapshot(
        function (snap) {
          const next = [];
          snap.forEach(function (doc) {
            next.push(Object.assign({ id: doc.id }, doc.data()));
          });
          next.sort(function (a, b) {
            return String(b.requestedAt || '').localeCompare(String(a.requestedAt || ''));
          });
          harvestClaims = next;
          next.forEach(function (c) {
            if (c && c.listingId) clearOptimisticHarvestClaim(c.listingId);
            if (c && c.id) clearOptimisticHarvestClaim(c.id);
          });
          emit();
          if (window.PlantToken && typeof PlantToken.render === 'function') {
            try {
              PlantToken.render();
            } catch {
              // ignore
            }
          }
        },
        function (err) {
          console.warn('harvestClaims watch failed', err);
        }
      );
  }

  function startWatch() {
    const user = currentUser();
    const uid = user ? user.uid : '';
    if (uid === watchedUid && (tapeUnsub || unsubscribe)) return;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (tapeUnsub) {
      tapeUnsub();
      tapeUnsub = null;
    }
    if (mineUnsub) {
      mineUnsub();
      mineUnsub = null;
    }
    if (ownUnsub) {
      ownUnsub();
      ownUnsub = null;
    }
    watchedUid = uid;
    listings = [];
    boardListings = [];
    mineListings = [];
    ownListings = [];
    if (!uid || !firebaseReady()) {
      startPlatformWatch('');
      startHarvestWatch('');
      emit();
      return;
    }
    startPlatformWatch(uid);
    startHarvestWatch(uid);
    tapeUnsub = firebase
      .firestore()
      .collection('marketPublicTape')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .onSnapshot(
        function (snap) {
          const next = [];
          snap.forEach(function (doc) {
            next.push(Object.assign({ id: doc.id, fromTape: true }, doc.data()));
          });
          boardListings = next;
          mergeMarketListings();
        },
        function (err) {
          console.warn('marketPublicTape watch failed', err);
        }
      );
    ownUnsub = firebase
      .firestore()
      .collection('marketListings')
      .where('uid', '==', uid)
      .limit(200)
      .onSnapshot(
        function (snap) {
          const next = [];
          snap.forEach(function (doc) {
            next.push(Object.assign({ id: doc.id }, doc.data()));
          });
          ownListings = next;
          mergeMarketListings();
        },
        function (err) {
          console.warn('marketListings own watch failed', err);
        }
      );
    mineUnsub = firebase
      .firestore()
      .collection('marketListings')
      .where('buyerUid', '==', uid)
      .limit(200)
      .onSnapshot(
        function (snap) {
          const next = [];
          snap.forEach(function (doc) {
            next.push(Object.assign({ id: doc.id }, doc.data()));
          });
          mineListings = next;
          mergeMarketListings();
        },
        function (err) {
          console.warn('marketListings mine watch failed', err);
        }
      );
  }

  let lastSettleAt = 0;
  let settleTimer = null;

  /**
   * If any listing is stuck in escrow_pending, ping the Cloud Function that
   * activates it once the NFT is confirmed in escrow. Debounced so we do not
   * hammer RPC while the grower waits on the market screen.
   */
  function maybeRequestEscrowReconcile(rows) {
    const pending = (rows || []).filter(function (l) {
      return l && l.status === 'escrow_pending';
    });
    if (!pending.length) return;

    const url = cfg().marketReconcileUrl;
    if (!url) return;

    const now = Date.now();
    if (now - lastReconcileAt < 45000) return;

    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(function () {
      lastReconcileAt = Date.now();
      const ping = function (headers) {
        return fetch(url, {
          method: 'POST',
          headers: headers || { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'app-market', count: pending.length }),
        });
      };
      const ready =
        typeof window.growtooFunctionHeaders === 'function'
          ? window.growtooFunctionHeaders()
          : Promise.resolve({ 'Content-Type': 'application/json' });
      ready
        .then(ping)
        .then(function (res) {
          return res.json().catch(function () {
            return null;
          });
        })
        .then(function (data) {
          if (data && data.activated > 0) {
            console.info('market escrow reconcile activated', data.activated);
          }
        })
        .catch(function (err) {
          console.warn('market escrow reconcile ping failed', err);
        });
    }, 1500);
  }

  /** Ping Cloud Function that settles buys/cancels (no laptop / GH Actions required). */
  function maybeRequestMarketSettle(rows) {
    const pending = (rows || []).filter(function (l) {
      return l && (l.status === 'sale_pending' || l.status === 'cancel_requested');
    });
    if (!pending.length) return;

    const url = cfg().marketSettleUrl;
    if (!url) return;

    const now = Date.now();
    if (now - lastSettleAt < 45000) return;

    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      lastSettleAt = Date.now();
      const ping = function (headers) {
        return fetch(url, {
          method: 'POST',
          headers: headers || { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'app-market', count: pending.length }),
        });
      };
      const ready =
        typeof window.growtooFunctionHeaders === 'function'
          ? window.growtooFunctionHeaders()
          : Promise.resolve({ 'Content-Type': 'application/json' });
      ready
        .then(ping)
        .then(function (res) {
          return res.json().catch(function () {
            return null;
          });
        })
        .then(function (data) {
          if (data && (data.sold > 0 || data.cancelled > 0)) {
            console.info('market settle', data);
          }
        })
        .catch(function (err) {
          console.warn('market settle ping failed', err);
        });
    }, 1500);
  }

  function emit() {
    listeners.forEach(function (fn) {
      try {
        fn(listings);
      } catch {
        // ignore
      }
    });
    render();
    if (window.PlantToken && typeof PlantToken.render === 'function') {
      try {
        PlantToken.render();
      } catch {
        // ignore
      }
    }
  }

  // --- data helpers ---------------------------------------------------------

  function assetTypeForStage(stageIndex) {
    const PT = window.PlantToken;
    const stage = PT ? PT.stageByIndex(stageIndex) : null;
    return stage && (stage.key === 'flowering' || stage.key === 'harvest') ? 'flower' : 'seed';
  }

  function stageLabel(stageIndex) {
    const PT = window.PlantToken;
    const stage = PT ? PT.stageByIndex(stageIndex) : null;
    return stage ? stage.label : '';
  }

  const OPEN_STATUSES = ['escrow_pending', 'active', 'sale_pending', 'cancel_requested'];
  const STUCK_MS = 5 * 60 * 1000;

  /* [dictionary key, English] — resolved at render time, since this table
     is built while the page parses, before the dictionary lands. */
  const STUCK_STATUS_LABELS = {
    escrow_pending: ['app.market.stuckActivating', 'Activating escrow…'],
    sale_pending: ['app.market.stuckSettling', 'Investment settling…'],
    cancel_requested: ['app.market.stuckCancelling', 'Cancelling…'],
  };

  function stuckStatusLabel(status) {
    const row = STUCK_STATUS_LABELS[status];
    return row ? T(row[0], row[1]) : status || '';
  }

  function stuckSinceRaw(listing) {
    if (!listing) return null;
    if (listing.status === 'sale_pending') return listing.investedAt || listing.createdAt;
    if (listing.status === 'cancel_requested') {
      return listing.cancelRequestedAt || listing.updatedAt || null;
    }
    return listing.createdAt;
  }

  function listingAgeMs(listing) {
    const raw = stuckSinceRaw(listing);
    if (!raw) return 0;
    if (typeof raw.toDate === 'function') return Date.now() - raw.toDate().getTime();
    const t = Date.parse(raw);
    return Number.isFinite(t) ? Date.now() - t : 0;
  }

  function stuckListings(rows, uid) {
    return (rows || []).filter(function (l) {
      if (!l) return false;
      const mine = l.uid === uid || l.buyerUid === uid;
      if (!mine) return false;
      if (l.status !== 'escrow_pending' && l.status !== 'sale_pending' && l.status !== 'cancel_requested') {
        return false;
      }
      if (l.status === 'cancel_requested' && !stuckSinceRaw(l)) return false;
      return listingAgeMs(l) >= STUCK_MS;
    });
  }

  function renderStuckBanner(rows, uid) {
    const el = document.getElementById('market-stuck');
    if (!el) return;
    if (!el._retryBound) {
      el._retryBound = true;
      el.addEventListener('click', function (e) {
        const btn = e.target.closest('#market-stuck-retry');
        if (!btn) return;
        const count = Number(el.dataset.stuckCount || 0);
        forceReconcileNow(count);
      });
    }
    const stuck = stuckListings(rows, uid);
    if (!stuck.length) {
      el.hidden = true;
      el.dataset.stuckCount = '0';
      el.innerHTML = '';
      return;
    }
    const parts = stuck.map(function (l) {
      const mins = Math.max(1, Math.round(listingAgeMs(l) / 60000));
      return (
        '<li><strong>' +
        esc(l.name || T('app.market.offer', 'Offer')) +
        '</strong> — ' +
        esc(stuckStatusLabel(l.status)) +
        ' for ~' +
        mins +
        ' min</li>'
      );
    });
    el.hidden = false;
    el.dataset.stuckCount = String(stuck.length);
    el.innerHTML =
      '<div class="market-stuck-inner">' +
      '<div class="market-stuck-copy">' +
      '<strong>' +
      esc(T('app.market.settlementPending', 'Settlement pending')) +
      '</strong>' +
      '<p>' +
      esc(
        T(
          'app.market.settlementPendingBody',
          'Cloud workers auto-activate escrow and settle buys/cancels about every 5 minutes. Retry now nudges both.'
        )
      ) +
      '</p>' +
      '<ul>' +
      parts.join('') +
      '</ul>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="market-stuck-retry">' +
      esc(T('app.market.retryNow', 'Retry now')) +
      '</button>' +
      '</div>';
  }

  function forceReconcileNow(count) {
    const reconcileUrl = cfg().marketReconcileUrl;
    const settleUrl = cfg().marketSettleUrl;
    const btn = document.getElementById('market-stuck-retry');
    if (btn) {
      btn.disabled = true;
      btn.textContent = T('app.market.retrying', 'Retrying…');
    }
    lastReconcileAt = 0;
    lastSettleAt = 0;

    function ping(url, body) {
      if (!url) return Promise.resolve({ ok: false });
      const send = function (headers) {
        return fetch(url, {
          method: 'POST',
          headers: headers || { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (res) {
          return res.json().catch(function () {
            return { ok: res.ok };
          });
        });
      };
      const ready =
        typeof window.growtooFunctionHeaders === 'function'
          ? window.growtooFunctionHeaders()
          : Promise.resolve({ 'Content-Type': 'application/json' });
      return ready.then(send).catch(function () {
        return { ok: false };
      });
    }

    Promise.all([
      ping(reconcileUrl, { source: 'app-stuck-retry', count: count || 0 }),
      ping(settleUrl, { source: 'app-stuck-retry', count: count || 0 }),
    ]).then(function (results) {
      const esc = results[0] || {};
      const settle = results[1] || {};
      if (btn) {
        btn.disabled = false;
        btn.textContent = T('app.market.retryNow', 'Retry now');
      }
      if (esc.activated > 0) {
        flashOk(
          T('app.market.activatedListings', 'Activated {count} listings. Refresh if status lags.', {
            count: esc.activated,
          })
        );
        return;
      }
      if (settle.sold > 0 || settle.cancelled > 0) {
        flashOk(
          T(
            'app.market.settledCounts',
            'Settled {sold} sales and {cancelled} cancels. Refresh if status lags.',
            { sold: settle.sold || 0, cancelled: settle.cancelled || 0 }
          )
        );
        return;
      }
      flashOk(
        T(
          'app.market.retrySent',
          'Retry sent to escrow + settle workers. Status should update within a minute if the chain confirms.'
        )
      );
    });
  }

  function listedMintAddresses() {
    const set = new Set();
    listings.forEach(function (l) {
      if (OPEN_STATUSES.includes(l.status)) set.add(l.mintAddress);
    });
    return set;
  }

  // Grower tokens that exist as real devnet NFTs and are not yet listed.
  function listableTokens() {
    const PT = window.PlantToken;
    const SC = window.SeedChain;
    if (!PT || !SC) return [];
    if (typeof PT.syncFromSeedMints === 'function') {
      try {
        PT.syncFromSeedMints();
      } catch {
        // ignore
      }
    }
    const listed = listedMintAddresses();
    return PT.getWallet()
      .tokens.map(function (token) {
        if (token.adopted) return null;
        const mint = token.mintRequestId ? SC.getMint(token.mintRequestId) : null;
        // Only list when Firestore says minted — local mintAddress alone is often a stale
        // garden row after a failed / partial mint (causes MissingNft / “wallet no longer holds”).
        if (!mint || mint.status !== 'minted' || !mint.mintAddress) return null;
        const mintAddress = mint.mintAddress;
        if (listed.has(mintAddress)) return null;
        return {
          token: token,
          mintAddress: mintAddress,
          mintRequestId: token.mintRequestId || mint.id || null,
          mintOwner: mint.owner || null,
        };
      })
      .filter(Boolean);
  }

  /** Mint address a grower can post from this garden card, or ''. */
  function listableMintForToken(tokenId) {
    if (!tokenId) return '';
    const hit = listableTokens().find(function (o) {
      return o && o.token && o.token.id === tokenId;
    });
    return hit && hit.mintAddress ? hit.mintAddress : '';
  }

  let pendingListMint = '';

  /** Switch to Market and pre-select this sealed NFT in the list form. */
  function openListForMint(mintAddress) {
    pendingListMint = String(mintAddress || '');
    const marketView = document.getElementById('view-market');
    const already = !!(marketView && marketView.classList.contains('active'));
    const marketNav = document.querySelector('.nav-item[data-view="market"]');
    if (marketNav && !already) marketNav.click();
    else render();
  }

  /** Garden RWAs that cannot be posted yet (failed / pending mint, or already listed). */
  function unlistableGardenTokens() {
    const PT = window.PlantToken;
    const SC = window.SeedChain;
    if (!PT || !SC) return [];
    const listed = listedMintAddresses();
    const listable = {};
    listableTokens().forEach(function (o) {
      listable[o.token.id] = true;
    });
    return PT.getWallet()
      .tokens.map(function (token) {
        if (token.adopted || listable[token.id]) return null;
        const mint = token.mintRequestId ? SC.getMint(token.mintRequestId) : null;
        const mintAddress =
          (mint && mint.mintAddress) || token.mintAddress || null;
        let reason = T('app.market.reasonUnconfirmed', 'Mint not confirmed on Devnet yet');
        if (mint && mint.status === 'failed') {
          reason = T('app.market.reasonFailed', 'Mint failed — Retry mint on Tokenise');
        } else if (mint && mint.status === 'pending') {
          reason = T('app.market.reasonPending', 'Mint still pending in queue');
        } else if (mintAddress && listed.has(mintAddress)) {
          reason = T('app.market.reasonListed', 'Already listed');
        } else if (!mint && !mintAddress) {
          reason = T('app.market.reasonNoMint', 'No Devnet mint yet — open Tokenise');
        }
        return { token: token, reason: reason };
      })
      .filter(Boolean);
  }

  async function assertWalletHoldsListingNft(mintAddress, mintOwnerHint) {
    // i18n-ignore — a load failure, reported through the console.
    // i18n-ignore — deploy misconfiguration, not grower-facing.
    if (!window.SplTransfer) throw new Error('Token transfer helper is not loaded.');
    const SW = window.SolanaWallet;
    const connected = SW && SW.isConnected() ? SW.getPublicKey() : '';
    const held = await window.SplTransfer.getRawBalance(mintAddress);
    if (held >= 1n) return;

    const escrow = cfg().escrowAddress;
    let escrowHeld = 0n;
    if (escrow) {
      escrowHeld = await window.SplTransfer.getRawBalanceOf(escrow, mintAddress);
    }

    let vaultHeld = 0n;
    if (window.EscrowProgram && typeof EscrowProgram.deriveListingPda === 'function') {
      try {
        const listingPda = await EscrowProgram.deriveListingPda(mintAddress);
        vaultHeld = await window.SplTransfer.getRawBalanceOf(listingPda, mintAddress);
      } catch {
        // ignore derive failures
      }
    }

    if (vaultHeld >= 1n) {
      throw new Error(
        T(
          'app.market.nftInVault',
          'This NFT is already locked in the on-chain market vault. Cancel that listing first, then post again.'
        )
      );
    }
    if (escrowHeld >= 1n) {
      throw new Error(
        T(
          'app.market.nftInEscrow',
          'This NFT is already in the hot-wallet escrow. Refresh Market — it may still be activating.'
        )
      );
    }

    const ownerHint =
      mintOwnerHint && connected && mintOwnerHint !== connected
        ? ' ' +
          T('app.market.ownerHint', 'On-chain owner is {owner}, but you connected {connected}.', {
            owner: mintOwnerHint.slice(0, 4) + '…' + mintOwnerHint.slice(-4),
            connected: connected.slice(0, 4) + '…' + connected.slice(-4),
          })
        : '';

    throw new Error(
      T('app.market.walletMissingNft', 'This connected wallet does not hold that NFT.') +
        ownerHint +
        ' ' +
        T(
          'app.market.walletMissingNftHint',
          'Open Tokenise, confirm “Minted on devnet”, connect the wallet that received the mint (or Retry mint), then try posting again.'
        )
    );
  }

  /** True once $GROWTOO payment (or program buy) was recorded — not a pre-pay reservation. */
  function hasConfirmedPayment(listing) {
    const sig = String(listing.paymentSignature || listing.buySignature || '');
    if (!sig || sig.indexOf('pending-') === 0) return false;
    return sig.length >= 32;
  }

  /**
   * Pull settled / in-flight investments into the adopter garden.
   * Do not adopt on bare sale_pending reservations (pre-payment) — that left
   * orphan "Settlement pending" cards when pay failed (e.g. no $GROWTOO ATA).
   * Also drop garden orphans when the listing is open again without this buyer.
   */
  function syncMyInvestments() {
    const user = currentUser();
    const PT = window.PlantToken;
    if (!user || !PT || typeof PT.adoptFromListing !== 'function') return;

    listings.forEach(function (l) {
      if (l.buyerUid !== user.uid) return;
      if (l.status === 'sold') {
        try {
          PT.adoptFromListing(l);
        } catch (err) {
          console.warn('adoptFromListing failed', err);
        }
        return;
      }
      if (l.status === 'sale_pending' && hasConfirmedPayment(l)) {
        try {
          PT.adoptFromListing(l);
        } catch (err) {
          console.warn('adoptFromListing failed', err);
        }
      }
    });

    if (typeof PT.pruneAbandonedAdoptions === 'function') {
      try {
        PT.pruneAbandonedAdoptions(listings, user.uid);
      } catch (err) {
        console.warn('pruneAbandonedAdoptions failed', err);
      }
    }
  }

  // --- actions ----------------------------------------------------------------

  /** Ensure a live extension session that can sign (not just a linked profile). */
  async function ensureSigningWallet(purpose, opts) {
    /* `purpose` arrives already translated from the call sites below — it is
       spliced into sentences, so it has to be in the reader's language. */
    const why = purpose || T('app.market.purposeSign', 'sign');
    const options = opts || {};
    const SW = window.SolanaWallet;
    if (!SW) {
      throw new Error(
        T(
          'app.market.walletModuleFailed',
          'Solana wallet module failed to load. Refresh and try again.'
        )
      );
    }

    function assertSigningSession() {
      if (!SW.isConnected() || !SW.getPublicKey()) {
        throw new Error(
          T(
            'app.market.reconnectToSign',
            'Reconnect your wallet extension to {purpose}. The account is linked, but Phantom/Solflare is not signed in for this tab.',
            { purpose: why }
          )
        );
      }
      const provider = SW.getProviderName();
      if (provider === 'watch-only' || provider === 'manual') {
        throw new Error(
          T(
            'app.market.watchOnlyCannot',
            'Watch-only wallets cannot {purpose}. Connect Phantom or Solflare.',
            { purpose: why }
          )
        );
      }
      return SW;
    }

    if (SW.isConnected() && SW.getPublicKey()) {
      return assertSigningSession();
    }

    // Callers that already warned the user (e.g. monthly bonus) must not ambush
    // with the wallet picker — surface a clear next step instead.
    if (options.autoConnect === false) {
      throw new Error(
        T('app.market.connectFirstTo', 'Connect Phantom or Solflare first to {purpose}.', {
          purpose: why,
        })
      );
    }

    // Open the normal connect flow so the user can approve in the extension.
    if (window.PlantToken && typeof PlantToken.connect === 'function') {
      await PlantToken.connect();
    } else if (typeof SW.connect === 'function') {
      await SW.connect();
    }

    return assertSigningSession();
  }

  async function createListing(tokenEntry, priceGrow, opts) {
    const user = currentUser();
    if (!user) throw new Error(T('app.market.signInToPost', 'Sign in to post a plant offer.'));
    if (!isGrowerUi()) {
      throw new Error(
        T('app.market.growerOnlyPost', 'Only grower accounts can post plant offers.')
      );
    }

    const SW = await ensureSigningWallet(
      T('app.market.purposePost', 'post an offer (hold the plant token)')
    );
    const token = tokenEntry.token;
    const priceRounded = Math.round(priceGrow);
    const stakeMode = opts && opts.settlement === 'adopt_stake';
    // Instant lists prefer program PDA escrow whenever the program id is set.
    // Legacy hot-wallet only when adopt_stake, explicit opts.settlement:'legacy',
    // or ChainConfig.settlementMode === 'legacy'.
    const forceLegacy =
      (opts && opts.settlement === 'legacy') || cfg().settlementMode === 'legacy';
    const useProgram = !stakeMode && !forceLegacy && !!cfg().escrowProgramId;
    const lockedGrow = stakeMode ? Math.floor(priceRounded / 2) : 0;
    const immediateGrow = stakeMode ? priceRounded - lockedGrow : priceRounded;
    const careEscrow = cfg().careEscrowAddress || cfg().escrowAddress;

    if (useProgram) {
      // i18n-ignore — deploy misconfiguration, not grower-facing.
      if (!window.EscrowProgram) throw new Error('Escrow program client is not loaded.');
      await assertWalletHoldsListingNft(tokenEntry.mintAddress, tokenEntry.mintOwner);
      const result = await window.EscrowProgram.listNft(tokenEntry.mintAddress, priceRounded);
      await firebase.firestore().collection('marketListings').add({
        uid: user.uid,
        sellerPubkey: SW.getPublicKey(),
        mintAddress: tokenEntry.mintAddress,
        mintRequestId: tokenEntry.mintRequestId || token.mintRequestId || null,
        plantId: token.plantId || null,
        name: token.name,
        strain: token.strain || token.name,
        batch: token.batch || '',
        stage: stageLabel(token.stageIndex),
        assetType: assetTypeForStage(token.stageIndex),
        offerType: 'invest',
        priceGrow: priceRounded,
        status: 'active',
        settlement: 'program',
        listingPda: result.listingPda,
        listSignature: result.signature,
        escrowSignature: result.signature,
        cluster: 'devnet',
        createdAt: new Date().toISOString(),
        // Do not embed journal notes or base64 photos on the listing doc —
        // those leak to every signed-in market reader. Card UI uses botanical art
        // + stage label; seller-local enrichListingStory can still fill from device.
        journalStage: (function () {
          const story = storySnapshotForPlant(token.plantId);
          return (story && story.journalStage) || null;
        })(),
      });
    } else {
      const escrow = cfg().escrowAddress;
      // i18n-ignore — deploy misconfiguration, not grower-facing.
      if (!escrow) throw new Error('Escrow address is not configured.');
      // i18n-ignore — deploy misconfiguration, not grower-facing.
      if (!window.SplTransfer) throw new Error('Token transfer helper is not loaded.');
      // i18n-ignore — deploy misconfiguration, not grower-facing.
      if (stakeMode && !careEscrow) throw new Error('Care escrow address is not configured.');

      await assertWalletHoldsListingNft(tokenEntry.mintAddress, tokenEntry.mintOwner);

      let escrowSignature = null;
      const held = await window.SplTransfer.getRawBalance(tokenEntry.mintAddress);
      if (held >= 1n) {
        escrowSignature = await window.SplTransfer.transferNft(tokenEntry.mintAddress, escrow);
      } else {
        // assertWalletHoldsListingNft already checked escrow/vault; recover if race filled escrow.
        const escrowHeld = await window.SplTransfer.getRawBalanceOf(escrow, tokenEntry.mintAddress);
        if (escrowHeld < 1n) {
          throw new Error(
            T(
              'app.market.walletMissingNftOwning',
              'This connected wallet does not hold that NFT. Confirm mint on Tokenise, then connect the owning wallet.'
            )
          );
        }
        escrowSignature = 'recovered-escrow-' + Date.now();
      }

      const story = storySnapshotForPlant(token.plantId);
      const listing = {
        uid: user.uid,
        sellerPubkey: SW.getPublicKey(),
        mintAddress: tokenEntry.mintAddress,
        mintRequestId: tokenEntry.mintRequestId || token.mintRequestId || null,
        plantId: token.plantId || null,
        name: token.name,
        strain: token.strain || token.name,
        batch: token.batch || '',
        stage: stageLabel(token.stageIndex),
        assetType: assetTypeForStage(token.stageIndex),
        offerType: stakeMode ? 'adopt_stake' : 'invest',
        priceGrow: priceRounded,
        status: 'escrow_pending',
        settlement: stakeMode ? 'adopt_stake' : 'legacy',
        escrowSignature,
        cluster: 'devnet',
        createdAt: new Date().toISOString(),
      };
      if (story && story.journalStage) {
        listing.journalStage = story.journalStage;
      }
      if (stakeMode) {
        listing.stakeLockedBps = 5000;
        listing.immediateGrow = immediateGrow;
        listing.lockedGrow = lockedGrow;
        listing.totalGrow = priceRounded;
        listing.careEscrowAddress = careEscrow;
        listing.careStatus = 'listed';
      }
      await firebase.firestore().collection('marketListings').add(listing);
    }

    if (window.PlantToken && typeof PlantToken.markTokenListed === 'function') {
      PlantToken.markTokenListed(tokenEntry.mintAddress, tokenEntry.mintRequestId);
    }
    return useProgram ? 'program' : stakeMode ? 'adopt_stake' : 'legacy';
  }

  /**
   * Local receipts for in-flight adopt payments.
   *
   * The invest flow reserves a listing, sends $GROWTOO, then writes the real
   * signature back. If that last write never lands — tab closed, network drop,
   * browser killed right after signing — the listing keeps its `pending-`
   * marker and the queue reopens it 15 minutes later, dropping every field
   * that tied the payment to the adopter. The money is in the care escrow with
   * nothing pointing at it: no worker scans the chain, and reconcile only ever
   * reads listing status.
   *
   * A receipt is written before the transfer and updated the moment a
   * signature exists, so the next load can repair the missing write or, if the
   * listing was already reopened, tell the adopter what they are holding.
   */
  const PAY_RECEIPTS_KEY = 'growtoo:adopt-pay-receipts';

  function readPayReceipts() {
    try {
      const raw = localStorage.getItem(PAY_RECEIPTS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function writePayReceipts(list) {
    try {
      localStorage.setItem(PAY_RECEIPTS_KEY, JSON.stringify(list.slice(-25)));
    } catch (_) {
      /* private mode / quota — recovery is best effort */
    }
  }

  function savePayReceipt(patch) {
    const list = readPayReceipts();
    const idx = list.findIndex(function (r) {
      return r && r.listingId === patch.listingId && r.reservationId === patch.reservationId;
    });
    if (idx === -1) list.push(patch);
    else list[idx] = Object.assign({}, list[idx], patch);
    writePayReceipts(list);
  }

  function clearPayReceipt(listingId, reservationId) {
    writePayReceipts(
      readPayReceipts().filter(function (r) {
        return !(r && r.listingId === listingId && r.reservationId === reservationId);
      })
    );
  }

  /**
   * Re-attach any payment whose signature never reached Firestore.
   *
   * Only repairs a listing that is still reserved by this user and still
   * carries the matching `pending-` marker — never overwrites a listing that
   * has moved on or been claimed by someone else.
   */
  async function recoverPendingPayments() {
    const receipts = readPayReceipts().filter(function (r) {
      return r && r.signature && r.listingId;
    });
    if (!receipts.length) return;
    let user = null;
    try {
      user = firebase.auth().currentUser;
    } catch (_) {
      return;
    }
    if (!user) return;

    for (let i = 0; i < receipts.length; i += 1) {
      const rec = receipts[i];
      try {
        const ref = firebase.firestore().collection('marketListings').doc(rec.listingId);
        /* eslint-disable no-await-in-loop */
        const snap = await ref.get();
        /* eslint-enable no-await-in-loop */
        if (!snap.exists) {
          clearPayReceipt(rec.listingId, rec.reservationId);
          continue;
        }
        const data = snap.data() || {};
        if (data.paymentSignature === rec.signature) {
          // Already recorded — the write did land.
          clearPayReceipt(rec.listingId, rec.reservationId);
          continue;
        }
        const stillOurReservation =
          data.status === 'sale_pending' &&
          data.buyerUid === user.uid &&
          String(data.paymentSignature || '') === rec.reservationId;
        if (stillOurReservation) {
          // Exactly these two keys: firestore.rules restricts this update to
          // hasOnly(['paymentSignature', 'investedAt']), so a diagnostic field
          // here would get the whole write rejected. investedAt carries the
          // real payment time from the receipt, not the recovery time.
          /* eslint-disable no-await-in-loop */
          await ref.update({
            paymentSignature: rec.signature,
            investedAt: rec.paidAt || new Date().toISOString(),
          });
          /* eslint-enable no-await-in-loop */
          console.log('Recovered adopt payment for listing', rec.listingId);
          clearPayReceipt(rec.listingId, rec.reservationId);
          continue;
        }
        // The listing moved on without this payment. Do not touch it — surface
        // it instead, with the signature the adopter needs to be made whole.
        // i18n-ignore — console diagnostic for the recovery path.
        console.warn(
          'Adopt payment has no matching reservation — listing ' +
            rec.listingId +
            ' is now "' +
            (data.status || 'unknown') +
            '". Signature ' +
            rec.signature
        );
        if (window.DnevnikNotifications) {
          DnevnikNotifications.push({
            type: 'sale_settled',
            title: T('app.market.paymentReviewTitle', 'Payment needs review'),
            body: T(
              'app.market.paymentReviewBody',
              'Your {amount} $GROWTOO payment for "{plant}" did not attach to the offer. Keep this reference: {signature}',
              {
                amount: rec.priceGrow || '',
                plant: rec.name || T('app.market.aPlant', 'a plant'),
                signature: rec.signature,
              }
            ),
            meta: { key: 'pay-orphan:' + rec.listingId, listingId: rec.listingId },
            kind: 'warning',
            dedupKey: 'pay-orphan:' + rec.listingId,
          });
        }
      } catch (err) {
        console.warn('Payment recovery failed for', rec.listingId, err);
      }
    }
  }

  function isWatchOnlySession() {
    try {
      return !!(
        window.SolanaWallet &&
        typeof SolanaWallet.isWatchOnly === 'function' &&
        SolanaWallet.isWatchOnly()
      );
    } catch (e) {
      return false;
    }
  }

  async function hydrateListingForTrade(listing) {
    if (!listing || !listing.id) return listing;
    if (listing.sellerPubkey && listing.mintAddress && !listing.fromTape) return listing;
    if (!firebaseReady()) return listing;
    try {
      const snap = await firebase.firestore().collection('marketListings').doc(listing.id).get();
      if (!snap.exists) return listing;
      return Object.assign({}, listing, snap.data(), { id: listing.id, fromTape: false });
    } catch (err) {
      console.warn('hydrateListingForTrade failed', listing.id, err);
      return listing;
    }
  }

  async function investInListing(listing) {
    const user = currentUser();
    if (!user) throw new Error(T('app.market.signInToInvest', 'Sign in to invest.'));
    if (!isAdopterUi()) {
      throw new Error(
        T(
          'app.market.adopterOnlyInvest',
          'Switch to an adopter account to invest in plant offers.'
        )
      );
    }

    listing = await hydrateListingForTrade(listing);
    const SW = await ensureSigningWallet(T('app.market.purposeInvest', 'invest ($GROWTOO payment)'));
    const ref = firebase.firestore().collection('marketListings').doc(listing.id);

    if (listing.settlement === 'program') {
      // i18n-ignore — deploy misconfiguration, not grower-facing.
      if (!window.EscrowProgram) throw new Error('Escrow program client is not loaded.');
      let buySignature = null;
      try {
        buySignature = await window.EscrowProgram.buyListing(listing);
      } catch (err) {
        const recovered =
          (err && err.signature) ||
          (String((err && err.message) || '').match(
            /Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,100})/
          ) || [])[1];
        if (!recovered) throw err;
        buySignature = recovered;
      }

      await ref.update({
        status: 'sold',
        buyerUid: user.uid,
        buyerPubkey: SW.getPublicKey(),
        paymentSignature: buySignature,
        buySignature: buySignature,
        investedAt: new Date().toISOString(),
        soldAt: new Date().toISOString(),
      });

      if (window.PlantToken && typeof PlantToken.adoptFromListing === 'function') {
        PlantToken.adoptFromListing(
          Object.assign({}, listing, {
            status: 'sold',
            buyerUid: user.uid,
            buyerPubkey: SW.getPublicKey(),
            paymentSignature: buySignature,
          })
        );
      }
      await notifySellerStake(
        Object.assign({}, listing, {
          status: 'sold',
          buyerUid: user.uid,
        }),
        SW.getPublicKey()
      );
      if (window.DnevnikNotifications) {
        DnevnikNotifications.push({
          type: 'sale_settled',
          title: T('app.market.investDoneTitle', 'Investment complete'),
          body: T('app.market.investDoneBody', 'You adopted "{plant}" for {amount} $GROWTOO.', {
            plant: listing.name || T('app.notif.plantLower', 'plant'),
            amount: listing.priceGrow,
          }),
          meta: { key: 'buy:' + listing.id, listingId: listing.id },
          action: { view: 'adopt' },
          kind: 'success',
          dedupKey: 'buy:' + listing.id,
        });
      }
      return;
    }

    const reservationId = 'pending-' + user.uid.slice(0, 8) + '-' + Date.now();

    // Reserve before paying so a second buyer cannot also send $GROWTOO.
    await firebase.firestore().runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(T('app.market.offerGone', 'Offer no longer exists.'));
      const data = snap.data() || {};
      if (data.status !== 'active') {
        throw new Error(
          T('app.market.offerClosed', 'This offer is no longer open for investment.')
        );
      }
      tx.update(ref, {
        status: 'sale_pending',
        buyerUid: user.uid,
        buyerPubkey: SW.getPublicKey(),
        paymentSignature: reservationId,
        investedAt: new Date().toISOString(),
      });
    });

    let paymentSignature = null;
    try {
      const payTo =
        listing.settlement === 'adopt_stake'
          ? listing.careEscrowAddress || cfg().careEscrowAddress || cfg().escrowAddress
          : listing.sellerPubkey;
      // i18n-ignore — deploy misconfiguration, not grower-facing.
      if (!payTo) throw new Error('Payment destination is not configured.');
      // Record the intent before any value moves, so a crash mid-transfer
      // still leaves a trace of what was attempted and where.
      savePayReceipt({
        listingId: listing.id,
        reservationId: reservationId,
        name: listing.name || null,
        priceGrow: listing.priceGrow || null,
        payTo: payTo,
        startedAt: new Date().toISOString(),
        signature: null,
      });
      paymentSignature = await window.SplTransfer.payGrow(payTo, listing.priceGrow);
    } catch (err) {
      // Confirm timeout after broadcast still includes the signature — recover it.
      const recovered =
        (err && err.signature) ||
        (String((err && err.message) || '').match(
          /Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,100})/
        ) || [])[1];
      if (recovered) {
        paymentSignature = recovered;
        savePayReceipt({
          listingId: listing.id,
          reservationId: reservationId,
          signature: recovered,
          paidAt: new Date().toISOString(),
        });
      } else {
        // Nothing was broadcast, so there is no payment to protect.
        clearPayReceipt(listing.id, reservationId);
        try {
          await ref.update({
            status: 'active',
            buyerUid: firebase.firestore.FieldValue.delete(),
            buyerPubkey: firebase.firestore.FieldValue.delete(),
            paymentSignature: firebase.firestore.FieldValue.delete(),
            investedAt: firebase.firestore.FieldValue.delete(),
          });
        } catch (releaseErr) {
          console.warn('Failed to release invest reservation', releaseErr);
        }
        throw err;
      }
    }

    // Persist the signature locally *before* the remote write. This is the gap
    // that loses money: the transfer has settled, and if this update never
    // lands the queue reopens the listing and erases every link to it.
    savePayReceipt({
      listingId: listing.id,
      reservationId: reservationId,
      signature: paymentSignature,
      paidAt: new Date().toISOString(),
    });

    await ref.update({
      paymentSignature: paymentSignature,
      investedAt: new Date().toISOString(),
    });

    // Recorded remotely — the local receipt has done its job.
    clearPayReceipt(listing.id, reservationId);

    if (window.PlantToken && typeof PlantToken.adoptFromListing === 'function') {
      PlantToken.adoptFromListing(
        Object.assign({}, listing, {
          status: 'sale_pending',
          buyerUid: user.uid,
          buyerPubkey: SW.getPublicKey(),
          paymentSignature: paymentSignature,
        })
      );
    }

    await notifySellerStake(
      Object.assign({}, listing, {
        status: 'sale_pending',
        buyerUid: user.uid,
      }),
      SW.getPublicKey()
    );
    if (window.DnevnikNotifications) {
      DnevnikNotifications.push({
        type: 'sale_settled',
        title: T('app.market.investSentTitle', 'Investment submitted'),
        body: T(
          'app.market.investSentBody',
          'Paid {amount} $GROWTOO for "{plant}". NFT settles via queue.',
          { amount: listing.priceGrow, plant: listing.name || T('app.notif.plantLower', 'plant') }
        ),
        meta: { key: 'buy-pending:' + listing.id, listingId: listing.id },
        action: { view: 'adopt' },
        kind: 'success',
        dedupKey: 'buy-pending:' + listing.id,
      });
    }
  }

  async function cancelListing(listing) {
    listing = await hydrateListingForTrade(listing);
    const ref = firebase.firestore().collection('marketListings').doc(listing.id);
    if (listing.settlement === 'program') {
      await ensureSigningWallet(T('app.market.purposeCancel', 'cancel offer (reclaim NFT)'));
      // i18n-ignore — deploy misconfiguration, not grower-facing.
      if (!window.EscrowProgram) throw new Error('Escrow program client is not loaded.');
      let cancelSignature = null;
      try {
        cancelSignature = await window.EscrowProgram.cancelListing(listing);
      } catch (err) {
        const recovered =
          (err && err.signature) ||
          (String((err && err.message) || '').match(
            /Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,100})/
          ) || [])[1];
        if (!recovered) throw err;
        cancelSignature = recovered;
      }
      await ref.update({
        status: 'cancelled',
        cancelSignature: cancelSignature,
        cancelledAt: new Date().toISOString(),
      });
      return;
    }

    await ref.update({
      status: 'cancel_requested',
      cancelRequestedAt: new Date().toISOString(),
    });
  }

  // --- UI --------------------------------------------------------------------

  /* [dictionary key, English] — resolved in statusLabel(), since this table
     is built while the page parses, before the dictionary lands. */
  const STATUS_LABELS = {
    escrow_pending: ['app.market.statusPreparing', 'Preparing listing…'],
    active: ['app.market.statusActive', 'Open for investment'],
    sale_pending: ['app.market.stuckSettling', 'Investment settling…'],
    cancel_requested: ['app.market.stuckCancelling', 'Cancelling…'],
    sold: ['app.market.statusSold', 'Adopted'],
    cancelled: ['app.market.statusCancelled', 'Cancelled'],
    failed: ['app.market.statusFailed', 'Failed'],
  };

  function statusLabel(status) {
    const row = STATUS_LABELS[status];
    return row ? T(row[0], row[1]) : status || '';
  }

  function statusBadge(status) {
    return (
      '<span class="market-status market-status--' +
      esc(status) +
      '">' +
      esc(statusLabel(status)) +
      '</span>'
    );
  }

  function assetBadge(assetType) {
    const flower = assetType === 'flower';
    const label = isAdopterUi()
      ? flower
        ? T('app.market.badgeFlower', 'Flower')
        : T('app.market.badgeSeed', 'Seed')
      : flower
        ? T('app.market.badgeFlowerToken', 'Flower token')
        : T('app.market.badgeSeedToken', 'Seed token');
    return (
      '<span class="market-asset-badge market-asset-badge--' +
      esc(assetType || 'seed') +
      '">' +
      label +
      '</span>'
    );
  }

  function settlementBadge(listing) {
    if (listing.settlement === 'adopt_stake') {
      return (
        '<span class="market-asset-badge market-asset-badge--stake" title="' +
        esc(
          T(
            'app.market.stakeBadgeTitle',
            'You pay full price now. Half to grower on settle; half locked until harvest care.'
          )
        ) +
        '">' +
        esc(T('app.market.badgeAdoptStake', 'Adopt stake')) +
        '</span>'
      );
    }
    return (
      '<span class="market-asset-badge market-asset-badge--instant" title="' +
      esc(
        T('app.market.instantBadgeTitle', 'Full price to grower; plant token transfers on buy.')
      ) +
      '">' +
      esc(T('app.market.badgeInstantSale', 'Instant sale')) +
      '</span>'
    );
  }

  function tip(term, label) {
    if (window.GrowtooPlain && typeof GrowtooPlain.tipHtml === 'function') {
      return GrowtooPlain.tipHtml(term, label);
    }
    return esc(label || term);
  }

  /** Thin-stroke glyphs matching the nav/icon language. */
  const GROUPED_ICONS = {
    batch:
      '<svg viewBox="0 0 24 24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2.4"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    nft: '<svg viewBox="0 0 24 24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 3v18M5 7l7 4 7-4"/></svg>',
    pda: '<svg viewBox="0 0 24 24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-7-10a7 7 0 0114 0c0 5.5-7 10-7 10z"/><circle cx="12" cy="11" r="2.4"/></svg>',
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

  /** Collapsible mint / pubkey chrome. Closed until opened. */
  function chainDetailsHtml(innerHtml, opts) {
    if (!innerHtml) return '';
    const o = opts || {};
    const open = o.forceOpen === true;
    return (
      '<details class="chain-details"' +
      (open ? ' open' : '') +
      '>' +
      '<summary class="chain-details-summary">' +
      esc(o.summary || T('app.market.chainDetails', 'Chain details')) +
      '</summary>' +
      '<div class="chain-details-body">' +
      innerHtml +
      '</div>' +
      '</details>'
    );
  }

  function readLocalPlants() {
    try {
      const raw = localStorage.getItem('dnevnik-live-plants');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function readLocalEntries() {
    try {
      const raw = localStorage.getItem('dnevnik-live-entries');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function storySnapshotForPlant(plantId) {
    if (!plantId) return null;
    const plant = readLocalPlants().find(function (p) {
      return p && String(p.id) === String(plantId);
    });
    if (!plant) return null;
    const entries = readLocalEntries()
      .filter(function (e) {
        return e && String(e.plantId) === String(plantId) && (e.note || e.photo);
      })
      .sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      })
      .slice(0, 3)
      .map(function (e) {
        return {
          date: e.date || null,
          type: e.type || '',
          note: String(e.note || '').trim().slice(0, 120),
        };
      })
      .filter(function (e) {
        return e.note;
      });
    return {
      photo: plant.photo || null,
      journalStage: plant.stage || null,
      journalSnippets: entries,
    };
  }

  function enrichListingStory(listing) {
    if (!listing) return listing;
    const uid = currentUser() ? currentUser().uid : '';
    const mine = !!(uid && listing.uid && listing.uid === uid);
    if (!mine) {
      if (listing.journalSnippets || listing.photo) {
        const copy = Object.assign({}, listing);
        delete copy.journalSnippets;
        delete copy.photo;
        return copy;
      }
      return listing;
    }
    if (listing.photo || (listing.journalSnippets && listing.journalSnippets.length)) {
      return listing;
    }
    const snap = storySnapshotForPlant(listing.plantId);
    if (!snap) return listing;
    return Object.assign({}, listing, {
      photo: listing.photo || snap.photo,
      journalSnippets: listing.journalSnippets || snap.journalSnippets,
      journalStage: listing.journalStage || snap.journalStage,
    });
  }

  function offerExplainHtml(listing) {
    if (!isAdopterUi() || listing.status !== 'active') return '';
    if (listing.settlement === 'adopt_stake') {
      const locked =
        listing.lockedGrow != null ? listing.lockedGrow : Math.floor(Number(listing.priceGrow || 0) / 2);
      const immediate =
        listing.immediateGrow != null
          ? listing.immediateGrow
          : Number(listing.priceGrow || 0) - locked;
      return (
        '<p class="market-card-explain market-card-explain--stake">' +
        T(
          'app.market.explainStake',
          'Pay <strong>{total}</strong> now · <strong>{immediate}</strong> to grower on {settle} · <strong>{locked}</strong> locked until harvest care. Token after settlement.',
          {
            total: esc(String(listing.priceGrow)),
            immediate: esc(String(immediate)),
            locked: esc(String(locked)),
            settle: tip('settle', T('app.market.settleWord', 'settle')),
          }
        ) +
        '</p>'
      );
    }
    return (
      '<p class="market-card-explain market-card-explain--instant">' +
      T(
        'app.market.explainInstant',
        'Pay <strong>{total} $GROWTOO</strong> and receive the plant token in this flow.',
        { total: esc(String(listing.priceGrow)) }
      ) +
      '</p>'
    );
  }

  function storyArtHtml(listing) {
    let stageIndex = 0;
    if (window.PlantToken && typeof PlantToken.stageIndexFromLabel === 'function') {
      stageIndex = PlantToken.stageIndexFromLabel(
        listing.liveStage ||
          listing.liveStageKey ||
          listing.stage ||
          listing.journalStage ||
          listing.assetType ||
          ''
      );
    }
    let svg = '';
    if (window.PlantToken && typeof PlantToken.renderPlantSvg === 'function') {
      svg = PlantToken.renderPlantSvg(stageIndex, { compact: true });
    } else if (window.TokenBotanicalArt && typeof TokenBotanicalArt.renderStageSvg === 'function') {
      svg = TokenBotanicalArt.renderStageSvg(stageIndex, { compact: true });
    }
    if (svg) {
      return (
        '<div class="market-card-photo market-card-photo--art" aria-hidden="true">' +
        svg +
        '</div>'
      );
    }
    return '<div class="market-card-photo market-card-photo--empty" aria-hidden="true"></div>';
  }

  function storyBlockHtml(listing) {
    // Botanical etching is the card face; journal photo (if any) sits as a small seal.
    const art = storyArtHtml(listing);
    const photoChip = listing.photo
      ? '<img class="market-card-photo-chip" src="' +
        esc(listing.photo) +
        '" alt="" loading="lazy" />'
      : '';
    const stage = listingDisplayStage(listing);
    const snippets = Array.isArray(listing.journalSnippets) ? listing.journalSnippets : [];
    const journalHtml = snippets.length
      ? '<ul class="market-card-journal">' +
        snippets
          .slice(0, 2)
          .map(function (s) {
            return (
              '<li><span class="market-card-journal-date">' +
              esc(s.date || '') +
              '</span> ' +
              esc(s.note) +
              '</li>'
            );
          })
          .join('') +
        '</ul>'
      : '<p class="market-card-journal-empty">' +
        esc(
          T(
            'app.market.journalEmpty',
            'Journal trail linked — open after adopt to follow care logs.'
          )
        ) +
        '</p>';
    return (
      '<div class="market-card-story">' +
      '<div class="market-card-photo-wrap">' +
      art +
      photoChip +
      '</div>' +
      '<div class="market-card-story-body">' +
      (stage
        ? '<span class="market-card-stage-chip">' + esc(stage) + '</span>'
        : '') +
      journalHtml +
      '</div></div>'
    );
  }

  function listingDisplayStage(listing) {
    if (!listing) return '';
    if (listing.liveStage) return String(listing.liveStage);
    const snap = listing.plantId ? storySnapshotForPlant(listing.plantId) : null;
    return String(
      (snap && snap.journalStage) || listing.journalStage || listing.stage || ''
    );
  }

  function listingHarvestReady(listing) {
    if (!listing) return false;
    if (listing.harvestReady === true || listing.liveStageKey === 'harvest') return true;
    const stage = listingDisplayStage(listing).toLowerCase();
    return (
      stage.indexOf('harvest') >= 0 ||
      stage.indexOf('susenje') >= 0 ||
      stage.indexOf('drying') >= 0 ||
      stage === 'dry'
    );
  }

  function listingCardHtml(listing, uid) {
    listing = enrichListingStory(listing);
    const isMine = listing.uid === uid;
    const isBuyer = listing.buyerUid === uid;
    const canInvest = isAdopterUi() && !isMine && listing.status === 'active';
    const canCancel = isGrowerUi() && isMine && listing.status === 'active';
    const harvestClaimDoc =
      listing.settlement === 'adopt_stake' ? getHarvestClaim(listing.id) : null;
    const harvestClaimPending = !!(
      harvestClaimDoc &&
      (harvestClaimDoc.status === 'pending' || harvestClaimDoc.optimisticPending)
    );
    const canHarvestClaim =
      isGrowerUi() &&
      isMine &&
      listing.settlement === 'adopt_stake' &&
      listing.status === 'sold' &&
      listing.careStatus === 'active' &&
      !harvestClaimPending;
    const harvestReady = canHarvestClaim && listingHarvestReady(listing);
    const isDead =
      listing.status === 'cancelled' ||
      listing.status === 'failed' ||
      listing.status === 'sold';
    const nameNorm = String(listing.name || '').trim().toLowerCase();
    const strainNorm = String(listing.strain || '').trim().toLowerCase();
    const showStrain = strainNorm && strainNorm !== nameNorm;
    let careLine = '';
    if (listing.settlement === 'adopt_stake' && listing.careStatus) {
      const locked =
        listing.lockedGrow != null
          ? ' · locked ' + esc(String(listing.lockedGrow)) + ' $GROWTOO'
          : '';
      let progress = '';
      if (listing.careStatus === 'active') {
        const q = Array.isArray(listing.qualifyingMonthKeys)
          ? listing.qualifyingMonthKeys.length
          : 0;
        const needed = Array.isArray(listing.careMonthKeys)
          ? listing.careMonthKeys.length
          : listing.adoptedAt
            ? '…'
            : null;
        if (needed != null) {
          progress += ' · months ' + esc(String(q)) + '/' + esc(String(needed));
        }
        if (listing.currentMonthKey != null && listing.currentMonthDaysHit != null) {
          const minDays =
            listing.currentMonthMinDays != null ? listing.currentMonthMinDays : 12;
          progress +=
            ' · ' +
            esc(String(listing.currentMonthKey)) +
            ' ' +
            esc(String(listing.currentMonthDaysHit)) +
            '/' +
            esc(String(minDays)) +
            ' days';
        }
      }
      careLine =
        '<p class="market-card-meta">' +
        T('app.market.careEscrowLabel', 'Care {escrow}', {
          escrow: tip('escrow', T('app.market.escrowWord', 'escrow')),
        }) +
        ': <strong>' +
        esc(listing.careStatus) +
        '</strong>' +
        locked +
        progress +
        '</p>';
    }
    let phaseRail = '';
    if (window.StatusRail) {
      const careSettled =
        listing.careStatus === 'released' || listing.careStatus === 'refunded';
      if (
        window.StatusRail.harvestClaimPipeline &&
        (harvestClaimDoc || careSettled) &&
        (isMine || isBuyer || careSettled)
      ) {
        phaseRail =
          StatusRail.harvestClaimPipeline({
            claim: harvestClaimDoc,
            listing: listing,
          }) || '';
      }
      if (!phaseRail && (isBuyer || listing.status === 'sale_pending' || listing.status === 'sold')) {
        phaseRail = StatusRail.investPipeline(listing) || '';
      }
      // In-flight grower listing states only (skip quiet "Live" on every active card).
      if (
        !phaseRail &&
        isMine &&
        (listing.status === 'escrow_pending' ||
          listing.status === 'cancel_requested' ||
          listing.status === 'failed' ||
          listing.status === 'cancelled' ||
          listing.status === 'sale_pending' ||
          listing.status === 'sold')
      ) {
        phaseRail = StatusRail.listingPipeline(listing) || '';
      }
    }
    const priceLabel =
      listing.status === 'sold' || listing.status === 'sale_pending'
        ? T('app.market.priceStakeSale', 'Stake / sale')
        : listing.status === 'cancelled'
          ? T('app.market.priceWasListed', 'Was listed at')
          : T('app.market.priceAsk', 'Ask price');
    const investLabel =
      listing.settlement === 'adopt_stake'
        ? T('app.market.investStake', 'Adopt · stake')
        : T('app.market.investBuy', 'Adopt · buy');
    const watchOnlyInvest = canInvest && isWatchOnlySession();
    const showStory = isAdopterUi() || listing.status === 'active';
    const statusTint =
      listing.status === 'active'
        ? 'active'
        : listing.status === 'sold'
          ? 'sold'
          : listing.status === 'cancelled' || listing.status === 'failed'
            ? 'dead'
            : 'pending';
    return (
      '<article class="market-card' +
      (isDead ? ' market-card--dead' : '') +
      (isAdopterUi() ? ' market-card--adopter' : '') +
      '" data-id="' +
      esc(listing.id) +
      '" data-status-tint="' +
      statusTint +
      '">' +
      '<div class="market-card-head">' +
      assetBadge(listing.assetType) +
      settlementBadge(listing) +
      statusBadge(listing.status) +
      '</div>' +
      (showStory ? storyBlockHtml(listing) : '') +
      '<h4 class="market-card-name">' +
      esc(listing.name) +
      '</h4>' +
      '<p class="market-card-meta">' +
      (showStrain ? esc(listing.strain) : '') +
      (function () {
        const live = listingDisplayStage(listing);
        const prefix = showStrain ? ' · ' : '';
        return live ? prefix + esc(live) : '';
      })() +
      '</p>' +
      phaseRail +
      '<div class="market-card-foot">' +
      '<span class="market-price"><span class="market-price-label">' +
      esc(priceLabel) +
      '</span>' +
      Number(listing.priceGrow).toLocaleString('en-US') +
      ' $GROWTOO</span>' +
      (canInvest && !watchOnlyInvest
        ? '<button type="button" class="btn btn-primary btn-sm market-invest-btn" data-id="' +
          esc(listing.id) +
          '">' +
          esc(investLabel) +
          '</button>'
        : '') +
      (watchOnlyInvest
        ? '<button type="button" class="btn btn-ghost btn-sm" disabled title="' +
          esc(
            T(
              'app.market.watchOnlyInvest',
              'Watch-only cannot invest. Connect Phantom or Solflare.'
            )
          ) +
          '">' +
          esc(T('app.wallet.watchOnly', 'Watch-only')) +
          '</button>'
        : '') +
      (canCancel
        ? '<button type="button" class="btn btn-ghost btn-sm market-cancel-btn" data-id="' +
          esc(listing.id) +
          '">' +
          esc(T('app.market.cancelBtn', 'Cancel')) +
          '</button>'
        : '') +
      (canHarvestClaim && harvestReady
        ? '<button type="button" class="btn btn-primary btn-sm market-harvest-claim-btn" data-id="' +
          esc(listing.id) +
          '" data-plant-id="' +
          esc(listing.plantId || '') +
          '">' +
          esc(T('app.market.claimLockedBtn', 'Claim locked stake ($GROWTOO)')) +
          '</button>'
        : '') +
      (canHarvestClaim && harvestReady
        ? '<p class="market-card-redeem-note market-card-redeem-note--later">' +
          esc(
            T(
              'app.market.redemptionLater',
              'Physical harvest redemption — coming later. This claim only settles the locked $GROWTOO.'
            )
          ) +
          '</p>'
        : '') +
      '</div>' +
      (harvestClaimPending && isMine
        ? '<p class="market-card-meta">' +
          esc(
            T('app.market.claimQueued', 'Claim queued — waiting for the adopt worker (~5 min).')
          ) +
          '</p>'
        : canHarvestClaim && !harvestReady
          ? '<p class="market-card-meta">' +
            esc(
              T(
                'app.market.reachHarvest',
                'Reach harvest stage in the journal to claim the locked $GROWTOO half.'
              )
            ) +
            '</p>'
          : '') +
      (listing.status === 'failed' && listing.error && isMine
        ? '<p class="market-card-error">' + esc(listing.error) + '</p>'
        : '') +
      // Reference material — how stake vs instant works, care-escrow numbers,
      // and chain specifics. Identity, live status, price and the action
      // buttons above are never hidden; this is background reading.
      '<details class="market-card-trail">' +
      '<summary class="market-card-trail-summary">' +
      esc(T('app.market.showDetails', 'Show listing details')) +
      '</summary>' +
      '<div class="market-card-trail-body">' +
      offerExplainHtml(listing) +
      careLine +
      (listing.settlement === 'adopt_stake' && canInvest
        ? '<p class="market-card-redeem-note">' +
          T(
            'app.market.practiceStakeNote',
            'Practice stake only — physical {redemption} coming later. Locked half is $GROWTOO, not a harvest delivery.',
            { redemption: tip('redemption', T('app.market.redemptionWord', 'redemption')) }
          ) +
          '</p>'
        : '') +
      chainDetailsHtml(
        '<div class="grouped-list">' +
          (listing.batch
            ? groupedRowHtml(
                'batch',
                T('app.market.rowBatch', 'Batch'),
                '<code>' + esc(listing.batch) + '</code>',
                false
              )
            : '') +
          groupedRowHtml(
            'nft',
            'NFT',
            '<a href="' +
              esc(explorerAddress(listing.mintAddress)) +
              '" target="_blank" rel="noopener noreferrer"><code>' +
              esc(shortAddr(listing.mintAddress)) +
              '</code></a>',
            true
          ) +
          (listing.sellerPubkey
            ? groupedRowHtml(
                'nft',
                T('app.market.rowGrower', 'Grower'),
                '<code>' +
                  esc(shortAddr(listing.sellerPubkey)) +
                  '</code>' +
                  (isMine ? ' ' + esc(T('app.market.youSuffix', '(you)')) : '') +
                  (isBuyer ? ' · ' + esc(T('app.market.yourInvestment', 'your investment')) : ''),
                false
              )
            : '') +
          (listing.listingPda
            ? groupedRowHtml(
                'pda',
                T('app.market.rowListingPda', 'Listing PDA'),
                '<code>' + esc(shortAddr(listing.listingPda)) + '</code>',
                false
              )
            : '') +
          '</div>',
        { summary: T('app.market.chainDetails', 'Chain details') }
      ) +
      '</div>' +
      '</details>' +
      '</article>'
    );
  }

  function listingStackHtml(list, uid) {
    const Stacks = window.GrowtooStacks;
    if (!Stacks || typeof Stacks.groupItems !== 'function') {
      return list
        .map(function (l) {
          return listingCardHtml(l, uid);
        })
        .join('');
    }
    const groups = Stacks.groupItems(list, {
      getStrain: function (l) {
        return l.strain;
      },
      getName: function (l) {
        return l.name;
      },
      getStage: function (l) {
        return l.liveStageKey || l.liveStage || l.stage || l.journalStage;
      },
      getSeller: function (l) {
        return l.sellerPubkey || l.uid || '';
      },
      getWeight: function () {
        return 1;
      },
    });
    return groups
      .map(function (g) {
        const membersHtml = g.members
          .map(function (l) {
            return listingCardHtml(l, uid);
          })
          .join('');
        return Stacks.wrapStackHtml(g, membersHtml, {
          surface: 'market',
          photo: Stacks.firstPhoto(g.members, function (l) {
            return l && l.photo;
          }),
        });
      })
      .join('');
  }

  let marketRenderBusy = false;

  function render() {
    if (marketRenderBusy) return;
    const view = document.getElementById('view-market');
    if (!view || !view.classList.contains('active')) return;
    marketRenderBusy = true;
    try {
      const user = currentUser();
      const uid = user ? user.uid : '';
      const notice = document.getElementById('market-notice');
      const listSection = document.getElementById('market-list-section');
      const browseGrid = document.getElementById('market-grid');
      const mineGrid = document.getElementById('market-mine-grid');
      const sel = document.getElementById('market-asset-select');

      if (notice) {
        if (!uid) {
          notice.hidden = false;
          notice.textContent = T('app.market.signInNotice', 'Sign in to use the market.');
        } else if (!cfg().growMint) {
          notice.hidden = false;
          notice.textContent = T(
            'app.market.needsDeploy',
            'Marketplace needs the $GROWTOO mint and seed collection on devnet. Offers below are read-only until then.'
          );
        } else if (isGrowerUi()) {
          notice.hidden = true;
          notice.textContent = '';
        } else {
          notice.hidden = false;
          const intentMarket =
            window.GrowtooProfile && typeof window.GrowtooProfile.adopterIntentCopy === 'function'
              ? window.GrowtooProfile.adopterIntentCopy().market
              : '';
          notice.textContent =
            intentMarket ||
            T(
              'app.market.adopterNotice',
              'Invest $GROWTOO to adopt a grower’s sealed plant. Connect your wallet when you tap Invest on an open offer.'
            );
        }
      }

      renderStuckBanner(listings, uid);

      if (sel) {
        const options = listableTokens();
        const blocked = unlistableGardenTokens();
        const current = sel.value;
        sel.innerHTML =
          '<option value="">' +
          esc(T('app.market.chooseSealed', 'Choose a sealed plant')) +
          '</option>' +
          options
            .map(function (o, i) {
              const no = String(i + 1).padStart(4, '0');
              const label = T('app.market.seedOption', 'Seed № {no} — {name}', {
                no: no,
                name: o.token.name || T('app.stack.plant', 'Plant'),
              });
              return (
                '<option value="' +
                esc(o.mintAddress) +
                '">' +
                esc(label) +
                '</option>'
              );
            })
            .join('') +
          blocked
            .map(function (b) {
              return (
                '<option value="" disabled>' +
                esc(b.token.name) +
                ' — ' +
                esc(b.reason) +
                '</option>'
              );
            })
            .join('');
        if (current && options.some(function (o) { return o.mintAddress === current; })) {
          sel.value = current;
        }
        if (pendingListMint) {
          if (options.some(function (o) { return o.mintAddress === pendingListMint; })) {
            sel.value = pendingListMint;
            const section = document.getElementById('market-list-section');
            if (section && !section.hidden) {
              try {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } catch (_) {
                /* ignore */
              }
              const price = document.getElementById('market-price-input');
              if (price) {
                try {
                  price.focus();
                } catch (_) {
                  /* ignore */
                }
              }
            }
          }
          pendingListMint = '';
        }

        const hasListable = options.length > 0;
        sel.disabled = !hasListable;
        sel.setAttribute('aria-disabled', hasListable ? 'false' : 'true');
        sel.classList.toggle('is-empty-disabled', !hasListable);
        if (!hasListable) {
          sel.innerHTML =
            '<option value="">' +
            esc(T('app.market.noneReady', 'No plant tokens ready to list')) +
            '</option>';
        }

        const hint = document.getElementById('market-list-hint');
        const emptyCta = document.getElementById('market-empty-cta');
        const goTokenise = document.getElementById('market-go-tokenise');
        const formExtras = document.querySelectorAll(
          '#market-list-form .market-offer-compare, #market-list-form .market-offer-helper, #market-list-form .seal-stage-label[for="market-price-input"], #market-list-form .market-price-field, #market-list-form button[type="submit"]'
        );
        if (hint) {
          if (!options.length && blocked.length) {
            hint.hidden = false;
            hint.textContent = T(
              'app.market.hintAlmost',
              'Almost there — finish sealing on Tokenise (use Retry if something failed), then come back here.'
            );
          } else if (!options.length) {
            hint.hidden = false;
            hint.textContent = T(
              'app.market.hintNothingSealed',
              'Nothing sealed to list yet. Seal a stage on Tokenise first — then post it here.'
            );
          } else {
            hint.hidden = true;
            hint.textContent = '';
          }
        }
        if (emptyCta) emptyCta.hidden = !!options.length;
        if (goTokenise) {
          goTokenise.hidden = !!options.length;
          if (!goTokenise.dataset.bound) {
            goTokenise.dataset.bound = '1';
            goTokenise.addEventListener('click', function () {
              if (typeof window.showAppView === 'function') window.showAppView('adopt');
            });
          }
        }
        formExtras.forEach(function (el) {
          if (el) el.hidden = !options.length;
        });
        const assetLabel = document.querySelector('label[for="market-asset-select"]');
        if (assetLabel) assetLabel.hidden = !options.length;
        sel.hidden = !options.length;
      }

      if (listSection) {
        listSection.hidden = !(uid && isGrowerUi());
      }

      const mine = listings.filter(function (l) {
        return l.uid === uid;
      });
      // Adopters see live + settling offers; also show escrow_pending so the
      // board is not empty while the settlement worker confirms NFT escrow.
      // Growers' own posts stay under "My offers" — keep Open market public-only.
      const open = listings.filter(function (l) {
        const live =
          l.status === 'active' ||
          l.status === 'sale_pending' ||
          l.status === 'escrow_pending';
        if (!live) return false;
        if (isGrowerUi() && uid && l.uid === uid) return false;
        return true;
      });

      if (browseGrid) {
        browseGrid.innerHTML = open.length
          ? listingStackHtml(open, uid)
          : isGrowerUi()
            ? emptyNextStepHtml({
                icon: 'market',
                lead: T('app.market.emptyBoardLead', 'No live offers on the board'),
                body: T('app.market.emptyBoardBody', 'Seal a plant on Tokenise, then post it here.'),
                ctaId: 'market-empty-tokenise-btn',
                ctaLabel: T('app.market.ctaSealStage', 'Seal a stage on Tokenise'),
              })
            : emptyNextStepHtml({
                adopter: true,
                icon: 'market',
                lead: T('app.market.emptyOpenLead', 'No open offers right now'),
                body: T(
                  'app.market.emptyOpenBody',
                  'When a grower posts an ask, it shows up here with Invest. Meanwhile, set up your wallet under My garden.'
                ),
                ctaId: 'market-empty-garden-btn',
                ctaLabel: T('app.market.ctaOpenGarden', 'Open My garden'),
                ghost: true,
              });
      }
      if (mineGrid) {
        mineGrid.innerHTML = mine.length
          ? listingStackHtml(mine, uid)
          : emptyNextStepHtml({
              icon: 'market',
              lead: T('app.market.emptyMineLead', 'No offers posted yet'),
              body: listableTokens().length
                ? T('app.market.emptyMineBody', 'Pick a sealed plant above and post your ask.')
                : T(
                    'app.market.emptyMineBodySeal',
                    'Seal a stage on Tokenise first, then list it here.'
                  ),
              ctaId: listableTokens().length
                ? 'market-empty-list-btn'
                : 'market-empty-tokenise-btn',
              ctaLabel: listableTokens().length
                ? T('app.market.ctaPostOffer', 'Post an offer')
                : T('app.market.ctaSealStage', 'Seal a stage on Tokenise'),
            });
      }
      if (window.AdoptPlant && typeof AdoptPlant.renderTestFaucetPanel === 'function') {
        try {
          AdoptPlant.renderTestFaucetPanel();
        } catch {
          // ignore
        }
      }
    } finally {
      marketRenderBusy = false;
    }
  }

  function flash(err) {
    console.error('Market error', err);
    const msg = err && err.message ? err.message : T('app.wallet.generic', 'Something went wrong.');
    if (window.DnevnikNotifications) DnevnikNotifications.toast(msg, 'error');
    else alert(msg);
  }

  function flashOk(msg) {
    const text = msg || T('app.market.done', 'Done.');
    if (window.DnevnikNotifications) {
      DnevnikNotifications.toast(text, 'success');
      return;
    }
    alert(text);
  }

  function askConfirm(opts) {
    if (window.AppConfirm && typeof AppConfirm.ask === 'function') {
      return AppConfirm.ask(opts);
    }
    const fallback =
      ((opts && opts.title) || T('app.confirm.title', 'Confirm')) +
      '\n\n' +
      ((opts && opts.body) || T('app.confirm.body', 'Continue?'));
    return Promise.resolve(window.confirm(fallback));
  }

  /** Delegates to the shared helper so every surface renders the same empty state. */
  function emptyNextStepHtml(opts) {
    opts = opts || {};
    if (window.GrowtooPlain && typeof GrowtooPlain.emptyStateHtml === 'function') {
      return GrowtooPlain.emptyStateHtml(opts);
    }
    return (
      '<div class="empty-state empty-state--next' +
      (opts.adopter ? ' adopt-empty-adopter' : '') +
      '">' +
      '<p class="adopt-empty-lead">' +
      esc(opts.lead || '') +
      '</p>' +
      '<p class="adopt-empty-body">' +
      esc(opts.body || '') +
      '</p>' +
      '<button type="button" class="btn ' +
      (opts.ghost ? 'btn-ghost' : 'btn-primary') +
      '" id="' +
      esc(opts.ctaId || '') +
      '">' +
      esc(opts.ctaLabel || T('app.cryptoMode.continue', 'Continue')) +
      '</button>' +
      '</div>'
    );
  }

  async function notifySellerStake(listing, buyerPubkey) {
    if (!listing || !listing.uid) return;
    const N = window.DnevnikNotifications;
    if (!N || typeof N.pushToUser !== 'function') return;
    const locked =
      listing.settlement === 'adopt_stake'
        ? listing.lockedGrow != null
          ? listing.lockedGrow
          : Math.floor(Number(listing.priceGrow || 0) / 2)
        : 0;
    const plantName = listing.name || T('app.coach.yourPlant', 'your plant');
    const body =
      listing.settlement === 'adopt_stake'
        ? T(
            'app.market.stakeReceivedBody',
            'An adopter staked {amount} $GROWTOO on "{plant}" (50% locked until monthly care).',
            { amount: listing.priceGrow, plant: plantName }
          )
        : T('app.market.investReceivedBody', 'An adopter invested {amount} $GROWTOO in "{plant}".', {
            amount: listing.priceGrow,
            plant: plantName,
          });
    await N.pushToUser(listing.uid, {
      type: 'stake_received',
      title:
        listing.settlement === 'adopt_stake'
          ? T('app.notif.demo.stakeTitle', 'New adopt stake')
          : T('app.market.newInvestment', 'New market investment'),
      body: body,
      meta: {
        listingId: listing.id,
        mintAddress: listing.mintAddress || null,
        priceGrow: listing.priceGrow,
        lockedGrow: locked,
        buyerPubkey: buyerPubkey || null,
        key: 'stake:' + listing.id,
      },
      action: { view: 'market', listingId: listing.id },
    });
  }

  let eventsBound = false;

  function syncMarketOfferHint() {
    const settleEl = document.getElementById('market-settlement-select');
    const hint = document.getElementById('market-stake-hint');
    const cards = document.querySelectorAll('.market-offer-card');
    if (!settleEl) return;
    const stake = settleEl.value === 'adopt_stake';
    cards.forEach(function (card) {
      const on = card.getAttribute('data-offer') === (stake ? 'adopt_stake' : 'instant');
      card.classList.toggle('is-selected', on);
    });
    if (hint) {
      hint.hidden = false;
      hint.setAttribute('data-mode', stake ? 'adopt_stake' : 'instant');
      if (stake) {
        hint.textContent = T(
          'app.market.hintStakeMode',
          'Adopter pays the full asking price now. Half reaches you on settle; half unlocks as you keep logging care through harvest.'
        );
      } else {
        hint.textContent = T(
          'app.market.hintInstantMode',
          'You’re paid the full asking price at purchase. Posting locks the NFT in the on-chain program vault — the offer goes live immediately.'
        );
      }
    }
  }

  function syncSettlementFromRadios() {
    const settleEl = document.getElementById('market-settlement-select');
    const checked = document.querySelector('input[name="market-settlement"]:checked');
    if (settleEl && checked) {
      settleEl.value = checked.value === 'adopt_stake' ? 'adopt_stake' : 'instant';
    }
    syncMarketOfferHint();
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const view = document.getElementById('view-market');
    if (!view) return;

    const settleEl = document.getElementById('market-settlement-select');
    if (settleEl) {
      settleEl.addEventListener('change', syncMarketOfferHint);
    }
    document.querySelectorAll('input[name="market-settlement"]').forEach(function (radio) {
      radio.addEventListener('change', syncSettlementFromRadios);
    });
    syncSettlementFromRadios();

    view.addEventListener('click', async function (e) {
      const tokeniseEmptyBtn = e.target.closest('#market-empty-tokenise-btn');
      if (tokeniseEmptyBtn) {
        if (typeof window.showAppView === 'function') window.showAppView('adopt');
        else {
          const nav = document.querySelector('.nav-item[data-view="adopt"]');
          if (nav) nav.click();
        }
        requestAnimationFrame(function () {
          const seal = document.getElementById('adopt-seed-section');
          if (seal) seal.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
      }
      const listEmptyBtn = e.target.closest('#market-empty-list-btn');
      if (listEmptyBtn) {
        const section = document.getElementById('market-list-section');
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const sel = document.getElementById('market-asset-select');
        if (sel && !sel.disabled) {
          try {
            sel.focus();
          } catch (_) {
            /* ignore */
          }
        }
        return;
      }
      const gardenEmptyBtn = e.target.closest('#market-empty-garden-btn');
      if (gardenEmptyBtn) {
        const adoptNav = document.querySelector('.nav-item[data-view="adopt"]');
        if (adoptNav) adoptNav.click();
        return;
      }

      const faucetBtn = e.target.closest('#test-faucet-claim-btn');
      if (faucetBtn) {
        if (busy || faucetBtn.disabled) return;
        if (typeof claimTestFaucet !== 'function') return;
        busy = true;
        const prev = faucetBtn.textContent;
        faucetBtn.textContent = T('app.market.claiming', 'Claiming…');
        faucetBtn.disabled = true;
        try {
          const result = await claimTestFaucet();
          flashOk(
            T(
              'app.market.faucetQueued',
              'Test faucet queued: +{amount} $GROWTOO. Mint usually lands within a few minutes.',
              { amount: result && result.amount ? result.amount : TEST_FAUCET_AMOUNT }
            )
          );
          if (window.DnevnikNotifications) {
            DnevnikNotifications.push({
              type: 'test_faucet',
              title: T('app.notif.faucetClaimed', 'Test $GROWTOO claimed'),
              body: T(
                'app.market.faucetQueueBody',
                'Queue is minting $GROWTOO to your Devnet wallet…'
              ),
              meta: { key: 'faucet-pending:' + (result && result.dayKey ? result.dayKey : '') },
              action: { view: 'market' },
              kind: 'info',
              dedupKey: 'faucet-pending:' + (result && result.dayKey ? result.dayKey : ''),
              toast: false,
            });
          }
          if (window.AdoptPlant && typeof AdoptPlant.renderTestFaucetPanel === 'function') {
            AdoptPlant.renderTestFaucetPanel();
          }
        } catch (err) {
          flash(err);
          faucetBtn.textContent = prev;
        } finally {
          busy = false;
          faucetBtn.disabled = false;
        }
        return;
      }

      const investBtn = e.target.closest('.market-invest-btn');
      const cancelBtn = e.target.closest('.market-cancel-btn');
      const harvestBtn = e.target.closest('.market-harvest-claim-btn');
      if (!investBtn && !cancelBtn && !harvestBtn) return;
      if (busy) return;
      const id = (investBtn || cancelBtn || harvestBtn).dataset.id;
      const listing = listings.find(function (l) {
        return l.id === id;
      });
      if (!listing) return;

      let confirmed = true;
      if (investBtn) {
        let body = '';
        if (listing.settlement === 'program') {
          body = T(
            'app.market.confirmInvestProgram',
            'You will receive the plant token in this transaction on Solana Devnet.'
          );
        } else if (listing.settlement === 'adopt_stake') {
          body = T(
            'app.market.confirmInvestStake',
            'Adopt stake: full price now. 50% to the grower on settle; 50% locked until monthly care at harvest (all-or-nothing). Token arrives when settlement completes.\n\nPhysical harvest redemption is coming later — no delivery on Devnet.'
          );
        } else {
          body = T(
            'app.market.confirmInvestLegacy',
            'You will receive the plant token when settlement completes.\n\nPhysical harvest redemption is coming later — not available on this test network.'
          );
        }
        confirmed = await askConfirm({
          title: T('app.market.confirmInvestTitle', 'Invest {amount} $GROWTOO in “{plant}”?', {
            amount: window.I18N ? I18N.n(Number(listing.priceGrow)) : listing.priceGrow,
            plant: listing.name,
          }),
          body: body,
          confirmLabel: T('app.market.confirmInvestCta', 'Invest'),
        });
      } else if (harvestBtn) {
        confirmed = await askConfirm({
          title: T('app.market.confirmClaimTitle', 'Claim locked stake ($GROWTOO)?'),
          body: T(
            'app.market.confirmClaimBody',
            'If every monthly care month qualifies (≥12 care days each), the locked 50% releases to you. Otherwise it refunds to the adopter (all-or-nothing).\n\nThis is not physical harvest redemption — that is coming later.'
          ),
          confirmLabel: T('app.market.confirmClaimCta', 'Claim locked stake'),
        });
      } else if (cancelBtn) {
        confirmed = await askConfirm({
          title: T('app.market.confirmCancelTitle', 'Cancel this offer?'),
          body: T(
            'app.market.confirmCancelBody',
            'The plant token returns to your wallet. Adopters will no longer see this ask.'
          ),
          confirmLabel: T('app.market.confirmCancelCta', 'Cancel offer'),
          danger: true,
        });
      }
      if (!confirmed) return;

      busy = true;
      const btn = investBtn || cancelBtn || harvestBtn;
      const prevText = btn.textContent;
      btn.textContent = investBtn
        ? T('app.market.investing', 'Investing…')
        : harvestBtn
          ? T('app.market.claiming', 'Claiming…')
          : T('app.market.cancelling', 'Cancelling…');
      btn.disabled = true;
      try {
        if (investBtn) {
          await investInListing(listing);
          if (window.AdoptPlant && typeof window.AdoptPlant.render === 'function') {
            try {
              window.AdoptPlant.render();
            } catch {
              // ignore
            }
          }
          if (listing.settlement === 'program') {
            flashOk(
              T('app.market.investOkNow', 'Investment complete. The plant token is in your wallet.')
            );
          } else {
            flashOk(
              T(
                'app.market.investOkQueued',
                'Investment submitted. The plant appears in My garden when settlement finishes.'
              )
            );
          }
        } else if (harvestBtn) {
          await requestHarvestClaim(listing.id, harvestBtn.dataset.plantId || listing.plantId);
          flashOk(
            T(
              'app.market.claimQueuedOk',
              'Harvest claim queued. Locked stake settles after the next adopt queue pass.'
            )
          );
        } else {
          await cancelListing(listing);
          flashOk(
            listing.settlement === 'program'
              ? T('app.market.cancelOkNow', 'Offer cancelled. The plant is back in your wallet.')
              : T(
                  'app.market.cancelOkQueued',
                  'Cancel requested. The plant returns after settlement.'
                )
          );
        }
      } catch (err) {
        flash(err);
      } finally {
        btn.textContent = prevText;
        btn.disabled = false;
        busy = false;
      }
    });

    const form = document.getElementById('market-list-form');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (busy) return;
        const sel = document.getElementById('market-asset-select');
        const priceEl = document.getElementById('market-price-input');
        const settleEl = document.getElementById('market-settlement-select');
        const mintAddress = sel ? sel.value : '';
        const price = priceEl ? parseInt(priceEl.value, 10) : 0;
        const settlement =
          settleEl && settleEl.value === 'adopt_stake' ? 'adopt_stake' : 'instant';
        if (!mintAddress) {
          return flash(new Error(T('app.market.needToken', 'Choose a plant token to post.')));
        }
        if (!price || price <= 0) {
          return flash(new Error(T('app.market.needPrice', 'Enter an invest price in $GROWTOO.')));
        }
        const entry = listableTokens().find(function (o) {
          return o.mintAddress === mintAddress;
        });
        if (!entry) {
      return flash(new Error(T('app.market.assetGone', 'Asset not found or already listed.')));
    }

        const submitBtn = form.querySelector('button[type="submit"]');
        busy = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = T('app.market.holdingToken', 'Holding token for listing…');
        }
        try {
          const used = await createListing(entry, price, {
            settlement: settlement === 'adopt_stake' ? 'adopt_stake' : undefined,
          });
          form.reset();
          syncSettlementFromRadios();
          if (window.DailyStatus && typeof DailyStatus.markGrowerListed === 'function') {
            try {
              DailyStatus.markGrowerListed();
            } catch (_) {
              /* ignore */
            }
          }
          flashOk(
            used === 'adopt_stake'
              ? T(
                  'app.market.postedStake',
                  'Adopt-stake offer posted. 50% unlocks on settle; 50% locked until monthly harvest care.'
                )
              : used === 'program'
                ? T(
                    'app.market.postedProgram',
                    'Offer is live. The plant is locked in the program vault — adopters can invest now.'
                  )
                : T(
                    'app.market.postedLegacy',
                    'Offer posted. Adopters can invest once escrow confirms.'
                  )
          );
        } catch (err) {
          flash(err);
        } finally {
          busy = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = T('app.market.postToMarket', 'Post to market');
          }
        }
      });
    }
  }

  function currentMonthKey(d) {
    const date = d || new Date();
    return (
      date.getUTCFullYear() +
      '-' +
      String(date.getUTCMonth() + 1).padStart(2, '0')
    );
  }

  function currentDayKey(d) {
    const date = d || new Date();
    return (
      date.getUTCFullYear() +
      '-' +
      String(date.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getUTCDate()).padStart(2, '0')
    );
  }

  const TEST_FAUCET_AMOUNT = 100;

  function platformBonusStatus() {
    const user = currentUser();
    if (!user) return null;
    const monthKey = currentMonthKey();
    return (
      platformRewards.find(function (r) {
        return (
          r.uid === user.uid &&
          r.monthKey === monthKey &&
          r.source !== 'adopter_faucet'
        );
      }) || null
    );
  }

  function testFaucetStatus() {
    const user = currentUser();
    if (!user) return null;
    const dayKey = currentDayKey();
    return (
      platformRewards.find(function (r) {
        return (
          r.uid === user.uid &&
          r.source === 'adopter_faucet' &&
          (r.dayKey === dayKey || String(r.id || '').indexOf('_faucet_' + dayKey) >= 0)
        );
      }) || null
    );
  }

  function findAdoptStakeForMint(mintAddress) {
    if (!mintAddress) return null;
    return (
      listings.find(function (l) {
        return (
          l &&
          l.settlement === 'adopt_stake' &&
          l.mintAddress === mintAddress &&
          (l.status === 'sold' || l.careStatus === 'active' || l.careStatus === 'released' || l.careStatus === 'refunded')
        );
      }) || null
    );
  }

  async function requestHarvestClaim(listingId, plantId) {
    const user = currentUser();
    if (!user) throw new Error(T('app.market.signInHarvest', 'Sign in to claim harvest.'));
    if (!isGrowerUi()) {
      throw new Error(T('app.market.growerOnlyHarvest', 'Only growers can claim harvest stakes.'));
    }
    const listing = listings.find(function (l) {
      return l.id === listingId;
    });
    if (!listing) throw new Error(T('app.market.listingNotFound', 'Listing not found.'));
    if (listing.uid !== user.uid) throw new Error(T('app.market.notYourListing', 'Not your listing.'));
    if (listing.settlement !== 'adopt_stake') {
      throw new Error(T('app.market.notStakeListing', 'Not an adopt-stake listing.'));
    }
    if (listing.careStatus !== 'active') {
      throw new Error(T('app.market.careNotActive', 'Care stake is not active.'));
    }

    const ref = firebase.firestore().collection('harvestClaims').doc(listingId);
    const existing = await ref.get();
    if (existing.exists) {
      const st = (existing.data() || {}).status;
      if (st === 'pending') {
        throw new Error(
          T('app.market.claimAlreadyPending', 'A harvest claim is already pending for this stake.')
        );
      }
      if (st === 'released' || st === 'refunded') {
        throw new Error(
          T('app.market.claimAlreadySettled', 'Harvest stake already settled for this listing.')
        );
      }
    }

    await ref.set({
      uid: user.uid,
      listingId: listingId,
      plantId: plantId || listing.plantId || null,
      mintAddress: listing.mintAddress || null,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      cluster: 'devnet',
    });
    markOptimisticHarvestClaim(listingId);
    emit();
  }

  async function claimPlatformBonus() {
    const user = currentUser();
    if (!user) throw new Error(T('app.market.signInBonus', 'Sign in to claim the platform bonus.'));
    if (!isGrowerUi()) {
      throw new Error(T('app.market.growerOnlyBonus', 'Only growers can claim the platform bonus.'));
    }
    // UI already prompts connect; never open the wallet picker from Claim.
    const SW = await ensureSigningWallet(T('app.market.purposeBonus', 'claim platform monthly bonus'), {
      autoConnect: false,
    });
    const monthKey = currentMonthKey();
    const docId = user.uid + '_' + monthKey;
    const ref = firebase.firestore().collection('platformRewards').doc(docId);
    const priorSnap = await ref.get();
    if (priorSnap.exists) {
      const st = (priorSnap.data() || {}).status;
      if (st === 'pending' || st === 'minted') {
        throw new Error(
        T('app.market.bonusAlready', 'You already claimed (or have a pending claim) for {month}.', {
          month: monthKey,
        })
      );
      }
    }
    await ref.set({
      uid: user.uid,
      monthKey: monthKey,
      recipient: SW.getPublicKey(),
      status: 'pending',
      source: 'platform',
      requestedAt: new Date().toISOString(),
      cluster: 'devnet',
    });
  }

  /** Adopter Devnet faucet: +100 $GROWTOO once per UTC day. */
  async function claimTestFaucet() {
    const user = currentUser();
    if (!user) throw new Error(T('app.market.signInFaucet', 'Sign in to claim test $GROWTOO.'));
    if (!isAdopterUi()) {
      throw new Error(
        T('app.market.adopterOnlyFaucet', 'Switch to an adopter account to use the test faucet.')
      );
    }
    const SW = await ensureSigningWallet(
      T('app.market.purposeFaucet', 'claim test $GROWTOO faucet')
    );
    const dayKey = currentDayKey();
    const monthKey = currentMonthKey();
    const docId = user.uid + '_faucet_' + dayKey;
    const ref = firebase.firestore().collection('platformRewards').doc(docId);
    const priorSnap = await ref.get();
    if (priorSnap.exists) {
      const st = (priorSnap.data() || {}).status;
      if (st === 'pending' || st === 'minted') {
        throw new Error(
          T(
            'app.market.faucetAlready',
            'You already claimed today’s Devnet faucet ({day}). Try again after UTC midnight.',
            { day: dayKey }
          )
        );
      }
      // failed → allow rewrite to pending
      await ref.set({
        uid: user.uid,
        monthKey: monthKey,
        dayKey: dayKey,
        recipient: SW.getPublicKey(),
        status: 'pending',
        source: 'adopter_faucet',
        amount: TEST_FAUCET_AMOUNT,
        requestedAt: new Date().toISOString(),
        cluster: 'devnet',
      });
      return { amount: TEST_FAUCET_AMOUNT, dayKey: dayKey };
    }
    await ref.set({
      uid: user.uid,
      monthKey: monthKey,
      dayKey: dayKey,
      recipient: SW.getPublicKey(),
      status: 'pending',
      source: 'adopter_faucet',
      amount: TEST_FAUCET_AMOUNT,
      requestedAt: new Date().toISOString(),
      cluster: 'devnet',
    });
    return { amount: TEST_FAUCET_AMOUNT, dayKey: dayKey };
  }

  window.Market = {
    render() {
      bindEvents();
      syncMarketOfferHint();
      startWatch();
      syncMyInvestments();
      render();
    },
    listableMintForToken: listableMintForToken,
    openListForMint: openListForMint,
    onChange(fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    },
    getListings() {
      return listings.slice();
    },
    findAdoptStakeForMint: findAdoptStakeForMint,
    getHarvestClaim: getHarvestClaim,
    requestHarvestClaim: requestHarvestClaim,
    claimPlatformBonus: claimPlatformBonus,
    claimTestFaucet: claimTestFaucet,
    currentMonthKey: currentMonthKey,
    currentDayKey: currentDayKey,
    platformBonusStatus: platformBonusStatus,
    testFaucetStatus: testFaucetStatus,
    testFaucetAmount: TEST_FAUCET_AMOUNT,
  };

  if (firebaseReady()) {
    firebase.auth().onAuthStateChanged(function (user) {
      startWatch();
      // Repair any payment whose signature never reached Firestore, before the
      // 15 minute reservation TTL reopens the listing and erases the link.
      if (user) {
        recoverPendingPayments().catch(function (err) {
          console.warn('Payment recovery pass failed', err);
        });
      }
    });
  }
})();
