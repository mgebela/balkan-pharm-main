/*
 * Public commodity-style market board for the landing page (no auth).
 * Fetches marketListings from Firestore: open tape + adopter stake totals.
 * When the live tape is empty, shows a clearly labeled sample depth so the
 * board never reads as a dead market on first visit.
 */
(function () {
  'use strict';

  var OPEN_STATUSES = {
    active: true,
    escrow_pending: true,
    sale_pending: true,
  };

  /** Investable / ask volume — only fully active listings. */
  var ASK_STATUSES = {
    active: true,
  };

  var STAKED_STATUSES = {
    sold: true,
    sale_pending: true,
  };

  var STATUS_LABELS = {
    active: 'Open',
    escrow_pending: 'Activating',
    sale_pending: 'Settling',
  };

  /** Labeled sample depth when Firestore has no open contracts. */
  var DEMO_TAPE = [
    {
      id: 'demo-seed-auto',
      name: 'CBD Auto · Seed',
      strain: 'CBD Auto',
      batch: '2026-07-A',
      stage: 'Germination',
      assetType: 'seed',
      status: 'active',
      priceGrow: 120,
      demo: true,
    },
    {
      id: 'demo-seed-haze',
      name: 'Haze Lite · Seed',
      strain: 'Haze Lite',
      batch: '2026-07-B',
      stage: 'Seedling',
      assetType: 'seed',
      status: 'active',
      priceGrow: 180,
      demo: true,
    },
    {
      id: 'demo-flower-auto',
      name: 'CBD Auto · Flower',
      strain: 'CBD Auto',
      batch: '2026-06-C',
      stage: 'Flowering',
      assetType: 'flower',
      status: 'active',
      priceGrow: 420,
      demo: true,
    },
    {
      id: 'demo-staked',
      name: 'Outdoor Mix · Staked',
      strain: 'Outdoor Mix',
      batch: '2026-05-D',
      stage: 'Vegetative',
      assetType: 'seed',
      status: 'sold',
      priceGrow: 250,
      demo: true,
    },
  ];

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
    var isDemo = !!listing.demo;
    var status = isDemo ? 'Sample' : STATUS_LABELS[listing.status] || listing.status || '';
    var price = formatPrice(listing.priceGrow);
    var sym = symbolFrom(listing);
    var delay = Math.min(index * 45, 360);
    var canInvest = !isDemo && listing.status === 'active';
    var actionLabel = isDemo ? 'Open desk' : canInvest ? 'Invest' : status || 'View';
    var actionClass = canInvest
      ? 'btn btn-primary btn-sm market-row-action'
      : 'btn btn-ghost btn-sm market-row-action';
    var href = isDemo
      ? 'dnevnik/?mode=signup&type=grower'
      : 'dnevnik/?mode=signup&type=adopter';

    return (
      '<article class="landing-market-card market-row' +
      (isDemo ? ' market-row--demo' : '') +
      '" style="--row-delay:' +
      delay +
      'ms">' +
      '<div class="market-row-contract">' +
      '<span class="market-row-symbol">' +
      esc(sym) +
      '</span>' +
      '<div class="market-row-names">' +
      '<h3 class="landing-market-name">' +
      esc(listing.name || 'RWA offer') +
      (isDemo ? ' <span class="market-demo-pill">DEMO</span>' : '') +
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
        : isDemo
          ? ' <span class="landing-market-demo-note">illustrative ask</span>'
          : '') +
      '</p>' +
      '</div>' +
      '</div>' +
      '<p class="landing-market-meta market-row-grade">' +
      esc(gradeLine(listing)) +
      '</p>' +
      '<span class="landing-market-status' +
      (isDemo ? ' landing-market-status--demo' : ' landing-market-status--' + esc(listing.status || '')) +
      '">' +
      esc(status) +
      '</span>' +
      '<div class="market-row-last">' +
      '<span class="landing-market-price">' +
      esc(price) +
      '</span>' +
      '<span class="market-row-unit">$GROWTOO</span>' +
      '</div>' +
      '<a class="' +
      actionClass +
      '" href="' +
      href +
      '">' +
      esc(actionLabel) +
      '</a>' +
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
          esc(listing.demo ? 'DEMO' : STATUS_LABELS[listing.status] || 'Open') +
          '</span>' +
          '</span>'
        );
      })
      .join('');
    return items + items;
  }

  function updateStats(openListings, allListings, isDemo) {
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

    if (openEl) openEl.textContent = String(askList.length);
    if (volEl) volEl.textContent = formatPrice(askVolume) + ' $GROWTOO';
    if (stakedCountEl) {
      stakedCountEl.textContent =
        String(stakedList.length) + (stakedList.length === 1 ? ' contract' : ' contracts');
    }
    if (stakedValueEl) stakedValueEl.textContent = formatPrice(stakedValue) + ' $GROWTOO';
    if (totalEl) totalEl.textContent = formatPrice(totalValue) + ' $GROWTOO';
    if (clockEl) {
      clockEl.textContent = isDemo
        ? 'Sample depth · not live asks'
        : 'Last print ' + formatClock(new Date());
    }
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

  function setDemoBanner(show) {
    var banner = document.getElementById('landing-market-demo-banner');
    if (banner) banner.hidden = !show;
  }

  function render(openListings, allListings, opts) {
    var grid = document.getElementById('landing-market-grid');
    var empty = document.getElementById('landing-market-empty');
    var loading = document.getElementById('landing-market-loading');
    var board = document.getElementById('landing-market-board');
    var isDemo = !!(opts && opts.demo);
    if (loading) loading.hidden = true;
    if (!grid) return;

    updateStats(openListings, allListings || openListings, isDemo);
    updateTicker(openListings.filter(function (l) {
      return ASK_STATUSES[l.status] || l.demo;
    }));
    setDemoBanner(isDemo);

    if (board) {
      board.classList.toggle('market-board--empty', !openListings.length);
      board.classList.toggle('market-board--demo', isDemo);
    }

    if (!openListings.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    grid.innerHTML = openListings.map(rowHtml).join('');
  }

  function showDemoTape() {
    var open = DEMO_TAPE.filter(function (l) {
      return ASK_STATUSES[l.status];
    });
    render(open, DEMO_TAPE, { demo: true });
  }

  function showError(msg) {
    var loading = document.getElementById('landing-market-loading');
    var empty = document.getElementById('landing-market-empty');
    var clockEl = document.getElementById('landing-market-updated');
    if (loading) loading.hidden = true;
    if (empty) empty.hidden = true;
    if (clockEl) clockEl.textContent = 'Feed offline · showing sample';
    console.warn(msg || 'Could not load market offers.');
    showDemoTape();
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

        if (!open.length) {
          showDemoTape();
          return;
        }

        render(open.slice(0, 12), all, { demo: false });
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
