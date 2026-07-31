/*
 * Role-first start strip + idle-game "while you were away" daily status popup.
 * Compares inbox / journal / market / XP against last-seen (or previous login).
 */
(function () {
  'use strict';

  const LAST_SEEN_PREFIX = 'dnevnik-live-status-last-seen:';
  const PREV_LOGIN_PREFIX = 'dnevnik-live-prev-login-at:';
  const SESSION_SHOWN = 'dnevnik-live-status-shown:';
  const MIN_AWAY_MS = 30 * 60 * 1000; // skip popup if back within 30m
  const SETTLE_MS = 700;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isAdopter() {
    return document.body.classList.contains('profile-adopter');
  }

  function currentUid() {
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.uid;
      }
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  function lastSeenKey(uid, adopter) {
    return LAST_SEEN_PREFIX + uid + ':' + (adopter ? 'adopter' : 'grower');
  }

  function readLastSeen(uid, adopter) {
    if (!uid) return null;
    try {
      const raw =
        localStorage.getItem(lastSeenKey(uid, adopter)) ||
        // Legacy unscoped key (grower-era installs)
        (!adopter ? localStorage.getItem(LAST_SEEN_PREFIX + uid) : null);
      if (!raw) return null;
      const ms = Date.parse(raw);
      return Number.isFinite(ms) ? ms : null;
    } catch (_) {
      return null;
    }
  }

  function writeLastSeen(uid, when, adopter) {
    if (!uid) return;
    try {
      localStorage.setItem(
        lastSeenKey(uid, adopter),
        new Date(when || Date.now()).toISOString()
      );
    } catch (_) {
      /* ignore */
    }
  }

  function readPrevLoginMs(uid) {
    if (!uid) return null;
    try {
      const raw = sessionStorage.getItem(PREV_LOGIN_PREFIX + uid);
      if (!raw) return null;
      const ms = Date.parse(raw);
      return Number.isFinite(ms) ? ms : null;
    } catch (_) {
      return null;
    }
  }

  function resolveSinceMs(uid, adopter) {
    const lastSeen = readLastSeen(uid, adopter);
    if (lastSeen) return lastSeen;
    // Previous login is shared across roles — skip for brand-new adopter sessions
    // so switching grower → adopter still gets a welcome / while-away sheet.
    if (!adopter) {
      const prev = readPrevLoginMs(uid);
      if (prev) return prev;
    }
    return null;
  }

  function formatAway(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'a short while';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return mins <= 1 ? 'about a minute' : mins + ' minutes';
    const hours = Math.round(mins / 60);
    if (hours < 36) return hours === 1 ? '1 hour' : hours + ' hours';
    const days = Math.round(hours / 24);
    return days === 1 ? '1 day' : days + ' days';
  }

  function parseTime(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const ms = Date.parse(String(v));
    return Number.isFinite(ms) ? ms : NaN;
  }

  function afterSince(ts, sinceMs) {
    if (sinceMs == null) return false;
    const t = parseTime(ts);
    return Number.isFinite(t) && t > sinceMs;
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function collectGains(uid, sinceMs, adopter) {
    const gains = [];
    if (sinceMs == null) return gains;

    // Inbox since last visit
    if (window.DnevnikNotifications && typeof DnevnikNotifications.getItems === 'function') {
      const notes = (DnevnikNotifications.getItems() || []).filter(function (n) {
        return afterSince(n.createdAt, sinceMs);
      });
      if (notes.length) {
        const unread = notes.filter(function (n) {
          return !n.read;
        }).length;
        gains.push({
          icon: '✦',
          text:
            notes.length === 1
              ? (notes[0].title || '1 inbox update')
              : notes.length +
                ' inbox updates' +
                (unread ? ' · ' + unread + ' unread' : ''),
          view: 'adopt',
        });
      }
    }

    if (adopter) {
      collectAdopterGains(uid, sinceMs, gains);
    } else {
      collectGrowerGains(uid, sinceMs, gains);
    }

    // Dedup by text, cap
    const seen = Object.create(null);
    return gains
      .filter(function (g) {
        const k = g.text;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      })
      .slice(0, 6);
  }

  function collectGrowerGains(uid, sinceMs, gains) {
    const entries = readJson('dnevnik-live-entries', []);
    if (Array.isArray(entries)) {
      const n = entries.filter(function (e) {
        return e && (afterSince(e.createdAt, sinceMs) || afterSince(e.date, sinceMs));
      }).length;
      if (n) {
        gains.push({
          icon: '§',
          text: n === 1 ? '1 journal log since last visit' : n + ' journal logs since last visit',
          view: 'plants',
        });
      }
    }

    const plants = readJson('dnevnik-live-plants', []);
    if (Array.isArray(plants)) {
      const staged = plants.filter(function (p) {
        if (!p) return false;
        if (afterSince(p.updatedAt, sinceMs)) return true;
        const hist = Array.isArray(p.stageHistory) ? p.stageHistory : [];
        return hist.some(function (h) {
          return h && afterSince(h.date || h.at, sinceMs);
        });
      }).length;
      if (staged) {
        gains.push({
          icon: '❧',
          text: staged === 1 ? '1 plant stage moved' : staged + ' plants updated',
          view: 'plants',
        });
      }
    }

    if (window.GrowerQuests && typeof GrowerQuests.getGrowerProfile === 'function') {
      const profile = GrowerQuests.getGrowerProfile() || {};
      const events = Array.isArray(profile.events) ? profile.events : [];
      let xpGain = 0;
      events.forEach(function (ev) {
        if (ev && afterSince(ev.at, sinceMs)) xpGain += Number(ev.amount || ev.xp || 0) || 0;
      });
      if (xpGain > 0) {
        const rank =
          typeof GrowerQuests.growerRankFromLocal === 'function'
            ? GrowerQuests.growerRankFromLocal()
            : null;
        gains.push({
          icon: '★',
          text:
            '+' +
            xpGain +
            ' grower XP' +
            (rank && rank.label ? ' · rank ' + rank.label : ''),
          view: 'adopt',
        });
      }
    }

    if (window.Market && typeof Market.getListings === 'function') {
      const listings = Market.getListings() || [];
      let newStakes = 0;
      let careTicks = 0;
      let harvestSettled = 0;
      listings.forEach(function (l) {
        if (!l || l.uid !== uid) return;
        if (
          l.settlement === 'adopt_stake' &&
          (afterSince(l.investedAt, sinceMs) || afterSince(l.soldAt, sinceMs))
        ) {
          newStakes += 1;
        }
        if (afterSince(l.careProgressUpdatedAt, sinceMs)) careTicks += 1;
        if (
          (l.careStatus === 'released' || l.careStatus === 'refunded') &&
          (afterSince(l.updatedAt, sinceMs) || afterSince(l.careProgressUpdatedAt, sinceMs))
        ) {
          harvestSettled += 1;
        }
      });
      if (newStakes) {
        gains.push({
          icon: '◎',
          text:
            newStakes === 1
              ? 'Someone adopted one of your plants'
              : newStakes + ' new adopt stakes on your offers',
          view: 'market',
        });
      }
      if (careTicks) {
        gains.push({
          icon: '◷',
          text:
            careTicks === 1
              ? 'Care progress synced on 1 stake'
              : 'Care progress synced on ' + careTicks + ' stakes',
          view: 'market',
        });
      }
      if (harvestSettled) {
        gains.push({
          icon: '✧',
          text:
            harvestSettled === 1
              ? '1 harvest stake settled'
              : harvestSettled + ' harvest stakes settled',
          view: 'market',
        });
      }
    }
  }

  function readGardenTokens() {
    try {
      if (window.PlantToken && typeof PlantToken.getWallet === 'function') {
        const w = PlantToken.getWallet();
        if (w && Array.isArray(w.tokens)) return w.tokens;
      }
    } catch (_) {
      /* ignore */
    }
    return [];
  }

  function collectAdopterGains(uid, sinceMs, gains) {
    const tokens = readGardenTokens();
    const listingIdsInGarden = Object.create(null);
    if (tokens.length) {
      let stageMoved = 0;
      tokens.forEach(function (t) {
        if (!t) return;
        if (t.listingId) listingIdsInGarden[t.listingId] = true;
        if (!t.adopted) return;
        if (afterSince(t.updatedAt, sinceMs) || afterSince(t.stageUpdatedAt, sinceMs)) {
          stageMoved += 1;
        }
      });
      if (stageMoved) {
        gains.push({
          icon: '❧',
          text:
            stageMoved === 1
              ? '1 adopted plant moved a stage'
              : stageMoved + ' adopted plants updated',
          view: 'adopt',
        });
      }
    }

    if (window.Market && typeof Market.getListings === 'function') {
      const listings = Market.getListings() || [];
      let myStakes = 0;
      let careTicks = 0;
      let harvestReady = 0;
      let openNew = 0;
      let newSettles = 0;
      listings.forEach(function (l) {
        if (!l) return;
        const isBuyer = l.buyerUid === uid || (!!l.id && !!listingIdsInGarden[l.id]);
        if (isBuyer && (l.settlement === 'adopt_stake' || l.status === 'sold' || l.status === 'settled')) {
          myStakes += 1;
          if (afterSince(l.careProgressUpdatedAt, sinceMs)) careTicks += 1;
          if (l.harvestReady === true) harvestReady += 1;
          if (afterSince(l.investedAt, sinceMs) || afterSince(l.soldAt, sinceMs)) {
            newSettles += 1;
          }
        }
        if (
          l.status === 'active' &&
          l.uid !== uid &&
          afterSince(l.createdAt, sinceMs)
        ) {
          openNew += 1;
        }
      });
      if (newSettles) {
        gains.push({
          icon: '◎',
          text:
            newSettles === 1
              ? '1 new stake landed in your garden'
              : newSettles + ' new stakes landed in your garden',
          view: 'adopt',
        });
      }
      if (careTicks) {
        gains.push({
          icon: '◷',
          text:
            careTicks === 1
              ? 'Care progressed on 1 of your stakes'
              : 'Care progressed on ' + careTicks + ' stakes',
          view: 'adopt',
        });
      }
      if (harvestReady && myStakes) {
        gains.push({
          icon: '✧',
          text: 'A stake is harvest-ready — grower can claim locked $GROWTOO',
          view: 'adopt',
        });
      }
      if (openNew) {
        gains.push({
          icon: '◇',
          text:
            openNew === 1
              ? '1 new offer on the market'
              : openNew + ' new offers on the market',
          view: 'market',
        });
      }
    }
  }

  function nextStep(adopter) {
    if (adopter) {
      const copy =
        window.GrowtooProfile && typeof GrowtooProfile.adopterIntentCopy === 'function'
          ? GrowtooProfile.adopterIntentCopy()
          : null;
      return {
        kicker: 'Start here',
        lead:
          (copy && (copy.strip || copy.hero)) ||
          'Claim test $GROWTOO, then invest in a live plant offer.',
        actions: [
          { id: 'daily-cta-faucet', label: 'Open faucet', view: 'market', primary: true },
          { id: 'daily-cta-market', label: 'Browse market', view: 'market' },
          { id: 'daily-cta-garden', label: 'My garden', view: 'adopt' },
        ],
      };
    }
    return {
      kicker: 'Start here',
      lead: 'Log care in the journal, seal a stage on Tokenise, then list it on Market.',
      actions: [
        { id: 'daily-cta-journal', label: 'Open journal', view: 'plants', primary: true },
        { id: 'daily-cta-tokenise', label: 'Tokenise', view: 'adopt' },
        { id: 'daily-cta-list', label: 'Market', view: 'market' },
      ],
    };
  }

  function goView(view) {
    if (typeof window.showAppView === 'function') {
      window.showAppView(view);
      return;
    }
    const nav = document.querySelector('.nav-item[data-view="' + view + '"]');
    if (nav) nav.click();
  }

  function renderStrip(adopter) {
    const strip = document.getElementById('daily-start-strip');
    const kicker = document.getElementById('daily-start-kicker');
    const lead = document.getElementById('daily-start-lead');
    const actions = document.getElementById('daily-start-actions');
    if (!strip || !actions) return;
    const step = nextStep(adopter);
    if (kicker) kicker.textContent = step.kicker;
    if (lead) lead.textContent = step.lead;
    actions.innerHTML = step.actions
      .map(function (a) {
        return (
          '<button type="button" class="btn ' +
          (a.primary ? 'btn-primary' : 'btn-ghost') +
          ' btn-sm daily-start-cta" data-view="' +
          esc(a.view) +
          '" id="' +
          esc(a.id) +
          '">' +
          esc(a.label) +
          '</button>'
        );
      })
      .join('');
    strip.hidden = false;
  }

  function bindStripOnce() {
    const strip = document.getElementById('daily-start-strip');
    if (!strip || strip.dataset.bound === '1') return;
    strip.dataset.bound = '1';
    strip.addEventListener('click', function (e) {
      const btn = e.target.closest('.daily-start-cta');
      if (!btn) return;
      const view = btn.getAttribute('data-view') || 'adopt';
      goView(view);
      if (btn.id === 'daily-cta-faucet') {
        requestAnimationFrame(function () {
          const panel = document.getElementById('test-faucet-panel');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
      if (btn.id === 'daily-cta-tokenise' || btn.id === 'daily-cta-journal') {
        requestAnimationFrame(function () {
          const target =
            btn.id === 'daily-cta-journal'
              ? document.getElementById('view-plants')
              : document.getElementById('adopt-seed-section');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    });
  }

  function showPopup(opts) {
    const overlay = document.getElementById('daily-status-overlay');
    const title = document.getElementById('daily-status-title');
    const away = document.getElementById('daily-status-away');
    const list = document.getElementById('daily-status-gains');
    const nextLead = document.getElementById('daily-status-next-lead');
    const nextBtn = document.getElementById('daily-status-next-btn');
    if (!overlay || !list) return;

    if (title) {
      title.textContent = opts.gains.length
        ? 'While you were away'
        : opts.firstVisit
          ? 'Welcome to growtoo'
          : 'Daily status';
    }
    if (away) {
      away.textContent = opts.firstVisit
        ? 'Here’s your first-minute path.'
        : 'Away for ' + formatAway(opts.awayMs) + '.';
    }
    list.innerHTML = opts.gains.length
      ? opts.gains
          .map(function (g) {
            return (
              '<li class="daily-status-gain">' +
              '<span class="daily-status-gain-icon" aria-hidden="true">' +
              esc(g.icon || '•') +
              '</span>' +
              '<span>' +
              esc(g.text) +
              '</span>' +
              '</li>'
            );
          })
          .join('')
      : '<li class="daily-status-gain daily-status-gain--quiet"><span>No new gains yet — pick a next step below.</span></li>';

    const step = nextStep(opts.adopter);
    const primary = step.actions.find(function (a) {
      return a.primary;
    }) || step.actions[0];
    if (nextLead) nextLead.textContent = step.lead;
    if (nextBtn) {
      nextBtn.textContent = primary.label;
      nextBtn.dataset.view = primary.view;
      nextBtn.dataset.ctaId = primary.id || '';
    }

    overlay.hidden = false;
    document.body.classList.add('daily-status-open');
  }

  function hidePopup(uid, adopter) {
    const overlay = document.getElementById('daily-status-overlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('daily-status-open');
    if (uid) writeLastSeen(uid, Date.now(), !!adopter || isAdopter());
  }

  function bindPopupOnce() {
    const overlay = document.getElementById('daily-status-overlay');
    if (!overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';

    function dismiss() {
      hidePopup(currentUid(), isAdopter());
    }

    const backdrop = document.getElementById('daily-status-backdrop');
    const closeBtn = document.getElementById('daily-status-close');
    const continueBtn = document.getElementById('daily-status-continue');
    const nextBtn = document.getElementById('daily-status-next-btn');

    if (backdrop) backdrop.addEventListener('click', dismiss);
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    if (continueBtn) continueBtn.addEventListener('click', dismiss);
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        const view = nextBtn.dataset.view || 'adopt';
        const ctaId = nextBtn.dataset.ctaId || '';
        dismiss();
        goView(view);
        if (ctaId === 'daily-cta-faucet') {
          requestAnimationFrame(function () {
            const panel = document.getElementById('test-faucet-panel');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) dismiss();
    });
  }

  function sessionKey(uid, adopter) {
    return SESSION_SHOWN + uid + ':' + (adopter ? 'adopter' : 'grower');
  }

  function alreadyShownThisSession(uid, adopter) {
    try {
      if (sessionStorage.getItem(sessionKey(uid, adopter)) === '1') return true;
      // Legacy key (pre role-scoped) — only blocks same-role grower sessions.
      if (!adopter && sessionStorage.getItem(SESSION_SHOWN + uid) === '1') return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function markShownThisSession(uid, adopter) {
    try {
      sessionStorage.setItem(sessionKey(uid, adopter), '1');
    } catch (_) {
      /* ignore */
    }
  }

  /** Wait briefly so Market snapshot / garden wallet can fill before gains. */
  function whenDataReady(adopter, done) {
    let finished = false;
    const finish = function () {
      if (finished) return;
      finished = true;
      done();
    };

    if (!adopter || !window.Market || typeof Market.onChange !== 'function') {
      setTimeout(finish, SETTLE_MS);
      return;
    }

    const listings = typeof Market.getListings === 'function' ? Market.getListings() : [];
    if (listings && listings.length) {
      setTimeout(finish, 120);
      return;
    }

    let unsub = null;
    const timer = setTimeout(function () {
      if (typeof unsub === 'function') unsub();
      finish();
    }, 1800);
    unsub = Market.onChange(function () {
      clearTimeout(timer);
      if (typeof unsub === 'function') unsub();
      setTimeout(finish, 80);
    });
  }

  function maybeShowAfterLogin(opts) {
    opts = opts || {};
    const uid = opts.uid || currentUid();
    if (!uid) return;
    const adopter =
      opts.profileType === 'adopter' || (opts.profileType == null && isAdopter());

    bindStripOnce();
    bindPopupOnce();
    renderStrip(adopter);

    if (alreadyShownThisSession(uid, adopter)) return;

    whenDataReady(adopter, function () {
      const sinceMs = resolveSinceMs(uid, adopter);
      const now = Date.now();
      const firstVisit = sinceMs == null;
      const awayMs = firstVisit ? 0 : Math.max(0, now - sinceMs);
      const gains = collectGains(uid, sinceMs, adopter);

      // First visit (incl. first time as this role), or away ≥30m.
      // Empty gains still show the quiet “pick a next step” state.
      const showPopupNow = firstVisit || awayMs >= MIN_AWAY_MS;

      markShownThisSession(uid, adopter);
      if (showPopupNow) {
        showPopup({
          adopter: adopter,
          gains: gains,
          awayMs: awayMs,
          firstVisit: firstVisit,
        });
      } else {
        writeLastSeen(uid, now, adopter);
      }
    });
  }

  window.DailyStatus = {
    maybeShowAfterLogin: maybeShowAfterLogin,
    renderStrip: function () {
      bindStripOnce();
      renderStrip(isAdopter());
    },
    hide: function () {
      hidePopup(currentUid(), isAdopter());
    },
  };
})();
