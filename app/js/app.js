(function () {
  const STORAGE_AUTH = 'dnevnik-live-auth';
  const STORAGE_PENDING_PROFILE = 'dnevnik-live-pending-profile-type';
  const PROFILE_TYPES = { grower: 'grower', adopter: 'adopter' };
  if (!localStorage.getItem(STORAGE_AUTH)) {
    window.location.replace('../dnevnik/');
    return;
  }

  const STORAGE_PLANTS = 'dnevnik-live-plants';
  const STORAGE_ENTRIES = 'dnevnik-live-entries';
  const STORAGE_TOOLBOX = 'dnevnik-live-toolbox';
  const STORAGE_TODAY_STATE = 'dnevnik-live-today-state';

  // One-time migration from previous storage keys (older branding).
  (function migrateOldStorageKeys() {
    const flagKey = 'dnevnik-live-migrated-v1';
    if (localStorage.getItem(flagKey)) return;
    const prevBrandPrefix = 'ba' + 'lpha-shop';
    const pairs = [
      ['balkan-pharm-plants', STORAGE_PLANTS],
      ['balkan-pharm-entries', STORAGE_ENTRIES],
      ['balkan-pharm-toolbox', STORAGE_TOOLBOX],
      ['balkan-pharm-auth', STORAGE_AUTH],
      // Legacy keys from previous branding phase.
      ['legacy-balpha-shop-plants', STORAGE_PLANTS],
      ['legacy-balpha-shop-entries', STORAGE_ENTRIES],
      ['legacy-balpha-shop-toolbox', STORAGE_TOOLBOX],
      ['legacy-balpha-shop-auth', STORAGE_AUTH],
      // Keep direct compatibility if users still have raw old keys.
      [prevBrandPrefix + '-plants', STORAGE_PLANTS],
      [prevBrandPrefix + '-entries', STORAGE_ENTRIES],
      [prevBrandPrefix + '-toolbox', STORAGE_TOOLBOX],
      [prevBrandPrefix + '-auth', STORAGE_AUTH],
    ];
    pairs.forEach(([oldKey, newKey]) => {
      try {
        const hasNew = localStorage.getItem(newKey);
        const oldVal = localStorage.getItem(oldKey);
        if (!hasNew && oldVal) localStorage.setItem(newKey, oldVal);
      } catch {
        // ignore
      }
    });
    try {
      localStorage.setItem(flagKey, String(Date.now()));
    } catch {
      // ignore
    }
  })();

  let remoteSyncReady = false;
  let remoteSyncTimer = null;
  let remoteSyncPending = {};
  let remoteSyncInFlight = false;
  let isAdminReadOnly = false;
  let readOnlyBannerMessage = '';
  let sharedReadOnlyPlantIds = new Set();
  let sharedReadOnlyEntryIds = new Set();

  const SHARED_HYBRID_ACCESS_EMAILS = [
    'filip.balkanpharm@gmail.com',
    'marko.matosevic2005@gmail.com',
  ];
  const SOIL_MOISTURE_TOOL_EMAILS = ['marko.matosevic2005@gmail.com'];
  const LOGIN_EVENT_SESSION_KEY = 'dnevnik-login-event-recorded';
  let adminReportPeriod = 'daily';

  function getCurrentUserEmail() {
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.email || '';
      }
    } catch {
      // ignore
    }
    const auth = getStoredAuth();
    return (auth && auth.email) || '';
  }

  function canUseSoilMoistureTool(email, role) {
    if (isSuperadminRole(role)) return true;
    return SOIL_MOISTURE_TOOL_EMAILS.includes((email || '').toLowerCase());
  }

  function reloadSoilMoistureIframe(selector) {
    const iframe = document.querySelector(selector);
    if (!iframe) return;
    try {
      if (iframe.contentWindow) iframe.contentWindow.location.reload();
    } catch {
      iframe.src = iframe.src.split('?')[0] + '?v=' + Date.now();
    }
  }

  function applySoilMoistureToolUI(role) {
    const show = canUseSoilMoistureTool(getCurrentUserEmail(), role);
    document.body.classList.toggle('soil-moisture-tool-visible', show);
  }

  function isSharedHybridUser(email) {
    return SHARED_HYBRID_ACCESS_EMAILS.includes((email || '').toLowerCase());
  }

  function isSharedPlantId(plantId) {
    return !!(plantId && sharedReadOnlyPlantIds.has(plantId));
  }

  function isSharedEntryId(entryId) {
    return !!(entryId && sharedReadOnlyEntryIds.has(entryId));
  }

  function stripSharedMeta(record) {
    if (!record || typeof record !== 'object') return record;
    const copy = Object.assign({}, record);
    delete copy._sharedReadOnly;
    delete copy._sharedOwnerUid;
    return copy;
  }

  function plantsForRemoteSync(plants) {
    return (plants || [])
      .filter((p) => p && p.id && !isSharedPlantId(p.id))
      .map(stripSharedMeta);
  }

  function entriesForRemoteSync(entries) {
    return (entries || [])
      .filter((e) => e && e.id && !isSharedEntryId(e.id))
      .map(stripSharedMeta);
  }

  function tagSharedRecords(plants, entries, ownerUid) {
    const owner = ownerUid || null;
    return {
      plants: (plants || []).map((p) =>
        Object.assign({}, p, { _sharedReadOnly: true, _sharedOwnerUid: owner })
      ),
      entries: (entries || []).map((e) =>
        Object.assign({}, e, { _sharedReadOnly: true, _sharedOwnerUid: owner })
      ),
    };
  }

  function registerSharedReadOnlyIds(plants, entries) {
    sharedReadOnlyPlantIds = new Set();
    sharedReadOnlyEntryIds = new Set();
    (plants || []).forEach((p) => {
      if (p && p.id) sharedReadOnlyPlantIds.add(p.id);
    });
    (entries || []).forEach((e) => {
      if (e && e.id) sharedReadOnlyEntryIds.add(e.id);
    });
  }

  function getStoredAuth() {
    try {
      const raw = localStorage.getItem(STORAGE_AUTH);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function getFirebaseUserId() {
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.uid;
      }
    } catch {
      // ignore
    }
    const auth = getStoredAuth();
    return auth && auth.uid ? auth.uid : null;
  }

  function getStateDocRef(uid) {
    if (!uid || !window.firebase || !firebase.firestore) return null;
    return firebase.firestore().collection('users').doc(uid).collection('app').doc('state');
  }

  function scheduleRemoteSync(patch) {
    if (isAdminReadOnly || !remoteSyncReady) return;
    remoteSyncPending = Object.assign(remoteSyncPending, patch || {});
    if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
    remoteSyncTimer = setTimeout(() => {
      flushRemoteSync();
    }, 500);
  }

  async function flushRemoteSync() {
    if (remoteSyncInFlight) return;
    const uid = getFirebaseUserId();
    const ref = getStateDocRef(uid);
    if (!ref) return;
    const payload = Object.assign({}, remoteSyncPending);
    if (!Object.keys(payload).length) return;
    remoteSyncPending = {};
    remoteSyncInFlight = true;
    try {
      // Always push the latest local snapshot for requested keys — never a stale
      // array captured before a second write landed during an in-flight sync.
      if (Object.prototype.hasOwnProperty.call(payload, 'entries')) {
        payload.entries = entriesForRemoteSync(getEntries());
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'plants')) {
        payload.plants = plantsForRemoteSync(getPlants());
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'toolbox')) {
        try {
          payload.toolbox = JSON.parse(localStorage.getItem(STORAGE_TOOLBOX) || '{}') || {};
        } catch (_) {
          /* keep pending toolbox */
        }
      }
      payload.updatedAt = Date.now();
      await ref.set(payload, { merge: true });
    } catch (err) {
      console.warn('Remote journal sync failed — keeping local copy', err);
      // Re-queue so the next edit / retry can push again.
      remoteSyncPending = Object.assign({}, payload, remoteSyncPending);
      delete remoteSyncPending.updatedAt;
    } finally {
      remoteSyncInFlight = false;
      if (Object.keys(remoteSyncPending).length) flushRemoteSync();
    }
  }

  async function loadRemoteStateIntoLocal(uid) {
    const ref = getStateDocRef(uid);
    if (!ref) return null;
    try {
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      return {
        plants: Array.isArray(data.plants) ? data.plants : [],
        entries: Array.isArray(data.entries) ? data.entries : [],
        toolbox: data.toolbox && typeof data.toolbox === 'object' ? data.toolbox : {},
      };
    } catch {
      return null;
    }
  }

  function applyRemoteStateToLocal(state) {
    if (!state) return;
    localStorage.setItem(STORAGE_PLANTS, JSON.stringify(state.plants || []));
    localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(state.entries || []));
    localStorage.setItem(STORAGE_TOOLBOX, JSON.stringify(state.toolbox || {}));
  }

  /** Merge cloud + device so a slow sync / auth reload cannot erase a just-saved entry. */
  function mergeLocalWithRemoteState(remote) {
    const remoteSafe = remote || { plants: [], entries: [], toolbox: {} };
    let localPlants = [];
    let localEntries = [];
    let localToolbox = {};
    try {
      localPlants = JSON.parse(localStorage.getItem(STORAGE_PLANTS) || '[]') || [];
    } catch (_) {
      localPlants = [];
    }
    try {
      localEntries = JSON.parse(localStorage.getItem(STORAGE_ENTRIES) || '[]') || [];
    } catch (_) {
      localEntries = [];
    }
    try {
      localToolbox = JSON.parse(localStorage.getItem(STORAGE_TOOLBOX) || '{}') || {};
    } catch (_) {
      localToolbox = {};
    }
    // Local wins on id collision (device is source of truth for in-session writes).
    return {
      plants: mergeRecordsById(remoteSafe.plants || [], localPlants),
      entries: mergeRecordsById(remoteSafe.entries || [], localEntries),
      toolbox: Object.assign({}, remoteSafe.toolbox || {}, localToolbox),
    };
  }

  function mergeRecordsById(existing, incoming) {
    const map = new Map();
    (existing || []).forEach((item) => {
      if (item && item.id) map.set(item.id, item);
    });
    (incoming || []).forEach((item) => {
      if (item && item.id) map.set(item.id, item);
    });
    return Array.from(map.values());
  }

  function convertFirestorePlantDoc(docId, data) {
    if (!data || typeof data !== 'object') return null;
    const m = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    const name = (m.naziv || data.name || data.naziv || '').trim();
    if (!name) return null;
    return {
      id: m.plantId || data.plantId || docId,
      name,
      strain: m.sorta || data.strain || '',
      count: Math.max(1, Number(data.count ?? m.count ?? 1) || 1),
      stage: m.stage || data.stage || 'klijanje',
      subphase: data.subphase || m.subphase || null,
      startDate: data.startDate || m.startDate || null,
      environmentName: data.environmentName || m.environmentName || null,
      environmentType: data.environmentType || m.environmentType || 'indoor',
      fieldLocation: data.fieldLocation || m.fieldLocation || null,
      plantingLocation: data.plantingLocation || m.plantingLocation || null,
      exposureHours: data.exposureHours ?? m.exposureHours ?? null,
      notes: data.notes || m.notes || '',
      photo: data.photo || m.photo || null,
      updatedAt: data.updatedAt || new Date().toISOString(),
      views: data.views ?? 0,
      stageHistory: data.stageHistory || [],
      stageDates: data.stageDates || {},
      subphaseHistory: data.subphaseHistory || [],
    };
  }

  function convertFirestoreEntryDoc(docId, data) {
    if (!data || typeof data !== 'object') return null;
    const m = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    const plantId = data.plantId || m.plantId || null;
    return {
      id: data.entryId || docId,
      plantId,
      date: data.date || data.createdAt || null,
      type: data.type || 'opcenito',
      note: data.note || data.text || '',
      photo: data.photo || null,
      video: data.video || null,
      meta: data.meta || undefined,
    };
  }

  async function findSuperadminUserIds() {
    if (!window.firebase || !firebase.firestore) return [];
  const ids = new Set();
    try {
      for (const roleName of ['superadmin', 'supadmin']) {
        const snap = await firebase.firestore().collection('users').where('role', '==', roleName).get();
        snap.docs.forEach((d) => ids.add(d.id));
      }
      return Array.from(ids);
    } catch (err) {
      console.warn('Superadmin lookup failed', err);
      return [];
    }
  }

  async function loadFirestorePlantsAndEntries() {
    if (!window.firebase || !firebase.firestore) return { plants: [], entries: [] };
    const plants = [];
    const entries = [];
    try {
      const plantsSnap = await firebase.firestore().collection('plants').get();
      plantsSnap.forEach((docSnap) => {
        const p = convertFirestorePlantDoc(docSnap.id, docSnap.data());
        if (p) plants.push(p);
      });
    } catch (err) {
      console.warn('Firestore plants load failed', err);
    }
    try {
      const entriesSnap = await firebase.firestore().collection('entries').get();
      entriesSnap.forEach((docSnap) => {
        const e = convertFirestoreEntryDoc(docSnap.id, docSnap.data());
        if (e) entries.push(e);
      });
    } catch (err) {
      console.warn('Firestore entries load failed', err);
    }
    return { plants, entries };
  }

  function getSharedGrantsRef(ownerUid, viewerUid) {
    if (!ownerUid || !viewerUid || !window.firebase || !firebase.firestore) return null;
    return firebase
      .firestore()
      .collection('users')
      .doc(ownerUid)
      .collection('sharedGrants')
      .doc(viewerUid);
  }

  function getLocalDayKey(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatReportDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function formatReportDayLabel(dayKey) {
    if (!dayKey) return '—';
    try {
      const [y, m, d] = dayKey.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      const today = getLocalDayKey();
      const label = dt.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      if (dayKey === today) return `Danas · ${label}`;
      return label;
    } catch {
      return dayKey;
    }
  }

  function startOfPeriodMs(period) {
    const now = new Date();
    if (period === 'daily') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    }
    const week = new Date(now);
    week.setDate(week.getDate() - 6);
    week.setHours(0, 0, 0, 0);
    return week.getTime();
  }

  async function recordUserLogin(user, role) {
    if (!user || !window.firebase || !firebase.firestore) return;
    const sessionKey = `${LOGIN_EVENT_SESSION_KEY}:${user.uid}`;
    try {
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, String(Date.now()));
    } catch {
      // ignore
    }

    const loggedAt = new Date().toISOString();
    try {
      await firebase.firestore().collection('loginEvents').add({
        uid: user.uid,
        email: (user.email || '').toLowerCase(),
        role: role || 'user',
        loggedAt,
        dayKey: getLocalDayKey(),
      });
    } catch (err) {
      console.warn('Login event record failed', err);
    }
  }

  async function fetchLoginEventsSince(period) {
    if (!window.firebase || !firebase.firestore) return [];
    const sinceIso = new Date(startOfPeriodMs(period)).toISOString();
    try {
      const snap = await firebase
        .firestore()
        .collection('loginEvents')
        .where('loggedAt', '>=', sinceIso)
        .orderBy('loggedAt', 'desc')
        .limit(400)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('Login events query failed, using fallback', err);
      try {
        const snap = await firebase
          .firestore()
          .collection('loginEvents')
          .orderBy('loggedAt', 'desc')
          .limit(400)
          .get();
        return snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((e) => e.loggedAt && e.loggedAt >= sinceIso);
      } catch {
        return [];
      }
    }
  }

  function buildLoginUserSummary(events, users) {
    const byUid = new Map();
    (events || []).forEach((e) => {
      const key = e.uid || e.email || e.id;
      if (!key) return;
      const prev = byUid.get(key) || {
        uid: e.uid,
        email: e.email || '—',
        role: e.role || 'user',
        count: 0,
        lastLoginAt: null,
      };
      prev.count += 1;
      if (!prev.lastLoginAt || (e.loggedAt && e.loggedAt > prev.lastLoginAt)) {
        prev.lastLoginAt = e.loggedAt;
        prev.role = e.role || prev.role;
        prev.email = e.email || prev.email;
      }
      byUid.set(key, prev);
    });

    (users || []).forEach((u) => {
      if (!u.lastLoginAt) return;
      const key = u.uid;
      const existing = byUid.get(key);
      if (existing) {
        if (u.lastLoginAt > (existing.lastLoginAt || '')) existing.lastLoginAt = u.lastLoginAt;
        if (u.email) existing.email = u.email;
        if (u.role) existing.role = u.role;
        return;
      }
      byUid.set(key, {
        uid: u.uid,
        email: u.email || '—',
        role: u.role || 'user',
        count: 0,
        lastLoginAt: u.lastLoginAt,
        fromProfileOnly: true,
      });
    });

    return Array.from(byUid.values()).sort((a, b) =>
      (b.lastLoginAt || '').localeCompare(a.lastLoginAt || '')
    );
  }

  function adminRoleBadge(role) {
    const r = (role || 'user').toLowerCase();
    const safe = escapeHtml(r);
    return `<span class="admin-role-badge admin-role-badge--${safe}">${safe}</span>`;
  }

  function adminGrantBadgesHtml(g) {
    const plantCount =
      Array.isArray(g.plantIds) && g.plantIds.length > 0 ? g.plantIds.length + ' plants' : 'All plants';
    const parts = [`<span class="admin-grant-badge admin-grant-badge--plants">🌱 ${escapeHtml(plantCount)}</span>`];
    if (g.shareEntries !== false) parts.push('<span class="admin-grant-badge admin-grant-badge--journal">📓 Journal</span>');
    if (g.shareToolbox) parts.push('<span class="admin-grant-badge admin-grant-badge--toolbox">🧰 Tools</span>');
    return parts.join('');
  }

  function groupLoginEventsByDay(events) {
    const map = new Map();
    (events || []).forEach((e) => {
      const day = e.dayKey || (e.loggedAt || '').slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(e);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }

  async function renderSuperadminUserReport(period) {
    const section = document.getElementById('admin-user-report-section');
    const panel = document.getElementById('admin-user-report-panel');
    if (!section || !panel || currentUserRole !== 'superadmin') return;

    adminReportPeriod = period || adminReportPeriod || 'daily';
    section.setAttribute('aria-hidden', 'false');
    panel.innerHTML = '<p class="admin-empty-state admin-loading-state">Loading report…</p>';

    section.querySelectorAll('.admin-report-period').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.period === adminReportPeriod);
    });

    const sinceIso = new Date(startOfPeriodMs(adminReportPeriod)).toISOString();
    const [events, usersRaw] = await Promise.all([
      fetchLoginEventsSince(adminReportPeriod),
      listFirestoreUsers(),
    ]);

    const todayKey = getLocalDayKey();
    const filteredEvents =
      adminReportPeriod === 'daily'
        ? events.filter((e) => (e.dayKey || (e.loggedAt || '').slice(0, 10)) === todayKey)
        : events;

    const usersInPeriod = usersRaw.filter((u) => u.lastLoginAt && u.lastLoginAt >= sinceIso);
    const uniqueUsers = new Set(filteredEvents.map((e) => e.uid || e.email).filter(Boolean));
    const summary = buildLoginUserSummary(filteredEvents, usersInPeriod);
    const periodLabel = adminReportPeriod === 'daily' ? 'today' : 'in the last 7 days';

    const summaryHtml =
      '<div class="admin-report-summary">' +
      `<div class="admin-report-stat admin-report-stat--logins"><strong>${filteredEvents.length}</strong><span>Logins ${periodLabel}</span></div>` +
      `<div class="admin-report-stat admin-report-stat--users"><strong>${uniqueUsers.size}</strong><span>Unique users</span></div>` +
      `<div class="admin-report-stat admin-report-stat--total"><strong>${summary.length}</strong><span>In summary</span></div>` +
      '</div>';

    const usersTableRows = summary.length
      ? summary
          .map(
            (u) =>
              '<tr>' +
              `<td class="admin-td-email">${escapeHtml(u.email)}</td>` +
              `<td>${adminRoleBadge(u.role)}</td>` +
              `<td class="admin-td-num">${u.count > 0 ? u.count : '—'}</td>` +
              `<td class="admin-td-time">${escapeHtml(formatReportDateTime(u.lastLoginAt))}</td>` +
              '</tr>'
          )
          .join('')
      : '<tr><td colspan="4" class="admin-empty-state">No logins in the selected period.</td></tr>';

    const usersTableHtml =
      '<div class="admin-report-block">' +
      '<h4 class="admin-subheading">Summary by user</h4>' +
      '<div class="admin-report-table-wrap"><table class="admin-report-table">' +
      '<thead><tr><th>Email</th><th>Role</th><th>Logins</th><th>Last login</th></tr></thead>' +
      `<tbody>${usersTableRows}</tbody></table></div></div>`;

    let detailHtml = '<div class="admin-report-block admin-report-block--detail">';
    detailHtml += '<h4 class="admin-subheading">Individual logins</h4>';
    if (!filteredEvents.length) {
      detailHtml +=
        '<p class="admin-empty-state">No recorded logins for this period. Logins are tracked from the next user sign-in.</p>';
    } else if (adminReportPeriod === 'weekly') {
      const groups = groupLoginEventsByDay(filteredEvents);
      detailHtml += '<div class="admin-report-day-groups">' + groups
        .map(([day, dayEvents]) => {
          const rows = dayEvents
            .map(
              (e) =>
                '<tr>' +
                `<td class="admin-td-time">${escapeHtml(formatReportDateTime(e.loggedAt))}</td>` +
                `<td class="admin-td-email">${escapeHtml(e.email || '—')}</td>` +
                `<td>${adminRoleBadge(e.role)}</td>` +
                '</tr>'
            )
            .join('');
          return (
            '<div class="admin-report-day-group">' +
            `<h5 class="admin-report-day">${escapeHtml(formatReportDayLabel(day))}</h5>` +
            '<div class="admin-report-table-wrap"><table class="admin-report-table">' +
            '<thead><tr><th>Time</th><th>Email</th><th>Role</th></tr></thead>' +
            `<tbody>${rows}</tbody></table></div></div>`
          );
        })
        .join('') + '</div>';
    } else {
      const rows = filteredEvents
        .map(
          (e) =>
            '<tr>' +
            `<td class="admin-td-time">${escapeHtml(formatReportDateTime(e.loggedAt))}</td>` +
            `<td class="admin-td-email">${escapeHtml(e.email || '—')}</td>` +
            `<td>${adminRoleBadge(e.role)}</td>` +
            '</tr>'
        )
        .join('');
      detailHtml +=
        '<div class="admin-report-table-wrap"><table class="admin-report-table">' +
        '<thead><tr><th>Time</th><th>Email</th><th>Role</th></tr></thead>' +
        `<tbody>${rows}</tbody></table></div>`;
    }
    detailHtml += '</div>';

    panel.innerHTML = summaryHtml + usersTableHtml + detailHtml;

    const refreshBtn = document.getElementById('admin-report-refresh');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => renderSuperadminUserReport(adminReportPeriod));
    }

    section.querySelectorAll('.admin-report-period').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const p = btn.dataset.period;
        if (p) renderSuperadminUserReport(p);
      });
    });
  }

  async function listFirestoreUsers() {
    if (!window.firebase || !firebase.firestore) return [];
    try {
      const snap = await firebase.firestore().collection('users').get();
      return snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          uid: d.id,
          email: data.email || '',
          role: data.role || 'user',
          lastLoginAt: data.lastLoginAt || null,
          createdAt: data.createdAt || null,
        };
      });
    } catch (err) {
      console.warn('Users list failed', err);
      return [];
    }
  }

  async function listSharedGrantsForOwner(ownerUid) {
    if (!ownerUid || !window.firebase || !firebase.firestore) return [];
    try {
      const snap = await firebase
        .firestore()
        .collection('users')
        .doc(ownerUid)
        .collection('sharedGrants')
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('Shared grants list failed', err);
      return [];
    }
  }

  async function saveSharedGrant(ownerUid, viewerUid, grant) {
    const ref = getSharedGrantsRef(ownerUid, viewerUid);
    if (!ref) return;
    await ref.set(
      Object.assign({}, grant, {
        viewerUid,
        updatedAt: new Date().toISOString(),
        enabled: grant.enabled !== false,
      }),
      { merge: true }
    );
  }

  async function deleteSharedGrant(ownerUid, viewerUid) {
    const ref = getSharedGrantsRef(ownerUid, viewerUid);
    if (!ref) return;
    await ref.delete();
  }

  async function ensureViewerBootstrapGrant(viewerUid, email) {
    const normalized = (email || '').toLowerCase();
    if (!SHARED_HYBRID_ACCESS_EMAILS.includes(normalized)) return;
    const superIds = await findSuperadminUserIds();
    if (!superIds.length) return;
    const ownerUid = superIds[0];
    const ref = getSharedGrantsRef(ownerUid, viewerUid);
    if (!ref) return;
    const snap = await ref.get();
    if (snap.exists) return;
    await saveSharedGrant(ownerUid, viewerUid, {
      viewerEmail: email,
      plantIds: [],
      shareEntries: true,
      shareToolbox: true,
      enabled: true,
      fullAccess: true,
    });
  }

  async function loadSuperadminDatabaseFull() {
    const superIds = await findSuperadminUserIds();
    let plants = [];
    let entries = [];
    let toolbox = {};

    for (const uid of superIds) {
      const state = await loadRemoteStateIntoLocal(uid);
      if (!state) continue;
      plants = mergeRecordsById(plants, state.plants);
      entries = mergeRecordsById(entries, state.entries);
      toolbox = Object.assign({}, toolbox, state.toolbox || {});
    }

    const firestoreData = await loadFirestorePlantsAndEntries();
    plants = mergeRecordsById(plants, firestoreData.plants);
    entries = mergeRecordsById(entries, firestoreData.entries);

    applyRemoteStateToLocal({ plants, entries, toolbox });
    return { plants, entries, toolbox };
  }

  async function loadSuperadminDatabaseForAdmin() {
    const result = await loadSuperadminDatabaseFull();
    console.log('Admin loaded superadmin DB:', result.plants.length, 'plants,', result.entries.length, 'entries');
  }

  async function fetchSharedRecordsForViewer(viewerUid, email) {
    const superIds = await findSuperadminUserIds();
    let plants = [];
    let entries = [];
    let toolbox = {};
    let matchedGrant = false;

    for (const ownerUid of superIds) {
      const ref = getSharedGrantsRef(ownerUid, viewerUid);
      if (!ref) continue;
      let grantSnap;
      try {
        grantSnap = await ref.get();
      } catch {
        continue;
      }
      if (!grantSnap.exists || grantSnap.data().enabled === false) continue;
      const grant = grantSnap.data();
      const grantEmail = (grant.viewerEmail || '').toLowerCase();
      const userEmail = (email || '').toLowerCase();
      if (grantEmail && userEmail && grantEmail !== userEmail) continue;

      matchedGrant = true;
      const state = await loadRemoteStateIntoLocal(ownerUid);
      if (!state) continue;

      let p = state.plants || [];
      let e = state.entries || [];
      const ids = Array.isArray(grant.plantIds) ? grant.plantIds : [];
      if (ids.length > 0) {
        const idSet = new Set(ids);
        p = p.filter((pl) => pl && idSet.has(pl.id));
        e = e.filter((en) => en && (!en.plantId || idSet.has(en.plantId)));
      }

      const tagged = tagSharedRecords(p, grant.shareEntries !== false ? e : [], ownerUid);
      plants = mergeRecordsById(plants, tagged.plants);
      if (grant.shareEntries !== false) entries = mergeRecordsById(entries, tagged.entries);
      if (grant.shareToolbox) toolbox = Object.assign({}, toolbox, state.toolbox || {});
    }

    return { plants, entries, toolbox, matchedGrant };
  }

  async function loadSharedDatabaseForViewer(viewerUid, email) {
    let { plants, entries, toolbox, matchedGrant } = await fetchSharedRecordsForViewer(viewerUid, email);

    if (!matchedGrant && isSharedHybridUser(email)) {
      await ensureViewerBootstrapGrant(viewerUid, email);
      ({ plants, entries, toolbox } = await fetchSharedRecordsForViewer(viewerUid, email));
    }

    registerSharedReadOnlyIds(plants, entries);
    applyRemoteStateToLocal({ plants, entries, toolbox });
    console.log('Viewer loaded shared DB:', plants.length, 'plants,', entries.length, 'entries');
  }

  async function loadHybridUserWithSharedReadOnly(viewerUid, email) {
    await ensureViewerBootstrapGrant(viewerUid, email);
    const ownState = (await loadRemoteStateIntoLocal(viewerUid)) || {
      plants: [],
      entries: [],
      toolbox: {},
    };
    let { plants: sharedPlants, entries: sharedEntries } = await fetchSharedRecordsForViewer(
      viewerUid,
      email
    );
    if (!sharedPlants.length && isSharedHybridUser(email)) {
      await ensureViewerBootstrapGrant(viewerUid, email);
      ({ plants: sharedPlants, entries: sharedEntries } = await fetchSharedRecordsForViewer(
        viewerUid,
        email
      ));
    }

    registerSharedReadOnlyIds(sharedPlants, sharedEntries);
    // Merge device-local own writes so a reload cannot drop a just-saved entry.
    const localMerged = mergeLocalWithRemoteState({
      plants: ownState.plants || [],
      entries: ownState.entries || [],
      toolbox: ownState.toolbox || {},
    });
    const plants = mergeRecordsById(sharedPlants, localMerged.plants || []);
    const entries = mergeRecordsById(sharedEntries, localMerged.entries || []);
    applyRemoteStateToLocal({
      plants,
      entries,
      toolbox: localMerged.toolbox || {},
    });
    console.log(
      'Hybrid user loaded:',
      (localMerged.plants || []).length,
      'own +',
      sharedPlants.length,
      'shared plants'
    );
  }

  function blockWrite(opts) {
    const plantId = opts && opts.plantId;
    const entryId = opts && opts.entryId;
    if (isAdminReadOnly) {
      alert(readOnlyBannerMessage || 'View is read-only — editing is not allowed.');
      return true;
    }
    if (plantId && isSharedPlantId(plantId)) {
      alert(
        'This plant comes from the superadmin shared library — you can view it, but not edit it.'
      );
      return true;
    }
    if (entryId && isSharedEntryId(entryId)) {
      alert('This entry comes from a shared library — it cannot be edited.');
      return true;
    }
    return false;
  }

  function blockAdminWrite() {
    return blockWrite({});
  }

  function applySharedLibraryBanner(message) {
    readOnlyBannerMessage =
      message ||
      'You can edit your own plants and entries. Plants from the superadmin shared library are view-only.';
    document.body.classList.remove('admin-readonly');
    document.body.classList.add('shared-library-mode');
    let banner = document.getElementById('shared-library-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'shared-library-banner';
      banner.className = 'admin-readonly-banner shared-library-banner';
      banner.setAttribute('role', 'status');
      const main = document.querySelector('.main');
      if (main) main.insertBefore(banner, main.firstChild);
    }
    banner.textContent = readOnlyBannerMessage;
  }

  function applyAdminReadOnlyUI(message) {
    if (!isAdminReadOnly) return;
    readOnlyBannerMessage =
      message ||
      'Read-only database view — plants, journal and tools without editing.';
    document.body.classList.add('admin-readonly');
    let banner = document.getElementById('admin-readonly-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'admin-readonly-banner';
      banner.className = 'admin-readonly-banner';
      banner.setAttribute('role', 'status');
      const main = document.querySelector('.main');
      if (main) main.insertBefore(banner, main.firstChild);
    }
    banner.textContent = readOnlyBannerMessage;
  }

  async function renderSuperadminSharingPanel() {
    const section = document.getElementById('admin-sharing-section');
    const panel = document.getElementById('admin-sharing-panel');
    const ownerUid = getFirebaseUserId();
    if (!section || !panel || !ownerUid || currentUserRole !== 'superadmin') return;

    section.setAttribute('aria-hidden', 'false');
    panel.innerHTML = '<p class="admin-empty-state admin-loading-state">Loading…</p>';

    const users = (await listFirestoreUsers()).filter((u) => u.uid !== ownerUid);
    const plants = getPlants();
    const grants = await listSharedGrantsForOwner(ownerUid);

    const userOptions = users
      .map(
        (u) =>
          `<option value="${escapeHtml(u.uid)}" data-email="${escapeHtml(u.email)}">${escapeHtml(u.email || u.uid)} (${escapeHtml(u.role)})</option>`
      )
      .join('');

    const plantChecks = plants.length
      ? plants
          .map(
            (p) =>
              `<label class="admin-plant-pick"><input type="checkbox" class="share-plant-cb" value="${escapeHtml(p.id)}" />` +
              `<span class="admin-plant-pick-name">${escapeHtml(p.name)}</span>` +
              (p.strain ? `<span class="admin-plant-pick-meta">${escapeHtml(p.strain)}</span>` : '') +
              '</label>'
          )
          .join('')
      : '<p class="admin-empty-state">You have no plants in the database — add them in Plants & journal.</p>';

    const grantsHtml = grants.length
      ? grants
          .map((g) => {
            const email = g.viewerEmail || g.viewerUid || g.id;
            return (
              `<article class="admin-grant-card" data-viewer="${escapeHtml(g.viewerUid || g.id)}">` +
              '<div class="admin-grant-card-head">' +
              `<div class="admin-grant-user"><span class="admin-grant-avatar" aria-hidden="true">${escapeHtml((email[0] || '?').toUpperCase())}</span>` +
              `<strong class="admin-grant-email">${escapeHtml(email)}</strong></div>` +
              '<button type="button" class="btn btn-ghost btn-sm btn-revoke-grant">Remove</button></div>' +
              `<div class="admin-grant-badges">${adminGrantBadgesHtml(g)}</div></article>`
            );
          })
          .join('')
      : '<p class="admin-empty-state">No access granted yet.</p>';

    panel.innerHTML =
      '<div class="admin-sharing-layout">' +
      '<div class="admin-sharing-form-card">' +
      '<h4 class="admin-subheading">New access</h4>' +
      '<form id="form-sharing-grant" class="admin-sharing-form">' +
      '<label class="admin-field"><span class="admin-field-label">User</span>' +
      '<select id="share-viewer-user" class="admin-field-input" required><option value="">— select a user —</option>' +
      userOptions +
      '</select></label>' +
      '<fieldset class="admin-sharing-plants-fieldset">' +
      '<legend class="admin-field-label">Plants</legend>' +
      '<label class="admin-toggle-tile admin-toggle-tile--wide">' +
      '<input type="checkbox" id="share-all-plants" checked />' +
      '<span><strong>All plants</strong><small>View the entire plant database</small></span></label>' +
      '<div id="share-plants-list" class="admin-plants-pick-list" hidden>' +
      plantChecks +
      '</div></fieldset>' +
      '<div class="admin-toggle-row">' +
      '<label class="admin-toggle-tile">' +
      '<input type="checkbox" id="share-entries" checked />' +
      '<span><strong>Journal</strong><small>Notes and entries</small></span></label>' +
      '<label class="admin-toggle-tile">' +
      '<input type="checkbox" id="share-toolbox" />' +
      '<span><strong>Tools</strong><small>Data from Tools</small></span></label>' +
      '</div>' +
      '<button type="submit" class="btn btn-primary admin-sharing-submit">Save access</button>' +
      '</form></div>' +
      '<div class="admin-sharing-grants-card">' +
      '<h4 class="admin-subheading">Active access <span class="admin-count-badge">' + grants.length + '</span></h4>' +
      '<div class="admin-grant-list">' + grantsHtml + '</div></div></div>';

    const allPlantsCb = document.getElementById('share-all-plants');
    const plantsList = document.getElementById('share-plants-list');
    if (allPlantsCb && plantsList) {
      allPlantsCb.addEventListener('change', () => {
        plantsList.hidden = allPlantsCb.checked;
      });
    }

    document.getElementById('form-sharing-grant').addEventListener('submit', async (e) => {
      e.preventDefault();
      const sel = document.getElementById('share-viewer-user');
      const viewerUid = sel.value;
      if (!viewerUid) return;
      const viewerEmail = sel.selectedOptions[0]?.dataset?.email || '';
      const allPlants = document.getElementById('share-all-plants').checked;
      const plantIds = allPlants
        ? []
        : Array.from(document.querySelectorAll('.share-plant-cb:checked')).map((cb) => cb.value);
      if (!allPlants && plantIds.length === 0) {
        alert('Select at least one plant or enable "All plants".');
        return;
      }
      try {
        await saveSharedGrant(ownerUid, viewerUid, {
          viewerEmail,
          plantIds,
          shareEntries: document.getElementById('share-entries').checked,
          shareToolbox: document.getElementById('share-toolbox').checked,
          enabled: true,
        });
        await renderSuperadminSharingPanel();
        alert('Access saved.');
      } catch (err) {
        console.error(err);
        alert('Saving failed. Check your Firestore rules.');
      }
    });

    panel.querySelectorAll('.btn-revoke-grant').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.admin-grant-card');
        const viewerUid = row && row.dataset.viewer;
        if (!viewerUid || !confirm('Remove access for this user?')) return;
        try {
          await deleteSharedGrant(ownerUid, viewerUid);
          await renderSuperadminSharingPanel();
        } catch (err) {
          alert('Removal failed.');
        }
      });
    });
  }

  function refreshAllViewsAfterRemoteLoad() {
    try {
      renderDashboard();
      renderPlants();
      renderJournal();
      if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
      renderToolbox();
      if (currentGrowlogPlantId) renderGrowlog(currentGrowlogPlantId);
    } catch {
      // ignore
    }
  }


