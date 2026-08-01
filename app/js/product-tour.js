/*
 * Spotlight product tour — game-style coach (dim rest, highlight one target).
 * Adopter script first; grower script can reuse the same engine later.
 */
(function () {
  'use strict';

  var STORAGE_PREFIX = 'growtoo-tour:';
  var ROOT_ID = 'product-tour-root';
  var active = null;
  var resizeTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function currentUid() {
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.uid || '';
      }
    } catch (_) {
      /* ignore */
    }
    try {
      var raw = localStorage.getItem('dnevnik-live-auth');
      var auth = raw ? JSON.parse(raw) : null;
      return (auth && auth.uid) || '';
    } catch (_) {
      return '';
    }
  }

  function isAdopter() {
    return document.body.classList.contains('profile-adopter');
  }

  function storageKey(role, uid) {
    return STORAGE_PREFIX + (uid || 'anon') + ':' + (role || 'adopter');
  }

  function readState(role, uid) {
    try {
      var raw = localStorage.getItem(storageKey(role, uid));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeState(role, uid, patch) {
    var prev = readState(role, uid) || {};
    var next = Object.assign({}, prev, patch || {}, {
      updatedAt: new Date().toISOString(),
    });
    try {
      localStorage.setItem(storageKey(role, uid), JSON.stringify(next));
    } catch (_) {
      /* ignore */
    }
    return next;
  }

  function goView(view) {
    if (typeof window.showAppView === 'function') {
      window.showAppView(view);
      return;
    }
    var nav = document.querySelector('.nav-item[data-view="' + view + '"]');
    if (nav) nav.click();
  }

  function pickTarget(selectors) {
    var list = Array.isArray(selectors) ? selectors : [selectors];
    for (var i = 0; i < list.length; i++) {
      var sel = list[i];
      if (!sel) continue;
      var el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) continue;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) continue;
      return el;
    }
    return null;
  }

  function adopterSteps() {
    return [
      {
        id: 'start-strip',
        view: null,
        selectors: ['#daily-start-strip', '#btn-account'],
        title: 'Start here',
        body: 'After you sign in, this strip is your short path: faucet, market, then garden.',
      },
      {
        id: 'faucet',
        view: 'market',
        selectors: ['#test-faucet-panel', '#market-adopter-guide'],
        title: 'Claim test $GROWTOO',
        body: 'Use the free Devnet faucet once a day. These tokens have no monetary value — they only practice investing.',
      },
      {
        id: 'market-board',
        view: 'market',
        selectors: ['#market-grid', '#market-adopter-guide', '#view-market'],
        title: 'Browse live asks',
        body: 'Open offers from growers show plant · stage · ask. Tap Invest when you’re ready (wallet may prompt).',
      },
      {
        id: 'garden-nav',
        view: null,
        selectors: [
          '.bottom-nav .nav-item[data-view="adopt"]',
          '.sidebar-nav .nav-item[data-view="adopt"]',
        ],
        title: 'My garden',
        body: 'After a stake settles, follow the plant here — stage progress and care unlock live on the card.',
      },
      {
        id: 'garden-board',
        view: 'adopt',
        selectors: ['#adopter-summary', '#adopt-token-grid', '#adopt-market-cta'],
        title: 'Track what you backed',
        body: 'Adopted plants and balances show up in My garden. You’re done with the tour — explore at your pace.',
      },
    ];
  }

  function ensureRoot() {
    var root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'product-tour-root';
    root.hidden = true;
    root.innerHTML =
      '<div class="product-tour-spotlight" id="product-tour-spotlight" aria-hidden="true"></div>' +
      '<div class="product-tour-card" role="dialog" aria-modal="true" aria-labelledby="product-tour-title">' +
      '<p class="product-tour-step" id="product-tour-step"></p>' +
      '<h2 class="product-tour-title" id="product-tour-title"></h2>' +
      '<p class="product-tour-body" id="product-tour-body"></p>' +
      '<div class="product-tour-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="product-tour-skip">Skip tour</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="product-tour-back" hidden>Back</button>' +
      '<button type="button" class="btn btn-primary btn-sm" id="product-tour-next">Next</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);

    document.getElementById('product-tour-skip').addEventListener('click', function () {
      finish({ skipped: true });
    });
    document.getElementById('product-tour-back').addEventListener('click', function () {
      if (!active) return;
      goTo(Math.max(0, active.index - 1));
    });
    document.getElementById('product-tour-next').addEventListener('click', function () {
      if (!active) return;
      if (active.index >= active.steps.length - 1) finish({ done: true });
      else goTo(active.index + 1);
    });
    document.addEventListener('keydown', function (e) {
      if (!active || e.key !== 'Escape') return;
      finish({ skipped: true });
    });
    window.addEventListener(
      'resize',
      function () {
        if (!active) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          positionUi();
        }, 80);
      },
      { passive: true }
    );
    window.addEventListener(
      'scroll',
      function () {
        if (!active) return;
        positionUi();
      },
      true
    );
    return root;
  }

  function clearHighlight() {
    document.querySelectorAll('.product-tour-target').forEach(function (el) {
      el.classList.remove('product-tour-target');
    });
  }

  function positionUi() {
    if (!active) return;
    var step = active.steps[active.index];
    if (!step) return;
    var target = pickTarget(step.selectors);
    var spot = document.getElementById('product-tour-spotlight');
    var card = document.querySelector('#' + ROOT_ID + ' .product-tour-card');
    if (!spot || !card) return;

    clearHighlight();
    if (!target) {
      spot.hidden = true;
      card.style.top = '20%';
      card.style.left = '50%';
      card.style.transform = 'translate(-50%, 0)';
      return;
    }

    target.classList.add('product-tour-target');
    try {
      target.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' });
    } catch (_) {
      /* ignore */
    }

    var pad = 8;
    var rect = target.getBoundingClientRect();
    spot.hidden = false;
    spot.style.top = Math.max(8, rect.top - pad) + 'px';
    spot.style.left = Math.max(8, rect.left - pad) + 'px';
    spot.style.width = Math.min(window.innerWidth - 16, rect.width + pad * 2) + 'px';
    spot.style.height = Math.min(window.innerHeight - 16, rect.height + pad * 2) + 'px';

    var cardW = Math.min(340, window.innerWidth - 24);
    var preferBelow = rect.bottom + 16 + 200 < window.innerHeight;
    var top = preferBelow ? rect.bottom + 14 : Math.max(12, rect.top - 14 - 180);
    var left = Math.min(
      window.innerWidth - cardW - 12,
      Math.max(12, rect.left + rect.width / 2 - cardW / 2)
    );
    card.style.width = cardW + 'px';
    card.style.top = top + 'px';
    card.style.left = left + 'px';
    card.style.transform = 'none';
  }

  function renderStep() {
    if (!active) return;
    var step = active.steps[active.index];
    var total = active.steps.length;
    var root = ensureRoot();
    root.hidden = false;
    document.body.classList.add('product-tour-open');

    document.getElementById('product-tour-step').textContent =
      'Step ' + (active.index + 1) + ' / ' + total;
    document.getElementById('product-tour-title').textContent = step.title || '';
    document.getElementById('product-tour-body').textContent = step.body || '';
    var back = document.getElementById('product-tour-back');
    var next = document.getElementById('product-tour-next');
    back.hidden = active.index === 0;
    next.textContent = active.index >= total - 1 ? 'Finish' : 'Next';

    writeState(active.role, active.uid, {
      step: active.index,
      role: active.role,
      inProgress: true,
    });

    var run = function () {
      positionUi();
      // Second pass after scroll/layout.
      setTimeout(positionUi, 280);
    };

    if (step.view) {
      goView(step.view);
      setTimeout(run, 120);
    } else {
      run();
    }
  }

  function goTo(index) {
    if (!active) return;
    active.index = Math.max(0, Math.min(active.steps.length - 1, index));
    renderStep();
  }

  function finish(opts) {
    opts = opts || {};
    if (!active) return;
    var role = active.role;
    var uid = active.uid;
    clearHighlight();
    var root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    document.body.classList.remove('product-tour-open');
    writeState(role, uid, {
      done: !!opts.done,
      skipped: !!opts.skipped,
      inProgress: false,
      completedAt: new Date().toISOString(),
    });
    active = null;
  }

  function start(opts) {
    opts = opts || {};
    var role = opts.role || (isAdopter() ? 'adopter' : 'grower');
    if (role !== 'adopter') {
      console.info('ProductTour: grower script not shipped yet');
      return false;
    }
    if (active) finish({ skipped: true });

    // Close competing sheets.
    try {
      if (window.DailyStatus && typeof DailyStatus.hide === 'function') DailyStatus.hide();
    } catch (_) {
      /* ignore */
    }
    try {
      var more = document.getElementById('more-nav-overlay');
      if (more) more.hidden = true;
      document.body.classList.remove('more-nav-open', 'daily-status-open');
    } catch (_) {
      /* ignore */
    }

    var uid = opts.uid || currentUid();
    var steps = adopterSteps();
    active = {
      role: role,
      uid: uid,
      steps: steps,
      index: Math.max(0, Number(opts.startIndex) || 0),
    };
    ensureRoot();
    renderStep();
    return true;
  }

  function hasCompleted(role, uid) {
    var state = readState(role, uid || currentUid());
    return !!(state && (state.done || state.skipped));
  }

  /** After daily-status (or if it didn’t show): start adopter tour once. */
  function maybeStartAfterDailyStatus(opts) {
    opts = opts || {};
    var role =
      opts.profileType === 'adopter' || opts.role === 'adopter' || isAdopter()
        ? 'adopter'
        : 'grower';
    if (role !== 'adopter') return;
    if (!isAdopter()) return;
    var uid = opts.uid || currentUid();
    if (hasCompleted('adopter', uid)) return;
    // Small delay so daily-status close animation finishes.
    setTimeout(function () {
      if (hasCompleted('adopter', uid)) return;
      if (document.body.classList.contains('daily-status-open')) return;
      start({ role: 'adopter', uid: uid });
    }, 450);
  }

  function replayAdopter() {
    var uid = currentUid();
    writeState('adopter', uid, { done: false, skipped: false, inProgress: false, step: 0 });
    return start({ role: 'adopter', uid: uid, startIndex: 0 });
  }

  window.ProductTour = {
    start: start,
    stop: function () {
      finish({ skipped: true });
    },
    replayAdopter: replayAdopter,
    maybeStartAfterDailyStatus: maybeStartAfterDailyStatus,
    hasCompleted: hasCompleted,
    isActive: function () {
      return !!active;
    },
  };
})();
