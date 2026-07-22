/*
 * Public commodity-style market board for the landing page (no auth).
 * Fetches marketListings from Firestore: open tape + adopter stake totals.
 */
(function () {
  'use strict';

  var OPEN_STATUSES = {
    active: true,
    escrow_pending: true,
    sale_pending: true,
  };

  var ASK_STATUSES = {
    active: true,
    escrow_pending: true,
  };

  var STAKED_STATUSES = {
    sold: true,
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

  function symbolFrom(listing) {
    var name = String(listing.name || 'RWA').trim();
    var parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0].slice(0, 3) + parts[1].slice(0, 2)).toUpperCase();
    }
    return name.replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase() || 'RWA';
  }

  function formatPrice(n) {
    return Number(n || 0).toLocaleString('en-US', {
      maximumFractionDigits: 0,
    });
  }

  function sumPrice(list) {
    return list.reduce(function (sum, listing) {
      return sum + Number(listing.priceGrow || 0);
    }, 0);
  }

  function formatClock(d) {
    try {
      return d.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch (e) {
      return '';
    }
  }

  function gradeLine(listing) {
    var bits = [];
    if (listing.strain) bits.push(listing.strain);
    if (listing.batch) bits.push('B' + listing.batch);
    if (listing.stage) bits.push(listing.stage);
    return bits.join(' · ') || 'Devnet RWA';
  }

  function rowHtml(listing, index) {
    var asset = listing.assetType === 'flower' ? 'FLWR' : 'SEED';
    var status = STATUS_LABELS[listing.status] || listing.status || '';
    var price = formatPrice(listing.priceGrow);
    var sym = symbolFrom(listing);
    var delay = Math.min(index * 45, 360);

    return (
      '<article class="landing-market-card market-row" style="--row-delay:' +
      delay +
      'ms">' +
      '<div class="market-row-contract">' +
      '<span class="market-row-symbol">' +
      esc(sym) +
      '</span>' +
      '<div class="market-row-names">' +
      '<h3 class="landing-market-name">' +
      esc(listing.name || 'RWA offer') +
      '</h3>' +
      '<p class="landing-market-mint">' +
      '<span class="landing-market-asset">' +
      esc(asset) +
      '</span>' +
      (listing.mintAddress
        ? ' <a href="' +
          esc(explorerMint(listing.mintAddress)) +
          '" target="_blank" rel="noopener noreferrer"><code>' +
          esc(shortAddr(listing.mintAddress)) +
          '</code></a>'
        : '') +
      '</p>' +
      '</div>' +
      '</div>' +
      '<p class="landing-market-meta market-row-grade">' +
      esc(gradeLine(listing)) +
      '</p>' +
      '<span class="landing-market-status landing-market-status--' +
      esc(listing.status || '') +
      '">' +
      esc(status) +
      '</span>' +
      '<div class="market-row-last">' +
      '<span class="landing-market-price">' +
      esc(price) +
      '</span>' +
      '<span class="market-row-unit">$GROWTOO</span>' +
      '</div>' +
      '<a class="btn btn-primary btn-sm market-row-action" href="dnevnik/?mode=signup&type=adopter">Invest</a>' +
      '</article>'
    );
  }

  function tickerHtml(listings) {
    if (!listings.length) return '';
    var items = listings
      .map(function (listing) {
        return (
          '<span class="market-ticker-item">' +
          '<strong>' +
          esc(symbolFrom(listing)) +
          '</strong>' +
          '<em>' +
          esc(formatPrice(listing.priceGrow)) +
          '</em>' +
          '<span class="market-ticker-tag">' +
          esc(STATUS_LABELS[listing.status] || 'Open') +
          '</span>' +
          '</span>'
        );
      })
      .join('');
    return items + items;
  }

  function updateStats(openListings, allListings) {
    var openEl = document.getElementById('landing-market-open');
    var volEl = document.getElementById('landing-market-volume');
    var stakedCountEl = document.getElementById('landing-market-staked-count');
    var stakedValueEl = document.getElementById('landing-market-staked-value');
    var totalEl = document.getElementById('landing-market-total');
    var clockEl = document.getElementById('landing-market-updated');

    var askList = allListings.filter(function (l) {
      return ASK_STATUSES[l.status];
    });
    var stakedList = allListings.filter(function (l) {
      return STAKED_STATUSES[l.status];
    });

    var askVolume = sumPrice(askList);
    var stakedValue = sumPrice(stakedList);
    var totalValue = askVolume + stakedValue;

    if (openEl) openEl.textContent = String(openListings.length);
    if (volEl) volEl.textContent = formatPrice(askVolume) + ' $GROWTOO';
    if (stakedCountEl) {
      stakedCountEl.textContent =
        String(stakedList.length) + (stakedList.length === 1 ? ' contract' : ' contracts');
    }
    if (stakedValueEl) stakedValueEl.textContent = formatPrice(stakedValue) + ' $GROWTOO';
    if (totalEl) totalEl.textContent = formatPrice(totalValue) + ' $GROWTOO';
    if (clockEl) clockEl.textContent = 'Last print ' + formatClock(new Date());
  }

  function updateTicker(listings) {
    var ticker = document.getElementById('landing-market-ticker');
    var track = document.getElementById('landing-market-ticker-track');
    if (!ticker || !track) return;
    if (!listings.length) {
      ticker.hidden = true;
      track.innerHTML = '';
      return;
    }
    track.innerHTML = tickerHtml(listings);
    ticker.hidden = false;
  }

  function render(openListings, allListings) {
    var grid = document.getElementById('landing-market-grid');
    var empty = document.getElementById('landing-market-empty');
    var loading = document.getElementById('landing-market-loading');
    var board = document.getElementById('landing-market-board');
    if (loading) loading.hidden = true;
    if (!grid) return;

    updateStats(openListings, allListings || openListings);
    updateTicker(openListings);

    if (board) {
      board.classList.toggle('market-board--empty', !openListings.length);
    }

    if (!openListings.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    grid.innerHTML = openListings.map(rowHtml).join('');
  }

  function showError(msg) {
    var loading = document.getElementById('landing-market-loading');
    var empty = document.getElementById('landing-market-empty');
    var clockEl = document.getElementById('landing-market-updated');
    if (loading) {
      loading.hidden = false;
      loading.textContent = msg || 'Could not load market offers.';
    }
    if (empty) empty.hidden = true;
    if (clockEl) clockEl.textContent = 'Feed offline';
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
      .limit(100)
      .get()
      .then(function (snap) {
        var all = [];
        snap.forEach(function (doc) {
          var data = doc.data() || {};
          all.push(
            Object.assign({}, data, {
              id: doc.id,
            })
          );
        });

        var open = all.filter(function (listing) {
          return OPEN_STATUSES[listing.status];
        });

        render(open.slice(0, 12), all);
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
