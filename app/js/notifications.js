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
    /* Intl words this per language; only "just now" needs a key. */
    const tag = (window.I18N && window.I18N.locale) || 'en';
    function rel(value, unit) {
      try {
        return new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style: 'short' }).format(
          -value,
          unit
        );
      } catch (e) {
        return value + ' ' + unit;
      }
    }
    if (sec < 60) return T('app.notif.justNow', 'just now');
    if (sec < 3600) return rel(Math.floor(sec / 60), 'minute');
    if (sec < 86400) return rel(Math.floor(sec / 3600), 'hour');
    return rel(Math.floor(sec / 86400), 'day');
  }

  function navigateAction(action) {
    if (!action || !action.view) return;
    if (typeof window.showAppView === 'function') {
      window.showAppView(action.view, action.plantId || null);
    } else {
      const nav = document.querySelector('.nav-item[data-view="' + action.view + '"]');
      if (nav) nav.click();
      if (action.plantId) {
        window.dispatchEvent(
          new CustomEvent('dnevnik:open-growlog', { detail: { plantId: action.plantId } })
        );
      }
    }
    if (
      action.coachDraft &&
      window.AICoach &&
      typeof AICoach.proposeDraftFromReminder === 'function'
    ) {
      setTimeout(function () {
        AICoach.proposeDraftFromReminder(action.coachDraft);
      }, 140);
    }
  }

  function renderPanelList() {
    const list = document.getElementById('notif-panel-list');
    const sub = document.getElementById('notif-panel-sub');
    if (sub) {
      const unread = unreadCount();
      sub.textContent = items.length
        ? unread
          ? T('app.notif.unreadOfTotal', '{unread} unread · {total} total', {
              unread: unread,
              total: items.length,
            })
          : T('app.notif.count', '{count} notifications', { count: items.length })
        : T('app.notif.tagline', 'Stay on top of logs, stakes & rewards');
    }
    if (!list) return;
    if (!items.length) {
      list.innerHTML =
        '<div class="empty-state notif-empty-state">' +
        '<p class="adopt-empty-lead">' +
        esc(T('app.notif.emptyLead', 'Inbox is clear')) +
        '</p>' +
        '<p class="adopt-empty-body">' +
        esc(
          T(
            'app.notif.emptyBody',
            'Care reminders, stake updates, and journal confirmations show up here — so nothing slips mid-cycle.'
          )
        ) +
        '</p>' +
        '</div>' +
        '<div class="notif-panel-foot">' +
        '<button type="button" class="btn btn-ghost btn-sm notif-load-examples" id="notif-load-examples">' +
      esc(T('app.notif.loadExamples', 'Load examples')) +
      '</button>' +
        '</div>';
      return;
    }
    list.innerHTML =
      items
        .map(function (n) {
          const typeLabel = n.type ? String(n.type).replace(/_/g, ' ') : '';
          return (
            '<button type="button" class="notif-item' +
            (n.read ? '' : ' notif-item--unread') +
            '" data-id="' +
            esc(n.id) +
            '">' +
            '<span class="notif-item-dot" aria-hidden="true"></span>' +
            '<span class="notif-item-title">' +
            esc(n.title || T('app.notif.update', 'Update')) +
            '</span>' +
            '<span class="notif-item-body">' +
            esc(n.body || '') +
            '</span>' +
            '<span class="notif-item-meta">' +
            '<span class="notif-chip">' +
            esc(relativeTime(n.createdAt) || T('app.notif.now', 'now')) +
            '</span>' +
            (typeLabel ? '<span class="notif-chip">' + esc(typeLabel) + '</span>' : '') +
            (n.meta && n.meta.demo
              ? '<span class="notif-chip">' + esc(T('app.notif.example', 'example')) + '</span>'
              : '') +
            '</span>' +
            '</button>'
          );
        })
        .join('') +
      '<div class="notif-panel-foot">' +
      '<button type="button" class="btn btn-ghost btn-sm notif-load-examples" id="notif-load-examples">' +
      esc(T('app.notif.loadExamples', 'Load examples')) +
      '</button>' +
      '</div>';
  }

  function renderBell() {
    const badge = document.getElementById('notif-badge');
    const dot = document.getElementById('notif-dot');
    const btn = document.getElementById('notif-bell-btn');
    const count = unreadCount();
    if (badge) {
      badge.hidden = true;
      badge.textContent = count > 99 ? '99+' : String(count);
    }
    if (dot) {
      dot.hidden = count === 0;
    }
    if (btn) {
      btn.classList.toggle('has-unread', count > 0);
      btn.setAttribute(
        'aria-label',
        count
          ? T('app.notif.bellAriaUnread', 'Inbox, {count} unread', { count: count })
          : T('app.notif.bellAria', 'Inbox')
      );
    }
    if (panelOpen) renderPanelList();
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    const overlay = document.getElementById('notif-overlay');
    const btn = document.getElementById('notif-bell-btn');
    if (overlay) overlay.hidden = !panelOpen;
    if (btn) btn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    document.body.classList.toggle('notif-open', panelOpen);
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
                title: T('app.notif.seedMinted', 'Seed NFT minted'),
                body: T('app.notif.seedMintedBody', '{plant} is on-chain.', {
                  plant: m.name || T('app.stage.seed', 'Seed'),
                }),
                meta: { key: 'seed:' + id + ':minted', requestId: id, mintAddress: m.mintAddress },
                action: { view: 'adopt' },
                kind: 'success',
                dedupKey: 'seed:' + id + ':minted',
              });
            } else if (to === 'failed') {
              push({
                type: 'seed_mint',
                title: T('app.notif.seedFailed', 'Seed mint failed'),
                body: m.error || T('app.notif.seedFailedBody', 'Check the Tokenise queue.'),
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
                title: T('app.notif.growthMinted', 'Growth stage minted'),
                body:
                  T('app.notif.growthMintedBody', '{plant} → {stage}', {
                    plant: g.name || T('app.stack.plant', 'Plant'),
                    stage: g.stage || T('app.notif.nextStage', 'next'),
                  }) + (g.reward ? ' · +' + g.reward + ' $GROWTOO' : ''),
                meta: { key: 'growth:' + id + ':minted', requestId: id, stage: g.stage },
                action: { view: 'adopt', plantId: g.plantId || null },
                kind: 'success',
                dedupKey: 'growth:' + id + ':minted',
              });
            } else if (to === 'failed') {
              push({
                type: 'growth_mint',
                title: T('app.notif.growthFailed', 'Growth mint failed'),
                body: g.error || T('app.notif.growthFailedBody', 'Journal proof or queue error.'),
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
                    title: T('app.notif.stakeReleased', 'Harvest stake released'),
                    body: T(
                      'app.notif.stakeReleasedBody',
                      'Locked $GROWTOO for "{plant}" released to you.',
                      { plant: l.name || T('app.notif.plantLower', 'plant') }
                    ),
                    meta: { key: 'harvest:' + l.id + ':released', listingId: l.id },
                    action: { view: 'market', listingId: l.id },
                    kind: 'success',
                    dedupKey: 'harvest:' + l.id + ':released',
                  });
                } else if (to === 'refunded') {
                  push({
                    type: 'harvest_claim',
                    title: T('app.notif.stakeRefunded', 'Harvest stake refunded'),
                    body: T(
                      'app.notif.stakeRefundedBody',
                      'Locked $GROWTOO for "{plant}" returned to the adopter.',
                      { plant: l.name || T('app.notif.plantLower', 'plant') }
                    ),
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
                  title:
                    to === 'released'
                      ? T('app.notif.growerUnlocked', 'Grower unlocked full stake')
                      : T('app.notif.lockedRefunded', 'Locked stake refunded'),
                  body: T(
                    'app.notif.careSettledBody',
                    '"{plant}" monthly care settled · {status}.',
                    { plant: l.name || T('app.stack.plant', 'Plant'), status: to }
                  ),
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
            const isFaucet = d.source === 'adopter_faucet';
            if (to === 'minted') {
              push({
                type: isFaucet ? 'test_faucet' : 'platform_bonus',
                title: isFaucet
                  ? T('app.notif.faucetClaimed', 'Test $GROWTOO claimed')
                  : T('app.notif.bonusMinted', 'Platform bonus minted'),
                body: isFaucet
                  ? T('app.notif.faucetBody', '+{amount} $GROWTOO sent to your Devnet wallet.', {
                      amount: d.reward || 0,
                    })
                  : T('app.notif.bonusBody', '+{amount} $GROWTOO for {month}.', {
                      amount: d.reward || 0,
                      month: d.monthKey || T('app.notif.thisMonth', 'this month'),
                    }),
                meta: {
                  key: (isFaucet ? 'faucet:' : 'platform:') + d.id + ':minted',
                  monthKey: d.monthKey,
                  dayKey: d.dayKey,
                },
                action: { view: isFaucet ? 'market' : 'adopt' },
                kind: 'success',
                dedupKey: (isFaucet ? 'faucet:' : 'platform:') + d.id + ':minted',
              });
              if (!isFaucet) {
                try {
                  window.dispatchEvent(
                    new CustomEvent('growtoo:reward', {
                      detail: {
                        kind: 'claimed',
                        xp: 0,
                        claimed: d.reward || 0,
                        preview: { reward: d.reward || 0, cap: 50 },
                      },
                    })
                  );
                } catch (_) {
                  /* ignore */
                }
              }
            } else if (to === 'failed') {
              push({
                type: isFaucet ? 'test_faucet' : 'platform_bonus',
                title: isFaucet
                  ? T('app.notif.faucetFailed', 'Test faucet failed')
                  : T('app.notif.bonusFailed', 'Platform bonus failed'),
                body:
                  d.error ||
                  (isFaucet
                    ? T('app.notif.faucetFailedBody', 'Retry the faucet claim from Market.')
                    : T('app.notif.bonusFailedBody', 'Try claiming again next month window.')),
                meta: {
                  key: (isFaucet ? 'faucet:' : 'platform:') + d.id + ':failed',
                  monthKey: d.monthKey,
                },
                action: { view: isFaucet ? 'market' : 'adopt' },
                kind: 'error',
                dedupKey: (isFaucet ? 'faucet:' : 'platform:') + d.id + ':failed',
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
                title:
                  to === 'released'
                    ? T('app.notif.claimReleased', 'Harvest claim released')
                    : T('app.notif.claimRefunded', 'Harvest claim refunded'),
                body: T('app.notif.claimBody', 'Stake settlement finished · {status}.', {
                  status: to,
                }),
                meta: { key: 'hclaim:' + d.id + ':' + to, listingId: d.listingId },
                action: { view: 'adopt' },
                kind: to === 'released' ? 'success' : 'info',
                dedupKey: 'hclaim:' + d.id + ':' + to,
              });
            } else if (to === 'failed') {
              push({
                type: 'harvest_claim',
                title: T('app.notif.claimFailed', 'Harvest claim failed'),
                body:
                  d.error ||
                  T('app.notif.claimFailedBody', 'Check journal care months and retry.'),
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

  function notifyActivityReward(detail) {
    const d = detail || {};
    const kind = String(d.kind || 'care');
    const titles = {
      watering: T('app.notif.rewardCareDay', 'Care day counted'),
      feeding: T('app.daily.rewardFeeding', 'Feeding counted'),
      stageLogged: T('app.daily.rewardStage', 'Stage logged'),
      story_published: T('app.daily.rewardStory', 'Story published'),
      claimed: T('app.notif.rewardBonusMinted', 'Activity bonus minted'),
    };
    const preview = d.preview || {};
    const reward = preview.reward != null ? preview.reward : d.claimed;
    const xpBit = d.xp ? '+' + d.xp + ' XP' : '';
    const tokenBit =
      d.kind === 'claimed'
        ? T('app.notif.sentToWallet', '+{amount} $GROWTOO sent to your wallet', {
            amount: d.claimed || reward || 0,
          })
        : T('app.notif.thisMonthAmount', '~{amount} $GROWTOO this month', {
            amount: reward || 0,
          });
    const day = new Date().toISOString().slice(0, 10);
    push({
      type: 'activity_reward',
      title: titles[kind] || T('app.daily.rewardDefault', 'Grower reward'),
      body: [xpBit, tokenBit].filter(Boolean).join(' · '),
      meta: { key: 'activity_reward:' + kind + ':' + day, kind: kind },
      action: { view: kind === 'claimed' ? 'adopt' : 'plants' },
      kind: 'success',
      dedupKey: 'activity_reward:' + kind + ':' + day,
      toast: false,
    });
  }

  function notifyCareProgress(kind, plantId, plantName, periodKey, daysHit, minDays) {
    if (!plantId || !periodKey) return;
    // Self-progress after your own logs — toast only. Inbox stays for attention items.
    const dedup = (kind === 'week' ? 'care_week' : 'care_month') + ':' + plantId + ':' + periodKey;
    if (shouldSkipDedup(kind === 'week' ? 'care_week' : 'care_month', dedup)) return;
    toast(
      kind === 'week'
        ? T('app.notif.careWeekToast', '{plant} · weekly care {hit}/{need} days', {
            plant: plantName || T('app.stack.plant', 'Plant'),
            hit: daysHit,
            need: minDays,
          })
        : T('app.notif.careMonthToast', '{plant} · monthly care {hit}/{need} days', {
            plant: plantName || T('app.stack.plant', 'Plant'),
            hit: daysHit,
            need: minDays,
          }),
      'success'
    );
  }

  function localDayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /** Push care-due reminders into the inbox so the bell badge earns its place. */
  function syncCareDueFromCoach() {
    if (!window.AICoach || typeof AICoach.getReminders !== 'function') return;
    let reminders = [];
    try {
      reminders = AICoach.getReminders() || [];
    } catch {
      return;
    }
    const day = localDayKey();
    reminders.forEach(function (r) {
      if (!r || !r.id) return;
      const id = String(r.id);
      const isCare =
        id.indexOf('watering:') === 0 ||
        id.indexOf('feeding:') === 0 ||
        id.indexOf('predict-') === 0;
      if (!isCare) return;
      push({
        type: 'care_due',
        title: r.title || T('app.notif.careReminder', 'Care reminder'),
        body: r.message || T('app.notif.careReminderBody', 'A plant needs attention.'),
        meta: { key: 'care-due:' + id + ':' + day, plantId: r.plantId || null, reminderId: id },
        action: { view: 'plants', plantId: r.plantId || null, coachDraft: id },
        kind: r.severity === 'urgent' || r.kind === 'predictive' ? 'warn' : 'info',
        dedupKey: 'care-due:' + id + ':' + day,
        toast: false,
      });
    });
  }

  /** Journal types are stored as Croatian keys; UI copy stays English. */
  /* [dictionary key, English] — resolved in entryTypeLabel(), because this
     table is built while the page parses, before the dictionary loads. */
  var ENTRY_TYPE_LABELS = {
    opcenito: ['app.entryType.general', 'General'],
    zalijevanje: ['app.entryType.watering', 'Watering'],
    gnojidba: ['app.entryType.feeding', 'Feeding'],
    okolis: ['app.entryType.environment', 'Environment'],
    presadjivanje: ['app.entryType.transplanting', 'Transplanting'],
    stresori: ['app.entryType.stressors', 'Stressors'],
    ostalo: ['app.entryType.other', 'Other'],
    faza: ['app.entryType.stage', 'Stage'],
    podfaza: ['app.entryType.subphase', 'Sub-phase'],
  };

  function entryTypeLabel(type) {
    var key = String(type || '').trim();
    if (!key) return T('app.entryType.entry', 'Entry');
    var row = ENTRY_TYPE_LABELS[key];
    return row ? T(row[0], row[1]) : key;
  }

  /**
   * Confirm the user's own journal write as a toast only.
   * Never badge the inbox for "you logged watering" — that trains people to ignore the bell.
   * @param {object} entry
   * @param {string} [plantName]
   * @param {{ toast?: boolean }} [opts]
   */
  function notifyJournalEntry(entry, plantName, opts) {
    if (!entry) return;
    const o = opts || {};
    if (o.toast === false) return;
    const typeLabel = entryTypeLabel(entry.type);
    toast(
      plantName
        ? T('app.notif.loggedForPlant', 'Logged {type} for {plant}', {
            type: typeLabel,
            plant: plantName,
          })
        : T('app.notif.logged', 'Logged {type}', { type: typeLabel }),
      'success'
    );
  }

  function bindUi() {
    const btn = document.getElementById('notif-bell-btn');
    const overlay = document.getElementById('notif-overlay');
    const panel = document.getElementById('notif-panel');
    const markAll = document.getElementById('notif-mark-all');
    const closeBtn = document.getElementById('notif-close');
    const backdrop = document.getElementById('notif-backdrop');
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

    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setPanelOpen(false);
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', function () {
        setPanelOpen(false);
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

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelOpen) setPanelOpen(false);
    });

    document.addEventListener('click', function (e) {
      if (!panelOpen) return;
      if (e.target.closest('#notif-overlay') || e.target.closest('#notif-bell-btn')) return;
      // Desktop: ignore; overlay backdrop handles dismiss
      if (overlay && !overlay.hidden) return;
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
        title: T('app.notif.demo.journalTitle', 'Journal log saved'),
        body: T('app.notif.demo.journalBody', 'Northern Lights · Watering — Morning feed complete.'),
        createdAt: iso(5),
        meta: { key: 'demo:journal', plantId: null, demo: true },
        action: { view: 'plants' },
      },
      {
        type: 'care_week',
        title: T('app.notif.demo.weekTitle', 'Weekly care qualified'),
        body: T('app.notif.demo.weekBody', 'OG Kush hit 5/5 care days · this week (grower progress).'),
        createdAt: iso(25),
        meta: { key: 'demo:care_week', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'care_month',
        title: T('app.notif.demo.monthTitle', 'Monthly care qualified'),
        body: T('app.notif.demo.monthBody', 'OG Kush hit 12/12 care days · harvest unlock path.'),
        createdAt: iso(40),
        meta: { key: 'demo:care_month', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'stake_received',
        title: T('app.notif.demo.stakeTitle', 'New adopt stake'),
        body: T('app.notif.demo.stakeBody', 'An adopter staked 100 $GROWTOO on "Batch B-2026-07" (50% locked until monthly care).'),
        createdAt: iso(90),
        meta: { key: 'demo:stake', demo: true, priceGrow: 100 },
        action: { view: 'market' },
      },
      {
        type: 'seed_mint',
        title: 'Seed NFT minted',
        body: T('app.notif.demo.seedBody', 'Northern Lights is on-chain.'),
        createdAt: iso(180),
        meta: { key: 'demo:seed', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'growth_mint',
        title: 'Growth stage minted',
        body: T('app.notif.demo.growthBody', 'Northern Lights → vegetative · +35 $GROWTOO'),
        createdAt: iso(200),
        meta: { key: 'demo:growth', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'platform_bonus',
        title: 'Platform bonus minted',
        body: T('app.notif.demo.bonusBody', '+18 $GROWTOO for this month (plants, weeks, flower).'),
        createdAt: iso(360),
        meta: { key: 'demo:platform', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'harvest_claim',
        title: 'Harvest stake released',
        body: T('app.notif.demo.releasedBody', 'Locked $GROWTOO for "Batch B-2026-07" released to you.'),
        createdAt: iso(500),
        meta: { key: 'demo:harvest', demo: true },
        action: { view: 'adopt' },
      },
    ];
    const adopter = [
      {
        type: 'sale_settled',
        title: T('app.notif.demo.investTitle', 'Investment complete'),
        body: T('app.notif.demo.investBody', 'You adopted "Northern Lights" for 80 $GROWTOO.'),
        createdAt: iso(8),
        meta: { key: 'demo:buy', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'sale_settled',
        title: T('app.notif.demo.activeTitle', 'Adopt stake active'),
        body: T('app.notif.demo.activeBody', 'You hold "Batch B-2026-07". Locked half unlocks when monthly care qualifies at harvest.'),
        createdAt: iso(30),
        meta: { key: 'demo:adopt_active', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'sale_settled',
        title: 'Grower unlocked full stake',
        body: T('app.notif.demo.settledBody', '"Batch B-2026-07" monthly care settled · released.'),
        createdAt: iso(120),
        meta: { key: 'demo:unlock', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'sale_settled',
        title: T('app.notif.demo.deliveredTitle', 'NFT delivered'),
        body: T('app.notif.demo.deliveredBody', '"OG Kush" is in your garden.'),
        createdAt: iso(240),
        meta: { key: 'demo:delivered', demo: true },
        action: { view: 'adopt' },
      },
      {
        type: 'system',
        title: T('app.notif.demo.updateTitle', 'Monthly care update'),
        body: T('app.notif.demo.updateBody', 'Grower is documenting care on your adopted plant — unlock status updates at harvest.'),
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
      toast(
        T('app.notif.examplesLoaded', 'Loaded {count} example notifications', { count: written }),
        'info'
      );
    }
    return written;
  }

  function init() {
    ensureToastHost();
    bindUi();
    renderBell();
  }

  function shortPubkey(pk) {
    const s = String(pk || '');
    if (s.length < 12) return s;
    return s.slice(0, 4) + '…' + s.slice(-4);
  }

  /**
   * After login / account switch: account link stays in Firestore, but the
   * browser wallet session (Phantom/Solflare) is gone — standard web3.
   * Warn once per tab session until they reconnect or sign out.
   */
  function promptWalletReconnectIfNeeded(opts) {
    const o = opts || {};
    const user = currentUser();
    if (!user) return false;

    const linked =
      (o.linkedPubkey && String(o.linkedPubkey)) ||
      (window.WalletLink && typeof WalletLink.getProfile === 'function'
        ? String((WalletLink.getProfile() || {}).solanaPubkey || '')
        : '');
    if (!linked) return false;

    const SW = window.SolanaWallet;
    const livePk =
      SW && typeof SW.isConnected === 'function' && SW.isConnected() && typeof SW.getPublicKey === 'function'
        ? String(SW.getPublicKey() || '')
        : '';
    if (livePk && livePk === linked) return false;

    const sessionKey = 'dnevnik.walletReconnectWarned:' + user.uid;
    try {
      if (sessionStorage.getItem(sessionKey) === '1') return false;
      sessionStorage.setItem(sessionKey, '1');
    } catch {
      // ignore — still push once via dedup
    }

    const view =
      o.view ||
      (document.body && document.body.dataset.profileType === 'adopter' ? 'adopt' : 'market');

    push({
      type: 'wallet_reconnect',
      title: T('app.notif.reconnectTitle', 'Reconnect your Solana wallet'),
      body: T(
        'app.notif.reconnectBody',
        'Signing out (or switching accounts) ends the browser wallet session — normal for Phantom/Solflare. Your account stays linked to {pubkey}. Tap Reconnect to invest, mint, or list RWAs.',
        { pubkey: shortPubkey(linked) }
      ),
      action: { view: view },
      kind: 'warn',
      toastMsg: T(
        'app.notif.reconnectToast',
        'Wallet session ended — reconnect {pubkey} to sign.',
        { pubkey: shortPubkey(linked) }
      ),
      dedupKey: 'wallet-reconnect:' + user.uid,
      meta: { key: 'wallet-reconnect:' + user.uid, pubkey: linked },
    });
    return true;
  }

  /** Call on logout so the next sign-in can warn again. */
  function clearWalletReconnectPrompt(uid) {
    const id = uid ? String(uid) : '';
    try {
      if (id) sessionStorage.removeItem('dnevnik.walletReconnectWarned:' + id);
    } catch {
      // ignore
    }
    if (!id) return;
    try {
      const map = readDedup();
      delete map[dedupKey('wallet_reconnect', 'wallet-reconnect:' + id)];
      writeDedup(map);
    } catch {
      // ignore
    }
  }

  window.DnevnikNotifications = {
    init: init,
    startWatch: startWatch,
    stopWatch: stopWatch,
    push: push,
    pushToUser: pushToUser,
    toast: toast,
    promptWalletReconnectIfNeeded: promptWalletReconnectIfNeeded,
    clearWalletReconnectPrompt: clearWalletReconnectPrompt,
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
    notifyActivityReward: notifyActivityReward,
    notifyJournalEntry: notifyJournalEntry,
    entryTypeLabel: entryTypeLabel,
    syncCareDueFromCoach: syncCareDueFromCoach,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
