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
    if (!remoteSyncReady) return;
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
    if (!ref) return;
    try {
      const snap = await ref.get();
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (Array.isArray(data.plants)) localStorage.setItem(STORAGE_PLANTS, JSON.stringify(data.plants));
      if (Array.isArray(data.entries)) localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(data.entries));
      if (data.toolbox && typeof data.toolbox === 'object') localStorage.setItem(STORAGE_TOOLBOX, JSON.stringify(data.toolbox));
    } catch {
      // ignore and keep local data
    }
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

  if (!docSnap.exists) {
    await userRef.set({
      email: user.email || "",
      uId: user.uid,
      role: "user",
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    });

    console.log("User created");
  } else {
    await userRef.update({
      lastLoginAt: new Date().toISOString()
    });

    console.log("User updated");
  }
}

function applyRoleUI(role) {
  const adminEls = document.querySelectorAll(".admin-only");
  const superEls = document.querySelectorAll(".admin-super-only");

 
  adminEls.forEach(el => el.style.display = "none");
  superEls.forEach(el => el.style.display = "none");

 
  if (role === "admin" || role === "superadmin") {
    adminEls.forEach(el => el.style.display = "flex");
  }

  if (role === "superadmin") {
    superEls.forEach(el => el.style.display = "flex");
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
  await loadRemoteStateIntoLocal(user.uid);
  remoteSyncReady = true;
  refreshAllViewsAfterRemoteLoad();

 
  if (initialView) {
    if (
      initialView === "admin" &&
      !["admin", "superadmin"].includes(currentUserRole)
    ) {
      showView("dashboard");
    } else if (['dashboard', 'plants', 'cpvo', 'toolbox', 'admin'].includes(initialView)) {
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

  const SUBPHASE_POTS = {
    pot_1_5dcl: '1,5 dcl',
    pot_5l: '5 L',
    pot_30l: '30 L',
    pot_10dcl: '10 dcl',
    pot_1_5l: '1,5 L',
  };

  const SUBPHASE_ORDER = ['pot_1_5dcl', 'pot_5l', 'pot_30l'];

  function subphaseLabel(key) {
    if (!key) return '';
    return SUBPHASE_POTS[key] || key;
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
      renderPlants();
      renderJournal();
    }
    if (id === 'toolbox') renderToolbox();
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

    const subRows = SUBPHASE_ORDER.map((k) => {
      const isCurrent = plant.subphase === k;
      const label = SUBPHASE_POTS[k];
      return (
        '<div class="tree-stage-item tree-subphase-item' +
        (isCurrent ? ' current' : '') +
        '"><span class="tree-stage-icon">🫙</span><span class="tree-stage-label">' +
        escapeHtml(label) +
        '</span></div>'
      );
    }).join('');

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
        '<h4 class="growlog-subsection-title">Povijest prijelaza</h4>' +
        '<div class="stage-history-list">' +
        histHtml +
        '</div>';
    }

    document.getElementById('growlog-environment').innerHTML = `
      <div class="env-row"><span class="env-icon">⛺</span> ${escapeHtml(plant.environmentName || '—')}</div>
      <div class="env-row"><span class="env-icon">💡</span> ${envType}</div>
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
        '<h2 class="growlog-hero-title">' +
        escapeHtml(plant.name) +
        '</h2>' +
        strainHtml +
        '<p class="growlog-hero-hint">Fotografije su u bočnoj traci i u nedavnim slikama ispod.</p>' +
        '</div>';
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
        <div class="text-muted" style="font-size:0.85rem">Nasad: <strong style="color:var(--text)">${Math.max(1, Number(p.count || 1))}</strong> bilj.</div>
        ${p.startDate ? `<div class="text-muted" style="font-size:0.85rem">Od ${new Date(p.startDate).toLocaleDateString('hr-HR')}</div>` : ''}
        <div class="plant-card-actions">
          <button type="button" class="btn btn-primary btn-growlog">Growlog</button>
          <button type="button" class="btn btn-ghost btn-edit-plant">Uredi</button>
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

  function deletePlant(id) {
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
        const subSel = document.getElementById('plant-subphase');
        if (subSel) subSel.value = p.subphase && SUBPHASE_POTS[p.subphase] ? p.subphase : '';
        document.getElementById('plant-start-date').value = p.startDate || '';
        document.getElementById('plant-environment-name').value = p.environmentName || '';
        document.getElementById('plant-environment-type').value = p.environmentType || 'indoor';
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
      document.getElementById('plant-count').value = 1;
      document.getElementById('plant-stage').value = 'klijanje';
      const subSelNew = document.getElementById('plant-subphase');
      if (subSelNew) subSelNew.value = '';
      photoData.value = '';
      photoPreview.innerHTML = '';
    }
    modal.classList.add('open');
  }

  function closePlantModal() {
    document.getElementById('modal-plant').classList.remove('open');
  }

  document.getElementById('btn-add-plant').addEventListener('click', () => openPlantModal());

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

    let stageHistory = [];
    let stageDates = {};
    if (prev) {
      stageHistory = Array.isArray(prev.stageHistory) ? prev.stageHistory.slice() : [];
      stageDates = prev.stageDates && typeof prev.stageDates === 'object' ? { ...prev.stageDates } : {};
    }

    const journalAdds = [];

    if (!id) {
      const day0 = startDateVal || localDateYYYYMMDD();
      stageHistory.push({ from: null, to: newStage, date: day0 });
      stageDates[newStage] = day0;
      let note0 = 'Započet uzgoj — faza: ' + (STAGES[newStage] || newStage);
      if (transitionNote) note0 += '. ' + transitionNote;
      journalAdds.push({
        id: uuid(),
        plantId: newId,
        date: day0,
        type: 'faza',
        note: note0,
        photo: photoData || null,
        meta: { faza: { from: null, to: newStage } },
      });
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
        const note1 = transitionNote ? base + '. ' + transitionNote : base;
        journalAdds.push({
          id: uuid(),
          plantId: newId,
          date: td,
          type: 'faza',
          note: note1,
          photo: photoData || null,
          meta: { faza: { from: stageAtOpen, to: newStage } },
        });
      }
    }

    const payload = {
      id: newId,
      name: document.getElementById('plant-name').value.trim(),
      strain: document.getElementById('plant-strain').value.trim(),
      count: countNum,
      stage: newStage,
      subphase:
        (() => {
          const v = document.getElementById('plant-subphase');
          const raw = v && v.value ? v.value.trim() : '';
          return raw && SUBPHASE_POTS[raw] ? raw : null;
        })(),
      startDate: startDateVal,
      environmentName: document.getElementById('plant-environment-name').value.trim() || null,
      environmentType: document.getElementById('plant-environment-type').value || 'indoor',
      exposureHours: exposureVal ? parseInt(exposureVal, 10) : null,
      notes: document.getElementById('plant-notes').value.trim(),
      photo: photoData || null,
      updatedAt: new Date().toISOString(),
      views: (prev || {}).views ?? 0,
      stageHistory,
      stageDates,
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
    if (currentGrowlogPlantId === newId) renderGrowlog(newId);
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

  function updateEntryExtraVisibility() {
    const type = document.getElementById('entry-type').value;
    const pres = document.getElementById('entry-extra-presadjivanje');
    const stres = document.getElementById('entry-extra-stresori');
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

  function openEntryModal(plantId) {
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
    btnAddEntry.addEventListener('click', () => openEntryModal(null));
  }

  const btnAddEntryGrowlog = document.getElementById('btn-add-entry-growlog');
  if (btnAddEntryGrowlog) {
    btnAddEntryGrowlog.addEventListener('click', () => {
      if (!currentGrowlogPlantId) return;
      openEntryModal(currentGrowlogPlantId);
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
    }
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
  const params = new URLSearchParams(window.location.search);
  const initialView = params.get('view');
  if (initialView) {
    if (
      initialView === "admin" &&
      !["admin", "superadmin"].includes(currentUserRole)
    ) {
      showView("dashboard");
    } else if (['dashboard', 'plants', 'cpvo', 'toolbox', 'admin'].includes(initialView)) {
      showView(initialView);
  }
}
  //WeatherAPI
  const apiKey = "4fcd0d4855e24280a52121246261504";

  document.querySelectorAll(".toolbox-card-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;

    document.querySelectorAll(".toolbox-panel").forEach(panel => {
      panel.style.display = "none";
      panel.setAttribute("aria-hidden", "true");
    });

    const activePanel = document.getElementById(`toolbox-panel-${tool}`);

    if (activePanel) {
      activePanel.style.display = "block";
      activePanel.setAttribute("aria-hidden", "false");
    }

    if (tool === "vrijeme") {
      getWeather("Visnjevac");
    }
  });
});

//test weather  https://api.weatherapi.com/v1/forecast.json?key=4fcd0d4855e24280a52121246261504&q=Visnjevac

async function getWeather(city) {
  const weatherDiv = document.getElementById("weather");
  weatherDiv.innerText = "Loading...";

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${city}&days=7`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      weatherDiv.innerText = "Error: " + data.error.message;
      return;
    }

    displayWeather(data);

  } catch (error) {
    weatherDiv.innerText = "Failed to load weather";
    console.error(error);
  }
}

function displayWeather(data) {
  const city = data.location.name;

  let weatherHTML = `
    <h2>${city} - 7 Dana Prognoza</h2>
    <div class="weather-container">
  `;

  data.forecast.forecastday.forEach(day => {
    const date = day.date;
    const avgTemp = day.day.avgtemp_c;
    const condition = day.day.condition.text;
    const icon = day.day.condition.icon;

    weatherHTML += `
      <div class="weather-card">
        <h4>${date}</h4>
        <img src="https:${icon}" alt="${condition}">
        <p>${condition}</p>
        <p><strong>${avgTemp}°C</strong></p>
      </div>
    `;
  });

  weatherHTML += `</div>`;

  document.getElementById("weather").innerHTML = weatherHTML;
}

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
