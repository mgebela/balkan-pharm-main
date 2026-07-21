/*
 * Public market board for the landing page (no auth required).
 * Fetches open marketListings from Firestore and renders a browse strip.
 */
(function () {
  'use strict';

  var OPEN_STATUSES = {
    active: true,
    escrow_pending: true,
    sale_pending: true,
  };

  var STATUS_LABELS = {
    active: 'Open',
    escrow_pending: 'Confirming',
    sale_pending: 'Settling',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shortAddr(addr) {
    var s = String(addr || '');
    if (s.length < 10) return s;
    return s.slice(0, 4) + '…' + s.slice(-4);
  }

  function explorerMint(mint) {
    return 'https://solscan.io/token/' + encodeURIComponent(mint || '') + '?cluster=devnet';
  }

  function cardHtml(listing) {
    var asset = listing.assetType === 'flower' ? 'Flower RWA' : 'Seed RWA';
    var status = STATUS_LABELS[listing.status] || listing.status || '';
    var price = Number(listing.priceGrow || 0).toLocaleString('en-US');
    var meta = [];
    if (listing.strain) meta.push(listing.strain);
    if (listing.batch) meta.push('batch ' + listing.batch);
    if (listing.stage) meta.push(listing.stage);

    return (
      '<article class="landing-market-card">' +
      '<div class="landing-market-card-head">' +
      '<span class="landing-market-asset">' +
      esc(asset) +
      '</span>' +
      '<span class="landing-market-status landing-market-status--' +
      esc(listing.status || '') +
      '">' +
      esc(status) +
      '</span>' +
      '</div>' +
      '<h3 class="landing-market-name">' +
      esc(listing.name || 'RWA offer') +
      '</h3>' +
      '<p class="landing-market-meta">' +
      esc(meta.join(' · ') || 'Devnet RWA') +
      '</p>' +
      (listing.mintAddress
        ? '<p class="landing-market-mint">NFT <a href="' +
          esc(explorerMint(listing.mintAddress)) +
          '" target="_blank" rel="noopener noreferrer"><code>' +
          esc(shortAddr(listing.mintAddress)) +
          '</code></a></p>'
        : '') +
      '<div class="landing-market-foot">' +
      '<span class="landing-market-price">' +
      price +
      ' $GROW</span>' +
      '<a class="btn btn-primary btn-sm" href="dnevnik/?mode=signup&type=adopter">Invest</a>' +
      '</div>' +
      '</article>'
    );
  }

  function render(listings) {
    var grid = document.getElementById('landing-market-grid');
    var empty = document.getElementById('landing-market-empty');
    var loading = document.getElementById('landing-market-loading');
    if (loading) loading.hidden = true;
    if (!grid) return;

    if (!listings.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    grid.innerHTML = listings.map(cardHtml).join('');
  }

  function showError(msg) {
    var loading = document.getElementById('landing-market-loading');
    var empty = document.getElementById('landing-market-empty');
    if (loading) {
      loading.hidden = false;
      loading.textContent = msg || 'Could not load market offers.';
    }
    if (empty) empty.hidden = true;
  }

  function load() {
    if (!window.firebase || !firebase.firestore) {
      showError('Market temporarily unavailable.');
      return;
    }

    firebase
      .firestore()
      .collection('marketListings')
      .orderBy('createdAt', 'desc')
      .limit(24)
      .get()
      .then(function (snap) {
        var open = [];
        snap.forEach(function (doc) {
          var data = doc.data() || {};
          if (!OPEN_STATUSES[data.status]) return;
          open.push(
            Object.assign({}, data, {
              id: doc.id,
            })
          );
        });
        render(open.slice(0, 12));
      })
      .catch(function (err) {
        console.warn('landing market failed', err);
        showError('Could not load market offers. Try again later.');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
