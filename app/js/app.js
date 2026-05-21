(function () {
  const STORAGE_AUTH = 'dnevnik-live-auth';
  if (!localStorage.getItem(STORAGE_AUTH)) {
    window.location.replace('../dnevnik/');
    return;
  }

  const STORAGE_PLANTS = 'dnevnik-live-plants';
  const STORAGE_ENTRIES = 'dnevnik-live-entries';
  const STORAGE_TOOLBOX = 'dnevnik-live-toolbox';

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

  const FULL_READ_ONLY_EMAILS = ['filip.balkanpharm@gmail.com'];

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
      payload.updatedAt = Date.now();
      await ref.set(payload, { merge: true });
    } catch {
      // keep local data as source of truth if network fails
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
    try {
      const snap = await firebase.firestore().collection('users').where('role', '==', 'superadmin').get();
      return snap.docs.map((d) => d.id);
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
    if (!FULL_READ_ONLY_EMAILS.includes(normalized)) return;
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

  async function loadSharedDatabaseForViewer(viewerUid, email) {
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

      plants = mergeRecordsById(plants, p);
      if (grant.shareEntries !== false) entries = mergeRecordsById(entries, e);
      if (grant.shareToolbox) toolbox = Object.assign({}, toolbox, state.toolbox || {});
    }

    if (!matchedGrant && FULL_READ_ONLY_EMAILS.includes((email || '').toLowerCase())) {
      await ensureViewerBootstrapGrant(viewerUid, email);
      return loadSharedDatabaseForViewer(viewerUid, email);
    }

    applyRemoteStateToLocal({ plants, entries, toolbox });
    console.log('Viewer loaded shared DB:', plants.length, 'plants,', entries.length, 'entries');
  }

  function blockAdminWrite() {
    if (!isAdminReadOnly) return false;
    alert(readOnlyBannerMessage || 'Pregled je samo za čitanje — uređivanje nije dopušteno.');
    return true;
  }

  function applyAdminReadOnlyUI(message) {
    if (!isAdminReadOnly) return;
    readOnlyBannerMessage =
      message ||
      'Pregled baze (samo čitanje) — biljke, dnevnik i alati bez mogućnosti uređivanja.';
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
    panel.innerHTML = '<p class="growlog-empty">Učitavanje korisnika i biljaka…</p>';

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
              `<label class="admin-sharing-plant-item"><input type="checkbox" class="share-plant-cb" value="${escapeHtml(p.id)}" /> ${escapeHtml(p.name)}${p.strain ? ' · ' + escapeHtml(p.strain) : ''}</label>`
          )
          .join('')
      : '<p class="growlog-empty">Nemate biljaka u svojoj bazi — dodajte ih u Biljke i dnevnik.</p>';

    const grantsHtml = grants.length
      ? grants
          .map((g) => {
            const plantCount =
              Array.isArray(g.plantIds) && g.plantIds.length > 0 ? g.plantIds.length + ' bilj.' : 'sve biljke';
            return (
              `<div class="admin-sharing-grant-row" data-viewer="${escapeHtml(g.viewerUid || g.id)}">` +
              `<span><strong>${escapeHtml(g.viewerEmail || g.viewerUid || g.id)}</strong> — ${escapeHtml(plantCount)}` +
              `${g.shareEntries === false ? '' : ', dnevnik'}` +
              `${g.shareToolbox ? ', alati' : ''}</span>` +
              `<button type="button" class="btn btn-ghost btn-sm btn-revoke-grant">Ukloni</button></div>`
            );
          })
          .join('')
      : '<p class="growlog-empty">Još nema dodijeljenih pristupa.</p>';

    panel.innerHTML =
      '<form id="form-sharing-grant" class="admin-sharing-form">' +
      '<label>Korisnik <select id="share-viewer-user" required><option value="">— odaberi —</option>' +
      userOptions +
      '</select></label>' +
      '<fieldset class="admin-sharing-plants-fieldset"><legend>Biljke za dijeljenje</legend>' +
      '<label class="admin-sharing-all"><input type="checkbox" id="share-all-plants" checked /> Sve biljke</label>' +
      '<div id="share-plants-list" class="admin-sharing-plants-list" hidden>' +
      plantChecks +
      '</div></fieldset>' +
      '<label><input type="checkbox" id="share-entries" checked /> Dijeli i bilješke dnevnika</label>' +
      '<label><input type="checkbox" id="share-toolbox" /> Dijeli podatke iz Alata</label>' +
      '<button type="submit" class="btn btn-primary">Spremi pristup</button>' +
      '</form>' +
      '<div class="admin-sharing-grants"><h4>Aktivni pristupi</h4>' +
      grantsHtml +
      '</div>';

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
        alert('Odaberite barem jednu biljku ili uključite „Sve biljke”.');
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
        alert('Pristup je spremljen.');
      } catch (err) {
        console.error(err);
        alert('Spremanje nije uspjelo. Provjerite Firestore pravila.');
      }
    });

    panel.querySelectorAll('.btn-revoke-grant').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.admin-sharing-grant-row');
        const viewerUid = row && row.dataset.viewer;
        if (!viewerUid || !confirm('Ukloniti pristup za ovog korisnika?')) return;
        try {
          await deleteSharedGrant(ownerUid, viewerUid);
          await renderSuperadminSharingPanel();
        } catch (err) {
          alert('Uklanjanje nije uspjelo.');
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
  const promoteViewer = FULL_READ_ONLY_EMAILS.includes(email);

  if (!docSnap.exists) {
    await userRef.set({
      email: user.email || "",
      uId: user.uid,
      role: promoteViewer ? 'viewer' : 'user',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    });

    console.log("User created");
  } else {
    const data = docSnap.data() || {};
    const patch = { lastLoginAt: new Date().toISOString() };
    if (promoteViewer && (!data.role || data.role === 'user')) {
      patch.role = 'viewer';
    }
    await userRef.update(patch);

    console.log("User updated");
  }
}

