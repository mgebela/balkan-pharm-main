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
  let unsubscribe = null;
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
      emit();
      return;
    }
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
        },
        function (err) {
          console.warn('marketListings watch failed', err);
        }
      );
  }

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

  function emit() {
    listeners.forEach(function (fn) {
      try {
        fn(listings);
      } catch {
        // ignore
      }
    });
    render();
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
      '<p>Cloud queues retry every few minutes. Escrow activation is automatic; buys/cancels settle via the market worker (GitHub Actions or local <code>market:queue</code>).</p>' +
      '<ul>' +
      parts.join('') +
      '</ul>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="market-stuck-retry">Retry now</button>' +
      '</div>';
  }

  function forceReconcileNow(count) {
    const url = cfg().marketReconcileUrl;
    const btn = document.getElementById('market-stuck-retry');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Retrying…';
    }
    lastReconcileAt = 0;
    const ping = url
      ? fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'app-stuck-retry', count: count || 0 }),
        })
          .then(function (res) {
            return res.json().catch(function () {
              return { ok: res.ok };
            });
          })
          .catch(function () {
            return { ok: false };
          })
      : Promise.resolve({ ok: false });

    ping.then(function (data) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Retry now';
      }
      if (data && data.activated > 0) {
        flashOk('Activated ' + data.activated + ' listing(s). Refresh if status lags.');
        return;
      }
      const settle =
        data && (Number(data.salePending || 0) + Number(data.cancelRequested || 0) > 0)
          ? ' ' +
            (Number(data.salePending || 0) + Number(data.cancelRequested || 0)) +
            ' buy/cancel still need the market queue (GitHub Actions every ~5 min).'
          : ' Buys/cancels settle via the cloud market queue once GitHub secrets are set.';
      flashOk('Escrow retry sent.' + settle);
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
        const mintAddress =
          (mint && mint.status === 'minted' && mint.mintAddress) ||
          token.mintAddress ||
          null;
        if (!mintAddress) return null;
        if (mint && mint.status && mint.status !== 'minted') return null;
        if (listed.has(mintAddress)) return null;
        return {
          token: token,
          mintAddress: mintAddress,
          mintRequestId: token.mintRequestId || (mint && mint.id) || null,
        };
      })
      .filter(Boolean);
  }

  /** Pull settled / in-flight investments into the adopter garden. */
  function syncMyInvestments() {
    const user = currentUser();
    const PT = window.PlantToken;
    if (!user || !PT || typeof PT.adoptFromListing !== 'function') return;
    listings.forEach(function (l) {
      if (l.buyerUid !== user.uid) return;
      if (l.status !== 'sold' && l.status !== 'sale_pending') return;
      try {
        PT.adoptFromListing(l);
      } catch (err) {
        console.warn('adoptFromListing failed', err);
      }
    });
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

  async function createListing(tokenEntry, priceGrow) {
    const user = currentUser();
    if (!user) throw new Error('Sign in to post an RWA offer.');
    if (!isGrowerUi()) throw new Error('Only grower accounts can post RWA offers.');

    const SW = await ensureSigningWallet('post an offer (escrow the NFT)');
    const escrow = cfg().escrowAddress;
    if (!escrow) throw new Error('Escrow address is not configured.');
    if (!window.SplTransfer) throw new Error('Token transfer helper is not loaded.');

    let escrowSignature = null;
    const held = await window.SplTransfer.getRawBalance(tokenEntry.mintAddress);
    if (held >= 1n) {
      escrowSignature = await window.SplTransfer.transferNft(tokenEntry.mintAddress, escrow);
    } else {
      // Recover from a prior success where confirm timed out after escrow moved.
      const escrowHeld = await window.SplTransfer.getRawBalanceOf(escrow, tokenEntry.mintAddress);
      if (escrowHeld < 1n) {
        throw new Error(
          'This wallet no longer holds that NFT and escrow does not either. Refresh and check ownership before posting again.'
        );
      }
      escrowSignature = 'recovered-escrow-' + Date.now();
    }

    const token = tokenEntry.token;
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
      priceGrow: Math.round(priceGrow),
      status: 'escrow_pending',
      escrowSignature,
      cluster: 'devnet',
      createdAt: new Date().toISOString(),
    });

    if (window.PlantToken && typeof PlantToken.markTokenListed === 'function') {
      PlantToken.markTokenListed(tokenEntry.mintAddress, tokenEntry.mintRequestId);
    }
  }

  async function investInListing(listing) {
    const user = currentUser();
    if (!user) throw new Error('Sign in to invest.');
    if (!isAdopterUi()) throw new Error('Switch to an adopter account to invest in RWAs.');

    const SW = await ensureSigningWallet('invest ($GROWTOO payment)');

    const paymentSignature = await window.SplTransfer.payGrow(listing.sellerPubkey, listing.priceGrow);

    await firebase.firestore().collection('marketListings').doc(listing.id).update({
      status: 'sale_pending',
      buyerUid: user.uid,
      buyerPubkey: SW.getPublicKey(),
      paymentSignature,
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
  }

  async function cancelListing(listing) {
    await firebase.firestore().collection('marketListings').doc(listing.id).update({
      status: 'cancel_requested',
      cancelRequestedAt: new Date().toISOString(),
    });
  }

  // --- UI --------------------------------------------------------------------

  const STATUS_LABELS = {
    escrow_pending: 'Activating escrow…',
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
    const label = assetType === 'flower' ? 'Flower RWA' : 'Seed RWA';
    return (
      '<span class="market-asset-badge market-asset-badge--' +
      esc(assetType || 'seed') +
      '">' +
      label +
      '</span>'
    );
  }

  function listingCardHtml(listing, uid) {
    const isMine = listing.uid === uid;
    const isBuyer = listing.buyerUid === uid;
    const canInvest = isAdopterUi() && !isMine && listing.status === 'active';
    const canCancel = isGrowerUi() && isMine && listing.status === 'active';
    return (
      '<article class="market-card" data-id="' +
      esc(listing.id) +
      '">' +
      '<div class="market-card-head">' +
      assetBadge(listing.assetType) +
      statusBadge(listing.status) +
      '</div>' +
      '<h4 class="market-card-name">' +
      esc(listing.name) +
      '</h4>' +
      '<p class="market-card-meta">' +
      esc(listing.strain || '') +
      (listing.batch ? ' · batch ' + esc(listing.batch) : '') +
      (listing.stage ? ' · ' + esc(listing.stage) : '') +
      '</p>' +
      '<p class="market-card-meta">NFT: <a href="' +
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
      '<span class="market-price">' +
      Number(listing.priceGrow).toLocaleString('en-US') +
      ' $GROWTOO</span>' +
      (canInvest
        ? '<button type="button" class="btn btn-primary btn-sm market-invest-btn" data-id="' +
          esc(listing.id) +
          '">Invest</button>'
        : '') +
      (canCancel
        ? '<button type="button" class="btn btn-ghost btn-sm market-cancel-btn" data-id="' +
          esc(listing.id) +
          '">Cancel</button>'
        : '') +
      '</div>' +
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
          notice.hidden = false;
          notice.textContent =
            'Post real minted seed / growth RWAs. Adopters invest with $GROWTOO; the NFT transfers when settlement confirms.';
        } else {
          notice.hidden = false;
          notice.textContent =
            'Invest $GROWTOO to adopt a grower’s real RWA. Connect your wallet, then tap Invest on an open offer.';
        }
      }

      renderStuckBanner(listings, uid);

      if (sel) {
        const options = listableTokens();
        const current = sel.value;
        sel.innerHTML =
          '<option value="">— choose a minted RWA —</option>' +
          options
            .map(function (o) {
              return (
                '<option value="' +
                esc(o.mintAddress) +
                '">' +
                esc(o.token.name) +
                ' · ' +
                esc(stageLabel(o.token.stageIndex)) +
                ' (' +
                esc(shortAddr(o.mintAddress)) +
                ')' +
                '</option>'
              );
            })
            .join('');
        if (current) sel.value = current;
      }

      if (listSection) {
        listSection.hidden = !(uid && isGrowerUi());
      }

      const mine = listings.filter(function (l) {
        return l.uid === uid;
      });
      // Adopters see live + settling offers; also show escrow_pending so the
      // board is not empty while the settlement worker confirms NFT escrow.
      const open = listings.filter(function (l) {
        return (
          l.status === 'active' ||
          l.status === 'sale_pending' ||
          l.status === 'escrow_pending'
        );
      });

      if (browseGrid) {
        browseGrid.innerHTML = open.length
          ? open.map(function (l) {
              return listingCardHtml(l, uid);
            }).join('')
          : '<div class="empty-state">' +
            (isGrowerUi()
              ? 'No live offers yet. Mint an RWA in Tokenise, then post it here.'
              : 'No open investment offers yet. Check back when growers post RWAs.') +
            '</div>';
      }
      if (mineGrid) {
        mineGrid.innerHTML = mine.length
          ? mine.map(function (l) {
              return listingCardHtml(l, uid);
            }).join('')
          : '<div class="empty-state">You have not posted any RWA offers yet.</div>';
      }
    } finally {
      marketRenderBusy = false;
    }
  }

  function flash(err) {
    console.error('Market error', err);
    alert(err && err.message ? err.message : 'Something went wrong.');
  }

  function flashOk(msg) {
    alert(msg || 'Done.');
  }

  let eventsBound = false;

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const view = document.getElementById('view-market');
    if (!view) return;

    view.addEventListener('click', async function (e) {
      const investBtn = e.target.closest('.market-invest-btn');
      const cancelBtn = e.target.closest('.market-cancel-btn');
      if (!investBtn && !cancelBtn) return;
      if (busy) return;
      const id = (investBtn || cancelBtn).dataset.id;
      const listing = listings.find(function (l) {
        return l.id === id;
      });
      if (!listing) return;
      busy = true;
      const btn = investBtn || cancelBtn;
      const prevText = btn.textContent;
      btn.textContent = investBtn ? 'Investing…' : 'Cancelling…';
      btn.disabled = true;
      try {
        if (investBtn) {
          if (
            !confirm(
              'Invest ' +
                listing.priceGrow +
                ' $GROWTOO to adopt "' +
                listing.name +
                '" on Solana devnet?\n\nYou will receive the RWA NFT when settlement completes.'
            )
          ) {
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
          alert(
            'Investment submitted. $GROWTOO payment is confirming — the NFT will appear in My garden when settlement finishes. Keep the market worker running if you operate the chain queue.'
          );
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
        const mintAddress = sel ? sel.value : '';
        const price = priceEl ? parseInt(priceEl.value, 10) : 0;
        if (!mintAddress) return flash(new Error('Choose an RWA to post.'));
        if (!price || price <= 0) return flash(new Error('Enter an invest price in $GROWTOO.'));
        const entry = listableTokens().find(function (o) {
          return o.mintAddress === mintAddress;
        });
        if (!entry) return flash(new Error('Asset not found or already listed.'));

        const submitBtn = form.querySelector('button[type="submit"]');
        busy = true;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Escrowing NFT…';
        }
        try {
          await createListing(entry, price);
          form.reset();
          alert('Offer posted. Adopters can invest once escrow confirms (status: Open for investment).');
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

  window.Market = {
    render() {
      bindEvents();
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
  };

  if (firebaseReady()) {
    firebase.auth().onAuthStateChanged(function () {
      startWatch();
    });
  }
})();