async function ensureUserExists(user) {
  const db = firebase.firestore();
  const userRef = db.collection("users").doc(user.uid);

  const docSnap = await userRef.get();

  const email = (user.email || '').toLowerCase();
  const hybridUser = isSharedHybridUser(email);
  const Signup = window.GrowtooSignup;
  const pending = Signup ? Signup.readPending() : readPendingProfile();
  const pendingType = pending.profileType || '';

  if (!docSnap.exists) {
    let profileDoc;
    if (Signup) {
      profileDoc = Signup.buildUserProfileDoc(user, pending);
      if (hybridUser) profileDoc.role = 'user';
    } else {
      const profileType = normalizeProfileType(pendingType) || PROFILE_TYPES.grower;
      profileDoc = {
        email: user.email || "",
        uId: user.uid,
        role: 'user',
        profileType: profileType,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        signupSource: 'website',
      };
      applyPendingFieldsToUserDoc(profileDoc, pending, profileType);
    }
    await userRef.set(profileDoc);
    if (Signup) {
      Signup.applyLocalDefaults(pending);
      Signup.hydrateLocalFromUserDoc(profileDoc);
      Signup.clearPending();
    } else {
      applyPendingLocalDefaults(pending, profileDoc.profileType);
      hydrateProfileLocalDefaults(profileDoc);
      clearPendingProfile();
    }
    currentProfileType = normalizeProfileType(profileDoc.profileType) || PROFILE_TYPES.grower;
    console.log("User created", currentProfileType);
  } else {
    const data = docSnap.data() || {};
    // Capture previous login before overwrite — DailyStatus uses this for "while away".
    try {
      sessionStorage.setItem(
        'dnevnik-live-prev-login-at:' + user.uid,
        data.lastLoginAt ? String(data.lastLoginAt) : ''
      );
    } catch (_) {
      /* ignore */
    }
    const patch = { lastLoginAt: new Date().toISOString() };
    if (hybridUser && data.role === 'viewer') {
      patch.role = 'user';
    }
    const existingType = normalizeProfileType(data.profileType);
    if (!existingType) {
      patch.profileType = normalizeProfileType(pendingType) || PROFILE_TYPES.grower;
      if (Signup) Signup.applyPayloadToUserDoc(patch, pending, patch.profileType);
      else applyPendingFieldsToUserDoc(patch, pending, patch.profileType);
      if (Signup) Signup.applyLocalDefaults(pending);
      else applyPendingLocalDefaults(pending, patch.profileType);
    } else if (pending && pending.profileType) {
      if (Signup) {
        Signup.applyPayloadToUserDoc(patch, pending, existingType, {
          onlyIfMissing: true,
          existing: data,
        });
        Signup.applyLocalDefaults(pending);
      } else {
        applyPendingFieldsToUserDoc(patch, pending, existingType, { onlyIfMissing: true, existing: data });
        applyPendingLocalDefaults(pending, existingType);
      }
    }
    await userRef.update(patch);
    if (Signup) {
      Signup.clearPending();
      Signup.hydrateLocalFromUserDoc(Object.assign({}, data, patch));
    } else {
      clearPendingProfile();
      hydrateProfileLocalDefaults(Object.assign({}, data, patch));
    }
    currentProfileType = existingType || patch.profileType || PROFILE_TYPES.grower;
    console.log("User updated");
  }
}

function applyPendingFieldsToUserDoc(target, pending, profileType, opts) {
  const o = opts || {};
  const existing = o.existing || {};
  const onlyIfMissing = !!o.onlyIfMissing;
  if (!pending || typeof pending !== 'object') return;

  function setField(key, value) {
    if (value == null || value === '') return;
    if (onlyIfMissing && existing[key] != null && existing[key] !== '') return;
    target[key] = value;
  }

  setField('displayName', String(pending.displayName || '').trim().slice(0, 64));
  if (profileType === PROFILE_TYPES.grower) {
    const setup = normalizeGrowSetup(pending.growSetup);
    if (setup) setField('growSetup', setup);
    setField('homeCity', String(pending.homeCity || '').trim().slice(0, 80));
    setField('growStyleNote', String(pending.growStyleNote || '').trim().slice(0, 240));
  }
  if (profileType === PROFILE_TYPES.adopter) {
    const intent = normalizeAdopterIntent(pending.adopterIntent);
    if (intent) setField('adopterIntent', intent);
    if (pending.acceptedDevnet) setField('acceptedDevnet', true);
  }
}

function normalizeGrowSetup(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (v === 'indoor' || v === 'outdoor' || v === 'mixed') return v;
  return '';
}

function normalizeAdopterIntent(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (v === 'support_growers' || v === 'collect_garden' || v === 'earn_rewards') return v;
  return '';
}

function applyPendingLocalDefaults(pending, profileType) {
  if (!pending || typeof pending !== 'object') return;
  try {
    const name = String(pending.displayName || '').trim();
    if (name) localStorage.setItem('dnevnik-live-display-name', name);

    if (profileType === PROFILE_TYPES.grower) {
      const city = String(pending.homeCity || '').trim();
      if (city) localStorage.setItem('dnevnik-live-weather-city', city);
      const setup = normalizeGrowSetup(pending.growSetup);
      if (setup) localStorage.setItem('dnevnik-live-grow-setup', setup);
      const note = String(pending.growStyleNote || '').trim();
      if (note) localStorage.setItem('dnevnik-live-grow-style-note', note);
    }
    if (profileType === PROFILE_TYPES.adopter) {
      const intent = normalizeAdopterIntent(pending.adopterIntent);
      if (intent) localStorage.setItem('dnevnik-live-adopter-intent', intent);
    }
  } catch {
    // ignore
  }
}

/** Fill local defaults from Firestore user doc when local keys are empty. */
function hydrateProfileLocalDefaults(data) {
  if (!data || typeof data !== 'object') return;
  try {
    if (data.displayName && !localStorage.getItem('dnevnik-live-display-name')) {
      localStorage.setItem('dnevnik-live-display-name', String(data.displayName).trim());
    }
    if (data.homeCity && !localStorage.getItem('dnevnik-live-weather-city')) {
      localStorage.setItem('dnevnik-live-weather-city', String(data.homeCity).trim());
    }
    if (data.growSetup && !localStorage.getItem('dnevnik-live-grow-setup')) {
      const setup = normalizeGrowSetup(data.growSetup);
      if (setup) localStorage.setItem('dnevnik-live-grow-setup', setup);
    }
    if (data.growStyleNote && !localStorage.getItem('dnevnik-live-grow-style-note')) {
      localStorage.setItem('dnevnik-live-grow-style-note', String(data.growStyleNote).trim());
    }
    if (data.adopterIntent && !localStorage.getItem('dnevnik-live-adopter-intent')) {
      const intent = normalizeAdopterIntent(data.adopterIntent);
      if (intent) localStorage.setItem('dnevnik-live-adopter-intent', intent);
    }
    if (data.chainOptIn) {
      writeChainOptInLocal(true);
    }
  } catch {
    // ignore
  }
}

function getPreferredGrowEnvironment() {
  try {
    const setup = normalizeGrowSetup(localStorage.getItem('dnevnik-live-grow-setup') || '');
    if (setup === 'outdoor') return 'outdoor';
    return 'indoor';
  } catch {
    return 'indoor';
  }
}

function getAdopterIntent() {
  try {
    return normalizeAdopterIntent(localStorage.getItem('dnevnik-live-adopter-intent') || '') || 'support_growers';
  } catch {
    return 'support_growers';
  }
}

function adopterIntentCopy() {
  const intent = getAdopterIntent();
  if (intent === 'collect_garden') {
    return {
      hero: 'Collect adopted plants and follow each growth stage in your garden.',
      empty: 'Browse the market to adopt your first plant and grow your collection.',
      market: 'Find open plant offers and back them with $GROWTOO when you’re ready.',
      strip: 'Claim test $GROWTOO, browse the market, and collect your first plant.',
      label: 'Collect a garden',
    };
  }
  if (intent === 'earn_rewards') {
    return {
      hero: 'Practice stakes and harvest unlocks on test assets — no monetary value.',
      empty: 'Back an open offer to start following growth and harvest care on the test network.',
      market: 'Invest test $GROWTOO in grower asks — follow monthly unlock progress toward harvest.',
      strip: 'Claim test $GROWTOO, stake on a live offer, then watch monthly unlock in My garden.',
      label: 'Practice stakes',
    };
  }
  return {
    hero: 'Follow a real plant’s journal trail. Backing with $GROWTOO is optional.',
    empty: 'Browse the market and back a grow with $GROWTOO when you are ready.',
    market: 'Invest $GROWTOO to adopt a grower’s plant token. Connect your wallet when you tap Invest.',
    strip: 'Claim test $GROWTOO, then invest in a live plant offer.',
    label: 'Support growers',
  };
}

function shortWalletAddr(addr) {
  const s = String(addr || '');
  if (s.length < 10) return s || '—';
  return s.slice(0, 6) + '…' + s.slice(-4);
}

function readDisplayName() {
  try {
    return String(localStorage.getItem('dnevnik-live-display-name') || '').trim();
  } catch {
    return '';
  }
}

function renderAccountProfile() {
  const el = document.getElementById('account-profile');
  if (!el) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const adopter = isAdopterProfile();
  const auth = (typeof getStoredAuth === 'function' ? getStoredAuth() : null) || {};
  let email = auth.email || '';
  try {
    if (window.firebase && firebase.auth && firebase.auth().currentUser) {
      email = firebase.auth().currentUser.email || email;
    }
  } catch {
    /* ignore */
  }
  const name = readDisplayName() || (email ? email.split('@')[0] : '') || 'growtoo member';
  const mark = adopter ? 'A' : 'G';
  const roleLabel = adopter ? 'Adopter' : 'Grower';

  let wallet = '';
  try {
    if (window.WalletLink && typeof WalletLink.getProfile === 'function') {
      wallet = String((WalletLink.getProfile() || {}).solanaPubkey || '');
    }
  } catch {
    /* ignore */
  }

  let cryptoMode = 'simple';
  try {
    if (window.GrowtooPlain && typeof GrowtooPlain.getMode === 'function') {
      cryptoMode = GrowtooPlain.getMode() === 'advanced' ? 'advanced' : 'simple';
    }
  } catch {
    /* ignore */
  }

  let metaRows = '';
  let statsHtml = '';

  if (adopter) {
    const intentCopy = adopterIntentCopy();
    let adopted = 0;
    let growBal = '—';
    try {
      if (window.PlantToken && typeof PlantToken.getWallet === 'function') {
        const w = PlantToken.getWallet() || {};
        adopted = Array.isArray(w.tokens) ? w.tokens.length : 0;
        if (w.growthBalance != null) growBal = Number(w.growthBalance).toLocaleString('en-US');
      }
    } catch {
      /* ignore */
    }
    metaRows =
      '<div class="account-profile-row"><span>Focus</span><strong>' +
      esc(intentCopy.label || 'Support growers') +
      '</strong></div>' +
      '<div class="account-profile-row"><span>Wallet</span><strong>' +
      esc(wallet ? shortWalletAddr(wallet) : 'Not linked') +
      '</strong></div>' +
      '<div class="account-profile-row"><span>View</span><strong>' +
      esc(cryptoMode === 'advanced' ? 'Advanced' : 'Simple') +
      '</strong></div>';
    statsHtml =
      '<div class="account-profile-stats">' +
      '<div class="account-profile-stat"><span>Adopted</span><strong>' +
      esc(String(adopted)) +
      '</strong></div>' +
      '<div class="account-profile-stat"><span>$GROWTOO</span><strong>' +
      esc(String(growBal)) +
      '</strong></div>' +
      '</div>';
  } else {
    const setup = getPreferredGrowEnvironment() === 'outdoor' ? 'Outdoor' : 'Indoor';
    let city = '';
    try {
      city = String(localStorage.getItem('dnevnik-live-weather-city') || '').trim();
    } catch {
      city = '';
    }
    let plantCount = 0;
    try {
      const raw = localStorage.getItem('dnevnik-live-plants');
      const plants = raw ? JSON.parse(raw) : [];
      plantCount = Array.isArray(plants) ? plants.length : 0;
    } catch {
      plantCount = 0;
    }
    let rankLabel = '—';
    let xp = '—';
    try {
      if (window.GrowerQuests) {
        if (typeof GrowerQuests.growerRankFromLocal === 'function') {
          const rank = GrowerQuests.growerRankFromLocal();
          if (rank && rank.label) rankLabel = rank.label;
        }
        if (typeof GrowerQuests.getGrowerProfile === 'function') {
          const profile = GrowerQuests.getGrowerProfile() || {};
          if (profile.xp != null) xp = String(profile.xp);
          else if (profile.totalXp != null) xp = String(profile.totalXp);
        }
      }
    } catch {
      /* ignore */
    }
    metaRows =
      '<div class="account-profile-row"><span>Setup</span><strong>' +
      esc(setup + (city ? ' · ' + city : '')) +
      '</strong></div>' +
      '<div class="account-profile-row"><span>Wallet</span><strong>' +
      esc(wallet ? shortWalletAddr(wallet) : 'Not linked') +
      '</strong></div>' +
      '<div class="account-profile-row"><span>View</span><strong>' +
      esc(cryptoMode === 'advanced' ? 'Advanced' : 'Simple') +
      '</strong></div>';
    statsHtml =
      '<div class="account-profile-stats">' +
      '<div class="account-profile-stat"><span>Plants</span><strong>' +
      esc(String(plantCount)) +
      '</strong></div>' +
      '<div class="account-profile-stat"><span>Rank · XP</span><strong>' +
      esc(rankLabel + (xp !== '—' ? ' · ' + xp : '')) +
      '</strong></div>' +
      '</div>';
  }

  el.hidden = false;
  el.innerHTML =
    '<div class="account-profile-top">' +
    '<div class="account-profile-avatar" aria-hidden="true">' +
    esc(mark) +
    '</div>' +
    '<div class="account-profile-id">' +
    '<p class="account-profile-name">' +
    esc(name) +
    '</p>' +
    (email ? '<p class="account-profile-email">' + esc(email) + '</p>' : '') +
    '<span class="account-profile-role account-profile-role--' +
    (adopter ? 'adopter' : 'grower') +
    '">' +
    esc(roleLabel) +
    '</span>' +
    '</div>' +
    '</div>' +
    '<div class="account-profile-meta">' +
    metaRows +
    '</div>' +
    '<p class="account-profile-mode-hint">' +
    (cryptoMode === 'advanced'
      ? 'Advanced shows mint addresses, explorer links, and listing PDAs on cards.'
      : 'Simple hides mint addresses and chain IDs — plant · stage · ask only.') +
    '</p>' +
    statsHtml +
    '<div class="account-profile-mode-row">' +
    '<span class="crypto-mode-status">Detail level</span>' +
    '<div class="segmented-control" data-crypto-mode-segmented data-active="' +
    cryptoMode +
    '">' +
    '<span class="segmented-thumb" aria-hidden="true"></span>' +
    '<button type="button" class="segmented-option" data-crypto-mode-btn="simple" role="radio" aria-checked="' +
    (cryptoMode === 'simple' ? 'true' : 'false') +
    '">Simple</button>' +
    '<button type="button" class="segmented-option" data-crypto-mode-btn="advanced" role="radio" aria-checked="' +
    (cryptoMode === 'advanced' ? 'true' : 'false') +
    '">Advanced</button>' +
    '</div>' +
    '</div>' +
    '<div class="account-profile-actions">' +
    '<button type="button" class="btn btn-ghost btn-sm" id="account-profile-tour">Replay tour</button>' +
    '<button type="button" class="btn btn-primary btn-sm" id="account-profile-primary">' +
    esc(adopter ? 'Open market' : 'Open journal') +
    '</button>' +
    '</div>';

  const primary = document.getElementById('account-profile-primary');
  if (primary) {
    primary.addEventListener('click', function () {
      if (typeof setMoreNavOpen === 'function') setMoreNavOpen(false);
      if (typeof showView === 'function') showView(adopter ? 'market' : 'plants');
      else if (typeof window.showAppView === 'function') {
        window.showAppView(adopter ? 'market' : 'plants');
      }
    });
  }
  const tourBtn = document.getElementById('account-profile-tour');
  if (tourBtn) {
    tourBtn.addEventListener('click', function () {
      if (typeof setMoreNavOpen === 'function') setMoreNavOpen(false);
      if (window.ProductTour) {
        if (typeof ProductTour.replayFull === 'function') ProductTour.replayFull();
        else if (adopter && typeof ProductTour.replayAdopter === 'function') {
          ProductTour.replayAdopter();
        } else if (!adopter && typeof ProductTour.replayGrower === 'function') {
          ProductTour.replayGrower();
        }
      }
    });
  }
}

window.renderAccountProfile = renderAccountProfile;

window.GrowtooProfile = {
  getPreferredGrowEnvironment: getPreferredGrowEnvironment,
  getAdopterIntent: getAdopterIntent,
  adopterIntentCopy: adopterIntentCopy,
};

/** @returns {{ profileType?: string, displayName?: string, growSetup?: string, homeCity?: string, growStyleNote?: string, adopterIntent?: string, acceptedDevnet?: boolean }} */
function readPendingProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_PENDING_PROFILE) || '';
    if (!raw) return {};
    if (raw === 'grower' || raw === 'adopter') return { profileType: raw };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (!parsed.profileType && (raw.includes('grower') || raw.includes('adopter'))) {
        // no-op
      }
      return parsed;
    }
  } catch {
    try {
      const legacy = localStorage.getItem(STORAGE_PENDING_PROFILE) || '';
      if (legacy === 'grower' || legacy === 'adopter') return { profileType: legacy };
    } catch {
      // ignore
    }
  }
  return {};
}

function readPendingProfileType() {
  return readPendingProfile().profileType || '';
}

function clearPendingProfile() {
  try {
    localStorage.removeItem(STORAGE_PENDING_PROFILE);
  } catch {
    // ignore
  }
}

function clearPendingProfileType() {
  clearPendingProfile();
}

function normalizeProfileType(type) {
  const t = String(type == null ? '' : type).trim().toLowerCase();
  if (t === 'adopter' || t === 'adoption' || t === 'adopt') return PROFILE_TYPES.adopter;
  if (t === 'grower' || t === 'grow') return PROFILE_TYPES.grower;
  return '';
}

function getProfileType() {
  return currentProfileType || PROFILE_TYPES.grower;
}

function isAdopterProfile() {
  return getProfileType() === PROFILE_TYPES.adopter;
}

function isGrowerProfile() {
  return getProfileType() === PROFILE_TYPES.grower;
}

var STORAGE_CHAIN_OPT_IN = 'dnevnik-live-chain-opt-in';

function readChainOptInLocal() {
  try {
    return localStorage.getItem(STORAGE_CHAIN_OPT_IN) === '1';
  } catch {
    return false;
  }
}

