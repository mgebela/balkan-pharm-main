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

  /**
   * BCP-47 tag for the reader's language, for Intl formatting.
   *
   * Every date and number in this file used to be pinned to en-GB / en-US,
   * which put "Wed 19 Aug" and "1,234" inside Croatian and German sentences —
   * including the coach messages that read these labels back.
   */
  function intlTag() {
    var meta = window.I18N && I18N.locales
      ? I18N.locales.filter(function (l) { return l.code === I18N.locale; })[0]
      : null;
    return (meta && meta.intl) || (window.I18N && I18N.locale) || 'en-GB';
  }
  let plantsSurfaceDirty = true;

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
  let remoteSyncRetries = 0;
  let remoteSyncBlockedMessage = '';
  let inlinePhotoMigrationRun = false;

  /**
   * Firestore rejects any document over 1 MiB, and the whole journal (plants,
   * entries, toolbox) lives in a single doc — so the client has to police its
   * own size. The server only reports the overflow *after* the write fails,
   * and that failure is permanent: retrying the same payload can never work.
   *
   * The budget sits under the hard limit to leave room for field names and
   * UTF-8 overhead that JSON.stringify does not account for.
   */
  const FIRESTORE_DOC_LIMIT = 1048576;
  const REMOTE_SYNC_SIZE_BUDGET = 950000;
  const REMOTE_SYNC_MAX_ATTEMPTS = 5;
  const REMOTE_SYNC_RETRY_BASE_MS = 2000;
  /** Codes that will fail identically however many times we resend. */
  const REMOTE_SYNC_FATAL_CODES = [
    'invalid-argument',
    'permission-denied',
    'unauthenticated',
    'not-found',
  ];
  let isAdminReadOnly = false;
  let readOnlyBannerMessage = '';
  let sharedReadOnlyPlantIds = new Set();
  let sharedReadOnlyEntryIds = new Set();

  const SHARED_HYBRID_ACCESS_EMAILS = [
    'filip.balkanpharm@gmail.com',
    'marko.matosevic2005@gmail.com',
  ];
  const SOIL_MOISTURE_TOOL_EMAILS = ['marko.matosevic2005@gmail.com'];
  /** Only these accounts may use Admin panel / privileged role — never grower profiles. */
  const ADMIN_PANEL_EMAILS = ['supadmin@dnevnik.live', 'admin@dnevnik.live'];
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

  function isAllowedAdminEmail(email) {
    return ADMIN_PANEL_EMAILS.indexOf(String(email || '').trim().toLowerCase()) !== -1;
  }

  function getFirebaseAuthUser() {
    try {
      if (window.firebase && firebase.auth) return firebase.auth().currentUser || null;
    } catch {
      // ignore
    }
    return null;
  }

  function isCurrentEmailVerified() {
    const user = getFirebaseAuthUser();
    return !!(user && user.emailVerified);
  }

  async function resendVerificationEmail() {
    const user = getFirebaseAuthUser();
    if (!user) throw new Error(T('app.signInFirst', 'Sign in first.'));
    if (user.emailVerified) return { already: true };
    await user.sendEmailVerification();
    return { sent: true, email: user.email || '' };
  }

  async function refreshEmailVerifiedStatus() {
    const user = getFirebaseAuthUser();
    if (!user) return false;
    await user.reload();
    await user.getIdToken(true);
    return !!user.emailVerified;
  }

  window.GrowtooEmailVerify = {
    isVerified: isCurrentEmailVerified,
    resend: resendVerificationEmail,
    refresh: refreshEmailVerifiedStatus,
  };

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

  /** Byte size as Firestore counts it — UTF-8, not UTF-16 code units. */
  function remoteSyncPayloadSize(payload) {
    let json = '';
    try {
      json = JSON.stringify(payload) || '';
    } catch (_) {
      return 0;
    }
    try {
      return new Blob([json]).size;
    } catch (_) {
      return json.length;
    }
  }

  /**
   * Cloud-sync failures used to be a console.warn and nothing else, so a
   * journal could stop backing up for weeks with the UI looking perfectly
   * healthy. Anything that stops the backup has to be visible.
   */
  function setRemoteSyncBanner(message) {
    remoteSyncBlockedMessage = message || '';
    let banner = document.getElementById('sync-error-banner');
    if (!remoteSyncBlockedMessage) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sync-error-banner';
      banner.className = 'admin-readonly-banner sync-error-banner';
      banner.setAttribute('role', 'alert');
      const main = document.querySelector('.main');
      if (main) main.insertBefore(banner, main.firstChild);
    }
    banner.textContent = remoteSyncBlockedMessage;
  }

  async function flushRemoteSync() {
    if (remoteSyncInFlight) return;
    const uid = getFirebaseUserId();
    const ref = getStateDocRef(uid);
    if (!ref) return;
    const payload = Object.assign({}, remoteSyncPending);
    if (!Object.keys(payload).length) return;
    // Safe to clear: every field below is rebuilt from local storage on the
    // next flush, so dropping the queue never loses an edit.
    remoteSyncPending = {};
    remoteSyncInFlight = true;
    let retryDelay = 0;
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

      // Check the size here rather than letting Firestore reject it. An
      // oversized document fails identically every time, so resending it is
      // pure waste — and this used to resend in a tight loop forever.
      const size = remoteSyncPayloadSize(payload);
      if (size > REMOTE_SYNC_SIZE_BUDGET) {
        // i18n-ignore — console diagnostic; the grower sees the banner below.
        console.warn(
          'Remote journal sync skipped — payload ' +
            size +
            ' bytes exceeds the ' +
            REMOTE_SYNC_SIZE_BUDGET +
            ' byte budget (Firestore hard limit ' +
            FIRESTORE_DOC_LIMIT +
            ')'
        );
        setRemoteSyncBanner(
          T(
            'app.sync.tooLarge',
            'Saved on this device, but too large to back up to the cloud ({used} KB of {budget} KB). Photos take up most of the space — remove a large one to resume cloud backup.',
            {
              used: Math.round(size / 1024),
              budget: Math.round(REMOTE_SYNC_SIZE_BUDGET / 1024),
            }
          )
        );
        return;
      }

      await ref.set(payload, { merge: true });
      remoteSyncRetries = 0;
      if (remoteSyncBlockedMessage) setRemoteSyncBanner('');
    } catch (err) {
      console.warn('Remote journal sync failed — keeping local copy', err);
      const code = String((err && err.code) || '');
      if (REMOTE_SYNC_FATAL_CODES.indexOf(code) !== -1) {
        // Permanent rejection. Retrying cannot change the outcome, so stop and
        // say so; the next edit will schedule a fresh attempt.
        setRemoteSyncBanner(
          T(
            'app.sync.rejected',
            'Saved on this device, but the cloud backup was rejected ({reason}). It will try again after your next change.',
            { reason: code || T('app.sync.unknownError', 'unknown error') }
          )
        );
        return;
      }
      remoteSyncRetries += 1;
      if (remoteSyncRetries >= REMOTE_SYNC_MAX_ATTEMPTS) {
        setRemoteSyncBanner(
          T(
            'app.sync.keepsFailing',
            'Saved on this device, but the cloud backup keeps failing. Check your connection — it will try again after your next change.'
          )
        );
        remoteSyncRetries = 0;
        return;
      }
      // Looks transient — put the work back and back off before retrying.
      remoteSyncPending = Object.assign({}, payload, remoteSyncPending);
      delete remoteSyncPending.updatedAt;
      retryDelay = REMOTE_SYNC_RETRY_BASE_MS * Math.pow(2, remoteSyncRetries - 1);
    } finally {
      remoteSyncInFlight = false;
      // Never re-enter synchronously. The old code called flushRemoteSync()
      // straight from here, so a permanently failing write became an unbounded
      // hot loop — roughly one rejected round trip per second, forever.
      if (retryDelay > 0 || Object.keys(remoteSyncPending).length) {
        if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
        remoteSyncTimer = setTimeout(flushRemoteSync, retryDelay || 500);
      }
    }
  }

  /**
   * Move any inline base64 photos on existing plants and entries into Storage.
   *
   * Runs once per session after sign-in. Existing journals predate Storage and
   * carry their photos inline; on an account that has already crossed the 1 MiB
   * document limit this is what brings it back under and lets cloud backup
   * resume, so it deliberately runs even while the sync is blocked.
   *
   * Failures are non-fatal — records keep their inline photo and the next
   * session tries again.
   */
  async function migrateInlinePhotos() {
    if (inlinePhotoMigrationRun) return;
    if (!window.JournalPhotos || !window.JournalPhotos.available()) return;
    inlinePhotoMigrationRun = true;
    try {
      const plants = getPlants();
      const entries = getEntries();
      const inline = (list) =>
        (list || []).filter((r) => r && window.JournalPhotos.isDataUrl(r.photo)).length;
      if (!inline(plants) && !inline(entries)) return;

      const plantRes = await window.JournalPhotos.migrateRecords(plants, 'plant');
      if (plantRes.moved) setPlants(plants);

      const entryRes = await window.JournalPhotos.migrateRecords(entries, 'entry');
      if (entryRes.moved) setEntries(entries);

      const moved = plantRes.moved + entryRes.moved;
      const failed = plantRes.failed + entryRes.failed;
      const freedKb = Math.round((plantRes.bytesFreed + entryRes.bytesFreed) / 1024);
      if (moved) {
        // i18n-ignore — console diagnostics for the photo migration pass.
        console.log(
          'Moved ' + moved + ' inline photo(s) to Storage, freeing ~' + freedKb + ' KB'
        );
        // The journal is smaller now, so a previously oversized sync can work.
        scheduleRemoteSync({
          plants: plantsForRemoteSync(getPlants()),
          entries: entriesForRemoteSync(getEntries()),
        });
      }
      // i18n-ignore — console diagnostic.
      if (failed) console.warn(failed + ' photo(s) could not be moved to Storage');
    } catch (err) {
      console.warn('Inline photo migration failed', err);
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
        journalSkill:
          data.journalSkill && typeof data.journalSkill === 'object' ? data.journalSkill : null,
        coachProfile:
          data.coachProfile && typeof data.coachProfile === 'object' ? data.coachProfile : null,
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
    plantsSurfaceDirty = true;
    if (state.journalSkill && typeof state.journalSkill === 'object') {
      try {
        localStorage.setItem('dnevnik-live-journal-skill', JSON.stringify(state.journalSkill));
      } catch {
        // ignore
      }
    }
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
      return new Date(iso).toLocaleString(intlTag(), {
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
      const label = dt.toLocaleDateString(intlTag(), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      if (dayKey === today) return T('app.report.todayPrefix', 'Today · {date}', { date: label });
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
      Array.isArray(g.plantIds) && g.plantIds.length > 0
        ? T('app.admin.plantCount', '{count} plants', { count: g.plantIds.length })
        : T('app.admin.allPlants', 'All plants');
    const parts = [`<span class="admin-grant-badge admin-grant-badge--plants">🌱 ${escapeHtml(plantCount)}</span>`];
    if (g.shareEntries !== false) {
      parts.push(
        '<span class="admin-grant-badge admin-grant-badge--journal">📓 ' +
          escapeHtml(T('common.nav.journal', 'Journal')) +
          '</span>'
      );
    }
    if (g.shareToolbox) {
      parts.push(
        '<span class="admin-grant-badge admin-grant-badge--toolbox">🧰 ' +
          escapeHtml(T('app.admin.tools', 'Tools')) +
          '</span>'
      );
    }
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
    panel.innerHTML =
      '<p class="admin-empty-state admin-loading-state">' +
      escapeHtml(T('app.admin.loadingReport', 'Loading report…')) +
      '</p>';

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
    const loginsLabel =
      adminReportPeriod === 'daily'
        ? T('app.admin.loginsToday', 'Logins today')
        : T('app.admin.loginsWeek', 'Logins in the last 7 days');

    const summaryHtml =
      '<div class="admin-report-summary">' +
      `<div class="admin-report-stat admin-report-stat--logins"><strong>${filteredEvents.length}</strong><span>${escapeHtml(loginsLabel)}</span></div>` +
      `<div class="admin-report-stat admin-report-stat--users"><strong>${uniqueUsers.size}</strong><span>${escapeHtml(T('app.admin.uniqueUsers', 'Unique users'))}</span></div>` +
      `<div class="admin-report-stat admin-report-stat--total"><strong>${summary.length}</strong><span>${escapeHtml(T('app.admin.inSummary', 'In summary'))}</span></div>` +
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
      : '<tr><td colspan="4" class="admin-empty-state">' +
        escapeHtml(T('app.admin.noLogins', 'No logins in the selected period.')) +
        '</td></tr>';

    const usersTableHtml =
      '<div class="admin-report-block">' +
      '<h4 class="admin-subheading">' +
      escapeHtml(T('app.admin.summaryByUser', 'Summary by user')) +
      '</h4>' +
      '<div class="admin-report-table-wrap"><table class="admin-report-table">' +
      '<thead><tr>' +
      '<th>' + escapeHtml(T('app.admin.colEmail', 'Email')) + '</th>' +
      '<th>' + escapeHtml(T('app.admin.colRole', 'Role')) + '</th>' +
      '<th>' + escapeHtml(T('app.admin.colLogins', 'Logins')) + '</th>' +
      '<th>' + escapeHtml(T('app.admin.colLastLogin', 'Last login')) + '</th>' +
      '</tr></thead>' +
      `<tbody>${usersTableRows}</tbody></table></div></div>`;

    let detailHtml = '<div class="admin-report-block admin-report-block--detail">';
    detailHtml +=
      '<h4 class="admin-subheading">' +
      escapeHtml(T('app.admin.individualLogins', 'Individual logins')) +
      '</h4>';
    if (!filteredEvents.length) {
      detailHtml +=
        '<p class="admin-empty-state">' +
        escapeHtml(
          T(
            'app.admin.noRecorded',
            'No recorded logins for this period. Logins are tracked from the next user sign-in.'
          )
        ) +
        '</p>';
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

  async function ensureViewerBootstrapGrant() {
    // Grants are created only by the owner or superadmin (firestore.rules).
    // Hybrid emails wait for the sharing panel — viewers must not self-grant.
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
      'Hybrid user loaded:', // i18n-ignore — console diagnostic.
      (localMerged.plants || []).length,
      'own +',
      sharedPlants.length,
      'shared plants'
    );
  }

  function paperNote(opts) {
    const title = (opts && opts.title) || T('app.readOnly.title', 'Read-only');
    const body = (opts && opts.body) || '';
    if (window.AppConfirm && typeof AppConfirm.note === 'function') {
      AppConfirm.note({ title: title, body: body });
      return;
    }
    alert((title ? title + '\n\n' : '') + body);
  }

  function blockWrite(opts) {
    const plantId = opts && opts.plantId;
    const entryId = opts && opts.entryId;
    if (isAdminReadOnly) {
      paperNote({
        body:
          readOnlyBannerMessage ||
          T('app.readOnly.generic', 'View is read-only — editing is not allowed.'),
      });
      return true;
    }
    if (plantId && isSharedPlantId(plantId)) {
      paperNote({
        body: T(
          'app.readOnly.sharedPlant',
          'This plant comes from the superadmin shared library — you can view it, but not edit it.'
        ),
      });
      return true;
    }
    if (entryId && isSharedEntryId(entryId)) {
      paperNote({
        body: T(
          'app.readOnly.sharedEntry',
          'This entry comes from a shared library — it cannot be edited.'
        ),
      });
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
      T(
        'app.readOnly.hybrid',
        'You can edit your own plants and entries. Plants from the superadmin shared library are view-only.'
      );
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
      T(
        'app.readOnly.database',
        'Read-only database view — plants, journal and tools without editing.'
      );
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
    panel.innerHTML =
      '<p class="admin-empty-state admin-loading-state">' +
      escapeHtml(T('app.blog.loading', 'Loading…')) +
      '</p>';

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
      : '<p class="admin-empty-state">' +
        escapeHtml(
          T('app.admin.noPlantsInDb', 'You have no plants in the database — add them in Plants & journal.')
        ) +
        '</p>';

    const grantsHtml = grants.length
      ? grants
          .map((g) => {
            const email = g.viewerEmail || g.viewerUid || g.id;
            return (
              `<article class="admin-grant-card" data-viewer="${escapeHtml(g.viewerUid || g.id)}">` +
              '<div class="admin-grant-card-head">' +
              `<div class="admin-grant-user"><span class="admin-grant-avatar" aria-hidden="true">${escapeHtml((email[0] || '?').toUpperCase())}</span>` +
              `<strong class="admin-grant-email">${escapeHtml(email)}</strong></div>` +
              '<button type="button" class="btn btn-ghost btn-sm btn-revoke-grant">' +
              escapeHtml(T('app.admin.remove', 'Remove')) +
              '</button></div>' +
              `<div class="admin-grant-badges">${adminGrantBadgesHtml(g)}</div></article>`
            );
          })
          .join('')
      : '<p class="admin-empty-state">' +
        escapeHtml(T('app.admin.noAccessYet', 'No access granted yet.')) +
        '</p>';

    panel.innerHTML =
      '<div class="admin-sharing-layout">' +
      '<div class="admin-sharing-form-card">' +
      '<h4 class="admin-subheading">' +
      escapeHtml(T('app.admin.newAccess', 'New access')) +
      '</h4>' +
      '<form id="form-sharing-grant" class="admin-sharing-form">' +
      '<label class="admin-field"><span class="admin-field-label">' +
      escapeHtml(T('app.admin.user', 'User')) +
      '</span>' +
      '<select id="share-viewer-user" class="admin-field-input" required><option value="">' +
      escapeHtml(T('app.admin.selectUser', '— select a user —')) +
      '</option>' +
      userOptions +
      '</select></label>' +
      '<fieldset class="admin-sharing-plants-fieldset">' +
      '<legend class="admin-field-label">' +
      escapeHtml(T('app.stack.plants', 'Plants')) +
      '</legend>' +
      '<label class="admin-toggle-tile admin-toggle-tile--wide">' +
      '<input type="checkbox" id="share-all-plants" checked />' +
      '<span><strong>' +
      escapeHtml(T('app.admin.allPlants', 'All plants')) +
      '</strong><small>' +
      escapeHtml(T('app.admin.allPlantsHint', 'View the entire plant database')) +
      '</small></span></label>' +
      '<div id="share-plants-list" class="admin-plants-pick-list" hidden>' +
      plantChecks +
      '</div></fieldset>' +
      '<div class="admin-toggle-row">' +
      '<label class="admin-toggle-tile">' +
      '<input type="checkbox" id="share-entries" checked />' +
      '<span><strong>' +
      escapeHtml(T('common.nav.journal', 'Journal')) +
      '</strong><small>' +
      escapeHtml(T('app.admin.journalHint', 'Notes and entries')) +
      '</small></span></label>' +
      '<label class="admin-toggle-tile">' +
      '<input type="checkbox" id="share-toolbox" />' +
      '<span><strong>' +
      escapeHtml(T('app.admin.tools', 'Tools')) +
      '</strong><small>' +
      escapeHtml(T('app.admin.toolsHint', 'Data from Tools')) +
      '</small></span></label>' +
      '</div>' +
      '<button type="submit" class="btn btn-primary admin-sharing-submit">' +
      escapeHtml(T('app.admin.saveAccess', 'Save access')) +
      '</button>' +
      '</form></div>' +
      '<div class="admin-sharing-grants-card">' +
      '<h4 class="admin-subheading">' +
      escapeHtml(T('app.admin.activeAccess', 'Active access')) +
      ' <span class="admin-count-badge">' +
      grants.length +
      '</span></h4>' +
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
        alert(
        T('app.admin.needPlantSelection', 'Select at least one plant or enable "All plants".')
      );
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
        alert(T('app.admin.accessSaved', 'Access saved.'));
      } catch (err) {
        console.error(err);
        alert(T('app.admin.saveFailed', 'Saving failed. Check your Firestore rules.'));
      }
    });

    panel.querySelectorAll('.btn-revoke-grant').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.admin-grant-card');
        const viewerUid = row && row.dataset.viewer;
        if (!viewerUid || !confirm(T('app.admin.confirmRevoke', 'Remove access for this user?'))) {
      return;
    }
        try {
          await deleteSharedGrant(ownerUid, viewerUid);
          await renderSuperadminSharingPanel();
        } catch (err) {
          alert(T('app.admin.removeFailed', 'Removal failed.'));
        }
      });
    });
  }

  function refreshAllViewsAfterRemoteLoad() {
    try {
      if (typeof fillEntryPlantSelect === 'function') fillEntryPlantSelect();
      if (typeof fillJournalPlantFilter === 'function') fillJournalPlantFilter();
      if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
      if (currentGrowlogPlantId && typeof renderGrowlog === 'function') {
        renderGrowlog(currentGrowlogPlantId);
      }
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
    if (data.profilePhoto) {
      localStorage.setItem('dnevnik-live-profile-photo', String(data.profilePhoto));
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
  /* Called at render time, so T() is safe here — unlike the parse-time tables
     elsewhere in this file. */
  const intent = getAdopterIntent();
  if (intent === 'collect_garden') {
    return {
      hero: T('app.intent.collect.hero', 'Collect adopted plants and follow each growth stage in your garden.'),
      empty: T('app.intent.collect.empty', 'Browse the market to adopt your first plant and grow your collection.'),
      market: T('app.intent.collect.market', 'Find open plant offers and back them with $GROWTOO when you’re ready.'),
      strip: T('app.intent.collect.strip', 'Claim test $GROWTOO, browse the market, and collect your first plant.'),
      label: T('app.intent.collect.label', 'Collect a garden'),
    };
  }
  if (intent === 'earn_rewards') {
    return {
      hero: T('app.intent.earn.hero', 'Practice stakes and harvest unlocks on test assets — no monetary value.'),
      empty: T('app.intent.earn.empty', 'Back an open offer to start following growth and harvest care on the test network.'),
      market: T('app.intent.earn.market', 'Invest test $GROWTOO in grower asks — follow monthly unlock progress toward harvest.'),
      strip: T('app.intent.earn.strip', 'Claim test $GROWTOO, stake on a live offer, then watch monthly unlock in My garden.'),
      label: T('app.intent.earn.label', 'Practice stakes'),
    };
  }
  return {
    hero: T('app.intent.support.hero', 'Follow a real plant’s journal trail. Backing with $GROWTOO is optional.'),
    empty: T('app.intent.support.empty', 'Browse the market and back a grow with $GROWTOO when you are ready.'),
    market: T('app.intent.support.market', 'Invest $GROWTOO to adopt a grower’s plant token. Connect your wallet when you tap Invest.'),
    strip: T('app.intent.support.strip', 'Claim test $GROWTOO, then invest in a live plant offer.'),
    label: T('app.intent.support.label', 'Support growers'),
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

  function readProfilePhoto() {
    try {
      return String(localStorage.getItem('dnevnik-live-profile-photo') || '').trim();
    } catch {
      return '';
    }
  }

  function writeProfilePhotoLocal(url) {
    try {
      if (url) localStorage.setItem('dnevnik-live-profile-photo', String(url));
      else localStorage.removeItem('dnevnik-live-profile-photo');
    } catch {
      /* ignore */
    }
  }

  function applyHeaderAvatar() {
    const avatarMark = document.querySelector('#btn-account .header-avatar-mark');
    if (!avatarMark) return;
    const photo = readProfilePhoto();
    const type = getProfileType();
    if (photo && (photo.indexOf('data:image/') === 0 || /^https?:\/\//i.test(photo))) {
      avatarMark.innerHTML =
        '<img class="header-avatar-img" src="' +
        String(photo).replace(/"/g, '&quot;') +
        '" alt="" />';
      avatarMark.classList.add('header-avatar-mark--photo');
    } else {
      avatarMark.textContent = type === PROFILE_TYPES.adopter ? 'A' : 'G';
      avatarMark.classList.remove('header-avatar-mark--photo');
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
  const name =
    readDisplayName() ||
    (email ? email.split('@')[0] : '') ||
    T('app.account.member', 'growtoo member');
  const mark = adopter ? 'A' : 'G';
  const roleLabel = adopter
    ? T('app.role.adopter', 'Adopter')
    : T('app.role.grower', 'Grower');
  const profilePhoto = readProfilePhoto();
  const avatarHtml = profilePhoto
    ? '<img class="account-profile-avatar-img" src="' +
      esc(profilePhoto) +
      '" alt="" />'
    : esc(mark);

  let wallet = '';
  try {
    if (window.WalletLink && typeof WalletLink.getProfile === 'function') {
      wallet = String((WalletLink.getProfile() || {}).solanaPubkey || '');
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
        if (w.growthBalance != null) growBal = Number(w.growthBalance).toLocaleString(intlTag());
      }
    } catch {
      /* ignore */
    }
    metaRows =
      '<div class="account-profile-row"><span>' +
      esc(T('app.account.focus', 'Focus')) +
      '</span><strong>' +
      esc(intentCopy.label || T('app.intent.support.label', 'Support growers')) +
      '</strong></div>' +
      '<div class="account-profile-row"><span>' +
      esc(T('app.account.wallet', 'Wallet')) +
      '</span><strong>' +
      esc(wallet ? shortWalletAddr(wallet) : T('app.account.notLinked', 'Not linked')) +
      '</strong></div>';
    statsHtml =
      '<div class="account-profile-stats">' +
      '<div class="account-profile-stat"><span>' +
      esc(T('app.account.adopted', 'Adopted')) +
      '</span><strong>' +
      esc(String(adopted)) +
      '</strong></div>' +
      // i18n-ignore — ticker symbol.
      '<div class="account-profile-stat"><span>$GROWTOO</span><strong>' +
      esc(String(growBal)) +
      '</strong></div>' +
      '</div>';
  } else {
    const setup =
      getPreferredGrowEnvironment() === 'outdoor'
        ? T('app.account.outdoor', 'Outdoor')
        : T('app.account.indoor', 'Indoor');
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
      '<div class="account-profile-row"><span>' +
      esc(T('app.account.setup', 'Setup')) +
      '</span><strong>' +
      esc(setup + (city ? ' · ' + city : '')) +
      '</strong></div>' +
      '<div class="account-profile-row"><span>' +
      esc(T('app.account.wallet', 'Wallet')) +
      '</span><strong>' +
      esc(wallet ? shortWalletAddr(wallet) : T('app.account.notLinked', 'Not linked')) +
      '</strong></div>';
    statsHtml =
      '<div class="account-profile-stats">' +
      '<div class="account-profile-stat"><span>' +
      esc(T('app.stack.plants', 'Plants')) +
      '</span><strong>' +
      esc(String(plantCount)) +
      '</strong></div>' +
      '<div class="account-profile-stat"><span>' +
      esc(T('app.account.rankXp', 'Rank · XP')) +
      '</span><strong>' +
      esc(rankLabel + (xp !== '—' ? ' · ' + xp : '')) +
      '</strong></div>' +
      '</div>';
  }

  el.hidden = false;
  el.innerHTML =
    '<div class="account-profile-top">' +
    '<div class="account-profile-avatar' +
    (profilePhoto ? ' account-profile-avatar--photo' : '') +
    '" aria-hidden="true">' +
    avatarHtml +
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
    (!adopter
      ? '<div class="account-profile-logo-edit">' +
        '<label class="account-logo-label" for="account-profile-photo-input">' +
      esc(T('app.account.updateLogo', 'Update logo / photo')) +
      '</label>' +
        '<input id="account-profile-photo-input" type="file" accept="image/jpeg,image/png,image/webp,image/*" />' +
        (profilePhoto
          ? '<button type="button" class="btn btn-ghost btn-sm" id="account-profile-photo-clear">' +
            esc(T('app.account.removePhoto', 'Remove photo')) +
            '</button>'
          : '') +
        '<p class="account-profile-logo-hint" id="account-profile-photo-status" hidden></p>' +
        '</div>'
      : '') +
    (!isCurrentEmailVerified()
      ? '<div class="account-profile-verify" id="account-profile-verify">' +
        '<p>' +
      esc(
        T(
          'app.account.notVerified',
          'Email not verified yet — live AI coach stays on local helpers until you confirm.'
        )
      ) +
      '</p>' +
        '<p class="account-profile-verify-hint">' +
        T(
          'app.account.verifyHint',
          'Look for <em>Verify your email · growtoo</em> (also check Spam / Promotions).'
        ) +
        '</p>' +
        '<div class="account-profile-actions account-profile-verify-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" id="account-resend-verify">' +
      esc(T('app.account.resendVerify', 'Resend verification')) +
      '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="account-refresh-verify">' +
        esc(T('app.account.alreadyConfirmed', 'I already verified')) +
        '</button>' +
        '</div>' +
        '<p class="account-profile-verify-status" id="account-verify-status" hidden></p>' +
        '</div>'
      : '') +
    '<div class="account-profile-meta">' +
    metaRows +
    '</div>' +
    statsHtml +
    '<div class="account-profile-actions">' +
    '<button type="button" class="btn btn-ghost btn-sm" id="account-profile-tour">' +
    esc(T('app.account.replayTour', 'Replay tour')) +
    '</button>' +
    '<button type="button" class="btn btn-primary btn-sm" id="account-profile-primary">' +
    esc(
      adopter
        ? T('app.market.ctaOpenMarket', 'Open market')
        : T('common.cta.openJournal', 'Open the journal')
    ) +
    '</button>' +
    '</div>' +
    '<div id="account-public-profile-slot"></div>';

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

  if (!adopter && window.GrowerBlog && typeof GrowerBlog.publicProfileFieldsHtml === 'function') {
    const slot = document.getElementById('account-public-profile-slot');
    const fillPublic = async function () {
      let profile = {};
      try {
        const uid =
          window.firebase && firebase.auth && firebase.auth().currentUser
            ? firebase.auth().currentUser.uid
            : '';
        if (uid) {
          const snap = await firebase.firestore().collection('users').doc(uid).get();
          if (snap.exists) profile = snap.data() || {};
        }
      } catch (_) {
        profile = {};
      }
      if (slot) {
        slot.innerHTML = GrowerBlog.publicProfileFieldsHtml(profile);
        if (typeof GrowerBlog.bindPublicProfileActions === 'function') {
          GrowerBlog.bindPublicProfileActions();
        }
      }
    };
    fillPublic();
  }

  async function resizeAccountPhoto(dataUrl) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        const max = 320;
        let w = img.width;
        let h = img.height;
        if (w > max || h > max) {
          const scale = max / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = function () {
        resolve('');
      };
      img.src = dataUrl;
    });
  }

  async function persistProfilePhoto(dataUrl) {
    writeProfilePhotoLocal(dataUrl || '');
    applyHeaderAvatar();
    const uid =
      (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) ||
      null;
    if (!uid || !window.firebase || !firebase.firestore) return;
    await firebase
      .firestore()
      .collection('users')
      .doc(uid)
      .set(
        dataUrl
          ? { profilePhoto: dataUrl, updatedAt: new Date().toISOString() }
          : { profilePhoto: firebase.firestore.FieldValue.delete(), updatedAt: new Date().toISOString() },
        { merge: true }
      );
  }

  const photoInput = document.getElementById('account-profile-photo-input');
  const photoStatus = document.getElementById('account-profile-photo-status');
  if (photoInput) {
    photoInput.addEventListener('change', async function () {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      if (photoStatus) {
        photoStatus.hidden = false;
        photoStatus.textContent = T('app.account.uploading', 'Uploading…');
      }
      try {
        const raw = await new Promise(function (resolve, reject) {
          const reader = new FileReader();
          reader.onload = function () {
            resolve(String(reader.result || ''));
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const resized = await resizeAccountPhoto(raw);
        if (!resized || resized.indexOf('data:image/') !== 0 || resized.length > 220000) {
          throw new Error(T('app.account.imageBad', 'Image too large or unreadable.'));
        }
        await persistProfilePhoto(resized);
        if (photoStatus) photoStatus.textContent = T('app.account.logoSaved', 'Logo saved.');
        renderAccountProfile();
      } catch (err) {
        if (photoStatus) {
          photoStatus.hidden = false;
          photoStatus.textContent =
          (err && err.message) || T('app.account.photoFailed', 'Could not save photo.');
        }
      }
    });
  }
  const photoClear = document.getElementById('account-profile-photo-clear');
  if (photoClear) {
    photoClear.addEventListener('click', async function () {
      try {
        await persistProfilePhoto('');
        renderAccountProfile();
      } catch {
        /* ignore */
      }
    });
  }

  const verifyStatus = document.getElementById('account-verify-status');
  function setVerifyStatus(msg, isError) {
    if (!verifyStatus) return;
    verifyStatus.hidden = !msg;
    verifyStatus.textContent = msg || '';
    verifyStatus.classList.toggle('is-error', !!isError);
  }
  const resendBtn = document.getElementById('account-resend-verify');
  if (resendBtn) {
    resendBtn.addEventListener('click', async function () {
      resendBtn.disabled = true;
      setVerifyStatus(T('app.account.sending', 'Sending…'));
      try {
        const result = await resendVerificationEmail();
        if (result && result.already) {
          setVerifyStatus(T('app.account.alreadyVerified', 'Already verified — refreshing…'));
          renderAccountProfile();
          return;
        }
        setVerifyStatus(
          T(
            'app.account.sentTo',
            'Sent to {email}. Check inbox and Spam for “Verify your email · growtoo”.',
            { email: result.email || email || T('app.account.yourInbox', 'your inbox') }
          )
        );
      } catch (err) {
        const code = err && err.code;
        if (code === 'auth/too-many-requests') {
          setVerifyStatus(
            T('app.account.tooManySends', 'Too many sends — wait a few minutes, then try again.'),
            true
          );
        } else {
          setVerifyStatus(
            (err && err.message) ||
              T('app.account.verifySendFailed', 'Could not send verification email.'),
            true
          );
        }
      } finally {
        resendBtn.disabled = false;
      }
    });
  }
  const refreshVerifyBtn = document.getElementById('account-refresh-verify');
  if (refreshVerifyBtn) {
    refreshVerifyBtn.addEventListener('click', async function () {
      refreshVerifyBtn.disabled = true;
      setVerifyStatus(T('app.account.checking', 'Checking…'));
      try {
        const ok = await refreshEmailVerifiedStatus();
        if (ok) {
          setVerifyStatus(T('app.account.verified', 'Email verified — live coach unlocked.'));
          renderAccountProfile();
        } else {
          setVerifyStatus(
            T(
            'app.account.stillUnverified',
            'Still unverified. Open the link in the growtoo email, then tap again.'
          ),
            true
          );
        }
      } catch (err) {
        setVerifyStatus(
          (err && err.message) ||
            T('app.account.refreshFailed', 'Could not refresh verification status.'),
          true
        );
      } finally {
        refreshVerifyBtn.disabled = false;
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
          title: T('app.unlock.title', 'Unlock Tokenise & Market?'),
          body:
            T(
          'app.unlock.body',
          'This adds optional on-chain tools: seal stages on Devnet and list asks. Your journal stays free and works without a wallet.'
        ),
          confirmLabel: T('app.unlock.confirm', 'Unlock'),
          cancelLabel: T('app.unlock.cancel', 'Not now'),
        })
      : window.confirm(
          T(
          'app.unlock.fallback',
          'Unlock Tokenise & Market?\n\nOptional on-chain tools. Your journal stays free without a wallet.'
        )
        );
  if (!ok) return false;
  unlockChainPath(nextView || 'adopt');
  return true;
}

/**
 * Labels that depend on the profile role, kept in the reader's language.
 *
 * The role decides which of two keys an element shows, so this cannot be a
 * plain data-i18n attribute in the markup. It stamps the chosen key onto the
 * element, which lets a later language switch keep it right, and it re-runs
 * once the dictionary lands: app boot regularly wins the race against that
 * fetch, and without the re-run these labels would stay English for the rest
 * of the session.
 */
function roleKey(type) {
  return type === PROFILE_TYPES.adopter ? 'app.role.adopter' : 'app.role.grower';
}

function applyRoleLabels(type) {
  const adopter = type === PROFILE_TYPES.adopter;
  document.querySelectorAll('[data-label-grower][data-label-adopter]').forEach((el) => {
    const label = adopter ? el.dataset.labelAdopter : el.dataset.labelGrower;
    const key = adopter ? el.dataset.labelAdopterKey : el.dataset.labelGrowerKey;
    if (!label) return;
    if (key) el.setAttribute('data-i18n', key);
    el.textContent = key ? T(key, label) : label;
  });
}

/* App boot regularly beats the dictionary fetch, and copy written by JS is
   not reachable by I18N.apply(). Re-run the pieces that paint text from code
   once the dictionary lands, so nothing stays stuck in English. */
document.addEventListener('i18n:ready', function () {
  if (currentProfileType) applyProfileTypeUI(currentProfileType);
  if (currentShownView) refreshViewTitle(currentShownView);
  /* The account panel paints its rows from code too, so it needs the same
     second pass — its labels are not reachable by I18N.apply(). */
  try {
    if (typeof renderAccountProfile === 'function') renderAccountProfile();
  } catch (e) {
    /* a panel that is not mounted yet will render in the reader's language
       when it opens; nothing to do here */
  }
});

function applyProfileTypeUI(profileType) {
  const type = normalizeProfileType(profileType) || PROFILE_TYPES.grower;
  currentProfileType = type;
  document.body.classList.remove('profile-grower', 'profile-adopter');
  document.body.classList.add(type === PROFILE_TYPES.adopter ? 'profile-adopter' : 'profile-grower');
  document.body.dataset.profileType = type;

  applyRoleLabels(type);

  const badge = document.getElementById('profile-type-badge');
  if (badge) {
    badge.setAttribute('data-i18n', roleKey(type));
    badge.textContent = T(roleKey(type), type === PROFILE_TYPES.adopter ? 'Adopter' : 'Grower');
    badge.hidden = false;
    badge.className =
      'profile-type-badge profile-type-badge--' +
      (type === PROFILE_TYPES.adopter ? 'adopter' : 'grower');
  }

  const avatarMark = document.querySelector('#btn-account .header-avatar-mark');
  if (avatarMark) {
    applyHeaderAvatar();
  }

  const title = document.querySelector('title');
  if (title) {
    title.textContent =
      type === PROFILE_TYPES.adopter
        ? T('app.docTitle.adopter', 'growtoo – Adopt & track')
        : T('app.docTitle.grower', 'growtoo – Grow journal');
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
  /* Profile always has Settings, so the account control stays. */
}

function defaultViewForProfile() {
  return isAdopterProfile() ? 'adopt' : 'plants';
}

function isViewAllowedForProfile(viewId) {
  if (!viewId) return false;
  if (viewId === 'admin') return isAdminPanelRole(currentUserRole);
  if (viewId === 'growlog') return isGrowerProfile();
  if (['plants', 'toolbox', 'danas', 'blog'].includes(viewId)) return isGrowerProfile();
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

 
  // These start `hidden` in the markup so they fail closed before this runs.
  const showAdmin = isAdminPanelRole(role);
  const showSuper = isSuperadminRole(role);
  adminEls.forEach((el) => (el.hidden = !showAdmin));
  superEls.forEach((el) => (el.hidden = !showSuper));

  applySoilMoistureToolUI(role);

  const superHub = document.getElementById('admin-super-hub');
  if (superHub) {
    superHub.hidden = !showSuper;
    superHub.setAttribute('aria-hidden', String(!showSuper));
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

/** Admin UI only for allowlisted emails — grower/adopter accounts never get the panel. */
function isAdminPanelRole(role, email) {
  const r = normalizeUserRole(role);
  if (r !== 'admin' && r !== 'superadmin') return false;
  const addr =
    email != null && String(email).trim() !== '' ? email : getCurrentUserEmail();
  return isAllowedAdminEmail(addr);
}

function isSuperadminRole(role, email) {
  if (normalizeUserRole(role) !== 'superadmin') return false;
  const addr =
    email != null && String(email).trim() !== '' ? email : getCurrentUserEmail();
  return isAllowedAdminEmail(addr);
}

function privilegeRoleForEmail(role, email) {
  const r = normalizeUserRole(role);
  if ((r === 'admin' || r === 'superadmin') && !isAllowedAdminEmail(email)) {
    return 'user';
  }
  return r;
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

  // Strip admin/superadmin from any account that is not on the allowlist
  // (e.g. a grower whose Firestore role was set incorrectly).
  return privilegeRoleForEmail(data.role || 'user', user.email);
}

function getInitialViewFromUrl() {
  try {
    const view = new URLSearchParams(window.location.search).get('view');
    if (view === 'dashboard' || view === 'danas') return 'plants';
    return view;
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

      currentUserRole = await getCurrentUserRole(user);
      applyRoleUI(currentUserRole);

      function bootVisibleView() {
        const initialView = getInitialViewFromUrl();
        if (initialView && isViewAllowedForProfile(initialView)) return initialView;
        return defaultViewForProfile();
      }

      // Last-session plants/entries are already in localStorage — show them
      // before wallet + cloud state finish, so the splash is not the wait.
      try {
        if (typeof showView === 'function') showView(bootVisibleView());
      } catch (_) {
        /* showView may not be bound on a partial boot */
      }
      finishAppLoading();

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
      // Bind once — auth can re-fire and would otherwise stack listeners (crash loop).
      if (!window.__dnevnikWalletUiBound) {
        window.__dnevnikWalletUiBound = true;
        let dashTimer = null;
        function scheduleDashboardRefresh() {
          if (dashTimer) clearTimeout(dashTimer);
          dashTimer = setTimeout(function () {
            try {
              if (typeof renderTodayAndSeals === 'function') {
                renderTodayAndSeals(getPlants(), getEntries());
              }
              if (typeof renderCoachBriefingSurfaces === 'function') {
                renderCoachBriefingSurfaces();
              }
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
      await recordUserLogin(user, currentUserRole);

      if (currentUserRole === 'admin') {
        isAdminReadOnly = true;
        remoteSyncReady = false;
        await loadSuperadminDatabaseForAdmin();
        applyAdminReadOnlyUI(
          T(
          'app.readOnly.wholeDb',
          'Read-only view of the entire superadmin database — plants cannot be edited.'
        )
        );
      } else if (currentUserRole === 'viewer') {
        isAdminReadOnly = true;
        remoteSyncReady = false;
        await ensureViewerBootstrapGrant(user.uid, user.email || '');
        await loadSharedDatabaseForViewer(user.uid, user.email || '');
        applyAdminReadOnlyUI(
          T('app.readOnly.sharedPlants', 'Read-only view of shared plants — editing is not allowed.')
        );
      } else {
        isAdminReadOnly = false;
        document.body.classList.remove('admin-readonly');
        const userEmail = user.email || '';
        if (isSharedHybridUser(userEmail)) {
          await loadHybridUserWithSharedReadOnly(user.uid, userEmail);
          applySharedLibraryBanner(
            T(
          'app.readOnly.hybridPlants',
          'You can add and edit your own plants and entries. Plants from the superadmin shared library are view-only.'
        )
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
          // Journals written before photos moved to Storage still carry inline
          // base64 images, which is what pushes the document over the 1 MiB
          // limit. Lift them out in the background so backup can resume.
          migrateInlinePhotos();
        }
        if (!remoteSyncReady) remoteSyncReady = true;
      }

      refreshAllViewsAfterRemoteLoad();
      if (typeof showView === 'function') {
        showView(bootVisibleView(), null, { force: true });
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













  /* Stage slugs are Croatian in storage (they are data keys, never shown).
     The English here is the fallback; STAGE_KEYS maps each slug to its
     dictionary key, resolved by stageName() at render time. */
  const STAGES = {
    klijanje: 'Germination', // i18n-ignore
    sadnica: 'Seedling', // i18n-ignore
    vegetativna: 'Vegetative', // i18n-ignore
    cvjetanje: 'Flowering', // i18n-ignore
    susenje: 'Drying', // i18n-ignore
  };

  const STAGE_KEYS = {
    klijanje: 'app.stage.germination',
    sadnica: 'app.stage.seedling',
    vegetativna: 'app.stage.vegetative',
    cvjetanje: 'app.stage.flowering',
    susenje: 'app.stage.dryingShort',
  };

  /** Translated stage name; falls through to the raw slug for odd values. */
  function stageName(key) {
    const en = STAGES[key];
    if (!en) return key || '';
    return T(STAGE_KEYS[key], en);
  }

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
    [SUBPHASE_FIELD]: 'In the field', // i18n-ignore
  };

  const SUBPHASE_KEYS = {
    pot_1_5dcl: 'app.pot.p15dcl',
    pot_5l: 'app.pot.p5l',
    pot_30l: 'app.pot.p30l',
    pot_10dcl: 'app.pot.p10dcl',
    pot_1_5l: 'app.pot.p15l',
    [SUBPHASE_FIELD]: 'app.pot.field',
  };

  /** Translated pot size / field label. Units differ per locale (1,5 vs 1.5). */
  function potName(key) {
    const en = SUBPHASE_POTS[key];
    if (!en) return key || '';
    return T(SUBPHASE_KEYS[key], en);
  }

  const SUBPHASE_ORDER = ['pot_1_5dcl', 'pot_5l', 'pot_30l'];

  function subphaseLabel(key) {
    if (!key) return '';
    return potName(key);
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
    zalijevanje: 'Watering', // i18n-ignore
    gnojidba: 'Feeding', // i18n-ignore
    okolis: 'Environment', // i18n-ignore
    presadjivanje: 'Transplanting', // i18n-ignore
    stresori: 'Stressors', // i18n-ignore
    ostalo: 'Other', // i18n-ignore
    faza: 'Stage (transition)', // i18n-ignore
    podfaza: 'Sub-phase (pot / field)', // i18n-ignore
  };

  const ENTRY_TYPE_KEYS = {
    opcenito: 'app.entryType.general',
    zalijevanje: 'app.entryType.watering',
    gnojidba: 'app.entryType.feeding',
    okolis: 'app.entryType.environment',
    presadjivanje: 'app.entryType.transplanting',
    stresori: 'app.entryType.stressors',
    ostalo: 'app.entryType.other',
    faza: 'app.entryType.stageTransition',
    podfaza: 'app.entryType.subphasePot',
  };

  /** Translated journal entry type. */
  function entryTypeName(key) {
    const en = ENTRY_TYPE_LABELS[key];
    if (!en) return key || T('app.entryType.general', 'General');
    return T(ENTRY_TYPE_KEYS[key], en);
  }

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
      escapeHtml(T('app.entry.viaTools', 'via Tools')) +
      '</span>'
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
      '<div class="entry-meta-block"><strong>' +
      escapeHtml(T('app.entry.measurement', 'Measurement')) +
      '</strong><p>' +
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
    plantsSurfaceDirty = true;
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
      plantsSurfaceDirty = true;
    } catch (err) {
      console.error('Failed to save journal entries locally', err);
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        DnevnikNotifications.toast(
          T(
          'app.entry.saveFullStorage',
          'Could not save journal entry (storage full or blocked). Try a shorter note or remove old photos.'
        ),
          'error'
        );
      } else {
        paperNote({
          title: T('app.entry.saveFailed', 'Could not save journal entry.'),
          body: T(
            'app.entry.saveFailedStorage',
            'Could not save journal entry. Local storage may be full.'
          ),
        });
      }
      return false;
    }

    const reread = readEntriesFromStorage();
    if (!Array.isArray(reread) || !entriesIdsMatch(list, reread)) {
      console.error('Journal write verification failed — re-read mismatch after setItem');
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        DnevnikNotifications.toast(
          T('app.entry.saveRetry', 'Entry did not save. Please try again.'),
          'error'
        );
      } else {
        paperNote({
          title: T('app.entry.saveFailed', 'Could not save journal entry.'),
          body: T('app.entry.saveRetry', 'Entry did not save. Please try again.'),
        });
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
        '<span class="dashboard-coach-brief-label">' +
      escapeHtml(T('app.coachBrief.label', 'Coach')) +
      '</span> ' +
        escapeHtml(briefing) +
        '</div>';
    }

    if (!reminders.length) {
      container.innerHTML =
        head +
        emptyStateHtml({
          icon: 'coach',
          lead: T('app.coachBrief.nothingUrgent', 'Nothing urgent'),
          body: T(
            'app.coachBrief.keepLogging',
            'Keep logging care — Coach uses your pace and the forecast for the next nudge.'
          ),
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
            escapeHtml(String(r.title || T('app.coachBrief.reminder', 'Reminder'))) +
            '</span>' +
            '<span class="danas-desc">' +
            escapeHtml(String(r.message || '')) +
            '</span>' +
            '<div class="danas-actions">' +
            (canDraft
              ? '<button type="button" class="btn btn-primary btn-sm danas-draft-coach" data-coach-draft="' +
                escapeHtml(String(r.id || '')) +
                '">' +
      escapeHtml(T('app.coachBrief.draftLog', 'Draft log')) +
      '</button>'
              : '') +
            '<button type="button" class="link-btn danas-open-coach" data-coach-prompt="' +
            escapeHtml(String(r.prompt || '')) +
            '">' +
            escapeHtml(
        canDraft
          ? T('app.coachBrief.askFirst', 'Ask first')
          : T('app.coachBrief.openCoach', 'Open Coach')
      ) +
            '</button>' +
            '</div>' +
            '</div>' +
            '</label>'
          );
        })
        .join('');
  }

  // --- Navigation ---
  const navItems = document.querySelectorAll('.nav-item[data-view], .more-nav-item[data-view], .settings-tile[data-view]');
  const views = document.querySelectorAll('.view');
  const viewTitle = document.querySelector('.view-title');
  const logoutBtn = document.getElementById('btn-logout');
  const MORE_NAV_VIEWS = ['toolbox', 'admin'];
  /* [dictionary key, English] — resolved in viewTitle(), because this table
     is built while the page parses, before the dictionary lands. */
  const titles = {
    dashboard: ['common.nav.journal', 'Journal'],
    plants: ['common.nav.journal', 'Journal'],
    blog: ['app.nav.stories', 'Stories'],
    adopt: ['common.nav.tokenise', 'Tokenise'],
    market: ['common.nav.market', 'Market'],
    growlog: ['app.nav.growlog', 'Grow log'],
    toolbox: ['app.nav.measurements', 'Measurements'],
    admin: ['app.nav.admin', 'Admin Panel'],
    danas: ['app.nav.today', 'Today'],
  };

  function viewTitleFor(id) {
    const row = titles[id];
    return row ? T(row[0], row[1]) : '';
  }

  /** Paint the header title for a view, in the reader's language. */
  function refreshViewTitle(id) {
    /* Re-queried rather than reusing the module-level handle: this also runs
       from the i18n:ready hook, which can fire before that handle was set. */
    const el = document.querySelector('.view-title');
    if (!el) return;
    if (id === 'growlog') return; // shows the plant's own name
    if (id === 'adopt' && isAdopterProfile()) {
      el.textContent = T('app.nav.myGarden', 'My garden');
    } else if (id === 'adopt' && isGrowerProfile()) {
      el.textContent = T('common.nav.tokenise', 'Tokenise');
    } else if (titles[id]) {
      el.textContent = viewTitleFor(id);
    }
  }
  let lastChainView = null;
  let currentShownView = null;

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
  if (window.Market && typeof Market.onChange === 'function') {
    Market.onChange(function () {
      if (typeof renderActivityRewardCard === 'function') renderActivityRewardCard();
    });
  }

  function showView(id, extra, opts) {
    if (id === 'dashboard' || id === 'danas') id = 'plants';
    const force = !!(opts && opts.force);
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
    document.body.classList.add('journal-paper');
    if (id === 'growlog' && extra) {
      currentGrowlogPlantId = extra;
      const view = document.getElementById('view-growlog');
      if (view) view.classList.add('active');
      const plant = getPlants().find((p) => p.id === extra);
      if (viewTitle) viewTitle.textContent = plant ? plant.name : T('app.nav.growlog', 'Grow log');
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
      currentShownView = 'growlog';
      return;
    }
    currentGrowlogPlantId = null;
    const view = document.getElementById('view-' + id);
    document.querySelectorAll('.nav-item[data-view="' + id + '"], .more-nav-item[data-view="' + id + '"], .settings-tile[data-view="' + id + '"]').forEach((n) => n.classList.add('active'));
    if (id === 'adopt' || id === 'market') {
      lastChainView = id;
      document.querySelectorAll('[data-chain-nav]').forEach(function (n) {
        n.classList.add('active');
      });
      document.querySelectorAll('.chain-pane-toggle').forEach(function (seg) {
        seg.setAttribute('data-active', id);
        seg.querySelectorAll('[data-chain-pane]').forEach(function (btn) {
          const on = btn.getAttribute('data-chain-pane') === id;
          btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      });
    }
    const accountBtn = document.getElementById('btn-account');
    if (accountBtn) {
      accountBtn.classList.toggle('active', MORE_NAV_VIEWS.indexOf(id) !== -1);
    }
    setMoreNavOpen(false);
    setLogSheetOpen(false);
    if (view) view.classList.add('active');
    refreshViewTitle(id);

    const sameView =
      !force &&
      id !== 'growlog' &&
      currentShownView === id &&
      view &&
      view.classList.contains('active');
    currentShownView = id;
    if (sameView) return;

    if (id === 'plants') {
      initPlantsWeatherWidget();
      if (force || plantsSurfaceDirty) {
        renderCoachBriefingSurfaces();
        renderTodayAndSeals(getPlants(), getEntries());
        renderPlants();
        renderJournal();
        plantsSurfaceDirty = false;
      }
    }
    if (id === 'blog' && window.GrowerBlog && typeof GrowerBlog.render === 'function') {
      GrowerBlog.render();
    }
    if (id === 'adopt' && window.AdoptPlant) {
      if (typeof window.AdoptPlant.renderGlobalWalletUI === 'function') {
        window.AdoptPlant.renderGlobalWalletUI();
      }
      window.AdoptPlant.render();
    }
    if (id === 'market' && window.Market) {
      if (window.AdoptPlant && typeof window.AdoptPlant.renderGlobalWalletUI === 'function') {
        window.AdoptPlant.renderGlobalWalletUI();
      }
      window.Market.render();
    }
    if (id === 'toolbox') renderToolbox();
    if (id === 'admin' && isSuperadminRole(currentUserRole)) {
      renderSuperadminUserReport(adminReportPeriod);
      renderSuperadminSharingPanel();
    }
    if (window.AICoach && typeof window.AICoach.applyVisibility === 'function') {
      window.AICoach.applyVisibility();
    }
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

    if (item.hasAttribute('data-chain-nav')) {
      const fallback = isAdopterProfile() ? 'market' : 'adopt';
      const next =
        lastChainView === 'adopt' || lastChainView === 'market' ? lastChainView : fallback;
      showView(next);
      return;
    }

    if (view === "admin") {
      await resolveCurrentUserRole();
      if (!isAdminPanelRole(currentUserRole)) {
        alert(T('app.admin.accessDenied', 'Access denied — you do not have admin privileges.'));
        return;
      }
    }

    if (view !== "growlog") currentGrowlogPlantId = null;
    showView(view);
  });
});

  document.addEventListener('click', function (e) {
    const paneBtn = e.target.closest('[data-chain-pane]');
    if (!paneBtn) return;
    e.preventDefault();
    const pane = paneBtn.getAttribute('data-chain-pane');
    if (pane === 'adopt' || pane === 'market') showView(pane);
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
    if (!open) closeSettingsPanels();
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
      logSheetPendingDate = null;
    }
  }

  let logSheetSelectedPlantIds = [];
  let logSheetPendingAction = null; // 'water' | 'feed' | null
  let logSheetPendingDate = null; // YYYY-MM-DD when opened from the month calendar
  let logSheetExpandedStacks = Object.create(null);
  let entryModalPlantIds = null; // multi-select for full entry modal

  function loggablePlants() {
    return getPlants().filter((p) => p && p.id && !isSharedPlantId(p.id));
  }

  function normalizeSelectedPlantIds(ids, plants) {
    const allowed = Object.create(null);
    (plants || []).forEach(function (p) {
      if (p && p.id) allowed[String(p.id)] = true;
    });
    const out = [];
    const seen = Object.create(null);
    (ids || []).forEach(function (id) {
      const key = String(id || '');
      if (!key || !allowed[key] || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    return out;
  }

  function selectedLogPlantIds() {
    return logSheetSelectedPlantIds.slice();
  }

  function plantStackAccessors() {
    return {
      getStrain: function (p) {
        return p && p.strain;
      },
      getName: function (p) {
        return p && p.name;
      },
      getStage: function (p) {
        return p && p.stage;
      },
      getWeight: function (p) {
        return Math.max(1, Number((p && p.count) || 1) || 1);
      },
    };
  }

  function groupLoggablePlants(plants) {
    const Stacks = window.GrowtooStacks;
    if (!Stacks || typeof Stacks.groupItems !== 'function') {
      return (plants || []).map(function (p) {
        return {
          key: String(p.id),
          name: p.name || T('app.stack.plant', 'Plant'),
          strain: p.strain || '',
          stage: p.stage || '',
          size: Math.max(1, Number(p.count || 1) || 1),
          members: [p],
        };
      });
    }
    return Stacks.groupItems(plants, plantStackAccessors());
  }

  function logSheetPlantButtonHtml(p, specimenNo, selected) {
    return (
      '<button type="button" class="log-sheet-plant' +
      (selected ? ' is-selected' : '') +
      '" role="option" aria-selected="' +
      (selected ? 'true' : 'false') +
      '" data-plant-id="' +
      escapeHtml(p.id) +
      '">' +
      '<span class="log-sheet-plant-check" aria-hidden="true"></span>' +
      '<span class="log-sheet-plant-no">№ ' +
      plantSpecimenNo(specimenNo) +
      '</span>' +
      '<span class="log-sheet-plant-name">' +
      escapeHtml(p.name || T('app.stack.plant', 'Plant')) +
      '</span>' +
      '</button>'
    );
  }

  function logCareSheetTitle() {
    const ymd = logSheetPendingDate;
    const today = localDateYYYYMMDD();
    if (!ymd || ymd === today) return T('app.plants.logCare', 'Log care');
    let label = ymd;
    if (window.GrowtooCalendar && typeof GrowtooCalendar.formatLong === 'function') {
      label = GrowtooCalendar.formatLong(ymd);
      const year = String(new Date().getFullYear());
      if (label.slice(-5) === ' ' + year) label = label.slice(0, -5);
    }
    return T('app.plants.logCareOn', 'Log care · {date}', { date: label });
  }

  function renderLogSheet() {
    const listEl = document.getElementById('log-sheet-plants');
    const emptyEl = document.getElementById('log-sheet-empty');
    const actionsEl = document.getElementById('log-sheet-actions');
    const labelEl = document.getElementById('log-sheet-plant-label');
    const titleEl = document.getElementById('log-sheet-title');
    if (titleEl) titleEl.textContent = logCareSheetTitle();
    const plants = loggablePlants();
    if (!listEl) return;

    if (!plants.length) {
      logSheetSelectedPlantIds = [];
      listEl.innerHTML = '';
      listEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      if (actionsEl) actionsEl.hidden = true;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;
    if (actionsEl) actionsEl.hidden = false;

    logSheetSelectedPlantIds = normalizeSelectedPlantIds(logSheetSelectedPlantIds, plants);
    if (!logSheetSelectedPlantIds.length) {
      logSheetSelectedPlantIds = [String(plants[0].id)];
    }

    const selectedSet = Object.create(null);
    logSheetSelectedPlantIds.forEach(function (id) {
      selectedSet[id] = true;
    });

    const groups = groupLoggablePlants(plants);
    const Stacks = window.GrowtooStacks;
    let specimen = 0;
    const indexById = Object.create(null);
    plants.forEach(function (p, i) {
      indexById[String(p.id)] = i;
    });

    listEl.innerHTML = groups
      .map(function (g) {
        const memberIds = g.members.map(function (p) {
          return String(p.id);
        });
        const selectedCount = memberIds.filter(function (id) {
          return selectedSet[id];
        }).length;
        const allOn = selectedCount === memberIds.length;
        const someOn = selectedCount > 0 && !allOn;

        if (!(Stacks && Stacks.shouldStack(g))) {
          const p = g.members[0];
          const idx = indexById[String(p.id)];
          specimen += 1;
          return logSheetPlantButtonHtml(
            p,
            idx != null ? idx : specimen - 1,
            !!selectedSet[String(p.id)]
          );
        }

        const expanded = !!logSheetExpandedStacks[g.key] || someOn;
        const stageLab =
          Stacks && typeof Stacks.stageLabel === 'function'
            ? Stacks.stageLabel(g.stage)
            : g.stage || '';
        const membersHtml = g.members
          .map(function (p) {
            const idx = indexById[String(p.id)];
            return logSheetPlantButtonHtml(
              p,
              idx != null ? idx : 0,
              !!selectedSet[String(p.id)]
            );
          })
          .join('');

        return (
          '<div class="log-sheet-stack' +
          (expanded ? ' is-open' : '') +
          (allOn ? ' is-all-selected' : someOn ? ' is-partial' : '') +
          '" data-stack-key="' +
          escapeHtml(g.key) +
          '">' +
          '<div class="log-sheet-stack-head">' +
          '<button type="button" class="log-sheet-stack-all' +
          (allOn ? ' is-selected' : '') +
          '" data-stack-toggle="' +
          escapeHtml(g.key) +
          '" aria-pressed="' +
          (allOn ? 'true' : 'false') +
          '">' +
          '<span class="log-sheet-plant-check" aria-hidden="true"></span>' +
          '<span class="log-sheet-stack-copy">' +
          '<span class="log-sheet-stack-title">' +
          escapeHtml(g.name || g.strain || 'Plants') +
          '</span>' +
          '<span class="log-sheet-stack-meta">' +
          escapeHtml(stageLab) +
          ' · ' +
          g.members.length +
          escapeHtml(T('app.plants.rowsTapForAll', ' rows · tap for all')) +
      '</span>' +
          '</span>' +
          '<span class="log-sheet-stack-count">×' +
          escapeHtml(String(g.size || g.members.length)) +
          '</span>' +
          '</button>' +
          '<button type="button" class="log-sheet-stack-expand" data-stack-expand="' +
          escapeHtml(g.key) +
          '" aria-expanded="' +
          (expanded ? 'true' : 'false') +
          '" aria-label="Show rows">' +
          (expanded ? '▴' : '▾') +
          '</button>' +
          '</div>' +
          '<div class="log-sheet-stack-members"' +
          (expanded ? '' : ' hidden') +
          '>' +
          membersHtml +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    if (labelEl) {
      const n = logSheetSelectedPlantIds.length;
      labelEl.textContent =
        n > 0
        ? T('app.plants.selectedCount', 'Plants · {count} selected', { count: n })
        : T('app.stack.plants', 'Plants');
    }

    const waterBtn = document.getElementById('log-sheet-water');
    const feedBtn = document.getElementById('log-sheet-feed');
    if (waterBtn) {
      waterBtn.classList.toggle('btn-primary', logSheetPendingAction !== 'feed');
      waterBtn.classList.toggle('btn-secondary', logSheetPendingAction === 'feed');
    }
    if (feedBtn) {
      feedBtn.classList.toggle('btn-primary', logSheetPendingAction === 'feed');
      feedBtn.classList.toggle('btn-secondary', logSheetPendingAction !== 'feed');
    }

    listEl.querySelectorAll('[data-plant-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = String(btn.getAttribute('data-plant-id') || '');
        if (!id) return;
        const idx = logSheetSelectedPlantIds.indexOf(id);
        if (idx >= 0) {
          if (logSheetSelectedPlantIds.length > 1) {
            logSheetSelectedPlantIds.splice(idx, 1);
          }
        } else {
          logSheetSelectedPlantIds.push(id);
        }
        renderLogSheet();
      });
    });

    listEl.querySelectorAll('[data-stack-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const key = btn.getAttribute('data-stack-toggle') || '';
        const group = groups.find(function (g) {
          return g.key === key;
        });
        if (!group) return;
        const ids = group.members.map(function (p) {
          return String(p.id);
        });
        const allOn = ids.every(function (id) {
          return selectedSet[id];
        });
        if (allOn) {
          // Keep at least one plant selected overall when possible.
          const remaining = logSheetSelectedPlantIds.filter(function (id) {
            return ids.indexOf(id) < 0;
          });
          logSheetSelectedPlantIds = remaining.length
            ? remaining
            : ids.slice(0, 1);
        } else {
          const merged = logSheetSelectedPlantIds.slice();
          ids.forEach(function (id) {
            if (merged.indexOf(id) < 0) merged.push(id);
          });
          logSheetSelectedPlantIds = merged;
          logSheetExpandedStacks[key] = true;
        }
        renderLogSheet();
      });
    });

    listEl.querySelectorAll('[data-stack-expand]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const key = btn.getAttribute('data-stack-expand') || '';
        logSheetExpandedStacks[key] = !logSheetExpandedStacks[key];
        renderLogSheet();
      });
    });
  }

  function openLogSheet(pendingAction, opts) {
    if (blockAdminWrite()) return;
    const o = opts || {};
    logSheetPendingAction = pendingAction || null;
    if (Object.prototype.hasOwnProperty.call(o, 'date')) {
      const raw = o.date ? String(o.date).slice(0, 10) : '';
      logSheetPendingDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    } else {
      logSheetPendingDate = null;
    }
    setLogSheetOpen(true);
    // Calendar (and any backdated log) must not auto-write — grower confirms.
    if (pendingAction && !logSheetPendingDate && loggablePlants().length === 1) {
      // Single plant: run immediately after sheet paints.
      window.setTimeout(function () {
        if (pendingAction === 'water') quickLogWatering();
        else if (pendingAction === 'feed') quickLogFeeding();
        setLogSheetOpen(false);
      }, 0);
    }
  }

  function closeSettingsPanels() {
    document.querySelectorAll('.settings-panel').forEach(function (panel) {
      panel.hidden = true;
    });
    document.querySelectorAll('[data-settings-panel]').forEach(function (tile) {
      tile.setAttribute('aria-expanded', 'false');
      tile.classList.remove('is-open');
    });
  }

  function paintLanguagePicker() {
    const host = document.getElementById('settings-language-picker');
    if (!host) return;
    const I18N = window.I18N;
    const list = (I18N && I18N.locales) || [];
    const current = I18N && I18N.locale;
    const check = '<span class="settings-picker-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5 9-10"/></svg></span>';
    host.innerHTML = '';
    list.forEach(function (meta) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-picker-opt';
      btn.setAttribute('role', 'option');
      btn.setAttribute('data-locale', meta.code);
      btn.setAttribute('aria-selected', String(meta.code === current));
      btn.innerHTML = check;
      const label = document.createElement('span');
      label.textContent = meta.nativeName || meta.name || meta.code;
      btn.appendChild(label);
      btn.addEventListener('click', function () {
        if (I18N && typeof I18N.setLocale === 'function') {
          I18N.setLocale(meta.code, { navigate: true });
        }
      });
      host.appendChild(btn);
    });
  }

  (function bindMoreNav() {
    const btn = document.getElementById('btn-account');
    const backdrop = document.getElementById('more-nav-backdrop');
    const closeBtn = document.getElementById('more-nav-close');
    const grid = document.querySelector('.settings-grid');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const overlay = document.getElementById('more-nav-overlay');
        setMoreNavOpen(!(overlay && !overlay.hidden));
      });
    }
    if (backdrop) backdrop.addEventListener('click', function () { setMoreNavOpen(false); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setMoreNavOpen(false); });
    if (grid) {
      grid.addEventListener('click', function (e) {
        const tile = e.target.closest('[data-settings-panel]');
        if (!tile || !grid.contains(tile)) return;
        const panel = document.getElementById('settings-panel-' + tile.getAttribute('data-settings-panel'));
        if (!panel) return;
        const willOpen = panel.hidden;
        closeSettingsPanels();
        if (willOpen) {
          panel.hidden = false;
          tile.setAttribute('aria-expanded', 'true');
          tile.classList.add('is-open');
          try { panel.scrollIntoView({ block: 'nearest' }); } catch (err) { /* ignore */ }
        }
      });
    }
    if (window.I18N && typeof I18N.whenReady === 'function') I18N.whenReady(paintLanguagePicker);
    else paintLanguagePicker();
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
      water.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        // Only dismiss after a successful write — otherwise keep the sheet
        // open so the grower can pick plants (feeding used to look "dead").
        if (quickLogWatering()) setLogSheetOpen(false);
      });
    }
    if (feed) {
      feed.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (quickLogFeeding()) setLogSheetOpen(false);
      });
    }
    if (full) {
      full.addEventListener('click', function () {
        const plantIds = selectedLogPlantIds();
        const pending = logSheetPendingAction;
        const pendingDate = logSheetPendingDate;
        const typeHint =
          pending === 'water' ? 'zalijevanje' : pending === 'feed' ? 'gnojidba' : null;
        setLogSheetOpen(false);
        startJournalEntry({
          plantId: plantIds[0] || null,
          plantIds: plantIds.length > 1 ? plantIds : null,
          type: typeHint,
          date: pendingDate || undefined,
        });
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
    /* Intl words each unit per language, so only "just now" needs a key. */
    function rel(value, unit) {
      try {
        return new Intl.RelativeTimeFormat(intlTag(), {
          numeric: 'auto',
          style: 'short',
        }).format(-value, unit);
      } catch (e) {
        return value + ' ' + unit;
      }
    }
    if (sec < 60) return T('app.coach.justNow', 'just now');
    if (sec < 3600) return rel(Math.floor(sec / 60), 'minute');
    if (sec < 86400) return rel(Math.floor(sec / 3600), 'hour');
    if (sec < 604800) return rel(Math.floor(sec / 86400), 'day');
    if (sec < 2592000) return rel(Math.floor(sec / 604800), 'week');
    if (sec < 31536000) return rel(Math.floor(sec / 2592000), 'month');
    return rel(Math.floor(sec / 31536000), 'year');
  }

  function formatDayWeek(dateStr, startDateStr) {
    if (!dateStr || !startDateStr) return '';
    const d = new Date(dateStr);
    const start = new Date(startDateStr);
    const day = daysBetween(startDateStr, dateStr);
    const week = Math.floor(day / 7);
    return T('app.growlog.dayWeek', 'Day {day} (week {week})', { day: day, week: week });
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
    const envType =
      plant.environmentType === 'outdoor'
        ? T('app.account.outdoor', 'Outdoor')
        : T('app.account.indoor', 'Indoor');
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

    document.getElementById('growlog-updated').textContent = T(
      'app.growlog.updated',
      'Updated {when}',
      { when: timeAgo(updatedAt) }
    );
    const viewsEl = document.getElementById('growlog-views');
    if (viewsEl) {
      // Private un-minted journals shouldn't imply an audience with "0 views".
      if (!plantIsPublic || !views) {
        viewsEl.hidden = true;
        viewsEl.textContent = '';
      } else {
        viewsEl.hidden = false;
        viewsEl.textContent = T('app.growlog.publicViews', '{count} public views', {
        count: views,
      });
      }
    }

    document.getElementById('growlog-metrics').innerHTML = `
      <div class="growlog-metric"><span class="growlog-metric-icon">📅</span> ${T('app.growlog.weeks', '{count} weeks', { count: durationWeeks })}</div>
      <div class="growlog-metric"><span class="growlog-metric-icon">💧</span> ${stageName(plant.stage)}</div>
      <div class="growlog-metric"><span class="growlog-metric-icon">💡</span> ${envType}</div>
    `;

    const allPhotos = [];
    if (plant.photo) allPhotos.push(plant.photo);
    entries.forEach((e) => {
      if (e.photo) allPhotos.push(e.photo);
    });
    const photoGrid = document.getElementById('growlog-photo-grid');
    photoGrid.innerHTML = allPhotos.slice(0, 3).map((src) => '<img src="' + src + '" alt="" />').join('') || '<p class="growlog-empty">' + escapeHtml(T('app.growlog.noPhotos', 'No photos')) + '</p>';
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
        const label = stageName(s);
        const dateStr = date ? new Date(date).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
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
        const label = potName(k);
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
        '<p class="growlog-empty">' +
        T(
          'app.growlog.noTransitions',
          'No transitions recorded yet. Change the stage in &quot;Edit plant&quot; — a journal entry will be created.'
        ) +
        '</p>';
    } else {
      histHtml = hist
        .slice()
        .reverse()
        .map((h) => {
          const d = h.date ? new Date(h.date).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
          const line = h.from
            ? escapeHtml(stageName(h.from)) + ' → ' + escapeHtml(stageName(h.to))
            : T('app.growlog.startStage', 'Start: {stage}', { stage: escapeHtml(stageName(h.to)) });
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
        '<h4 class="growlog-subsection-title">' +
      escapeHtml(T('app.growlog.subphases', 'Sub-phases (pots)')) +
      '</h4>' +
        '<div class="tree-stages tree-subphases">' +
        subRows +
        '</div>' +
        '<h4 class="growlog-subsection-title">' +
      escapeHtml(T('app.growlog.stageHistory', 'Stage transition history')) +
      '</h4>' +
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
                ? new Date(h.date).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short', year: 'numeric' })
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
            '<h4 class="growlog-subsection-title">' +
      escapeHtml(T('app.growlog.subphaseHistory', 'Sub-phase history (pots / field)')) +
      '</h4>' +
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
          ? '<div class="env-row"><span class="env-icon">📍</span> ' + escapeHtml(T('app.growlog.fieldLabel', 'Field:')) + ' ' + escapeHtml(plant.fieldLocation) + '</div>'
          : ''
      }
      ${
        plant.plantingLocation
          ? '<div class="env-row"><span class="env-icon">🌱</span> ' + escapeHtml(T('app.growlog.plantingLabel', 'Planting:')) + ' ' + escapeHtml(plant.plantingLocation) + '</div>'
          : ''
      }
      <div class="env-row"><span class="env-icon">🕐</span> ${T('app.growlog.ofLight', '{hours} of light', { hours: exposure })}</div>
    `;

    const heroEl = document.getElementById('growlog-hero');
    if (heroEl) {
      const stageKey = canonicalPlantStage(plant.stage);
      const stageLabel = stageName(stageKey) || plant.stage;
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
        escapeHtml(T('app.growlog.wkGrow', ' wk grow')) +
      '</span>' +
        '<span class="growlog-hero-chip growlog-hero-chip--muted">' +
        escapeHtml(envType) +
        '</span>' +
        '</div>' +
        (sharedPlant
          ? ''
          : '<button type="button" class="btn btn-ghost btn-sm growlog-hero-edit" id="growlog-hero-edit">✎ ' + escapeHtml(T('app.growlog.editPlant', 'Edit plant')) + '</button>') +
        '</div>' +
        '<h2 class="growlog-hero-title">' +
        escapeHtml(plant.name) +
        '</h2>' +
        strainHtml +
        '<p class="growlog-hero-hint">' +
      escapeHtml(
        T('app.growlog.photoHint', 'Photos are in the sidebar and in the recent photos below.')
      ) +
      '</p>' +
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
            ? T(
                'app.growlog.tokenRemaining',
                'On-chain plant token linked — this plant can still earn up to <strong>{remaining} $GROWTOO</strong> in stage rewards by harvest (up to {total} total across all stages).',
                { remaining: remaining, total: total }
              )
            : T(
                'app.growlog.tokenDone',
                'On-chain plant token linked — harvest stage complete. Stage rewards for this token are done.'
              );
      } else {
        rewardGoalEl.hidden = false;
        rewardGoalEl.innerHTML =
          T(
            'app.growlog.tokenOptional',
            'If you mint an optional plant token, stage rewards can total up to <strong>{total} $GROWTOO</strong> by harvest (test network only).',
            { total: total }
          );
      }
    }

    const timelineItems = [];
    entries.slice(0, 20).forEach((e) => {
      const dayWeek = formatDayWeek(e.date, startDate);
      const dateStr = e.date ? new Date(e.date).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short', year: '2-digit' }) : '';
      const typeLabel = entryTypeName(e.type);
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
    document.getElementById('growlog-timeline').innerHTML = timelineItems.length
      ? timelineItems.join('')
      : '<p class="growlog-empty">' +
        escapeHtml(
          T('app.growlog.noEntries', 'No entries in the timeline. Add notes in the Journal.')
        ) +
        '</p>';

    const stripPhotos = allPhotos.slice(0, 8);
    document.getElementById('growlog-photo-strip').innerHTML =
      stripPhotos.map((src) => '<img src="' + src + '" alt="" />').join('') ||
      '<p class="growlog-empty">' + escapeHtml(T('app.growlog.noPhotos', 'No photos')) + '</p>';

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

  function openStoriesComposer() {
    if (typeof showView === 'function') showView('blog');
    else if (typeof window.showAppView === 'function') window.showAppView('blog');
    window.setTimeout(function () {
      const newBtn = document.getElementById('blog-new');
      if (newBtn) newBtn.click();
    }, 50);
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
    if (todayLine) {
      todayLine.textContent =
        brief ||
        T('app.today.quiet', 'Your garden is quiet — log a watering to keep the trail warm.');
    }
    if (todayActions) {
      todayActions.innerHTML =
        '<button type="button" class="btn btn-primary btn-tap" id="today-log-water">' +
        escapeHtml(T('app.today.logWatering', 'Log watering')) +
        '</button>' +
        '<button type="button" class="btn btn-secondary btn-tap" id="today-log-feed">' +
        escapeHtml(T('app.today.logFeeding', 'Log feeding')) +
        '</button>' +
        '<button type="button" class="btn btn-secondary btn-tap" id="today-write-story">' +
        escapeHtml(T('app.today.writeStory', 'Write a story')) +
        '</button>' +
        '<button type="button" class="btn btn-ghost btn-tap" id="today-ask-coach">' +
        escapeHtml(T('app.today.askCoach', 'Ask coach')) +
        '</button>';
      const waterBtn = document.getElementById('today-log-water');
      const feedBtn = document.getElementById('today-log-feed');
      const storyBtn = document.getElementById('today-write-story');
      const coachBtn = document.getElementById('today-ask-coach');
      if (waterBtn) {
        waterBtn.addEventListener('click', function () {
          const plants = loggablePlants();
          if (plants.length > 1) openLogSheet('water');
          else quickLogWatering();
        });
      }
      if (feedBtn) {
        feedBtn.addEventListener('click', function () {
          const plants = loggablePlants();
          if (plants.length > 1) openLogSheet('feed');
          else quickLogFeeding();
        });
      }
      if (storyBtn) {
        storyBtn.addEventListener('click', function () {
          openStoriesComposer();
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
          const stage = stageName(p.stage) || T('app.stage.growing', 'Growing');
          /* environmentType is a stored data value, so the label is resolved
             here rather than translating the value itself. */
          const env =
            p.environmentType === 'outdoor' || p.fieldLocation
              ? T('app.env.outdoor', 'outdoor')
              : T('app.env.indoor', 'indoor');
          const since = daysSinceLastCare(p.id, entries, ['zalijevanje']);
          const waterLine =
            since == null
        ? T('app.plants.noWateringYet', 'no watering yet')
        : since === 0
          ? T('app.plants.wateredToday', 'watered today')
          : T('app.plants.daysSinceWater', '{count}d since water', { count: since });
          const no = plantSpecimenNo(i);
          return (
            '<button type="button" class="shell-card plant-seal-card" data-plant-id="' +
            escapeHtml(p.id) +
            '">' +
            '<span class="plant-seal-mark" aria-hidden="true"></span>' +
            '<span class="plant-seal-title">' +
      escapeHtml(T('app.stack.plant', 'Plant')) +
      ' <span class="plant-seal-no">№</span> ' +
            no +
            ' — <em>' +
            escapeHtml(p.name || T('app.stack.plant', 'Plant')) +
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
        growBalance = Number(wallet.growthBalance || 0).toLocaleString(intlTag());
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
          '<p class="today-card-eyebrow">' +
          escapeHtml(T('app.nav.today', 'Today')) +
          '</p>' +
          '<p class="today-card-line">' +
          escapeHtml(
            T(
              'app.today.firstPlant',
              'Add your first plant — Coach will keep the care trail tidy from there.'
            )
          ) +
          '</p>' +
          '<div class="today-card-actions">' +
          '<button type="button" class="btn btn-primary btn-tap" id="dashboard-add-first-plant">' +
          escapeHtml(T('app.today.addPlant', 'Add a plant')) +
          '</button>' +
          '<button type="button" class="btn btn-secondary btn-tap" id="dashboard-open-coach-empty">' +
          escapeHtml(T('app.today.askCoach', 'Ask coach')) +
          '</button>' +
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
          '<p class="dashboard-first-run-eyebrow">' +
          escapeHtml(T('app.nav.myGarden', 'My garden')) +
          '</p>' +
          '<h2 class="dashboard-first-run-title">' +
          escapeHtml(T('app.garden.emptyTitle', 'No adopted plants yet')) +
          '</h2>' +
          '<p class="dashboard-first-run-body">' +
          escapeHtml(
            T(
              'app.garden.emptyBody',
              'Browse the market for open offers, then invest with test $GROWTOO when you are ready.'
            )
          ) +
          '</p>' +
          '<button type="button" class="btn btn-primary" id="dashboard-open-market">' +
          escapeHtml(T('app.market.ctaBrowseMarket', 'Browse market')) +
          '</button>' +
          '</div>';
        const marketBtn = document.getElementById('dashboard-open-market');
        if (marketBtn) marketBtn.addEventListener('click', () => showView('market'));
      } else if (isAdopterProfile()) {
        metricsEl.hidden = false;
        metricsEl.innerHTML = M.panel(
          '',
          M.card({
            label: T('app.metric.growBalance', '$GROWTOO balance'),
            value: growBalance,
            meta:
              M.row(T('app.metric.plantTokens', 'Plant tokens'), tokenCount, 'metric-dot--amber') +
              M.row(T('app.metric.stillGrowing', 'Still growing'), growingCount, 'metric-dot--teal'),
            modifier: 'amber',
          }) +
            M.card({
              label: T('app.metric.gardenProgress', 'Garden progress'),
              value: tokenCount ? growPct + '%' : '0%',
              meta:
                M.row(T('app.metric.harvested', 'Harvested'), Math.max(0, tokenCount - growingCount), 'metric-dot--teal') +
                M.row(T('app.metric.inGrowth', 'In growth'), growingCount, 'metric-dot--violet'),
              modifier: 'teal',
            }) +
            M.card({
              label: T('app.metric.solanaWallet', 'Solana wallet'),
              value: walletDisplay,
              meta:
                M.row(T('app.metric.network', 'Network'), T('app.metric.testNetwork', 'test network'), 'metric-dot--teal') +
                M.row(T('app.metric.account', 'Account'), walletLinked ? T('app.metric.linked', 'Linked') : T('app.account.notLinked', 'Not linked'), walletLinked ? 'metric-dot--teal' : 'metric-dot--muted'),
              modifier: 'teal',
              attention: !walletLinked,
            }) +
            M.card({
              label: 'Market',
              value: T('app.metric.browse', 'Browse'),
              meta:
                M.row(T('app.metric.action', 'Action'), T('app.metric.followTrails', 'Follow plant trails'), 'metric-dot--amber') +
                M.row(T('app.metric.profile', 'Profile'), T('app.role.adopter', 'Adopter'), 'metric-dot--violet'),
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
            label: T('app.metric.growOverview', 'Grow overview'),
            value: totalPlantCount.toLocaleString(intlTag()),
            meta:
              M.row(T('app.metric.individualPlants', 'Individual plants'), plants.length, 'metric-dot--teal') +
              M.row(T('app.metric.plantsInBatch', 'Plants in batch'), totalPlantCount, 'metric-dot--blue'),
            modifier: 'teal',
          }) +
            M.card({
              label: T('app.metric.journalActivity', 'Journal activity'),
              value: entries.length.toLocaleString(intlTag()),
              meta:
                M.row(T('app.metric.last7Days', 'Last 7 days'), entriesWeek, 'metric-dot--blue') +
                M.row(T('app.metric.plantProfiles', 'Plant profiles'), plants.length, 'metric-dot--muted'),
              modifier: 'blue',
            }) +
            M.card({
              label: T('app.metric.activeStages', 'Active stages'),
              value: stageSet.size.toLocaleString(intlTag()),
              meta:
                M.row(topStage ? stageName(topStage) : T('app.metric.noPlants', 'No plants'), topStagePct + '%', 'metric-dot--violet') +
                M.row('Outdoor', outdoorCount, 'metric-dot--amber'),
              modifier: 'violet',
            }) +
            M.card({
              label: T('app.metric.tokenPortfolio', 'Token portfolio'),
              value: growBalance,
              meta:
                M.row(T('app.metric.plantTokens', 'Plant tokens'), tokenCount, 'metric-dot--amber') +
                M.row(T('app.metric.stillGrowing', 'Still growing'), growingCount, 'metric-dot--teal'),
              modifier: 'amber',
            }) +
            M.card({
              label: T('app.metric.solanaWallet', 'Solana wallet'),
              value: walletLinked ? walletDisplay : T('app.account.notLinked', 'Not linked'),
              meta:
                M.row(T('app.metric.network', 'Network'), T('app.metric.testNetwork', 'test network'), 'metric-dot--teal') +
                M.row(
                  T('app.metric.nextStep', 'Next step'),
                  walletLinked
                    ? T('app.metric.readyToSign', 'Ready to sign')
                    : T('app.metric.optionalTokenise', 'Optional — for Tokenise'),
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
          lead: T('app.dash.noEntriesLead', 'No entries yet'),
          body: T('app.dash.noEntriesBody', 'Add a plant and start your journal.'),
        });
      } else {
        recentEl.innerHTML = recent
          .map((e) => {
            const plant = plants.find((p) => p.id === e.plantId);
            const plantName = escapeHtml(plant ? plant.name : 'Plant');
            const date = e.date ? new Date(e.date).toLocaleDateString(intlTag()) : '';
            const typeLabel = escapeHtml(entryTypeName(e.type));
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
        if (hasWatering) chartsContainer.innerHTML += '<div class="dashboard-chart-block"><h4>' + escapeHtml(T('app.dashboard.chartWatering', 'Watering')) + '</h4><div id="dashboard-chart-watering"></div></div>';
        if (hasEnv) chartsContainer.innerHTML += '<div class="dashboard-chart-block"><h4>' + escapeHtml(T('app.dashboard.chartEnvironment', 'Environment (temperature, humidity, pH)')) + '</h4><div id="dashboard-chart-environment"></div></div>';
        if (hasWatering && typeof renderToolboxChart === 'function') renderToolboxChart('watering', document.getElementById('dashboard-chart-watering'));
        if (hasEnv && typeof renderToolboxChart === 'function') renderToolboxChart('environment', document.getElementById('dashboard-chart-environment'));
      }
    }
  }

  function pickPlantsForQuickLog() {
    const plants = loggablePlants();
    if (!plants.length) return [];
    const selected = normalizeSelectedPlantIds(logSheetSelectedPlantIds, plants);
    if (selected.length) {
      return selected
        .map(function (id) {
          return plants.find(function (p) {
            return String(p.id) === String(id);
          });
        })
        .filter(Boolean);
    }
    if (plants.length === 1) return [plants[0]];
    return [];
  }

  /** @returns {boolean} true when an entry was written */
  function quickLogCare(type, note) {
    if (blockAdminWrite()) return false;
    const plants = loggablePlants();
    if (!plants.length) {
      openPlantModal();
      return false;
    }
    let chosen = pickPlantsForQuickLog();
    if (!chosen.length) {
      // Multiple plants and none selected yet — open the Log sheet.
      openLogSheet(
        type === 'zalijevanje' ? 'water' : type === 'gnojidba' ? 'feed' : null,
        logSheetPendingDate ? { date: logSheetPendingDate } : {}
      );
      return false;
    }
    try {
      saveJournalEntriesBatch(
        chosen.map(function (p) {
          return p.id;
        }),
        {
          type: type,
          note: note,
          date: logSheetPendingDate || localDateYYYYMMDD(),
          source: 'quick-log',
          requireNoteDefault: false,
        }
      );
      // Toast comes from notifyJournalEntry / batch summary.
      return true;
    } catch (err) {
      const msg = (err && err.message) || T('app.entry.logFailed', 'Could not log entry.');
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        DnevnikNotifications.toast(msg, 'error');
      } else {
        paperNote({
          title: T('app.entry.logFailed', 'Could not log entry.'),
          body: msg,
        });
      }
      return false;
    }
  }

  function quickLogWatering() {
    return quickLogCare('zalijevanje', T('app.entry.watered', 'Watered'));
  }

  function quickLogFeeding() {
    return quickLogCare('gnojidba', 'Fed');
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
    if (isToday) return T('app.weather.today', 'Today');
    return d.toLocaleDateString(intlTag(), { weekday: 'short', day: 'numeric', month: 'short' });
  }

  async function getWeather(city, containerId) {
    const elId = containerId || PLANTS_WEATHER_EL;
    const weatherDiv = document.getElementById(elId);
    if (!weatherDiv) return;

    const cityName = String(city || '').trim();
    if (!cityName) {
      weatherDiv.innerHTML =
        '<p class="plants-weather-empty">' +
        escapeHtml(
          T(
            'app.weather.addCity',
            'Add a city above for a {days}-day forecast. Optional — skip if you grow indoors.',
            { days: WEATHER_DAYS }
          )
        ) +
        '</p>';
      return;
    }
    weatherDiv.innerHTML =
      '<p class="plants-weather-loading">' +
      escapeHtml(T('app.weather.loading', 'Loading forecast…')) +
      '</p>';

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
        const msg = (data && data.error && data.error.message) || 'HTTP ' + response.status; // i18n-ignore — status line, not copy
        weatherDiv.innerHTML =
          '<p class="plants-weather-error">' +
        escapeHtml(T('app.weather.unavailable', 'Forecast unavailable: {reason}', { reason: msg })) +
        '</p>';
        return;
      }

      if (!data || data.error) {
        weatherDiv.innerHTML =
          '<p class="plants-weather-error">' +
          escapeHtml(
            T('app.weather.unavailable', 'Forecast unavailable: {reason}', {
              reason:
                (data && data.error && data.error.message) ||
                T('app.weather.unknownCity', 'Unknown city'),
            })
          ) +
          '</p>';
        return;
      }

      if (!data.forecast || !Array.isArray(data.forecast.forecastday) || !data.forecast.forecastday.length) {
        weatherDiv.innerHTML =
        '<p class="plants-weather-error">' +
        escapeHtml(T('app.weather.noData', 'No forecast data available.')) +
        '</p>';
        return;
      }

      displayWeather(data, elId);
    } catch (error) {
      console.error('Weather fetch failed', error);
      weatherDiv.innerHTML =
        '<p class="plants-weather-error">' +
        escapeHtml(
          T(
            'app.weather.loadFailed',
            'Could not load the forecast. Check your connection and the city name.'
          )
        ) +
        '</p>';
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
      escapeHtml(T('app.weather.coachHead', 'Coach · what this means for your grow')) +
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
      '<button type="button" class="btn btn-ghost btn-sm weather-coach-ask" id="weather-coach-ask">' +
      escapeHtml(T('app.weather.askCoach', 'Ask Coach about the weather')) +
      '</button>' +
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
    if (sub) {
      sub.textContent = T('app.weather.dayCount', '{count} days · for grow planning', {
        count: dayCount,
      });
    }

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
        '<p class="plants-weather-scroll-hint">' +
        escapeHtml(T('app.weather.swipeHint', 'Swipe for all {days} days →', { days: dayCount })) +
        '</p>';
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

  let plantsWeatherPainted = false;

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

    if (plantsWeatherPainted) return;
    plantsWeatherPainted = true;
    loadPlantsWeatherFromInput();
  }

  const MAX_IMAGE_SIZE = 800;
  /** Soft cap after resize — localStorage + Firestore payload stay usable. */
  /**
   * Per-photo cap, matched to GrowCamera's MAX_CHARS so both ingest paths
   * agree. This was 900000 — 86% of the entire 1 MiB Firestore document
   * budget for a *single* photo — because it was reasoned about one image at a
   * time. Every photo shares one journal document, so the cap that matters is
   * the cumulative one; nine attachments were enough to pass the hard limit
   * and silently break cloud backup for good.
   */
  const MAX_ENTRY_PHOTO_CHARS = 160000;
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
   * Hand a freshly compressed photo to Storage and return what should be saved
   * on the record — a short download URL normally, or the original data URL if
   * the upload could not happen.
   *
   * The fallback keeps the grower's photo rather than discarding it, but an
   * inline photo is what used to break cloud backup, so say so plainly instead
   * of failing quietly.
   *
   * Returns the warning rather than writing it, because callers replace the
   * preview markup immediately afterwards and would wipe it.
   *
   * @return {!Promise<{url: string, warning: string}>}
   */
  async function uploadJournalPhoto(dataUrl, kind) {
    if (!window.JournalPhotos) return { url: dataUrl, warning: '' };
    const res = await window.JournalPhotos.upload(dataUrl, kind);
    if (!res.inline) return { url: res.url, warning: '' };
    console.warn('Journal photo kept inline —', res.error);
    return {
      url: res.url,
      warning: T(
        'app.photo.uploadWarning',
        'Photo saved on this device, but could not be uploaded ({reason}). It counts against your cloud backup size.',
        { reason: String(res.error || T('app.photo.unknownReason', 'unknown')) }
      ),
    };
  }

  /** Append an inline-fallback warning under a photo preview. */
  function appendPhotoWarning(previewEl, warning) {
    if (!previewEl || !warning) return;
    const note = document.createElement('span');
    note.className = 'media-error';
    note.textContent = warning;
    previewEl.appendChild(note);
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
          reject(new Error(T('app.photo.noDimensions', 'Could not read image dimensions.')));
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
          reject(new Error(T('app.camera.processFailed', 'Could not process image.')));
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
          reject(err || new Error(T('app.camera.encodeFailed', 'Could not encode image.')));
          return;
        }
        if (!out || out.length > MAX_ENTRY_PHOTO_CHARS) {
          reject(
        new Error(
          T(
            'app.photo.stillTooLarge',
            'Photo is still too large after compression. Try a smaller image.'
          )
        )
      );
          return;
        }
        resolve(out);
      };
      img.onerror = () =>
      reject(new Error(T('app.photo.loadFailed', 'Could not load that image. Try JPG or PNG.')));
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
      '<span class="grower-rank-chip-tier">' +
      escapeHtml(T('app.rank.chip', 'Rank {tier}', { tier: rank.tier || 1 })) +
      '</span>' +
      '<span>' +
      escapeHtml(rank.title) +
      '</span>' +
      '<span class="grower-rank-chip-xp">' +
      escapeHtml(T('app.token.xpAmount', '{xp} XP', { xp: xp })) +
      '</span>';
    chip.setAttribute(
      'aria-label',
      T('app.rank.aria', 'Grower rank {tier}, {title}, {xp} XP. Open profile.', {
        tier: rank.tier || 1,
        title: rank.title,
        xp: xp,
      })
    );
  }

  function renderActivityRewardCard() {
    const section = document.getElementById('activity-reward-section');
    const line = document.getElementById('activity-reward-line');
    const meter = document.getElementById('activity-reward-meter');
    const hint = document.getElementById('activity-reward-hint');
    const actions = document.getElementById('activity-reward-actions');
    if (!section || !line || !meter) return;
    if (!isGrowerProfile() || !window.GrowerQuests || typeof GrowerQuests.previewPlatformReward !== 'function') {
      section.hidden = true;
      return;
    }
    const plants = getPlants();
    if (!plants.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
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
    const claimedAmt =
      claimed && claimed.status === 'minted' ? Number(claimed.reward || 0) : null;
    if (claimedAmt != null) {
      line.innerHTML = T('app.bonus.claimed', 'Claimed <strong>{amount} $GROWTOO</strong> this month.', {
        amount: claimedAmt,
      });
    } else if (preview.reward <= 0) {
      line.innerHTML = T(
        'app.bonus.startHint',
        'Log watering or feeding to start this month’s bonus.'
      );
    } else {
      line.innerHTML = T(
        'app.bonus.about',
        'About <strong>{amount} $GROWTOO</strong> if you claim now (cap {cap}).',
        { amount: preview.reward, cap: preview.cap }
      );
    }
    meter.innerHTML =
      '<li>' +
      escapeHtml(T('app.bonus.careDays', 'Care days (water or feed)')) +
      '<strong>' +
      (a.careDays || 0) +
      '/20</strong></li>' +
      '<li>' +
      escapeHtml(T('app.bonus.feedingDays', 'Feeding days')) +
      '<strong>' +
      (a.feedingDays || 0) +
      '/8</strong></li>' +
      '<li>' +
      escapeHtml(T('app.bonus.storiesPublished', 'Stories published')) +
      '<strong>' +
      (a.publishedStories || 0) +
      '/2</strong></li>' +
      '<li>' +
      escapeHtml(T('app.bonus.qualifyingWeeks', 'Weeks with 5+ care days')) +
      '<strong>' +
      (a.qualifyingWeeks || 0) +
      '/4</strong></li>';
    if (hint) {
      hint.textContent = preview.loggedToday
        ? T(
            'app.bonus.alreadyCounted',
            'Today is already counted. Extra logs today do not add more tokens.'
          )
        : T('app.bonus.addCareDay', 'Log watering or feeding today to add a care day.');
    }
    if (actions) {
      if (claimed && (claimed.status === 'minted' || claimed.status === 'pending')) {
        actions.innerHTML =
          claimed.status === 'pending'
            ? '<p class="activity-reward-hint">' +
              escapeHtml(T('app.bonus.inQueue', 'Claim is in the rewards queue.')) +
              '</p>'
            : '';
      } else if (preview.reward <= 0) {
        actions.innerHTML = '';
      } else {
        actions.innerHTML =
          '<button type="button" class="btn btn-secondary btn-tap" id="activity-reward-claim">' + escapeHtml(T('app.activity.claimOnTokenise', 'Claim on Tokenise')) + '</button>';
      }
    }
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
  let journalStageFilter = '';

  function paintJournalStageFilters() {
    const bar = document.getElementById('journal-stage-filters');
    if (!bar) return;
    const keys = Object.keys(STAGES);
    if (bar.dataset.bound !== '1') {
      bar.dataset.bound = '1';
      bar.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-stage]');
        if (!btn || !bar.contains(btn)) return;
        journalStageFilter = btn.getAttribute('data-stage') || '';
        paintJournalStageFilters();
        applyJournalStageFilter();
      });
    }
    bar.innerHTML =
      '<button type="button" class="journal-stage-filter' +
      (!journalStageFilter ? ' is-active' : '') +
      '" data-stage="" role="tab" aria-selected="' +
      (!journalStageFilter ? 'true' : 'false') +
      '">' +
      escapeHtml(T('app.plants.filterAll', 'All')) +
      '</button>' +
      keys
        .map(function (key) {
          const on = journalStageFilter === key;
          return (
            '<button type="button" class="journal-stage-filter' +
            (on ? ' is-active' : '') +
            '" data-stage="' +
            escapeHtml(key) +
            '" role="tab" aria-selected="' +
            (on ? 'true' : 'false') +
            '">' +
            escapeHtml(stageName(key)) +
            '</button>'
          );
        })
        .join('');
  }

  function applyJournalStageFilter() {
    const list = document.getElementById('plants-list');
    if (!list) return;
    list.querySelectorAll('.plant-card, .plant-stack').forEach(function (el) {
      if (!journalStageFilter) {
        el.hidden = false;
        return;
      }
      const raw = el.getAttribute('data-stage') || el.getAttribute('data-stage-key') || '';
      const bucket =
        {
          klijanje: 'germination',
          sadnica: 'seedling',
          vegetativna: 'vegetative',
          cvjetanje: 'flowering',
          susenje: 'harvest',
        }[journalStageFilter] || journalStageFilter;
      el.hidden = raw !== journalStageFilter && raw !== bucket;
    });
  }

  function renderPlants() {
    syncJournalFreshChrome();
    renderCoachBriefingSurfaces();
    renderGrowerRankChip();
    renderActivityRewardCard();
    if (window.GrowerBlog && typeof GrowerBlog.refreshPublishedMonthCount === 'function') {
      GrowerBlog.refreshPublishedMonthCount().then(function () {
        renderActivityRewardCard();
      });
    }
    const list = document.getElementById('plants-list');
    const plants = getPlants();
    if (plants.length === 0) {
      list.innerHTML = emptyStateHtml({
        icon: 'plant',
        lead: T('app.plants.emptyLead', 'No plants yet'),
        body: T('app.plants.emptyBody', 'Add your first plant to start a grow journal.'),
        ctaId: 'empty-add-plant',
        ctaLabel: T('app.plants.newPlant', '+ New plant'),
      });
      return;
    }

    function plantCardHtml(p) {
      const shared = isSharedPlantId(p.id);
      const stageSlug = canonicalPlantStage(p.stage);
      const stageLabelText = stageName(p.stage);
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
        ? T('app.plants.wateredOn', 'Watered {date}', {
            date: new Date(lastWater.date || lastWater.ts).toLocaleDateString(intlTag()),
          })
        : T('app.plants.noWateringLog', 'No watering log yet');
      const sinceLabel = p.startDate
        ? new Date(p.startDate).toLocaleDateString(intlTag())
        : '';
      const byline = [p.strain, sinceLabel].filter(Boolean).join(' · ');
      const initial = String(p.name || '?').trim().charAt(0).toUpperCase() || '?';
      const tldr =
        T('app.plants.tldr', 'TL;DR:') +
        ' ' +
        stageLabelText +
        ' · ' +
        lastWaterLabel;
      const stageTintKey =
        {
          klijanje: 'germination',
          sadnica: 'seedling',
          vegetativna: 'vegetative',
          cvjetanje: 'flowering',
          susenje: 'harvest',
        }[p.stage] || 'germination';
      const photo = p.photo
        ? '<img src="' + p.photo + '" alt="" />'
        : '';
      return `
      <div class="plant-card${shared ? ' plant-card--shared' : ''}" data-id="${p.id}" data-stage="${stageSlug}" data-stage-key="${stageTintKey}">
        <div class="plant-card-photo${p.photo ? '' : ' plant-card-photo--empty'}">${photo}</div>
        <div class="plant-card-body">
          <div class="plant-card-byline">
            <span class="plant-card-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
            <span>${escapeHtml(byline || stageLabelText)}</span>
          </div>
          <h3>${escapeHtml(p.name)}</h3>
          <p class="plant-card-tldr">${escapeHtml(tldr)}</p>
          ${
            p.subphase
              ? `<div class="plant-card-subphases"><span class="subphase-badge" title="Pot volume">${escapeHtml(subphaseLabel(p.subphase))}</span></div>`
              : ''
          }
          ${
            p.fieldLocation
              ? `<div class="plant-card-meta-line">${escapeHtml(p.fieldLocation)}</div>`
              : ''
          }
          <div class="plant-card-actions">
            <button type="button" class="btn btn-primary btn-growlog">${escapeHtml(T('app.plants.logCare', 'Log care'))}</button>
            ${
              shared
                ? ''
                : `<button type="button" class="btn btn-ghost btn-edit-plant">${escapeHtml(T('app.btn-edit-plant.button', '✎ Edit plant'))}</button>
            <button type="button" class="btn btn-ghost btn-delete-plant">${escapeHtml(T('app.plants.deleteConfirm', 'Delete plant'))}</button>`
            }
          </div>
        </div>
      </div>
    `;
    }

    const Stacks = window.GrowtooStacks;
    if (Stacks && typeof Stacks.groupItems === 'function') {
      const groups = Stacks.groupItems(plants, {
        getStrain: function (p) {
          return p.strain;
        },
        getName: function (p) {
          return p.name;
        },
        getStage: function (p) {
          return p.stage;
        },
        getWeight: function (p) {
          return Math.max(1, Number(p.count || 1) || 1);
        },
      });
      list.innerHTML = groups
        .map(function (g) {
          const membersHtml = g.members.map(plantCardHtml).join('');
          return Stacks.wrapStackHtml(g, membersHtml, {
            surface: 'plants',
            photo: Stacks.firstPhoto(g.members),
          });
        })
        .join('');
    } else {
      list.innerHTML = plants.map(plantCardHtml).join('');
    }

    paintJournalStageFilters();
    applyJournalStageFilter();

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
    // `hidden` alone is enough now that it out-ranks the class `display`.
    outdoorBlock.hidden = !showOutdoor;
    if (plantingWrap && fieldInput) {
      const plantingInput = document.getElementById('plant-planting-location');
      const showPlanting =
        showOutdoor &&
        (fieldInput.value.trim().length > 0 || (plantingInput && plantingInput.value.trim().length > 0));
      plantingWrap.hidden = !showPlanting;
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
      '<button type="button" class="toast-undo-btn">' +
      escapeHtml(T('app.toast.undo', 'Undo')) +
      '</button>';
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
            title: T('app.plants.deleteTitle', 'Delete this plant?'),
            body: T(
              'app.plants.deleteBody',
              'Delete "{name}" and its journal trail?\n\nYour grow history is evidence — you can undo for a few seconds after.',
              { name: plant.name }
            ),
            confirmLabel: T('app.plants.deleteConfirm', 'Delete plant'),
            danger: true,
          })
        : window.confirm(
            T(
              'app.plants.deleteBodyShort',
              'Delete "{name}" and its journal trail?\n\nYou can undo for a few seconds after.',
              { name: plant.name }
            )
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
    showUndoToast(T('app.plants.deletedUndo', 'Plant deleted — undo available'), () => {
      setPlants(getPlants().concat([removedPlant]));
      setEntries(getEntries().concat(removedEntries));
      renderPlants();
      renderDashboard();
      fillEntryPlantSelect();
      fillJournalPlantFilter();
      if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
      if (window.DnevnikNotifications) {
        DnevnikNotifications.toast(T('app.plants.restored', 'Plant restored'), 'success');
      }
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
      if (submitBtn) submitBtn.textContent = T('app.form.save', 'Save');
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
      submitBtn.textContent = T('app.form.savePlant', 'Save plant');
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
    titleEl.textContent = editId
      ? T('app.form.editPlant', 'Edit plant')
      : T('app.form.newPlant', 'New plant');
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
          photoPreview.innerHTML = '<img src="' + p.photo + '" alt="' + escapeHtml(T('app.media.photoAlt', 'Photo')) + '" class="media-thumb" /> <button type="button" class="btn-remove-media">' + escapeHtml(T('app.media.remove', 'Remove')) + '</button>';
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
      return;
    }
    const claimBonus = e.target.closest('#activity-reward-claim');
    if (claimBonus) {
      e.preventDefault();
      showView('adopt');
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
        '<span class="media-error">' +
        escapeHtml(
          T(
            'app.photo.formatUnsupported',
            'Use a JPG or PNG photo (some phone formats like HEIC aren’t supported here).'
          )
        ) +
        '</span>';
      e.target.value = '';
      return;
    }
    photoPreview.innerHTML =
          '<span class="media-loading">' +
          escapeHtml(T('app.camera.preparing', 'Preparing photo…')) +
          '</span>';
    try {
      let dataUrl = await readFileAsDataUrl(file);
      dataUrl = await resizeImageDataUrl(dataUrl, MAX_IMAGE_SIZE);
      // Store the Storage URL, not the image. The preview keeps using the
      // local data URL so it appears instantly, without waiting on a fetch.
      const stored = await uploadJournalPhoto(dataUrl, 'plant');
      photoData.value = stored.url;
      photoPreview.innerHTML =
        '<img src="' +
        dataUrl +
        '" alt="' + escapeHtml(T('app.media.photoAlt', 'Photo')) + '" class="media-thumb" /> <button type="button" class="btn-remove-media">' + escapeHtml(T('app.media.remove', 'Remove')) + '</button>';
      appendPhotoWarning(photoPreview, stored.warning);
      photoPreview.querySelector('.btn-remove-media').addEventListener('click', () => {
        photoData.value = '';
        photoPreview.innerHTML = '';
        document.getElementById('plant-photo').value = '';
      });
    } catch (err) {
      photoData.value = '';
      photoPreview.innerHTML =
        '<span class="media-error">' +
        escapeHtml((err && err.message) || T('app.photo.couldNotLoad', 'Could not load photo.')) +
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
    if (fieldLocationVal) {
          locNoteSuffix +=
            ' ' +
            T('app.note.fieldLocation', 'Field location: {value}.', { value: fieldLocationVal });
        }
    if (plantingLocationVal) {
          locNoteSuffix +=
            ' ' +
            T('app.note.plantingLocation', 'Planting location: {value}.', {
              value: plantingLocationVal,
            });
        }

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
      let note0 = T('app.note.growStarted', 'Grow started — stage: {stage}', {
        stage: stageName(newStage),
      });
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
        let subNote = T('app.note.subphase', 'Sub-phase: {value}', {
        value: subphaseLabel(newSubphase),
      });
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
          T('app.note.stageTransition', 'Stage transition: {from} → {to}', {
            from: stageName(stageAtOpen),
            to: stageName(newStage),
          });
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
          T('app.note.subphaseTransition', 'Sub-phase transition: {from} → {to}', {
            from: fromLab,
            to: toLab,
          }) + (transitionNote ? '. ' + transitionNote : '') + locNoteSuffix;
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
      DnevnikNotifications.toast(
        id
          ? T('app.plants.updated', 'Plant updated')
          : T('app.plants.added', 'Plant added — {name}', { name: payload.name }),
        'success'
      );
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
            (err && err.message) ||
              T(
                'app.plants.mintNotStarted',
                'Plant saved, but on-chain mint did not start. Try Tokenise → advanced.'
              ),
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
      throw new Error(T('app.plants.mintUnavailable', 'Minting is not available yet.'));
    }
    const wallet = typeof PT.getWallet === 'function' ? PT.getWallet() : null;
    if (!wallet || !wallet.connected) {
      if (typeof PT.connect === 'function') {
        await PT.connect();
      } else if (window.SolanaWallet && typeof SolanaWallet.connect === 'function') {
        await SolanaWallet.connect();
      } else {
        throw new Error(
        T('app.plants.connectWalletFirst', 'Connect a Devnet wallet first, then mint from Tokenise.')
      );
      }
    }
    await PT.importSeed({
      name: String(plant.name || '').trim().slice(0, 32),
      strain: plant.strain || '',
      batch: '',
      plantId: plant.id,
    });
    if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
      DnevnikNotifications.toast(
        T('app.plants.mintStarted', 'Plant token mint started for {name}', { name: plant.name }),
        'success'
      );
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
    sel.innerHTML =
      '<option value="">' +
      escapeHtml(T('app.form.selectPlant', '-- Select a plant --')) +
      '</option>' +
      plants
        .map(function (p) {
          return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
        })
        .join('');
  }

  function fillJournalPlantFilter() {
    const sel = document.getElementById('journal-plant-filter');
    if (!sel) return;
    const prev = sel.value;
    const plants = getPlants();
    const Stacks = window.GrowtooStacks;
    let html =
      '<option value="">' + escapeHtml(T('app.form.allPlants', 'All plants')) + '</option>';
    if (Stacks && typeof Stacks.groupItems === 'function') {
      const groups = Stacks.groupItems(plants, plantStackAccessors());
      groups.forEach(function (g) {
        if (Stacks.shouldStack(g)) {
          const stageLab = Stacks.stageLabel(g.stage);
          html +=
            '<option value="stack:' +
            escapeHtml(g.key) +
            '">' +
            escapeHtml(g.name || g.strain || 'Plants') +
            ' · ' +
            escapeHtml(stageLab) +
            ' (all ' +
            g.members.length +
            ' rows)</option>';
        }
        g.members.forEach(function (p) {
          html +=
            '<option value="' +
            escapeHtml(p.id) +
            '">' +
            (Stacks.shouldStack(g) ? '  ' : '') +
            escapeHtml(p.name || T('app.stack.plant', 'Plant')) +
            '</option>';
        });
      });
    } else {
      html += plants
        .map(function (p) {
          return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
        })
        .join('');
    }
    sel.innerHTML = html;
    if (prev) {
      const ok =
        prev === '' ||
        plants.some(function (p) {
          return p && p.id === prev;
        }) ||
        (prev.indexOf('stack:') === 0 &&
          Stacks &&
          Stacks.groupItems(plants, plantStackAccessors()).some(function (g) {
            return 'stack:' + g.key === prev;
          }));
      if (ok) sel.value = prev;
    }
  }

  function journalFilterPlantIds(filter) {
    const raw = String(filter || '');
    if (!raw) return null;
    if (raw.indexOf('stack:') === 0) {
      const key = raw.slice(6);
      const plants = getPlants();
      const Stacks = window.GrowtooStacks;
      if (!Stacks || typeof Stacks.groupItems !== 'function') return [];
      const group = Stacks.groupItems(plants, plantStackAccessors()).find(function (g) {
        return g.key === key;
      });
      return group
        ? group.members.map(function (p) {
            return String(p.id);
          })
        : [];
    }
    return [raw];
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

  function journalViewIsMonth() {
    return !!(window.GrowtooCalendar && GrowtooCalendar.getView() === 'month');
  }

  function syncJournalViewToggle() {
    const view = journalViewIsMonth() ? 'month' : 'list';
    const toggle = document.getElementById('journal-view-toggle');
    if (toggle) {
      toggle.setAttribute('data-active', view);
      toggle.querySelectorAll('[data-journal-view]').forEach(function (btn) {
        const on = btn.getAttribute('data-journal-view') === view;
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    const cal = document.getElementById('journal-calendar');
    if (cal) cal.hidden = view !== 'month';
  }

  function plantsForJournalFilter(plants, filterIds) {
    if (!filterIds || !filterIds.length) return plants || [];
    const allow = Object.create(null);
    filterIds.forEach(function (id) {
      allow[String(id)] = true;
    });
    return (plants || []).filter(function (p) {
      return p && allow[String(p.id)];
    });
  }

  function syncJournalFreshChrome() {
    const view = document.getElementById('view-plants');
    if (!view) return;
    view.classList.toggle('view-plants--fresh', getPlants().length === 0);
  }

  function journalMonthNextStep(plants, entries) {
    if (entries && entries.length) return null;
    const list = plants || [];
    if (!list.length) return null;
    let title = '';
    try {
      if (window.CoachCore && typeof CoachCore.todayHeadline === 'function') {
        title = CoachCore.todayHeadline(list, entries) || '';
      }
    } catch (e) {
      title = '';
    }
    if (!title) {
      const name = (list[0] && list[0].name) || T('app.stack.plant', 'Plant');
      title = T('app.coach.railFirstWater', '{plant} is waiting for a first watering.', {
        plant: name,
      });
    }
    return {
      kind: 'first-water',
      kicker: T('app.calendar.emptyKicker', 'Journal'),
      title: title,
      body: T(
        'app.calendar.emptyFirstBody',
        'One next step — the same cue Coach uses.'
      ),
      cta: T('app.calendar.logFirstWater', 'Log first watering'),
    };
  }

  function renderJournalCalendar(entries, plants, filterIds) {
    const host = document.getElementById('journal-calendar');
    syncJournalFreshChrome();
    syncJournalViewToggle();
    if (!journalViewIsMonth() || !host || !window.GrowtooCalendar) return;
    const scoped = plantsForJournalFilter(plants, filterIds);
    GrowtooCalendar.render(host, {
      entries: entries,
      plants: plants,
      filterIds: filterIds,
      nextStep: journalMonthNextStep(scoped, entries),
      onChange: renderJournal,
      onSelectDay: function (ymd, info) {
        GrowtooCalendar.setSelectedDate(ymd);
        renderJournal();
        if (info && info.log) openLogSheet(null, { date: ymd });
      },
      onNextStep: function (kind) {
        if (kind === 'add-plant') {
          if (blockAdminWrite()) return;
          openPlantModal();
          return;
        }
        const ymd =
          (window.GrowtooCalendar &&
            typeof GrowtooCalendar.todayYmd === 'function' &&
            GrowtooCalendar.todayYmd()) ||
          null;
        openLogSheet('water', { date: ymd });
      },
    });
  }

  function renderJournal() {
    fillJournalPlantFilter();
    const filterEl = document.getElementById('journal-plant-filter');
    const filter = filterEl ? filterEl.value : '';
    let entries = getEntries();
    const filterIds = journalFilterPlantIds(filter);
    if (filterIds) {
      const allow = Object.create(null);
      filterIds.forEach(function (id) {
        allow[String(id)] = true;
      });
      entries = entries.filter(function (e) {
        return e && allow[String(e.plantId)];
      });
    }
    entries.sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    const container = document.getElementById('journal-entries');
    const plants = getPlants();
    const plantById = Object.create(null);
    plants.forEach(function (p) {
      if (p && p.id) plantById[String(p.id)] = p;
    });

    renderJournalCalendar(entries, plants, filterIds);
    const trailEmpty = entries.length === 0;
    if (journalViewIsMonth() && window.GrowtooCalendar) {
      const ymd = GrowtooCalendar.selectedDate();
      entries = entries.filter(function (e) {
        return String(e.date || '').slice(0, 10) === ymd;
      });
    }

    if (!container) return;
    if (entries.length === 0) {
      if (journalViewIsMonth()) {
        container.innerHTML = trailEmpty
          ? ''
          : '<p class="journal-cal-empty">' +
            escapeHtml(T('app.calendar.noLogsToday', 'No logs on this day.')) +
            '</p>';
      } else {
        container.innerHTML = emptyStateHtml({
          icon: 'journal',
          lead: 'No entries yet',
          body: T('app.journal.emptyBody', 'Log watering, feeding, or a note to start the trail.'),
          ctaId: 'empty-add-entry',
          ctaLabel: T('app.journal.newEntry', '+ New entry'),
        });
      }
      return;
    }

    function entryCardHtml(e) {
      const plant = plantById[String(e.plantId)];
      const plantName = escapeHtml(plant ? plant.name : 'Plant');
      const date = e.date ? new Date(e.date).toLocaleDateString(intlTag()) : '';
      const typeLabel = escapeHtml(entryTypeName(e.type));
      const viaTools = entrySourceBadgeHtml(e);
      const noteText = displayEntryNote(e.note);
      const media = [];
      if (e.photo) {
        media.push(
          '<div class="entry-media entry-photo"><img src="' +
            escapeHtml(e.photo) +
            '" alt="Photo" /></div>'
        );
      }
      if (e.video) {
        media.push(
          '<div class="entry-media entry-video"><video src="' +
            escapeHtml(e.video) +
            '" controls></video></div>'
        );
      }
      let metaHtml = toolboxMeasurementMetaHtml(e);
      if (e.meta) {
        if (e.meta.faza) {
          const m = e.meta.faza;
          const parts = [];
          if (m.from) {
            parts.push(
              T('app.entry.from', 'From: {stage}', {
                stage: escapeHtml(stageName(m.from) || m.from || '—'),
              })
            );
          }
          parts.push(
            T('app.entry.to', 'To: {stage}', {
              stage: escapeHtml(stageName(m.to) || m.to || '—'),
            })
          );
          if (parts.length) {
            metaHtml +=
              '<div class="entry-meta-block"><strong>' +
              escapeHtml(T('app.entry.stageTransitionLabel', 'Stage transition')) +
              '</strong><ul><li>' +
              parts.join('</li><li>') +
              '</li></ul></div>';
          }
          if (e.meta.fieldLocation) {
            metaHtml +=
              '<div class="entry-meta-block"><strong>' +
              escapeHtml(T('app.entry.fieldLocationLabel', 'Field location')) +
              '</strong><p>' +
              escapeHtml(e.meta.fieldLocation) +
              '</p></div>';
          }
          if (e.meta.plantingLocation) {
            metaHtml +=
              '<div class="entry-meta-block"><strong>' +
              escapeHtml(T('app.entry.plantingLocationLabel', 'Planting location')) +
              '</strong><p>' +
              escapeHtml(e.meta.plantingLocation) +
              '</p></div>';
          }
        }
        if (e.meta.podfaza) {
          const m = e.meta.podfaza;
          const parts = [];
          if (m.from)
            parts.push(
              escapeHtml(T('app.entry.from', 'From: {stage}', { stage: subphaseLabel(m.from) }))
            );
          parts.push(
            escapeHtml(
              T('app.entry.to', 'To: {stage}', {
                stage: subphaseLabel(m.to) || m.to || '—',
              })
            )
          );
          if (parts.length) {
            metaHtml +=
              '<div class="entry-meta-block"><strong>' +
              escapeHtml(T('app.entry.subphaseTransitionLabel', 'Sub-phase transition')) +
              '</strong><ul><li>' +
              parts.join('</li><li>') +
              '</li></ul></div>';
          }
          if (e.meta.fieldLocation) {
            metaHtml +=
              '<div class="entry-meta-block"><strong>' +
              escapeHtml(T('app.entry.fieldLocationLabel', 'Field location')) +
              '</strong><p>' +
              escapeHtml(e.meta.fieldLocation) +
              '</p></div>';
          }
          if (e.meta.plantingLocation) {
            metaHtml +=
              '<div class="entry-meta-block"><strong>' +
              escapeHtml(T('app.entry.plantingLocationLabel', 'Planting location')) +
              '</strong><p>' +
              escapeHtml(e.meta.plantingLocation) +
              '</p></div>';
          }
        }
        if (e.meta.presadjivanje) {
          const m = e.meta.presadjivanje;
          const parts = [];
          if (m.soilQuality)
            parts.push(
              escapeHtml(T('app.entry.soilQuality', 'Soil quality: {value}', { value: m.soilQuality }))
            );
          if (m.plantAge)
            parts.push(
              escapeHtml(T('app.entry.plantAge', 'Plant age: {value}', { value: m.plantAge }))
            );
          if (m.plantCondition)
            parts.push(
              escapeHtml(
                T('app.entry.plantCondition', 'Plant condition: {value}', { value: m.plantCondition })
              )
            );
          if (parts.length) {
            metaHtml +=
              '<div class="entry-meta-block"><strong>' +
              escapeHtml(T('app.entry.transplantingLabel', 'Transplanting')) +
              '</strong><ul><li>' +
              parts.join('</li><li>') +
              '</li></ul></div>';
          }
        }
        if (e.meta.stresori) {
          const m = e.meta.stresori;
          const parts = [];
          if (m.temperature)
            parts.push(
              escapeHtml(T('app.entry.temperature', 'Temperature: {value}', { value: m.temperature }))
            );
          if (m.humidity)
            parts.push(
              escapeHtml(T('app.entry.humidity', 'Humidity: {value}', { value: m.humidity }))
            );
          if (m.vpd)
            parts.push(escapeHtml(T('app.entry.vpd', 'VPD: {value}', { value: m.vpd })));
          if (m.pests)
            parts.push(escapeHtml(T('app.entry.pests', 'Pests: {value}', { value: m.pests })));
          if (parts.length) {
            metaHtml +=
              '<div class="entry-meta-block"><strong>' +
              escapeHtml(T('app.entry.stressorsLabel', 'Stressors')) +
              '</strong><ul><li>' +
              parts.join('</li><li>') +
              '</li></ul></div>';
          }
        }
      }
      const deletable = !isSharedPlantId(e.plantId);
      const entryHtml =
        '<div class="journal-entry' +
        (isToolboxMirroredEntry(e) ? ' journal-entry--from-tools' : '') +
        '" data-entry-id="' +
        escapeHtml(e.id) +
        '">' +
        '<div class="entry-meta">' +
        '<span class="entry-type">' +
        typeLabel +
        '</span>' +
        viaTools +
        plantName +
        ' · ' +
        date +
        (deletable
          ? '<button type="button" class="btn btn-ghost btn-sm btn-delete-entry" aria-label="' +
            escapeHtml(T('app.entry.deleteAria', 'Delete entry')) +
            '">' +
            escapeHtml(T('app.entry.delete', 'Delete')) +
            '</button>'
          : '') +
        '</div>' +
        '<div class="entry-note">' +
        escapeHtml(noteText) +
        '</div>' +
        (function () {
          const coachNote =
            window.AICoach && typeof AICoach.getEntryNote === 'function'
              ? AICoach.getEntryNote(e.id)
              : '';
          if (!coachNote) return '';
          return (
            '<p class="entry-coach-note"><span class="entry-coach-note-label">' +
            escapeHtml(T('app.entry.coachLabel', 'Coach')) +
            '</span> ' +
            escapeHtml(coachNote) +
            '</p>'
          );
        })() +
        (metaHtml ? '<div class="entry-meta-blocks">' + metaHtml + '</div>' : '') +
        (media.length ? '<div class="entry-media-wrap">' + media.join('') + '</div>' : '') +
        '</div>';
      return deletable
        ? '<div class="journal-swipe">' +
            '<div class="journal-swipe-actions">' +
            '<button type="button" class="journal-swipe-delete" tabindex="-1" aria-hidden="true">' +
            escapeHtml(T('app.entry.delete', 'Delete')) +
            '</button>' +
            '</div>' +
            entryHtml +
            '</div>'
        : entryHtml;
    }

    const Stacks = window.GrowtooStacks;
    const singlePlantFilter = filterIds && filterIds.length === 1 && String(filter || '').indexOf('stack:') !== 0;
    if (!Stacks || typeof Stacks.groupItems !== 'function' || singlePlantFilter) {
      container.innerHTML = entries.map(entryCardHtml).join('');
      bindJournalRowActions(container);
      return;
    }

    const plantGroups = Stacks.groupItems(plants, plantStackAccessors());
    const groupByKey = Object.create(null);
    plantGroups.forEach(function (g) {
      groupByKey[g.key] = g;
    });

    const entryBuckets = Object.create(null);
    const bucketOrder = [];
    entries.forEach(function (e) {
      const plant = plantById[String(e.plantId)];
      const key = plant
        ? Stacks.groupKey({
            strain: plant.strain,
            name: plant.name,
            stage: plant.stage,
          })
        : 'unknown|' + String(e.plantId || '');
      if (!entryBuckets[key]) {
        entryBuckets[key] = [];
        bucketOrder.push(key);
      }
      entryBuckets[key].push(e);
    });

    container.innerHTML = bucketOrder
      .map(function (key) {
        const bucket = entryBuckets[key] || [];
        const membersHtml = bucket.map(entryCardHtml).join('');
        const plantGroup = groupByKey[key];
        const distinctIds = Object.create(null);
        bucket.forEach(function (e) {
          if (e && e.plantId) distinctIds[String(e.plantId)] = true;
        });
        const rowCount = Object.keys(distinctIds).length;
        const shouldWrap =
          plantGroup && Stacks.shouldStack(plantGroup)
            ? true
            : rowCount > 1;
        if (!shouldWrap) return membersHtml;

        const faceGroup = plantGroup || {
          key: key,
          name: (plantById[Object.keys(distinctIds)[0]] || {}).name || 'Plants',
          strain: (plantById[Object.keys(distinctIds)[0]] || {}).strain || '',
          stage: key.split('|')[1] || '',
          size: rowCount,
          members: Object.keys(distinctIds).map(function (id) {
            return plantById[id] || { id: id };
          }),
        };
        return Stacks.wrapStackHtml(faceGroup, membersHtml, {
          surface: 'journal',
          meta:
            (faceGroup.strain ? escapeHtml(faceGroup.strain) + ' · ' : '') +
            escapeHtml(Stacks.stageLabel(faceGroup.stage)) +
            ' · ' +
            rowCount +
            ' row' +
            (rowCount === 1 ? '' : 's') +
            ' · ' +
            bucket.length +
            ' entr' +
            (bucket.length === 1 ? 'y' : 'ies'),
          photo: Stacks.firstPhoto(faceGroup.members || []),
        });
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
            title: T('app.entry.deleteTitle', 'Delete journal entry?'),
            body: T(
              'app.entry.deleteBody',
              'Remove this entry from your grow trail?\n\nYou can undo for a few seconds after.'
            ),
            confirmLabel: T('app.entry.deleteConfirm', 'Delete entry'),
            danger: true,
          })
        : window.confirm(
            T(
              'app.entry.deleteFallback',
              'Delete this journal entry?\n\nYour grow trail matters — you can undo for a few seconds after.'
            )
          );
    if (!ok) return;
    const removed = JSON.parse(JSON.stringify(entry));
    setEntries(getEntries().filter((e) => e.id !== entryId));
    renderJournal();
    renderDashboard();
    if (currentGrowlogPlantId === removed.plantId) renderGrowlog(removed.plantId);
    showUndoToast(T('app.entry.deletedUndo', 'Entry deleted — undo available'), () => {
      setEntries(getEntries().concat([removed]));
      renderJournal();
      renderDashboard();
      if (currentGrowlogPlantId === removed.plantId) renderGrowlog(removed.plantId);
      if (window.DnevnikNotifications) DnevnikNotifications.toast(T('app.entry.restored', 'Entry restored'), 'success');
    });
  }

  const journalPlantFilterEl = document.getElementById('journal-plant-filter');
  if (journalPlantFilterEl) journalPlantFilterEl.addEventListener('change', renderJournal);

  (function bindJournalViewToggle() {
    const toggle = document.getElementById('journal-view-toggle');
    if (!toggle || toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';
    toggle.querySelectorAll('[data-journal-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const view = btn.getAttribute('data-journal-view');
        if (window.GrowtooCalendar) GrowtooCalendar.setView(view);
        syncJournalViewToggle();
        renderJournal();
      });
    });
    syncJournalViewToggle();
  })();

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
   * @param {{ plantId?: string|null, plantIds?: string[]|null, type?: string|null, date?: string|null }} [opts]
   */
  function startJournalEntry(opts) {
    const o = opts || {};
    const plantIds =
      Array.isArray(o.plantIds) && o.plantIds.length
        ? o.plantIds.map(String)
        : o.plantId
          ? [String(o.plantId)]
          : null;
    if (plantIds && plantIds.length) {
      if (plantIds.some(function (id) {
        return blockWrite({ plantId: id });
      })) {
        return;
      }
    } else if (blockAdminWrite()) {
      return;
    }
    openEntryModal(plantIds && plantIds.length === 1 ? plantIds[0] : null, Object.assign({}, o, {
      plantIds: plantIds && plantIds.length > 1 ? plantIds : plantIds,
    }));
  }

  function entryPlantCheckHtml(opts) {
    const o = opts || {};
    const selected = !!o.selected;
    return (
      '<label class="entry-plant-check' +
      (o.stack ? ' entry-plant-check--stack' : '') +
      (selected ? ' is-selected' : '') +
      '">' +
      '<input type="checkbox"' +
      (o.stackKey
        ? ' data-entry-stack-key="' + escapeHtml(o.stackKey) + '"'
        : ' data-entry-plant-id="' + escapeHtml(String(o.id || '')) + '"') +
      (selected ? ' checked' : '') +
      ' />' +
      '<span>' +
      escapeHtml(o.label || T('app.stack.plant', 'Plant')) +
      (o.meta ? ' <em>' + escapeHtml(o.meta) + '</em>' : '') +
      '</span></label>'
    );
  }

  function renderEntryPlantsMulti(selectedIds, locked) {
    const wrap = document.getElementById('entry-plants-multi');
    const list = document.getElementById('entry-plants-multi-list');
    const singleLabel = document.getElementById('entry-plant-label');
    const singleSel = document.getElementById('entry-plant');
    if (!wrap || !list) return;
    const plants = loggablePlants();
    const selected = normalizeSelectedPlantIds(selectedIds || [], plants);
    const useMulti = !locked && plants.length > 1;

    if (!useMulti) {
      wrap.hidden = true;
      list.innerHTML = '';
      if (singleLabel) singleLabel.hidden = false;
      if (singleSel) {
        singleSel.required = true;
        singleSel.hidden = false;
      }
      entryModalPlantIds = null;
      return;
    }

    if (singleLabel) singleLabel.hidden = true;
    if (singleSel) {
      singleSel.required = false;
      singleSel.hidden = true;
      singleSel.value = selected[0] || '';
    }
    wrap.hidden = false;
    entryModalPlantIds = selected.length ? selected.slice() : plants[0] ? [String(plants[0].id)] : [];

    const selectedSet = Object.create(null);
    entryModalPlantIds.forEach(function (id) {
      selectedSet[id] = true;
    });
    const groups = groupLoggablePlants(plants);
    const Stacks = window.GrowtooStacks;

    list.innerHTML = groups
      .map(function (g) {
        const ids = g.members.map(function (p) {
          return String(p.id);
        });
        const allOn = ids.every(function (id) {
          return selectedSet[id];
        });
        /* One journal row is one checkbox — never a nested "all 1 rows" stack. */
        if (ids.length < 2 || !(Stacks && Stacks.shouldStack(g))) {
          const p = g.members[0];
          return entryPlantCheckHtml({
            id: String(p.id),
            label: p.name,
            selected: !!selectedSet[String(p.id)],
          });
        }
        const stageLab =
          Stacks && typeof Stacks.stageLabel === 'function'
            ? Stacks.stageLabel(g.stage)
            : g.stage || '';
        const title = (g.name || g.strain || T('app.stack.plants', 'Plants')) + ' · ' + stageLab;
        return (
          '<div class="entry-plant-stack">' +
          entryPlantCheckHtml({
            stack: true,
            stackKey: g.key,
            label: title,
            meta: T('app.entry-plants-multi.allRows', 'all {count} rows', {
              count: g.members.length,
            }),
            selected: allOn,
          }) +
          '<div class="entry-plant-stack-members">' +
          g.members
            .map(function (p) {
              return entryPlantCheckHtml({
                id: String(p.id),
                label: p.name,
                selected: !!selectedSet[String(p.id)],
              });
            })
            .join('') +
          '</div></div>'
        );
      })
      .join('');

    function syncFromDom() {
      const ids = [];
      list.querySelectorAll('[data-entry-plant-id]').forEach(function (input) {
        if (input.checked) ids.push(String(input.getAttribute('data-entry-plant-id')));
      });
      entryModalPlantIds = ids;
      if (singleSel && ids[0]) singleSel.value = ids[0];
      list.querySelectorAll('.entry-plant-check').forEach(function (lab) {
        const input = lab.querySelector('input');
        lab.classList.toggle('is-selected', !!(input && input.checked));
      });
    }

    list.querySelectorAll('[data-entry-plant-id]').forEach(function (input) {
      input.addEventListener('change', syncFromDom);
    });
    list.querySelectorAll('[data-entry-stack-key]').forEach(function (input) {
      input.addEventListener('change', function () {
        const key = input.getAttribute('data-entry-stack-key') || '';
        const group = groups.find(function (g) {
          return g.key === key;
        });
        if (!group) return;
        group.members.forEach(function (p) {
          const el = list.querySelector(
            '[data-entry-plant-id="' + String(p.id).replace(/"/g, '') + '"]'
          );
          if (el) el.checked = input.checked;
        });
        syncFromDom();
      });
    });
  }

  function openEntryModal(plantId, opts) {
    const o = opts || {};
    if (plantId && blockWrite({ plantId })) return;
    if (!modalEntry) return;
    fillEntryPlantSelect();
    const form = document.getElementById('form-entry');
    if (form) form.reset();
    const dateEl = document.getElementById('entry-date');
    if (dateEl) {
      const raw = o.date ? String(o.date).slice(0, 10) : '';
      dateEl.value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDateYYYYMMDD();
    }
    document.getElementById('entry-photo-data').value = '';
    document.getElementById('entry-video-data').value = '';
    document.getElementById('entry-photo-preview').innerHTML = '';
    document.getElementById('entry-video-preview').innerHTML = '';
    const plantSelect = document.getElementById('entry-plant');
    const multiIds =
      Array.isArray(o.plantIds) && o.plantIds.length
        ? o.plantIds.map(String)
        : plantId
          ? [String(plantId)]
          : [];
    const lockSelect = !!(o.lockPlant || (plantId && !o.plantIds && currentGrowlogPlantId && String(currentGrowlogPlantId) === String(plantId)));
    if (plantSelect) {
      if (plantId) plantSelect.value = plantId;
      plantSelect.disabled = lockSelect;
    }
    renderEntryPlantsMulti(
      multiIds.length ? multiIds : plantId ? [plantId] : [],
      lockSelect
    );
    const typeSel = document.getElementById('entry-type');
    if (typeSel && o.type) {
      const wanted = String(o.type);
      const hasOption = Array.from(typeSel.options || []).some(function (opt) {
        return opt && opt.value === wanted;
      });
      if (hasOption) typeSel.value = wanted;
    }
    if (o.note != null) {
      const noteEl = document.getElementById('entry-note');
      if (noteEl) noteEl.value = String(o.note);
    }
    if (o.photo) {
      const photoData = document.getElementById('entry-photo-data');
      const photoPreview = document.getElementById('entry-photo-preview');
      if (photoData) photoData.value = String(o.photo);
      if (photoPreview) {
        photoPreview.innerHTML =
          '<img src="' +
          String(o.photo).replace(/"/g, '&quot;') +
          '" alt="Entry photo" />';
      }
    }
    updateEntryExtraVisibility();
    modalEntry.classList.add('open');
  }

  const btnAddEntry = document.getElementById('btn-add-entry');
  if (btnAddEntry) {
    btnAddEntry.addEventListener('click', () => {
      const date =
        journalViewIsMonth() && window.GrowtooCalendar
          ? GrowtooCalendar.selectedDate()
          : null;
      startJournalEntry({ plantId: null, date: date || undefined });
    });
  }

  const btnAddEntryGrowlog = document.getElementById('btn-add-entry-growlog');
  if (btnAddEntryGrowlog) {
    btnAddEntryGrowlog.addEventListener('click', () => {
      if (!currentGrowlogPlantId) return;
      startJournalEntry({ plantId: currentGrowlogPlantId, lockPlant: true });
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

  const plantsOpenStories = document.getElementById('plants-open-stories');
  if (plantsOpenStories && !plantsOpenStories.dataset.bound) {
    plantsOpenStories.dataset.bound = '1';
    plantsOpenStories.addEventListener('click', function (e) {
      e.preventDefault();
      openStoriesComposer();
    });
  }

  const dashboardWriteStory = document.getElementById('dashboard-write-story');
  if (dashboardWriteStory && !dashboardWriteStory.dataset.bound) {
    dashboardWriteStory.dataset.bound = '1';
    dashboardWriteStory.addEventListener('click', function (e) {
      e.preventDefault();
      openStoriesComposer();
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
        city
          ? T(
              'app.coach.askForecastCity',
              'Based on the forecast for {city}, what should I change about watering and feeding over the next few days?',
              { city: city }
            )
          : T(
              'app.coach.askForecast',
              'Based on the forecast, what should I change about watering and feeding over the next few days?'
            )
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
            T(
              'app.coach.askPlantNext',
              'What should I do next for "{plant}" in stage {stage}? Include tokenisation tips.',
              {
                plant: plant.name,
                stage: stageName(plant.stage) || T('app.coach.stageUnknown', 'unknown'),
              }
            )
          );
        }
      }
    });
  }

  const entryPhotoCamera = document.getElementById('entry-photo-camera');
  if (entryPhotoCamera) {
    entryPhotoCamera.addEventListener('click', function () {
      const plantSelect = document.getElementById('entry-plant');
      const plantId =
        (plantSelect && plantSelect.value) || currentGrowlogPlantId || null;
      if (!window.GrowCamera || typeof GrowCamera.open !== 'function') {
        const input = document.getElementById('entry-photo');
        if (input) input.click();
        return;
      }
      GrowCamera.open({
        source: 'entry-modal',
        plantId: plantId,
        onLog: function (payload) {
          const dataUrl = payload && payload.dataUrl;
          if (!dataUrl) return;
          const dataEl = document.getElementById('entry-photo-data');
          const previewEl = document.getElementById('entry-photo-preview');
          if (dataEl) dataEl.value = dataUrl;
          if (previewEl) {
            previewEl.innerHTML =
              '<img src="' +
              dataUrl +
              '" alt="' + escapeHtml(T('app.media.photoAlt', 'Photo')) + '" class="media-thumb" /> <button type="button" class="btn-remove-media">' + escapeHtml(T('app.media.remove', 'Remove')) + '</button>';
            const removeBtn = previewEl.querySelector('.btn-remove-media');
            if (removeBtn) {
              removeBtn.addEventListener('click', function () {
                if (dataEl) dataEl.value = '';
                previewEl.innerHTML = '';
              });
            }
          }
          if (!modalEntry.classList.contains('open')) {
            startJournalEntry({
              plantId: (payload && payload.plantId) || plantId,
              type: 'opcenito',
              photo: dataUrl,
              note: T('app.camera.photoNote', 'Photo log from plant camera'),
            });
          }
        },
      });
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
        '<span class="media-error">' +
        escapeHtml(
          T(
            'app.photo.formatUnsupported',
            'Use a JPG or PNG photo (some phone formats like HEIC aren’t supported here).'
          )
        ) +
        '</span>';
      e.target.value = '';
      return;
    }
    previewEl.innerHTML =
      '<span class="media-loading">' +
      escapeHtml(T('app.photo.preparing', 'Preparing photo…')) +
      '</span>';
    try {
      let dataUrl = await readFileAsDataUrl(file);
      dataUrl = await resizeImageDataUrl(dataUrl, MAX_IMAGE_SIZE);
      // Store the Storage URL, not the image. The preview keeps using the
      // local data URL so it appears instantly, without waiting on a fetch.
      const stored = await uploadJournalPhoto(dataUrl, 'entry');
      dataEl.value = stored.url;
      previewEl.innerHTML =
        '<img src="' +
        dataUrl +
        '" alt="' + escapeHtml(T('app.media.photoAlt', 'Photo')) + '" class="media-thumb" /> <button type="button" class="btn-remove-media">' + escapeHtml(T('app.media.remove', 'Remove')) + '</button>';
      appendPhotoWarning(previewEl, stored.warning);
      previewEl.querySelector('.btn-remove-media').addEventListener('click', () => {
        dataEl.value = '';
        previewEl.innerHTML = '';
        document.getElementById('entry-photo').value = '';
      });
    } catch (err) {
      dataEl.value = '';
      previewEl.innerHTML =
        '<span class="media-error">' +
        escapeHtml((err && err.message) || T('app.photo.readFailed', 'Could not load photo.')) +
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
        '<span class="media-error">' +
        escapeHtml(
          T(
            'app.video.formatUnsupported',
            'Use an MP4 or WebM video (this file type isn’t supported here).'
          )
        ) +
        '</span>';
      e.target.value = '';
      return;
    }
    const maxBytes = MAX_VIDEO_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      previewEl.innerHTML =
        '<span class="media-error">' +
        escapeHtml(
          T('app.video.tooLarge', 'Video too large (max {mb} MB for local storage).', {
            mb: MAX_VIDEO_SIZE_MB,
          })
        ) +
        '</span>';
      dataEl.value = '';
      document.getElementById('entry-video').value = '';
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      dataEl.value = dataUrl;
      previewEl.innerHTML =
        '<video src="' +
        dataUrl +
        // i18n-ignore — markup only
        '" controls class="media-thumb-video"></video> <button type="button" class="btn-remove-media">' +
        escapeHtml(T('app.media.remove', 'Remove')) +
        '</button>';
      previewEl.querySelector('.btn-remove-media').addEventListener('click', () => {
        dataEl.value = '';
        previewEl.innerHTML = '';
        document.getElementById('entry-video').value = '';
      });
    } catch (err) {
      previewEl.innerHTML =
        '<span class="media-error">' +
        escapeHtml(T('app.media.loadError', 'Error while loading.')) +
        '</span>';
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
      const multiWrap = document.getElementById('entry-plants-multi');
      const multiActive = multiWrap && !multiWrap.hidden;
      const plantIdsForEntry = multiActive
        ? normalizeSelectedPlantIds(entryModalPlantIds || [], loggablePlants())
        : plantIdForEntry
          ? [plantIdForEntry]
          : [];
      saveJournalEntriesBatch(plantIdsForEntry, {
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
      const msg = (err && err.message) || T('app.entry.saveFailed', 'Could not save journal entry.');
      if (window.DnevnikNotifications && typeof DnevnikNotifications.toast === 'function') {
        // Tone comes off the error code — the message is translated, so matching
        // its text would only work in English.
        DnevnikNotifications.toast(msg, err && err.code === 'no-plant' ? 'warn' : 'error');
      } else {
        paperNote({
          title: T('app.entry.saveFailed', 'Could not save journal entry.'),
          body: msg,
        });
      }
      return;
    }
    entryModalPlantIds = null;
    const plantSelect = document.getElementById('entry-plant');
    if (plantSelect) {
      plantSelect.disabled = false;
      plantSelect.hidden = false;
      plantSelect.required = true;
    }
    const plantLabel = document.getElementById('entry-plant-label');
    if (plantLabel) plantLabel.hidden = false;
    const multiEl = document.getElementById('entry-plants-multi');
    if (multiEl) multiEl.hidden = true;
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
      note = ml
        ? T('app.tools.noteVia', '{note} (via Tools)', { note: ml })
        : T('app.tools.wateringLogged', 'Watering logged via Tools');
      metaExtra = { amountMl: item.value1 || null };
    } else if (tool === 'feeding') {
      type = 'gnojidba';
      const parts = [item.value1, item.value2].filter(Boolean).map(String);
      note = T('app.tools.noteVia', '{note} (via Tools)', {
        note: parts.length ? parts.join(' — ') : T('app.entryType.feeding', 'Feeding'),
      });
      metaExtra = { product: item.value1 || null, detail: item.value2 || null };
    } else if (tool === 'environment') {
      type = 'okolis';
      const bits = [];
      if (item.value1) bits.push(String(item.value1) + '°C');
      if (item.value2) bits.push(String(item.value2) + '% RH');
      if (item.value3) bits.push('pH ' + String(item.value3));
      note = T('app.tools.noteVia', '{note} (via Tools)', {
        note: bits.length ? bits.join(' · ') : T('app.tools.environmentReading', 'Environment reading'),
      });
      metaExtra = {
        temperatureC: item.value1 || null,
        humidityPct: item.value2 || null,
        ph: item.value3 || null,
      };
    } else if (tool === 'transplant') {
      type = 'presadjivanje';
      const bits = [];
      if (item.soilQuality)
        bits.push(T('app.tools.soilShort', 'Soil: {value}', { value: item.soilQuality }));
      if (item.plantAge) bits.push(T('app.tools.ageShort', 'Age: {value}', { value: item.plantAge }));
      if (item.plantCondition)
        bits.push(T('app.tools.conditionShort', 'Condition: {value}', { value: item.plantCondition }));
      note = T('app.tools.noteVia', '{note} (via Tools)', {
        note: bits.length ? bits.join(' · ') : T('app.tools.transplant', 'Transplant'),
      });
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
      if (item.temperature)
        bits.push(T('app.tools.tempShort', 'Temp: {value}', { value: item.temperature }));
      if (item.humidity)
        bits.push(T('app.entry.humidity', 'Humidity: {value}', { value: item.humidity }));
      if (item.vpd) bits.push(T('app.entry.vpd', 'VPD: {value}', { value: item.vpd }));
      if (item.pests) bits.push(T('app.entry.pests', 'Pests: {value}', { value: item.pests }));
      note = T('app.tools.noteVia', '{note} (via Tools)', {
        note: bits.length ? bits.join(' · ') : T('app.tools.stressorNote', 'Stressor note'),
      });
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
          (err && err.message) ||
            T('app.tools.mirrorFailed', 'Saved in Tools, but journal trail did not update.'),
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
      const first = sel.options[0]
        ? sel.options[0].outerHTML
        : '<option value="">' + escapeHtml(T('app.tools.selectPlant', '-- Select a plant --')) + '</option>';
      sel.innerHTML = first + options;
    });

    const graphsSel = document.getElementById('tool-graphs-plant');
    if (graphsSel) {
      const first = graphsSel.options[0]
        ? graphsSel.options[0].outerHTML
        : '<option value="">' + escapeHtml(T('app.tools.allPlants', 'All plants')) + '</option>';
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
      listEl.innerHTML =
        '<p class="toolbox-empty">' +
        escapeHtml(T('app.tools.listEmpty', 'No entries yet. Add the first one.')) +
        '</p>';
      return;
    }
    const plants = getPlants();
    const plantById = new Map(plants.map((p) => [p.id, p.name]));
    const plantLabel = (plantId) => {
      if (!plantId) return '—';
      return plantById.get(plantId) || T('app.tools.plantFallback', 'Plant');
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
          if (item.soilQuality)
            parts.push(
              escapeHtml(
                T('app.entry.soilQuality', 'Soil quality: {value}', { value: String(item.soilQuality) })
              )
            );
          if (item.plantAge)
            parts.push(
              escapeHtml(T('app.tools.ageShort', 'Age: {value}', { value: String(item.plantAge) }))
            );
          if (item.plantCondition)
            parts.push(
              escapeHtml(
                T('app.tools.conditionShort', 'Condition: {value}', {
                  value: String(item.plantCondition),
                })
              )
            );
          parts.push(
            escapeHtml(T('app.tools.plantLabel', 'Plant: {name}', { name: plantLabel(item.plantId) }))
          );
          valuesStr = parts.join(' · ') || '-';
        } else if (tool === 'stressors') {
          const parts = [];
          if (item.temperature)
            parts.push(
              escapeHtml(
                T('app.entry.temperature', 'Temperature: {value}', {
                  value: String(item.temperature),
                })
              )
            );
          if (item.humidity)
            parts.push(
              escapeHtml(T('app.entry.humidity', 'Humidity: {value}', { value: String(item.humidity) }))
            );
          if (item.vpd)
            parts.push(escapeHtml(T('app.entry.vpd', 'VPD: {value}', { value: String(item.vpd) })));
          if (item.pests)
            parts.push(
              escapeHtml(T('app.entry.pests', 'Pests: {value}', { value: String(item.pests) }))
            );
          parts.push(
            escapeHtml(T('app.tools.plantLabel', 'Plant: {name}', { name: plantLabel(item.plantId) }))
          );
          valuesStr = parts.join(' · ') || '-';
        } else {
          valuesStr = escapeHtml(String(item.value1 || '')) + (item.value2 ? ' · ' + escapeHtml(String(item.value2)) : '');
        }
        return (
          '<div class="toolbox-list-item" data-id="' +
          item.id +
          '"><span class="toolbox-list-date">' +
          (item.date ? new Date(item.date).toLocaleDateString(intlTag()) : '') +
          '</span><span class="toolbox-list-values">' +
          valuesStr +
          '</span><button type="button" class="toolbox-list-delete" aria-label="' +
          escapeHtml(T('app.entry.delete', 'Delete')) +
          '">×</button></div>'
        );
      })
      .join('');
    listEl.querySelectorAll('.toolbox-list-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (blockAdminWrite()) return;
        const id = btn.closest('.toolbox-list-item').dataset.id;
        const ok =
          window.AppConfirm && typeof AppConfirm.ask === 'function'
            ? await AppConfirm.ask({
                title: T('app.tools.deleteTitle', 'Delete this Tools log?'),
                body: T(
                  'app.tools.deleteBody',
                  'Remove this measurement from Tools?\n\nYou can undo for a few seconds after.'
                ),
                confirmLabel: T('app.tools.deleteConfirm', 'Delete log'),
                danger: true,
              })
            : window.confirm(
                T(
                  'app.tools.deleteBody',
                  'Delete this Tools log?\n\nYou can undo for a few seconds after.'
                )
              );
        if (!ok) return;
        const data = getToolboxData();
        const removed = (data[tool] || []).find((x) => x.id === id);
        if (!removed) return;
        const snapshot = JSON.parse(JSON.stringify(removed));
        data[tool] = data[tool].filter((x) => x.id !== id);
        setToolboxData(data);
        renderToolboxList(tool);
        const chartEl = document.getElementById('toolbox-chart-' + tool);
        if (chartEl) renderToolboxChart(tool, chartEl);
        showUndoToast(T('app.tools.deletedUndo', 'Tools log deleted — undo available'), () => {
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
      container.innerHTML =
        '<p class="toolbox-chart-empty">' +
        escapeHtml(T('app.tools.chartEmpty', 'No data for the chart.')) +
        '</p>';
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
            const label = x.date ? new Date(x.date).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short' }) : '';
            // i18n-ignore — bar units (mL, °C, %, pH) are symbols, not copy
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
            const label = x.date ? new Date(x.date).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short' }) : '';
            // i18n-ignore — bar units (°C, %, pH) are symbols, not copy
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
              // i18n-ignore — pH scale label and unit
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
          .map((x) => '<div class="toolbox-timeline-item"><span class="toolbox-list-date">' + (x.date ? new Date(x.date).toLocaleDateString(intlTag()) : '') + '</span> ' + escapeHtml(String(x.value1 || '')) + (x.value2 ? ' – ' + escapeHtml(String(x.value2)) : '') + '</div>')
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
      renderTodayAndSeals(getPlants(), getEntries());
      renderCoachBriefingSurfaces();
      renderJournal();
      plantsSurfaceDirty = false;
      fillEntryPlantSelect();
      fillJournalPlantFilter();
      if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
      if (plantId && currentGrowlogPlantId === plantId) renderGrowlog(plantId);
      if (window.AdoptPlant && typeof window.AdoptPlant.render === 'function') {
        const adoptView = document.getElementById('view-adopt');
        if (adoptView && adoptView.classList.contains('active')) window.AdoptPlant.render();
      }
      maybeNotifyCareProgress();
      if (
        window.DnevnikNotifications &&
        typeof window.DnevnikNotifications.syncCareDueFromCoach === 'function'
      ) {
        window.DnevnikNotifications.syncCareDueFromCoach();
      }
    } catch (err) {
      console.warn('Journal refresh after coach action', err);
    }
  }

  function createPlantProgrammatic(opts) {
    const o = opts || {};
    if (blockAdminWrite())
      throw new Error(T('app.write.disabled', 'Writes are disabled for this account.'));
    const name = String(o.name || '').trim();
    if (!name) throw new Error(T('app.plants.nameRequired', 'Plant name is required.'));
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
      note: T('app.coach.noteVia', '{note} (via Grower Coach)', {
        note: T('app.note.growStarted', 'Grow started — stage: {stage}', {
          stage: stageName(stage),
        }),
      }),
      date: day0,
      meta: { faza: { from: null, to: stage } },
      source: 'ai-coach',
      requireNoteDefault: false,
    });
    return plant;
  }

  function setPlantStageProgrammatic(plantId, stage, note) {
    if (blockWrite({ plantId: plantId }))
      throw new Error(T('app.write.cannotEditPlant', 'Cannot edit this plant.'));
    const plants = getPlants();
    const idx = plants.findIndex((p) => p && String(p.id) === String(plantId));
    if (idx < 0) throw new Error(T('app.plants.notFound', 'Plant not found.'));
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
    const base = T('app.note.stageTransition', 'Stage transition: {from} → {to}', {
      from: stageName(oldStage),
      to: stageName(newStage),
    });
    saveJournalEntry({
      plantId: String(plantId),
      type: 'faza',
      note: T('app.coach.noteVia', '{note} (via Grower Coach)', {
        note: note ? base + '. ' + String(note) : base,
      }),
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
  /* Carries a code so callers can pick a tone without matching translated text. */
  function noPlantError() {
    const err = new Error(
      T('app.entry.choosePlantFirst', 'Choose a plant before saving the entry.')
    );
    err.code = 'no-plant';
    return err;
  }

  function saveJournalEntry(opts) {
    const o = opts || {};
    const plantId = o.plantId || null;
    if (blockWrite({ plantId: plantId }))
      throw new Error(T('app.write.cannotAddEntry', 'Cannot add entry for this plant.'));
    if (!plantId) throw noPlantError();
    const plant = getPlants().find((p) => p && String(p.id) === String(plantId));
    if (!plant) throw new Error(T('app.plants.notFound', 'Plant not found.'));

    const type = String(o.type || o.entryType || 'opcenito').trim() || 'opcenito';
    // Modal may save an empty General note; coach/quick-log omit note → default copy.
    let note = '';
    if (o.note === undefined || o.note === null) {
      note = o.requireNoteDefault === false ? '' : T('app.coach.loggedVia', 'Logged via Grower Coach');
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
      throw new Error(T('app.entry.saveFailed', 'Could not save journal entry.'));
    }
    // Second confirm: field-level match after an independent storage re-read.
    const landed = verifyEntryLanded(entry);
    if (!landed) {
      throw new Error(T('app.entry.saveRetry', 'Entry did not save. Please try again.'));
    }

    if (window.GrowerQuests && typeof GrowerQuests.awardXpOncePerDay === 'function') {
      try {
        if (type === 'zalijevanje') {
          GrowerQuests.awardXpOncePerDay('watering', GrowerQuests.QUEST_XP.watering);
        } else if (type === 'gnojidba') {
          GrowerQuests.awardXpOncePerDay('feeding', GrowerQuests.QUEST_XP.feeding);
        } else if (type === 'faza') {
          GrowerQuests.awardXpOncePerDay('stageLogged', GrowerQuests.QUEST_XP.stageLogged);
        }
      } catch {
        // ignore
      }
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
    if (!o.deferRefresh) {
      maybeNotifyCareProgress();
      refreshAfterJournalWrite(plantId);
    }
    return landed;
  }

  /**
   * Write the same care/journal payload to one or many plants (same-species rows).
   */
  function saveJournalEntriesBatch(plantIds, opts) {
    const o = opts || {};
    const plants = loggablePlants();
    const ids = normalizeSelectedPlantIds(plantIds || [], plants.length ? plants : getPlants());
    if (!ids.length) throw noPlantError();

    const landed = [];
    ids.forEach(function (id) {
      landed.push(
        saveJournalEntry(
          Object.assign({}, o, {
            plantId: id,
            silent: true,
            deferRefresh: true,
          })
        )
      );
    });

    maybeNotifyCareProgress();
    refreshAfterJournalWrite(ids[0]);

    if (!o.silent && window.DnevnikNotifications) {
      try {
        const typeLabel = ENTRY_TYPE_LABELS[o.type]
          ? entryTypeName(o.type)
          : o.type || T('app.entryType.entry', 'Entry');
        if (ids.length === 1) {
          const plant = getPlants().find(function (p) {
            return p && String(p.id) === String(ids[0]);
          });
          if (typeof DnevnikNotifications.notifyJournalEntry === 'function') {
            DnevnikNotifications.notifyJournalEntry(landed[0], plant && plant.name);
          }
        } else if (typeof DnevnikNotifications.toast === 'function') {
          DnevnikNotifications.toast(
            T('app.entry.loggedForPlants', 'Logged {type} for {count} plants', {
              type: typeLabel,
              count: ids.length,
            }),
            'success'
          );
        }
      } catch (_) {
        // ignore
      }
    }
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
    openLogSheet: openLogSheet,
    openEntry: startJournalEntry,
    findPlant: findPlantByNameOrId,
    refresh: refreshAfterJournalWrite,
  };

})();
