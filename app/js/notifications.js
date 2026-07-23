/*
 * In-app notifications — bell inbox + toasts.
 * Firestore: users/{uid}/notifications/{id}
 */
(function () {
  'use strict';

  const DEDUP_KEY = 'dnevnik-live-notif-dedup';
  const DEDUP_TTL_MS = 6 * 60 * 60 * 1000;
  const LIMIT = 40;

  const listeners = new Set();
  let items = [];
  let watchedUid = '';
  let unsubscribe = null;
  let panelOpen = false;
  let toastHost = null;
  let prevStatuses = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function firebaseReady() {
    return !!(window.firebase && firebase.auth && firebase.firestore);
  }

  function currentUser() {
    return firebaseReady() ? firebase.auth().currentUser : null;
  }

  function colRef(uid) {
    return firebase.firestore().collection('users').doc(uid).collection('notifications');
  }

  function readDedup() {
    try {
      const raw = localStorage.getItem(DEDUP_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeDedup(map) {
    try {
      localStorage.setItem(DEDUP_KEY, JSON.stringify(map));
    } catch {
      // ignore
    }
  }

  function dedupKey(type, key) {
    return String(type || '') + '::' + String(key || '');
  }

  function shouldSkipDedup(type, key) {
    if (!key) return false;
    const map = readDedup();
    const k = dedupKey(type, key);
    const at = map[k];
    if (at && Date.now() - Number(at) < DEDUP_TTL_MS) return true;
    map[k] = Date.now();
    // prune
    const cutoff = Date.now() - DEDUP_TTL_MS;
    Object.keys(map).forEach(function (id) {
      if (Number(map[id]) < cutoff) delete map[id];
    });
    writeDedup(map);
    return false;
  }

  function emit() {
    listeners.forEach(function (fn) {
      try {
        fn(items.slice());
      } catch {
        // ignore
      }
    });
    renderBell();
  }

  function unreadCount() {
    return items.filter(function (n) {
      return n && !n.read;
    }).length;
  }

  function ensureToastHost() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = document.getElementById('toast-host');
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.id = 'toast-host';
      toastHost.className = 'toast-host';
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }
    return toastHost;
  }

  function toast(msg, kind) {
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = 'toast toast--' + (kind || 'info');
    el.textContent = String(msg || '');
    host.appendChild(el);
    requestAnimationFrame(function () {
      el.classList.add('toast--show');
    });
    setTimeout(function () {
      el.classList.remove('toast--show');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 280);
    }, 4200);
  }

  function relativeTime(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    return Math.floor(sec / 86400) + 'd ago';
  }

  function navigateAction(action) {
    if (!action || !action.view) return;
    if (typeof window.showAppView === 'function') {
      window.showAppView(action.view, action.plantId || null);
      return;
    }
    const nav = document.querySelector('.nav-item[data-view="' + action.view + '"]');
    if (nav) nav.click();
    if (action.plantId) {
      window.dispatchEvent(
        new CustomEvent('dnevnik:open-growlog', { detail: { plantId: action.plantId } })
      );
    }
  }

  function renderPanelList() {
    const list = document.getElementById('notif-panel-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML =
        '<p class="notif-empty">No notifications yet.</p>' +
        '<button type="button" class="btn btn-ghost btn-sm notif-load-examples" id="notif-load-examples">Load examples</button>';
      return;
    }
    list.innerHTML =
      items
        .map(function (n) {
          return (
            '<button type="button" class="notif-item' +
            (n.read ? '' : ' notif-item--unread') +
            '" data-id="' +
            esc(n.id) +
            '">' +
            '<span class="notif-item-title">' +
            esc(n.title || 'Update') +
            '</span>' +
            '<span class="notif-item-body">' +
            esc(n.body || '') +
            '</span>' +
            '<span class="notif-item-meta">' +
            esc(relativeTime(n.createdAt)) +
            (n.type ? ' · ' + esc(n.type.replace(/_/g, ' ')) : '') +
            (n.meta && n.meta.demo ? ' · example' : '') +
            '</span>' +
            '</button>'
          );
        })
        .join('') +
      '<div class="notif-panel-foot">' +
      '<button type="button" class="btn btn-ghost btn-sm notif-load-examples" id="notif-load-examples">Load more examples</button>' +
      '</div>';
  }

  function renderBell() {
    const badge = document.getElementById('notif-badge');
    const btn = document.getElementById('notif-bell-btn');
    const count = unreadCount();
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? '99+' : String(count);
    }
    if (btn) {
      btn.setAttribute('aria-label', count ? 'Notifications, ' + count + ' unread' : 'Notifications');
    }
    if (panelOpen) renderPanelList();
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    const panel = document.getElementById('notif-panel');
    const btn = document.getElementById('notif-bell-btn');
    if (panel) panel.hidden = !panelOpen;
    if (btn) btn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    if (panelOpen) {
      renderPanelList();
      markAllRead();
    }
  }

  async function push(opts) {
    const o = opts || {};
    const user = currentUser();
    if (!user) return null;
    const type = String(o.type || 'system');
    const dedup = o.dedupKey || (o.meta && o.meta.key) || null;
    if (dedup && shouldSkipDedup(type, dedup)) {
      if (o.toast !== false && o.toastOnlyOnNew === true) {
        // skipped
      } else if (o.toast && !o.skipToastOnDedup) {
        // still toast? plan says skip spam — skip both
      }
      return null;
    }

    const payload = {
      uid: user.uid,
      type: type,
      title: String(o.title || 'Update').slice(0, 120),
      body: String(o.body || '').slice(0, 400),
      createdAt: new Date().toISOString(),
      read: false,
      meta: o.meta && typeof o.meta === 'object' ? o.meta : {},
    };
    if (o.action && typeof o.action === 'object') {
      payload.action = {
        view: String(o.action.view || ''),
        plantId: o.action.plantId || null,
        listingId: o.action.listingId || null,
      };
    }

    let id = null;
    try {
      const ref = await colRef(user.uid).add(payload);
      id = ref.id;
    } catch (err) {
      console.warn('notification push failed', err);
    }

    if (o.toast !== false) {
      toast(o.toastMsg || o.title || payload.title, o.kind || 'info');
    }
    return id;
  }

  /** Notify another user (seller) — rules allow stake_received from buyer. */
  async function pushToUser(targetUid, opts) {
    const o = opts || {};
    const user = currentUser();
    if (!user || !targetUid) return null;
    const payload = {
      uid: targetUid,
      type: String(o.type || 'stake_received'),
      title: String(o.title || 'Update').slice(0, 120),
      body: String(o.body || '').slice(0, 400),
      createdAt: new Date().toISOString(),
      read: false,
      meta: o.meta && typeof o.meta === 'object' ? o.meta : {},
      fromUid: user.uid,
    };
    if (o.action && typeof o.action === 'object') {
      payload.action = {
        view: String(o.action.view || 'market'),
        plantId: o.action.plantId || null,
        listingId: o.action.listingId || null,
      };
    }
    try {
      const ref = await colRef(targetUid).add(payload);
      return ref.id;
    } catch (err) {
      console.warn('notification pushToUser failed', err);
      return null;
    }
  }

  async function markRead(id) {
    const user = currentUser();
    if (!user || !id) return;
    const row = items.find(function (n) {
      return n.id === id;
    });
    if (row && row.read) return;
    try {
      await colRef(user.uid).doc(id).update({ read: true });
    } catch (err) {
      console.warn('markRead failed', err);
    }
  }

  async function markAllRead() {
    const user = currentUser();
    if (!user) return;
    const unread = items.filter(function (n) {
      return n && !n.read;
    });
    if (!unread.length) return;
    const batch = firebase.firestore().batch();
    unread.forEach(function (n) {
      batch.update(colRef(user.uid).doc(n.id), { read: true });
    });
    try {
      await batch.commit();
    } catch (err) {
      console.warn('markAllRead failed', err);
    }
  }

  async function dismiss(id) {
    const user = currentUser();
    if (!user || !id) return;
    try {
      await colRef(user.uid).doc(id).delete();
    } catch (err) {
      console.warn('dismiss failed', err);
    }
  }

  function startWatch(uid) {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    watchedUid = uid || '';
    items = [];
    if (!uid || !firebaseReady()) {
      emit();
      return;
    }
    unsubscribe = colRef(uid)
      .orderBy('createdAt', 'desc')
      .limit(LIMIT)
      .onSnapshot(
        function (snap) {
          const next = [];
          snap.forEach(function (doc) {
            next.push(Object.assign({ id: doc.id }, doc.data()));
          });
          items = next;
          emit();
          if (!next.length && !window.__dnevnikNotifDemoSeeded) {
            window.__dnevnikNotifDemoSeeded = true;
            seedDemoInbox({ force: false, toast: false, both: true }).catch(function () {});
          }
        },
        function (err) {
          console.warn('notifications watch failed', err);
          // Fallback without orderBy if index missing
          if (String(err && err.message || '').indexOf('index') >= 0) {
            unsubscribe = colRef(uid).limit(LIMIT).onSnapshot(function (snap2) {
              const next = [];
              snap2.forEach(function (doc) {
                next.push(Object.assign({ id: doc.id }, doc.data()));
              });
              next.sort(function (a, b) {
                return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
              });
              items = next;
              emit();
              if (!next.length && !window.__dnevnikNotifDemoSeeded) {
                window.__dnevnikNotifDemoSeeded = true;
                seedDemoInbox({ force: false, toast: false, both: true }).catch(function () {});
              }
            });
          }
        }
      );
  }

  function stopWatch() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    watchedUid = '';
    items = [];
    emit();
  }

  function trackStatusTransition(bucket, id, status, onChange) {
    if (!id) return;
    const key = bucket + ':' + id;
    const prev = prevStatuses[key];
    prevStatuses[key] = status;
    if (prev && prev !== status && typeof onChange === 'function') {
      onChange(prev, status);
    }
  }

  /** Watch mint / reward / harvest status and emit inbox items. */
  function bindStatusHooks() {
    if (window.SeedChain && typeof SeedChain.onChange === 'function') {
      SeedChain.onChange(function () {
        const mints = SeedChain.getMints ? SeedChain.getMints() : {};
        Object.keys(mints).forEach(function (id) {
          const m = mints[id];
          trackStatusTransition('seed', id, m.status, function (from, to) {
            if (to === 'minted') {
              push({
                type: 'seed_mint',
                title: 'Seed NFT minted',
                body: (m.name || 'Seed') + ' is on-chain.',
                meta: { key: 'seed:' + id + ':minted', requestId: id, mintAddress: m.mintAddress },
                action: { view: 'adopt' },
                kind: 'success',
                dedupKey: 'seed:' + id + ':minted',
              });
            } else if (to === 'failed') {
              push({
                type: 'seed_mint',
                title: 'Seed mint failed',
                body: m.error || 'Check the Tokenise queue.',
                meta: { key: 'seed:' + id + ':failed', requestId: id },
                action: { view: 'adopt' },
                kind: 'error',
                dedupKey: 'seed:' + id + ':failed',
              });
            }
          });
        });
        const growth = SeedChain.getGrowthMints ? SeedChain.getGrowthMints() : {};
        Object.keys(growth).forEach(function (id) {
          const g = growth[id];
          trackStatusTransition('growth', id, g.status, function (from, to) {
            if (to === 'minted') {
              push({
                type: 'growth_mint',
                title: 'Growth stage minted',
                body: (g.name || 'Plant') + ' → ' + (g.stage || 'next') + (g.reward ? ' · +' + g.reward + ' $GROWTOO' : ''),
                meta: { key: 'growth:' + id + ':minted', requestId: id, stage: g.stage },
                action: { view: 'adopt', plantId: g.plantId || null },
                kind: 'success',
                dedupKey: 'growth:' + id + ':minted',
              });
            } else if (to === 'failed') {
              push({
                type: 'growth_mint',
                title: 'Growth mint failed',
                body: g.error || 'Journal proof or queue error.',
                meta: { key: 'growth:' + id + ':failed', requestId: id },
                action: { view: 'adopt' },
                kind: 'error',
                dedupKey: 'growth:' + id + ':failed',
              });
            }
          });
        });
      });
    }

    if (window.Market && typeof Market.onChange === 'function') {
      Market.onChange(function (listings) {
        const uid = currentUser() ? currentUser().uid : '';
        (listings || []).forEach(function (l) {
          if (!l || !l.id) return;
          // Seller: sale / care status
          if (uid && l.uid === uid) {
            trackStatusTransition('listing', l.id, l.status + ':' + (l.careStatus || ''), function () {
              if (l.status === 'sold' || l.status === 'sale_pending') {
                // stake_received usually written by buyer/worker; skip duplicate toast for seller via status
              }
            });
            if (l.careStatus) {
              trackStatusTransition('care', l.id, l.careStatus, function (from, to) {
                if (to === 'released') {
                  push({
                    type: 'harvest_claim',
                    title: 'Harvest stake released',
                    body: 'Locked $GROWTOO for "' + (l.name || 'plant') + '" released to you.',
                    meta: { key: 'harvest:' + l.id + ':released', listingId: l.id },
                    action: { view: 'market', listingId: l.id },
                    kind: 'success',
                    dedupKey: 'harvest:' + l.id + ':released',
                  });
                } else if (to === 'refunded') {
                  push({
                    type: 'harvest_claim',
                    title: 'Harvest stake refunded',
                    body: 'Locked $GROWTOO for "' + (l.name || 'plant') + '" returned to the adopter.',
                    meta: { key: 'harvest:' + l.id + ':refunded', listingId: l.id },
                    action: { view: 'market', listingId: l.id },
                    kind: 'info',
                    dedupKey: 'harvest:' + l.id + ':refunded',
                  });
                }
              });
            }
          }
          // Adopter: monthly unlock status on adopted stakes
          if (uid && l.buyerUid === uid && l.settlement === 'adopt_stake' && l.careStatus) {
            trackStatusTransition('adopter-care', l.id, l.careStatus, function (from, to) {
              if (to === 'released' || to === 'refunded') {
                push({
                  type: 'sale_settled',
                  title: to === 'released' ? 'Grower unlocked full stake' : 'Locked stake refunded',
                  body:
                    '"' +
                    (l.name || 'Plant') +
                    '" monthly care settled · ' +
                    to +
                    '.',
                  meta: { key: 'adopter-care:' + l.id + ':' + to, listingId: l.id },
                  action: { view: 'adopt' },
                  kind: to === 'released' ? 'success' : 'info',
                  dedupKey: 'adopter-care:' + l.id + ':' + to,
                });
              }
            });
          }
        });
      });
    }

    // Platform rewards
    if (window.Market && typeof Market.platformBonusStatus === 'function') {
      // polled via Market platform watch → PlantToken; also watch collection here
    }
    startPlatformWatch();
    startHarvestWatch();
  }

  let platformUnsub = null;
  let harvestUnsub = null;

  function startPlatformWatch() {
    if (platformUnsub) {
      platformUnsub();
      platformUnsub = null;
    }
    const user = currentUser();
    if (!user || !firebaseReady()) return;
    platformUnsub = firebase
      .firestore()
      .collection('platformRewards')
      .where('uid', '==', user.uid)
      .limit(12)
      .onSnapshot(function (snap) {
        snap.forEach(function (doc) {
          const d = Object.assign({ id: doc.id }, doc.data());
          trackStatusTransition('platform', d.id, d.status, function (from, to) {
            if (to === 'minted') {
              push({
                type: 'platform_bonus',
                title: 'Platform bonus minted',
                body: '+' + (d.reward || 0) + ' $GROWTOO for ' + (d.monthKey || 'this month') + '.',
                meta: { key: 'platform:' + d.id + ':minted', monthKey: d.monthKey },
                action: { view: 'adopt' },
                kind: 'success',
                dedupKey: 'platform:' + d.id + ':minted',
              });
            } else if (to === 'failed') {
              push({
                type: 'platform_bonus',
                title: 'Platform bonus failed',
                body: d.error || 'Try claiming again next month window.',
                meta: { key: 'platform:' + d.id + ':failed', monthKey: d.monthKey },
                action: { view: 'adopt' },
                kind: 'error',
                dedupKey: 'platform:' + d.id + ':failed',
              });
            }
          });
        });
      });
  }

  function startHarvestWatch() {
    if (harvestUnsub) {
      harvestUnsub();
      harvestUnsub = null;
    }
    const user = currentUser();
    if (!user || !firebaseReady()) return;
    harvestUnsub = firebase
      .firestore()
      .collection('harvestClaims')
      .where('uid', '==', user.uid)
      .limit(20)
      .onSnapshot(function (snap) {
        snap.forEach(function (doc) {
          const d = Object.assign({ id: doc.id }, doc.data());
          trackStatusTransition('hclaim', d.id, d.status, function (from, to) {
            if (to === 'released' || to === 'refunded') {
              push({
                type: 'harvest_claim',
                title: to === 'released' ? 'Harvest claim released' : 'Harvest claim refunded',
                body: 'Stake settlement finished · ' + to + '.',
                meta: { key: 'hclaim:' + d.id + ':' + to, listingId: d.listingId },
                action: { view: 'adopt' },
                kind: to === 'released' ? 'success' : 'info',
                dedupKey: 'hclaim:' + d.id + ':' + to,
              });
            } else if (to === 'failed') {
              push({
                type: 'harvest_claim',
                title: 'Harvest claim failed',
                body: d.error || 'Check journal care months and retry.',
                meta: { key: 'hclaim:' + d.id + ':failed', listingId: d.listingId },
                action: { view: 'adopt' },
                kind: 'error',
                dedupKey: 'hclaim:' + d.id + ':failed',
              });
            }
          });
        });
      });
  }

  function notifyCareProgress(kind, plantId, plantName, periodKey, daysHit, minDays) {
    if (!plantId || !periodKey) return;
    const type = kind === 'week' ? 'care_week' : 'care_month';
    const label = kind === 'week' ? 'Weekly' : 'Monthly';
    push({
      type: type,
      title: label + ' care qualified',
      body:
        (plantName || 'Plant') +
        ' hit ' +
        daysHit +
        '/' +
        minDays +
        ' care days · ' +
        periodKey +
        (kind === 'month' ? ' (harvest unlock path).' : ' (grower progress).'),
      meta: { key: type + ':' + plantId + ':' + periodKey, plantId: plantId, periodKey: periodKey },
      action: { view: 'adopt', plantId: plantId },
      kind: 'success',
      dedupKey: type + ':' + plantId + ':' + periodKey,
    });
  }

  function notifyJournalEntry(entry, plantName) {
    if (!entry) return;
    const typeLabel = entry.type || 'log';
    push({
      type: 'journal_entry',
      title: 'Journal log saved',
      body: (plantName || 'Plant') + ' · ' + typeLabel + (entry.note ? ' — ' + String(entry.note).slice(0, 80) : ''),
      meta: {
        key: 'journal:' + entry.id,
        plantId: entry.plantId,
        entryId: entry.id,
        entryType: entry.type,
      },
      action: { view: 'plants', plantId: entry.plantId },
      kind: 'info',
      dedupKey: 'journal:' + entry.id,
      toastMsg: 'Logged ' + typeLabel + (plantName ? ' for ' + plantName : ''),
    });
  }

  function bindUi() {
    const btn = document.getElementById('notif-bell-btn');
    const panel = document.getElementById('notif-panel');
    const markAll = document.getElementById('notif-mark-all');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setPanelOpen(!panelOpen);
    });

    if (markAll) {
      markAll.addEventListener('click', function (e) {
        e.stopPropagation();
        markAllRead();
      });
    }

    if (panel) {
      panel.addEventListener('click', function (e) {
        const loadBtn = e.target.closest('#notif-load-examples');
        if (loadBtn) {
          e.stopPropagation();
          seedDemoInbox({ force: true, both: true }).then(function () {
            renderPanelList();
          });
          return;
        }
        const item = e.target.closest('.notif-item');
        if (!item) return;
        const id = item.dataset.id;
        const row = items.find(function (n) {
          return n.id === id;
        });
        markRead(id);
        if (row && row.action) navigateAction(row.action);
        setPanelOpen(false);
      });
    }

    document.addEventListener('click', function (e) {
      if (!panelOpen) return;
      const wrap = document.getElementById('notif-wrap');
      if (wrap && !wrap.contains(e.target)) setPanelOpen(false);
    });
  }

  function isAdopterProfile() {
    return document.body.classList.contains('profile-adopter');
  }

  function demoSamples(role) {
    const now = Date.now();
    const iso = function (minsAgo) {
      return new Date(now - minsAgo * 60 * 1000).toISOString();
    };
    const grower = [
      {
        type: 'journal_entry',
        title: 'Journal log saved',
        body: 'Northern Lights · zalijevanje — Morning feed complete.',
        createdAt: iso(5),
        meta: { key: 'demo:journal', plantId: null, demo: true },
        action: { view: 'plants' },
      },
      {
        type: 'care_week',
        title: 'Weekly care qualified',
        body: 'OG Kush hit 5/5 care days · this week (grower progress).',
        createdAt: iso(25),
        meta: { key: 'demo:care_week', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'care_month',
        title: 'Monthly care qualified',
        body: 'OG Kush hit 12/12 care days · harvest unlock path.',
        createdAt: iso(40),
        meta: { key: 'demo:care_month', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'stake_received',
        title: 'New adopt stake',
        body: 'An adopter staked 100 $GROWTOO on "Batch B-2026-07" (50% locked until monthly care).',
        createdAt: iso(90),
        meta: { key: 'demo:stake', demo: true, priceGrow: 100 },
        action: { view: 'market' },
      },
      {
        type: 'seed_mint',
        title: 'Seed NFT minted',
        body: 'Northern Lights is on-chain.',
        createdAt: iso(180),
        meta: { key: 'demo:seed', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'growth_mint',
        title: 'Growth stage minted',
        body: 'Northern Lights → vegetative · +35 $GROWTOO',
        createdAt: iso(200),
        meta: { key: 'demo:growth', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'platform_bonus',
        title: 'Platform bonus minted',
        body: '+18 $GROWTOO for this month (plants, weeks, flower).',
        createdAt: iso(360),
        meta: { key: 'demo:platform', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'harvest_claim',
        title: 'Harvest stake released',
        body: 'Locked $GROWTOO for "Batch B-2026-07" released to you.',
        createdAt: iso(500),
        meta: { key: 'demo:harvest', demo: true },
        action: { view: 'adopt' },
      },
    ];
    const adopter = [
      {
        type: 'sale_settled',
        title: 'Investment complete',
        body: 'You adopted "Northern Lights" for 80 $GROWTOO.',
        createdAt: iso(8),
        meta: { key: 'demo:buy', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'sale_settled',
        title: 'Adopt stake active',
        body: 'You hold "Batch B-2026-07". Locked half unlocks when monthly care qualifies at harvest.',
        createdAt: iso(30),
        meta: { key: 'demo:adopt_active', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'sale_settled',
        title: 'Grower unlocked full stake',
        body: '"Batch B-2026-07" monthly care settled · released.',
        createdAt: iso(120),
        meta: { key: 'demo:unlock', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'sale_settled',
        title: 'NFT delivered',
        body: '"OG Kush" is in your garden.',
        createdAt: iso(240),
        meta: { key: 'demo:delivered', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'system',
        title: 'Monthly care update',
        body: 'Grower is documenting care on your adopted plant — unlock status updates at harvest.',
        createdAt: iso(400),
        meta: { key: 'demo:monthly_status', demo: true },
        action: { view: 'adopt' },
      },
    ];
    if (role === 'adopter') return adopter;
    if (role === 'both') return grower.concat(adopter);
    return grower;
  }

  async function seedDemoInbox(opts) {
    const o = opts || {};
    const user = currentUser();
    if (!user || !firebaseReady()) return 0;
    const role = o.role || (isAdopterProfile() ? 'adopter' : 'grower');
    const samples = demoSamples(o.both ? 'both' : role);
    const force = !!o.force;

    if (!force) {
      const existingDemo = items.some(function (n) {
        return n && n.meta && n.meta.demo;
      });
      if (existingDemo || items.length > 0) return 0;
    } else {
      // Replace prior examples so reloads stay clean
      const demos = items.filter(function (n) {
        return n && n.meta && n.meta.demo;
      });
      for (let d = 0; d < demos.length; d += 1) {
        try {
          await colRef(user.uid).doc(demos[d].id).delete();
        } catch {
          // ignore
        }
      }
    }

    let written = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      try {
        await colRef(user.uid).add({
          uid: user.uid,
          type: s.type,
          title: s.title,
          body: s.body,
          createdAt: s.createdAt,
          read: false,
          meta: s.meta || {},
          action: s.action || null,
        });
        written += 1;
      } catch (err) {
        console.warn('demo notification failed', err);
      }
    }
    if (written && o.toast !== false) {
      toast('Loaded ' + written + ' example notifications', 'info');
    }
    return written;
  }

  function init() {
    ensureToastHost();
    bindUi();
    renderBell();
  }

  window.DnevnikNotifications = {
    init: init,
    startWatch: startWatch,
    stopWatch: stopWatch,
    push: push,
    pushToUser: pushToUser,
    toast: toast,
    markRead: markRead,
    markAllRead: markAllRead,
    dismiss: dismiss,
    unreadCount: unreadCount,
    seedDemoInbox: seedDemoInbox,
    onChange: function (fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    },
    getItems: function () {
      return items.slice();
    },
    bindStatusHooks: bindStatusHooks,
    notifyCareProgress: notifyCareProgress,
    notifyJournalEntry: notifyJournalEntry,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