function writeChainOptInLocal(enabled) {
  try {
    if (enabled) localStorage.setItem(STORAGE_CHAIN_OPT_IN, '1');
    else localStorage.removeItem(STORAGE_CHAIN_OPT_IN);
  } catch {
    // ignore
  }
}

function growerHasPriorChainActivity() {
  try {
    if (window.WalletLink && typeof WalletLink.getProfile === 'function') {
      const profile = WalletLink.getProfile() || {};
      if (profile.solanaPubkey) return true;
    }
  } catch {
    // ignore
  }
  try {
    if (window.PlantToken && typeof PlantToken.getWallet === 'function') {
      const wallet = PlantToken.getWallet() || {};
      if (Array.isArray(wallet.tokens) && wallet.tokens.length) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function isChainOptIn() {
  if (!isGrowerProfile()) return true;
  if (readChainOptInLocal()) return true;
  if (growerHasPriorChainActivity()) {
    writeChainOptInLocal(true);
    return true;
  }
  return false;
}

function persistChainOptInRemote(enabled) {
  try {
    if (!window.firebase || !firebase.auth || !firebase.firestore) return;
    const user = firebase.auth().currentUser;
    if (!user) return;
    firebase
      .firestore()
      .collection('users')
      .doc(user.uid)
      .set(
        {
          chainOptIn: !!enabled,
          chainOptInAt: new Date().toISOString(),
        },
        { merge: true }
      )
      .catch(function () {
        /* ignore */
      });
  } catch {
    // ignore
  }
}

function applyChainNavUI() {
  const locked = isGrowerProfile() && !isChainOptIn();
  document.body.classList.toggle('chain-locked', locked);
  syncMoreNavVisibility();
}

function setChainOptIn(enabled) {
  writeChainOptInLocal(!!enabled);
  if (enabled) persistChainOptInRemote(true);
  applyChainNavUI();
}

function unlockChainPath(nextView) {
  setChainOptIn(true);
  if (nextView && typeof showView === 'function') {
    showView(nextView);
  } else if (nextView && typeof window.showAppView === 'function') {
    window.showAppView(nextView);
  }
}

/**
 * Offer Tokenise/Market unlock, then navigate. Used by the profile CTA and by
 * any deep link (START HERE, tour, etc.) that would otherwise fail silently
 * while chain-locked.
 */
async function promptUnlockChain(nextView) {
  const ok =
    window.AppConfirm && typeof AppConfirm.ask === 'function'
      ? await AppConfirm.ask({
          title: 'Unlock Tokenise & Market?',
          body:
            'This adds optional on-chain tools: seal stages on Devnet and list asks. Your journal stays free and works without a wallet.',
          confirmLabel: 'Unlock',
          cancelLabel: 'Not now',
        })
      : window.confirm(
          'Unlock Tokenise & Market?\n\nOptional on-chain tools. Your journal stays free without a wallet.'
        );
  if (!ok) return false;
  unlockChainPath(nextView || 'adopt');
  return true;
}

function applyProfileTypeUI(profileType) {
  const type = normalizeProfileType(profileType) || PROFILE_TYPES.grower;
  currentProfileType = type;
  document.body.classList.remove('profile-grower', 'profile-adopter');
  document.body.classList.add(type === PROFILE_TYPES.adopter ? 'profile-adopter' : 'profile-grower');
  document.body.dataset.profileType = type;

  document.querySelectorAll('[data-label-grower][data-label-adopter]').forEach((el) => {
    const label = type === PROFILE_TYPES.adopter ? el.dataset.labelAdopter : el.dataset.labelGrower;
    if (label) el.textContent = label;
  });

  const badge = document.getElementById('profile-type-badge');
  if (badge) {
    badge.textContent = type === PROFILE_TYPES.adopter ? 'Adopter' : 'Grower';
    badge.hidden = false;
    badge.className =
      'profile-type-badge profile-type-badge--' +
      (type === PROFILE_TYPES.adopter ? 'adopter' : 'grower');
  }

  const avatarMark = document.querySelector('#btn-account .header-avatar-mark');
  if (avatarMark) {
    avatarMark.textContent = type === PROFILE_TYPES.adopter ? 'A' : 'G';
  }

  const title = document.querySelector('title');
  if (title) {
    title.textContent =
      type === PROFILE_TYPES.adopter
        ? 'growtoo – Adopt & track'
        : 'growtoo – Grow journal';
  }

  if (window.AdoptPlant && typeof window.AdoptPlant.applyProfileType === 'function') {
    window.AdoptPlant.applyProfileType(type);
  }
  if (window.AICoach && typeof window.AICoach.applyVisibility === 'function') {
    window.AICoach.applyVisibility();
  }
  applyChainNavUI();
  applySignupProfileCopy(type);
  try {
    if (typeof renderGrowerRankChip === 'function') renderGrowerRankChip();
  } catch {
    /* ignore */
  }
}

function applySignupProfileCopy(profileType) {
  const type = normalizeProfileType(profileType) || PROFILE_TYPES.grower;
  if (type === PROFILE_TYPES.adopter && window.GrowtooProfile) {
    const copy = window.GrowtooProfile.adopterIntentCopy();
    const heroP = document.querySelector('#view-adopt .adopt-hero-text .adopter-only');
    if (heroP && copy && copy.hero) heroP.textContent = copy.hero;
    const marketHint =
      document.querySelector('#market-open-hint .adopter-only') ||
      document.querySelector('#view-market .market-hint .adopter-only');
    if (marketHint && copy && copy.market) marketHint.textContent = copy.market;
    const ctaHint =
      document.getElementById('adopt-market-cta-hint') ||
      document.querySelector('#adopt-market-cta .market-hint');
    if (ctaHint && copy && copy.market) ctaHint.textContent = copy.market;
  }
}

function syncMoreNavVisibility() {
  const accountBtn = document.getElementById('btn-account');
  if (!accountBtn) return;
  const items = document.querySelectorAll('.more-nav-item');
  let visible = 0;
  items.forEach(function (el) {
    const style = window.getComputedStyle(el);
    if (style.display !== 'none' && style.visibility !== 'hidden') visible += 1;
  });
  // Account menu always stays available (privacy/terms/logout).
  if (visible === 0) {
    const overlay = document.getElementById('more-nav-overlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('more-nav-open');
    accountBtn.classList.remove('active');
    accountBtn.setAttribute('aria-expanded', 'false');
  }
}

function defaultViewForProfile() {
  // Growers land on the Journal dashboard, not Plants — that's where the
  // TODAY card (Log watering / Ask coach) lives, and those are the two
  // actions a grower actually reaches for daily.
  return isAdopterProfile() ? 'adopt' : 'dashboard';
}

function isViewAllowedForProfile(viewId) {
  if (!viewId) return false;
  if (viewId === 'admin') return isAdminPanelRole(currentUserRole);
  if (viewId === 'growlog') return isGrowerProfile();
  if (['plants', 'toolbox', 'danas'].includes(viewId)) return isGrowerProfile();
  // Growers post RWA offers; adopters browse & invest.
  // Pure growers stay on the journal path until they unlock Tokenise/Market.
  if (viewId === 'market') {
    if (isGrowerProfile() && !isChainOptIn()) return false;
    return true;
  }
  if (viewId === 'adopt') {
    if (isGrowerProfile() && !isChainOptIn()) return false;
    return true;
  }
  if (viewId === 'dashboard') return true;
  return false;
}

function applyRoleUI(role) {
  const adminEls = document.querySelectorAll(".admin-only");
  const superEls = document.querySelectorAll(".admin-super-only");

 
  adminEls.forEach(el => el.style.display = "none");
  superEls.forEach(el => el.style.display = "none");

 
  if (isAdminPanelRole(role)) {
    adminEls.forEach((el) => (el.style.display = "flex"));
  }

  if (isSuperadminRole(role)) {
    superEls.forEach((el) => (el.style.display = "flex"));
  }

  applySoilMoistureToolUI(role);

  const superHub = document.getElementById('admin-super-hub');
  if (superHub) {
    superHub.style.display = isSuperadminRole(role) ? 'flex' : 'none';
    superHub.setAttribute('aria-hidden', !isSuperadminRole(role));
  }

  applyProfileTypeUI(currentProfileType || PROFILE_TYPES.grower);
  try {
    const overlay = document.getElementById('more-nav-overlay');
    if (overlay && !overlay.hidden) renderAccountProfile();
  } catch {
    /* ignore */
  }
}


let currentUserRole = null;
let currentProfileType = null;

function normalizeUserRole(role) {
  const r = String(role == null ? '' : role).trim().toLowerCase();
  if (!r) return 'user';
  if (r === 'supadmin' || r === 'super-admin' || r === 'super_admin') return 'superadmin';
  return r;
}

function isAdminPanelRole(role) {
  const r = normalizeUserRole(role);
  return r === 'admin' || r === 'superadmin';
}

function isSuperadminRole(role) {
  return normalizeUserRole(role) === 'superadmin';
}

async function resolveCurrentUserRole() {
  if (currentUserRole && isAdminPanelRole(currentUserRole)) return currentUserRole;
  try {
    if (window.firebase && firebase.auth && firebase.auth().currentUser) {
      currentUserRole = await getCurrentUserRole(firebase.auth().currentUser);
      applyRoleUI(currentUserRole);
    }
  } catch (err) {
    console.warn('Role resolve failed', err);
  }
  return currentUserRole;
}

async function getCurrentUserRole(user) {
  const db = firebase.firestore();
  const userRef = db.collection("users").doc(user.uid);

  const docSnap = await userRef.get();

  if (!docSnap.exists) return "user";

  const data = docSnap.data() || {};
  const fromDoc = normalizeProfileType(data.profileType);
  if (fromDoc) {
    currentProfileType = fromDoc;
  } else if (!currentProfileType) {
    currentProfileType = PROFILE_TYPES.grower;
  }
  hydrateProfileLocalDefaults(data);

  return normalizeUserRole(data.role || "user");
}

function getInitialViewFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('view');
  } catch {
    return null;
  }
}

function finishAppLoading() {
  document.body.classList.remove('app-loading');
  const boot = document.getElementById('app-boot');
  if (boot) {
    boot.setAttribute('aria-busy', 'false');
    boot.hidden = true;
  }
}

function initFirebaseSync() {
  if (!window.firebase || !firebase.auth || !firebase.firestore) {
    remoteSyncReady = false;
    finishAppLoading();
    return;
  }

  let authBootstrapInFlight = false;
  let authBootstrapUid = '';

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      authBootstrapUid = '';
      localStorage.removeItem(STORAGE_AUTH);
      window.location.replace('../dnevnik/');
      return;
    }

    // Ignore duplicate auth callbacks for the same user while bootstrapping.
    if (authBootstrapInFlight && authBootstrapUid === user.uid) return;
    if (authBootstrapUid === user.uid && remoteSyncReady) {
      // Already booted this session — skip full reload on token refresh.
      return;
    }
    authBootstrapInFlight = true;
    authBootstrapUid = user.uid;

    try {
      localStorage.setItem(
        STORAGE_AUTH,
        JSON.stringify({
          email: user.email || '',
          uid: user.uid,
          loggedAt: Date.now()
        })
      );

      await ensureUserExists(user);
      if (window.DnevnikNotifications) {
        DnevnikNotifications.init();
        DnevnikNotifications.startWatch(user.uid);
        DnevnikNotifications.bindStatusHooks();
      }
      if (window.PlantToken && typeof PlantToken.bindAccount === 'function') {
        await PlantToken.bindAccount(user.uid);
      }
      if (window.WalletLink) {
        await WalletLink.loadProfile();
      }
      if (window.PlantToken && typeof PlantToken.reconcileWithProfile === 'function') {
        await PlantToken.reconcileWithProfile();
      }
      if (window.PlantToken && typeof PlantToken.syncFromSeedMints === 'function') {
        try {
          PlantToken.syncFromSeedMints();
        } catch {
          // ignore
        }
      }
      if (
        window.DnevnikNotifications &&
        typeof DnevnikNotifications.promptWalletReconnectIfNeeded === 'function'
      ) {
        try {
          DnevnikNotifications.promptWalletReconnectIfNeeded({
            view: isAdopterProfile() ? 'adopt' : 'market',
          });
        } catch {
          // ignore
        }
      }
      if (window.AdoptPlant && typeof window.AdoptPlant.renderGlobalWalletUI === 'function') {
        window.AdoptPlant.renderGlobalWalletUI();
      }
      if (window.AdoptPlant && typeof window.AdoptPlant.render === 'function') {
        try {
          window.AdoptPlant.render();
        } catch {
          // ignore if garden panel not mounted yet
        }
      }
      // Bind once — auth can re-fire and would otherwise stack listeners (crash loop).
      if (!window.__dnevnikWalletUiBound) {
        window.__dnevnikWalletUiBound = true;
        let dashTimer = null;
        function scheduleDashboardRefresh() {
          if (dashTimer) clearTimeout(dashTimer);
          dashTimer = setTimeout(function () {
            try {
              renderDashboard();
            } catch {
              // ignore
            }
          }, 80);
        }
        if (window.WalletLink && typeof WalletLink.onChange === 'function') {
          WalletLink.onChange(scheduleDashboardRefresh);
        }
        if (window.PlantToken && typeof PlantToken.onChange === 'function') {
          PlantToken.onChange(scheduleDashboardRefresh);
        }
      }
      currentUserRole = await getCurrentUserRole(user);
      await recordUserLogin(user, currentUserRole);
      applyRoleUI(currentUserRole);

      if (currentUserRole === 'admin') {
        isAdminReadOnly = true;
        remoteSyncReady = false;
        await loadSuperadminDatabaseForAdmin();
        applyAdminReadOnlyUI(
          'Read-only view of the entire superadmin database — plants cannot be edited.'
        );
      } else if (currentUserRole === 'viewer') {
        isAdminReadOnly = true;
        remoteSyncReady = false;
        await ensureViewerBootstrapGrant(user.uid, user.email || '');
        await loadSharedDatabaseForViewer(user.uid, user.email || '');
        applyAdminReadOnlyUI(
          'Read-only view of shared plants — editing is not allowed.'
        );
      } else {
        isAdminReadOnly = false;
        document.body.classList.remove('admin-readonly');
        const userEmail = user.email || '';
        if (isSharedHybridUser(userEmail)) {
          await loadHybridUserWithSharedReadOnly(user.uid, userEmail);
          applySharedLibraryBanner(
            'You can add and edit your own plants and entries. Plants from the superadmin shared library are view-only.'
          );
        } else {
          document.body.classList.remove('shared-library-mode');
          const remote = await loadRemoteStateIntoLocal(user.uid);
          const merged = mergeLocalWithRemoteState(remote);
          applyRemoteStateToLocal(merged);
          remoteSyncReady = true;
          // Push merged state so cloud catches up with any offline/local writes.
          scheduleRemoteSync({
            plants: plantsForRemoteSync(merged.plants),
            entries: entriesForRemoteSync(merged.entries),
            toolbox: merged.toolbox || {},
          });
        }
        if (!remoteSyncReady) remoteSyncReady = true;
      }

      refreshAllViewsAfterRemoteLoad();

      const initialView = getInitialViewFromUrl();
      if (initialView && isViewAllowedForProfile(initialView)) {
        showView(initialView);
      } else if (initialView && !isViewAllowedForProfile(initialView)) {
        showView(defaultViewForProfile());
      } else {
        showView(defaultViewForProfile());
      }
    } catch (err) {
      console.error('App init failed', err);
      authBootstrapUid = '';
    } finally {
      authBootstrapInFlight = false;
      finishAppLoading();
      if (window.DailyStatus && typeof DailyStatus.maybeShowAfterLogin === 'function') {
        try {
          DailyStatus.maybeShowAfterLogin({
            uid: user.uid,
            profileType: isAdopterProfile() ? 'adopter' : 'grower',
          });
        } catch (statusErr) {
          console.warn('DailyStatus', statusErr);
        }
      }
    }
  });
}













  const STAGES = {
    klijanje: 'Germination',
    sadnica: 'Seedling',
    vegetativna: 'Vegetative',
    cvjetanje: 'Flowering',
    susenje: 'Drying',
  };

  function canonicalPlantStage(value) {
    const v = String(value == null ? '' : value).trim();
    if (v && Object.prototype.hasOwnProperty.call(STAGES, v)) return v;
    return 'klijanje';
  }

  const SUBPHASE_FIELD = 'na_polju';

  const SUBPHASE_POTS = {
    pot_1_5dcl: '1.5 dcl',
    pot_5l: '5 L',
    pot_30l: '30 L',
    pot_10dcl: '10 dcl',
    pot_1_5l: '1.5 L',
    [SUBPHASE_FIELD]: 'In the field',
  };

  const SUBPHASE_ORDER = ['pot_1_5dcl', 'pot_5l', 'pot_30l'];

  function subphaseLabel(key) {
    if (!key) return '';
    return SUBPHASE_POTS[key] || key;
  }

  function normalizeSubphase(value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return null;
    if (v === SUBPHASE_FIELD || SUBPHASE_POTS[v]) return v;
    return null;
  }

  function nextPotSubphase(current) {
    const cur = normalizeSubphase(current);
    if (!cur || cur === SUBPHASE_FIELD) return SUBPHASE_ORDER[0];
    const idx = SUBPHASE_ORDER.indexOf(cur);
    if (idx < 0) return SUBPHASE_ORDER[0];
    if (idx >= SUBPHASE_ORDER.length - 1) return null;
    return SUBPHASE_ORDER[idx + 1];
  }

  function isOutdoorPlantContext(envType, subphase) {
    return envType === 'outdoor' || subphase === SUBPHASE_FIELD;
  }

  const ENTRY_TYPE_LABELS = {
    opcenito: 'General',
    zalijevanje: 'Watering',
    gnojidba: 'Feeding',
    okolis: 'Environment',
    presadjivanje: 'Transplanting',
    stresori: 'Stressors',
    ostalo: 'Other',
    faza: 'Stage (transition)',
    podfaza: 'Sub-phase (pot / field)',
  };

  function isToolboxMirroredEntry(entry) {
    const m = entry && entry.meta;
    if (!m || typeof m !== 'object') return false;
    return m.source === 'toolbox' || !!m.toolboxTool;
  }

  /** Strip the mirror suffix from notes when we show a via-Tools badge. */
  function displayEntryNote(note) {
    return String(note || '')
      .replace(/\s*\(via Tools\)\s*$/i, '')
      .trim();
  }

  function entrySourceBadgeHtml(entry) {
    if (!isToolboxMirroredEntry(entry)) return '';
    return (
      '<span class="entry-source entry-source--tools" title="Also kept in Tools charts">' +
      'via Tools</span>'
    );
  }

  function toolboxMeasurementMetaHtml(entry) {
    if (!isToolboxMirroredEntry(entry) || !entry.meta) return '';
    const m = entry.meta;
    const parts = [];
    if (m.amountMl != null && String(m.amountMl).trim() !== '') {
      parts.push(escapeHtml(String(m.amountMl).trim()) + ' mL');
    }
    if (m.product) parts.push(escapeHtml(String(m.product)));
    if (m.detail) parts.push(escapeHtml(String(m.detail)));
    if (m.temperatureC) parts.push(escapeHtml(String(m.temperatureC)) + '°C');
    if (m.humidityPct) parts.push(escapeHtml(String(m.humidityPct)) + '% RH');
    if (m.ph) parts.push('pH ' + escapeHtml(String(m.ph)));
    if (!parts.length) return '';
    return (
      '<div class="entry-meta-block"><strong>Measurement</strong><p>' +
      parts.join(' · ') +
      '</p></div>'
    );
  }

  function getPlants() {
    try {
      const data = localStorage.getItem(STORAGE_PLANTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function setPlants(plants) {
    if (blockAdminWrite()) return;
    localStorage.setItem(STORAGE_PLANTS, JSON.stringify(plants));
    scheduleRemoteSync({ plants: plantsForRemoteSync(plants) });
  }

  function getEntries() {
    const list = readEntriesFromStorage();
    return Array.isArray(list) ? list : [];
  }

  /** Fresh parse from disk — null if missing/corrupt (not an empty journal). */
  function readEntriesFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_ENTRIES);
      if (raw == null || raw === '') return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function entriesIdsMatch(expected, actual) {
    const want = new Set(
      (expected || []).map(function (e) {
        return e && e.id ? String(e.id) : '';
      }).filter(Boolean)
    );
    const got = new Set(
      (actual || []).map(function (e) {
        return e && e.id ? String(e.id) : '';
      }).filter(Boolean)
    );
    if (want.size !== got.size) return false;
    var ok = true;
    want.forEach(function (id) {
      if (!got.has(id)) ok = false;
    });
    return ok;
  }

  /**
   * Persist journal entries, then re-read from localStorage before success.
   * Same defensive idea as wallet-link: never trust a write until a round-trip confirms it.
   */
  function setEntries(entries) {
    if (blockAdminWrite()) return false;
    const list = Array.isArray(entries) ? entries : [];
    try {
      localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(list));
    } catch (err) {
      console.error('Failed to save journal entries locally', err);
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        DnevnikNotifications.toast(
          'Could not save journal entry (storage full or blocked). Try a shorter note or remove old photos.',
          'error'
        );
      } else {
        alert('Could not save journal entry. Local storage may be full.');
      }
      return false;
    }

    const reread = readEntriesFromStorage();
    if (!Array.isArray(reread) || !entriesIdsMatch(list, reread)) {
      console.error('Journal write verification failed — re-read mismatch after setItem');
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        DnevnikNotifications.toast('Entry did not save. Please try again.', 'error');
      } else {
        alert('Entry did not save. Please try again.');
      }
      return false;
    }

    scheduleRemoteSync({ entries: entriesForRemoteSync(reread) });
    return true;
  }

  /** Field-level confirm that a specific entry landed (id + plant + type). */
  function verifyEntryLanded(entry) {
    if (!entry || !entry.id) return null;
    const reread = readEntriesFromStorage();
    if (!Array.isArray(reread)) return null;
    const found = reread.find(function (en) {
      return en && String(en.id) === String(entry.id);
    });
    if (!found) return null;
    if (String(found.plantId || '') !== String(entry.plantId || '')) return null;
    if (String(found.type || '') !== String(entry.type || '')) return null;
    return found;
  }

  function uuid() {
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function localDateYYYYMMDD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function readTodayState() {
    try {
      const raw = localStorage.getItem(STORAGE_TODAY_STATE);
      const data = raw ? JSON.parse(raw) : null;
      if (!data || typeof data !== 'object') return { dayKey: localDateYYYYMMDD(), done: {} };
      if (data.dayKey !== localDateYYYYMMDD()) return { dayKey: localDateYYYYMMDD(), done: {} };
      return {
        dayKey: String(data.dayKey || localDateYYYYMMDD()),
        done: data.done && typeof data.done === 'object' ? data.done : {},
      };
    } catch {
      return { dayKey: localDateYYYYMMDD(), done: {} };
    }
  }

  function writeTodayState(state) {
    try {
      localStorage.setItem(STORAGE_TODAY_STATE, JSON.stringify(state || { dayKey: localDateYYYYMMDD(), done: {} }));
    } catch {
      // ignore
    }
  }

  function renderToday() {
    const container = document.querySelector('#view-danas .danas-list');
    if (!container) return;
    const reminders =
      window.AICoach && typeof window.AICoach.getReminders === 'function'
        ? window.AICoach.getReminders()
        : [];
    const state = readTodayState();
    const briefing =
      window.AICoach && typeof window.AICoach.dashboardBriefing === 'function'
        ? window.AICoach.dashboardBriefing(getPlants(), getEntries())
        : '';

    let head = '';
    if (briefing) {
      head =
        '<div class="danas-coach-brief">' +
        '<span class="dashboard-coach-brief-label">Coach</span> ' +
        escapeHtml(briefing) +
        '</div>';
    }

    if (!reminders.length) {
      container.innerHTML =
        head +
        emptyStateHtml({
          icon: 'coach',
          lead: 'Nothing urgent',
          body: 'Keep logging care — Coach uses your pace and the forecast for the next nudge.',
        });
      return;
    }

    container.innerHTML =
      head +
      reminders
        .slice(0, 8)
        .map(function (r) {
          const done = !!state.done[String(r.id || '')];
          const canDraft = (function () {
            if (
              !window.AICoach ||
              typeof AICoach.draftActionFromReminder !== 'function' ||
              !AICoach.draftActionFromReminder(r)
            ) {
              return false;
            }
            if (window.CoachCore && typeof CoachCore.resolveActionMode === 'function') {
              return CoachCore.resolveActionMode('add_entry') === 'draft';
            }
            return true;
          })();
          return (
            '<label class="danas-item' +
            (r.kind === 'predictive' ? ' danas-item--predictive' : '') +
            '">' +
            '<input type="checkbox" data-today-id="' +
            escapeHtml(String(r.id || '')) +
            '"' +
            (done ? ' checked' : '') +
            ' />' +
            '<div class="danas-content">' +
            '<span class="danas-title">' +
            escapeHtml(String(r.title || 'Reminder')) +
            '</span>' +
            '<span class="danas-desc">' +
            escapeHtml(String(r.message || '')) +
            '</span>' +
            '<div class="danas-actions">' +
            (canDraft
              ? '<button type="button" class="btn btn-primary btn-sm danas-draft-coach" data-coach-draft="' +
                escapeHtml(String(r.id || '')) +
                '">Draft log</button>'
              : '') +
            '<button type="button" class="link-btn danas-open-coach" data-coach-prompt="' +
            escapeHtml(String(r.prompt || '')) +
            '">' +
            (canDraft ? 'Ask first' : 'Open Coach') +
            '</button>' +
            '</div>' +
            '</div>' +
            '</label>'
          );
        })
        .join('');
  }

  // --- Navigation ---
  const navItems = document.querySelectorAll('.nav-item[data-view], .more-nav-item[data-view]');
  const views = document.querySelectorAll('.view');
  const viewTitle = document.querySelector('.view-title');
  const logoutBtn = document.getElementById('btn-logout');
  const MORE_NAV_VIEWS = ['toolbox', 'danas', 'admin'];
  const titles = {
    dashboard: 'Journal',
    plants: 'Plants',
    adopt: 'Tokenise',
    market: 'Market',
    growlog: 'Grow log',
    toolbox: 'Tools',
    admin: 'Admin Panel',
    danas: 'Today',
  };

  let currentGrowlogPlantId = null;

  async function performLogout() {
    const uid =
      window.firebase && firebase.auth && firebase.auth().currentUser
        ? firebase.auth().currentUser.uid
        : '';
    try {
      if (window.SolanaWallet && typeof SolanaWallet.disconnect === 'function') {
        await SolanaWallet.disconnect();
      }
    } catch {
      // ignore
    }
    if (window.DnevnikNotifications && typeof DnevnikNotifications.clearWalletReconnectPrompt === 'function') {
      DnevnikNotifications.clearWalletReconnectPrompt(uid);
    }
    try {
      if (window.firebase && firebase.auth) await firebase.auth().signOut();
    } catch {
      // ignore
    }
    localStorage.removeItem(STORAGE_AUTH);
    window.location.replace('../dnevnik/');
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', performLogout);
  }
  const logoutSheetBtn = document.getElementById('btn-logout-sheet');
  if (logoutSheetBtn) {
    logoutSheetBtn.addEventListener('click', function () {
      setMoreNavOpen(false);
      performLogout();
    });
  }
  const unlockChainBtn = document.getElementById('btn-unlock-chain');
  if (unlockChainBtn) {
    unlockChainBtn.addEventListener('click', async function () {
      setMoreNavOpen(false);
      await promptUnlockChain('adopt');
    });
  }
  if (window.WalletLink && typeof WalletLink.onChange === 'function') {
    WalletLink.onChange(function () {
      applyChainNavUI();
    });
  }
  if (window.PlantToken && typeof PlantToken.onChange === 'function') {
    PlantToken.onChange(function () {
      applyChainNavUI();
    });
  }

  function showView(id, extra) {
    // Chain-locked growers: Tokenise/Market CTAs (START HERE, tour, etc.)
    // must open the unlock dialog — never silently fall back to Plants.
    if (
      (id === 'adopt' || id === 'market') &&
      isGrowerProfile() &&
      !isChainOptIn()
    ) {
      promptUnlockChain(id);
      return;
    }
    if (id !== 'growlog' && !isViewAllowedForProfile(id)) {
      id = defaultViewForProfile();
    }
    if (id === 'growlog' && !isGrowerProfile()) {
      id = defaultViewForProfile();
      extra = null;
    }
    views.forEach((v) => v.classList.remove('active'));
    navItems.forEach((n) => n.classList.remove('active'));
    if (id === 'growlog' && extra) {
      currentGrowlogPlantId = extra;
      const view = document.getElementById('view-growlog');
      if (view) view.classList.add('active');
      const plant = getPlants().find((p) => p.id === extra);
      if (viewTitle) viewTitle.textContent = plant ? plant.name : 'Growlog';
      document.querySelectorAll('.nav-item[data-view="plants"]').forEach((n) => n.classList.add('active'));
      const moreBtnEarly = document.getElementById('btn-account');
      if (moreBtnEarly) moreBtnEarly.classList.remove('active');
      setMoreNavOpen(false);
      setLogSheetOpen(false);
      if (window.AdoptPlant && typeof window.AdoptPlant.renderGlobalWalletUI === 'function') {
        window.AdoptPlant.renderGlobalWalletUI();
      }
      if (window.AICoach && typeof window.AICoach.applyVisibility === 'function') {
        window.AICoach.applyVisibility();
      }
      renderGrowlog(extra);
      return;
    }
    currentGrowlogPlantId = null;
    const view = document.getElementById('view-' + id);
    document.querySelectorAll('.nav-item[data-view="' + id + '"], .more-nav-item[data-view="' + id + '"]').forEach((n) => n.classList.add('active'));
    const accountBtn = document.getElementById('btn-account');
    if (accountBtn) {
      accountBtn.classList.toggle('active', MORE_NAV_VIEWS.indexOf(id) !== -1);
    }
    setMoreNavOpen(false);
    setLogSheetOpen(false);
    if (view) view.classList.add('active');
    if (window.AdoptPlant && typeof window.AdoptPlant.renderGlobalWalletUI === 'function') {
      window.AdoptPlant.renderGlobalWalletUI();
    }
    if (viewTitle) {
      if (id === 'adopt' && isAdopterProfile()) {
        viewTitle.textContent = 'My garden';
      } else if (id === 'adopt' && isGrowerProfile()) {
        viewTitle.textContent = 'Tokenise';
      } else if (titles[id]) {
        viewTitle.textContent = titles[id];
      }
    }
    if (id === 'dashboard') renderDashboard();
    if (id === 'plants') {
      initPlantsWeatherWidget();
      renderPlants();
      renderJournal();
    }
    if (id === 'adopt' && window.AdoptPlant) window.AdoptPlant.render();
    if (id === 'market' && window.Market) window.Market.render();
    if (id === 'toolbox') renderToolbox();
    if (id === 'danas') renderToday();
    if (id === 'admin' && isSuperadminRole(currentUserRole)) {
      renderSuperadminUserReport(adminReportPeriod);
      renderSuperadminSharingPanel();
    }
    if (window.AICoach && typeof window.AICoach.applyVisibility === 'function') {
      window.AICoach.applyVisibility();
    }
    if (
      window.DnevnikNotifications &&
      typeof window.DnevnikNotifications.syncCareDueFromCoach === 'function'
    ) {
      try {
        window.DnevnikNotifications.syncCareDueFromCoach();
      } catch {
        // ignore
      }
    }

    maybeNotifyCareProgress();
  }

  window.showAppView = function (id, plantId) {
    if (id === 'growlog' || (id === 'plants' && plantId)) {
      showView(plantId ? 'growlog' : id, plantId || null);
      return;
    }
    showView(id, plantId || null);
  };

  function maybeNotifyCareProgress() {
    if (!window.DnevnikNotifications || !window.GrowerQuests || !isGrowerProfile()) return;
    getPlants().forEach(function (p) {
      if (!p || !p.id) return;
      const week = GrowerQuests.currentWeekCareProgress(p.id);
      if (week && week.ok) {
        DnevnikNotifications.notifyCareProgress(
          'week',
          p.id,
          p.name,
          week.weekKey,
          week.daysHit,
          week.minDays
        );
      }
      const month = GrowerQuests.currentMonthCareProgress(p.id);
      if (month && month.ok) {
        DnevnikNotifications.notifyCareProgress(
          'month',
          p.id,
          p.name,
          month.monthKey,
          month.daysHit,
          month.minDays
        );
      }
    });
  }

  navItems.forEach((item) => {
  item.addEventListener("click", async (e) => {
    e.preventDefault();

    const view = item.dataset.view;

    if (view === "admin") {
      await resolveCurrentUserRole();
      if (!isAdminPanelRole(currentUserRole)) {
        alert('Access denied — you do not have admin privileges.');
        return;
      }
    }

    if (view !== "growlog") currentGrowlogPlantId = null;
    showView(view);
  });
});

  /**
   * Grabber bars on the Log / More sheets are rendered up front but only become
   * draggable once a sheet is opened. SheetDrag.attach is idempotent.
   */
  function bindSheetDrag() {
    if (!window.SheetDrag) return;
    const logSheet = document.querySelector('#log-sheet-overlay .log-sheet');
    const logHandle = document.querySelector('#log-sheet-overlay .log-sheet-handle');
    if (logSheet && logHandle) {
      SheetDrag.attach(logHandle, logSheet, { onDismiss: () => setLogSheetOpen(false) });
    }
    const moreSheet = document.querySelector('#more-nav-overlay .more-nav-sheet');
    const moreHandle = document.querySelector('#more-nav-overlay .more-nav-handle');
    if (moreSheet && moreHandle) {
      SheetDrag.attach(moreHandle, moreSheet, { onDismiss: () => setMoreNavOpen(false) });
    }
  }

  function setMoreNavOpen(open) {
    const overlay = document.getElementById('more-nav-overlay');
    const btn = document.getElementById('btn-account');
    if (overlay) overlay.hidden = !open;
    if (open) bindSheetDrag();
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('more-nav-open', !!open);
    if (open) {
      try {
        renderAccountProfile();
      } catch (err) {
        console.warn('account profile', err);
      }
      const logOverlay = document.getElementById('log-sheet-overlay');
      const logBtn = document.getElementById('bottom-nav-log');
      const sideBtn = document.getElementById('sidebar-log-btn');
      if (logOverlay) logOverlay.hidden = true;
      if (logBtn) logBtn.setAttribute('aria-expanded', 'false');
      if (sideBtn) sideBtn.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('log-sheet-open');
    }
  }

  function setLogSheetOpen(open) {
    const overlay = document.getElementById('log-sheet-overlay');
    const btn = document.getElementById('bottom-nav-log');
    const sideBtn = document.getElementById('sidebar-log-btn');
    if (overlay) overlay.hidden = !open;
    if (open) bindSheetDrag();
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (sideBtn) sideBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('log-sheet-open', !!open);
    if (open) {
      const moreOverlay = document.getElementById('more-nav-overlay');
      const accountBtn = document.getElementById('btn-account');
      if (moreOverlay) moreOverlay.hidden = true;
      if (accountBtn) accountBtn.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('more-nav-open');
      renderLogSheet();
    } else {
      logSheetPendingAction = null;
    }
  }

  let logSheetSelectedPlantId = '';
  let logSheetPendingAction = null; // 'water' | 'feed' | null

  function loggablePlants() {
    return getPlants().filter((p) => p && p.id && !isSharedPlantId(p.id));
  }

  function renderLogSheet() {
    const listEl = document.getElementById('log-sheet-plants');
    const emptyEl = document.getElementById('log-sheet-empty');
    const actionsEl = document.getElementById('log-sheet-actions');
    const plants = loggablePlants();
    if (!listEl) return;

    if (!plants.length) {
      logSheetSelectedPlantId = '';
      listEl.innerHTML = '';
      listEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      if (actionsEl) actionsEl.hidden = true;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;
    if (actionsEl) actionsEl.hidden = false;

    if (!logSheetSelectedPlantId || !plants.some((p) => p.id === logSheetSelectedPlantId)) {
      logSheetSelectedPlantId = plants[0].id;
    }

    listEl.innerHTML = plants
      .map(function (p, i) {
        const selected = p.id === logSheetSelectedPlantId;
        return (
          '<button type="button" class="log-sheet-plant' +
          (selected ? ' is-selected' : '') +
          '" role="option" aria-selected="' +
          (selected ? 'true' : 'false') +
          '" data-plant-id="' +
          escapeHtml(p.id) +
          '">' +
          '<span class="log-sheet-plant-no">№ ' +
          plantSpecimenNo(i) +
          '</span>' +
          '<span class="log-sheet-plant-name">' +
          escapeHtml(p.name || 'Plant') +
          '</span>' +
          '</button>'
        );
      })
      .join('');

    listEl.querySelectorAll('[data-plant-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        logSheetSelectedPlantId = btn.getAttribute('data-plant-id') || '';
        renderLogSheet();
      });
    });
  }

  function openLogSheet(pendingAction) {
    if (blockAdminWrite()) return;
    logSheetPendingAction = pendingAction || null;
    setLogSheetOpen(true);
    if (pendingAction && loggablePlants().length === 1) {
      // Single plant: run immediately after sheet paints.
      window.setTimeout(function () {
        if (pendingAction === 'water') quickLogWatering();
        else if (pendingAction === 'feed') quickLogFeeding();
        setLogSheetOpen(false);
      }, 0);
    }
  }

  (function bindMoreNav() {
    const btn = document.getElementById('btn-account');
    const backdrop = document.getElementById('more-nav-backdrop');
    const closeBtn = document.getElementById('more-nav-close');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const overlay = document.getElementById('more-nav-overlay');
        setMoreNavOpen(!(overlay && !overlay.hidden));
      });
    }
    if (backdrop) backdrop.addEventListener('click', function () { setMoreNavOpen(false); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setMoreNavOpen(false); });
  })();

  function openGrowCoachFromNav() {
    if (blockAdminWrite()) return;
    setMoreNavOpen(false);
    setLogSheetOpen(false);
    if (window.AICoach && typeof AICoach.open === 'function') {
      AICoach.open();
    }
  }

  (function bindCoachNav() {
    ['bottom-nav-coach', 'sidebar-coach-btn', 'more-nav-coach'].forEach(function (id) {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.coachBound === '1') return;
      btn.dataset.coachBound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openGrowCoachFromNav();
      });
    });
  })();

  (function bindLogSheet() {
    function toggleLog() {
      if (blockAdminWrite()) return;
      const overlay = document.getElementById('log-sheet-overlay');
      const opening = !(overlay && !overlay.hidden);
      if (opening) openLogSheet(null);
      else setLogSheetOpen(false);
    }
    const bottomLog = document.getElementById('bottom-nav-log');
    const sideLog = document.getElementById('sidebar-log-btn');
    const plantsQuickLog = document.getElementById('plants-quick-log');
    const backdrop = document.getElementById('log-sheet-backdrop');
    const closeBtn = document.getElementById('log-sheet-close');
    const water = document.getElementById('log-sheet-water');
    const feed = document.getElementById('log-sheet-feed');
    const full = document.getElementById('log-sheet-full');
    const addPlant = document.getElementById('log-sheet-add-plant');
    if (bottomLog) bottomLog.addEventListener('click', function (e) { e.preventDefault(); toggleLog(); });
    if (sideLog) sideLog.addEventListener('click', function (e) { e.preventDefault(); toggleLog(); });
    // Plants is the grower's default landing view — mirror the Journal TODAY
    // card's quick actions here too, since that's most often the first screen.
    if (plantsQuickLog) plantsQuickLog.addEventListener('click', function (e) { e.preventDefault(); toggleLog(); });
    if (backdrop) backdrop.addEventListener('click', function () { setLogSheetOpen(false); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setLogSheetOpen(false); });
    if (addPlant) {
      addPlant.addEventListener('click', function () {
        setLogSheetOpen(false);
        if (blockAdminWrite()) return;
        openPlantModal();
      });
    }
    if (water) {
      water.addEventListener('click', function () {
        quickLogWatering();
        setLogSheetOpen(false);
      });
    }
    if (feed) {
      feed.addEventListener('click', function () {
        quickLogFeeding();
        setLogSheetOpen(false);
      });
    }
    if (full) {
      full.addEventListener('click', function () {
        const plantId = logSheetSelectedPlantId;
        const pending = logSheetPendingAction;
        const typeHint =
          pending === 'water' ? 'zalijevanje' : pending === 'feed' ? 'gnojidba' : null;
        setLogSheetOpen(false);
        startJournalEntry({ plantId: plantId || null, type: typeHint });
      });
    }
  })();

  // Escape closes account + log sheets.
  (function bindShellSheetEscape() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      setMoreNavOpen(false);
      setLogSheetOpen(false);
    });
  })();

  const viewGrowlogEl = document.getElementById('view-growlog');
  if (viewGrowlogEl) {
    viewGrowlogEl.addEventListener('click', (e) => {
      if (e.target.closest('#growlog-back')) {
        e.preventDefault();
        showView('plants');
      }
    });
  }

  const viewDanasEl = document.getElementById('view-danas');
  if (viewDanasEl) {
    viewDanasEl.addEventListener('change', (e) => {
      const input = e.target.closest('[data-today-id]');
      if (!input) return;
      const id = String(input.getAttribute('data-today-id') || '');
      if (!id) return;
      const state = readTodayState();
      state.done[id] = !!input.checked;
      writeTodayState(state);
    });
    viewDanasEl.addEventListener('click', (e) => {
      const draftBtn = e.target.closest('[data-coach-draft]');
      if (draftBtn) {
        e.preventDefault();
        const draftId = draftBtn.getAttribute('data-coach-draft');
        if (draftId && window.AICoach && typeof AICoach.proposeDraftFromReminder === 'function') {
          AICoach.proposeDraftFromReminder(draftId);
        }
        return;
      }
      const btn = e.target.closest('[data-coach-prompt]');
      if (!btn) return;
      e.preventDefault();
      const prompt = btn.getAttribute('data-coach-prompt');
      if (!prompt) return;
      if (window.AICoach) {
        AICoach.open();
        setTimeout(function () {
          AICoach.ask(prompt);
        }, 90);
      }
    });
  }

  function openGrowlog(plantId) {
    showView('growlog', plantId);
  }

  window.addEventListener('dnevnik:open-growlog', (e) => {
    const plantId = e && e.detail && e.detail.plantId;
    if (plantId) openGrowlog(plantId);
  });

  function getPlantEntries(plantId) {
    return getEntries().filter((e) => e.plantId === plantId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function weeksBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    const a = new Date(d1);
    const b = new Date(d2);
    return Math.max(0, Math.floor((b - a) / (7 * 24 * 60 * 60 * 1000)));
  }

  function daysBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    return Math.max(0, Math.floor((new Date(d2) - new Date(d1)) / (24 * 60 * 60 * 1000)));
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const n = new Date();
    const sec = Math.floor((n - d) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
    if (sec < 86400) return Math.floor(sec / 3600) + ' h ago';
    if (sec < 604800) return Math.floor(sec / 86400) + ' d ago';
    if (sec < 2592000) return Math.floor(sec / 604800) + ' weeks ago';
    if (sec < 31536000) return Math.floor(sec / 2592000) + ' mo. ago';
    return Math.floor(sec / 31536000) + ' yr. ago';
  }

  function formatDayWeek(dateStr, startDateStr) {
    if (!dateStr || !startDateStr) return '';
    const d = new Date(dateStr);
    const start = new Date(startDateStr);
    const day = daysBetween(startDateStr, dateStr);
    const week = Math.floor(day / 7);
    return 'Day ' + day + ' (week ' + week + ')';
  }

  const STAGE_ICONS = {
    klijanje: '🌱',
    sadnica: '🌿',
    vegetativna: '🪴',
    cvjetanje: '🌸',
    susenje: '🍂',
  };

  function renderGrowlog(plantId) {
    const plant = getPlants().find((p) => p.id === plantId);
    const entries = getPlantEntries(plantId);
    const sharedPlant = isSharedPlantId(plantId);
    const addEntryGrowlog = document.getElementById('btn-add-entry-growlog');
    const editPlantGrowlog = document.getElementById('btn-edit-plant-growlog');
    if (addEntryGrowlog) addEntryGrowlog.hidden = sharedPlant;
    if (editPlantGrowlog) editPlantGrowlog.hidden = sharedPlant;
    if (!plant) return;

    const startDate = plant.startDate || new Date().toISOString().slice(0, 10);
    const updatedAt = plant.updatedAt || (plant.startDate ? plant.startDate + 'T12:00:00.000Z' : new Date().toISOString());
    const views = plant.views != null ? plant.views : 0;
    const durationWeeks = weeksBetween(startDate, updatedAt.slice(0, 10));
    const envType = plant.environmentType === 'outdoor' ? 'Outdoor' : 'Indoor';
    const exposure = plant.exposureHours ? plant.exposureHours + ' h' : '—';
    let plantIsPublic = false;
    try {
      if (window.PlantToken && typeof PlantToken.getWallet === 'function') {
        const tokens = (PlantToken.getWallet() || {}).tokens || [];
        plantIsPublic = tokens.some(function (t) {
          return t && (t.plantId === plantId || t.id === plantId) && (t.mintAddress || t.listed);
        });
      }
    } catch {
      plantIsPublic = false;
    }

    document.getElementById('growlog-updated').textContent = 'Updated ' + timeAgo(updatedAt);
    const viewsEl = document.getElementById('growlog-views');
    if (viewsEl) {
      // Private un-minted journals shouldn't imply an audience with "0 views".
      if (!plantIsPublic || !views) {
        viewsEl.hidden = true;
        viewsEl.textContent = '';
      } else {
        viewsEl.hidden = false;
        viewsEl.textContent = views + (views === 1 ? ' public view' : ' public views');
      }
    }

    document.getElementById('growlog-metrics').innerHTML = `
      <div class="growlog-metric"><span class="growlog-metric-icon">📅</span> ${durationWeeks} weeks</div>
      <div class="growlog-metric"><span class="growlog-metric-icon">💧</span> ${STAGES[plant.stage] || plant.stage}</div>
      <div class="growlog-metric"><span class="growlog-metric-icon">💡</span> ${envType}</div>
    `;

    const allPhotos = [];
    if (plant.photo) allPhotos.push(plant.photo);
    entries.forEach((e) => {
      if (e.photo) allPhotos.push(e.photo);
    });
    const photoGrid = document.getElementById('growlog-photo-grid');
    photoGrid.innerHTML = allPhotos.slice(0, 3).map((src) => '<img src="' + src + '" alt="" />').join('') || '<p class="growlog-empty">No photos</p>';
    document.getElementById('growlog-view-all-photos').style.display = allPhotos.length > 3 ? 'inline-block' : 'none';

    document.getElementById('growlog-strain').innerHTML = plant.strain
      ? '<span class="strain-icon">🧬</span> ' + escapeHtml(plant.strain)
      : '<span class="growlog-empty">—</span>';

    const stageOrder = ['klijanje', 'sadnica', 'vegetativna', 'cvjetanje', 'susenje'];
    const stageDates = plant.stageDates || {};
    const stageRows = stageOrder
      .map((s) => {
        const date = stageDates[s] || (s === 'klijanje' ? startDate : null);
        const isCurrent = canonicalPlantStage(plant.stage) === s;
        const label = STAGES[s] || s;
        const dateStr = date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
        return '<div class="tree-stage-item' + (isCurrent ? ' current' : '') + '"><span class="tree-stage-icon">' + (STAGE_ICONS[s] || '•') + '</span><span class="tree-stage-label">' + label + '</span><span class="tree-stage-date">' + dateStr + '</span></div>';
      })
      .join('');

    const subphaseDisplayOrder = SUBPHASE_ORDER.concat(
      plant.subphase === SUBPHASE_FIELD || plant.environmentType === 'outdoor' ? [SUBPHASE_FIELD] : []
    );
    const subRows = subphaseDisplayOrder
      .filter((k, i, arr) => arr.indexOf(k) === i)
      .map((k) => {
        const isCurrent =
          plant.subphase === k || (k === SUBPHASE_FIELD && !plant.subphase && plant.environmentType === 'outdoor');
        const label = SUBPHASE_POTS[k];
        const icon = k === SUBPHASE_FIELD ? '🌾' : '🫙';
        return (
          '<div class="tree-stage-item tree-subphase-item' +
          (isCurrent ? ' current' : '') +
          '"><span class="tree-stage-icon">' +
          icon +
          '</span><span class="tree-stage-label">' +
          escapeHtml(label) +
          '</span></div>'
        );
      })
      .join('');

    const hist = plant.stageHistory || [];
    let histHtml;
    if (hist.length === 0) {
      histHtml =
        '<p class="growlog-empty">No transitions recorded yet. Change the stage in &quot;Edit plant&quot; — a journal entry will be created.</p>';
    } else {
      histHtml = hist
        .slice()
        .reverse()
        .map((h) => {
          const d = h.date ? new Date(h.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
          const line = h.from
            ? escapeHtml(STAGES[h.from] || h.from) + ' → ' + escapeHtml(STAGES[h.to] || h.to)
            : 'Start: ' + escapeHtml(STAGES[h.to] || h.to);
          return '<div class="stage-history-item"><span class="stage-history-date">' + d + '</span><span class="stage-history-label">' + line + '</span></div>';
        })
        .join('');
    }

    const phasesPanel = document.getElementById('growlog-phases-panel');
    if (phasesPanel) {
      phasesPanel.innerHTML =
        '<div class="tree-stages growlog-tree-stages">' +
        stageRows +
        '</div>' +
        '<h4 class="growlog-subsection-title">Sub-phases (pots)</h4>' +
        '<div class="tree-stages tree-subphases">' +
        subRows +
        '</div>' +
        '<h4 class="growlog-subsection-title">Stage transition history</h4>' +
        '<div class="stage-history-list">' +
        histHtml +
        '</div>' +
        (function () {
          const sh = plant.subphaseHistory || [];
          if (!sh.length) return '';
          const rows = sh
            .slice()
            .reverse()
            .map((h) => {
              const d = h.date
                ? new Date(h.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—';
              const fromLab = h.from ? subphaseLabel(h.from) : '—';
              const toLab = subphaseLabel(h.to) || h.to || '—';
              return (
                '<div class="stage-history-item"><span class="stage-history-date">' +
                d +
                '</span><span class="stage-history-label">' +
                escapeHtml(fromLab) +
                ' → ' +
                escapeHtml(toLab) +
                '</span></div>'
              );
            })
            .join('');
          return (
            '<h4 class="growlog-subsection-title">Sub-phase history (pots / field)</h4>' +
            '<div class="stage-history-list">' +
            rows +
            '</div>'
          );
        })();
    }

    document.getElementById('growlog-environment').innerHTML = `
      <div class="env-row"><span class="env-icon">⛺</span> ${escapeHtml(plant.environmentName || '—')}</div>
      <div class="env-row"><span class="env-icon">💡</span> ${envType}</div>
      ${
        plant.fieldLocation
          ? '<div class="env-row"><span class="env-icon">📍</span> Field: ' + escapeHtml(plant.fieldLocation) + '</div>'
          : ''
      }
      ${
        plant.plantingLocation
          ? '<div class="env-row"><span class="env-icon">🌱</span> Planting: ' + escapeHtml(plant.plantingLocation) + '</div>'
          : ''
      }
      <div class="env-row"><span class="env-icon">🕐</span> ${exposure} of light</div>
    `;

    const heroEl = document.getElementById('growlog-hero');
    if (heroEl) {
      const stageKey = canonicalPlantStage(plant.stage);
      const stageLabel = STAGES[stageKey] || plant.stage;
      const subLab = plant.subphase ? subphaseLabel(plant.subphase) : '';
      const strainHtml = plant.strain
        ? '<p class="growlog-hero-strain"><span class="growlog-hero-strain-icon" aria-hidden="true">🧬</span>' +
          escapeHtml(plant.strain) +
          '</p>'
        : '';
      heroEl.innerHTML =
        '<div class="growlog-hero-glow" aria-hidden="true"></div>' +
        '<div class="growlog-hero-inner">' +
        '<div class="growlog-hero-head">' +
        '<div class="growlog-hero-badges">' +
        '<span class="growlog-hero-chip growlog-hero-chip--accent">' +
        escapeHtml(stageLabel) +
        '</span>' +
        (subLab
          ? '<span class="growlog-hero-chip">' + escapeHtml(subLab) + '</span>'
          : '') +
        '<span class="growlog-hero-chip">' +
        durationWeeks +
        ' wk grow</span>' +
        '<span class="growlog-hero-chip growlog-hero-chip--muted">' +
        escapeHtml(envType) +
        '</span>' +
        '</div>' +
        (sharedPlant
          ? ''
          : '<button type="button" class="btn btn-ghost btn-sm growlog-hero-edit" id="growlog-hero-edit">✎ Edit plant</button>') +
        '</div>' +
        '<h2 class="growlog-hero-title">' +
        escapeHtml(plant.name) +
        '</h2>' +
        strainHtml +
        '<p class="growlog-hero-hint">Photos are in the sidebar and in the recent photos below.</p>' +
        '</div>';
      const heroEditBtn = document.getElementById('growlog-hero-edit');
      if (heroEditBtn) {
        heroEditBtn.addEventListener('click', () => openPlantModal(plantId));
      }
    }

    const rewardGoalEl = document.getElementById('growlog-reward-goal');
    if (rewardGoalEl) {
      const total =
        window.GrowtooPlain && typeof GrowtooPlain.totalGrowRewards === 'function'
          ? GrowtooPlain.totalGrowRewards()
          : 225;
      let linkedToken = null;
      if (window.PlantToken && typeof PlantToken.getWallet === 'function') {
        const tokens = PlantToken.getWallet().tokens || [];
        linkedToken = tokens.find(function (t) {
          return t && String(t.plantId) === String(plantId);
        });
      }
      if (linkedToken) {
        const remaining =
          window.GrowtooPlain && typeof GrowtooPlain.remainingGrowRewards === 'function'
            ? GrowtooPlain.remainingGrowRewards(linkedToken.stageIndex)
            : total;
        rewardGoalEl.hidden = false;
        rewardGoalEl.innerHTML =
          remaining > 0
            ? 'On-chain plant token linked — this plant can still earn up to <strong>' +
              remaining +
              ' $GROWTOO</strong> in stage rewards by harvest (up to ' +
              total +
              ' total across all stages).'
            : 'On-chain plant token linked — harvest stage complete. Stage rewards for this token are done.';
      } else {
        rewardGoalEl.hidden = false;
        rewardGoalEl.innerHTML =
          'If you mint an optional plant token, stage rewards can total up to <strong>' +
          total +
          ' $GROWTOO</strong> by harvest (test network only).';
      }
    }

    const timelineItems = [];
    entries.slice(0, 20).forEach((e) => {
      const dayWeek = formatDayWeek(e.date, startDate);
      const dateStr = e.date ? new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
      const typeLabel = ENTRY_TYPE_LABELS[e.type] || e.type || 'General';
      const noteRaw = displayEntryNote(e.note);
      const note = noteRaw.slice(0, 80) + (noteRaw.length > 80 ? '…' : '');
      const viaTools = entrySourceBadgeHtml(e);
      const media = e.photo ? '<img src="' + escapeHtml(e.photo) + '" alt="" class="timeline-thumb" />' : '';
      timelineItems.push(
        '<div class="timeline-entry"><div class="timeline-entry-header"><span class="timeline-date">📅 ' +
          dateStr +
          '</span><span class="timeline-day">' +
          dayWeek +
          '</span></div><div class="timeline-entry-body">' +
          escapeHtml(typeLabel) +
          (viaTools ? ' ' + viaTools : '') +
          (note ? ': ' + escapeHtml(note) : '') +
          '</div>' +
          (media ? '<div class="timeline-entry-media">' + media + '</div>' : '') +
          '</div>'
      );
    });
    document.getElementById('growlog-timeline').innerHTML = timelineItems.length ? timelineItems.join('') : '<p class="growlog-empty">No entries in the timeline. Add notes in the Journal.</p>';

    const stripPhotos = allPhotos.slice(0, 8);
    document.getElementById('growlog-photo-strip').innerHTML = stripPhotos.map((src) => '<img src="' + src + '" alt="" />').join('') || '<p class="growlog-empty">No photos</p>';

    document.getElementById('growlog-view-all-photos').onclick = () => {
      document.getElementById('growlog-photo-strip').scrollIntoView({ behavior: 'smooth' });
    };
  }

  // --- Dashboard ---
  function shortSolanaAddr(addr) {
    if (!addr || addr.length < 12) return addr || '—';
    return addr.slice(0, 4) + '…' + addr.slice(-4);
  }

  function plantSpecimenNo(index) {
    return String(index + 1).padStart(4, '0');
  }

  function daysSinceLastCare(plantId, entries, types) {
    const wanted = types || ['zalijevanje'];
    let latest = 0;
    (entries || []).forEach(function (e) {
      if (!e || e.plantId !== plantId || wanted.indexOf(e.type) === -1 || !e.date) return;
      const t = new Date(e.date + 'T12:00:00').getTime();
      if (t > latest) latest = t;
    });
    if (!latest) return null;
    return Math.floor((Date.now() - latest) / 86400000);
  }

  function renderTodayAndSeals(plants, entries) {
    const todaySection = document.getElementById('dashboard-today-section');
    const sealsSection = document.getElementById('dashboard-seals-section');
    const todayLine = document.getElementById('dashboard-today-line');
    const todayActions = document.getElementById('dashboard-today-actions');
    const sealsEl = document.getElementById('dashboard-plant-seals');
    const showGrowerHome = !isAdopterProfile() && plants.length > 0;

    if (todaySection) todaySection.hidden = !showGrowerHome;
    if (sealsSection) sealsSection.hidden = !showGrowerHome;
    if (!showGrowerHome) {
      if (todayLine) todayLine.textContent = '';
      if (todayActions) todayActions.innerHTML = '';
      if (sealsEl) sealsEl.innerHTML = '';
      return;
    }

    const brief =
      window.AICoach && typeof AICoach.todayHeadline === 'function'
        ? AICoach.todayHeadline(plants, entries)
        : window.AICoach && typeof AICoach.dashboardBriefing === 'function'
          ? AICoach.dashboardBriefing(plants, entries)
          : '';
    if (todayLine) todayLine.textContent = brief || 'Your garden is quiet — log a watering to keep the trail warm.';
    if (todayActions) {
      todayActions.innerHTML =
        '<button type="button" class="btn btn-primary btn-tap" id="today-log-water">Log watering</button>' +
        '<button type="button" class="btn btn-secondary btn-tap" id="today-ask-coach">Ask coach</button>';
      const waterBtn = document.getElementById('today-log-water');
      const coachBtn = document.getElementById('today-ask-coach');
      if (waterBtn) {
        waterBtn.addEventListener('click', function () {
          const plants = loggablePlants();
          if (plants.length > 1) openLogSheet('water');
          else quickLogWatering();
        });
      }
      if (coachBtn) {
        coachBtn.addEventListener('click', function () {
          if (window.AICoach) AICoach.open();
        });
      }
    }

    if (sealsEl) {
      sealsEl.innerHTML = plants
        .map(function (p, i) {
          const stage = STAGES[p.stage] || p.stage || 'Growing';
          const env =
            p.environmentType === 'outdoor' || p.fieldLocation
              ? 'outdoor'
              : 'indoor';
          const since = daysSinceLastCare(p.id, entries, ['zalijevanje']);
          const waterLine =
            since == null ? 'no watering yet' : since === 0 ? 'watered today' : since + 'd since water';
          const no = plantSpecimenNo(i);
          return (
            '<button type="button" class="shell-card plant-seal-card" data-plant-id="' +
            escapeHtml(p.id) +
            '">' +
            '<span class="plant-seal-mark" aria-hidden="true"></span>' +
            '<span class="plant-seal-title">Plant <span class="plant-seal-no">№</span> ' +
            no +
            ' — <em>' +
            escapeHtml(p.name || 'Plant') +
            '</em></span>' +
            '<span class="plant-seal-data">' +
            escapeHtml(stage) +
            ' · ' +
            waterLine +
            ' · ' +
            env +
            '</span>' +
            '</button>'
          );
        })
        .join('');
      sealsEl.querySelectorAll('[data-plant-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const id = btn.getAttribute('data-plant-id');
          if (id) showView('growlog', id);
        });
      });
    }
  }

  function renderCoachBriefingSurfaces() {
    const plants = getPlants();
    const entries = getEntries();
    const brief =
      window.AICoach && typeof AICoach.dashboardBriefing === 'function'
        ? AICoach.dashboardBriefing(plants, entries)
        : '';
    const dashBrief = document.getElementById('dashboard-coach-brief');
    if (dashBrief) {
      // Coach speaks from the Today card now — keep legacy strip hidden.
      dashBrief.hidden = true;
      dashBrief.innerHTML = '';
    }
    const plantsStrip = document.getElementById('coach-plants-strip');
    if (plantsStrip) {
      const show = !isAdopterProfile() && !!brief;
      plantsStrip.hidden = !show;
      plantsStrip.textContent = show ? brief : '';
    }
  }

  function renderDashboard() {
    const plants = getPlants();
    const entries = getEntries();
    renderCoachBriefingSurfaces();
    renderTodayAndSeals(plants, entries);
    const metricsEl = document.getElementById('dashboard-metrics');
    const recentEl = document.getElementById('recent-notes');
    const totalPlantCount = plants.reduce((sum, p) => sum + Math.max(1, Number(p.count || 1)), 0);
    const indoorCount = plants.filter((p) => p.environmentType === 'indoor' || (!p.environmentType && !p.fieldLocation)).length;
    const outdoorCount = plants.length - indoorCount;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const entriesWeek = entries.filter((e) => {
      if (!e.date) return false;
      return new Date(e.date + 'T12:00:00').getTime() >= weekAgo;
    }).length;
    const stageSet = new Set(plants.map((p) => p.stage).filter(Boolean));
    const stageCounts = {};
    plants.forEach((p) => {
      const s = p.stage || 'unknown';
      stageCounts[s] = (stageCounts[s] || 0) + 1;
    });
    const topStage = Object.keys(stageCounts).sort((a, b) => stageCounts[b] - stageCounts[a])[0];
    const topStagePct = plants.length && topStage ? Math.round((stageCounts[topStage] / plants.length) * 100) : 0;

    let growBalance = '—';
    let tokenCount = 0;
    let growingCount = 0;
    let growPct = 0;
    let walletDisplay = '—';
    let walletLinked = false;
    if (window.WalletLink) {
      const profile = WalletLink.getProfile();
      if (profile.solanaPubkey) {
        walletDisplay = shortSolanaAddr(profile.solanaPubkey);
        walletLinked = true;
      }
    }
    if (window.PlantToken) {
      const wallet = PlantToken.getWallet();
      if (!walletLinked && wallet.connected && wallet.address) {
        walletDisplay = shortSolanaAddr(wallet.address);
      }
      if (wallet.connected) {
        growBalance = Number(wallet.growthBalance || 0).toLocaleString('en-US');
        tokenCount = wallet.tokens.length;
        const maxStage = PlantToken.maxStageIndex();
        growingCount = wallet.tokens.filter((t) => t.stageIndex < maxStage).length;
        const grown = tokenCount - growingCount;
        growPct = tokenCount ? Math.round((grown / tokenCount) * 100) : 0;
      }
    }

    const adoptSection = document.getElementById('dashboard-adopt-section');
    const quickSection = document.getElementById('dashboard-quick-section');
    const quickEl = document.getElementById('dashboard-quick-actions');
    const isEmptyAdopter = isAdopterProfile() && tokenCount === 0;
    // Empty journal only — once plants exist, Today leads.
    const showGettingStarted = !isAdopterProfile() && !plants.length;
    const showGrowerJournalHome = !isAdopterProfile() && plants.length > 0;

    if (metricsEl && window.MetricUI) {
      const M = MetricUI;
      if (showGettingStarted) {
        metricsEl.hidden = false;
        metricsEl.innerHTML =
          '<article class="shell-card today-card dashboard-first-run" role="status">' +
          '<p class="today-card-eyebrow">Today</p>' +
          '<p class="today-card-line">Add your first plant — Coach will keep the care trail tidy from there.</p>' +
          '<div class="today-card-actions">' +
          '<button type="button" class="btn btn-primary btn-tap" id="dashboard-add-first-plant">Add a plant</button>' +
          '<button type="button" class="btn btn-secondary btn-tap" id="dashboard-open-coach-empty">Ask coach</button>' +
          '</div>' +
          '</article>';
        const addBtn = document.getElementById('dashboard-add-first-plant');
        const coachBtn = document.getElementById('dashboard-open-coach-empty');
        if (addBtn) {
          addBtn.addEventListener('click', function () {
            if (blockAdminWrite()) return;
            openPlantModal();
          });
        }
        if (coachBtn) {
          coachBtn.addEventListener('click', function () {
            if (window.AICoach) AICoach.open();
          });
        }
      } else if (isEmptyAdopter) {
        metricsEl.hidden = false;
        metricsEl.innerHTML =
          '<div class="dashboard-first-run shell-card" role="status">' +
          '<p class="dashboard-first-run-eyebrow">My garden</p>' +
          '<h2 class="dashboard-first-run-title">No adopted plants yet</h2>' +
          '<p class="dashboard-first-run-body">Browse the market for open offers, then invest with test $GROWTOO when you are ready.</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-open-market">Browse market</button>' +
          '</div>';
        const marketBtn = document.getElementById('dashboard-open-market');
        if (marketBtn) marketBtn.addEventListener('click', () => showView('market'));
      } else if (isAdopterProfile()) {
        metricsEl.hidden = false;
        metricsEl.innerHTML = M.panel(
          '',
          M.card({
            label: '$GROWTOO balance',
            value: growBalance,
            meta:
              M.row('Plant tokens', tokenCount, 'metric-dot--amber') +
              M.row('Still growing', growingCount, 'metric-dot--teal'),
            modifier: 'amber',
          }) +
            M.card({
              label: 'Garden progress',
              value: tokenCount ? growPct + '%' : '0%',
              meta:
                M.row('Harvested', Math.max(0, tokenCount - growingCount), 'metric-dot--teal') +
                M.row('In growth', growingCount, 'metric-dot--violet'),
              modifier: 'teal',
            }) +
            M.card({
              label: 'Solana wallet',
              value: walletDisplay,
              meta:
                M.row('Network', 'test network', 'metric-dot--teal') +
                M.row('Account', walletLinked ? 'Linked' : 'Not linked', walletLinked ? 'metric-dot--teal' : 'metric-dot--muted'),
              modifier: 'teal',
              attention: !walletLinked,
            }) +
            M.card({
              label: 'Market',
              value: 'Browse',
              meta:
                M.row('Action', 'Follow plant trails', 'metric-dot--amber') +
                M.row('Profile', 'Adopter', 'metric-dot--violet'),
              modifier: 'violet',
              attention: true,
            })
        );
      } else if (showGrowerJournalHome) {
        // Journal home: Today + seals replace the zero-stats wall.
        metricsEl.hidden = true;
        metricsEl.innerHTML = '';
      } else {
        metricsEl.hidden = false;
        metricsEl.innerHTML = M.panel(
          '',
          M.card({
            label: 'Grow overview',
            value: totalPlantCount.toLocaleString('en-US'),
            meta:
              M.row('Individual plants', plants.length, 'metric-dot--teal') +
              M.row('Plants in batch', totalPlantCount, 'metric-dot--blue'),
            modifier: 'teal',
          }) +
            M.card({
              label: 'Journal activity',
              value: entries.length.toLocaleString('en-US'),
              meta:
                M.row('Last 7 days', entriesWeek, 'metric-dot--blue') +
                M.row('Plant profiles', plants.length, 'metric-dot--muted'),
              modifier: 'blue',
            }) +
            M.card({
              label: 'Active stages',
              value: stageSet.size.toLocaleString('en-US'),
              meta:
                M.row(topStage ? STAGES[topStage] || topStage : 'No plants', topStagePct + '%', 'metric-dot--violet') +
                M.row('Outdoor', outdoorCount, 'metric-dot--amber'),
              modifier: 'violet',
            }) +
            M.card({
              label: 'Token portfolio',
              value: growBalance,
              meta:
                M.row('Plant tokens', tokenCount, 'metric-dot--amber') +
                M.row('Still growing', growingCount, 'metric-dot--teal'),
              modifier: 'amber',
            }) +
            M.card({
              label: 'Solana wallet',
              value: walletLinked ? walletDisplay : 'Not linked',
              meta:
                M.row('Network', 'test network', 'metric-dot--teal') +
                M.row(
                  'Next step',
                  walletLinked ? 'Ready to sign' : 'Optional — for Tokenise',
                  walletLinked ? 'metric-dot--teal' : 'metric-dot--amber'
                ),
              modifier: 'teal',
              attention: !walletLinked,
            })
        );
      }
    }

    if (quickSection && quickEl) {
      // Quick log lives on Today card + center Log tab now.
      quickSection.hidden = true;
      quickEl.innerHTML = '';
    }

    if (adoptSection) {
      adoptSection.hidden = showGettingStarted || isEmptyAdopter || showGrowerJournalHome;
    }
    if (
      !showGettingStarted &&
      !isEmptyAdopter &&
      !showGrowerJournalHome &&
      window.AdoptPlant &&
      typeof window.AdoptPlant.renderDashboard === 'function'
    ) {
      window.AdoptPlant.renderDashboard(document.getElementById('dashboard-adopt-panel'), () => showView('adopt'));
    } else if (adoptSection && (showGettingStarted || isEmptyAdopter || showGrowerJournalHome)) {
      const panel = document.getElementById('dashboard-adopt-panel');
      if (panel) panel.innerHTML = '';
    }

    const chartsSection = document.getElementById('dashboard-charts-section');
    const recentSection = document.querySelector('#view-dashboard .recent-section');
    if (chartsSection) chartsSection.hidden = isAdopterProfile() || showGettingStarted || showGrowerJournalHome;
    if (recentSection) recentSection.hidden = isAdopterProfile() || showGettingStarted;

    if (isAdopterProfile() || showGettingStarted) {
      if (recentEl) recentEl.innerHTML = '';
      return;
    }

    const recent = entries.slice(-5).reverse();
    if (recentEl) {
      if (recent.length === 0) {
        recentEl.innerHTML = emptyStateHtml({
          icon: 'journal',
          lead: 'No entries yet',
          body: 'Add a plant and start your journal.',
        });
      } else {
        recentEl.innerHTML = recent
          .map((e) => {
            const plant = plants.find((p) => p.id === e.plantId);
            const plantName = escapeHtml(plant ? plant.name : 'Plant');
            const date = e.date ? new Date(e.date).toLocaleDateString('en-GB') : '';
            const typeLabel = escapeHtml(ENTRY_TYPE_LABELS[e.type] || e.type || 'General');
            const viaTools = entrySourceBadgeHtml(e);
            const noteRaw = displayEntryNote(e.note);
            const thumb = e.photo ? '<img src="' + escapeHtml(e.photo) + '" alt="" class="recent-note-thumb" />' : '';
            return `
            <div class="recent-note shell-card">
              <div class="meta">${plantName} · ${date} · ${typeLabel}${viaTools ? ' · ' + viaTools : ''}</div>
              ${thumb}
              <div class="text">${escapeHtml(noteRaw.slice(0, 120))}${noteRaw.length > 120 ? '…' : ''}</div>
            </div>
          `;
          })
          .join('');
      }
    }

    const MIN_CHART_ENTRIES = 2;
    const chartsContainer = document.getElementById('dashboard-charts');
    if (chartsSection && chartsContainer && typeof getToolboxData === 'function' && !showGrowerJournalHome) {
      const toolbox = getToolboxData();
      const watering = toolbox.watering || [];
      const environment = toolbox.environment || [];
      const hasWatering = watering.length >= MIN_CHART_ENTRIES;
      const hasEnv = environment.length >= MIN_CHART_ENTRIES;
      if (!hasWatering && !hasEnv) {
        chartsSection.style.display = 'none';
      } else {
        chartsSection.style.display = 'block';
        chartsContainer.innerHTML = '';
        if (hasWatering) chartsContainer.innerHTML += '<div class="dashboard-chart-block"><h4>Watering</h4><div id="dashboard-chart-watering"></div></div>';
        if (hasEnv) chartsContainer.innerHTML += '<div class="dashboard-chart-block"><h4>Environment (temperature, humidity, pH)</h4><div id="dashboard-chart-environment"></div></div>';
        if (hasWatering && typeof renderToolboxChart === 'function') renderToolboxChart('watering', document.getElementById('dashboard-chart-watering'));
        if (hasEnv && typeof renderToolboxChart === 'function') renderToolboxChart('environment', document.getElementById('dashboard-chart-environment'));
      }
    }
  }

  function pickPlantForQuickLog() {
    const plants = loggablePlants();
    if (!plants.length) return null;
    if (logSheetSelectedPlantId) {
      const selected = plants.find((p) => p.id === logSheetSelectedPlantId);
      if (selected) return selected;
    }
    if (plants.length === 1) return plants[0];
    return null;
  }

  function quickLogCare(type, note) {
    if (blockAdminWrite()) return;
    const plants = loggablePlants();
    if (!plants.length) {
      openPlantModal();
      return;
    }
    let plant = pickPlantForQuickLog();
    if (!plant) {
      // Multiple plants and none selected yet — open the Log sheet.
      openLogSheet(type === 'zalijevanje' ? 'water' : type === 'gnojidba' ? 'feed' : null);
      return;
    }
    try {
      saveJournalEntry({
        plantId: plant.id,
        type: type,
        note: note,
        source: 'quick-log',
        requireNoteDefault: false,
      });
      // Toast comes from notifyJournalEntry inside saveJournalEntry (inbox stays clear).
    } catch (err) {
      const msg = (err && err.message) || 'Could not log entry.';
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        DnevnikNotifications.toast(msg, 'error');
      } else {
        alert(msg);
      }
    }
  }

  function quickLogWatering() {
    quickLogCare('zalijevanje', 'Watered');
  }

  function quickLogFeeding() {
    quickLogCare('gnojidba', 'Fed');
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /** Shared first-run empty state (icon + headline + body + one CTA). */
  function emptyStateHtml(opts) {
    const o = opts || {};
    if (window.GrowtooPlain && typeof GrowtooPlain.emptyStateHtml === 'function') {
      return GrowtooPlain.emptyStateHtml(o);
    }
    return '<div class="empty-state">' + escapeHtml(o.lead || '') + '</div>';
  }

  const WEATHER_API_KEY = '4fcd0d4855e24280a52121246261504';
  // The plan behind the current key returns 3 days, so we ask for 3 and say 3.
  // Every label below is still derived from what actually came back, so raising
  // this (and the plan) lifts the UI with no further code change.
  const WEATHER_DAYS = 3;
  const WEATHER_CITY_KEY = 'dnevnik-live-weather-city';
  const PLANTS_WEATHER_EL = 'plants-weather';
  let plantsWeatherFormBound = false;

  /** Per-user city from signup or the Plants weather field — no locale hardcoded default. */
  function getWeatherCity() {
    try {
      return String(localStorage.getItem(WEATHER_CITY_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function formatWeatherDayLabel(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
    if (isToday) return 'Today';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  async function getWeather(city, containerId) {
    const elId = containerId || PLANTS_WEATHER_EL;
    const weatherDiv = document.getElementById(elId);
    if (!weatherDiv) return;

    const cityName = String(city || '').trim();
    if (!cityName) {
      weatherDiv.innerHTML =
        '<p class="plants-weather-empty">Add a city above for a ' +
        WEATHER_DAYS +
        '-day forecast. Optional — skip if you grow indoors.</p>';
      return;
    }
    weatherDiv.innerHTML = '<p class="plants-weather-loading">Loading forecast…</p>';

    const url =
      'https://api.weatherapi.com/v1/forecast.json?key=' +
      encodeURIComponent(WEATHER_API_KEY) +
      '&q=' +
      encodeURIComponent(cityName) +
      '&days=' +
      WEATHER_DAYS;

    try {
      const response = await fetch(url);
      let data;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const msg = (data && data.error && data.error.message) || 'HTTP ' + response.status;
        weatherDiv.innerHTML =
          '<p class="plants-weather-error">Forecast unavailable: ' + escapeHtml(msg) + '</p>';
        return;
      }

      if (!data || data.error) {
        weatherDiv.innerHTML =
          '<p class="plants-weather-error">Forecast unavailable: ' +
          escapeHtml((data && data.error && data.error.message) || 'Unknown city') +
          '</p>';
        return;
      }

      if (!data.forecast || !Array.isArray(data.forecast.forecastday) || !data.forecast.forecastday.length) {
        weatherDiv.innerHTML = '<p class="plants-weather-error">No forecast data available.</p>';
        return;
      }

      displayWeather(data, elId);
    } catch (error) {
      console.error('Weather fetch failed', error);
      weatherDiv.innerHTML =
        '<p class="plants-weather-error">Could not load the forecast. Check your connection and the city name.</p>';
    }
  }

  /**
   * Coach's read on the forecast — up to three bullets, or nothing at all when
   * the weather holds no advice worth giving.
   */
  function weatherCoachAdviceHtml(days, city) {
    if (!window.CoachCore || typeof CoachCore.weatherAdvice !== 'function') return '';
    let notes = [];
    try {
      notes = CoachCore.weatherAdvice({
        city: city,
        days: days.map(function (day, i) {
          return {
            date: day.date,
            label: formatWeatherDayLabel(day.date),
            avgtemp: day.day.avgtemp_c,
            maxtemp: day.day.maxtemp_c,
            mintemp: day.day.mintemp_c,
            rainChance: day.day.daily_chance_of_rain,
            condition: day.day.condition && day.day.condition.text,
            offsetDays: i,
          };
        }),
      });
    } catch (err) {
      return '';
    }
    if (!notes.length) return '';

    return (
      '<div class="weather-coach" aria-label="Coach advice on the forecast">' +
      '<p class="weather-coach-head">' +
      '<span class="weather-coach-mark" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 21v-8"/><path d="M12 14c-3.2 0-5-2-5-5 3.2 0 5 2 5 5z"/>' +
      '<path d="M12 12c0-3 1.8-5 5-5 0 3-1.8 5-5 5z"/><circle cx="12" cy="6" r="2"/>' +
      '</svg></span>' +
      'Coach · what this means for your grow' +
      '</p>' +
      '<ul class="weather-coach-list">' +
      notes
        .map(function (n) {
          return (
            '<li class="weather-coach-item weather-coach-item--' +
            (n.tone === 'warn' ? 'warn' : 'info') +
            '">' +
            escapeHtml(n.text) +
            '</li>'
          );
        })
        .join('') +
      '</ul>' +
      '<button type="button" class="btn btn-ghost btn-sm weather-coach-ask" id="weather-coach-ask">Ask Coach about the weather</button>' +
      '</div>'
    );
  }

  function displayWeather(data, containerId) {
    const elId = containerId || PLANTS_WEATHER_EL;
    const weatherDiv = document.getElementById(elId);
    if (!weatherDiv || !data.forecast || !data.forecast.forecastday) return;

    const city = data.location.name;
    const region = data.location.region ? ', ' + data.location.region : '';
    const days = data.forecast.forecastday;

    // Say what we actually got back, not what we asked for.
    const dayCount = days.length;
    const sub = document.getElementById('plants-weather-widget-sub');
    if (sub) sub.textContent = dayCount + (dayCount === 1 ? ' day' : ' days') + ' · for grow planning';

    let html =
      '<p class="plants-weather-location">' +
      escapeHtml(city + region) +
      ' · next ' +
      dayCount +
      (dayCount === 1 ? ' day' : ' days') +
      '</p>' +
      // Forecast and Coach sit side by side on wide screens — the day cards are
      // narrow and left a lot of dead space to their right.
      '<div class="plants-weather-split">' +
      '<div class="plants-weather-forecast-col">' +
      '<div class="weather-container plants-weather-days">';

    days.forEach((day, i) => {
      const label = formatWeatherDayLabel(day.date);
      const avgTemp = day.day.avgtemp_c;
      const minT = day.day.mintemp_c;
      const maxT = day.day.maxtemp_c;
      const condition = day.day.condition.text;
      const icon = day.day.condition.icon;
      const rain = day.day.daily_chance_of_rain;

      html +=
        '<div class="weather-card plants-weather-day' +
        (i === 0 ? ' plants-weather-day--today' : '') +
        '">' +
        '<span class="plants-weather-day-label">' +
        escapeHtml(label) +
        '</span>' +
        '<img src="https:' +
        icon +
        '" alt="" width="44" height="44" loading="lazy" />' +
        '<span class="plants-weather-temp">' +
        Math.round(avgTemp) +
        '°</span>' +
        '<span class="plants-weather-range">' +
        Math.round(minT) +
        '° / ' +
        Math.round(maxT) +
        '°</span>' +
        '<span class="plants-weather-condition">' +
        escapeHtml(condition) +
        '</span>' +
        (rain != null ? '<span class="plants-weather-rain">☔ ' + rain + '%</span>' : '') +
        '</div>';
    });

    html += '</div>';
    if (dayCount > 3) {
      html +=
        '<p class="plants-weather-scroll-hint">Swipe for all ' +
        dayCount +
        ' days →</p>';
    }
    html += '</div>' + weatherCoachAdviceHtml(days, city) + '</div>';
    weatherDiv.innerHTML = html;

    // Cache for Coach predictive nudges (weather + watering pace)
    try {
      if (window.CoachCore && typeof CoachCore.saveWeatherCache === 'function') {
        CoachCore.saveWeatherCache({
          city: city,
          days: days.map(function (day, i) {
            return {
              date: day.date,
              label: formatWeatherDayLabel(day.date),
              avgtemp: day.day.avgtemp_c,
              maxtemp: day.day.maxtemp_c,
              mintemp: day.day.mintemp_c,
              rainChance: day.day.daily_chance_of_rain,
              condition: day.day.condition && day.day.condition.text,
              offsetDays: i,
            };
          }),
        });
      }
    } catch (err) {
      // ignore
    }
  }

  function loadPlantsWeatherFromInput() {
    const input = document.getElementById('plants-weather-city');
    const city = (input && input.value.trim()) || getWeatherCity();
    if (input && !input.value.trim() && city) input.value = city;
    try {
      if (city) localStorage.setItem(WEATHER_CITY_KEY, city);
      else localStorage.removeItem(WEATHER_CITY_KEY);
    } catch {
      // ignore
    }
    return getWeather(city);
  }

  function initPlantsWeatherWidget() {
    const form = document.getElementById('plants-weather-city-form');
    const input = document.getElementById('plants-weather-city');
    const refreshBtn = document.getElementById('plants-weather-refresh');
    if (!form || !input) return;

    const saved = getWeatherCity();
    if (!input.value.trim() && saved) input.value = saved;

    if (!plantsWeatherFormBound) {
      plantsWeatherFormBound = true;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        loadPlantsWeatherFromInput();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          loadPlantsWeatherFromInput();
        }
      });
      if (refreshBtn) {
        refreshBtn.addEventListener('click', (e) => {
          e.preventDefault();
          loadPlantsWeatherFromInput();
        });
      }
    }

    loadPlantsWeatherFromInput();
  }

  const MAX_IMAGE_SIZE = 800;
  /** Soft cap after resize — localStorage + Firestore payload stay usable. */
  const MAX_ENTRY_PHOTO_CHARS = 900000;
  const MAX_VIDEO_SIZE_MB = 2;

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /**
   * Always re-encode to JPEG (even when already under max edge).
   * Skipping that left phone photos as multi‑MB PNGs and silent localStorage failures.
   */
  function resizeImageDataUrl(dataUrl, maxEdge) {
    const edge = Math.max(64, Number(maxEdge) || MAX_IMAGE_SIZE);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width || 0;
        let h = img.height || 0;
        if (!w || !h) {
          reject(new Error('Could not read image dimensions.'));
          return;
        }
        const long = Math.max(w, h);
        if (long > edge) {
          const scale = edge / long;
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process image.'));
          return;
        }
        ctx.fillStyle = '#0f1a12';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.82;
        let out = '';
        try {
          out = canvas.toDataURL('image/jpeg', quality);
          while (out.length > MAX_ENTRY_PHOTO_CHARS && quality > 0.45) {
            quality -= 0.1;
            out = canvas.toDataURL('image/jpeg', quality);
          }
        } catch (err) {
          reject(err || new Error('Could not encode image.'));
          return;
        }
        if (!out || out.length > MAX_ENTRY_PHOTO_CHARS) {
          reject(new Error('Photo is still too large after compression. Try a smaller image.'));
          return;
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error('Could not load that image. Try JPG or PNG.'));
      img.src = dataUrl;
    });
  }

  function renderGrowerRankChip() {
    const chip = document.getElementById('grower-rank-chip');
    if (!chip) return;
    if (!isGrowerProfile() || !window.GrowerQuests) {
      chip.hidden = true;
      chip.textContent = '';
      return;
    }
    let rank = null;
    let xp = 0;
    try {
      if (typeof GrowerQuests.growerRankFromLocal === 'function') {
        rank = GrowerQuests.growerRankFromLocal();
      }
      if (typeof GrowerQuests.getGrowerProfile === 'function') {
        const profile = GrowerQuests.getGrowerProfile() || {};
        xp = Number(profile.xp != null ? profile.xp : profile.totalXp) || 0;
      }
    } catch {
      rank = null;
    }
    if (!rank || !rank.title) {
      chip.hidden = true;
      chip.textContent = '';
      return;
    }
    chip.hidden = false;
    chip.innerHTML =
      '<span class="grower-rank-chip-tier">Rank ' +
      escapeHtml(String(rank.tier || 1)) +
      '</span>' +
      '<span>' +
      escapeHtml(rank.title) +
      '</span>' +
      '<span class="grower-rank-chip-xp">' +
      escapeHtml(String(xp)) +
      ' XP</span>';
    chip.setAttribute(
      'aria-label',
      'Grower rank ' + (rank.tier || 1) + ', ' + rank.title + ', ' + xp + ' XP. Open profile.'
    );
  }

  (function bindGrowerRankChip() {
    const chip = document.getElementById('grower-rank-chip');
    if (chip && !chip.dataset.bound) {
      chip.dataset.bound = '1';
      chip.addEventListener('click', function () {
        setMoreNavOpen(true);
      });
    }
    window.addEventListener('growtoo:xp', function () {
      renderGrowerRankChip();
    });
  })();

  // --- Plants ---
  function renderPlants() {
    renderCoachBriefingSurfaces();
    renderGrowerRankChip();
    const list = document.getElementById('plants-list');
    const plants = getPlants();
    if (plants.length === 0) {
      list.innerHTML = emptyStateHtml({
        icon: 'plant',
        lead: 'No plants yet',
        body: 'Add your first plant to start a grow journal.',
        ctaId: 'empty-add-plant',
        ctaLabel: '+ New plant',
      });
      return;
    }
    list.innerHTML = plants
      .map((p) => {
        const shared = isSharedPlantId(p.id);
        const stageLabelText = STAGES[p.stage] || p.stage;
        const entries = getPlantEntries(p.id) || [];
        const lastWater = entries
          .filter(function (e) {
            const t = String((e && (e.type || e.kind || e.category)) || '').toLowerCase();
            return t.includes('water') || t.includes('zalij');
          })
          .sort(function (a, b) {
            return new Date(b.date || b.ts || 0) - new Date(a.date || a.ts || 0);
          })[0];
        const lastWaterLabel = lastWater
          ? 'Watered ' +
            new Date(lastWater.date || lastWater.ts).toLocaleDateString('en-GB')
          : 'No watering log yet';
        const photoOverlay = p.photo
          ? `<div class="plant-card-photo-overlay"><strong>${escapeHtml(p.name)}</strong>${escapeHtml(stageLabelText)} · ${escapeHtml(lastWaterLabel)}</div>`
          : '';
        // Same restrained stage-tint language as the token cards on Tokenise —
        // one visual system, not a separate look per surface.
        const stageTintKey =
          {
            klijanje: 'germination',
            sadnica: 'seedling',
            vegetativna: 'vegetative',
            cvjetanje: 'flowering',
            susenje: 'harvest',
          }[p.stage] || 'germination';
        return `
      <div class="plant-card${shared ? ' plant-card--shared' : ''}" data-id="${p.id}" data-stage-key="${stageTintKey}">
        ${p.photo ? `<div class="plant-card-photo"><img src="${p.photo}" alt="" />${photoOverlay}</div>` : ''}
        <div class="plant-card-header">
          <h3>${escapeHtml(p.name)}</h3>
          <span class="stage-badge">${escapeHtml(stageLabelText)}</span>
          ${shared ? '<span class="stage-badge plant-shared-badge" title="Shared library">Shared</span>' : ''}
        </div>
        ${
          p.subphase
            ? `<div class="plant-card-subphases"><span class="subphase-badge" title="Pot volume">${escapeHtml(subphaseLabel(p.subphase))}</span></div>`
            : ''
        }
        ${p.strain ? `<div class="strain">${escapeHtml(p.strain)}</div>` : ''}
        ${
          p.fieldLocation
            ? `<div class="text-muted" style="font-size:0.85rem">📍 ${escapeHtml(p.fieldLocation)}</div>`
            : ''
        }
        ${
          p.plantingLocation
            ? `<div class="text-muted" style="font-size:0.85rem">🌱 ${escapeHtml(p.plantingLocation)}</div>`
            : ''
        }
        <div class="text-muted" style="font-size:0.85rem">Batch: <strong style="color:var(--text)">${Math.max(1, Number(p.count || 1))}</strong> plants</div>
        ${p.startDate ? `<div class="text-muted" style="font-size:0.85rem">Since ${new Date(p.startDate).toLocaleDateString('en-GB')}</div>` : ''}
        <div class="plant-card-actions">
          <button type="button" class="btn btn-primary btn-growlog">Grow log</button>
          ${
            shared
              ? ''
              : `<button type="button" class="btn btn-ghost btn-edit-plant">✎ Edit plant</button>
          <button type="button" class="btn btn-ghost btn-delete-plant">Delete</button>`
          }
        </div>
      </div>
    `;
      })
      .join('');

    list.querySelectorAll('.btn-growlog').forEach((btn) => {
      btn.addEventListener('click', () => openGrowlog(btn.closest('.plant-card').dataset.id));
    });
    list.querySelectorAll('.btn-edit-plant').forEach((btn) => {
      btn.addEventListener('click', () => openPlantModal(btn.closest('.plant-card').dataset.id));
    });
    list.querySelectorAll('.btn-delete-plant').forEach((btn) => {
      btn.addEventListener('click', () => deletePlant(btn.closest('.plant-card').dataset.id));
    });
  }

  function updatePlantOutdoorFieldsVisibility() {
    const outdoorBlock = document.getElementById('plant-outdoor-fields');
    const typeEl = document.getElementById('plant-environment-type');
    const subSel = document.getElementById('plant-subphase');
    const fieldInput = document.getElementById('plant-field-location');
    const plantingWrap = document.getElementById('plant-planting-location-wrap');
    if (!outdoorBlock || !typeEl) return;
    const subVal = subSel ? normalizeSubphase(subSel.value) : null;
    const showOutdoor = isOutdoorPlantContext(typeEl.value, subVal);
    outdoorBlock.hidden = !showOutdoor;
    outdoorBlock.style.display = showOutdoor ? '' : 'none';
    if (plantingWrap && fieldInput) {
      const plantingInput = document.getElementById('plant-planting-location');
      const showPlanting =
        showOutdoor &&
        (fieldInput.value.trim().length > 0 || (plantingInput && plantingInput.value.trim().length > 0));
      plantingWrap.hidden = !showPlanting;
      plantingWrap.style.display = showPlanting ? '' : 'none';
    }
    if (subVal === SUBPHASE_FIELD && typeEl.value !== 'outdoor') typeEl.value = 'outdoor';
    updatePlantSubphaseActions();
  }

  function updatePlantSubphaseActions() {
    const subSel = document.getElementById('plant-subphase');
    const btnNext = document.getElementById('plant-btn-next-pot');
    const btnField = document.getElementById('plant-btn-to-field');
    const typeEl = document.getElementById('plant-environment-type');
    if (!subSel || !btnNext || !btnField) return;
    const cur = normalizeSubphase(subSel.value);
    const onField = cur === SUBPHASE_FIELD;
    const nextPot = nextPotSubphase(cur);
    btnNext.disabled = onField || !nextPot;
    btnField.disabled = onField;
    if (onField && typeEl && typeEl.value !== 'outdoor') typeEl.value = 'outdoor';
  }

  function applyPlantNextPot() {
    const subSel = document.getElementById('plant-subphase');
    const typeEl = document.getElementById('plant-environment-type');
    if (!subSel) return;
    const cur = normalizeSubphase(subSel.value);
    const next = nextPotSubphase(cur);
    if (!next) return;
    subSel.value = next;
    if (typeEl && typeEl.value === 'outdoor') typeEl.value = 'indoor';
    updatePlantOutdoorFieldsVisibility();
  }

  function applyPlantToField() {
    const subSel = document.getElementById('plant-subphase');
    const typeEl = document.getElementById('plant-environment-type');
    if (subSel) subSel.value = SUBPHASE_FIELD;
    if (typeEl) typeEl.value = 'outdoor';
    updatePlantOutdoorFieldsVisibility();
    const fieldInput = document.getElementById('plant-field-location');
    if (fieldInput) fieldInput.focus();
  }

  function showUndoToast(message, onUndo, ms) {
    const host =
      (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function'
        ? document.getElementById('toast-host')
        : null) || document.getElementById('toast-host');
    let toastHost = host;
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.id = 'toast-host';
      toastHost.className = 'toast-host';
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }
    const el = document.createElement('div');
    el.className = 'toast toast--warn toast--undo';
    el.innerHTML =
      '<span class="toast-undo-msg"></span>' +
      '<button type="button" class="toast-undo-btn">Undo</button>';
    el.querySelector('.toast-undo-msg').textContent = message;
    let undone = false;
    let timer = null;
    const cleanup = () => {
      el.classList.remove('toast--show');
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 280);
    };
    el.querySelector('.toast-undo-btn').addEventListener('click', () => {
      if (undone) return;
      undone = true;
      if (timer) clearTimeout(timer);
      try {
        onUndo();
      } catch {
        // ignore
      }
      cleanup();
    });
    toastHost.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast--show'));
    timer = setTimeout(() => {
      if (!undone) cleanup();
    }, ms || 8000);
  }

  async function deletePlant(id) {
    if (blockWrite({ plantId: id })) return;
    const plant = getPlants().find((p) => p.id === id);
    if (!plant) return;
    const ok =
      window.AppConfirm && typeof AppConfirm.ask === 'function'
        ? await AppConfirm.ask({
            title: 'Delete this plant?',
            body:
              'Delete "' +
              plant.name +
              '" and its journal trail?\n\nYour grow history is evidence — you can undo for a few seconds after.',
            confirmLabel: 'Delete plant',
            danger: true,
          })
        : window.confirm(
            'Delete "' +
              plant.name +
              '" and its journal trail?\n\nYou can undo for a few seconds after.'
          );
    if (!ok) return;
    const removedPlant = JSON.parse(JSON.stringify(plant));
    const removedEntries = getEntries()
      .filter((e) => e.plantId === id)
      .map((e) => JSON.parse(JSON.stringify(e)));
    setPlants(getPlants().filter((p) => p.id !== id));
    setEntries(getEntries().filter((e) => e.plantId !== id));
    renderPlants();
    renderDashboard();
    fillEntryPlantSelect();
    fillJournalPlantFilter();
    if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
    showUndoToast('Plant deleted — undo available', () => {
      setPlants(getPlants().concat([removedPlant]));
      setEntries(getEntries().concat(removedEntries));
      renderPlants();
      renderDashboard();
      fillEntryPlantSelect();
      fillJournalPlantFilter();
      if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
      if (window.DnevnikNotifications) DnevnikNotifications.toast('Plant restored', 'success');
    });
  }

  let plantWizardStep = 1;

  function setPlantWizardStep(step) {
    plantWizardStep = step === 2 ? 2 : 1;
    const modal = document.getElementById('modal-plant');
    const isCreate = modal && modal.classList.contains('plant-modal--create');
    const step1 = document.getElementById('plant-form-step-1');
    const step2 = document.getElementById('plant-form-step-2');
    const advanced = document.getElementById('plant-form-advanced');
    const progress = document.getElementById('plant-wizard-progress');
    const backBtn = document.getElementById('plant-form-back');
    const nextBtn = document.getElementById('plant-form-next');
    const submitBtn = document.getElementById('plant-form-submit');
    const createHint = document.getElementById('plant-form-create-hint');
    const mintWrap = document.getElementById('plant-mint-toggle-wrap');

    if (!isCreate) {
      if (step1) step1.hidden = false;
      if (step2) step2.hidden = false;
      if (advanced) advanced.hidden = false;
      if (progress) progress.hidden = true;
      if (backBtn) backBtn.hidden = true;
      if (nextBtn) nextBtn.hidden = true;
      if (createHint) createHint.hidden = true;
      if (mintWrap) mintWrap.hidden = true;
      if (submitBtn) submitBtn.textContent = 'Save';
      return;
    }

    if (progress) progress.hidden = false;
    progress &&
      progress.querySelectorAll('[data-wizard-label]').forEach(function (el) {
        el.classList.toggle('is-active', String(el.getAttribute('data-wizard-label')) === String(plantWizardStep));
      });
    if (step1) step1.hidden = plantWizardStep !== 1;
    if (step2) step2.hidden = plantWizardStep !== 2;
    if (advanced) advanced.hidden = true;
    if (createHint) createHint.hidden = plantWizardStep !== 1;
    if (mintWrap) mintWrap.hidden = false;
    if (backBtn) backBtn.hidden = plantWizardStep !== 2;
    if (nextBtn) nextBtn.hidden = plantWizardStep !== 1;
    if (submitBtn) {
      submitBtn.textContent = plantWizardStep === 1 ? 'Save plant' : 'Save plant';
      submitBtn.hidden = false;
    }
  }

  function openPlantModal(editId) {
    if (editId && blockWrite({ plantId: editId })) return;
    const modal = document.getElementById('modal-plant');
    const form = document.getElementById('form-plant');
    const titleEl = document.getElementById('modal-plant-title');
    const isEdit = !!editId;
    modal.classList.toggle('plant-modal--create', !isEdit);
    modal.classList.toggle('plant-modal--edit', isEdit);
    const startDateInput = document.getElementById('plant-start-date');
    if (startDateInput) {
      startDateInput.removeAttribute('min');
      startDateInput.removeAttribute('max');
      startDateInput.min = '';
      startDateInput.max = '';
    }
    const photoData = document.getElementById('plant-photo-data');
    const photoPreview = document.getElementById('plant-photo-preview');
    const transDate = document.getElementById('plant-stage-transition-date');
    const transNote = document.getElementById('plant-stage-transition-note');
    if (transDate) {
      transDate.removeAttribute('min');
      transDate.removeAttribute('max');
      transDate.min = '';
      transDate.max = '';
      transDate.value = localDateYYYYMMDD();
    }
    if (transNote) transNote.value = '';
    const stageAtOpenEl = document.getElementById('plant-stage-at-open');
    document.getElementById('plant-id').value = editId || '';
    titleEl.textContent = editId ? 'Edit plant' : 'New plant';
    document.getElementById('plant-photo').value = '';
    if (editId) {
      const p = getPlants().find((x) => x.id === editId);
      if (p) {
        const stageCanonical = canonicalPlantStage(p.stage);
        if (stageAtOpenEl) stageAtOpenEl.value = stageCanonical;
        document.getElementById('plant-name').value = p.name;
        document.getElementById('plant-strain').value = p.strain || '';
        document.getElementById('plant-count').value = p.count ?? 1;
        document.getElementById('plant-stage').value = stageCanonical;
        const subCanonical = normalizeSubphase(p.subphase);
        const subSel = document.getElementById('plant-subphase');
        if (subSel) subSel.value = subCanonical || '';
        const subAtOpenEl = document.getElementById('plant-subphase-at-open');
        if (subAtOpenEl) subAtOpenEl.value = subCanonical || '';
        document.getElementById('plant-start-date').value = p.startDate || '';
        document.getElementById('plant-environment-name').value = p.environmentName || '';
        document.getElementById('plant-environment-type').value = p.environmentType || 'indoor';
        const fieldLocEl = document.getElementById('plant-field-location');
        if (fieldLocEl) fieldLocEl.value = p.fieldLocation || '';
        const plantingEl = document.getElementById('plant-planting-location');
        if (plantingEl) plantingEl.value = p.plantingLocation || '';
        document.getElementById('plant-exposure-hours').value = p.exposureHours ?? '';
        document.getElementById('plant-notes').value = p.notes || '';
        if (p.photo) {
          photoData.value = p.photo;
          photoPreview.innerHTML = '<img src="' + p.photo + '" alt="Photo" class="media-thumb" /> <button type="button" class="btn-remove-media">Remove</button>';
          photoPreview.querySelector('.btn-remove-media').addEventListener('click', () => {
            photoData.value = '';
            photoPreview.innerHTML = '';
          });
        } else {
          photoData.value = '';
          photoPreview.innerHTML = '';
        }
      } else if (stageAtOpenEl) {
        stageAtOpenEl.value = '';
      }
    } else {
      form.reset();
      document.getElementById('plant-id').value = '';
      if (stageAtOpenEl) stageAtOpenEl.value = '';
      const subAtOpenElNew = document.getElementById('plant-subphase-at-open');
      if (subAtOpenElNew) subAtOpenElNew.value = '';
      document.getElementById('plant-count').value = 1;
      document.getElementById('plant-stage').value = 'klijanje';
      const subSelNew = document.getElementById('plant-subphase');
      if (subSelNew) subSelNew.value = '';
      const fieldLocNew = document.getElementById('plant-field-location');
      if (fieldLocNew) fieldLocNew.value = '';
      const plantingNew = document.getElementById('plant-planting-location');
      if (plantingNew) plantingNew.value = '';
      const envDefault = typeof getPreferredGrowEnvironment === 'function' ? getPreferredGrowEnvironment() : 'indoor';
      document.getElementById('plant-environment-type').value = envDefault;
      photoData.value = '';
      photoPreview.innerHTML = '';
    }
    const alsoMint = document.getElementById('plant-also-mint');
    if (alsoMint) alsoMint.checked = false;
    setPlantWizardStep(isEdit ? 0 : 1);
    updatePlantOutdoorFieldsVisibility();
    modal.classList.add('open');
  }

  function closePlantModal() {
    document.getElementById('modal-plant').classList.remove('open');
  }

  document.getElementById('btn-add-plant').addEventListener('click', () => {
    if (blockAdminWrite()) return;
    openPlantModal();
  });

  // Empty-state CTAs reuse the real "New plant" / "New entry" flows rather than
  // duplicating them — one delegated listener, since the states re-render often.
  document.addEventListener('click', (e) => {
    const addPlant = e.target.closest('#empty-add-plant');
    if (addPlant) {
      e.preventDefault();
      const real = document.getElementById('btn-add-plant');
      if (real) real.click();
      return;
    }
    const addEntry = e.target.closest('#empty-add-entry');
    if (addEntry) {
      e.preventDefault();
      const real = document.getElementById('btn-add-entry');
      if (real) real.click();
    }
  });

  const plantFormNext = document.getElementById('plant-form-next');
  if (plantFormNext) {
    plantFormNext.addEventListener('click', () => {
      const nameEl = document.getElementById('plant-name');
      if (nameEl && !String(nameEl.value || '').trim()) {
        nameEl.reportValidity();
        return;
      }
      setPlantWizardStep(2);
    });
  }
  const plantFormBack = document.getElementById('plant-form-back');
  if (plantFormBack) {
    plantFormBack.addEventListener('click', () => setPlantWizardStep(1));
  }

  const plantEnvTypeEl = document.getElementById('plant-environment-type');
  if (plantEnvTypeEl) plantEnvTypeEl.addEventListener('change', updatePlantOutdoorFieldsVisibility);
  const plantSubphaseEl = document.getElementById('plant-subphase');
  if (plantSubphaseEl) plantSubphaseEl.addEventListener('change', updatePlantOutdoorFieldsVisibility);
  const plantFieldLocInput = document.getElementById('plant-field-location');
  if (plantFieldLocInput) plantFieldLocInput.addEventListener('input', updatePlantOutdoorFieldsVisibility);
  const btnNextPot = document.getElementById('plant-btn-next-pot');
  if (btnNextPot) btnNextPot.addEventListener('click', applyPlantNextPot);
  const btnToField = document.getElementById('plant-btn-to-field');
  if (btnToField) btnToField.addEventListener('click', applyPlantToField);

  document.getElementById('plant-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const photoData = document.getElementById('plant-photo-data');
    const photoPreview = document.getElementById('plant-photo-preview');
    if (!file) {
      photoData.value = '';
      photoPreview.innerHTML = '';
      return;
    }
    if (!file.type || !file.type.startsWith('image/')) {
      photoData.value = '';
      photoPreview.innerHTML =
        '<span class="media-error">Use a JPG or PNG photo (some phone formats like HEIC aren’t supported here).</span>';
      e.target.value = '';
      return;
    }
    photoPreview.innerHTML = '<span class="media-loading">Preparing photo…</span>';
    try {
      let dataUrl = await readFileAsDataUrl(file);
      dataUrl = await resizeImageDataUrl(dataUrl, MAX_IMAGE_SIZE);
      photoData.value = dataUrl;
      photoPreview.innerHTML =
        '<img src="' +
        dataUrl +
        '" alt="Photo" class="media-thumb" /> <button type="button" class="btn-remove-media">Remove</button>';
      photoPreview.querySelector('.btn-remove-media').addEventListener('click', () => {
        photoData.value = '';
        photoPreview.innerHTML = '';
        document.getElementById('plant-photo').value = '';
      });
    } catch (err) {
      photoData.value = '';
      photoPreview.innerHTML =
        '<span class="media-error">' +
        escapeHtml((err && err.message) || 'Could not load photo.') +
        '</span>';
      e.target.value = '';
    }
  });

  document.getElementById('form-plant').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('plant-id').value;
    if (blockWrite({ plantId: id || null })) return;
    const plants = getPlants();
    const prev = id ? plants.find((p) => p.id === id) : null;
    const photoData = document.getElementById('plant-photo-data').value.trim();
    const exposureVal = document.getElementById('plant-exposure-hours').value.trim();
    const countVal = document.getElementById('plant-count').value.trim();
    const countNum = Math.max(1, parseInt(countVal || '1', 10) || 1);
    const newId = id || uuid();
    const newStage = canonicalPlantStage(document.getElementById('plant-stage').value);
    const startDateVal = document.getElementById('plant-start-date').value || null;
    const transDateEl = document.getElementById('plant-stage-transition-date');
    const transNoteEl = document.getElementById('plant-stage-transition-note');
    const transitionNote = transNoteEl ? transNoteEl.value.trim() : '';
    let envTypeVal = document.getElementById('plant-environment-type').value || 'indoor';
    const newSubphase = normalizeSubphase(
      (() => {
        const v = document.getElementById('plant-subphase');
        return v && v.value ? v.value.trim() : '';
      })()
    );
    if (newSubphase === SUBPHASE_FIELD) envTypeVal = 'outdoor';
    const outdoorCtx = isOutdoorPlantContext(envTypeVal, newSubphase);
    const fieldLocEl = document.getElementById('plant-field-location');
    const plantingEl = document.getElementById('plant-planting-location');
    const fieldLocationVal = outdoorCtx && fieldLocEl ? fieldLocEl.value.trim() || null : null;
    const plantingLocationVal =
      outdoorCtx && fieldLocationVal && plantingEl ? plantingEl.value.trim() || null : null;
    let locNoteSuffix = '';
    if (fieldLocationVal) locNoteSuffix += ' Field location: ' + fieldLocationVal + '.';
    if (plantingLocationVal) locNoteSuffix += ' Planting location: ' + plantingLocationVal + '.';

    let stageHistory = [];
    let stageDates = {};
    let subphaseHistory = [];
    if (prev) {
      stageHistory = Array.isArray(prev.stageHistory) ? prev.stageHistory.slice() : [];
      stageDates = prev.stageDates && typeof prev.stageDates === 'object' ? { ...prev.stageDates } : {};
      subphaseHistory = Array.isArray(prev.subphaseHistory) ? prev.subphaseHistory.slice() : [];
    }

    const journalAdds = [];

    if (!id) {
      const day0 = startDateVal || localDateYYYYMMDD();
      stageHistory.push({ from: null, to: newStage, date: day0 });
      stageDates[newStage] = day0;
      let note0 = 'Grow started — stage: ' + (STAGES[newStage] || newStage);
      if (locNoteSuffix) note0 += locNoteSuffix;
      if (transitionNote) note0 += '. ' + transitionNote;
      journalAdds.push({
        id: uuid(),
        plantId: newId,
        date: day0,
        type: 'faza',
        note: note0,
        photo: photoData || null,
        meta: {
          faza: { from: null, to: newStage },
          ...(fieldLocationVal ? { fieldLocation: fieldLocationVal } : {}),
          ...(plantingLocationVal ? { plantingLocation: plantingLocationVal } : {}),
        },
      });
      if (newSubphase) {
        subphaseHistory.push({ from: null, to: newSubphase, date: day0 });
        let subNote = 'Sub-phase: ' + subphaseLabel(newSubphase);
        if (locNoteSuffix) subNote += locNoteSuffix;
        journalAdds.push({
          id: uuid(),
          plantId: newId,
          date: day0,
          type: 'podfaza',
          note: subNote,
          photo: null,
          meta: {
            podfaza: { from: null, to: newSubphase },
            ...(fieldLocationVal ? { fieldLocation: fieldLocationVal } : {}),
            ...(plantingLocationVal ? { plantingLocation: plantingLocationVal } : {}),
          },
        });
      }
    } else if (id) {
      const atOpenEl = document.getElementById('plant-stage-at-open');
      const stageAtOpen = canonicalPlantStage(
        atOpenEl && String(atOpenEl.value).trim() !== '' ? atOpenEl.value : prev && prev.stage
      );
      if (stageAtOpen !== newStage) {
        const td = (transDateEl && transDateEl.value) || localDateYYYYMMDD();
        stageHistory.push({ from: stageAtOpen, to: newStage, date: td });
        stageDates[newStage] = td;
        const base =
          'Stage transition: ' + (STAGES[stageAtOpen] || stageAtOpen) + ' → ' + (STAGES[newStage] || newStage);
        const note1 = (transitionNote ? base + '. ' + transitionNote : base) + locNoteSuffix;
        journalAdds.push({
          id: uuid(),
          plantId: newId,
          date: td,
          type: 'faza',
          note: note1,
          photo: photoData || null,
          meta: {
            faza: { from: stageAtOpen, to: newStage },
            ...(fieldLocationVal ? { fieldLocation: fieldLocationVal } : {}),
            ...(plantingLocationVal ? { plantingLocation: plantingLocationVal } : {}),
          },
        });
      }

      const subAtOpenEl = document.getElementById('plant-subphase-at-open');
      const subAtOpen = normalizeSubphase(
        subAtOpenEl && String(subAtOpenEl.value).trim() !== ''
          ? subAtOpenEl.value
          : prev && prev.subphase
      );
      if (subAtOpen !== newSubphase) {
        const tdSub = (transDateEl && transDateEl.value) || localDateYYYYMMDD();
        subphaseHistory.push({ from: subAtOpen, to: newSubphase, date: tdSub });
        const fromLab = subAtOpen ? subphaseLabel(subAtOpen) : '—';
        const toLab = newSubphase ? subphaseLabel(newSubphase) : '—';
        let subNote =
          'Sub-phase transition: ' + fromLab + ' → ' + toLab + (transitionNote ? '. ' + transitionNote : '') + locNoteSuffix;
        journalAdds.push({
          id: uuid(),
          plantId: newId,
          date: tdSub,
          type: 'podfaza',
          note: subNote,
          photo: photoData || null,
          meta: {
            podfaza: { from: subAtOpen, to: newSubphase },
            ...(fieldLocationVal ? { fieldLocation: fieldLocationVal } : {}),
            ...(plantingLocationVal ? { plantingLocation: plantingLocationVal } : {}),
          },
        });
      }
    }

    const payload = {
      id: newId,
      name: document.getElementById('plant-name').value.trim(),
      strain: document.getElementById('plant-strain').value.trim(),
      count: countNum,
      stage: newStage,
      subphase: newSubphase,
      startDate: startDateVal,
      environmentName: document.getElementById('plant-environment-name').value.trim() || null,
      environmentType: envTypeVal,
      fieldLocation: fieldLocationVal,
      plantingLocation: plantingLocationVal,
      exposureHours: exposureVal ? parseInt(exposureVal, 10) : null,
      notes: document.getElementById('plant-notes').value.trim(),
      photo: photoData || null,
      updatedAt: new Date().toISOString(),
      views: (prev || {}).views ?? 0,
      stageHistory,
      stageDates,
      subphaseHistory,
    };
    let next;
    if (id) {
      next = plants.map((p) => (p.id === id ? payload : p));
    } else {
      next = [...plants, payload];
    }
    setPlants(next);
    journalAdds.forEach(function (add) {
      try {
        saveJournalEntry({
          plantId: add.plantId || newId,
          type: add.type,
          note: add.note,
          date: add.date,
          photo: add.photo || null,
          meta: add.meta,
          source: 'plant-modal',
          requireNoteDefault: false,
          silent: true,
        });
      } catch (err) {
        console.warn('Plant journal entry failed', err);
      }
    });
    const alsoMintEl = document.getElementById('plant-also-mint');
    const wantMint = !id && alsoMintEl && alsoMintEl.checked;
    closePlantModal();
    if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
      DnevnikNotifications.toast(id ? 'Plant updated' : 'Plant added — ' + payload.name, 'success');
    }
    if (!journalAdds.length) {
      renderPlants();
      renderDashboard();
      renderJournal();
      fillEntryPlantSelect();
      fillJournalPlantFilter();
      if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
    }
    if (currentGrowlogPlantId === newId) {
      renderGrowlog(newId);
      const headerTitle = document.querySelector('.view-title');
      if (headerTitle) headerTitle.textContent = payload.name;
    }
    if (wantMint) {
      maybeMintPlantToken(payload).catch(function (err) {
        console.warn('Optional mint after plant create failed', err);
        if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
          DnevnikNotifications.toast(
            (err && err.message) || 'Plant saved, but on-chain mint did not start. Try Tokenise → advanced.',
            'warn'
          );
        }
      });
    }
  });

  async function maybeMintPlantToken(plant) {
    if (!plant || !plant.id) return;
    const PT = window.PlantToken;
    if (!PT || typeof PT.importSeed !== 'function') {
      throw new Error('Minting is not available yet.');
    }
    const wallet = typeof PT.getWallet === 'function' ? PT.getWallet() : null;
    if (!wallet || !wallet.connected) {
      if (typeof PT.connect === 'function') {
        await PT.connect();
      } else if (window.SolanaWallet && typeof SolanaWallet.connect === 'function') {
        await SolanaWallet.connect();
      } else {
        throw new Error('Connect a Devnet wallet first, then mint from Tokenise.');
      }
    }
    await PT.importSeed({
      name: String(plant.name || '').trim().slice(0, 32),
      strain: plant.strain || '',
      batch: '',
      plantId: plant.id,
    });
    if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
      DnevnikNotifications.toast('Plant token mint started for ' + plant.name, 'success');
    }
    if (window.AdoptPlant && typeof AdoptPlant.render === 'function') {
      try {
        AdoptPlant.render();
      } catch (e) {
        // ignore
      }
    }
  }

  document.querySelector('#modal-plant .modal-close').addEventListener('click', closePlantModal);
  document.querySelector('#modal-plant .modal-cancel').addEventListener('click', closePlantModal);

  function bindModalBackdropClose(modalEl, closeFn) {
    if (!modalEl || modalEl.dataset.backdropBound === '1') return;
    modalEl.dataset.backdropBound = '1';
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeFn();
    });
  }
  bindModalBackdropClose(document.getElementById('modal-plant'), closePlantModal);

  // --- Journal ---
  function fillEntryPlantSelect() {
    const sel = document.getElementById('entry-plant');
    if (!sel) return;
    const plants = getPlants();
    sel.innerHTML = '<option value="">-- Select a plant --</option>' + plants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  }

  function fillJournalPlantFilter() {
    const sel = document.getElementById('journal-plant-filter');
    if (!sel) return;
    const prev = sel.value;
    const plants = getPlants();
    sel.innerHTML =
      '<option value="">All plants</option>' +
      plants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    if (prev && plants.some((p) => p && p.id === prev)) sel.value = prev;
  }

  function syncEntryFazaLocationsFromPlant() {
    const plantId = document.getElementById('entry-plant') && document.getElementById('entry-plant').value;
    const fieldInput = document.getElementById('entry-faza-field-location');
    const plantingInput = document.getElementById('entry-faza-planting-location');
    const plantingWrap = document.getElementById('entry-faza-planting-wrap');
    if (!fieldInput) return;
    if (!plantId) {
      fieldInput.value = '';
      if (plantingInput) plantingInput.value = '';
      if (plantingWrap) plantingWrap.hidden = true;
      return;
    }
    const plant = getPlants().find((p) => p.id === plantId);
    fieldInput.value = (plant && plant.fieldLocation) || '';
    if (plantingInput) plantingInput.value = (plant && plant.plantingLocation) || '';
    if (plantingWrap) {
      const show = !!(plant && plant.fieldLocation);
      plantingWrap.hidden = !show;
      plantingWrap.style.display = show ? '' : 'none';
    }
  }

  function updateEntryExtraVisibility() {
    const type = document.getElementById('entry-type').value;
    const pres = document.getElementById('entry-extra-presadjivanje');
    const stres = document.getElementById('entry-extra-stresori');
    const faza = document.getElementById('entry-extra-faza');
    if (pres) {
      const open = type === 'presadjivanje';
      pres.classList.toggle('open', open);
      pres.setAttribute('aria-hidden', !open);
    }
    if (stres) {
      const open = type === 'stresori';
      stres.classList.toggle('open', open);
      stres.setAttribute('aria-hidden', !open);
    }
    if (faza) {
      const open = type === 'faza';
      faza.classList.toggle('open', open);
      faza.setAttribute('aria-hidden', !open);
      if (open) syncEntryFazaLocationsFromPlant();
    }
  }

  function renderJournal() {
    fillJournalPlantFilter();
    const filter = document.getElementById('journal-plant-filter').value;
    let entries = getEntries();
    if (filter) entries = entries.filter((e) => e.plantId === filter);
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const container = document.getElementById('journal-entries');
    const plants = getPlants();
    if (entries.length === 0) {
      container.innerHTML = emptyStateHtml({
        icon: 'journal',
        lead: 'No entries yet',
        body: 'Log watering, feeding, or a note to start the trail.',
        ctaId: 'empty-add-entry',
        ctaLabel: '+ New entry',
      });
      return;
    }
    container.innerHTML = entries
      .map((e) => {
        const plant = plants.find((p) => p.id === e.plantId);
        const plantName = escapeHtml(plant ? plant.name : 'Plant');
        const date = e.date ? new Date(e.date).toLocaleDateString('en-GB') : '';
        const typeLabel = escapeHtml(ENTRY_TYPE_LABELS[e.type] || e.type || 'General');
        const viaTools = entrySourceBadgeHtml(e);
        const noteText = displayEntryNote(e.note);
        const media = [];
        if (e.photo) media.push('<div class="entry-media entry-photo"><img src="' + escapeHtml(e.photo) + '" alt="Photo" /></div>');
        if (e.video) media.push('<div class="entry-media entry-video"><video src="' + escapeHtml(e.video) + '" controls></video></div>');
        let metaHtml = toolboxMeasurementMetaHtml(e);
        if (e.meta) {
          if (e.meta.faza) {
            const m = e.meta.faza;
            const parts = [];
            if (m.from) parts.push('From: ' + escapeHtml(STAGES[m.from] || m.from));
            parts.push('To: ' + escapeHtml(STAGES[m.to] || m.to));
            if (parts.length) metaHtml += '<div class="entry-meta-block"><strong>Stage transition</strong><ul><li>' + parts.join('</li><li>') + '</li></ul></div>';
            if (e.meta.fieldLocation) {
              metaHtml +=
                '<div class="entry-meta-block"><strong>Field location</strong><p>' +
                escapeHtml(e.meta.fieldLocation) +
                '</p></div>';
            }
            if (e.meta.plantingLocation) {
              metaHtml +=
                '<div class="entry-meta-block"><strong>Planting location</strong><p>' +
                escapeHtml(e.meta.plantingLocation) +
                '</p></div>';
            }
          }
          if (e.meta.podfaza) {
            const m = e.meta.podfaza;
            const parts = [];
            if (m.from) parts.push('From: ' + escapeHtml(subphaseLabel(m.from)));
            parts.push('To: ' + escapeHtml(subphaseLabel(m.to) || m.to || '—'));
            if (parts.length) {
              metaHtml += '<div class="entry-meta-block"><strong>Sub-phase transition</strong><ul><li>' + parts.join('</li><li>') + '</li></ul></div>';
            }
            if (e.meta.fieldLocation) {
              metaHtml +=
                '<div class="entry-meta-block"><strong>Field location</strong><p>' +
                escapeHtml(e.meta.fieldLocation) +
                '</p></div>';
            }
            if (e.meta.plantingLocation) {
              metaHtml +=
                '<div class="entry-meta-block"><strong>Planting location</strong><p>' +
                escapeHtml(e.meta.plantingLocation) +
                '</p></div>';
            }
          }
          if (e.meta.presadjivanje) {
            const m = e.meta.presadjivanje;
            const parts = [];
            if (m.soilQuality) parts.push('Soil quality: ' + escapeHtml(m.soilQuality));
            if (m.plantAge) parts.push('Plant age: ' + escapeHtml(m.plantAge));
            if (m.plantCondition) parts.push('Plant condition: ' + escapeHtml(m.plantCondition));
            if (parts.length) metaHtml += '<div class="entry-meta-block"><strong>Transplanting</strong><ul><li>' + parts.join('</li><li>') + '</li></ul></div>';
          }
          if (e.meta.stresori) {
            const m = e.meta.stresori;
            const parts = [];
            if (m.temperature) parts.push('Temperature: ' + escapeHtml(m.temperature));
            if (m.humidity) parts.push('Humidity: ' + escapeHtml(m.humidity));
            if (m.vpd) parts.push('VPD: ' + escapeHtml(m.vpd));
            if (m.pests) parts.push('Pests: ' + escapeHtml(m.pests));
            if (parts.length) metaHtml += '<div class="entry-meta-block"><strong>Stressors</strong><ul><li>' + parts.join('</li><li>') + '</li></ul></div>';
          }
        }
        const deletable = !isSharedPlantId(e.plantId);
        const entryHtml = `
          <div class="journal-entry${isToolboxMirroredEntry(e) ? ' journal-entry--from-tools' : ''}" data-entry-id="${escapeHtml(e.id)}">
            <div class="entry-meta">
              <span class="entry-type">${typeLabel}</span>
              ${viaTools}
              ${plantName} · ${date}
              ${
                deletable
                  ? '<button type="button" class="btn btn-ghost btn-sm btn-delete-entry" aria-label="Delete entry">Delete</button>'
                  : ''
              }
            </div>
            <div class="entry-note">${escapeHtml(noteText)}</div>
            ${
              (function () {
                const coachNote =
                  window.AICoach && typeof AICoach.getEntryNote === 'function'
                    ? AICoach.getEntryNote(e.id)
                    : '';
                if (!coachNote) return '';
                return (
                  '<p class="entry-coach-note"><span class="entry-coach-note-label">Coach</span> ' +
                  escapeHtml(coachNote) +
                  '</p>'
                );
              })()
            }
            ${metaHtml ? '<div class="entry-meta-blocks">' + metaHtml + '</div>' : ''}
            ${media.length ? '<div class="entry-media-wrap">' + media.join('') + '</div>' : ''}
          </div>
        `;
        // Swipe-to-delete is an extra affordance, not a replacement: the inline
        // Delete button above stays so the action is never gesture-only.
        return deletable
          ? `<div class="journal-swipe">
               <div class="journal-swipe-actions">
                 <button type="button" class="journal-swipe-delete" tabindex="-1" aria-hidden="true">Delete</button>
               </div>
               ${entryHtml}
             </div>`
          : entryHtml;
      })
      .join('');
    bindJournalRowActions(container);
  }

  /**
   * One delegated listener for the whole list (replaces a per-button rebind on
   * every render), plus horizontal swipe-to-reveal on touch.
   */
  function bindJournalRowActions(container) {
    if (!container || container.dataset.rowActionsBound === '1') return;
    container.dataset.rowActionsBound = '1';

    container.addEventListener('click', (e) => {
      const del = e.target.closest('.btn-delete-entry, .journal-swipe-delete');
      if (!del) return;
      const wrap = del.closest('.journal-swipe') || del.closest('.journal-entry');
      const entry = wrap ? wrap.querySelector('.journal-entry') || wrap : null;
      const entryId = entry && entry.getAttribute('data-entry-id');
      if (entryId) deleteJournalEntry(entryId);
    });

    const REVEAL = 84;
    let sliding = null;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let decided = false;
    let openRow = null;

    function closeRow(row) {
      if (!row) return;
      row.style.transition = 'transform 0.25s var(--ease-spring)';
      row.style.transform = 'translateX(0px)';
    }

    container.addEventListener('pointerdown', (e) => {
      if (!window.matchMedia('(max-width: 768px)').matches) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const row = e.target.closest('.journal-swipe .journal-entry');
      if (!row) return;
      // Let real controls inside the row win the press.
      if (e.target.closest('button, a, input, textarea, select')) return;
      if (openRow && openRow !== row) closeRow(openRow);
      sliding = row;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      decided = false;
      row.style.transition = 'none';
    });

    container.addEventListener('pointermove', (e) => {
      if (!sliding) return;
      const moveX = e.clientX - startX;
      const moveY = e.clientY - startY;
      if (!decided) {
        // Vertical intent wins — never hijack page scrolling.
        if (Math.abs(moveY) > Math.abs(moveX)) {
          sliding.style.transition = '';
          sliding.style.transform = '';
          sliding = null;
          return;
        }
        if (Math.abs(moveX) < 6) return;
        decided = true;
      }
      dx = Math.max(-REVEAL, Math.min(0, moveX));
      sliding.style.transform = `translateX(${dx}px)`;
    });

    function endSwipe() {
      if (!sliding) return;
      const row = sliding;
      sliding = null;
      row.style.transition = 'transform 0.25s var(--ease-spring)';
      if (dx < -REVEAL / 2) {
        row.style.transform = `translateX(${-REVEAL}px)`;
        openRow = row;
      } else {
        row.style.transform = 'translateX(0px)';
        if (openRow === row) openRow = null;
      }
      dx = 0;
    }

    container.addEventListener('pointerup', endSwipe);
    container.addEventListener('pointercancel', endSwipe);
  }

  async function deleteJournalEntry(entryId) {
    const entry = getEntries().find((e) => e && e.id === entryId);
    if (!entry) return;
    if (blockWrite({ plantId: entry.plantId })) return;
    const ok =
      window.AppConfirm && typeof AppConfirm.ask === 'function'
        ? await AppConfirm.ask({
            title: 'Delete journal entry?',
            body:
              'Remove this entry from your grow trail?\n\nYou can undo for a few seconds after.',
            confirmLabel: 'Delete entry',
            danger: true,
          })
        : window.confirm(
            'Delete this journal entry?\n\nYour grow trail matters — you can undo for a few seconds after.'
          );
    if (!ok) return;
    const removed = JSON.parse(JSON.stringify(entry));
    setEntries(getEntries().filter((e) => e.id !== entryId));
    renderJournal();
    renderDashboard();
    if (currentGrowlogPlantId === removed.plantId) renderGrowlog(removed.plantId);
    showUndoToast('Entry deleted — undo available', () => {
      setEntries(getEntries().concat([removed]));
      renderJournal();
      renderDashboard();
      if (currentGrowlogPlantId === removed.plantId) renderGrowlog(removed.plantId);
      if (window.DnevnikNotifications) DnevnikNotifications.toast('Entry restored', 'success');
    });
  }

  const journalPlantFilterEl = document.getElementById('journal-plant-filter');
  if (journalPlantFilterEl) journalPlantFilterEl.addEventListener('change', renderJournal);

  const modalEntry = document.getElementById('modal-entry');
  const entryTypeEl = document.getElementById('entry-type');
  if (entryTypeEl) entryTypeEl.addEventListener('change', updateEntryExtraVisibility);
  const entryPlantEl = document.getElementById('entry-plant');
  if (entryPlantEl) {
    entryPlantEl.addEventListener('change', () => {
      if (document.getElementById('entry-type').value === 'faza') syncEntryFazaLocationsFromPlant();
    });
  }
  const entryFazaFieldInput = document.getElementById('entry-faza-field-location');
  if (entryFazaFieldInput) {
    entryFazaFieldInput.addEventListener('input', () => {
      const wrap = document.getElementById('entry-faza-planting-wrap');
      if (!wrap) return;
      const show = entryFazaFieldInput.value.trim().length > 0;
      wrap.hidden = !show;
      wrap.style.display = show ? '' : 'none';
    });
  }

  /**
   * Shared opener for every “New entry” CTA (Journal, plant detail, Log sheet).
   * @param {{ plantId?: string|null, type?: string|null }} [opts]
   */
  function startJournalEntry(opts) {
    const o = opts || {};
    const plantId = o.plantId || null;
    if (plantId) {
      if (blockWrite({ plantId: plantId })) return;
    } else if (blockAdminWrite()) {
      return;
    }
    openEntryModal(plantId, o);
  }

  function openEntryModal(plantId, opts) {
    const o = opts || {};
    if (plantId && blockWrite({ plantId })) return;
    if (!modalEntry) return;
    fillEntryPlantSelect();
    const form = document.getElementById('form-entry');
    if (form) form.reset();
    document.getElementById('entry-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('entry-photo-data').value = '';
    document.getElementById('entry-video-data').value = '';
    document.getElementById('entry-photo-preview').innerHTML = '';
    document.getElementById('entry-video-preview').innerHTML = '';
    const plantSelect = document.getElementById('entry-plant');
    if (plantSelect) {
      if (plantId) {
        plantSelect.value = plantId;
        plantSelect.disabled = true;
      } else {
        plantSelect.disabled = false;
      }
    }
    const typeSel = document.getElementById('entry-type');
    if (typeSel && o.type) {
      const wanted = String(o.type);
      const hasOption = Array.from(typeSel.options || []).some(function (opt) {
        return opt && opt.value === wanted;
      });
      if (hasOption) typeSel.value = wanted;
    }
    updateEntryExtraVisibility();
    modalEntry.classList.add('open');
  }

  const btnAddEntry = document.getElementById('btn-add-entry');
  if (btnAddEntry) {
    btnAddEntry.addEventListener('click', () => {
      startJournalEntry({ plantId: null });
    });
  }

  const btnAddEntryGrowlog = document.getElementById('btn-add-entry-growlog');
  if (btnAddEntryGrowlog) {
    btnAddEntryGrowlog.addEventListener('click', () => {
      if (!currentGrowlogPlantId) return;
      startJournalEntry({ plantId: currentGrowlogPlantId });
    });
  }

  const btnEditPlantGrowlog = document.getElementById('btn-edit-plant-growlog');
  if (btnEditPlantGrowlog) {
    btnEditPlantGrowlog.addEventListener('click', () => {
      if (!currentGrowlogPlantId) return;
      openPlantModal(currentGrowlogPlantId);
    });
  }

  const btnOpenCoach = document.getElementById('btn-open-coach');
  if (btnOpenCoach) {
    btnOpenCoach.addEventListener('click', () => {
      if (window.AICoach) AICoach.open();
    });
  }

  // The weather advice block is re-rendered on every refresh, so delegate.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#weather-coach-ask')) return;
    e.preventDefault();
    if (!window.AICoach) return;
    AICoach.open();
    if (typeof AICoach.ask === 'function') {
      const city =
        window.CoachCore && typeof CoachCore.getWeatherCity === 'function'
          ? CoachCore.getWeatherCity()
          : '';
      AICoach.ask(
        'Based on the forecast' +
          (city ? ' for ' + city : '') +
          ', what should I change about watering and feeding over the next few days?'
      );
    }
  });
  const btnCoachGrowlog = document.getElementById('btn-coach-growlog');
  if (btnCoachGrowlog) {
    btnCoachGrowlog.addEventListener('click', () => {
      if (window.AICoach) {
        AICoach.open();
        const plant = currentGrowlogPlantId
          ? getPlants().find((p) => p.id === currentGrowlogPlantId)
          : null;
        if (plant) {
          AICoach.ask(
            'What should I do next for "' +
              plant.name +
              '" in stage ' +
              (STAGES[plant.stage] || plant.stage || 'unknown') +
              '? Include tokenisation tips.'
          );
        }
      }
    });
  }

  document.getElementById('entry-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const dataEl = document.getElementById('entry-photo-data');
    const previewEl = document.getElementById('entry-photo-preview');
    if (!file) {
      dataEl.value = '';
      previewEl.innerHTML = '';
      return;
    }
    if (!file.type || !file.type.startsWith('image/')) {
      dataEl.value = '';
      previewEl.innerHTML =
        '<span class="media-error">Use a JPG or PNG photo (some phone formats like HEIC aren’t supported here).</span>';
      e.target.value = '';
      return;
    }
    previewEl.innerHTML = '<span class="media-loading">Preparing photo…</span>';
    try {
      let dataUrl = await readFileAsDataUrl(file);
      dataUrl = await resizeImageDataUrl(dataUrl, MAX_IMAGE_SIZE);
      dataEl.value = dataUrl;
      previewEl.innerHTML =
        '<img src="' +
        dataUrl +
        '" alt="Photo" class="media-thumb" /> <button type="button" class="btn-remove-media">Remove</button>';
      previewEl.querySelector('.btn-remove-media').addEventListener('click', () => {
        dataEl.value = '';
        previewEl.innerHTML = '';
        document.getElementById('entry-photo').value = '';
      });
    } catch (err) {
      dataEl.value = '';
      previewEl.innerHTML =
        '<span class="media-error">' +
        escapeHtml((err && err.message) || 'Could not load photo.') +
        '</span>';
      e.target.value = '';
    }
  });

  document.getElementById('entry-video').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const dataEl = document.getElementById('entry-video-data');
    const previewEl = document.getElementById('entry-video-preview');
    if (!file) {
      dataEl.value = '';
      previewEl.innerHTML = '';
      return;
    }
    if (!file.type || !file.type.startsWith('video/')) {
      dataEl.value = '';
      previewEl.innerHTML =
        '<span class="media-error">Use an MP4 or WebM video (this file type isn’t supported here).</span>';
      e.target.value = '';
      return;
    }
    const maxBytes = MAX_VIDEO_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      previewEl.innerHTML = '<span class="media-error">Video too large (max ' + MAX_VIDEO_SIZE_MB + ' MB for local storage).</span>';
      dataEl.value = '';
      document.getElementById('entry-video').value = '';
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      dataEl.value = dataUrl;
      previewEl.innerHTML = '<video src="' + dataUrl + '" controls class="media-thumb-video"></video> <button type="button" class="btn-remove-media">Remove</button>';
      previewEl.querySelector('.btn-remove-media').addEventListener('click', () => {
        dataEl.value = '';
        previewEl.innerHTML = '';
        document.getElementById('entry-video').value = '';
      });
    } catch (err) {
      previewEl.innerHTML = '<span class="media-error">Error while loading.</span>';
    }
  });

  document.getElementById('form-entry').addEventListener('submit', (e) => {
    e.preventDefault();
    const plantIdForEntry = document.getElementById('entry-plant').value || null;
    const type = document.getElementById('entry-type').value;
    let meta = {};
    if (type === 'presadjivanje') {
      const soil = document.getElementById('entry-transplant-soil').value.trim();
      const age = document.getElementById('entry-transplant-age').value.trim();
      const condition = document.getElementById('entry-transplant-condition').value.trim();
      if (soil || age || condition) {
        meta.presadjivanje = {
          soilQuality: soil || null,
          plantAge: age || null,
          plantCondition: condition || null,
        };
      }
    } else if (type === 'stresori') {
      const temp = document.getElementById('entry-stressor-temp').value.trim();
      const humidity = document.getElementById('entry-stressor-humidity').value.trim();
      const vpd = document.getElementById('entry-stressor-vpd').value.trim();
      const pests = document.getElementById('entry-stressor-pests').value.trim();
      if (temp || humidity || vpd || pests) {
        meta.stresori = {
          temperature: temp || null,
          humidity: humidity || null,
          vpd: vpd || null,
          pests: pests || null,
        };
      }
    } else if (type === 'faza') {
      const fieldLocInput = document.getElementById('entry-faza-field-location');
      const plantingInput = document.getElementById('entry-faza-planting-location');
      const fieldLoc = fieldLocInput ? fieldLocInput.value.trim() : '';
      const plantingLoc = plantingInput ? plantingInput.value.trim() : '';
      if (fieldLoc || plantingLoc) {
        meta.faza = {};
        if (fieldLoc) meta.fieldLocation = fieldLoc;
        if (plantingLoc) meta.plantingLocation = plantingLoc;
      }
    }
    try {
      saveJournalEntry({
        plantId: plantIdForEntry,
        type: type,
        note: document.getElementById('entry-note').value,
        date: document.getElementById('entry-date').value || localDateYYYYMMDD(),
        photo: document.getElementById('entry-photo-data').value.trim() || null,
        video: document.getElementById('entry-video-data').value.trim() || null,
        meta: Object.keys(meta).length ? meta : undefined,
        source: 'entry-modal',
        requireNoteDefault: false,
      });
    } catch (err) {
      const msg = (err && err.message) || 'Could not save journal entry.';
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        DnevnikNotifications.toast(msg, msg.indexOf('Choose a plant') === 0 ? 'warn' : 'error');
      } else {
        alert(msg);
      }
      return;
    }
    const plantSelect = document.getElementById('entry-plant');
    if (plantSelect) plantSelect.disabled = false;
    modalEntry.classList.remove('open');
  });

  modalEntry.querySelector('.modal-close').addEventListener('click', () => {
    const plantSelect = document.getElementById('entry-plant');
    if (plantSelect) plantSelect.disabled = false;
    modalEntry.classList.remove('open');
  });
  modalEntry.querySelector('.modal-cancel').addEventListener('click', () => {
    const plantSelect = document.getElementById('entry-plant');
    if (plantSelect) plantSelect.disabled = false;
    modalEntry.classList.remove('open');
  });
  bindModalBackdropClose(modalEntry, () => {
    const plantSelect = document.getElementById('entry-plant');
    if (plantSelect) plantSelect.disabled = false;
    modalEntry.classList.remove('open');
  });

  // --- Toolbox (Alati) ---
  function getToolboxData() {
    try {
      const data = localStorage.getItem(STORAGE_TOOLBOX);
      const parsed = data ? JSON.parse(data) : {};
      return {
        watering: parsed.watering || [],
        feeding: parsed.feeding || [],
        environment: parsed.environment || [],
        transplant: parsed.transplant || [],
        stressors: parsed.stressors || [],
      };
    } catch {
      return { watering: [], feeding: [], environment: [], transplant: [], stressors: [] };
    }
  }

  function setToolboxData(data) {
    if (blockAdminWrite()) return;
    localStorage.setItem(STORAGE_TOOLBOX, JSON.stringify(data));
    scheduleRemoteSync({ toolbox: data || {} });
  }

  /**
   * Tools keeps quantitative rows for charts; the plant story lives in the Journal.
   * Mirror each Tools log into a journal entry so the care trail stays one asset.
   */
  function mirrorToolboxItemToJournal(tool, item) {
    if (!item) return null;
    const plantId =
      tool === 'watering'
        ? item.value2 || item.plantId || null
        : item.plantId || null;
    if (!plantId) return null;

    let type = 'opcenito';
    let note = '';
    let metaExtra = {};

    if (tool === 'watering') {
      type = 'zalijevanje';
      const ml = item.value1 != null && String(item.value1).trim() !== '' ? String(item.value1).trim() + ' mL' : '';
      note = ml ? ml + ' (via Tools)' : 'Watering logged via Tools';
      metaExtra = { amountMl: item.value1 || null };
    } else if (tool === 'feeding') {
      type = 'gnojidba';
      const parts = [item.value1, item.value2].filter(Boolean).map(String);
      note = (parts.length ? parts.join(' — ') : 'Feeding') + ' (via Tools)';
      metaExtra = { product: item.value1 || null, detail: item.value2 || null };
    } else if (tool === 'environment') {
      type = 'okolis';
      const bits = [];
      if (item.value1) bits.push(String(item.value1) + '°C');
      if (item.value2) bits.push(String(item.value2) + '% RH');
      if (item.value3) bits.push('pH ' + String(item.value3));
      note = (bits.length ? bits.join(' · ') : 'Environment reading') + ' (via Tools)';
      metaExtra = {
        temperatureC: item.value1 || null,
        humidityPct: item.value2 || null,
        ph: item.value3 || null,
      };
    } else if (tool === 'transplant') {
      type = 'presadjivanje';
      const bits = [];
      if (item.soilQuality) bits.push('Soil: ' + item.soilQuality);
      if (item.plantAge) bits.push('Age: ' + item.plantAge);
      if (item.plantCondition) bits.push('Condition: ' + item.plantCondition);
      note = (bits.length ? bits.join(' · ') : 'Transplant') + ' (via Tools)';
      metaExtra = {
        presadjivanje: {
          soilQuality: item.soilQuality || null,
          plantAge: item.plantAge || null,
          plantCondition: item.plantCondition || null,
        },
      };
    } else if (tool === 'stressors') {
      type = 'stresori';
      const bits = [];
      if (item.temperature) bits.push('Temp: ' + item.temperature);
      if (item.humidity) bits.push('Humidity: ' + item.humidity);
      if (item.vpd) bits.push('VPD: ' + item.vpd);
      if (item.pests) bits.push('Pests: ' + item.pests);
      note = (bits.length ? bits.join(' · ') : 'Stressor note') + ' (via Tools)';
      metaExtra = {
        stresori: {
          temperature: item.temperature || null,
          humidity: item.humidity || null,
          vpd: item.vpd || null,
          pests: item.pests || null,
        },
      };
    } else {
      return null;
    }

    try {
      return saveJournalEntry({
        plantId: plantId,
        type: type,
        note: note,
        date: item.date || localDateYYYYMMDD(),
        meta: Object.assign(
          {
            toolboxTool: tool,
            toolboxId: item.id || null,
          },
          metaExtra
        ),
        source: 'toolbox',
        requireNoteDefault: false,
      });
    } catch (err) {
      console.warn('Tools → Journal mirror failed', err);
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        DnevnikNotifications.toast(
          (err && err.message) || 'Saved in Tools, but journal trail did not update.',
          'warn'
        );
      }
      return null;
    }
  }

  function addToolboxRecord(tool, record) {
    if (blockAdminWrite()) return null;
    const data = getToolboxData();
    if (!data[tool]) data[tool] = [];
    const item = Object.assign({ id: uuid() }, record || {});
    data[tool].push(item);
    setToolboxData(data);
    mirrorToolboxItemToJournal(tool, item);
    return item;
  }

  function openToolboxPanel(tool) {
    document.querySelectorAll('.toolbox-panel').forEach((p) => {
      const open = p.dataset.tool === tool;
      p.classList.toggle('open', open);
      p.setAttribute('aria-hidden', !open);
    });
    const today = new Date().toISOString().slice(0, 10);
    ['tool-watering-date', 'tool-feeding-date', 'tool-environment-date', 'tool-transplant-date', 'tool-stressors-date'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = today;
    });
    if (tool === 'watering' || tool === 'feeding' || tool === 'environment' || tool === 'transplant' || tool === 'stressors') fillToolboxPlantSelects();
    if (tool === 'graphs') {
      renderToolboxChart('watering', document.getElementById('overview-chart-watering'));
      renderToolboxChart('environment', document.getElementById('overview-chart-environment'));
    } else if (tool === 'soil-moisture') {
      reloadSoilMoistureIframe('#toolbox-panel-soil-moisture .soil-moisture-iframe');
    } else {
      renderToolboxList(tool);
      const chartEl = document.getElementById('toolbox-chart-' + tool);
      if (chartEl) renderToolboxChart(tool, chartEl);
    }
  }

  function fillToolboxPlantSelect() {
    // Back-compat: keep old function name, but fill all tool selects.
    fillToolboxPlantSelects();
  }

  function fillToolboxPlantSelects() {
    const plants = getPlants();
    const options = plants.map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('');
    ['tool-watering-value2', 'tool-feeding-plant', 'tool-environment-plant', 'tool-transplant-plant', 'tool-stressors-plant'].forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const first = sel.options[0] ? sel.options[0].outerHTML : '<option value="">-- Select a plant --</option>';
      sel.innerHTML = first + options;
    });

    const graphsSel = document.getElementById('tool-graphs-plant');
    if (graphsSel) {
      const first = graphsSel.options[0] ? graphsSel.options[0].outerHTML : '<option value="">All plants</option>';
      graphsSel.innerHTML = first + options;
    }
  }

  function renderToolbox() {
    document.querySelectorAll('.toolbox-panel').forEach((p) => {
      p.classList.remove('open');
      p.setAttribute('aria-hidden', 'true');
    });
    fillToolboxPlantSelects();
  }

  function renderToolboxList(tool) {
    const listEl = document.getElementById('toolbox-list-' + tool);
    if (!listEl) return;
    const data = getToolboxData()[tool] || [];
    data.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (data.length === 0) {
      listEl.innerHTML = '<p class="toolbox-empty">No entries yet. Add the first one.</p>';
      return;
    }
    const plants = getPlants();
    const plantById = new Map(plants.map((p) => [p.id, p.name]));
    const plantLabel = (plantId) => {
      if (!plantId) return '—';
      return plantById.get(plantId) || 'Plant';
    };
    listEl.innerHTML = data
      .map((item) => {
        let valuesStr;
        if (tool === 'watering') {
          const val = escapeHtml(String(item.value1 || ''));
          valuesStr = val + ' mL · ' + escapeHtml(plantLabel(item.value2 || item.plantId));
        } else if (tool === 'feeding') {
          const parts = [];
          if (item.value1) parts.push(escapeHtml(String(item.value1)));
          if (item.value2) parts.push(escapeHtml(String(item.value2)));
          parts.push(escapeHtml(plantLabel(item.plantId)));
          valuesStr = parts.join(' · ');
        } else if (tool === 'environment') {
          valuesStr =
            escapeHtml(String(item.value1 || '')) +
            ' °C' +
            (item.value2 ? ' · ' + escapeHtml(String(item.value2)) + ' %' : '') +
            (item.value3 ? ' · pH ' + escapeHtml(String(item.value3)) : '') +
            ' · ' +
            escapeHtml(plantLabel(item.plantId));
        } else if (tool === 'transplant') {
          const parts = [];
          if (item.soilQuality) parts.push('Soil quality: ' + escapeHtml(String(item.soilQuality)));
          if (item.plantAge) parts.push('Age: ' + escapeHtml(String(item.plantAge)));
          if (item.plantCondition) parts.push('Condition: ' + escapeHtml(String(item.plantCondition)));
          parts.push('Plant: ' + escapeHtml(plantLabel(item.plantId)));
          valuesStr = parts.join(' · ') || '-';
        } else if (tool === 'stressors') {
          const parts = [];
          if (item.temperature) parts.push('Temperature: ' + escapeHtml(String(item.temperature)));
          if (item.humidity) parts.push('Humidity: ' + escapeHtml(String(item.humidity)));
          if (item.vpd) parts.push('VPD: ' + escapeHtml(String(item.vpd)));
          if (item.pests) parts.push('Pests: ' + escapeHtml(String(item.pests)));
          parts.push('Plant: ' + escapeHtml(plantLabel(item.plantId)));
          valuesStr = parts.join(' · ') || '-';
        } else {
          valuesStr = escapeHtml(String(item.value1 || '')) + (item.value2 ? ' · ' + escapeHtml(String(item.value2)) : '');
        }
        return (
          '<div class="toolbox-list-item" data-id="' +
          item.id +
          '"><span class="toolbox-list-date">' +
          (item.date ? new Date(item.date).toLocaleDateString('en-GB') : '') +
          '</span><span class="toolbox-list-values">' +
          valuesStr +
          '</span><button type="button" class="toolbox-list-delete" aria-label="Delete">×</button></div>'
        );
      })
      .join('');
    listEl.querySelectorAll('.toolbox-list-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (blockAdminWrite()) return;
        const id = btn.closest('.toolbox-list-item').dataset.id;
        if (!confirm('Delete this Tools log?\n\nYou can undo for a few seconds after.')) return;
        const data = getToolboxData();
        const removed = (data[tool] || []).find((x) => x.id === id);
        if (!removed) return;
        const snapshot = JSON.parse(JSON.stringify(removed));
        data[tool] = data[tool].filter((x) => x.id !== id);
        setToolboxData(data);
        renderToolboxList(tool);
        const chartEl = document.getElementById('toolbox-chart-' + tool);
        if (chartEl) renderToolboxChart(tool, chartEl);
        showUndoToast('Tools log deleted — undo available', () => {
          const next = getToolboxData();
          next[tool] = (next[tool] || []).concat([snapshot]);
          setToolboxData(next);
          renderToolboxList(tool);
          const chartRestore = document.getElementById('toolbox-chart-' + tool);
          if (chartRestore) renderToolboxChart(tool, chartRestore);
        });
      });
    });
  }

  function resolveToolboxChartPlantId(tool, container) {
    if (!container) return null;
    const id = container.id || '';
    if (id === 'toolbox-chart-watering') return document.getElementById('tool-watering-value2')?.value || null;
    if (id === 'toolbox-chart-environment') return document.getElementById('tool-environment-plant')?.value || null;
    if (id === 'overview-chart-watering' || id === 'overview-chart-environment') return document.getElementById('tool-graphs-plant')?.value || null;
    // dashboard charts remain unfiltered
    return null;
  }

  function renderToolboxChart(tool, container, plantId) {
    if (!container) return;
    const data = getToolboxData()[tool] || [];
    const selectedPlantId = plantId !== undefined ? plantId : resolveToolboxChartPlantId(tool, container);
    const sortedAll = [...data].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const sorted = selectedPlantId
      ? sortedAll.filter((x) => {
          const pid = tool === 'watering' ? x.value2 || x.plantId : x.plantId;
          return pid === selectedPlantId;
        })
      : sortedAll;

    if (sorted.length === 0) {
      container.innerHTML = '<p class="toolbox-chart-empty">No data for the chart.</p>';
      return;
    }
    const numVal = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));
    if (tool === 'watering') {
      const max = Math.max(1, ...sorted.map((x) => numVal(x.value1)));
      container.innerHTML =
        '<div class="toolbox-bars">' +
        sorted
          .map((x) => {
            const val = numVal(x.value1);
            const pct = Math.round((val / max) * 100);
            const label = x.date ? new Date(x.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
            return '<div class="toolbox-bar-item"><span class="toolbox-bar-label">' + label + '</span><div class="toolbox-bar-track"><div class="toolbox-bar-fill" style="width:' + pct + '%"></div></div><span class="toolbox-bar-value">' + val + ' mL</span></div>';
          })
          .join('') +
        '</div>';
    } else if (tool === 'environment') {
      const temps = sorted.map((x) => numVal(x.value1));
      const hums = sorted.map((x) => numVal(x.value2));
      const phs = sorted.map((x) => numVal(x.value3));
      const maxT = Math.max(1, ...temps);
      const maxH = Math.max(1, ...hums);
      const maxPh = Math.max(1, ...phs.filter((p) => p > 0));
      const hasPh = phs.some((p) => p > 0);
      container.innerHTML =
        '<div class="toolbox-bars">' +
        sorted
          .map((x) => {
            const t = numVal(x.value1);
            const h = numVal(x.value2);
            const ph = numVal(x.value3);
            const pctT = Math.round((t / maxT) * 100);
            const label = x.date ? new Date(x.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
            let row =
              '<div class="toolbox-bar-item"><span class="toolbox-bar-label">' +
              label +
              '</span><div class="toolbox-bar-track"><div class="toolbox-bar-fill" style="width:' +
              pctT +
              '%" title="' +
              t +
              ' °C"></div></div><span class="toolbox-bar-value">' +
              t +
              ' °C</span>' +
              (h ? ' <span class="toolbox-bar-value toolbox-bar-value-alt">' + h + ' %</span>' : '') +
              (ph ? ' <span class="toolbox-bar-value toolbox-bar-value-alt">' + ph + ' pH</span>' : '') +
              '</div>';
            if (hasPh && ph > 0 && maxPh >= 1) {
              const pctPh = Math.round((ph / 14) * 100);
              row +=
                '<div class="toolbox-bar-item toolbox-bar-item-ph"><span class="toolbox-bar-label">pH</span><div class="toolbox-bar-track"><div class="toolbox-bar-fill toolbox-bar-fill-ph" style="width:' +
                pctPh +
                '%" title="' +
                ph +
                ' pH"></div></div><span class="toolbox-bar-value">' +
                ph +
                ' pH</span></div>';
            }
            return row;
          })
          .join('') +
        '</div>';
    } else if (tool === 'feeding') {
      container.innerHTML =
        '<div class="toolbox-timeline-list">' +
        sorted
          .map((x) => '<div class="toolbox-timeline-item"><span class="toolbox-list-date">' + (x.date ? new Date(x.date).toLocaleDateString('en-GB') : '') + '</span> ' + escapeHtml(String(x.value1 || '')) + (x.value2 ? ' – ' + escapeHtml(String(x.value2)) : '') + '</div>')
          .join('') +
        '</div>';
    }
  }

  document.querySelectorAll('.toolbox-card-btn').forEach((btn) => {
    btn.addEventListener('click', () => openToolboxPanel(btn.dataset.tool));
  });

  const wateringPlantSel = document.getElementById('tool-watering-value2');
  if (wateringPlantSel) {
    wateringPlantSel.addEventListener('change', () => {
      renderToolboxList('watering');
      renderToolboxChart('watering', document.getElementById('toolbox-chart-watering'));
    });
  }

  const envPlantSel = document.getElementById('tool-environment-plant');
  if (envPlantSel) {
    envPlantSel.addEventListener('change', () => {
      renderToolboxList('environment');
      renderToolboxChart('environment', document.getElementById('toolbox-chart-environment'));
    });
  }

  const graphsPlantSel = document.getElementById('tool-graphs-plant');
  if (graphsPlantSel) {
    graphsPlantSel.addEventListener('change', () => {
      renderToolboxChart('watering', document.getElementById('overview-chart-watering'));
      renderToolboxChart('environment', document.getElementById('overview-chart-environment'));
    });
  }

  document.getElementById('toolbox-form-watering').addEventListener('submit', (e) => {
    e.preventDefault();
    addToolboxRecord('watering', {
      date: document.getElementById('tool-watering-date').value,
      value1: document.getElementById('tool-watering-value1').value.trim(),
      value2: document.getElementById('tool-watering-value2').value.trim() || null,
      plantId: document.getElementById('tool-watering-value2').value.trim() || null,
    });
    document.getElementById('toolbox-form-watering').reset();
    renderToolboxList('watering');
    renderToolboxChart('watering', document.getElementById('toolbox-chart-watering'));
  });

  document.getElementById('toolbox-form-feeding').addEventListener('submit', (e) => {
    e.preventDefault();
    addToolboxRecord('feeding', {
      date: document.getElementById('tool-feeding-date').value,
      value1: document.getElementById('tool-feeding-value1').value.trim(),
      value2: document.getElementById('tool-feeding-value2').value.trim() || null,
      plantId: document.getElementById('tool-feeding-plant').value.trim() || null,
    });
    document.getElementById('toolbox-form-feeding').reset();
    renderToolboxList('feeding');
    renderToolboxChart('feeding', document.getElementById('toolbox-chart-feeding'));
  });

  document.getElementById('toolbox-form-environment').addEventListener('submit', (e) => {
    e.preventDefault();
    addToolboxRecord('environment', {
      date: document.getElementById('tool-environment-date').value,
      value1: document.getElementById('tool-environment-value1').value.trim(),
      value2: document.getElementById('tool-environment-value2').value.trim() || null,
      value3: document.getElementById('tool-environment-value3').value.trim() || null,
      plantId: document.getElementById('tool-environment-plant').value.trim() || null,
    });
    document.getElementById('toolbox-form-environment').reset();
    renderToolboxList('environment');
    renderToolboxChart('environment', document.getElementById('toolbox-chart-environment'));
  });

  const transplantForm = document.getElementById('toolbox-form-transplant');
  if (transplantForm) {
    transplantForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addToolboxRecord('transplant', {
        date: document.getElementById('tool-transplant-date').value,
        soilQuality: document.getElementById('tool-transplant-soil').value.trim() || null,
        plantAge: document.getElementById('tool-transplant-age').value.trim() || null,
        plantCondition: document.getElementById('tool-transplant-condition').value.trim() || null,
        plantId: document.getElementById('tool-transplant-plant').value.trim() || null,
      });
      document.getElementById('toolbox-form-transplant').reset();
      renderToolboxList('transplant');
    });
  }

  const stressorsForm = document.getElementById('toolbox-form-stressors');
  if (stressorsForm) {
    stressorsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addToolboxRecord('stressors', {
        date: document.getElementById('tool-stressors-date').value,
        temperature: document.getElementById('tool-stressors-temp').value.trim() || null,
        humidity: document.getElementById('tool-stressors-humidity').value.trim() || null,
        vpd: document.getElementById('tool-stressors-vpd').value.trim() || null,
        pests: document.getElementById('tool-stressors-pests').value.trim() || null,
        plantId: document.getElementById('tool-stressors-plant').value.trim() || null,
      });
      document.getElementById('toolbox-form-stressors').reset();
      renderToolboxList('stressors');
    });
  }

  // Init
  initFirebaseSync();
  fillEntryPlantSelect();
  fillJournalPlantFilter();

  document.querySelectorAll('.toolbox-card-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;

      document.querySelectorAll('.toolbox-panel').forEach((panel) => {
        panel.style.display = 'none';
        panel.setAttribute('aria-hidden', 'true');
      });

      const activePanel = document.getElementById(`toolbox-panel-${tool}`);

      if (activePanel) {
        activePanel.style.display = 'block';
        activePanel.setAttribute('aria-hidden', 'false');
      }
    });
  });

