/*
 * Marketplace (devnet): growers post real RWA NFTs; adopters invest with $GROWTOO.
 *
 * Listings live in Firestore (`marketListings`); on-chain legs:
 *   - grower escrows the NFT to the authority wallet (signed in-app),
 *   - adopter pays the grower in $GROWTOO (signed in-app),
 *   - chain/process-market.js verifies both and releases the NFT to the adopter.
 */
(function () {
  'use strict';

  const listeners = new Set();
  let listings = [];
  let platformRewards = [];
  let unsubscribe = null;
  let platformUnsub = null;
  let watchedUid = '';
  let busy = false;
  let reconcileTimer = null;
  let lastReconcileAt = 0;

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

  function startWatch() {
    const user = currentUser();
    const uid = user ? user.uid : '';
    if (uid === watchedUid && unsubscribe) return;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    watchedUid = uid;
    listings = [];
    if (!uid || !firebaseReady()) {
      startPlatformWatch('');
      emit();
      return;
    }
    startPlatformWatch(uid);
    unsubscribe = firebase
      .firestore()
      .collection('marketListings')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .onSnapshot(
        function (snap) {
          const next = [];
          snap.forEach(function (doc) {
            next.push(Object.assign({ id: doc.id }, doc.data()));
          });
          listings = next;
          syncMyInvestments();
          emit();
          maybeRequestEscrowReconcile(next);
          maybeRequestMarketSettle(next);
        },
        function (err) {
          console.warn('marketListings watch failed', err);
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
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'app-market', count: pending.length }),
      })
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
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'app-market', count: pending.length }),
      })
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

  const STUCK_STATUS_LABELS = {
    escrow_pending: 'Activating escrow…',
    sale_pending: 'Investment settling…',
    cancel_requested: 'Cancelling…',
  };

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
        esc(l.name || 'Offer') +
        '</strong> — ' +
        esc(STUCK_STATUS_LABELS[l.status] || l.status) +
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
      '<strong>Settlement pending</strong>' +
      '<p>Cloud workers auto-activate escrow and settle buys/cancels about every 5 minutes. Retry now nudges both.</p>' +
      '<ul>' +
      parts.join('') +
      '</ul>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="market-stuck-retry">Retry now</button>' +
      '</div>';
  }

  function forceReconcileNow(count) {
    const reconcileUrl = cfg().marketReconcileUrl;
    const settleUrl = cfg().marketSettleUrl;
    const btn = document.getElementById('market-stuck-retry');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Retrying…';
    }
    lastReconcileAt = 0;
    lastSettleAt = 0;

    function ping(url, body) {
      if (!url) return Promise.resolve({ ok: false });
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return { ok: res.ok };
          });
        })
        .catch(function () {
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
        btn.textContent = 'Retry now';
      }
      if (esc.activated > 0) {
        flashOk('Activated ' + esc.activated + ' listing(s). Refresh if status lags.');
        return;
      }
      if (settle.sold > 0 || settle.cancelled > 0) {
        flashOk(
          'Settled ' +
            (settle.sold || 0) +
            ' sale(s) and ' +
            (settle.cancelled || 0) +
            ' cancel(s). Refresh if status lags.'
        );
        return;
      }
      flashOk(
        'Retry sent to escrow + settle workers. Status should update within a minute if the chain confirms.'
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
        let reason = 'Mint not confirmed on Devnet yet';
        if (mint && mint.status === 'failed') reason = 'Mint failed — Retry mint on Tokenise';
        else if (mint && mint.status === 'pending') reason = 'Mint still pending in queue';
        else if (mintAddress && listed.has(mintAddress)) reason = 'Already listed';
        else if (!mint && !mintAddress) reason = 'No Devnet mint yet — open Tokenise';
        return { token: token, reason: reason };
      })
      .filter(Boolean);
  }

  async function assertWalletHoldsListingNft(mintAddress, mintOwnerHint) {
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
        'This NFT is already locked in the on-chain market vault. Cancel that listing first, then post again.'
      );
    }
    if (escrowHeld >= 1n) {
      throw new Error(
        'This NFT is already in the hot-wallet escrow. Refresh Market — it may still be activating.'
      );
    }

    const ownerHint =
      mintOwnerHint && connected && mintOwnerHint !== connected
        ? ' On-chain owner is ' +
          mintOwnerHint.slice(0, 4) +
          '…' +
          mintOwnerHint.slice(-4) +
          ', but you connected ' +
          connected.slice(0, 4) +
          '…' +
          connected.slice(-4) +
          '.'
        : '';

    throw new Error(
      'This connected wallet does not hold that NFT.' +
        ownerHint +
        ' Open Tokenise, confirm “Minted on devnet”, connect the wallet that received the mint (or Retry mint), then try posting again.'
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
  async function ensureSigningWallet(purpose) {
    const why = purpose || 'sign';
    const SW = window.SolanaWallet;
    if (!SW) throw new Error('Solana wallet module failed to load. Refresh and try again.');

    function assertSigningSession() {
      if (!SW.isConnected() || !SW.getPublicKey()) {
        throw new Error(
          'Reconnect your wallet extension to ' + why + '. The account is linked, but Phantom/Solflare is not signed in for this tab.'
        );
      }
      const provider = SW.getProviderName();
      if (provider === 'watch-only' || provider === 'manual') {
        throw new Error(
          'Watch-only wallets cannot ' + why + '. Connect Phantom or Solflare.'
        );
      }
      return SW;
    }

    if (SW.isConnected() && SW.getPublicKey()) {
      return assertSigningSession();
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
    if (!user) throw new Error('Sign in to post a plant offer.');
    if (!isGrowerUi()) throw new Error('Only grower accounts can post plant offers.');

    const SW = await ensureSigningWallet('post an offer (hold the plant token)');
    const token = tokenEntry.token;
    const priceRounded = Math.round(priceGrow);
    const stakeMode = opts && opts.settlement === 'adopt_stake';
    const useProgram = !stakeMode && cfg().settlementMode === 'program' && cfg().escrowProgramId;
    const lockedGrow = stakeMode ? Math.floor(priceRounded / 2) : 0;
    const immediateGrow = stakeMode ? priceRounded - lockedGrow : priceRounded;
    const careEscrow = cfg().careEscrowAddress || cfg().escrowAddress;

    if (useProgram) {
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
        ...(function () {
          const story = storySnapshotForPlant(token.plantId);
          if (!story) return {};
          return {
            photo: story.photo || null,
            journalSnippets: story.journalSnippets || [],
            journalStage: story.journalStage || null,
          };
        })(),
      });
    } else {
      const escrow = cfg().escrowAddress;
      if (!escrow) throw new Error('Escrow address is not configured.');
      if (!window.SplTransfer) throw new Error('Token transfer helper is not loaded.');
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
            'This connected wallet does not hold that NFT. Confirm mint on Tokenise, then connect the owning wallet.'
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
      if (story) {
        listing.photo = story.photo || null;
        listing.journalSnippets = story.journalSnippets || [];
        listing.journalStage = story.journalStage || null;
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
  }

  async function investInListing(listing) {
    const user = currentUser();
    if (!user) throw new Error('Sign in to invest.');
    if (!isAdopterUi()) throw new Error('Switch to an adopter account to invest in plant offers.');

    const SW = await ensureSigningWallet('invest ($GROWTOO payment)');
    const ref = firebase.firestore().collection('marketListings').doc(listing.id);

    if (listing.settlement === 'program') {
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
          title: 'Investment complete',
          body: 'You adopted "' + (listing.name || 'plant') + '" for ' + listing.priceGrow + ' $GROWTOO.',
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
      if (!snap.exists) throw new Error('Offer no longer exists.');
      const data = snap.data() || {};
      if (data.status !== 'active') {
        throw new Error('This offer is no longer open for investment.');
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
      if (!payTo) throw new Error('Payment destination is not configured.');
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
      } else {
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

    await ref.update({
      paymentSignature: paymentSignature,
      investedAt: new Date().toISOString(),
    });

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
        title: 'Investment submitted',
        body:
          'Paid ' +
          listing.priceGrow +
          ' $GROWTOO for "' +
          (listing.name || 'plant') +
          '". NFT settles via queue.',
        meta: { key: 'buy-pending:' + listing.id, listingId: listing.id },
        action: { view: 'adopt' },
        kind: 'success',
        dedupKey: 'buy-pending:' + listing.id,
      });
    }
  }

  async function cancelListing(listing) {
    const ref = firebase.firestore().collection('marketListings').doc(listing.id);
    if (listing.settlement === 'program') {
      await ensureSigningWallet('cancel offer (reclaim NFT)');
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

  const STATUS_LABELS = {
    escrow_pending: 'Preparing listing…',
    active: 'Open for investment',
    sale_pending: 'Investment settling…',
    cancel_requested: 'Cancelling…',
    sold: 'Adopted',
    cancelled: 'Cancelled',
    failed: 'Failed',
  };

  function statusBadge(status) {
    return (
      '<span class="market-status market-status--' +
      esc(status) +
      '">' +
      esc(STATUS_LABELS[status] || status) +
      '</span>'
    );
  }

  function assetBadge(assetType) {
    const label = assetType === 'flower' ? 'Flower token' : 'Seed token';
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
        '<span class="market-asset-badge market-asset-badge--stake" title="You pay full price now. Half to grower on settle; half locked until harvest care.">' +
        'Adopt stake</span>'
      );
    }
    return (
      '<span class="market-asset-badge market-asset-badge--instant" title="Full price to grower; plant token transfers on buy.">' +
      'Instant sale</span>'
    );
  }

  function tip(term, label) {
    if (window.GrowtooPlain && typeof GrowtooPlain.tipHtml === 'function') {
      return GrowtooPlain.tipHtml(term, label);
    }
    return esc(label || term);
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
        'Pay <strong>' +
        esc(String(listing.priceGrow)) +
        '</strong> now · ' +
        '<strong>' +
        esc(String(immediate)) +
        '</strong> to grower on ' +
        tip('settle', 'settle') +
        ' · ' +
        '<strong>' +
        esc(String(locked)) +
        '</strong> locked until harvest care. Token after settlement.' +
        '</p>'
      );
    }
    return (
      '<p class="market-card-explain market-card-explain--instant">' +
      'Pay <strong>' +
      esc(String(listing.priceGrow)) +
      ' $GROWTOO</strong> and receive the plant token in this flow.' +
      '</p>'
    );
  }

  function storyArtHtml(listing) {
    let stageIndex = 0;
    if (window.PlantToken && typeof PlantToken.stageIndexFromLabel === 'function') {
      stageIndex = PlantToken.stageIndexFromLabel(
        listing.stage || listing.journalStage || listing.assetType || ''
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
    const stage = listing.stage || listing.journalStage || '';
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
      : '<p class="market-card-journal-empty">Journal trail linked — open after adopt to follow care logs.</p>';
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

  function listingHarvestReady(listing) {
    if (!listing) return false;
    const snap = listing.plantId ? storySnapshotForPlant(listing.plantId) : null;
    const stage = String(
      (snap && snap.journalStage) || listing.journalStage || listing.stage || ''
    ).toLowerCase();
    return stage.indexOf('harvest') >= 0;
  }

  function listingCardHtml(listing, uid) {
    listing = enrichListingStory(listing);
    const isMine = listing.uid === uid;
    const isBuyer = listing.buyerUid === uid;
    const canInvest = isAdopterUi() && !isMine && listing.status === 'active';
    const canCancel = isGrowerUi() && isMine && listing.status === 'active';
    const canHarvestClaim =
      isGrowerUi() &&
      isMine &&
      listing.settlement === 'adopt_stake' &&
      listing.status === 'sold' &&
      listing.careStatus === 'active';
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
        '<p class="market-card-meta">Care ' +
        tip('escrow', 'escrow') +
        ': <strong>' +
        esc(listing.careStatus) +
        '</strong>' +
        locked +
        progress +
        '</p>';
    }
    let phaseRail = '';
    if (window.StatusRail) {
      if (isBuyer || listing.status === 'sale_pending' || listing.status === 'sold') {
        phaseRail = StatusRail.investPipeline(listing) || '';
      }
      if (!phaseRail && (isMine || listing.status === 'escrow_pending' || listing.status === 'cancel_requested' || listing.status === 'failed' || listing.status === 'active' || listing.status === 'cancelled')) {
        // Grower-facing listing lifecycle (and open offers get a quiet Live rail).
        if (
          isMine ||
          listing.status === 'escrow_pending' ||
          listing.status === 'cancel_requested' ||
          listing.status === 'failed' ||
          listing.status === 'cancelled' ||
          (listing.status === 'active' && isGrowerUi())
        ) {
          phaseRail = StatusRail.listingPipeline(listing) || '';
        }
      }
    }
    const priceLabel =
      listing.status === 'sold' || listing.status === 'sale_pending'
        ? 'Stake / sale'
        : listing.status === 'cancelled'
          ? 'Was listed at'
          : 'Ask price';
    const investLabel =
      listing.settlement === 'adopt_stake' ? 'Adopt · stake' : 'Adopt · buy';
    const showStory = isAdopterUi() || listing.status === 'active';
    return (
      '<article class="market-card' +
      (isDead ? ' market-card--dead' : '') +
      (isAdopterUi() ? ' market-card--adopter' : '') +
      '" data-id="' +
      esc(listing.id) +
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
      (showStrain && listing.batch ? ' · ' : '') +
      (listing.batch ? 'batch ' + esc(listing.batch) : '') +
      ((showStrain || listing.batch) && listing.stage ? ' · ' : '') +
      (listing.stage ? esc(listing.stage) : '') +
      '</p>' +
      phaseRail +
      offerExplainHtml(listing) +
      careLine +
      (listing.settlement === 'adopt_stake' && canInvest
        ? '<p class="market-card-redeem-note">Physical ' +
          tip('redemption', 'redemption') +
          ' is still mocked on Devnet — you are practicing the stake flow only.</p>'
        : '') +
      '<p class="market-card-meta crypto-advanced-only">NFT: <a href="' +
      esc(explorerAddress(listing.mintAddress)) +
      '" target="_blank" rel="noopener noreferrer"><code>' +
      esc(shortAddr(listing.mintAddress)) +
      '</code></a>' +
      ' · grower <code>' +
      esc(shortAddr(listing.sellerPubkey)) +
      '</code>' +
      (isMine ? ' (you)' : '') +
      (isBuyer ? ' · your investment' : '') +
      '</p>' +
      '<div class="market-card-foot">' +
      '<span class="market-price"><span class="market-price-label">' +
      esc(priceLabel) +
      '</span>' +
      Number(listing.priceGrow).toLocaleString('en-US') +
      ' $GROWTOO</span>' +
      (canInvest
        ? '<button type="button" class="btn btn-primary btn-sm market-invest-btn" data-id="' +
          esc(listing.id) +
          '">' +
          esc(investLabel) +
          '</button>'
        : '') +
      (canCancel
        ? '<button type="button" class="btn btn-ghost btn-sm market-cancel-btn" data-id="' +
          esc(listing.id) +
          '">Cancel</button>'
        : '') +
      (canHarvestClaim && harvestReady
        ? '<button type="button" class="btn btn-primary btn-sm market-harvest-claim-btn" data-id="' +
          esc(listing.id) +
          '" data-plant-id="' +
          esc(listing.plantId || '') +
          '">Claim harvest stake</button>'
        : '') +
      '</div>' +
      (canHarvestClaim && !harvestReady
        ? '<p class="market-card-meta">Reach harvest stage in the journal to claim the locked half.</p>'
        : '') +
      (listing.status === 'failed' && listing.error && isMine
        ? '<p class="market-card-error">' + esc(listing.error) + '</p>'
        : '') +
      '</article>'
    );
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
          notice.textContent = 'Sign in to use the market.';
        } else if (!cfg().growMint) {
          notice.hidden = false;
          notice.textContent =
            'Marketplace needs the $GROWTOO mint and seed collection on devnet. Offers below are read-only until then.';
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
            'Invest $GROWTOO to adopt a grower’s sealed plant. Connect your wallet when you tap Invest on an open offer.';
        }
      }

      renderStuckBanner(listings, uid);

      if (sel) {
        const options = listableTokens();
        const blocked = unlistableGardenTokens();
        const current = sel.value;
        sel.innerHTML =
          '<option value="">Choose a sealed plant</option>' +
          options
            .map(function (o, i) {
              const no = String(i + 1).padStart(4, '0');
              const label =
                'Seed № ' +
                no +
                ' — ' +
                (o.token.name || 'Plant');
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

        const hasListable = options.length > 0;
        sel.disabled = !hasListable;
        sel.setAttribute('aria-disabled', hasListable ? 'false' : 'true');
        sel.classList.toggle('is-empty-disabled', !hasListable);
        if (!hasListable) {
          sel.innerHTML = '<option value="">No plant tokens ready to list</option>';
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
            hint.textContent =
              'Almost there — finish sealing on Tokenise (use Retry if something failed), then come back here.';
          } else if (!options.length) {
            hint.hidden = false;
            hint.textContent =
              'Nothing sealed to list yet. Seal a stage on Tokenise first — then post it here.';
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
          ? open.map(function (l) {
              return listingCardHtml(l, uid);
            }).join('')
          : isGrowerUi()
            ? '<div class="empty-state">No live offers yet. Mint a plant token in Tokenise, then post it here.</div>'
            : '<div class="empty-state adopt-empty-adopter">' +
              '<p class="adopt-empty-lead">No open offers right now</p>' +
              '<p class="adopt-empty-body">Growers are still seeding the board on the test network. When an ask goes live, it shows up here with Invest.</p>' +
              '<ul class="adopt-empty-steps adopt-empty-steps--bullets">' +
              '<li>Check back after growers mint and post plants</li>' +
              '<li>Meanwhile, connect your test-network wallet under My garden</li>' +
              '<li>Read Risks &amp; FAQ on the marketing site if you are new to the flow</li>' +
              '</ul>' +
              '<button type="button" class="btn btn-ghost" id="market-empty-garden-btn">Back to My garden</button>' +
              '</div>';
      }
      if (mineGrid) {
        mineGrid.innerHTML = mine.length
          ? mine.map(function (l) {
              return listingCardHtml(l, uid);
            }).join('')
          : '<div class="empty-state">You have not posted any plant offers yet.</div>';
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
    const msg = err && err.message ? err.message : 'Something went wrong.';
    if (window.DnevnikNotifications) DnevnikNotifications.toast(msg, 'error');
    else alert(msg);
  }

  function flashOk(msg) {
    const text = msg || 'Done.';
    if (window.DnevnikNotifications) {
      DnevnikNotifications.toast(text, 'success');
      return;
    }
    alert(text);
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
    const body =
      listing.settlement === 'adopt_stake'
        ? 'An adopter staked ' +
          listing.priceGrow +
          ' $GROWTOO on "' +
          (listing.name || 'your plant') +
          '" (50% locked until monthly care).'
        : 'An adopter invested ' +
          listing.priceGrow +
          ' $GROWTOO in "' +
          (listing.name || 'your plant') +
          '".';
    await N.pushToUser(listing.uid, {
      type: 'stake_received',
      title: listing.settlement === 'adopt_stake' ? 'New adopt stake' : 'New market investment',
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
        hint.textContent =
          'Adopter pays the full asking price now. Half reaches you on settle; half unlocks as you keep logging care through harvest.';
      } else {
        hint.textContent =
          'You’re paid the full asking price at purchase. Escrow holds the token until then.';
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
        faucetBtn.textContent = 'Claiming…';
        faucetBtn.disabled = true;
        try {
          const result = await claimTestFaucet();
          flashOk(
            'Test faucet queued: +' +
              (result && result.amount ? result.amount : TEST_FAUCET_AMOUNT) +
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
      busy = true;
      const btn = investBtn || cancelBtn || harvestBtn;
      const prevText = btn.textContent;
      btn.textContent = investBtn
        ? 'Investing…'
        : harvestBtn
          ? 'Claiming…'
          : 'Cancelling…';
      btn.disabled = true;
      try {
        if (investBtn) {
          var confirmMsg =
            'Invest ' +
            listing.priceGrow +
            ' $GROWTOO to adopt "' +
            listing.name +
            '" on Solana Devnet?\n\n';
          if (listing.settlement === 'program') {
            confirmMsg += 'You will receive the plant token in this transaction.';
          } else if (listing.settlement === 'adopt_stake') {
            confirmMsg +=
              'Adopt stake: you pay the full price now. 50% goes to the grower when it settles; 50% stays locked until monthly care criteria at harvest (all-or-nothing). You receive the plant token when settlement completes.\n\n' +
              'Important: physical harvest redemption is still mocked on Devnet — no real delivery. This is a test-network practice flow only.';
          } else {
            confirmMsg +=
              'You will receive the plant token when settlement completes.\n\n' +
              'Note: physical harvest redemption is still mocked on Devnet.';
          }
          if (!confirm(confirmMsg)) {
            return;
          }
          await investInListing(listing);
          if (window.AdoptPlant && typeof window.AdoptPlant.render === 'function') {
            try {
              window.AdoptPlant.render();
            } catch {
              // ignore
            }
          }
          if (listing.settlement === 'program') {
            flashOk('Investment complete. The plant token is in your wallet.');
          } else {
            flashOk(
              'Investment submitted. The plant appears in My garden when settlement finishes.'
            );
          }
        } else if (harvestBtn) {
          if (
            !confirm(
              'Claim harvest stake?\n\nIf every monthly care month qualifies (≥12 care days each), the locked 50% $GROWTOO releases to you. Otherwise it refunds to the adopter (all-or-nothing).'
            )
          ) {
            return;
          }
          await requestHarvestClaim(listing.id, harvestBtn.dataset.plantId || listing.plantId);
          flashOk('Harvest claim queued. Locked stake settles after the next adopt queue pass.');
        } else {
          await cancelListing(listing);
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
        if (!mintAddress) return flash(new Error('Choose a plant token to post.'));
        if (!price || price <= 0) return flash(new Error('Enter an invest price in $GROWTOO.'));
        const entry = listableTokens().find(function (o) {
          return o.mintAddress === mintAddress;
        });
        if (!entry) return flash(new Error('Asset not found or already listed.'));

        const submitBtn = form.querySelector('button[type="submit"]');
        busy = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Holding token for listing…';
        }
        try {
          await createListing(entry, price, {
            settlement: settlement === 'adopt_stake' ? 'adopt_stake' : undefined,
          });
          form.reset();
          syncSettlementFromRadios();
          flashOk(
            settlement === 'adopt_stake'
              ? 'Adopt-stake offer posted. 50% unlocks on settle; 50% locked until monthly harvest care.'
              : 'Offer posted. Adopters can invest once escrow confirms.'
          );
        } catch (err) {
          flash(err);
        } finally {
          busy = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Post to market';
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
    if (!user) throw new Error('Sign in to claim harvest.');
    if (!isGrowerUi()) throw new Error('Only growers can claim harvest stakes.');
    const listing = listings.find(function (l) {
      return l.id === listingId;
    });
    if (!listing) throw new Error('Listing not found.');
    if (listing.uid !== user.uid) throw new Error('Not your listing.');
    if (listing.settlement !== 'adopt_stake') throw new Error('Not an adopt-stake listing.');
    if (listing.careStatus !== 'active') throw new Error('Care stake is not active.');

    const ref = firebase.firestore().collection('harvestClaims').doc(listingId);
    const existing = await ref.get();
    if (existing.exists) {
      const st = (existing.data() || {}).status;
      if (st === 'pending') throw new Error('A harvest claim is already pending for this stake.');
      if (st === 'released' || st === 'refunded') {
        throw new Error('Harvest stake already settled for this listing.');
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
  }

  async function claimPlatformBonus() {
    const user = currentUser();
    if (!user) throw new Error('Sign in to claim the platform bonus.');
    if (!isGrowerUi()) throw new Error('Only growers can claim the platform bonus.');
    const SW = await ensureSigningWallet('claim platform monthly bonus');
    const monthKey = currentMonthKey();
    const docId = user.uid + '_' + monthKey;
    const ref = firebase.firestore().collection('platformRewards').doc(docId);
    const priorSnap = await ref.get();
    if (priorSnap.exists) {
      const st = (priorSnap.data() || {}).status;
      if (st === 'pending' || st === 'minted') {
        throw new Error('You already claimed (or have a pending claim) for ' + monthKey + '.');
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
    if (!user) throw new Error('Sign in to claim test $GROWTOO.');
    if (!isAdopterUi()) throw new Error('Switch to an adopter account to use the test faucet.');
    const SW = await ensureSigningWallet('claim test $GROWTOO faucet');
    const dayKey = currentDayKey();
    const monthKey = currentMonthKey();
    const docId = user.uid + '_faucet_' + dayKey;
    const ref = firebase.firestore().collection('platformRewards').doc(docId);
    const priorSnap = await ref.get();
    if (priorSnap.exists) {
      const st = (priorSnap.data() || {}).status;
      if (st === 'pending' || st === 'minted') {
        throw new Error(
          'You already claimed today’s Devnet faucet (' +
            dayKey +
            '). Try again after UTC midnight.'
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
    firebase.auth().onAuthStateChanged(function () {
      startWatch();
    });
  }
})();
