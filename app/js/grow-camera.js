/*
 * Full in-app plant camera — live preview, shutter, then Log / Ask coach / Retake.
 */
(function () {
  'use strict';

  const MAX_EDGE = 800;
  const MAX_CHARS = 350000;

  let root = null;
  let stream = null;
  let facingMode = 'environment';
  let capturedDataUrl = null;
  let openOpts = {};
  let starting = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(msg, isError) {
    const el = document.getElementById('grow-camera-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
    el.hidden = !msg;
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      stream = null;
    }
    const video = document.getElementById('grow-camera-video');
    if (video) {
      try {
        video.srcObject = null;
      } catch {
        // ignore
      }
    }
  }

  function resizeDataUrl(dataUrl) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        let w = img.width || 0;
        let h = img.height || 0;
        if (!w || !h) {
          reject(new Error('Could not read image.'));
          return;
        }
        const long = Math.max(w, h);
        if (long > MAX_EDGE) {
          const scale = MAX_EDGE / long;
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
        ctx.fillStyle = '#0a120e';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.82;
        let out = '';
        try {
          out = canvas.toDataURL('image/jpeg', quality);
          while (out.length > MAX_CHARS && quality > 0.45) {
            quality -= 0.1;
            out = canvas.toDataURL('image/jpeg', quality);
          }
        } catch (err) {
          reject(err || new Error('Could not encode image.'));
          return;
        }
        if (!out || out.length > MAX_CHARS) {
          reject(new Error('Photo is still too large. Try again.'));
          return;
        }
        resolve(out);
      };
      img.onerror = function () {
        reject(new Error('Could not load that image.'));
      };
      img.src = dataUrl;
    });
  }

  function ensureDom() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'grow-camera-root';
    root.className = 'grow-camera-root';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'grow-camera-title');
    root.innerHTML =
      '<div class="grow-camera-stage">' +
      '<video id="grow-camera-video" class="grow-camera-video" playsinline muted autoplay></video>' +
      '<img id="grow-camera-shot" class="grow-camera-shot" alt="Captured plant photo" hidden />' +
      '<canvas id="grow-camera-canvas" hidden></canvas>' +
      '</div>' +
      '<header class="grow-camera-bar grow-camera-bar--top">' +
      '<button type="button" class="grow-camera-btn grow-camera-btn--ghost" id="grow-camera-close" aria-label="Close camera">Close</button>' +
      '<div class="grow-camera-title-wrap">' +
      '<strong id="grow-camera-title">Plant camera</strong>' +
      '<span class="grow-camera-sub" id="grow-camera-sub">Frame the plant, then shoot</span>' +
      '</div>' +
      '<button type="button" class="grow-camera-btn grow-camera-btn--ghost" id="grow-camera-flip" aria-label="Flip camera">Flip</button>' +
      '</header>' +
      '<p class="grow-camera-status" id="grow-camera-status" hidden></p>' +
      '<footer class="grow-camera-bar grow-camera-bar--bottom" id="grow-camera-live-bar">' +
      '<button type="button" class="grow-camera-btn grow-camera-btn--ghost" id="grow-camera-gallery">Gallery</button>' +
      '<button type="button" class="grow-camera-shutter" id="grow-camera-shutter" aria-label="Take photo">' +
      '<span class="grow-camera-shutter-ring" aria-hidden="true"></span>' +
      '</button>' +
      '<span class="grow-camera-spacer" aria-hidden="true"></span>' +
      '</footer>' +
      '<footer class="grow-camera-bar grow-camera-bar--review" id="grow-camera-review-bar" hidden>' +
      '<button type="button" class="btn btn-ghost" id="grow-camera-retake">Retake</button>' +
      '<button type="button" class="btn btn-secondary" id="grow-camera-log">Log to journal</button>' +
      '<button type="button" class="btn btn-primary" id="grow-camera-coach">Ask coach</button>' +
      '</footer>' +
      '<input type="file" id="grow-camera-file" accept="image/*" hidden />';
    document.body.appendChild(root);

    document.getElementById('grow-camera-close').addEventListener('click', close);
    document.getElementById('grow-camera-flip').addEventListener('click', function () {
      facingMode = facingMode === 'environment' ? 'user' : 'environment';
      startCamera();
    });
    document.getElementById('grow-camera-shutter').addEventListener('click', capture);
    document.getElementById('grow-camera-retake').addEventListener('click', retake);
    document.getElementById('grow-camera-log').addEventListener('click', logToJournal);
    document.getElementById('grow-camera-coach').addEventListener('click', askCoach);
    document.getElementById('grow-camera-gallery').addEventListener('click', function () {
      const input = document.getElementById('grow-camera-file');
      if (input) input.click();
    });
    document.getElementById('grow-camera-file').addEventListener('change', async function (e) {
      const file = e.target && e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        setStatus('Preparing photo…');
        const raw = await readFileAsDataUrl(file);
        const resized = await resizeDataUrl(raw);
        showReview(resized);
        setStatus('');
      } catch (err) {
        setStatus((err && err.message) || 'Could not open that photo.', true);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!root || root.hidden) return;
      if (e.key === 'Escape') close();
    });

    return root;
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function setMode(mode) {
    const live = document.getElementById('grow-camera-live-bar');
    const review = document.getElementById('grow-camera-review-bar');
    const video = document.getElementById('grow-camera-video');
    const shot = document.getElementById('grow-camera-shot');
    const flip = document.getElementById('grow-camera-flip');
    const sub = document.getElementById('grow-camera-sub');
    const isReview = mode === 'review';
    if (live) live.hidden = isReview;
    if (review) review.hidden = !isReview;
    if (video) video.hidden = isReview;
    if (shot) shot.hidden = !isReview;
    if (flip) flip.hidden = isReview;
    if (sub) {
      sub.textContent = isReview
        ? 'Save a journal log or send to the coach'
        : 'Frame the plant, then shoot';
    }
    root.classList.toggle('grow-camera-root--review', isReview);
  }

  function showReview(dataUrl) {
    capturedDataUrl = dataUrl;
    const shot = document.getElementById('grow-camera-shot');
    if (shot) {
      shot.src = dataUrl;
      shot.hidden = false;
    }
    stopStream();
    setMode('review');
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Camera not supported here — use Gallery.', true);
      return;
    }
    if (starting) return;
    starting = true;
    setStatus('Starting camera…');
    stopStream();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
      });
      const video = document.getElementById('grow-camera-video');
      if (video) {
        video.srcObject = stream;
        await video.play().catch(function () {
          // autoplay policies — still usually ok with muted+playsinline
        });
      }
      setStatus('');
      setMode('live');
    } catch (err) {
      console.warn('grow camera', err);
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setStatus('Camera permission blocked — use Gallery, or allow camera for growto.live.', true);
      } else if (name === 'NotFoundError') {
        setStatus('No camera found — use Gallery.', true);
      } else {
        setStatus('Could not open camera — use Gallery.', true);
      }
    } finally {
      starting = false;
    }
  }

  async function capture() {
    const video = document.getElementById('grow-camera-video');
    const canvas = document.getElementById('grow-camera-canvas');
    if (!video || !canvas || !stream) {
      setStatus('Camera not ready.', true);
      return;
    }
    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;
    if (!w || !h) {
      setStatus('Wait for the preview, then try again.', true);
      return;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setStatus('Could not capture frame.', true);
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    try {
      const raw = canvas.toDataURL('image/jpeg', 0.9);
      const resized = await resizeDataUrl(raw);
      showReview(resized);
      setStatus('');
    } catch (err) {
      setStatus((err && err.message) || 'Capture failed.', true);
    }
  }

  async function retake() {
    capturedDataUrl = null;
    const shot = document.getElementById('grow-camera-shot');
    if (shot) {
      shot.removeAttribute('src');
      shot.hidden = true;
    }
    setMode('live');
    await startCamera();
  }

  function resolvePlantId() {
    if (openOpts.plantId) return String(openOpts.plantId);
    try {
      if (window.DnevnikJournal && typeof DnevnikJournal.getCurrentGrowlogPlantId === 'function') {
        const id = DnevnikJournal.getCurrentGrowlogPlantId();
        if (id) return String(id);
      }
    } catch {
      // ignore
    }
    try {
      if (window.DnevnikJournal && typeof DnevnikJournal.getPlants === 'function') {
        const plants = DnevnikJournal.getPlants() || [];
        if (plants[0] && plants[0].id) return String(plants[0].id);
      }
    } catch {
      // ignore
    }
    return '';
  }

  function logToJournal() {
    if (!capturedDataUrl) return;
    const plantId = resolvePlantId();
    const dataUrl = capturedDataUrl;
    if (typeof openOpts.onLog === 'function') {
      try {
        openOpts.onLog({ dataUrl: dataUrl, plantId: plantId });
      } catch (err) {
        console.warn('camera onLog', err);
        setStatus((err && err.message) || 'Could not use photo.', true);
        return;
      }
      close();
      return;
    }
    if (!plantId) {
      setStatus('Add a plant in the journal first, then log a photo.', true);
      return;
    }
    close();
    try {
      if (window.DnevnikJournal && typeof DnevnikJournal.saveEntry === 'function') {
        DnevnikJournal.saveEntry({
          plantId: plantId,
          type: 'opcenito',
          note: 'Photo log from plant camera',
          photo: dataUrl,
          source: 'grow-camera',
          requireNoteDefault: false,
        });
      } else if (window.DnevnikJournal && typeof DnevnikJournal.openEntry === 'function') {
        DnevnikJournal.openEntry({
          plantId: plantId,
          type: 'opcenito',
          photo: dataUrl,
        });
        return;
      }
    } catch (err) {
      console.warn('camera log', err);
      if (window.DnevnikJournal && typeof DnevnikJournal.openEntry === 'function') {
        DnevnikJournal.openEntry({
          plantId: plantId,
          type: 'opcenito',
          photo: dataUrl,
        });
        return;
      }
      alert((err && err.message) || 'Could not save photo log.');
      return;
    }
    if (typeof window.showAppView === 'function') {
      window.showAppView('plants');
    } else {
      const nav = document.querySelector('.nav-item[data-view="plants"]');
      if (nav) nav.click();
    }
  }

  function askCoach() {
    if (!capturedDataUrl) return;
    const dataUrl = capturedDataUrl;
    if (typeof openOpts.onAskCoach === 'function') {
      try {
        openOpts.onAskCoach({ dataUrl: dataUrl });
      } catch (err) {
        console.warn('camera onAskCoach', err);
      }
      close();
      return;
    }
    close();
    if (window.AICoach) {
      if (typeof AICoach.open === 'function') AICoach.open();
      if (typeof AICoach.attachImage === 'function') {
        AICoach.attachImage(dataUrl);
      }
      if (typeof AICoach.ask === 'function') {
        AICoach.ask(
          'Please look at this plant photo and help me diagnose what you see. Cite what is visible, then suggest the next journal log if needed.'
        );
      }
    }
  }

  function open(opts) {
    openOpts = opts || {};
    ensureDom();
    capturedDataUrl = null;
    root.hidden = false;
    document.body.classList.add('grow-camera-open');
    setMode('live');
    const shot = document.getElementById('grow-camera-shot');
    if (shot) {
      shot.removeAttribute('src');
      shot.hidden = true;
    }
    // Prefer rear camera for plant shots unless caller asks otherwise.
    facingMode = openOpts.facingMode === 'user' ? 'user' : 'environment';
    startCamera();
  }

  function close() {
    stopStream();
    capturedDataUrl = null;
    if (root) root.hidden = true;
    document.body.classList.remove('grow-camera-open');
    setStatus('');
    if (typeof openOpts.onClose === 'function') {
      try {
        openOpts.onClose();
      } catch {
        // ignore
      }
    }
    openOpts = {};
  }

  window.GrowCamera = {
    open: open,
    close: close,
    isOpen: function () {
      return !!(root && !root.hidden);
    },
  };
})();
