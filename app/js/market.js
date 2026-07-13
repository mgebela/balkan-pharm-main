/*
 * Marketplace MVP (M4, devnet).
 *
 * List and swap seed RWAs / flower-stage tokens for $GROW on devnet.
 * Listings live in Firestore (`marketListings`); the on-chain legs are:
 *   - seller escrows the NFT to the authority wallet (signed in-app),
 *   - buyer pays the seller in $GROW (signed in-app),
 *   - the settlement script (chain/process-market.js) verifies both and
 *     releases the NFT to the buyer.
 */
(function () {
  'use strict';

  const listeners = new Set();
  let listings = [];
  let unsubscribe = null;
  let watchedUid = '';
  let busy = false;

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
          emit();
        },
        function (err) {
          console.warn('marketListings watch failed', err);
        }
      );
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

  function listedMintAddresses() {
    const set = new Set();
    listings.forEach(function (l) {
      if (OPEN_STATUSES.includes(l.status)) set.add(l.mintAddress);
    });
    return set;
  }

  // My tokens that exist as real devnet NFTs and are not yet listed.
  function listableTokens() {
    const PT = window.PlantToken;
    const SC = window.SeedChain;
    if (!PT || !SC) return [];
    const listed = listedMintAddresses();
    return PT.getWallet()
      .tokens.map(function (token) {
        const mint = token.mintRequestId ? SC.getMint(token.mintRequestId) : null;
        if (!mint || mint.status !== 'minted' || !mint.mintAddress) return null;
        if (listed.has(mint.mintAddress)) return null;
        return { token, mintAddress: mint.mintAddress };
      })
      .filter(Boolean);
  }

  // --- actions ----------------------------------------------------------------

  async function createListing(tokenEntry, priceGrow) {
    const user = currentUser();
    if (!user) throw new Error('Sign in to list assets.');
    const SW = window.SolanaWallet;
    if (!SW || !SW.isConnected()) throw new Error('Connect a wallet to list assets.');
    const provider = SW.getProviderName();
    if (provider === 'watch-only' || provider === 'manual') {
      throw new Error('Watch-only wallets cannot sign the escrow transfer. Connect a wallet extension.');
    }
    const escrow = cfg().escrowAddress;
    if (!escrow) throw new Error('Escrow address is not configured.');

    // Seller signs: NFT → escrow.
    const escrowSignature = await window.SplTransfer.transferNft(tokenEntry.mintAddress, escrow);

    const token = tokenEntry.token;
    await firebase.firestore().collection('marketListings').add({
      uid: user.uid,
      sellerPubkey: SW.getPublicKey(),
      mintAddress: tokenEntry.mintAddress,
      name: token.name,
      strain: token.strain || token.name,
      batch: token.batch || '',
      stage: stageLabel(token.stageIndex),
      assetType: assetTypeForStage(token.stageIndex),
      priceGrow: Math.round(priceGrow),
      status: 'escrow_pending',
      escrowSignature,
      cluster: 'devnet',
      createdAt: new Date().toISOString(),
    });
  }

  async function buyListing(listing) {
    const user = currentUser();
    if (!user) throw new Error('Sign in to buy assets.');
    const SW = window.SolanaWallet;
    if (!SW || !SW.isConnected()) throw new Error('Connect a wallet to buy.');
    const provider = SW.getProviderName();
    if (provider === 'watch-only' || provider === 'manual') {
      throw new Error('Watch-only wallets cannot sign the payment. Connect a wallet extension.');
    }

    // Buyer signs: price in $GROW → seller.
    const paymentSignature = await window.SplTransfer.payGrow(listing.sellerPubkey, listing.priceGrow);

    await firebase.firestore().collection('marketListings').doc(listing.id).update({
      status: 'sale_pending',
      buyerUid: user.uid,
      buyerPubkey: SW.getPublicKey(),
      paymentSignature,
    });
  }

  async function cancelListing(listing) {
    await firebase.firestore().collection('marketListings').doc(listing.id).update({
      status: 'cancel_requested',
    });
  }

  // --- UI --------------------------------------------------------------------

  const STATUS_LABELS = {
    escrow_pending: 'Escrow confirming…',
    active: 'Live',
    sale_pending: 'Sale settling…',
    cancel_requested: 'Cancelling…',
    sold: 'Sold',
    cancelled: 'Cancelled',
    failed: 'Failed',
  };

  function statusBadge(status) {
    return (
      '<span class="market-status market-status--' + esc(status) + '">' +
      esc(STATUS_LABELS[status] || status) +
      '</span>'
    );
  }

  function assetBadge(assetType) {
    const label = assetType === 'flower' ? '🌸 Flower' : '🌰 Seed RWA';
    return '<span class="market-asset-badge market-asset-badge--' + esc(assetType || 'seed') + '">' + label + '</span>';
  }

  function listingCardHtml(listing, uid) {
    const isMine = listing.uid === uid;
    const canBuy = !isMine && listing.status === 'active';
    const canCancel = isMine && listing.status === 'active';
    return (
      '<article class="market-card" data-id="' + esc(listing.id) + '">' +
      '<div class="market-card-head">' +
      assetBadge(listing.assetType) +
      statusBadge(listing.status) +
      '</div>' +
      '<h4 class="market-card-name">' + esc(listing.name) + '</h4>' +
      '<p class="market-card-meta">' +
      esc(listing.strain || '') +
      (listing.batch ? ' · batch ' + esc(listing.batch) : '') +
      (listing.stage ? ' · ' + esc(listing.stage) : '') +
      '</p>' +
      '<p class="market-card-meta">NFT: <a href="' + esc(explorerAddress(listing.mintAddress)) + '" target="_blank" rel="noopener noreferrer"><code>' + esc(shortAddr(listing.mintAddress)) + '</code></a>' +
      ' · seller <code>' + esc(shortAddr(listing.sellerPubkey)) + '</code>' +
      (isMine ? ' (you)' : '') +
      '</p>' +
      '<div class="market-card-foot">' +
      '<span class="market-price">' + Number(listing.priceGrow).toLocaleString('en-US') + ' $GROW</span>' +
      (canBuy ? '<button type="button" class="btn btn-primary btn-sm market-buy-btn" data-id="' + esc(listing.id) + '">Buy</button>' : '') +
      (canCancel ? '<button type="button" class="btn btn-ghost btn-sm market-cancel-btn" data-id="' + esc(listing.id) + '">Cancel</button>' : '') +
      '</div>' +
      (listing.status === 'failed' && listing.error && isMine
        ? '<p class="market-card-error">' + esc(listing.error) + '</p>'
        : '') +
      '</article>'
    );
  }

  function render() {
    const view = document.getElementById('view-market');
    if (!view || !view.classList.contains('active')) return;

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
        notice.textContent = 'Sign in to use the devnet marketplace.';
      } else if (!cfg().growMint) {
        notice.hidden = false;
        notice.textContent =
          'Devnet marketplace is live once the $GROW mint and seed collection are deployed (M1 funding pending). Listings below are read-only until then.';
      } else {
        notice.hidden = true;
      }
    }

    // Listable assets dropdown.
    if (sel) {
      const options = listableTokens();
      const current = sel.value;
      sel.innerHTML =
        '<option value="">— choose a minted asset —</option>' +
        options
          .map(function (o) {
            return (
              '<option value="' + esc(o.mintAddress) + '">' +
              esc(o.token.name) + ' · ' + esc(stageLabel(o.token.stageIndex)) +
              ' (' + esc(shortAddr(o.mintAddress)) + ')' +
              '</option>'
            );
          })
          .join('');
      if (current) sel.value = current;
      if (listSection) listSection.hidden = !uid;
    }

    const mine = listings.filter(function (l) {
      return l.uid === uid;
    });
    const open = listings.filter(function (l) {
      return l.status === 'active' || l.status === 'sale_pending';
    });

    if (browseGrid) {
      browseGrid.innerHTML = open.length
        ? open.map(function (l) { return listingCardHtml(l, uid); }).join('')
        : '<div class="empty-state">No live listings yet. Mint and grow a plant, then list it here.</div>';
    }
    if (mineGrid) {
      mineGrid.innerHTML = mine.length
        ? mine.map(function (l) { return listingCardHtml(l, uid); }).join('')
        : '<div class="empty-state">You have no listings.</div>';
    }
  }

  function flash(err) {
    console.error('Market error', err);
    alert(err && err.message ? err.message : 'Something went wrong.');
  }

  let eventsBound = false;

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const view = document.getElementById('view-market');
    if (!view) return;

    view.addEventListener('click', async function (e) {
      const buyBtn = e.target.closest('.market-buy-btn');
      const cancelBtn = e.target.closest('.market-cancel-btn');
      if (!buyBtn && !cancelBtn) return;
      if (busy) return;
      const id = (buyBtn || cancelBtn).dataset.id;
      const listing = listings.find(function (l) {
        return l.id === id;
      });
      if (!listing) return;
      busy = true;
      const btn = buyBtn || cancelBtn;
      const prevText = btn.textContent;
      btn.textContent = buyBtn ? 'Paying…' : 'Cancelling…';
      btn.disabled = true;
      try {
        if (buyBtn) {
          if (!confirm('Buy "' + listing.name + '" for ' + listing.priceGrow + ' $GROW on devnet?')) {
            return;
          }
          await buyListing(listing);
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
        if (!mintAddress) return flash(new Error('Choose an asset to list.'));
        if (!price || price <= 0) return flash(new Error('Enter a price in $GROW.'));
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
        } catch (err) {
          flash(err);
        } finally {
          busy = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'List for sale';
          }
        }
      });
    }
  }

  window.Market = {
    render() {
      bindEvents();
      startWatch();
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