document.addEventListener("click", (e) => {

  if (e.target.closest("#admin-users")) {
    window.location.href = "admin-users.html";
  }

  if (e.target.closest("#admin-plants")) {
    window.location.href = "admin-plants.html";
  }

  if (e.target.closest("#admin-entries")) {
    window.location.href = "admin-entries.html";
  }

  if (e.target.closest("#admin-tenant")) {
    window.location.href = "admin-tenants.html";
  }

  if (e.target.closest("#admin-system")) {
    window.location.href = "admin-system.html";
  }

});

  window.DnevnikProfile = {
    getType: getProfileType,
    isAdopter: isAdopterProfile,
    isGrower: isGrowerProfile,
    TYPES: PROFILE_TYPES,
  };

  function refreshAfterJournalWrite(plantId) {
    try {
      renderPlants();
      renderDashboard();
      renderJournal();
      fillEntryPlantSelect();
      fillJournalPlantFilter();
      if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
      if (plantId && currentGrowlogPlantId === plantId) renderGrowlog(plantId);
      if (window.AdoptPlant && typeof window.AdoptPlant.render === 'function') {
        const adoptView = document.getElementById('view-adopt');
        if (adoptView && adoptView.classList.contains('active')) window.AdoptPlant.render();
      }
      const todayView = document.getElementById('view-danas');
      if (todayView && todayView.classList.contains('active')) renderToday();
    } catch (err) {
      console.warn('Journal refresh after coach action', err);
    }
  }

  function createPlantProgrammatic(opts) {
    const o = opts || {};
    if (blockAdminWrite()) throw new Error('Writes are disabled for this account.');
    const name = String(o.name || '').trim();
    if (!name) throw new Error('Plant name is required.');
    const newId = uuid();
    const stage = canonicalPlantStage(o.stage || 'klijanje');
    const day0 = o.startDate || localDateYYYYMMDD();
    const strain = String(o.strain || '').trim();
    const envType = o.environmentType === 'outdoor' ? 'outdoor' : 'indoor';
    const count = Math.max(1, Number(o.count || 1) || 1);
    const stageHistory = [{ from: null, to: stage, date: day0 }];
    const stageDates = {};
    stageDates[stage] = day0;
    const plant = {
      id: newId,
      name: name,
      strain: strain,
      count: count,
      stage: stage,
      subphase: null,
      startDate: day0,
      environmentName: o.environmentName || null,
      environmentType: envType,
      fieldLocation: null,
      plantingLocation: null,
      exposureHours: null,
      notes: String(o.notes || '').trim(),
      photo: null,
      updatedAt: new Date().toISOString(),
      views: 0,
      stageHistory: stageHistory,
      stageDates: stageDates,
      subphaseHistory: [],
    };
    setPlants(getPlants().concat([plant]));
    saveJournalEntry({
      plantId: newId,
      type: 'faza',
      note: 'Grow started — stage: ' + (STAGES[stage] || stage) + ' (via Grower Coach)',
      date: day0,
      meta: { faza: { from: null, to: stage } },
      source: 'ai-coach',
      requireNoteDefault: false,
    });
    return plant;
  }

  function setPlantStageProgrammatic(plantId, stage, note) {
    if (blockWrite({ plantId: plantId })) throw new Error('Cannot edit this plant.');
    const plants = getPlants();
    const idx = plants.findIndex((p) => p && String(p.id) === String(plantId));
    if (idx < 0) throw new Error('Plant not found.');
    const prev = plants[idx];
    const newStage = canonicalPlantStage(stage);
    const oldStage = canonicalPlantStage(prev.stage);
    if (oldStage === newStage) return prev;
    const td = localDateYYYYMMDD();
    const stageHistory = Array.isArray(prev.stageHistory) ? prev.stageHistory.slice() : [];
    const stageDates =
      prev.stageDates && typeof prev.stageDates === 'object' ? Object.assign({}, prev.stageDates) : {};
    stageHistory.push({ from: oldStage, to: newStage, date: td });
    stageDates[newStage] = td;
    const updated = Object.assign({}, prev, {
      stage: newStage,
      stageHistory: stageHistory,
      stageDates: stageDates,
      updatedAt: new Date().toISOString(),
    });
    plants[idx] = updated;
    setPlants(plants);
    const base =
      'Stage transition: ' +
      (STAGES[oldStage] || oldStage) +
      ' → ' +
      (STAGES[newStage] || newStage);
    saveJournalEntry({
      plantId: String(plantId),
      type: 'faza',
      note: (note ? base + '. ' + String(note) : base) + ' (via Grower Coach)',
      date: td,
      meta: { faza: { from: oldStage, to: newStage } },
      source: 'ai-coach',
      requireNoteDefault: false,
    });
    return updated;
  }

  /**
   * Canonical journal create path — modal, Log sheet, quick-log, coach, plant wizard.
   * Success UI runs only after a write→re-read confirm (see setEntries / verifyEntryLanded).
   * @param {{
   *   plantId: string,
   *   type?: string,
   *   entryType?: string,
   *   note?: string,
   *   date?: string,
   *   photo?: string|null,
   *   video?: string|null,
   *   meta?: object,
   *   source?: string,
   *   requireNoteDefault?: boolean,
   *   silent?: boolean
   * }} opts
   */
  function saveJournalEntry(opts) {
    const o = opts || {};
    const plantId = o.plantId || null;
    if (blockWrite({ plantId: plantId })) throw new Error('Cannot add entry for this plant.');
    if (!plantId) throw new Error('Choose a plant before saving the entry.');
    const plant = getPlants().find((p) => p && String(p.id) === String(plantId));
    if (!plant) throw new Error('Plant not found.');

    const type = String(o.type || o.entryType || 'opcenito').trim() || 'opcenito';
    // Modal may save an empty General note; coach/quick-log omit note → default copy.
    let note = '';
    if (o.note === undefined || o.note === null) {
      note = o.requireNoteDefault === false ? '' : 'Logged via Grower Coach';
    } else {
      note = String(o.note).trim();
    }
    const date = o.date || localDateYYYYMMDD();
    const source = o.source || (o.meta && o.meta.source) || 'journal';
    const meta = Object.assign({}, o.meta || {}, { source: source });
    const entry = {
      id: uuid(),
      plantId: String(plantId),
      date: date,
      type: type,
      note: note,
      photo: o.photo || null,
      video: o.video || null,
      meta: meta,
      createdAt: new Date().toISOString(),
    };

    const next = getEntries().concat([entry]);
    if (!setEntries(next)) {
      throw new Error('Could not save journal entry.');
    }
    // Second confirm: field-level match after an independent storage re-read.
    const landed = verifyEntryLanded(entry);
    if (!landed) {
      throw new Error('Entry did not save. Please try again.');
    }

    // Stage-location fields on a faza entry also update the plant profile.
    if (
      type === 'faza' &&
      (meta.fieldLocation || meta.plantingLocation)
    ) {
      const plants = getPlants();
      const idx = plants.findIndex((p) => p && String(p.id) === String(plantId));
      if (idx >= 0) {
        const patch = Object.assign({}, plants[idx], { updatedAt: new Date().toISOString() });
        if (meta.fieldLocation) {
          patch.fieldLocation = meta.fieldLocation;
          patch.environmentType = 'outdoor';
        }
        if (meta.plantingLocation) patch.plantingLocation = meta.plantingLocation;
        plants[idx] = patch;
        setPlants(plants);
      }
    }

    // Success side-effects only after verified land.
    if (window.AICoach && typeof AICoach.narrateAfterEntry === 'function') {
      try {
        AICoach.narrateAfterEntry(landed, plant);
      } catch (e) {
        // ignore
      }
    }
    if (
      !o.silent &&
      window.DnevnikNotifications &&
      typeof DnevnikNotifications.notifyJournalEntry === 'function'
    ) {
      try {
        DnevnikNotifications.notifyJournalEntry(landed, plant.name);
      } catch {
        // ignore
      }
    }
    maybeNotifyCareProgress();
    refreshAfterJournalWrite(plantId);
    return landed;
  }

  /** @deprecated alias — all callers should prefer saveJournalEntry */
  function addJournalEntryProgrammatic(opts) {
    const o = opts || {};
    return saveJournalEntry(
      Object.assign({}, o, {
        source: (o.meta && o.meta.source) || o.source || 'ai-coach',
      })
    );
  }

  function findPlantByNameOrId(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const plants = getPlants();
    return (
      plants.find((p) => p && String(p.id) === String(query)) ||
      plants.find((p) => p && String(p.name || '').toLowerCase() === q) ||
      plants.find((p) => p && String(p.name || '').toLowerCase().includes(q)) ||
      null
    );
  }

  window.DnevnikJournal = {
    getPlants: getPlants,
    getEntries: getEntries,
    getCurrentGrowlogPlantId: function () {
      return currentGrowlogPlantId;
    },
    STAGES: STAGES,
    createPlant: createPlantProgrammatic,
    setPlantStage: setPlantStageProgrammatic,
    addEntry: addJournalEntryProgrammatic,
    saveEntry: saveJournalEntry,
    openEntry: startJournalEntry,
    findPlant: findPlantByNameOrId,
    refresh: refreshAfterJournalWrite,
  };

})();
