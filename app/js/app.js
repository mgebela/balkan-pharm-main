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
    journal: 'Dnevnik',
    toolbox: 'Alati',
  };

  function showView(id) {
    views.forEach((v) => v.classList.remove('active'));
    navItems.forEach((n) => n.classList.remove('active'));
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
      showView(item.dataset.view);
    });
  });

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
          return `
            <div class="recent-note">
              <div class="meta">${plantName} · ${date} · ${e.type || 'Općenito'}</div>
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
        <div class="plant-card-header">
          <h3>${escapeHtml(p.name)}</h3>
          <span class="stage-badge">${STAGES[p.stage] || p.stage}</span>
        </div>
        ${p.strain ? `<div class="strain">${escapeHtml(p.strain)}</div>` : ''}
        ${p.startDate ? `<div class="text-muted" style="font-size:0.85rem">Od ${new Date(p.startDate).toLocaleDateString('hr-HR')}</div>` : ''}
        <div class="plant-card-actions">
          <button type="button" class="btn btn-ghost btn-edit-plant">Uredi</button>
          <button type="button" class="btn btn-ghost btn-delete-plant">Obriši</button>
        </div>
      </div>
    `
      )
      .join('');

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
    document.getElementById('plant-id').value = editId || '';
    titleEl.textContent = editId ? 'Uredi biljku' : 'Nova biljka';
    if (editId) {
      const p = getPlants().find((x) => x.id === editId);
      if (p) {
        document.getElementById('plant-name').value = p.name;
        document.getElementById('plant-strain').value = p.strain || '';
        document.getElementById('plant-stage').value = p.stage || 'klijanje';
        document.getElementById('plant-start-date').value = p.startDate || '';
        document.getElementById('plant-notes').value = p.notes || '';
      }
    } else {
      form.reset();
      document.getElementById('plant-id').value = '';
      document.getElementById('plant-stage').value = 'klijanje';
    }
    modal.classList.add('open');
  }

  function closePlantModal() {
    document.getElementById('modal-plant').classList.remove('open');
  }

  document.getElementById('btn-add-plant').addEventListener('click', () => openPlantModal());

  document.getElementById('form-plant').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('plant-id').value;
    const plants = getPlants();
    const payload = {
      id: id || uuid(),
      name: document.getElementById('plant-name').value.trim(),
      strain: document.getElementById('plant-strain').value.trim(),
      stage: document.getElementById('plant-stage').value,
      startDate: document.getElementById('plant-start-date').value || null,
      notes: document.getElementById('plant-notes').value.trim(),
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
        return `
          <div class="journal-entry">
            <div class="entry-meta">
              <span class="entry-type">${e.type || 'Općenito'}</span>
              ${plantName} · ${date}
            </div>
            <div class="entry-note">${escapeHtml(e.note || '')}</div>
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
    modalEntry.classList.add('open');
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