function applyRoleUI(role) {
  const adminEls = document.querySelectorAll(".admin-only");
  const superEls = document.querySelectorAll(".admin-super-only");

 
  adminEls.forEach(el => el.style.display = "none");
  superEls.forEach(el => el.style.display = "none");

 
  if (role === "admin" || role === "superadmin") {
    adminEls.forEach((el) => (el.style.display = "flex"));
  }

  if (role === "superadmin") {
    superEls.forEach((el) => (el.style.display = "flex"));
  }

  const sharingSection = document.getElementById('admin-sharing-section');
  if (sharingSection) {
    sharingSection.style.display = role === 'superadmin' ? 'block' : 'none';
    sharingSection.setAttribute('aria-hidden', role !== 'superadmin');
  }
}


let currentUserRole = null;

async function getCurrentUserRole(user) {
  const db = firebase.firestore();
  const userRef = db.collection("users").doc(user.uid);

  const docSnap = await userRef.get();

  if (!docSnap.exists) return "user";

  return docSnap.data().role || "user";
}

function initFirebaseSync() {
  if (!window.firebase || !firebase.auth || !firebase.firestore) {
    remoteSyncReady = false;
    return;
  }

  firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    localStorage.removeItem(STORAGE_AUTH);
    window.location.replace('../dnevnik/');
    return;
  }

  localStorage.setItem(
    STORAGE_AUTH,
    JSON.stringify({
      email: user.email || '',
      uid: user.uid,
      loggedAt: Date.now()
    })
  );

  await ensureUserExists(user);
  currentUserRole = await getCurrentUserRole(user);
  console.log("ROLE LOADED:", currentUserRole); // DEBUG
  applyRoleUI(currentUserRole);

  if (currentUserRole === 'admin') {
    isAdminReadOnly = true;
    remoteSyncReady = false;
    await loadSuperadminDatabaseForAdmin();
    applyAdminReadOnlyUI(
      'Pregled cijele baze superadmina (samo čitanje) — bez mogućnosti uređivanja biljaka.'
    );
  } else if (currentUserRole === 'viewer') {
    isAdminReadOnly = true;
    remoteSyncReady = false;
    await ensureViewerBootstrapGrant(user.uid, user.email || '');
    await loadSharedDatabaseForViewer(user.uid, user.email || '');
    applyAdminReadOnlyUI(
      'Pregled dijeljenih biljaka (samo čitanje) — uređivanje nije dopušteno.'
    );
  } else {
    isAdminReadOnly = false;
    document.body.classList.remove('admin-readonly');
    const state = await loadRemoteStateIntoLocal(user.uid);
    applyRemoteStateToLocal(state || { plants: [], entries: [], toolbox: {} });
    remoteSyncReady = true;
  }

  refreshAllViewsAfterRemoteLoad();

 
  if (initialView) {
    if (
      initialView === "admin" &&
      !["admin", "superadmin"].includes(currentUserRole)
    ) {
      showView("dashboard");
    } else if (['dashboard', 'plants', 'cpvo', 'pitchdeck', 'toolbox', 'admin', 'danas'].includes(initialView)) {
      showView(initialView);
    }
  }

  document.body.classList.remove("app-loading");
});
}













  const STAGES = {
    klijanje: 'Klijanje',
    sadnica: 'Sadnica',
    vegetativna: 'Vegetativna',
    cvjetanje: 'Cvjetanje',
    susenje: 'Sušenje',
  };

  function canonicalPlantStage(value) {
    const v = String(value == null ? '' : value).trim();
    if (v && Object.prototype.hasOwnProperty.call(STAGES, v)) return v;
    return 'klijanje';
  }

  const SUBPHASE_FIELD = 'na_polju';

  const SUBPHASE_POTS = {
    pot_1_5dcl: '1,5 dcl',
    pot_5l: '5 L',
    pot_30l: '30 L',
    pot_10dcl: '10 dcl',
    pot_1_5l: '1,5 L',
    [SUBPHASE_FIELD]: 'Na polju',
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
    opcenito: 'Općenito',
    zalijevanje: 'Zalijevanje',
    gnojidba: 'Gnojidba',
    okolis: 'Okoliš',
    presadjivanje: 'Presađivanje',
    stresori: 'Stresori',
    ostalo: 'Ostalo',
    faza: 'Faza (prijelaz)',
    podfaza: 'Podfaza (lonac / polje)',
  };

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
    scheduleRemoteSync({ plants: plants || [] });
  }

  function getEntries() {
    try {
      const data = localStorage.getItem(STORAGE_ENTRIES);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function setEntries(entries) {
    if (blockAdminWrite()) return;
    localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
    scheduleRemoteSync({ entries: entries || [] });
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

  // --- Navigation ---
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');
  const viewTitle = document.querySelector('.view-title');
  const logoutBtn = document.getElementById('btn-logout');
  const titles = {
    dashboard: 'Nadzorna ploča',
    plants: 'Biljke i dnevnik',
    cpvo: 'CPVO-obrazac',
    pitchdeck: 'Pitch deck',
    growlog: 'Growlog',
    toolbox: 'Alati',
    admin: 'Admin Panel',
    danas: 'Danas',
  };

  let currentGrowlogPlantId = null;

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        if (window.firebase && firebase.auth) await firebase.auth().signOut();
      } catch {
        // ignore
      }
      localStorage.removeItem(STORAGE_AUTH);
      window.location.replace('../dnevnik/');
    });
  }

  function showView(id, extra) {
    

    views.forEach((v) => v.classList.remove('active'));
    navItems.forEach((n) => n.classList.remove('active'));
    if (id === 'growlog' && extra) {
      currentGrowlogPlantId = extra;
      const view = document.getElementById('view-growlog');
      if (view) view.classList.add('active');
      const plant = getPlants().find((p) => p.id === extra);
      if (viewTitle) viewTitle.textContent = plant ? plant.name : 'Growlog';
      renderGrowlog(extra);
      return;
    }
    currentGrowlogPlantId = null;
    const view = document.getElementById('view-' + id);
    document.querySelectorAll('.nav-item[data-view="' + id + '"]').forEach((n) => n.classList.add('active'));
    if (view) view.classList.add('active');
    if (viewTitle && titles[id]) viewTitle.textContent = titles[id];
    if (id === 'dashboard') renderDashboard();
    if (id === 'plants') {
      initPlantsWeatherWidget();
      renderPlants();
      renderJournal();
    }
    if (id === 'toolbox') renderToolbox();
    if (id === 'admin' && currentUserRole === 'superadmin') renderSuperadminSharingPanel();
  }

  navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();

    const view = item.dataset.view;

    if (view === "admin" && !["admin", "superadmin"].includes(currentUserRole)) {
      alert("Access denied.");
      return;
    }

    if (view !== "growlog") currentGrowlogPlantId = null;
    showView(view);
  });
});

  const viewGrowlogEl = document.getElementById('view-growlog');
  if (viewGrowlogEl) {
    viewGrowlogEl.addEventListener('click', (e) => {
      if (e.target.closest('#growlog-back')) {
        e.preventDefault();
        showView('plants');
      }
    });
  }

  function openGrowlog(plantId) {
    showView('growlog', plantId);
  }

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
    if (sec < 60) return 'upravo';
    if (sec < 3600) return 'prije ' + Math.floor(sec / 60) + ' min';
    if (sec < 86400) return 'prije ' + Math.floor(sec / 3600) + ' h';
    if (sec < 604800) return 'prije ' + Math.floor(sec / 86400) + ' d';
    if (sec < 2592000) return 'prije ' + Math.floor(sec / 604800) + ' tjedana';
    if (sec < 31536000) return 'prije ' + Math.floor(sec / 2592000) + ' mj.';
    return 'prije ' + Math.floor(sec / 31536000) + ' god.';
  }

  function formatDayWeek(dateStr, startDateStr) {
    if (!dateStr || !startDateStr) return '';
    const d = new Date(dateStr);
    const start = new Date(startDateStr);
    const day = daysBetween(startDateStr, dateStr);
    const week = Math.floor(day / 7);
    return 'Dan ' + day + ' (' + week + '. tjedan)';
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
    if (!plant) return;

    const startDate = plant.startDate || new Date().toISOString().slice(0, 10);
    const updatedAt = plant.updatedAt || (plant.startDate ? plant.startDate + 'T12:00:00.000Z' : new Date().toISOString());
    const views = plant.views != null ? plant.views : 0;
    const durationWeeks = weeksBetween(startDate, updatedAt.slice(0, 10));
    const envType = plant.environmentType === 'outdoor' ? 'Na otvorenom' : 'U zatvorenom';
    const exposure = plant.exposureHours ? plant.exposureHours + ' h' : '—';

    document.getElementById('growlog-updated').textContent = 'Ažurirano ' + timeAgo(updatedAt);
    document.getElementById('growlog-views').textContent = views + ' pregleda';

    document.getElementById('growlog-metrics').innerHTML = `
      <div class="growlog-metric"><span class="growlog-metric-icon">📅</span> ${durationWeeks} tjedana</div>
      <div class="growlog-metric"><span class="growlog-metric-icon">💧</span> ${STAGES[plant.stage] || plant.stage}</div>
      <div class="growlog-metric"><span class="growlog-metric-icon">💡</span> ${envType}</div>
    `;

    const allPhotos = [];
    if (plant.photo) allPhotos.push(plant.photo);
    entries.forEach((e) => {
      if (e.photo) allPhotos.push(e.photo);
    });
    const photoGrid = document.getElementById('growlog-photo-grid');
    photoGrid.innerHTML = allPhotos.slice(0, 3).map((src) => '<img src="' + src + '" alt="" />').join('') || '<p class="growlog-empty">Nema fotografija</p>';
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
        const dateStr = date ? new Date(date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
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
        '<p class="growlog-empty">Još nema zapisanih prijelaza. Mijenjaj fazu u &quot;Uredi biljku&quot; — nastaje bilješka u dnevniku.</p>';
    } else {
      histHtml = hist
        .slice()
        .reverse()
        .map((h) => {
          const d = h.date ? new Date(h.date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
          const line = h.from
            ? escapeHtml(STAGES[h.from] || h.from) + ' → ' + escapeHtml(STAGES[h.to] || h.to)
            : 'Započetak: ' + escapeHtml(STAGES[h.to] || h.to);
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
        '<h4 class="growlog-subsection-title">Podfaze (lonci)</h4>' +
        '<div class="tree-stages tree-subphases">' +
        subRows +
        '</div>' +
        '<h4 class="growlog-subsection-title">Povijest prijelaza faza</h4>' +
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
                ? new Date(h.date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short', year: 'numeric' })
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
            '<h4 class="growlog-subsection-title">Povijest podfaza (lonci / polje)</h4>' +
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
          ? '<div class="env-row"><span class="env-icon">📍</span> Polje: ' + escapeHtml(plant.fieldLocation) + '</div>'
          : ''
      }
      ${
        plant.plantingLocation
          ? '<div class="env-row"><span class="env-icon">🌱</span> Sađenje: ' + escapeHtml(plant.plantingLocation) + '</div>'
          : ''
      }
      <div class="env-row"><span class="env-icon">🕐</span> ${exposure} osvjetljenja</div>
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
        ' tj. uzgoja</span>' +
        '<span class="growlog-hero-chip growlog-hero-chip--muted">' +
        escapeHtml(envType) +
        '</span>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm growlog-hero-edit" id="growlog-hero-edit">✎ Uredi biljku</button>' +
        '</div>' +
        '<h2 class="growlog-hero-title">' +
        escapeHtml(plant.name) +
        '</h2>' +
        strainHtml +
        '<p class="growlog-hero-hint">Fotografije su u bočnoj traci i u nedavnim slikama ispod.</p>' +
        '</div>';
      const heroEditBtn = document.getElementById('growlog-hero-edit');
      if (heroEditBtn) {
        heroEditBtn.addEventListener('click', () => openPlantModal(plantId));
      }
    }

    const timelineItems = [];
    entries.slice(0, 20).forEach((e) => {
      const dayWeek = formatDayWeek(e.date, startDate);
      const dateStr = e.date ? new Date(e.date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
      const typeLabel = ENTRY_TYPE_LABELS[e.type] || e.type || 'Općenito';
      const note = (e.note || '').slice(0, 80) + ((e.note || '').length > 80 ? '…' : '');
      const media = e.photo ? '<img src="' + e.photo + '" alt="" class="timeline-thumb" />' : '';
      timelineItems.push(
        '<div class="timeline-entry"><div class="timeline-entry-header"><span class="timeline-date">📅 ' + dateStr + '</span><span class="timeline-day">' + dayWeek + '</span></div><div class="timeline-entry-body">' + typeLabel + ': ' + escapeHtml(note) + '</div>' + (media ? '<div class="timeline-entry-media">' + media + '</div>' : '') + '</div>'
      );
    });
    document.getElementById('growlog-timeline').innerHTML = timelineItems.length ? timelineItems.join('') : '<p class="growlog-empty">Nema unosa u vremenskoj crti. Dodajte bilješke u Dnevnik.</p>';

    const stripPhotos = allPhotos.slice(0, 8);
    document.getElementById('growlog-photo-strip').innerHTML = stripPhotos.map((src) => '<img src="' + src + '" alt="" />').join('') || '<p class="growlog-empty">Nema fotografija</p>';

    document.getElementById('growlog-view-all-photos').onclick = () => {
      document.getElementById('growlog-photo-strip').scrollIntoView({ behavior: 'smooth' });
    };
  }

  // --- Dashboard ---
  function renderDashboard() {
    const plants = getPlants();
    const entries = getEntries();
    const cardsEl = document.getElementById('dashboard-cards');
    const recentEl = document.getElementById('recent-notes');
    const totalPlantCount = plants.reduce((sum, p) => sum + Math.max(1, Number(p.count || 1)), 0);

    cardsEl.innerHTML = `
      <div class="dashboard-card">
        <h3>Broj biljaka</h3>
        <div class="value">${totalPlantCount}</div>
      </div>
      <div class="dashboard-card">
        <h3>Bilješke u dnevniku</h3>
        <div class="value">${entries.length}</div>
      </div>
      <div class="dashboard-card">
        <h3>Aktivne faze</h3>
        <div class="value">${new Set(plants.map((p) => p.stage)).size}</div>
      </div>
    `;

    const recent = entries.slice(-5).reverse();
    if (recent.length === 0) {
      recentEl.innerHTML = '<div class="empty-state">Nema bilješki. Dodajte biljku i započnite dnevnik.</div>';
    } else {
      recentEl.innerHTML = recent
        .map((e) => {
          const plant = plants.find((p) => p.id === e.plantId);
          const plantName = plant ? plant.name : 'Biljka';
          const date = e.date ? new Date(e.date).toLocaleDateString('hr-HR') : '';
          const thumb = e.photo ? '<img src="' + e.photo + '" alt="" class="recent-note-thumb" />' : '';
          return `
            <div class="recent-note">
              <div class="meta">${plantName} · ${date} · ${ENTRY_TYPE_LABELS[e.type] || e.type || 'Općenito'}</div>
              ${thumb}
              <div class="text">${escapeHtml(e.note || '').slice(0, 120)}${(e.note || '').length > 120 ? '…' : ''}</div>
            </div>
          `;
        })
        .join('');
    }

    const MIN_CHART_ENTRIES = 2;
    const chartsSection = document.getElementById('dashboard-charts-section');
    const chartsContainer = document.getElementById('dashboard-charts');
    if (chartsSection && chartsContainer && typeof getToolboxData === 'function') {
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
        if (hasWatering) chartsContainer.innerHTML += '<div class="dashboard-chart-block"><h4>Zalijevanje</h4><div id="dashboard-chart-watering"></div></div>';
        if (hasEnv) chartsContainer.innerHTML += '<div class="dashboard-chart-block"><h4>Okoliš (temperatura, vlažnost, pH)</h4><div id="dashboard-chart-environment"></div></div>';
        if (hasWatering && typeof renderToolboxChart === 'function') renderToolboxChart('watering', document.getElementById('dashboard-chart-watering'));
        if (hasEnv && typeof renderToolboxChart === 'function') renderToolboxChart('environment', document.getElementById('dashboard-chart-environment'));
      }
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  const WEATHER_API_KEY = '4fcd0d4855e24280a52121246261504';
  const WEATHER_CITY_KEY = 'dnevnik-live-weather-city';
  const DEFAULT_WEATHER_CITY = 'Visnjevac';
  const PLANTS_WEATHER_EL = 'plants-weather';
  let plantsWeatherFormBound = false;

  function getWeatherCity() {
    try {
      const saved = localStorage.getItem(WEATHER_CITY_KEY);
      return (saved && saved.trim()) || DEFAULT_WEATHER_CITY;
    } catch {
      return DEFAULT_WEATHER_CITY;
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
    if (isToday) return 'Danas';
    return d.toLocaleDateString('hr-HR', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  async function getWeather(city, containerId) {
    const elId = containerId || PLANTS_WEATHER_EL;
    const weatherDiv = document.getElementById(elId);
    if (!weatherDiv) return;

    const cityName = (city || DEFAULT_WEATHER_CITY).trim() || DEFAULT_WEATHER_CITY;
    weatherDiv.innerHTML = '<p class="plants-weather-loading">Učitavanje prognoze…</p>';

    const url =
      'https://api.weatherapi.com/v1/forecast.json?key=' +
      encodeURIComponent(WEATHER_API_KEY) +
      '&q=' +
      encodeURIComponent(cityName) +
      '&days=7';

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
          '<p class="plants-weather-error">Prognoza nije dostupna: ' + escapeHtml(msg) + '</p>';
        return;
      }

      if (!data || data.error) {
        weatherDiv.innerHTML =
          '<p class="plants-weather-error">Prognoza nije dostupna: ' +
          escapeHtml((data && data.error && data.error.message) || 'Nepoznat grad') +
          '</p>';
        return;
      }

      if (!data.forecast || !Array.isArray(data.forecast.forecastday) || !data.forecast.forecastday.length) {
        weatherDiv.innerHTML = '<p class="plants-weather-error">Nema podataka za prognozu.</p>';
        return;
      }

      displayWeather(data, elId);
    } catch (error) {
      console.error('Weather fetch failed', error);
      weatherDiv.innerHTML =
        '<p class="plants-weather-error">Nije moguće učitati prognozu. Provjerite mrežu i naziv grada.</p>';
    }
  }

  function displayWeather(data, containerId) {
    const elId = containerId || PLANTS_WEATHER_EL;
    const weatherDiv = document.getElementById(elId);
    if (!weatherDiv || !data.forecast || !data.forecast.forecastday) return;

    const city = data.location.name;
    const region = data.location.region ? ', ' + data.location.region : '';
    const days = data.forecast.forecastday;

    let html =
      '<p class="plants-weather-location">' +
      escapeHtml(city + region) +
      ' · sljedećih 7 dana</p><div class="weather-container plants-weather-days">';

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
    weatherDiv.innerHTML = html;
  }

  function loadPlantsWeatherFromInput() {
    const input = document.getElementById('plants-weather-city');
    const city = (input && input.value.trim()) || getWeatherCity();
    if (input && !input.value.trim()) input.value = city;
    try {
      localStorage.setItem(WEATHER_CITY_KEY, city);
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

    if (!input.value.trim()) input.value = getWeatherCity();

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
  const MAX_VIDEO_SIZE_MB = 2;

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function resizeImageDataUrl(dataUrl, maxWidth) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w <= maxWidth) {
          resolve(dataUrl);
          return;
        }
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // --- Plants ---
  function renderPlants() {
    const list = document.getElementById('plants-list');
    const plants = getPlants();
    if (plants.length === 0) {
      list.innerHTML = '<div class="empty-state">Nemate biljaka. Kliknite "Nova biljka" da dodate prvu.</div>';
      return;
    }
    list.innerHTML = plants
      .map(
        (p) => `
      <div class="plant-card" data-id="${p.id}">
        ${p.photo ? `<div class="plant-card-photo"><img src="${p.photo}" alt="" /></div>` : ''}
        <div class="plant-card-header">
          <h3>${escapeHtml(p.name)}</h3>
          <span class="stage-badge">${STAGES[p.stage] || p.stage}</span>
        </div>
        ${
          p.subphase
            ? `<div class="plant-card-subphases"><span class="subphase-badge" title="Volumen lonca">${escapeHtml(subphaseLabel(p.subphase))}</span></div>`
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
        <div class="text-muted" style="font-size:0.85rem">Nasad: <strong style="color:var(--text)">${Math.max(1, Number(p.count || 1))}</strong> bilj.</div>
        ${p.startDate ? `<div class="text-muted" style="font-size:0.85rem">Od ${new Date(p.startDate).toLocaleDateString('hr-HR')}</div>` : ''}
        <div class="plant-card-actions">
          <button type="button" class="btn btn-primary btn-growlog">Growlog</button>
          <button type="button" class="btn btn-ghost btn-edit-plant">✎ Uredi biljku</button>
          <button type="button" class="btn btn-ghost btn-delete-plant">Obriši</button>
        </div>
      </div>
    `
      )
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

  function deletePlant(id) {
    if (blockAdminWrite()) return;
    if (!confirm('Obrisati ovu biljku?')) return;
    const plants = getPlants().filter((p) => p.id !== id);
    setPlants(plants);
    const entries = getEntries().filter((e) => e.plantId !== id);
    setEntries(entries);
    renderPlants();
    renderDashboard();
    fillEntryPlantSelect();
    fillJournalPlantFilter();
    if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
  }

  function openPlantModal(editId) {
    if (blockAdminWrite()) return;
    const modal = document.getElementById('modal-plant');
    const form = document.getElementById('form-plant');
    const titleEl = document.getElementById('modal-plant-title');
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
    titleEl.textContent = editId ? 'Uredi biljku' : 'Nova biljka';
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
          photoPreview.innerHTML = '<img src="' + p.photo + '" alt="Fotografija" class="media-thumb" /> <button type="button" class="btn-remove-media">Ukloni</button>';
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
      photoData.value = '';
      photoPreview.innerHTML = '';
    }
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
    if (!file || !file.type.startsWith('image/')) {
      photoData.value = '';
      photoPreview.innerHTML = '';
      return;
    }
    try {
      let dataUrl = await readFileAsDataUrl(file);
      dataUrl = await resizeImageDataUrl(dataUrl, MAX_IMAGE_SIZE);
      photoData.value = dataUrl;
      photoPreview.innerHTML = '<img src="' + dataUrl + '" alt="Fotografija" class="media-thumb" /> <button type="button" class="btn-remove-media">Ukloni</button>';
      photoPreview.querySelector('.btn-remove-media').addEventListener('click', () => {
        photoData.value = '';
        photoPreview.innerHTML = '';
        document.getElementById('plant-photo').value = '';
      });
    } catch (err) {
      photoPreview.innerHTML = '<span class="media-error">Greška pri učitavanju.</span>';
    }
  });

  document.getElementById('form-plant').addEventListener('submit', (e) => {
    e.preventDefault();
    if (blockAdminWrite()) return;
    const id = document.getElementById('plant-id').value;
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
    if (fieldLocationVal) locNoteSuffix += ' Lokacija polja: ' + fieldLocationVal + '.';
    if (plantingLocationVal) locNoteSuffix += ' Lokacija sađenja: ' + plantingLocationVal + '.';

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
      let note0 = 'Započet uzgoj — faza: ' + (STAGES[newStage] || newStage);
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
        let subNote = 'Podfaza: ' + subphaseLabel(newSubphase);
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
          'Prijelaz faze: ' + (STAGES[stageAtOpen] || stageAtOpen) + ' → ' + (STAGES[newStage] || newStage);
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
          'Prijelaz podfaze: ' + fromLab + ' → ' + toLab + (transitionNote ? '. ' + transitionNote : '') + locNoteSuffix;
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
    if (journalAdds.length) {
      setEntries(getEntries().concat(journalAdds));
    }
    closePlantModal();
    renderPlants();
    renderDashboard();
    renderJournal();
    fillEntryPlantSelect();
    fillJournalPlantFilter();
    if (typeof fillToolboxPlantSelects === 'function') fillToolboxPlantSelects();
    if (currentGrowlogPlantId === newId) {
      renderGrowlog(newId);
      const headerTitle = document.querySelector('.view-title');
      if (headerTitle) headerTitle.textContent = payload.name;
    }
  });

  document.querySelector('#modal-plant .modal-close').addEventListener('click', closePlantModal);
  document.querySelector('#modal-plant .modal-cancel').addEventListener('click', closePlantModal);

  // --- Journal ---
  function fillEntryPlantSelect() {
    const sel = document.getElementById('entry-plant');
    if (!sel) return;
    const plants = getPlants();
    sel.innerHTML = '<option value="">-- Odaberi biljku --</option>' + plants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  }

  function fillJournalPlantFilter() {
    const sel = document.getElementById('journal-plant-filter');
    if (!sel) return;
    const plants = getPlants();
    sel.innerHTML = '<option value="">Sve biljke</option>' + plants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
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
      container.innerHTML = '<div class="empty-state">Nema bilješki. Kliknite "Nova bilješka".</div>';
      return;
    }
    container.innerHTML = entries
      .map((e) => {
        const plant = plants.find((p) => p.id === e.plantId);
        const plantName = plant ? plant.name : 'Biljka';
        const date = e.date ? new Date(e.date).toLocaleDateString('hr-HR') : '';
        const typeLabel = ENTRY_TYPE_LABELS[e.type] || e.type || 'Općenito';
        const media = [];
        if (e.photo) media.push('<div class="entry-media entry-photo"><img src="' + e.photo + '" alt="Fotografija" /></div>');
        if (e.video) media.push('<div class="entry-media entry-video"><video src="' + e.video + '" controls></video></div>');
        let metaHtml = '';
        if (e.meta) {
          if (e.meta.faza) {
            const m = e.meta.faza;
            const parts = [];
            if (m.from) parts.push('Od: ' + escapeHtml(STAGES[m.from] || m.from));
            parts.push('U: ' + escapeHtml(STAGES[m.to] || m.to));
            if (parts.length) metaHtml += '<div class="entry-meta-block"><strong>Prijelaz faze</strong><ul><li>' + parts.join('</li><li>') + '</li></ul></div>';
            if (e.meta.fieldLocation) {
              metaHtml +=
                '<div class="entry-meta-block"><strong>Lokacija polja</strong><p>' +
                escapeHtml(e.meta.fieldLocation) +
                '</p></div>';
            }
            if (e.meta.plantingLocation) {
              metaHtml +=
                '<div class="entry-meta-block"><strong>Lokacija sađenja</strong><p>' +
                escapeHtml(e.meta.plantingLocation) +
                '</p></div>';
            }
          }
          if (e.meta.podfaza) {
            const m = e.meta.podfaza;
            const parts = [];
            if (m.from) parts.push('Od: ' + escapeHtml(subphaseLabel(m.from)));
            parts.push('U: ' + escapeHtml(subphaseLabel(m.to) || m.to || '—'));
            if (parts.length) {
              metaHtml += '<div class="entry-meta-block"><strong>Prijelaz podfaze</strong><ul><li>' + parts.join('</li><li>') + '</li></ul></div>';
            }
            if (e.meta.fieldLocation) {
              metaHtml +=
                '<div class="entry-meta-block"><strong>Lokacija polja</strong><p>' +
                escapeHtml(e.meta.fieldLocation) +
                '</p></div>';
            }
            if (e.meta.plantingLocation) {
              metaHtml +=
                '<div class="entry-meta-block"><strong>Lokacija sađenja</strong><p>' +
                escapeHtml(e.meta.plantingLocation) +
                '</p></div>';
            }
          }
          if (e.meta.presadjivanje) {
            const m = e.meta.presadjivanje;
            const parts = [];
            if (m.soilQuality) parts.push('Kvaliteta zemlje: ' + escapeHtml(m.soilQuality));
            if (m.plantAge) parts.push('Starost biljke: ' + escapeHtml(m.plantAge));
            if (m.plantCondition) parts.push('Stanje biljke: ' + escapeHtml(m.plantCondition));
            if (parts.length) metaHtml += '<div class="entry-meta-block"><strong>Presađivanje</strong><ul><li>' + parts.join('</li><li>') + '</li></ul></div>';
          }
          if (e.meta.stresori) {
            const m = e.meta.stresori;
            const parts = [];
            if (m.temperature) parts.push('Temperatura: ' + escapeHtml(m.temperature));
            if (m.humidity) parts.push('Vlaga: ' + escapeHtml(m.humidity));
            if (m.vpd) parts.push('VPD: ' + escapeHtml(m.vpd));
            if (m.pests) parts.push('Nametnici: ' + escapeHtml(m.pests));
            if (parts.length) metaHtml += '<div class="entry-meta-block"><strong>Stresori</strong><ul><li>' + parts.join('</li><li>') + '</li></ul></div>';
          }
        }
        return `
          <div class="journal-entry">
            <div class="entry-meta">
              <span class="entry-type">${typeLabel}</span>
              ${plantName} · ${date}
            </div>
            <div class="entry-note">${escapeHtml(e.note || '')}</div>
            ${metaHtml ? '<div class="entry-meta-blocks">' + metaHtml + '</div>' : ''}
            ${media.length ? '<div class="entry-media-wrap">' + media.join('') + '</div>' : ''}
          </div>
        `;
      })
      .join('');
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

  function openEntryModal(plantId) {
    if (blockAdminWrite()) return;
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
    updateEntryExtraVisibility();
    modalEntry.classList.add('open');
  }

  const btnAddEntry = document.getElementById('btn-add-entry');
  if (btnAddEntry) {
    btnAddEntry.addEventListener('click', () => {
      if (blockAdminWrite()) return;
      openEntryModal(null);
    });
  }

  const btnAddEntryGrowlog = document.getElementById('btn-add-entry-growlog');
  if (btnAddEntryGrowlog) {
    btnAddEntryGrowlog.addEventListener('click', () => {
      if (blockAdminWrite()) return;
      if (!currentGrowlogPlantId) return;
      openEntryModal(currentGrowlogPlantId);
    });
  }

  const btnEditPlantGrowlog = document.getElementById('btn-edit-plant-growlog');
  if (btnEditPlantGrowlog) {
    btnEditPlantGrowlog.addEventListener('click', () => {
      if (blockAdminWrite()) return;
      if (!currentGrowlogPlantId) return;
      openPlantModal(currentGrowlogPlantId);
    });
  }

  document.getElementById('entry-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const dataEl = document.getElementById('entry-photo-data');
    const previewEl = document.getElementById('entry-photo-preview');
    if (!file || !file.type.startsWith('image/')) {
      dataEl.value = '';
      previewEl.innerHTML = '';
      return;
    }
    try {
      let dataUrl = await readFileAsDataUrl(file);
      dataUrl = await resizeImageDataUrl(dataUrl, MAX_IMAGE_SIZE);
      dataEl.value = dataUrl;
      previewEl.innerHTML = '<img src="' + dataUrl + '" alt="Fotografija" class="media-thumb" /> <button type="button" class="btn-remove-media">Ukloni</button>';
      previewEl.querySelector('.btn-remove-media').addEventListener('click', () => {
        dataEl.value = '';
        previewEl.innerHTML = '';
        document.getElementById('entry-photo').value = '';
      });
    } catch (err) {
      previewEl.innerHTML = '<span class="media-error">Greška pri učitavanju.</span>';
    }
  });

  document.getElementById('entry-video').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const dataEl = document.getElementById('entry-video-data');
    const previewEl = document.getElementById('entry-video-preview');
    if (!file || !file.type.startsWith('video/')) {
      dataEl.value = '';
      previewEl.innerHTML = '';
      return;
    }
    const maxBytes = MAX_VIDEO_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      previewEl.innerHTML = '<span class="media-error">Video prevelik (max ' + MAX_VIDEO_SIZE_MB + ' MB za lokalno spremanje).</span>';
      dataEl.value = '';
      document.getElementById('entry-video').value = '';
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      dataEl.value = dataUrl;
      previewEl.innerHTML = '<video src="' + dataUrl + '" controls class="media-thumb-video"></video> <button type="button" class="btn-remove-media">Ukloni</button>';
      previewEl.querySelector('.btn-remove-media').addEventListener('click', () => {
        dataEl.value = '';
        previewEl.innerHTML = '';
        document.getElementById('entry-video').value = '';
      });
    } catch (err) {
      previewEl.innerHTML = '<span class="media-error">Greška pri učitavanju.</span>';
    }
  });

  document.getElementById('form-entry').addEventListener('submit', (e) => {
    e.preventDefault();
    if (blockAdminWrite()) return;
    const type = document.getElementById('entry-type').value;
    let meta = null;
    if (type === 'presadjivanje') {
      const soil = document.getElementById('entry-transplant-soil').value.trim();
      const age = document.getElementById('entry-transplant-age').value.trim();
      const condition = document.getElementById('entry-transplant-condition').value.trim();
      if (soil || age || condition) meta = { presadjivanje: { soilQuality: soil || null, plantAge: age || null, plantCondition: condition || null } };
    } else if (type === 'stresori') {
      const temp = document.getElementById('entry-stressor-temp').value.trim();
      const humidity = document.getElementById('entry-stressor-humidity').value.trim();
      const vpd = document.getElementById('entry-stressor-vpd').value.trim();
      const pests = document.getElementById('entry-stressor-pests').value.trim();
      if (temp || humidity || vpd || pests) meta = { stresori: { temperature: temp || null, humidity: humidity || null, vpd: vpd || null, pests: pests || null } };
    } else if (type === 'faza') {
      const fieldLocInput = document.getElementById('entry-faza-field-location');
      const plantingInput = document.getElementById('entry-faza-planting-location');
      const fieldLoc = fieldLocInput ? fieldLocInput.value.trim() : '';
      const plantingLoc = plantingInput ? plantingInput.value.trim() : '';
      if (fieldLoc || plantingLoc) {
        meta = { faza: {} };
        if (fieldLoc) meta.fieldLocation = fieldLoc;
        if (plantingLoc) meta.plantingLocation = plantingLoc;
      }
    }
    const plantIdForEntry = document.getElementById('entry-plant').value || null;
    const entries = getEntries();
    entries.push({
      id: uuid(),
      plantId: document.getElementById('entry-plant').value || null,
      date: document.getElementById('entry-date').value,
      type: type,
      note: document.getElementById('entry-note').value.trim(),
      photo: document.getElementById('entry-photo-data').value.trim() || null,
      video: document.getElementById('entry-video-data').value.trim() || null,
      meta: meta || undefined,
    });
    setEntries(entries);
    if (type === 'faza' && plantIdForEntry && meta && (meta.fieldLocation || meta.plantingLocation)) {
      const plants = getPlants();
      const idx = plants.findIndex((p) => p.id === plantIdForEntry);
      if (idx >= 0) {
        const patch = { ...plants[idx], updatedAt: new Date().toISOString() };
        if (meta.fieldLocation) {
          patch.fieldLocation = meta.fieldLocation;
          patch.environmentType = 'outdoor';
        }
        if (meta.plantingLocation) patch.plantingLocation = meta.plantingLocation;
        plants[idx] = patch;
        setPlants(plants);
        renderPlants();
        if (currentGrowlogPlantId === plantIdForEntry) renderGrowlog(plantIdForEntry);
      }
    }
    const plantSelect = document.getElementById('entry-plant');
    if (plantSelect) plantSelect.disabled = false;
    modalEntry.classList.remove('open');
    renderJournal();
    renderDashboard();
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
      const first = sel.options[0] ? sel.options[0].outerHTML : '<option value="">-- Odaberi biljku --</option>';
      sel.innerHTML = first + options;
    });

    const graphsSel = document.getElementById('tool-graphs-plant');
    if (graphsSel) {
      const first = graphsSel.options[0] ? graphsSel.options[0].outerHTML : '<option value="">Sve biljke</option>';
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
      listEl.innerHTML = '<p class="toolbox-empty">Nema unosa. Dodajte prvi.</p>';
      return;
    }
    const plants = getPlants();
    const plantById = new Map(plants.map((p) => [p.id, p.name]));
    const plantLabel = (plantId) => {
      if (!plantId) return '—';
      return plantById.get(plantId) || 'Biljka';
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
          if (item.soilQuality) parts.push('Kvaliteta zemlje: ' + escapeHtml(String(item.soilQuality)));
          if (item.plantAge) parts.push('Starost: ' + escapeHtml(String(item.plantAge)));
          if (item.plantCondition) parts.push('Stanje: ' + escapeHtml(String(item.plantCondition)));
          parts.push('Biljka: ' + escapeHtml(plantLabel(item.plantId)));
          valuesStr = parts.join(' · ') || '-';
        } else if (tool === 'stressors') {
          const parts = [];
          if (item.temperature) parts.push('Temperatura: ' + escapeHtml(String(item.temperature)));
          if (item.humidity) parts.push('Vlaga: ' + escapeHtml(String(item.humidity)));
          if (item.vpd) parts.push('VPD: ' + escapeHtml(String(item.vpd)));
          if (item.pests) parts.push('Nametnici: ' + escapeHtml(String(item.pests)));
          parts.push('Biljka: ' + escapeHtml(plantLabel(item.plantId)));
          valuesStr = parts.join(' · ') || '-';
        } else {
          valuesStr = escapeHtml(String(item.value1 || '')) + (item.value2 ? ' · ' + escapeHtml(String(item.value2)) : '');
        }
        return (
          '<div class="toolbox-list-item" data-id="' +
          item.id +
          '"><span class="toolbox-list-date">' +
          (item.date ? new Date(item.date).toLocaleDateString('hr-HR') : '') +
          '</span><span class="toolbox-list-values">' +
          valuesStr +
          '</span><button type="button" class="toolbox-list-delete" aria-label="Obriši">×</button></div>'
        );
      })
      .join('');
    listEl.querySelectorAll('.toolbox-list-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (blockAdminWrite()) return;
        const id = btn.closest('.toolbox-list-item').dataset.id;
        const data = getToolboxData();
        data[tool] = data[tool].filter((x) => x.id !== id);
        setToolboxData(data);
        renderToolboxList(tool);
        const chartEl = document.getElementById('toolbox-chart-' + tool);
        if (chartEl) renderToolboxChart(tool, chartEl);
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
      container.innerHTML = '<p class="toolbox-chart-empty">Nema podataka za graf.</p>';
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
            const label = x.date ? new Date(x.date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' }) : '';
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
            const label = x.date ? new Date(x.date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' }) : '';
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
          .map((x) => '<div class="toolbox-timeline-item"><span class="toolbox-list-date">' + (x.date ? new Date(x.date).toLocaleDateString('hr-HR') : '') + '</span> ' + escapeHtml(String(x.value1 || '')) + (x.value2 ? ' – ' + escapeHtml(String(x.value2)) : '') + '</div>')
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
    const data = getToolboxData();
    data.watering.push({
      id: uuid(),
      date: document.getElementById('tool-watering-date').value,
      value1: document.getElementById('tool-watering-value1').value.trim(),
      value2: document.getElementById('tool-watering-value2').value.trim() || null,
    });
    setToolboxData(data);
    document.getElementById('toolbox-form-watering').reset();
    renderToolboxList('watering');
    renderToolboxChart('watering', document.getElementById('toolbox-chart-watering'));
  });

  document.getElementById('toolbox-form-feeding').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = getToolboxData();
    data.feeding.push({
      id: uuid(),
      date: document.getElementById('tool-feeding-date').value,
      value1: document.getElementById('tool-feeding-value1').value.trim(),
      value2: document.getElementById('tool-feeding-value2').value.trim() || null,
      plantId: document.getElementById('tool-feeding-plant').value.trim() || null,
    });
    setToolboxData(data);
    document.getElementById('toolbox-form-feeding').reset();
    renderToolboxList('feeding');
    renderToolboxChart('feeding', document.getElementById('toolbox-chart-feeding'));
  });

  document.getElementById('toolbox-form-environment').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = getToolboxData();
    data.environment.push({
      id: uuid(),
      date: document.getElementById('tool-environment-date').value,
      value1: document.getElementById('tool-environment-value1').value.trim(),
      value2: document.getElementById('tool-environment-value2').value.trim() || null,
      value3: document.getElementById('tool-environment-value3').value.trim() || null,
      plantId: document.getElementById('tool-environment-plant').value.trim() || null,
    });
    setToolboxData(data);
    document.getElementById('toolbox-form-environment').reset();
    renderToolboxList('environment');
    renderToolboxChart('environment', document.getElementById('toolbox-chart-environment'));
  });

  const transplantForm = document.getElementById('toolbox-form-transplant');
  if (transplantForm) {
    transplantForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = getToolboxData();
      data.transplant.push({
        id: uuid(),
        date: document.getElementById('tool-transplant-date').value,
        soilQuality: document.getElementById('tool-transplant-soil').value.trim() || null,
        plantAge: document.getElementById('tool-transplant-age').value.trim() || null,
        plantCondition: document.getElementById('tool-transplant-condition').value.trim() || null,
        plantId: document.getElementById('tool-transplant-plant').value.trim() || null,
      });
      setToolboxData(data);
      document.getElementById('toolbox-form-transplant').reset();
      renderToolboxList('transplant');
    });
  }

  const stressorsForm = document.getElementById('toolbox-form-stressors');
  if (stressorsForm) {
    stressorsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = getToolboxData();
      data.stressors.push({
        id: uuid(),
        date: document.getElementById('tool-stressors-date').value,
        temperature: document.getElementById('tool-stressors-temp').value.trim() || null,
        humidity: document.getElementById('tool-stressors-humidity').value.trim() || null,
        vpd: document.getElementById('tool-stressors-vpd').value.trim() || null,
        pests: document.getElementById('tool-stressors-pests').value.trim() || null,
        plantId: document.getElementById('tool-stressors-plant').value.trim() || null,
      });
      setToolboxData(data);
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

})();
