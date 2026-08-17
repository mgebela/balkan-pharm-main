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
    if (!Number.isFinite(ms) || ms <= 0) return T('app.daily.awayShort', 'a short while');
    const mins = Math.round(ms / 60000);
    if (mins < 60) {
      return mins <= 1
        ? T('app.daily.awayMinute', 'about a minute')
        : T('app.daily.awayMinutes', '{count} minutes', { count: mins });
    }
    const hours = Math.round(mins / 60);
    if (hours < 36) return T('app.daily.awayHours', '{count} hours', { count: hours });
    const days = Math.round(hours / 24);
    return T('app.daily.awayDays', '{count} days', { count: days });
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
              ? notes[0].title ||
                T('app.daily.inboxUpdates', '{count} inbox updates', { count: 1 })
              : T('app.daily.inboxUpdates', '{count} inbox updates', { count: notes.length }) +
                (unread
                  ? ' · ' + T('app.daily.unread', '{count} unread', { count: unread })
                  : ''),
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
          text: T('app.daily.journalLogs', '{count} journal logs since last visit', { count: n }),
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
          text: T('app.daily.plantsUpdated', '{count} plants updated', { count: staged }),
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
            T('app.daily.xpGain', '+{count} grower XP', { count: xpGain }) +
            (rank && rank.title ? ' · ' + rank.title : ''),
          view: 'plants',
        });
      }
    }

    if (window.GrowerQuests && typeof GrowerQuests.previewPlatformReward === 'function') {
      const stories =
        window.GrowerBlog && typeof GrowerBlog.getPublishedThisMonth === 'function'
          ? Number(GrowerBlog.getPublishedThisMonth() || 0)
          : 0;
      const preview = GrowerQuests.previewPlatformReward({ publishedStories: stories });
      const a = preview.activity || {};
      const claimed =
        window.Market && typeof Market.platformBonusStatus === 'function'
          ? Market.platformBonusStatus()
          : null;
      if (preview.reward > 0 || (a.careDays || 0) > 0) {
        const statusBit =
          claimed && claimed.status === 'minted'
            ? T('app.daily.bonusClaimed', 'claimed {amount} $GROWTOO', {
                amount: claimed.reward || preview.reward,
              })
            : claimed && claimed.status === 'pending'
              ? T('app.daily.bonusPending', 'claim pending · ~{amount} $GROWTOO', {
                  amount: preview.reward,
                })
              : T('app.daily.bonusReady', '~{amount} $GROWTOO ready to claim', {
                  amount: preview.reward,
                });
        gains.push({
          icon: '◎',
          text:
            T('app.daily.careDays', '{count} care days this month', {
              count: a.careDays || 0,
            }) +
            ' · ' +
            statusBit,
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
              ? T('app.daily.stakeOne', 'Someone adopted one of your plants')
              : T('app.daily.stakeMany', '{count} new adopt stakes on your offers', {
                  count: newStakes,
                }),
          view: 'market',
        });
      }
      if (careTicks) {
        gains.push({
          icon: '◷',
          text: T('app.daily.careSynced', 'Care progress synced on {count} stakes', {
            count: careTicks,
          }),
          view: 'market',
        });
      }
      if (harvestSettled) {
        gains.push({
          icon: '✧',
          text: T('app.daily.harvestSettled', '{count} harvest stakes settled', {
            count: harvestSettled,
          }),
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
          text: T('app.daily.adoptedUpdated', '{count} adopted plants updated', {
            count: stageMoved,
          }),
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
          text: T('app.daily.stakesLanded', '{count} new stakes landed in your garden', {
            count: newSettles,
          }),
          view: 'adopt',
        });
      }
      if (careTicks) {
        gains.push({
          icon: '◷',
          text: T('app.daily.careProgressed', 'Care progressed on {count} stakes', {
            count: careTicks,
          }),
          view: 'adopt',
        });
      }
      if (harvestReady && myStakes) {
        gains.push({
          icon: '✧',
          text: T(
            'app.daily.harvestReady',
            'A stake is harvest-ready — grower can claim locked $GROWTOO'
          ),
          view: 'adopt',
        });
      }
      if (openNew) {
        gains.push({
          icon: '◇',
          text: T('app.daily.newOffers', '{count} new offers on the market', {
            count: openNew,
          }),
          view: 'market',
        });
      }
    }
  }

  /** Same gate as the adopt how-to: hide once a plant is adopted. */
  function adopterOnboardingDone() {
    try {
      if (!window.PlantToken || typeof PlantToken.getWallet !== 'function') return false;
      const w = PlantToken.getWallet() || {};
      if (Array.isArray(w.tokens) && w.tokens.length > 0) return true;
      if (window.Market && typeof Market.getListings === 'function') {
        const uid = currentUid();
        if (
          uid &&
          (Market.getListings() || []).some(function (l) {
            return (
              l &&
              l.buyerUid === uid &&
              (l.status === 'sold' || l.status === 'sale_pending')
            );
          })
        ) {
          return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /** Hide grower START HERE after the first Market listing (any status). */
  function growerMarketIntroDone() {
    try {
      const uid = currentUid();
      if (!uid) return false;
      try {
        if (localStorage.getItem('dnevnik-live-grower-listed:' + uid) === '1') return true;
      } catch (_) {
        /* ignore */
      }
      if (window.Market && typeof Market.getListings === 'function') {
        return (Market.getListings() || []).some(function (l) {
          return l && l.uid === uid;
        });
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function markGrowerListed() {
    const uid = currentUid();
    if (!uid) return;
    try {
      localStorage.setItem('dnevnik-live-grower-listed:' + uid, '1');
    } catch (_) {
      /* ignore */
    }
    renderStrip(false);
  }

  function nextStep(adopter) {
    if (adopter) {
      const copy =
        window.GrowtooProfile && typeof GrowtooProfile.adopterIntentCopy === 'function'
          ? GrowtooProfile.adopterIntentCopy()
          : null;
      return {
        kicker: T('app.daily.startHere', 'Start here'),
        lead:
          (copy && (copy.strip || copy.hero)) ||
          T('app.daily.adopterLead', 'Claim test $GROWTOO, then invest in a live plant offer.'),
        actions: [
          {
            id: 'daily-cta-faucet',
            label: T('app.daily.ctaFaucet', 'Open faucet'),
            view: 'market',
            primary: true,
          },
          { id: 'daily-cta-market', label: T('app.daily.ctaMarket', 'Browse market'), view: 'market' },
          { id: 'daily-cta-garden', label: T('app.daily.ctaGarden', 'My garden'), view: 'adopt' },
        ],
      };
    }
    return {
      kicker: T('app.daily.startHere', 'Start here'),
      lead: T(
        'app.daily.growerLead',
        'Log watering or feeding to earn $GROWTOO. Claim the month on Tokenise.'
      ),
      actions: [
        {
          id: 'daily-cta-journal',
          label: T('app.daily.ctaJournal', 'Open journal'),
          view: 'plants',
          primary: true,
        },
        { id: 'daily-cta-tokenise', label: T('app.daily.ctaTokenise', 'Tokenise'), view: 'adopt' },
        { id: 'daily-cta-list', label: T('app.daily.ctaMarketShort', 'Market'), view: 'market' },
      ],
    };
  }

  function growerBonusStep() {
    if (isAdopter()) return null;
    if (!window.GrowerQuests || typeof GrowerQuests.previewPlatformReward !== 'function') return null;
    const claimed =
      window.Market && typeof Market.platformBonusStatus === 'function'
        ? Market.platformBonusStatus()
        : null;
    if (claimed && (claimed.status === 'minted' || claimed.status === 'pending')) return null;
    const stories =
      window.GrowerBlog && typeof GrowerBlog.getPublishedThisMonth === 'function'
        ? Number(GrowerBlog.getPublishedThisMonth() || 0)
        : 0;
    const preview = GrowerQuests.previewPlatformReward({ publishedStories: stories });
    if (!preview || preview.reward <= 0) return null;
    return {
      kicker: T('app.daily.bonusKicker', 'Activity bonus'),
      lead: T(
        'app.daily.bonusLead',
        'About {amount} $GROWTOO from this month’s watering, feeding, and stories. Claim on Tokenise.',
        { amount: preview.reward }
      ),
      actions: [
        {
          id: 'daily-cta-tokenise',
          label: T('app.daily.ctaClaim', 'Claim on Tokenise'),
          view: 'adopt',
          primary: true,
        },
        { id: 'daily-cta-journal', label: T('app.daily.ctaJournal', 'Open journal'), view: 'plants' },
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
    // Intro only — hide once the adopter has adopted, or the grower has listed once.
    if (adopter && adopterOnboardingDone()) {
      strip.hidden = true;
      actions.innerHTML = '';
      return;
    }
    if (!adopter && growerMarketIntroDone()) {
      strip.hidden = true;
      actions.innerHTML = '';
      return;
    }
    const step = nextStep(adopter);
    if (kicker) kicker.textContent = step.kicker;
    if (lead) lead.textContent = step.lead;
    actions.innerHTML = step.actions
      .map(function (a) {
        return (
          '<button type="button" class="btn ' +
          (a.primary ? 'btn-primary' : 'btn-ghost') +
          // i18n-ignore — class names and a data attribute, not copy.
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
        ? T('app.daily.titleAway', 'While you were away')
        : opts.firstVisit
          ? T('app.daily.titleWelcome', 'Welcome to growtoo')
          : T('app.daily.titleStatus', 'Daily status');
    }
    if (away) {
      away.textContent = opts.firstVisit
        ? T('app.daily.firstPath', 'Here’s your first-minute path.')
        : T('app.daily.awayFor', 'Away for {time}.', { time: formatAway(opts.awayMs) });
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
      : '<li class="daily-status-gain daily-status-gain--quiet"><span>' +
        esc(T('app.daily.noGains', 'No new gains yet — pick a next step below.')) +
        '</span></li>';

    const step = growerBonusStep() || nextStep(opts.adopter);
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
    flushQueuedReward();
  }

  let queuedReward = null;

  function rewardCopy(detail) {
    const d = detail || {};
    const titles = {
      watering: T('app.daily.rewardWatering', 'Watering counted'),
      feeding: T('app.daily.rewardFeeding', 'Feeding counted'),
      stageLogged: T('app.daily.rewardStage', 'Stage logged'),
      story_published: T('app.daily.rewardStory', 'Story published'),
      claimed: T('app.daily.rewardClaimed', 'Bonus minted'),
    };
    const preview = d.preview || {};
    const a = preview.activity || {};
    const lines = [];
    if (d.xp) {
      lines.push({ icon: '★', text: T('app.daily.xpGain', '+{count} grower XP', { count: d.xp }) });
    }
    if (d.kind === 'claimed') {
      lines.push({
        icon: '◎',
        text: T('app.daily.sentToWallet', '+{amount} $GROWTOO sent to your Devnet wallet', {
          amount: d.claimed || preview.reward || 0,
        }),
      });
    } else {
      lines.push({
        icon: '◎',
        text:
          T('app.daily.careDays', '{count} care days this month', { count: a.careDays || 0 }) +
          ' · ' +
          T('app.daily.whenYouClaim', '~{amount} $GROWTOO when you claim', {
            amount: preview.reward || 0,
          }),
      });
    }
    if (d.weekComplete && d.kind !== 'claimed') {
      lines.push({
        icon: '◷',
        text: T(
          'app.daily.weekUnlocked',
          '5-day week unlocked · extra $GROWTOO on this month’s claim'
        ),
      });
    }
    return {
      title: titles[d.kind] || T('app.daily.rewardDefault', 'Grower reward'),
      lead:
        d.kind === 'claimed'
          ? T('app.daily.rewardLeadClaimed', 'Activity bonus landed in your wallet (test network).')
          : T(
              'app.daily.rewardLeadLogged',
              'Logged for today. Extra logs today do not add more tokens.'
            ),
      lines: lines,
      claimable: d.kind !== 'claimed' && (preview.reward || 0) > 0,
    };
  }

  function showRewardPopup(detail) {
    if (isAdopter()) return;
    const overlay = document.getElementById('reward-earn-overlay');
    const title = document.getElementById('reward-earn-title');
    const lead = document.getElementById('reward-earn-lead');
    const list = document.getElementById('reward-earn-gains');
    const nextBtn = document.getElementById('reward-earn-next-btn');
    if (!overlay || !list) return;
    if (document.body.classList.contains('daily-status-open')) {
      queuedReward = detail;
      return;
    }
    const copy = rewardCopy(detail);
    if (title) title.textContent = copy.title;
    if (lead) lead.textContent = copy.lead;
    list.innerHTML = copy.lines
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
      .join('');
    if (nextBtn) {
      nextBtn.textContent = copy.claimable
        ? T('app.daily.ctaClaim', 'Claim on Tokenise')
        : T('app.daily.ctaContinue', 'Continue');
      nextBtn.dataset.view = copy.claimable ? 'adopt' : '';
    }
    overlay.hidden = false;
    document.body.classList.add('reward-earn-open');
  }

  function hideRewardPopup() {
    const overlay = document.getElementById('reward-earn-overlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('reward-earn-open');
  }

  function flushQueuedReward() {
    if (!queuedReward) return;
    const detail = queuedReward;
    queuedReward = null;
    setTimeout(function () {
      showRewardPopup(detail);
    }, 280);
  }

  function bindRewardOnce() {
    const overlay = document.getElementById('reward-earn-overlay');
    if (!overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';
    const backdrop = document.getElementById('reward-earn-backdrop');
    const closeBtn = document.getElementById('reward-earn-close');
    const continueBtn = document.getElementById('reward-earn-continue');
    const nextBtn = document.getElementById('reward-earn-next-btn');
    function dismiss() {
      hideRewardPopup();
    }
    if (backdrop) backdrop.addEventListener('click', dismiss);
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    if (continueBtn) continueBtn.addEventListener('click', dismiss);
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        const view = nextBtn.dataset.view || '';
        dismiss();
        if (view) goView(view);
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) dismiss();
    });
    window.addEventListener('growtoo:reward', function (e) {
      showRewardPopup((e && e.detail) || {});
    });
  }

  function maybeKickTour(adopter, uid) {
    try {
      if (window.ProductTour && typeof ProductTour.maybeStartAfterDailyStatus === 'function') {
        ProductTour.maybeStartAfterDailyStatus({
          profileType: adopter ? 'adopter' : 'grower',
          uid: uid || currentUid(),
        });
      }
    } catch (_) {
      /* ignore */
    }
  }

  function bindPopupOnce() {
    const overlay = document.getElementById('daily-status-overlay');
    if (!overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';

    function dismiss() {
      const uid = currentUid();
      const adopter = isAdopter();
      hidePopup(uid, adopter);
      maybeKickTour(adopter, uid);
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
    bindRewardOnce();
    renderStrip(adopter);

    // When Market listings sync (or a new offer posts), refresh grower START HERE hide.
    if (!adopter && window.Market && typeof Market.onChange === 'function' && !window.__growtooStripMarketBound) {
      window.__growtooStripMarketBound = true;
      Market.onChange(function () {
        if (!isAdopter()) renderStrip(false);
      });
    }

    if (alreadyShownThisSession(uid, adopter)) {
      // Daily status already handled this session — still offer the tour once.
      maybeKickTour(adopter, uid);
      return;
    }

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
        maybeKickTour(adopter, uid);
      }
    });
  }

  window.DailyStatus = {
    maybeShowAfterLogin: maybeShowAfterLogin,
    renderStrip: function () {
      bindStripOnce();
      renderStrip(isAdopter());
    },
    markGrowerListed: markGrowerListed,
    growerMarketIntroDone: growerMarketIntroDone,
    hide: function () {
      hidePopup(currentUid(), isAdopter());
    },
    showReward: showRewardPopup,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindRewardOnce);
  } else {
    bindRewardOnce();
  }
})();
