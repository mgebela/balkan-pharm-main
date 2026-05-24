(function () {
  const LIVE_URL = 'http://164.92.208.95/latest.json';
  const CACHE_URL = 'latest.json';
  const REFRESH_MS = 2000;
  const ONLINE_SEC = 60;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeDevices(data) {
    if (Array.isArray(data)) {
      return data.map((d) => ({
        id: String(d.device_id != null ? d.device_id : d.id || '0'),
        moisture: Number(d.moisture) || 0,
        raw: d.raw,
        location: d.location || '—',
        server_time: d.server_time || d.last_seen || 0,
      }));
    }
    if (data && typeof data === 'object') {
      return Object.keys(data).map((id) => {
        const d = data[id] || {};
        return {
          id: String(id),
          moisture: Number(d.moisture) || 0,
          raw: d.raw,
          location: d.location || '—',
          server_time: d.server_time || d.last_seen || 0,
        };
      });
    }
    return [];
  }

  async function fetchSoilMoistureData() {
    try {
      const res = await fetch(LIVE_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) return { data: await res.json(), source: 'live' };
    } catch {
      // CORS / mixed content — fallback to synced cache on same origin
    }
    const res = await fetch(CACHE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Cache unavailable');
    return { data: await res.json(), source: 'cache' };
  }

  function renderDeviceCard(d, source) {
    const now = Math.floor(Date.now() / 1000);
    const diff = d.server_time ? now - d.server_time : Infinity;
    const online = diff < ONLINE_SEC;
    const pct = Math.max(0, Math.min(100, d.moisture));
    const updated = d.server_time ? new Date(d.server_time * 1000).toLocaleString('hr-HR') : '—';

    return (
      '<article class="soil-moisture-card">' +
      '<div class="soil-moisture-card-head">' +
      `<h3 class="soil-moisture-card-title">🌿 Uređaj ${escapeHtml(d.id)}</h3>` +
      `<span class="soil-moisture-status soil-moisture-status--${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>` +
      '</div>' +
      `<p class="soil-moisture-metric">💧 Vlažnost: <strong>${pct}%</strong></p>` +
      `<div class="soil-moisture-bar"><div class="soil-moisture-bar-fill" style="width:${pct}%"></div></div>` +
      `<p class="soil-moisture-metric">📟 Raw: <strong>${escapeHtml(String(d.raw != null ? d.raw : '—'))}</strong></p>` +
      `<p class="soil-moisture-metric">📍 Lokacija: <strong>${escapeHtml(d.location)}</strong></p>` +
      `<div class="soil-moisture-meta">⏱ Zadnji signal: ${escapeHtml(updated)}` +
      (source === 'cache' ? ' · sync cache' : ' · live') +
      '</div></article>'
    );
  }

  async function load() {
    const grid = document.getElementById('soil-moisture-grid');
    if (!grid) return;
    try {
      const { data, source } = await fetchSoilMoistureData();
      const devices = normalizeDevices(data);
      if (!devices.length) {
        grid.innerHTML = '<p class="admin-empty-state">Nema podataka sa senzora.</p>';
        return;
      }
      grid.innerHTML = devices.map((d) => renderDeviceCard(d, source)).join('');
    } catch {
      grid.innerHTML =
        '<p class="admin-empty-state">Učitavanje nije uspjelo. <a href="http://164.92.208.95/" target="_blank" rel="noreferrer">Otvori nadzornu ploču senzora</a>.</p>';
    }
  }

  load();
  setInterval(load, REFRESH_MS);
})();
