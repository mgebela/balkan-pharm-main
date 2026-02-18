(function () {
  const STORAGE_PLANTS = 'balkan-pharm-plants';
  const STORAGE_ENTRIES = 'balkan-pharm-entries';

  const STAGES = {
    klijanje: 'Klijanje',
    sadnica: 'Sadnica',
    vegetativna: 'Vegetativna',
    cvjetanje: 'Cvjetanje',
    susenje: 'Sušenje',
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
  }

  function uuid() {
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  // --- Navigation ---
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');
  const viewTitle = document.querySelector('.view-title');
  const titles = {
    dashboard: 'Nadzorna ploča',
    plants: 'Moje biljke',
    growlog: 'Growlog',
    journal: 'Dnevnik',
    toolbox: 'Alati',
  };

  let currentGrowlogPlantId = null;

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
    if (id === 'plants') renderPlants();
    if (id === 'journal') renderJournal();
  }

  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      if (view === 'plants') currentGrowlogPlantId = null;
      showView(view);
    });
  });

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
    document.getElementById('growlog-tree-stages').innerHTML = stageOrder
      .map((s) => {
        const date = stageDates[s] || (s === 'klijanje' ? startDate : null);
        const isCurrent = plant.stage === s;
        const label = STAGES[s] || s;
        const dateStr = date ? new Date(date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
        return '<div class="tree-stage-item' + (isCurrent ? ' current' : '') + '"><span class="tree-stage-icon">' + (STAGE_ICONS[s] || '•') + '</span><span class="tree-stage-label">' + label + '</span><span class="tree-stage-date">' + dateStr + '</span></div>';
      })
      .join('');

    document.getElementById('growlog-environment').innerHTML = `
      <div class="env-row"><span class="env-icon">⛺</span> ${escapeHtml(plant.environmentName || '—')}</div>
      <div class="env-row"><span class="env-icon">💡</span> ${envType}</div>
      <div class="env-row"><span class="env-icon">🕐</span> ${exposure} osvjetljenja</div>
    `;

    const mainImg = plant.photo || (allPhotos.length ? allPhotos[0] : null);
    const heroEl = document.getElementById('growlog-hero-image');
    if (mainImg) heroEl.innerHTML = '<img src="' + mainImg + '" alt="" />';
    else heroEl.innerHTML = '<div class="growlog-hero-placeholder">Nema glavne fotografije</div>';

    document.getElementById('growlog-plant-name').textContent = plant.name;

    const timelineItems = [];
    entries.slice(0, 20).forEach((e) => {
      const dayWeek = formatDayWeek(e.date, startDate);
      const dateStr = e.date ? new Date(e.date).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
      const typeLabel = e.type || 'Općenito';
      const note = (e.note || '').slice(0, 80) + ((e.note || '').length > 80 ? '…' : '');
      const media = e.photo ? '<img src="' + e.photo + '" alt="" class="timeline-thumb" />' : '';
      timelineItems.push(
        '<div class="timeline-entry"><div class="timeline-entry-header"><span class="timeline-date">📅 ' + dateStr + '</span><span class="timeline-day">' + dayWeek + '</span></div><div class="timeline-entry-body">' + typeLabel + ': ' + escapeHtml(note) + '</div>' + (media ? '<div class="timeline-entry-media">' + media + '</div>' : '') + '</div>'
      );
    });
    document.getElementById('growlog-timeline').innerHTML = timelineItems.length ? timelineItems.join('') : '<p class="growlog-empty">Nema unosa u vremenskoj crti. Dodajte bilješke u Dnevnik.</p>';

    const stripPhotos = allPhotos.slice(0, 8);
    document.getElementById('growlog-photo-strip').innerHTML = stripPhotos.map((src) => '<img src="' + src + '" alt="" />').join('') || '<p class="growlog-empty">Nema fotografija</p>';

    document.getElementById('growlog-back').onclick = () => showView('plants');

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

    cardsEl.innerHTML = `
      <div class="dashboard-card">
        <h3>Broj biljaka</h3>
        <div class="value">${plants.length}</div>
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
              <div class="meta">${plantName} · ${date} · ${e.type || 'Općenito'}</div>
              ${thumb}
              <div class="text">${escapeHtml(e.note || '').slice(0, 120)}${(e.note || '').length > 120 ? '…' : ''}</div>
            </div>
          `;
        })
        .join('');
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
        ${p.strain ? `<div class="strain">${escapeHtml(p.strain)}</div>` : ''}
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
  }

  function openPlantModal(editId) {
    const modal = document.getElementById('modal-plant');
    const form = document.getElementById('form-plant');
    const titleEl = document.getElementById('modal-plant-title');
    const photoData = document.getElementById('plant-photo-data');
    const photoPreview = document.getElementById('plant-photo-preview');
    document.getElementById('plant-id').value = editId || '';
    titleEl.textContent = editId ? 'Uredi biljku' : 'Nova biljka';
    document.getElementById('plant-photo').value = '';
    if (editId) {
      const p = getPlants().find((x) => x.id === editId);
      if (p) {
        document.getElementById('plant-name').value = p.name;
        document.getElementById('plant-strain').value = p.strain || '';
        document.getElementById('plant-stage').value = p.stage || 'klijanje';
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
      }
    } else {
      form.reset();
      document.getElementById('plant-id').value = '';
      document.getElementById('plant-stage').value = 'klijanje';
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
    const photoData = document.getElementById('plant-photo-data').value.trim();
    const exposureVal = document.getElementById('plant-exposure-hours').value.trim();
    const payload = {
      id: id || uuid(),
      name: document.getElementById('plant-name').value.trim(),
      strain: document.getElementById('plant-strain').value.trim(),
      stage: document.getElementById('plant-stage').value,
      startDate: document.getElementById('plant-start-date').value || null,
      environmentName: document.getElementById('plant-environment-name').value.trim() || null,
      environmentType: document.getElementById('plant-environment-type').value || 'indoor',
      exposureHours: exposureVal ? parseInt(exposureVal, 10) : null,
      notes: document.getElementById('plant-notes').value.trim(),
      photo: photoData || null,
      updatedAt: new Date().toISOString(),
      views: (getPlants().find((p) => p.id === id) || {}).views ?? 0,
    };
    let next;
    if (id) {
      next = plants.map((p) => (p.id === id ? payload : p));
    } else {
      next = [...plants, payload];
    }
    setPlants(next);
    closePlantModal();
    renderPlants();
    renderDashboard();
    fillEntryPlantSelect();
    fillJournalPlantFilter();
  });

  document.querySelector('#modal-plant .modal-close').addEventListener('click', closePlantModal);
  document.querySelector('#modal-plant .modal-cancel').addEventListener('click', closePlantModal);

  // --- Journal ---
  function fillEntryPlantSelect() {
    const sel = document.getElementById('entry-plant');
    const plants = getPlants();
    sel.innerHTML = '<option value="">-- Odaberi biljku --</option>' + plants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  }

  function fillJournalPlantFilter() {
    const sel = document.getElementById('journal-plant-filter');
    const plants = getPlants();
    const first = sel.innerHTML.split('</option>')[0] + '</option>';
    sel.innerHTML = first + plants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
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
        const media = [];
        if (e.photo) media.push('<div class="entry-media entry-photo"><img src="' + e.photo + '" alt="Fotografija" /></div>');
        if (e.video) media.push('<div class="entry-media entry-video"><video src="' + e.video + '" controls></video></div>');
        return `
          <div class="journal-entry">
            <div class="entry-meta">
              <span class="entry-type">${e.type || 'Općenito'}</span>
              ${plantName} · ${date}
            </div>
            <div class="entry-note">${escapeHtml(e.note || '')}</div>
            ${media.length ? '<div class="entry-media-wrap">' + media.join('') + '</div>' : ''}
          </div>
        `;
      })
      .join('');
  }

  document.getElementById('journal-plant-filter').addEventListener('change', renderJournal);

  const modalEntry = document.getElementById('modal-entry');
  document.getElementById('btn-add-entry').addEventListener('click', () => {
    fillEntryPlantSelect();
    document.getElementById('form-entry').reset();
    document.getElementById('entry-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('entry-photo-data').value = '';
    document.getElementById('entry-video-data').value = '';
    document.getElementById('entry-photo-preview').innerHTML = '';
    document.getElementById('entry-video-preview').innerHTML = '';
    modalEntry.classList.add('open');
  });

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
    const entries = getEntries();
    entries.push({
      id: uuid(),
      plantId: document.getElementById('entry-plant').value || null,
      date: document.getElementById('entry-date').value,
      type: document.getElementById('entry-type').value,
      note: document.getElementById('entry-note').value.trim(),
      photo: document.getElementById('entry-photo-data').value.trim() || null,
      video: document.getElementById('entry-video-data').value.trim() || null,
    });
    setEntries(entries);
    modalEntry.classList.remove('open');
    renderJournal();
    renderDashboard();
  });

  modalEntry.querySelector('.modal-close').addEventListener('click', () => modalEntry.classList.remove('open'));
  modalEntry.querySelector('.modal-cancel').addEventListener('click', () => modalEntry.classList.remove('open'));

  // Init
  fillEntryPlantSelect();
  fillJournalPlantFilter();
  renderDashboard();
})();
