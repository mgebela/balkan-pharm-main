/*
 * Spotlight product tour — game-style coach (dim rest, highlight one target).
 * Scripts: adopter-full · grower-full · plants · adopt · market (role-aware tabs).
 */
(function () {
  'use strict';

  var STORAGE_PREFIX = 'growtoo-tour:';
  var ROOT_ID = 'product-tour-root';
  var active = null;
  var resizeTimer = null;

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

  function isGrower() {
    return !isAdopter();
  }

  function isChainUnlocked() {
    // Pure growers hide Tokenise/Market until they opt in (body.chain-locked).
    return !document.body.classList.contains('chain-locked');
  }

  function storageKey(scriptId, uid) {
    return STORAGE_PREFIX + (uid || 'anon') + ':' + (scriptId || 'full');
  }

  function readState(scriptId, uid) {
    try {
      var raw = localStorage.getItem(storageKey(scriptId, uid));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeState(scriptId, uid, patch) {
    var prev = readState(scriptId, uid) || {};
    var next = Object.assign({}, prev, patch || {}, {
      updatedAt: new Date().toISOString(),
    });
    try {
      localStorage.setItem(storageKey(scriptId, uid), JSON.stringify(next));
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

  function isEffectivelyVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var node = el;
    while (node && node.nodeType === 1) {
      var style = window.getComputedStyle(node);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      node = node.parentElement;
    }
    var rect = el.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  }

  function pickTarget(selectors) {
    var list = Array.isArray(selectors) ? selectors : [selectors];
    for (var i = 0; i < list.length; i++) {
      var sel = list[i];
      if (!sel) continue;
      var el = null;
      if (typeof sel === 'function') {
        try {
          el = sel();
        } catch (_) {
          el = null;
        }
      } else if (typeof sel === 'string') {
        el = document.querySelector(sel);
      } else {
        el = sel;
      }
      if (!el || !isEffectivelyVisible(el)) continue;
      return el;
    }
    return null;
  }

  /** Prefer the on-screen nav control whose visible label matches (Journal ≠ Plants). */
  /**
   * Find a visible nav item by its view.
   *
   * This used to match on the label text ("Journal"), which stopped working
   * the moment the nav was translated — "Dnevnik" is not "journal". data-view
   * is the same in every language, so the tour points at the right thing
   * whatever the reader's language is.
   */
  function pickNavByView(view) {
    var nodes = document.querySelectorAll(
      '.bottom-nav .nav-item[data-view="' + view + '"], ' +
        '.sidebar-nav .nav-item[data-view="' + view + '"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      if (isEffectivelyVisible(nodes[i])) return nodes[i];
    }
    return null;
  }

  /* ── Step libraries ───────────────────────────────────────────── */

  function adopterFullSteps() {
    return [
      {
        id: 'start-strip',
        view: null,
        selectors: ['#daily-start-strip', '#btn-account'],
        title: T('app.tour.adopterFull.start_strip.title', 'Start here'),
        body: T('app.tour.adopterFull.start_strip.body', 'After you sign in, this strip is your short path: faucet, market, then garden.'),
      },
      {
        id: 'faucet',
        view: 'market',
        selectors: ['#test-faucet-panel', '#market-adopter-guide'],
        title: T('app.tour.adopterFull.faucet.title', 'Claim test $GROWTOO'),
        body: T('app.tour.adopterFull.faucet.body', 'Use the free Devnet faucet once a day. These tokens have no monetary value — they only practice investing.'),
      },
      {
        id: 'market-board',
        view: 'market',
        selectors: ['#market-grid', '#market-adopter-guide', '#view-market'],
        title: T('app.tour.adopterFull.market_board.title', 'Browse live asks'),
        body: T('app.tour.adopterFull.market_board.body', 'Open offers show plant · stage · ask. Tap Invest when you’re ready (wallet may prompt).'),
      },
      {
        id: 'garden-nav',
        view: null,
        selectors: [
          '.bottom-nav .nav-item[data-chain-nav]',
          '.sidebar-nav .nav-item[data-chain-nav]',
          '.chain-pane-toggle [data-chain-pane="adopt"]',
        ],
        title: T('app.tour.adopterFull.garden_nav.title', 'My garden'),
        body: T('app.tour.adopterFull.garden_nav.body', 'After a stake settles, follow the plant here — stage progress and care unlock live on the card.'),
      },
      {
        id: 'garden-board',
        view: 'adopt',
        selectors: ['#adopter-summary', '#adopt-token-grid', '#adopt-market-cta'],
        title: T('app.tour.adopterFull.garden_board.title', 'Track what you backed'),
        body: T('app.tour.adopterFull.garden_board.body', 'Adopted plants and balances show up in My garden. Explore at your pace — tap ? on a tab anytime for a shorter tour.'),
      },
    ];
  }

  function growerFullSteps() {
    var steps = [
      {
        id: 'start-strip',
        view: null,
        selectors: ['#daily-start-strip', '#btn-account'],
        title: T('app.tour.growerFull.start_strip.title', 'Start here'),
        body: T('app.tour.growerFull.start_strip.body', 'Your grower path: log care in the journal first. Tokenise and Market are optional when you want them.'),
      },
      {
        id: 'journal-nav',
        view: 'plants',
        selectors: [
          function () {
      return pickNavByView('plants');
          },
          '.bottom-nav .nav-item[data-view="plants"]',
          '.sidebar-nav .nav-item[data-view="plants"]',
        ],
        title: T('app.tour.growerFull.journal_nav.title', 'Journal'),
        body: T('app.tour.growerFull.journal_nav.body', 'This is home — your plants, Today, and the care diary (list or month). Log watering here.'),
      },
      {
        id: 'plants-list',
        view: 'plants',
        selectors: ['#btn-add-plant', '#plants-list', '#view-plants'],
        title: T('app.tour.growerFull.plants_list.title', 'Add a plant'),
        body: T('app.tour.growerFull.plants_list.body', 'Create a plant, then log watering, feeding, and stage changes — that trail unlocks Tokenise later.'),
      },
      {
        id: 'journal-log',
        view: 'plants',
        selectors: ['#btn-add-entry', '#journal-entries', '.plants-journal-diary'],
        title: T('app.tour.growerFull.journal_log.title', 'Log care'),
        body: T('app.tour.growerFull.journal_log.body', 'New entries prove real work. Quests on Tokenise look for stage, water, and feed logs.'),
      },
    ];

    if (isChainUnlocked()) {
      steps.push(
        {
          id: 'tokenise-nav',
          view: null,
          selectors: [
            '.bottom-nav .nav-item[data-chain-nav]',
            '.sidebar-nav .nav-item[data-chain-nav]',
            '.chain-pane-toggle [data-chain-pane="adopt"]',
          ],
          title: T('app.tour.growerFull.tokenise_nav.title', 'Tokenise'),
          body: T('app.tour.growerFull.tokenise_nav.body', 'When the journal is ready, seal a stage into a plant token on Devnet.'),
        },
        {
          id: 'seal-stage',
          view: 'adopt',
          selectors: ['#adopt-seed-section', '#adopt-growth-guide', '#adopt-token-grid'],
          title: T('app.tour.growerFull.seal_stage.title', 'Seal a stage'),
          body: T('app.tour.growerFull.seal_stage.body', 'Pick a journal plant and seal the next stage. The mint queue mints / updates the NFT on Devnet.'),
        },
        {
          id: 'market-nav',
          view: null,
          selectors: [
            '.bottom-nav .nav-item[data-chain-nav]',
            '.sidebar-nav .nav-item[data-chain-nav]',
          ],
          title: T('app.tour.growerFull.market_nav.title', 'Market'),
          body: T('app.tour.growerFull.market_nav.body', 'Post a sealed plant as an ask — Instant sale or Adopt stake — for adopters to back with $GROWTOO.'),
        },
        {
          id: 'market-list',
          view: 'market',
          selectors: ['#market-list-section', '#market-mine-grid', '#market-grid'],
          title: T('app.tour.growerFull.market_list.title', 'List an offer'),
          body: T('app.tour.growerFull.market_list.body', 'Choose the sealed plant, set price and offer type, then post. Your offers appear under My offers.'),
        }
      );
    } else {
      steps.push({
        id: 'chain-optional',
        view: null,
        selectors: ['#btn-account'],
        title: T('app.tour.growerFull.chain_optional.title', 'Tokenise stays optional'),
        body: T('app.tour.growerFull.chain_optional.body', 'Seal-on-chain and Market stay out of the nav until you unlock them from Profile. The free journal works without a wallet.'),
      });
    }

    return steps;
  }

  function plantsTabSteps() {
    return [
      {
        id: 'plants-heading',
        view: 'plants',
        selectors: ['#plants-list', '#btn-add-plant', '#view-plants .plants-journal-section'],
        title: T('app.tour.plants.plants_heading.title', 'Your plants'),
        body: T('app.tour.plants.plants_heading.body', 'Each plant is a living record. Start with + New plant if the list is empty.'),
      },
      {
        id: 'add-plant',
        view: 'plants',
        selectors: ['#btn-add-plant'],
        title: T('app.tour.plants.add_plant.title', 'New plant'),
        body: T('app.tour.plants.add_plant.body', 'Name, strain, and stage kick off the journal. You can change stage as the grow advances.'),
      },
      {
        id: 'journal',
        view: 'plants',
        selectors: ['#btn-add-entry', '#journal-entries', '.plants-journal-diary'],
        title: T('app.tour.plants.journal.title', 'Care journal'),
        body: T('app.tour.plants.journal.body', 'Log watering, feeding, and stage notes. Tokenise quests read this trail before sealing.'),
      },
      {
        id: 'weather',
        view: 'plants',
        selectors: ['#plants-weather-widget'],
        title: T('app.tour.plants.weather.title', 'Weather (optional)'),
        body: T('app.tour.plants.weather.body', 'Set a city for a 7-day forecast — handy for outdoor planning. Skip if you grow indoors.'),
      },
    ];
  }

  function adoptTabStepsGrower() {
    return [
      {
        id: 'seal',
        view: 'adopt',
        selectors: ['#adopt-seed-section', '#adopt-growth-guide'],
        title: T('app.tour.adoptGrower.seal.title', 'Seal a stage'),
        body: T('app.tour.adoptGrower.seal.body', 'Link a journal plant and seal the current stage. Completing grower quests unlocks the mint button.'),
      },
      {
        id: 'trail',
        view: 'adopt',
        selectors: ['#adopt-growth-guide', '#adopt-seed-section'],
        title: T('app.tour.adoptGrower.trail.title', 'The trail ahead'),
        body: T('app.tour.adoptGrower.trail.body', 'Stages from seed → harvest each mint a reward on Devnet when you seal them.'),
      },
      {
        id: 'sealed',
        view: 'adopt',
        selectors: ['#adopt-token-grid', '#adopt-garden-section'],
        title: T('app.tour.adoptGrower.sealed.title', 'Sealed plants'),
        body: T('app.tour.adoptGrower.sealed.body', 'Your tokens land here. When one is ready, list it on Market.'),
      },
    ];
  }

  function adoptTabStepsAdopter() {
    return [
      {
        id: 'guide',
        view: 'adopt',
        selectors: ['#adopter-guide', '#adopter-summary', '#adopt-garden-section'],
        title: T('app.tour.adoptAdopter.guide.title', 'My garden'),
        body: T('app.tour.adoptAdopter.guide.body', 'Adopted plants and stake progress live here after Market invest settles.'),
      },
      {
        id: 'summary',
        view: 'adopt',
        selectors: ['#adopter-summary', '#adopt-token-grid'],
        title: T('app.tour.adoptAdopter.summary.title', 'Balances'),
        body: T('app.tour.adoptAdopter.summary.body', 'See how many plants you’ve adopted and your test $GROWTOO balance.'),
      },
      {
        id: 'cards',
        view: 'adopt',
        selectors: ['#adopt-token-grid', '#adopt-market-cta'],
        title: T('app.tour.adoptAdopter.cards.title', 'Plant cards'),
        body: T('app.tour.adoptAdopter.cards.body', 'Open a card for stage, care unlock, and history. Browse Market if the garden is empty.'),
      },
    ];
  }

  function marketTabStepsGrower() {
    return [
      {
        id: 'list-form',
        view: 'market',
        selectors: ['#market-list-section', '#market-list-form'],
        title: T('app.tour.marketGrower.list_form.title', 'Post an ask'),
        body: T('app.tour.marketGrower.list_form.body', 'Pick a sealed plant, choose Instant sale or Adopt stake, set the $GROWTOO price, then post.'),
      },
      {
        id: 'offer-type',
        view: 'market',
        selectors: ['.market-offer-compare', '#market-list-section'],
        title: T('app.tour.marketGrower.offer_type.title', 'Offer types'),
        body: T('app.tour.marketGrower.offer_type.body', 'Instant sale pays you in full at purchase. Adopt stake: half now, half after care months qualify.'),
      },
      {
        id: 'my-offers',
        view: 'market',
        selectors: ['#market-mine-grid'],
        title: T('app.tour.marketGrower.my_offers.title', 'My offers'),
        body: T('app.tour.marketGrower.my_offers.body', 'Track active, adopted, and cancelled listings here — including harvest claim when ready.'),
      },
      {
        id: 'open-board',
        view: 'market',
        selectors: ['#market-grid'],
        title: T('app.tour.marketGrower.open_board.title', 'Open market'),
        body: T('app.tour.marketGrower.open_board.body', 'Other growers’ live asks. Useful to see how the board looks to adopters.'),
      },
    ];
  }

  function marketTabStepsAdopter() {
    return [
      {
        id: 'faucet',
        view: 'market',
        selectors: ['#test-faucet-panel', '#market-adopter-guide'],
        title: T('app.tour.marketAdopter.faucet.title', 'Test faucet'),
        body: T('app.tour.marketAdopter.faucet.body', 'Claim free Devnet $GROWTOO once a day before you invest.'),
      },
      {
        id: 'guide',
        view: 'market',
        selectors: ['#market-adopter-guide'],
        title: T('app.tour.marketAdopter.guide.title', 'How adopting works'),
        body: T('app.tour.marketAdopter.guide.body', 'Instant sale vs Adopt stake, then follow the plant in My garden after settle.'),
      },
      {
        id: 'board',
        view: 'market',
        selectors: ['#market-grid'],
        title: T('app.tour.marketAdopter.board.title', 'Live asks'),
        body: T('app.tour.marketAdopter.board.body', 'Tap Invest on a card. Connect a Devnet wallet when prompted.'),
      },
    ];
  }

  function resolveScript(scriptId) {
    var id = String(scriptId || '').trim();
    if (id === 'adopter-full' || (id === 'full' && isAdopter())) {
      return { id: 'adopter-full', steps: adopterFullSteps(), role: 'adopter' };
    }
    if (id === 'grower-full' || (id === 'full' && isGrower())) {
      return { id: 'grower-full', steps: growerFullSteps(), role: 'grower' };
    }
    if (id === 'plants') {
      return { id: 'plants', steps: plantsTabSteps(), role: 'grower' };
    }
    if (id === 'adopt') {
      return isAdopter()
        ? { id: 'adopt-adopter', steps: adoptTabStepsAdopter(), role: 'adopter' }
        : { id: 'adopt-grower', steps: adoptTabStepsGrower(), role: 'grower' };
    }
    if (id === 'market') {
      return isAdopter()
        ? { id: 'market-adopter', steps: marketTabStepsAdopter(), role: 'adopter' }
        : { id: 'market-grower', steps: marketTabStepsGrower(), role: 'grower' };
    }
    // Default full tour for current role
    return isAdopter()
      ? { id: 'adopter-full', steps: adopterFullSteps(), role: 'adopter' }
      : { id: 'grower-full', steps: growerFullSteps(), role: 'grower' };
  }

  /* ── Engine UI ────────────────────────────────────────────────── */

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
      '<button type="button" class="btn btn-ghost btn-sm" id="product-tour-skip"></button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="product-tour-back" hidden></button>' +
      '<button type="button" class="btn btn-primary btn-sm" id="product-tour-next"></button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);

    /* Labels are written as text, not interpolated into the markup above —
       this file has no escaping helper, and textContent needs none. */
    document.getElementById('product-tour-skip').textContent = T('app.tour.skip', 'Skip tour');
    document.getElementById('product-tour-back').textContent = T('app.tour.back', 'Back');
    document.getElementById('product-tour-next').textContent = T('app.tour.next', 'Next');

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
        resizeTimer = setTimeout(positionUi, 80);
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
      T('app.tour.stepCounter', 'Step {n} / {total}', {
        n: active.index + 1,
        total: total,
      });
    document.getElementById('product-tour-title').textContent = step.title || '';
    document.getElementById('product-tour-body').textContent = step.body || '';
    var back = document.getElementById('product-tour-back');
    var next = document.getElementById('product-tour-next');
    back.hidden = active.index === 0;
    next.textContent =
      active.index >= total - 1 ? T('app.tour.finish', 'Finish') : T('app.tour.next', 'Next');

    writeState(active.scriptId, active.uid, {
      step: active.index,
      scriptId: active.scriptId,
      inProgress: true,
    });

    var run = function () {
      positionUi();
      setTimeout(positionUi, 280);
    };

    if (step.view) {
      goView(step.view);
      setTimeout(run, 140);
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
    var scriptId = active.scriptId;
    var uid = active.uid;
    clearHighlight();
    var root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    document.body.classList.remove('product-tour-open');
    writeState(scriptId, uid, {
      done: !!opts.done,
      skipped: !!opts.skipped,
      inProgress: false,
      completedAt: new Date().toISOString(),
    });
    active = null;
  }

  function closeChrome() {
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
  }

  function start(opts) {
    opts = opts || {};
    var resolved = resolveScript(opts.script || opts.role || 'full');
    if (!resolved.steps.length) return false;

    // Role guard for grower-only plants tab
    if (resolved.id === 'plants' && isAdopter()) return false;

    if (active) finish({ skipped: true });
    closeChrome();

    var uid = opts.uid || currentUid();
    active = {
      scriptId: resolved.id,
      role: resolved.role,
      uid: uid,
      steps: resolved.steps,
      index: Math.max(0, Number(opts.startIndex) || 0),
    };
    ensureRoot();
    renderStep();
    return true;
  }

  function hasCompleted(scriptId, uid) {
    var state = readState(scriptId, uid || currentUid());
    return !!(state && (state.done || state.skipped));
  }

  function fullScriptId() {
    return isAdopter() ? 'adopter-full' : 'grower-full';
  }

  /** After daily-status: start the role’s full tour once. */
  function maybeStartAfterDailyStatus(opts) {
    opts = opts || {};
    var uid = opts.uid || currentUid();
    var scriptId =
      opts.profileType === 'adopter' || opts.role === 'adopter' || isAdopter()
        ? 'adopter-full'
        : 'grower-full';
    if (scriptId === 'adopter-full' && !isAdopter()) return;
    if (scriptId === 'grower-full' && isAdopter()) return;
    if (hasCompleted(scriptId, uid)) return;
    setTimeout(function () {
      if (hasCompleted(scriptId, uid)) return;
      if (document.body.classList.contains('daily-status-open')) return;
      if (document.body.classList.contains('reward-earn-open')) return;
      start({ script: scriptId, uid: uid });
    }, 450);
  }

  function replayFull() {
    var uid = currentUid();
    var scriptId = fullScriptId();
    writeState(scriptId, uid, { done: false, skipped: false, inProgress: false, step: 0 });
    return start({ script: scriptId, uid: uid, startIndex: 0 });
  }

  function startTab(tab) {
    return start({ script: tab });
  }

  function bindHelpButtons() {
    if (document.body.dataset.tourHelpBound === '1') return;
    document.body.dataset.tourHelpBound = '1';
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tour-script]');
      if (!btn) return;
      e.preventDefault();
      var script = btn.getAttribute('data-tour-script') || '';
      start({ script: script });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindHelpButtons);
  } else {
    bindHelpButtons();
  }

  window.ProductTour = {
    start: start,
    startTab: startTab,
    stop: function () {
      finish({ skipped: true });
    },
    replayFull: replayFull,
    replayAdopter: function () {
      // Back-compat
      if (!isAdopter()) return false;
      return replayFull();
    },
    replayGrower: function () {
      if (isAdopter()) return false;
      return replayFull();
    },
    maybeStartAfterDailyStatus: maybeStartAfterDailyStatus,
    hasCompleted: hasCompleted,
    isActive: function () {
      return !!active;
    },
  };
})();
