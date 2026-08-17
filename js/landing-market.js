/*
 * Public commodity-style market board for the landing page (no auth).
 * Fetches scrubbed marketPublicTape from Firestore (no auth): open tape +
 * adopter stake totals. Never reads full marketListings (uids/wallets/journal).
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

  /* [dictionary key, English] — resolved at render time, since this table
     is built while the page parses, before the dictionary lands. */
  var STATUS_LABELS = {
    active: ['landing.board.statusOpen', 'Open'],
    escrow_pending: ['landing.board.statusActivating', 'Activating'],
    sale_pending: ['landing.board.statusSettling', 'Settling'],
  };

  function statusLabel(status) {
    var row = STATUS_LABELS[status];
    return row ? T(row[0], row[1]) : '';
  }

  /* Labeled sample depth when Firestore has no open contracts.
     i18n-ignore for the whole table: these rows stand in for Firestore
     documents, and real listings carry the same raw English values in the
     same fields. Translating the sample would make it diverge from what a
     live row looks like. Strain names are cultivar names either way. */
  var DEMO_TAPE = [
    {
      id: 'demo-seed-auto',
      name: 'CBD Auto · Seed', // i18n-ignore
      strain: 'CBD Auto', // i18n-ignore
      batch: '2026-07-A',
      stage: 'Germination', // i18n-ignore
      assetType: 'seed',
      status: 'active',
      priceGrow: 120,
      demo: true,
    },
    {
      id: 'demo-seed-haze',
      name: 'Haze Lite · Seed', // i18n-ignore
      strain: 'Haze Lite', // i18n-ignore
      batch: '2026-07-B',
      stage: 'Seedling', // i18n-ignore
      assetType: 'seed',
      status: 'active',
      priceGrow: 180,
      demo: true,
    },
    {
      id: 'demo-flower-auto',
      name: 'CBD Auto · Flower', // i18n-ignore
      strain: 'CBD Auto', // i18n-ignore
      batch: '2026-06-C',
      stage: 'Flowering', // i18n-ignore
      assetType: 'flower',
      status: 'active',
      priceGrow: 420,
      demo: true,
    },
    {
      id: 'demo-staked',
      name: 'Outdoor Mix · Staked', // i18n-ignore
      strain: 'Outdoor Mix', // i18n-ignore
      batch: '2026-05-D',
      stage: 'Vegetative', // i18n-ignore
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
    return bits.join(' · ') || T('landing.board.devnetRwa', 'Devnet RWA');
  }

  function rowHtml(listing, index) {
    var asset = listing.assetType === 'flower' ? 'FLWR' : 'SEED';
    var isDemo = !!listing.demo;
    var status = isDemo
      ? T('landing.board.sample', 'Sample')
      : statusLabel(listing.status) || listing.status || '';
    var statusKey = isDemo ? 'demo' : listing.status || '';
    var price = formatPrice(listing.priceGrow);
    var sym = symbolFrom(listing);
    var delay = Math.min(index * 45, 360);
    var canInvest = !isDemo && listing.status === 'active';
    var actionLabel = isDemo
      ? T('landing.board.listPlant', 'List a plant')
      : canInvest
        ? T('landing.board.invest', 'Invest')
        : status || T('landing.board.view', 'View');
    // i18n-ignore — CSS classes.
    var actionClass = canInvest
      ? 'btn btn-primary btn-sm market-row-action'
      : 'btn btn-ghost btn-sm market-row-action';
    var href = isDemo
      ? 'dnevnik/?mode=signup&type=grower'
      : 'dnevnik/?mode=signup&type=adopter';
    var title = listing.strain
      ? listing.strain + (listing.batch ? ' · B' + listing.batch : '')
      : listing.name || T('landing.board.rwaOffer', 'RWA offer');

    return (
      '<article class="landing-market-card market-row market-row--' +
      esc(statusKey) +
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
      esc(title) +
      (isDemo ? ' <span class="market-demo-pill">DEMO</span>' : '') +
      '</h3>' +
      '<p class="landing-market-mint market-row-subhead">' +
      '<span class="landing-market-asset">' +
      esc(asset) +
      '</span>' +
      '<span class="market-row-subhead-ask">' +
      esc(price) +
      ' $GROWTOO</span>' +
      '<span class="market-row-subhead-status">' +
      esc(status) +
      '</span>' +
      (listing.mintAddress
        ? ' <a href="' +
          esc(explorerMint(listing.mintAddress)) +
          '" target="_blank" rel="noopener noreferrer"><code>' +
          esc(shortAddr(listing.mintAddress)) +
          '</code></a>'
        : isDemo
          ? ' <span class="landing-market-demo-note">' +
        esc(T('landing.board.illustrative', 'illustrative ask')) +
        '</span>'
          : '') +
      '</p>' +
      '</div>' +
      '</div>' +
      '<p class="landing-market-meta market-row-grade">' +
      esc(gradeLine(listing)) +
      '</p>' +
      '<span class="landing-market-status landing-market-status--' +
      esc(statusKey) +
      '">' +
      esc(status) +
      '</span>' +
      '<div class="market-row-last">' +
      '<span class="landing-market-price">' +
      esc(price) +
      '</span>' +
      // i18n-ignore — ticker symbol.
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
          esc(
        listing.demo
          ? T('landing.board.demo', 'DEMO')
          : statusLabel(listing.status) || T('landing.board.statusOpen', 'Open')
      ) +
          '</span>' +
          '</span>'
        );
      })
      .join('');
    return items + items;
  }

  function settlementLabel(listing) {
    var adoptStake = T('landing.board.adoptStake', 'Adopt stake');
    var instantSale = T('landing.board.instantSale', 'Instant sale');
    if (listing.settlement === 'adopt_stake') return adoptStake;
    if (listing.settlement === 'program' || listing.settlement === 'instant') return instantSale;
    if (listing.settlement === 'legacy') return instantSale;
    return listing.offerType === 'adopt_stake'
      ? adoptStake
      : T('landing.board.openAsk', 'Open ask');
  }

  function stakeRowHtml(listing, index) {
    var isDemo = !!listing.demo;
    var price = formatPrice(listing.priceGrow);
    var delay = Math.min(index * 40, 320);
    var settle = settlementLabel(listing);
    var href = isDemo
      ? 'dnevnik/?mode=signup&type=grower'
      : 'dnevnik/?mode=signup&type=adopter';
    return (
      '<li class="stakes-row' +
      (isDemo ? ' stakes-row--demo' : '') +
      (index === 0 ? ' is-live' : '') +
      '" style="--row-delay:' +
      delay +
      'ms">' +
      '<span class="stakes-row-name">' +
      esc(listing.name || listing.strain || 'RWA') +
      (isDemo ? ' <em class="stakes-demo-pill">sample</em>' : '') +
      '</span>' +
      '<span class="stakes-row-settle">' +
      esc(settle) +
      '</span>' +
      '<span class="stakes-row-price">' +
      esc(price) +
      ' <small>$GROWTOO</small></span>' +
      '<a class="stakes-row-link" href="' +
      href +
      '">' +
      (isDemo ? T('landing.board.listCta', 'List →') : T('landing.board.adoptCta', 'Adopt →')) +
      '</a>' +
      '</li>'
    );
  }

  function renderStakesBars(stakedList) {
    var el = document.getElementById('stakes-bars');
    if (!el) return;
    if (!stakedList.length) {
      el.innerHTML =
        '<p class="stakes-bars-empty">' +
      esc(
        T(
          'landing.board.noStakes',
          'No settled stakes yet. When adopters back a plant, bars appear here.'
        )
      ) +
      '</p>';
      return;
    }
    var max = Math.max.apply(
      null,
      stakedList.map(function (l) {
        return Number(l.priceGrow || 0);
      }).concat([1])
    );
    el.innerHTML = stakedList
      .slice(0, 5)
      .map(function (listing, i) {
        var price = Number(listing.priceGrow || 0);
        var pct = Math.max(8, Math.round((price / max) * 100));
        return (
          '<div class="stakes-bar-row" style="--bar-delay:' +
          Math.min(i * 50, 400) +
          'ms">' +
          '<span class="stakes-bar-label">' +
          esc(listing.name || T('landing.board.stake', 'Stake')) +
          '</span>' +
          '<span class="stakes-bar-track"><span class="stakes-bar-fill" style="width:' +
          pct +
          '%"></span></span>' +
          '<span class="stakes-bar-val">' +
          esc(formatPrice(price)) +
          '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  function setKpiReady(el, text) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('stakes-kpi-value--pending');
    el.removeAttribute('aria-label');
  }

  function renderStakesDesk(openListings, allListings, opts) {
    var desk = document.getElementById('stakes-desk');
    if (!desk) return;
    var isDemo = !!(opts && opts.demo);
    var all = allListings || openListings || [];
    var open = (openListings || []).filter(function (l) {
      return ASK_STATUSES[l.status] || l.demo;
    });
    var staked = all.filter(function (l) {
      return STAKED_STATUSES[l.status];
    });

    desk.dataset.state = isDemo ? 'demo' : 'live';
    desk.setAttribute('aria-busy', 'false');
    desk.classList.toggle('stakes-desk--demo', isDemo);

    var openList = document.getElementById('stakes-open-list');
    var openEmpty = document.getElementById('stakes-open-empty');
    var openMeta = document.getElementById('stakes-open-meta');
    var openSkeleton = document.getElementById('stakes-open-skeleton');
    if (openList) {
      openList.innerHTML = open.slice(0, 5).map(stakeRowHtml).join('');
      openList.hidden = open.length === 0;
    }
    if (openSkeleton) openSkeleton.hidden = true;
    if (openEmpty) openEmpty.hidden = open.length > 0;
    if (openMeta) {
      openMeta.textContent = isDemo
        ? T('landing.board.sampleDepth', 'Sample depth · not live asks')
        : open.length
          ? T('landing.board.openOffers', '{count} open offers', { count: open.length })
          : T('landing.board.clear', 'Board clear');
    }

    var askVolume = sumPrice(
      all.filter(function (l) {
        return ASK_STATUSES[l.status];
      })
    );
    var stakedValue = sumPrice(staked);
    var total = askVolume + stakedValue || 1;
    var stakedPct = Math.round((stakedValue / total) * 100);
    var openPct = Math.max(0, 100 - stakedPct);

    setKpiReady(document.getElementById('stakes-kpi-count'), String(staked.length));
    setKpiReady(document.getElementById('stakes-kpi-value'), formatPrice(stakedValue));
    setKpiReady(document.getElementById('stakes-kpi-open'), formatPrice(askVolume));

    var mixTrack = document.querySelector('#stakes-desk .stakes-mix-track');
    if (mixTrack) mixTrack.classList.remove('stakes-mix-track--pending');
    var bars = document.getElementById('stakes-bars');
    if (bars) bars.classList.remove('stakes-bars--pending');

    var mixStaked = document.getElementById('stakes-mix-staked');
    var mixOpen = document.getElementById('stakes-mix-open');
    if (mixStaked) mixStaked.style.width = stakedPct + '%';
    if (mixOpen) mixOpen.style.width = openPct + '%';

    renderStakesBars(staked);

    var updated = document.getElementById('stakes-updated');
    if (updated) {
      updated.textContent = isDemo
        ? T('landing.board.previewMix', 'Preview mix · seed the board from Tokenise + Market')
        : T('landing.board.lastPrintNet', 'Last print {time} · test network', {
            time: formatClock(new Date()),
          });
    }
  }

  function clearSkeletons() {
    document.querySelectorAll('.market-stat-skeleton').forEach(function (el) {
      el.classList.remove('market-stat-skeleton');
    });
    var board = document.getElementById('landing-market-board');
    if (board) board.classList.remove('market-board--loading');
  }

  function updateStats(openListings, allListings, isDemo) {
    clearSkeletons();
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
        T('landing.board.contracts', '{count} contracts', { count: stakedList.length });
    }
    if (stakedValueEl) stakedValueEl.textContent = formatPrice(stakedValue) + ' $GROWTOO';
    if (totalEl) totalEl.textContent = formatPrice(totalValue) + ' $GROWTOO';
    if (clockEl) {
      clockEl.textContent = isDemo
        ? T('landing.board.sampleDepth', 'Sample depth · not live asks')
        : T('landing.board.lastPrint', 'Last print {time}', { time: formatClock(new Date()) });
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
    var headline = document.getElementById('market-headline');
    var lead = document.getElementById('market-lead');
    var session = document.querySelector('#landing-market-board .market-stat-value--live');
    if (show) {
      if (headline) {
        headline.textContent = T(
          'landing.board.headlinePreview',
          'This is what trading will look like'
        );
      }
      if (lead) {
        lead.textContent = T(
          'landing.board.leadPreview',
          'The board is warming up — early contracts are being seeded now. Here\'s a preview of how Seed and Growth RWAs will trade once live.'
        );
      }
      if (session) session.textContent = 'PREVIEW';
    } else {
      if (headline) {
        headline.textContent = T('landing.board.headlineLive', 'Live contracts from real growers');
      }
      if (lead) {
        lead.textContent = T(
          'landing.board.leadLive',
          'Open Seed and growth contracts — seller-set asks in $GROWTOO, settled through marketplace escrow.'
        );
      }
      if (session) session.textContent = 'OPEN';
    }
  }

  function render(openListings, allListings, opts) {
    var grid = document.getElementById('landing-market-grid');
    var empty = document.getElementById('landing-market-empty');
    var loading = document.getElementById('landing-market-loading');
    var board = document.getElementById('landing-market-board');
    var isDemo = !!(opts && opts.demo);
    if (loading) loading.hidden = true;

    renderStakesDesk(openListings, allListings || openListings, opts);

    // Legacy full market board (optional — only if markup is present).
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
    if (clockEl) {
      clockEl.textContent = T('landing.board.offline', 'Feed offline · showing sample');
    }
    // i18n-ignore — console diagnostic.
    console.warn(msg || 'Could not load market offers.');
    showDemoTape();
  }

  function load() {
    if (!window.firebase || !firebase.firestore) {
      showError(T('landing.board.unavailable', 'Market temporarily unavailable.'));
      return;
    }

    firebase
      .firestore()
      .collection('marketPublicTape')
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
        showError(T('landing.board.loadFailed', 'Could not load market offers. Try again later.'));
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
