/*
 * Grower AI Coach — advice + executable journal/token actions (text or voice).
 * Calls Cloud Function `coachChat` when signed in; falls back to local intents.
 */
(function () {
  'use strict';

  const STORAGE_PLANTS = 'dnevnik-live-plants';
  const STORAGE_ENTRIES = 'dnevnik-live-entries';
  const STORAGE_TOOLBOX = 'dnevnik-live-toolbox';
  const STORAGE_CHAT = 'dnevnik-live-coach-chat';
  const STORAGE_DRAFT = 'dnevnik-live-coach-draft';
  const STORAGE_REMINDER_DISMISS = 'dnevnik-live-coach-reminder-dismiss';
  const PLANT_ID_RE = /\bid-\d{10,}-[a-z0-9]+\b/gi;

  const COACH_URL = 'https://coachchat-zwul5y4amq-ew.a.run.app';

  const STAGE_LABELS = {
    klijanje: 'Germination',
    sadnica: 'Seedling',
    vegetativna: 'Vegetative',
    cvjetanje: 'Flowering',
    susenje: 'Drying',
  };

  const STAGE_ALIASES = {
    germination: 'klijanje',
    germinating: 'klijanje',
    klijanje: 'klijanje',
    seedling: 'sadnica',
    sadnica: 'sadnica',
    vegetative: 'vegetativna',
    veg: 'vegetativna',
    vegetativna: 'vegetativna',
    flowering: 'cvjetanje',
    flower: 'cvjetanje',
    bloom: 'cvjetanje',
    cvjetanje: 'cvjetanje',
    drying: 'susenje',
    harvest: 'susenje',
    dry: 'susenje',
    susenje: 'susenje',
  };

  const STAGE_ORDER = ['klijanje', 'sadnica', 'vegetativna', 'cvjetanje', 'susenje'];
  const SUBPHASE_LABELS = {
    pot_1_5dcl: '1.5 dcl pot',
    pot_5l: '5 L pot',
    pot_30l: '30 L pot',
    na_polju: 'In the field',
  };

  const STAGE_PLAYBOOK = {
    klijanje: {
      title: 'Germination',
      steps: [
        'Keep seeds warm and lightly moist — avoid soaking the medium.',
        'Log the stage change to Germination in the plant profile.',
        'Add a Watering entry when you first water.',
        'For tokenisation: link the plant, then mint germination (feeding optional at this stage).',
      ],
    },
    sadnica: {
      title: 'Seedling',
      steps: [
        'Gentle light, steady moisture, avoid overfeeding.',
        'Log watering and start a light nutrient schedule (Feeding entry).',
        'Update stage to Seedling so growth mint proof can pass.',
        'Token tip: seedling mint needs stage + watering + feeding logs.',
      ],
    },
    vegetativna: {
      title: 'Vegetative',
      steps: [
        'Increase light and feed for leaf growth; watch VPD / humidity.',
        'Log regular watering and feeding in journal or Tools.',
        'Note environment changes (temp, RH) in Tools → Environment.',
        'Token tip: vegetative mint needs proof in the current stage window.',
      ],
    },
    cvjetanje: {
      title: 'Flowering',
      steps: [
        'Shift nutrients toward bloom; keep an eye on pests and bud rot risk.',
        'Log every watering/feeding and photo notes for provenance.',
        'Update stage to Flowering before requesting the flowering mint.',
        'Token tip: flowering stage also upgrades the on-chain asset type.',
      ],
    },
    susenje: {
      title: 'Drying / harvest prep',
      steps: [
        'Slow dry in controlled humidity; log harvest and drying notes.',
        'Complete final watering/feeding history for the cycle.',
        'Set stage to Drying / harvest to unlock the harvest mint.',
        'Token tip: harvest stage is the last $GROWTOO milestone on the growth path.',
      ],
    },
  };

  const QUICK_PROMPTS = [
    {
      id: 'next',
      label: 'What next?',
      hint: 'Priorities for today',
      text: 'What should I do next for my current plants?',
    },
    {
      id: 'create',
      label: 'Add a plant',
      hint: 'Start a new journal',
      text: 'Create a new indoor plant named CBD Auto starting at germination.',
    },
    {
      id: 'water',
      label: 'Log watering',
      hint: 'Quick care entry',
      text: 'Log watering for my current plant.',
    },
    {
      id: 'feed',
      label: 'Log feeding',
      hint: 'Nutrients entry',
      text: 'Log feeding for my current plant.',
    },
    {
      id: 'stage',
      label: 'Update stage',
      hint: 'Move growth phase',
      text: 'Help me update my plant to the next growth stage.',
    },
    {
      id: 'mint',
      label: 'Mint / grow',
      hint: 'Tokenise progress',
      text: 'Mint a seed or the next growth stage for my linked plant if journal proof is ready.',
    },
  ];

  /*
   * What the coach can actually do, shown as a persistent row under the
   * composer. The panel opens without focusing the input — raising the
   * keyboard on open hid this row and left the user staring at a blank
   * text field with no idea what to ask.
   */
  const COACH_CAPABILITIES = [
    {
      id: 'today',
      label: 'Today',
      icon:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/></svg>',
      text:
        'What should I do next for my current plants?',
    },
    {
      id: 'care',
      label: 'Log care',
      icon:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3s5 5.5 5 9a5 5 0 01-10 0c0-3.5 5-9 5-9z"/></svg>',
      text:
        'Log watering for my current plant.',
    },
    {
      id: 'diagnose',
      label: 'Diagnose',
      icon:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
      text:
        'Something looks wrong with my plant. Attach a leaf photo with + for a better read, then ask what you need and help me diagnose it.',
    },
    {
      id: 'weather',
      label: 'Weather',
      icon:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17a4 4 0 010-8 5.5 5.5 0 0110.5 1.5A3.5 3.5 0 1117.5 17z"/></svg>',
      text:
        'What does the weather forecast mean for my grow over the next few days?',
    },
    {
      id: 'stage',
      label: 'Stage',
      icon:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21v-8"/><path d="M12 14c-3.2 0-5-2-5-5 3.2 0 5 2 5 5z"/><path d="M12 12c0-3 1.8-5 5-5 0 3-1.8 5-5 5z"/></svg>',
      text:
        'Help me update my plant to the next growth stage.',
    },
    {
      id: 'tokenise',
      label: 'Tokenise',
      icon:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h5M9.5 14h5"/></svg>',
      text:
        'Mint a seed or the next growth stage for my linked plant if journal proof is ready.',
    },
  ];

  const MAX_COACH_IMAGE_EDGE = 800;
  const MAX_COACH_IMAGE_CHARS = 350000;

  let open = false;
  let busy = false;
  let history = [];
  let pendingActions = [];
  let pendingImage = null;
  let recognition = null;
  let listening = false;
  let typing = false;

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

  function resizeCoachImageDataUrl(dataUrl, maxEdge) {
    const edge = Math.max(64, Number(maxEdge) || MAX_COACH_IMAGE_EDGE);
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
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
          while (out.length > MAX_COACH_IMAGE_CHARS && quality > 0.45) {
            quality -= 0.1;
            out = canvas.toDataURL('image/jpeg', quality);
          }
        } catch (err) {
          reject(err || new Error('Could not encode image.'));
          return;
        }
        if (!out || out.length > MAX_COACH_IMAGE_CHARS) {
          reject(new Error('Photo is still too large after compression. Try a smaller image.'));
          return;
        }
        resolve(out);
      };
      img.onerror = function () {
        reject(new Error('Could not load that image. Try JPG or PNG.'));
      };
      img.src = dataUrl;
    });
  }

  function detectCoachLocale(message) {
    const t = String(message || '');
    if (/[čćžšđČĆŽŠĐ]/.test(t)) return 'hr';
    if (
      /\b(biljk|zalij|gnoj|faz|cvjetanj|sadnic|klij|vlag|temperat|što|kako|moj[ae]?)\b/i.test(t)
    ) {
      return 'hr';
    }
    return 'en';
  }

  function syncAttachPreview() {
    const preview = document.getElementById('ai-coach-attach-preview');
    const thumb = document.getElementById('ai-coach-attach-thumb');
    const attachBtn = document.getElementById('ai-coach-attach');
    if (!preview || !thumb) return;
    if (pendingImage) {
      preview.hidden = false;
      thumb.src = pendingImage;
      if (attachBtn) attachBtn.setAttribute('aria-pressed', 'true');
    } else {
      preview.hidden = true;
      thumb.removeAttribute('src');
      if (attachBtn) attachBtn.setAttribute('aria-pressed', 'false');
    }
  }

  function clearPendingImage() {
    pendingImage = null;
    const input = document.getElementById('ai-coach-file');
    if (input) input.value = '';
    syncAttachPreview();
  }

  async function onCoachFileSelected(file) {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setStatus('Choose an image file (JPG or PNG).');
      return;
    }
    setStatus('Preparing photo…');
    try {
      const raw = await readFileAsDataUrl(file);
      pendingImage = await resizeCoachImageDataUrl(raw, MAX_COACH_IMAGE_EDGE);
      syncAttachPreview();
      setStatus('Photo attached — add a note and send.');
    } catch (err) {
      clearPendingImage();
      setStatus((err && err.message) || 'Could not attach that photo.');
    }
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function currentAuthUid() {
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return String(firebase.auth().currentUser.uid || '');
      }
    } catch {
      // ignore
    }
    return '';
  }

  function scopedKey(base) {
    const uid = currentAuthUid();
    return uid ? base + ':' + uid : base;
  }

  function looksLikePlantId(value) {
    return /^id-\d{10,}-[a-z0-9]+$/i.test(String(value == null ? '' : value).trim());
  }

  function isGrower() {
    if (window.DnevnikProfile && typeof DnevnikProfile.isGrower === 'function') {
      return DnevnikProfile.isGrower();
    }
    return document.body.classList.contains('profile-grower');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getPlants() {
    if (window.DnevnikJournal && typeof DnevnikJournal.getPlants === 'function') {
      return DnevnikJournal.getPlants() || [];
    }
    const list = readJson(STORAGE_PLANTS, []);
    return Array.isArray(list) ? list : [];
  }

  function getEntries() {
    if (window.DnevnikJournal && typeof DnevnikJournal.getEntries === 'function') {
      return DnevnikJournal.getEntries() || [];
    }
    const list = readJson(STORAGE_ENTRIES, []);
    return Array.isArray(list) ? list : [];
  }

  function getToolbox() {
    const box = readJson(STORAGE_TOOLBOX, {});
    return box && typeof box === 'object' ? box : {};
  }

  function toMs(value) {
    if (!value) return 0;
    const t = Date.parse(String(value));
    return Number.isNaN(t) ? 0 : t;
  }

  function nowMs() {
    return Date.now();
  }

  function daysSinceMs(ms) {
    if (!ms) return null;
    const diff = Math.max(0, nowMs() - ms);
    return Math.floor(diff / 86400000);
  }

  function subphaseLabel(subphase) {
    return SUBPHASE_LABELS[subphase] || subphase || 'not set';
  }

  function readDismissedReminders() {
    const raw = readJson(STORAGE_REMINDER_DISMISS, {});
    return raw && typeof raw === 'object' ? raw : {};
  }

  function saveDismissedReminders(state) {
    try {
      localStorage.setItem(STORAGE_REMINDER_DISMISS, JSON.stringify(state || {}));
    } catch {
      // ignore
    }
  }

  function dismissReminder(id) {
    const key = String(id || '');
    if (!key) return;
    const state = readDismissedReminders();
    state[key] = new Date().toISOString();
    saveDismissedReminders(state);
    renderMessages();
  }

  function isReminderDismissed(id, daily) {
    const state = readDismissedReminders();
    const raw = state[String(id || '')];
    if (!raw) return false;
    if (!daily) return true;
    const ts = toMs(raw);
    if (!ts) return false;
    return nowMs() - ts < 86400000;
  }

  function latestToolboxDateMs(list, plantId) {
    if (!Array.isArray(list)) return 0;
    let latest = 0;
    list.forEach(function (row) {
      if (!row) return;
      const pid = String(row.plantId || row.value2 || '');
      if (String(plantId) !== pid) return;
      const t = toMs(row.date);
      if (t > latest) latest = t;
    });
    return latest;
  }

  function latestEntryDateMs(entries, plantId, types) {
    const allow = Array.isArray(types) ? types : [];
    let latest = 0;
    (entries || []).forEach(function (e) {
      if (!e || String(e.plantId || '') !== String(plantId)) return;
      if (allow.length && allow.indexOf(e.type) < 0) return;
      const t = toMs(e.date || e.createdAt);
      if (t > latest) latest = t;
    });
    return latest;
  }

  function lastCareDateMs(plantId, entries, toolbox, careType) {
    if (careType === 'watering') {
      return Math.max(
        latestEntryDateMs(entries, plantId, ['zalijevanje']),
        latestToolboxDateMs(toolbox && toolbox.watering, plantId)
      );
    }
    if (careType === 'feeding') {
      return Math.max(
        latestEntryDateMs(entries, plantId, ['gnojidba']),
        latestToolboxDateMs(toolbox && toolbox.feeding, plantId)
      );
    }
    if (careType === 'transplant') {
      return Math.max(
        latestEntryDateMs(entries, plantId, ['presadjivanje', 'faza']),
        latestToolboxDateMs(toolbox && toolbox.transplant, plantId)
      );
    }
    return 0;
  }

  function pushReminder(list, reminder) {
    if (!reminder || !reminder.id) return;
    if (isReminderDismissed(reminder.id, true)) return;
    list.push(reminder);
  }

  function buildReminders(plants, entries, toolbox) {
    const list = [];
    (plants || []).forEach(function (plant) {
      if (!plant || !plant.id) return;
      const stage = plant.stage || '';
      const stageLabel = STAGE_LABELS[stage] || stage || 'Unknown stage';
      const subphase = plant.subphase || '';
      const plantName = plant.name || 'Plant';
      const transplantAt = lastCareDateMs(plant.id, entries, toolbox, 'transplant');
      const wateringAt = lastCareDateMs(plant.id, entries, toolbox, 'watering');
      const feedingAt = lastCareDateMs(plant.id, entries, toolbox, 'feeding');
      const sinceTransplant = daysSinceMs(transplantAt);
      const sinceWatering = daysSinceMs(wateringAt);
      const sinceFeeding = daysSinceMs(feedingAt);
      const stageAt = toMs((plant.stageDates && plant.stageDates[stage]) || plant.startDate);
      const daysInStage = daysSinceMs(stageAt);

      if (subphase === 'pot_1_5dcl' && (stage === 'sadnica' || stage === 'vegetativna')) {
        if (sinceTransplant == null || sinceTransplant >= 8) {
          pushReminder(list, {
            id: 'pot-up-5l:' + plant.id,
            plantId: plant.id,
            title: 'Pot-up check: 1.5 dcl → 5 L',
            message:
              plantName +
              ' is in ' +
              subphaseLabel(subphase) +
              '. Roots may be ready for a bigger pot — confirm transplant timing.',
            prompt:
              'For plant "' +
              plantName +
              '", should I move from 1.5 dcl pot to 5 L now? Give me a quick checklist, then log transplant if ready.',
          });
        }
      }

      if (subphase === 'pot_5l' && stage !== 'klijanje') {
        if (sinceTransplant == null || sinceTransplant >= 10) {
          pushReminder(list, {
            id: 'pot-up-30l:' + plant.id,
            plantId: plant.id,
            title: 'Pot-up check: 5 L → 30 L',
            message:
              plantName +
              ' has been in 5 L long enough to review root space and water cadence before moving to 30 L.',
            prompt:
              'Review plant "' +
              plantName +
              '" for transplant from 5 L to 30 L. What signs should I confirm today?',
          });
        }
      }

      if (plant.environmentType === 'indoor' && subphase === 'pot_30l') {
        const floweringLong = stage === 'cvjetanje' && daysInStage != null && daysInStage >= 14;
        if (floweringLong || (stage === 'vegetativna' && daysInStage != null && daysInStage >= 21)) {
          pushReminder(list, {
            id: 'tent-to-field:' + plant.id,
            plantId: plant.id,
            severity: 'info',
            title: 'Tent → field transition review',
            message:
              plantName +
              ' is still indoor in ' +
              subphaseLabel(subphase) +
              ' during ' +
              stageLabel +
              '. Decide if it should move to field conditions.',
            prompt:
              'Should plant "' +
              plantName +
              '" move from grow tent to field this week? Give me transition steps and risk checks.',
          });
        }
      }

      if (sinceWatering == null || sinceWatering >= 2) {
        pushReminder(list, {
          id: 'watering:' + plant.id,
          plantId: plant.id,
          severity: 'urgent',
          title: 'Watering reminder',
          message:
            plantName +
            ' has no recent watering log' +
            (sinceWatering == null ? '' : ' for ' + sinceWatering + ' days') +
            '.',
          prompt:
            'Check watering status for "' +
            plantName +
            '" and help me log watering if needed.',
        });
      }

      if (stage !== 'klijanje' && (sinceFeeding == null || sinceFeeding >= 5)) {
        pushReminder(list, {
          id: 'feeding:' + plant.id,
          plantId: plant.id,
          severity: 'info',
          title: 'Nutrient check',
          message:
            plantName +
            (sinceFeeding == null
              ? ' has no feeding log yet for this stage.'
              : ' last feeding was ' + sinceFeeding + ' days ago.'),
          prompt:
            'Review feeding for "' +
            plantName +
            '" and help me log nutrients if needed.',
        });
      }
    });

    // Weather + watering-pace predictions (no new infra)
    if (window.CoachCore && typeof CoachCore.buildPredictiveNudges === 'function') {
      try {
        const predictive = CoachCore.buildPredictiveNudges(plants, entries) || [];
        predictive.forEach(function (nudge) {
          pushReminder(list, nudge);
        });
      } catch (e) {
        // ignore
      }
    }

    // Prefer predictive / urgent first
    list.sort(function (a, b) {
      const score = function (r) {
        if (r.kind === 'predictive') return 0;
        if (r.severity === 'urgent') return 1;
        if (r.kind === 'advisory') return 3;
        return 2;
      };
      return score(a) - score(b);
    });

    return list.slice(0, 10);
  }

  function resolveStage(raw) {
    const key = String(raw || '')
      .trim()
      .toLowerCase();
    return STAGE_ALIASES[key] || null;
  }

  function resolvePlant(ref) {
    if (!ref) {
      if (window.DnevnikJournal && DnevnikJournal.getCurrentGrowlogPlantId) {
        const id = DnevnikJournal.getCurrentGrowlogPlantId();
        if (id) return getPlants().find((p) => p && String(p.id) === String(id)) || null;
      }
      const plants = getPlants();
      return plants.length === 1 ? plants[0] : null;
    }
    if (window.DnevnikJournal && typeof DnevnikJournal.findPlant === 'function') {
      return DnevnikJournal.findPlant(ref);
    }
    const q = String(ref).trim().toLowerCase();
    const plants = getPlants();
    return (
      plants.find((p) => p && String(p.id) === String(ref)) ||
      plants.find((p) => p && String(p.name || '').toLowerCase() === q) ||
      plants.find((p) => p && String(p.name || '').toLowerCase().includes(q)) ||
      null
    );
  }

  /** User-facing plant name — never a raw internal id. */
  function plantLabel(ref, action) {
    const plant = resolvePlant(ref);
    if (plant && plant.name) return String(plant.name);
    if (action && action.plantName && !looksLikePlantId(action.plantName)) {
      return String(action.plantName);
    }
    if (action && action.name && !looksLikePlantId(action.name)) {
      return String(action.name);
    }
    if (ref && !looksLikePlantId(ref)) return String(ref);
    return 'your plant';
  }

  function enrichAction(action) {
    if (!action || typeof action !== 'object') return action;
    const next = Object.assign({}, action);
    if (next.plantId) {
      const plant = resolvePlant(next.plantId);
      if (plant && plant.name) next.plantName = plant.name;
      else if (!next.plantName || looksLikePlantId(next.plantName)) {
        // Keep a prior human name if we already stored one; never persist raw ids as names.
        if (looksLikePlantId(next.plantName)) delete next.plantName;
      }
    }
    return next;
  }

  function humanizeCoachText(text) {
    return String(text == null ? '' : text).replace(PLANT_ID_RE, function (id) {
      return plantLabel(id);
    });
  }

  function actionRequiresLivingPlant(action) {
    if (!action || !action.type) return false;
    return (
      action.type === 'add_entry' ||
      action.type === 'set_stage' ||
      action.type === 'link_plant' ||
      action.type === 'import_seed' ||
      action.type === 'mint_growth'
    );
  }

  function actionPlantAvailable(action) {
    if (!actionRequiresLivingPlant(action)) return true;
    if (!action.plantId) return action.type === 'mint_growth' ? !!action.tokenId : true;
    if (resolvePlant(action.plantId)) return true;
    // Don't wipe drafts while journal state is still empty/hydrating.
    if (!getPlants().length) return true;
    return false;
  }

  function findTokenForPlant(plantId) {
    if (!window.PlantToken || typeof PlantToken.getWallet !== 'function') return null;
    const wallet = PlantToken.getWallet();
    if (!wallet || !Array.isArray(wallet.tokens)) return null;
    return wallet.tokens.find((t) => t && String(t.plantId) === String(plantId)) || null;
  }

  function currentGrowlogPlantId() {
    if (window.DnevnikJournal && typeof DnevnikJournal.getCurrentGrowlogPlantId === 'function') {
      return DnevnikJournal.getCurrentGrowlogPlantId();
    }
    return null;
  }

  function plantTimingFields(p) {
    if (!p) return {};
    const stage = p.stage || '';
    const stageAt = toMs((p.stageDates && p.stageDates[stage]) || p.startDate);
    const startAt = toMs(p.startDate || p.createdAt);
    return {
      subphase: p.subphase || null,
      subphaseLabel: p.subphase ? subphaseLabel(p.subphase) : null,
      daysInStage: daysSinceMs(stageAt),
      daysSinceStart: daysSinceMs(startAt),
      notes: p.notes ? String(p.notes).slice(0, 160) : null,
      hasPhoto: !!(p.photo || p.photoDataUrl || p.image),
      fieldLocation: p.fieldLocation || null,
      plantingLocation: p.plantingLocation || null,
    };
  }

  function entryMetaSnippet(e) {
    if (!e || !e.meta || typeof e.meta !== 'object') return null;
    const m = e.meta;
    const out = {};
    if (m.stresori && typeof m.stresori === 'object') {
      const s = m.stresori;
      if (s.temp != null || s.temperature != null) {
        out.tempC = s.temp != null ? s.temp : s.temperature;
      }
      if (s.humidity != null || s.rh != null) {
        out.humidityPct = s.humidity != null ? s.humidity : s.rh;
      }
      if (s.vpd != null) out.vpd = s.vpd;
      if (s.pests) out.pests = String(s.pests).slice(0, 80);
      if (s.notes) out.stressNotes = String(s.notes).slice(0, 80);
    }
    if (m.temperature != null) out.tempC = m.temperature;
    if (m.humidity != null) out.humidityPct = m.humidity;
    if (m.amountMl != null) out.amountMl = m.amountMl;
    if (m.product) out.product = String(m.product).slice(0, 60);
    return Object.keys(out).length ? out : null;
  }

  function readWeatherContext() {
    try {
      let cache = null;
      let city = '';
      if (window.CoachCore) {
        if (typeof CoachCore.readWeatherCache === 'function') {
          cache = CoachCore.readWeatherCache();
        }
        if (typeof CoachCore.getWeatherCity === 'function') {
          city = CoachCore.getWeatherCity() || '';
        }
      }
      if (!city) {
        try {
          city = String(localStorage.getItem('dnevnik-live-weather-city') || '').trim();
        } catch {
          city = '';
        }
      }
      if (!cache || !Array.isArray(cache.days) || !cache.days.length) {
        return city ? { city: city, days: [] } : null;
      }
      return {
        city: city || cache.city || null,
        days: cache.days.slice(0, 4).map(function (d) {
          return {
            date: d.date || null,
            label: d.label || null,
            avgtemp: d.avgtemp != null ? d.avgtemp : null,
            maxtemp: d.maxtemp != null ? d.maxtemp : null,
            mintemp: d.mintemp != null ? d.mintemp : null,
            rainChance: d.rainChance != null ? d.rainChance : null,
            condition: d.condition || d.text || null,
          };
        }),
      };
    } catch {
      return null;
    }
  }

  function buildContext() {
    const plants = getPlants();
    const entries = getEntries();
    const toolbox = getToolbox();
    const focusId = currentGrowlogPlantId();
    const focus = focusId ? plants.find((p) => p && String(p.id) === String(focusId)) : null;

    const plantSummaries = plants.slice(0, 12).map((p) =>
      Object.assign(
        {
          id: p.id,
          name: p.name,
          strain: p.strain || null,
          stage: p.stage || null,
          stageLabel: STAGE_LABELS[p.stage] || p.stage || null,
          environmentType: p.environmentType || null,
          startDate: p.startDate || null,
        },
        plantTimingFields(p)
      )
    );

    const recentEntries = entries
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 12)
      .map((e) => ({
        type: e.type,
        plantId: e.plantId,
        date: e.date || null,
        note: e.note ? String(e.note).slice(0, 120) : null,
        hasPhoto: !!(e.photo || e.photoDataUrl),
        meta: entryMetaSnippet(e),
      }));

    let tokens = [];
    if (window.PlantToken && typeof PlantToken.getWallet === 'function') {
      const wallet = PlantToken.getWallet();
      if (wallet && Array.isArray(wallet.tokens)) {
        tokens = wallet.tokens.slice(0, 12).map((t) => ({
          id: t.id,
          name: t.name,
          plantId: t.plantId || null,
          stageIndex: t.stageIndex,
        }));
      }
    }

    let questHint = null;
    if (focus && window.GrowerQuests && window.PlantToken) {
      try {
        const token = findTokenForPlant(focus.id);
        if (token && token.stageIndex < 5) {
          const stages = PlantToken.GROWTH_STAGES || [];
          const next = stages[token.stageIndex + 1];
          if (next) {
            const quest = GrowerQuests.evaluateGrowthQuest(token, next.key);
            questHint = {
              tokenId: token.id,
              tokenName: token.name,
              nextStage: next.key,
              ready: quest.ready,
              missing: quest.missing || [],
              message: quest.message,
            };
          }
        }
      } catch {
        // ignore
      }
    }

    const reminders = buildReminders(plants, entries, toolbox);

    // Real recent readings (not just counts) so the coach can reason about actual
    // conditions — "humidity's high for flowering" instead of only "3 logs exist".
    // Scoped to the focus plant when one is open; otherwise most-recent across all.
    function recentToolboxOf(kind, mapFn) {
      const rows = Array.isArray(toolbox[kind]) ? toolbox[kind] : [];
      const scoped = focus
        ? rows.filter((r) => String(r.plantId || r.value2 || '') === String(focus.id))
        : rows;
      return scoped
          .slice()
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
          .slice(0, 3)
          .map(mapFn);
    }

    const toolboxRecent = {
      watering: recentToolboxOf('watering', (r) => ({
        date: r.date || null,
        amountMl: r.value1 || null,
      })),
      feeding: recentToolboxOf('feeding', (r) => ({
        date: r.date || null,
        product: r.value1 || null,
        detail: r.value2 || null,
      })),
      environment: recentToolboxOf('environment', (r) => ({
        date: r.date || null,
        temperatureC: r.value1 || null,
        humidityPct: r.value2 || null,
      })),
    };

    let growSetup = null;
    let growStyleNote = null;
    try {
      growSetup = localStorage.getItem('dnevnik-live-grow-setup') || null;
      growStyleNote = localStorage.getItem('dnevnik-live-grow-style-note') || null;
    } catch {
      // ignore
    }

    return {
      focusPlant: focus
        ? Object.assign(
            {
              id: focus.id,
              name: focus.name,
              strain: focus.strain || null,
              stage: focus.stage || null,
              stageLabel: STAGE_LABELS[focus.stage] || focus.stage || null,
              environmentType: focus.environmentType || null,
            },
            plantTimingFields(focus)
          )
        : null,
      plants: plantSummaries,
      tokens: tokens,
      recentEntries: recentEntries,
      toolboxCounts: {
        watering: Array.isArray(toolbox.watering) ? toolbox.watering.length : 0,
        feeding: Array.isArray(toolbox.feeding) ? toolbox.feeding.length : 0,
        environment: Array.isArray(toolbox.environment) ? toolbox.environment.length : 0,
      },
      toolboxRecent: toolboxRecent,
      weather: readWeatherContext(),
      reminders: reminders,
      mintQuest: questHint,
      growSetup: growSetup,
      growStyleNote: growStyleNote,
      profileType: 'grower',
      canAct: true,
    };
  }

  function actionLabel(action) {
    if (!action || !action.type) return 'Unknown action';
    const name = plantLabel(action.plantId, action);
    switch (action.type) {
      case 'create_plant':
        return 'Create plant “' + (action.name && !looksLikePlantId(action.name) ? action.name : 'Untitled') + '”';
      case 'add_entry': {
        var et = action.entryType || 'entry';
        var etLabel =
          (window.DnevnikNotifications &&
            typeof DnevnikNotifications.entryTypeLabel === 'function' &&
            DnevnikNotifications.entryTypeLabel(et)) ||
          et;
        return 'Log ' + etLabel + ' for “' + name + '”';
      }
      case 'set_stage':
        return (
          'Set “' +
          name +
          '” → ' +
          (STAGE_LABELS[action.stage] || action.stage || '?')
        );
      case 'import_seed':
        return 'Mint seed token for “' + name + '”';
      case 'mint_growth':
        return 'Mint next growth stage' + (name !== 'your plant' ? ' for “' + name + '”' : '');
      case 'link_plant':
        return 'Link token to “' + name + '”';
      default:
        return String(action.type);
    }
  }

  function parseLocalIntents(message, context) {
    const q = String(message || '').trim();
    const lower = q.toLowerCase();
    const actions = [];
    let reply = '';

    const createMatch = lower.match(
      /(?:create|add|new)\s+(?:a\s+)?plant(?:\s+(?:named|called))?\s+([a-z0-9][\w\s\-']{1,40})/i
    );
    if (createMatch) {
      const name = createMatch[1].replace(/\s+starting.*$/i, '').trim();
      const strainMatch = q.match(/strain\s+([a-z0-9][\w\s\-']{1,40})/i);
      const stageMatch = q.match(
        /(?:stage|at)\s+(germination|seedling|vegetative|flowering|drying|harvest|klijanje|sadnica|vegetativna|cvjetanje|susenje)/i
      );
      actions.push({
        type: 'create_plant',
        name: name,
        strain: strainMatch ? strainMatch[1].trim() : '',
        stage: resolveStage(stageMatch ? stageMatch[1] : 'klijanje') || 'klijanje',
        environmentType: /outdoor|field/i.test(q) ? 'outdoor' : 'indoor',
      });
      reply = 'I can create plant “' + name + '” in your journal.';
    }

    const waterMatch = /(?:log\s+)?(?:water(?:ing)?|zalij)/i.test(lower);
    const feedMatch = /(?:log\s+)?(?:feed(?:ing)?|nutrient|gnoj)/i.test(lower);
    if (waterMatch || feedMatch) {
      const plant =
        resolvePlant(context.focusPlant && context.focusPlant.name) ||
        resolvePlant(context.focusPlant && context.focusPlant.id);
      if (plant) {
        actions.push({
          type: 'add_entry',
          plantId: plant.id,
          plantName: plant.name,
          entryType: feedMatch && !waterMatch ? 'gnojidba' : waterMatch ? 'zalijevanje' : 'gnojidba',
          note: feedMatch && !waterMatch ? 'Feeding logged via Grower Coach' : 'Watering logged via Grower Coach',
        });
        reply =
          (reply ? reply + '\n' : '') +
          'I can log ' +
          (feedMatch && !waterMatch ? 'feeding' : 'watering') +
          ' for “' +
          plant.name +
          '”.';
      } else {
        reply = (reply ? reply + '\n' : '') + 'Tell me which plant to log for (name), or open its grow log.';
      }
    }

    const stageMatch2 = q.match(
      /(?:set|change|move)\s+(?:stage\s+(?:of\s+)?)?(.+?)\s+to\s+(germination|seedling|vegetative|flowering|drying|harvest|klijanje|sadnica|vegetativna|cvjetanje|susenje)/i
    );
    if (stageMatch2) {
      const plant = resolvePlant(stageMatch2[1]);
      const stage = resolveStage(stageMatch2[2]);
      if (plant && stage) {
        actions.push({
          type: 'set_stage',
          plantId: plant.id,
          plantName: plant.name,
          stage: stage,
          note: 'Updated via Grower Coach',
        });
        reply = (reply ? reply + '\n' : '') + 'I can move “' + plant.name + '” to ' + (STAGE_LABELS[stage] || stage) + '.';
      }
    }

    if (/(?:mint\s+(?:a\s+)?seed|tokenise|tokenize)/i.test(lower)) {
      const plant = resolvePlant(context.focusPlant && context.focusPlant.id);
      if (plant) {
        actions.push({
          type: 'import_seed',
          plantId: plant.id,
          plantName: plant.name,
          name: plant.name,
          strain: plant.strain || plant.name,
        });
        reply = (reply ? reply + '\n' : '') + 'I can mint a Seed NFT for “' + plant.name + '” (wallet must be connected).';
      }
    }

    if (/(?:mint\s+(?:next\s+)?growth|advance\s+(?:the\s+)?(?:token|stage)|grow\s+mint)/i.test(lower)) {
      const plant = resolvePlant(context.focusPlant && context.focusPlant.id);
      const token = plant ? findTokenForPlant(plant.id) : null;
      if (token) {
        actions.push({
          type: 'mint_growth',
          tokenId: token.id,
          plantId: plant.id,
          plantName: plant.name,
        });
        reply = (reply ? reply + '\n' : '') + 'I can try minting the next growth stage for “' + token.name + '”.';
      } else {
        reply = (reply ? reply + '\n' : '') + 'No linked token found — mint a seed first or name the plant.';
      }
    }

    if (actions.length) {
      return { reply: reply || 'Confirm the actions below to apply them.', actions: actions };
    }

    // Advice-only local playbook
    const focus = context.focusPlant;
    const stageKey = focus && focus.stage ? focus.stage : null;
    const playbook = stageKey && STAGE_PLAYBOOK[stageKey] ? STAGE_PLAYBOOK[stageKey] : null;
    if (/mint|token|\$grow|rwa|nft|quest|unlock/.test(lower)) {
      return {
        reply:
          'Tokenisation needs journal proof: link plant → log stage → log watering → log feeding (from seedling). Then mint from Tokenise, or ask me: “mint seed for My Plant” / “mint growth”.',
        actions: [],
      };
    }
    // Weather and diagnosis are offered as capability chips, so the offline
    // path has to answer them with something better than the generic "here is
    // what I can do" list — that reads as the coach ignoring the question.
    if (/weather|forecast|rain|heat|frost|vrijeme|prognoz|kiša|vru|mraz/.test(lower)) {
      let tips = [];
      try {
        if (window.CoachCore && typeof CoachCore.weatherAdvice === 'function') {
          tips = CoachCore.weatherAdvice(CoachCore.readWeatherCache()) || [];
        }
      } catch (e) {
        tips = [];
      }
      if (tips.length) {
        return {
          reply:
            'From the forecast on your Plants view:\n• ' +
            tips
              .map(function (t) {
                return t && t.text ? t.text : String(t);
              })
              .join('\n• '),
          actions: [],
        };
      }
      return {
        reply:
          'I do not have a forecast cached yet. Open Plants, set your city on the weather card, and refresh it — then ask me again and I can tell you what it means for watering and mould risk.',
        actions: [],
      };
    }
    if (/problem|wrong|sick|dying|yellow|brown|spot|curl|droop|wilt|pest|mite|mould|mold|rot|deficien|žut|smeđ|mrlj|uvija|ven|štetnic|grinj|plijesan|buđ|trule/.test(lower)) {
      return {
        reply:
          'Let’s narrow it down. Tell me:\n• Where on the plant — lower/older leaves, or new growth at the top?\n• What exactly — yellowing, brown edges, spots, curling, or wilting?\n• Anything changed recently — feed, water, light distance, temperature?\n\nLower/older leaves first usually points to a mobile nutrient (N, P, K, Mg); new growth at the top points to an immobile one (Ca, S, Fe). Check pH before treating either — locked-out nutrients look identical to missing ones.',
        actions: [],
      };
    }
    if (playbook) {
      return {
        reply:
          'Next steps for ' +
          (focus.name || 'your plant') +
          ' (' +
          playbook.title +
          '):\n• ' +
          playbook.steps.join('\n• ') +
          '\n\nYou can also say: “log watering”, “create plant …”, or “mint seed”.',
        actions: [],
      };
    }
    return {
      reply:
        'I can create plants, log watering/feeding, change stages, and mint seed/growth tokens.\nTry: “Create plant CBD Auto” or “Log watering”.',
      actions: [],
    };
  }

  async function executeAction(action) {
    const type = action && action.type;
    const DJ = window.DnevnikJournal;
    const PT = window.PlantToken;
    const mode =
      window.CoachCore && typeof CoachCore.resolveActionMode === 'function'
        ? CoachCore.resolveActionMode(type)
        : 'draft';

    if (mode === 'advise') {
      throw new Error(
        'That call stays advisory — Coach will not change the journal or chain for plant-health decisions. You decide.'
      );
    }

    // High-stakes always require the confirm UI path (runPendingActions only after confirm).
    if (mode === 'confirm' && (type === 'import_seed' || type === 'mint_growth' || type === 'link_plant')) {
      // Still allowed after explicit confirm — fall through.
    }

    let resultMsg = '';

    if (type === 'create_plant') {
      if (!DJ || typeof DJ.createPlant !== 'function') throw new Error('Journal API unavailable');
      const plant = DJ.createPlant({
        name: action.name,
        strain: action.strain,
        stage: resolveStage(action.stage) || action.stage || 'klijanje',
        environmentType: action.environmentType,
        notes: action.notes,
      });
      resultMsg =
        'Created plant “' + plant.name + '” (' + (STAGE_LABELS[plant.stage] || plant.stage) + ').';
    } else if (type === 'add_entry') {
      if (!DJ || typeof DJ.addEntry !== 'function') throw new Error('Journal API unavailable');
      const plant = resolvePlant(action.plantId);
      if (!plant) throw new Error('Plant not found for entry');
      const entry = DJ.addEntry({
        plantId: plant.id,
        type: action.entryType || action.type || 'opcenito',
        note: action.note,
        date: action.date,
      });
      var typeLabel =
        (window.DnevnikNotifications &&
          typeof DnevnikNotifications.entryTypeLabel === 'function' &&
          DnevnikNotifications.entryTypeLabel(entry.type)) ||
        entry.type;
      resultMsg = 'Logged ' + typeLabel + ' for “' + plant.name + '”.';
    } else if (type === 'set_stage') {
      if (!DJ || typeof DJ.setPlantStage !== 'function') throw new Error('Journal API unavailable');
      const plant = resolvePlant(action.plantId);
      if (!plant) throw new Error('Plant not found for stage change');
      const stage = resolveStage(action.stage) || action.stage;
      const updated = DJ.setPlantStage(plant.id, stage, action.note);
      resultMsg =
        'Updated “' + updated.name + '” → ' + (STAGE_LABELS[updated.stage] || updated.stage) + '.';
    } else if (type === 'import_seed') {
      if (!PT || typeof PT.importSeed !== 'function') throw new Error('Token API unavailable');
      const plant = resolvePlant(action.plantId);
      if (!plant) throw new Error('Plant required to mint seed');
      const result = await PT.importSeed({
        name: action.name || plant.name,
        strain: action.strain || plant.strain || plant.name,
        batch: action.batch || '',
        plantId: plant.id,
      });
      if (window.AdoptPlant && typeof AdoptPlant.render === 'function') AdoptPlant.render();
      resultMsg = 'Seed token minted for “' + (result.token && result.token.name) + '”.';
    } else if (type === 'mint_growth') {
      if (!PT || typeof PT.mintGrowth !== 'function') throw new Error('Token API unavailable');
      let tokenId = action.tokenId;
      if (!tokenId && action.plantId) {
        const plant = resolvePlant(action.plantId);
        const token = plant ? findTokenForPlant(plant.id) : null;
        tokenId = token && token.id;
      }
      if (!tokenId) throw new Error('Token not found for growth mint');
      const result = await PT.mintGrowth(tokenId);
      if (window.AdoptPlant && typeof AdoptPlant.render === 'function') AdoptPlant.render();
      resultMsg =
        'Growth minted' +
        (result && result.reward != null ? ' (+' + result.reward + ' $GROWTOO)' : '') +
        '.';
    } else if (type === 'link_plant') {
      if (!PT || typeof PT.linkPlant !== 'function') throw new Error('Token API unavailable');
      const plant = resolvePlant(action.plantId);
      if (!plant || !action.tokenId) throw new Error('tokenId and plant required');
      await PT.linkPlant(action.tokenId, plant.id);
      if (window.AdoptPlant && typeof AdoptPlant.render === 'function') AdoptPlant.render();
      resultMsg = 'Linked token to “' + plant.name + '”.';
    } else {
      throw new Error('Unsupported action: ' + type);
    }

    if (window.CoachCore && typeof CoachCore.logActivity === 'function') {
      CoachCore.logActivity({
        kind: 'action',
        actionType: type,
        tier: mode,
        title: resultMsg.replace(/\.$/, ''),
        body: resultMsg,
        status: 'done',
      });
    }
    return resultMsg;
  }

  async function runPendingActions() {
    if (!pendingActions.length || busy) return;
    busy = true;
    setStatus('Running actions…');
    // Clear confirm UI on the last assistant message while running.
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant' && history[i].actions) {
        delete history[i].actions;
        break;
      }
    }
    renderMessages();
    const results = [];
    for (let i = 0; i < pendingActions.length; i++) {
      try {
        const action = pendingActions[i];
        const msg = await executeAction(action);
        results.push('✓ ' + msg);
        if (action && action.draftFrom) {
          dismissReminder(action.draftFrom);
        }
      } catch (err) {
        results.push('✗ ' + (err && err.message ? err.message : 'Action failed'));
      }
    }
    pendingActions = [];
    history.push({
      role: 'assistant',
      content: 'Done:\n' + results.join('\n'),
      at: Date.now(),
      source: 'actions',
    });
    saveHistory();
    renderMessages();
    busy = false;
    setStatus('Ready to help');
  }

  function cancelPendingActions() {
    pendingActions = [];
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant' && history[i].actions) {
        delete history[i].actions;
        break;
      }
    }
    history.push({
      role: 'assistant',
      content: 'No problem — nothing was changed. Ask anytime.',
      at: Date.now(),
      source: 'actions',
    });
    saveHistory();
    renderMessages();
    setStatus('Ready to help');
  }

  function localReply(message, context) {
    return parseLocalIntents(message, context);
  }

  function loadHistory() {
    const key = scopedKey(STORAGE_CHAT);
    let saved = readJson(key, null);
    // Migrate legacy unscoped chat into the signed-in account once.
    if (!Array.isArray(saved)) {
      const legacy = readJson(STORAGE_CHAT, []);
      if (Array.isArray(legacy) && legacy.length && currentAuthUid()) {
        saved = legacy;
        try {
          localStorage.setItem(key, JSON.stringify(legacy.slice(-20)));
          localStorage.removeItem(STORAGE_CHAT);
        } catch {
          // ignore
        }
      } else {
        saved = Array.isArray(legacy) ? legacy : [];
      }
    }
    history = Array.isArray(saved) ? saved.slice(-20) : [];
    sanitizeChatState();
  }

  function saveHistory() {
    try {
      // Keep full photo data only on the newest few turns — older thumbs drop to a flag.
      const slim = history.slice(-20).map(function (m, idx, arr) {
        if (!m || !m.image) return m;
        if (idx >= arr.length - 4) return m;
        const copy = Object.assign({}, m);
        copy.hasImage = true;
        delete copy.image;
        return copy;
      });
      localStorage.setItem(scopedKey(STORAGE_CHAT), JSON.stringify(slim));
      history = slim;
    } catch {
      // Quota: strip all image payloads and retry once.
      try {
        history = history.map(function (m) {
          if (!m || !m.image) return m;
          const copy = Object.assign({}, m);
          copy.hasImage = true;
          delete copy.image;
          return copy;
        });
        localStorage.setItem(scopedKey(STORAGE_CHAT), JSON.stringify(history.slice(-20)));
      } catch {
        // ignore
      }
    }
  }

  function saveComposerDraft() {
    const input = document.getElementById('ai-coach-input');
    if (!input) return;
    try {
      const value = String(input.value || '');
      if (value.trim()) localStorage.setItem(scopedKey(STORAGE_DRAFT), value);
      else localStorage.removeItem(scopedKey(STORAGE_DRAFT));
    } catch {
      // ignore
    }
  }

  function restoreComposerDraft() {
    const input = document.getElementById('ai-coach-input');
    if (!input || busy) return;
    try {
      const value = localStorage.getItem(scopedKey(STORAGE_DRAFT)) || '';
      if (!value) return;
      // Don't clobber text the user is already editing this session.
      if (String(input.value || '').trim()) return;
      input.value = value;
      autoResizeInput();
    } catch {
      // ignore
    }
  }

  function clearComposerDraft() {
    try {
      localStorage.removeItem(scopedKey(STORAGE_DRAFT));
      localStorage.removeItem(STORAGE_DRAFT);
    } catch {
      // ignore
    }
  }

  function sanitizeChatState() {
    let changed = false;
    history = (history || []).map(function (m) {
      if (!m || typeof m !== 'object') return m;
      const next = Object.assign({}, m);
      const humanized = humanizeCoachText(next.content);
      if (humanized !== next.content) {
        next.content = humanized;
        changed = true;
      }
      if (!Array.isArray(next.actions) || !next.actions.length) {
        if (next.actions) {
          delete next.actions;
          changed = true;
        }
        return next;
      }
      const before = JSON.stringify(next.actions);
      const kept = next.actions.map(enrichAction).filter(actionPlantAvailable);
      if (!kept.length) {
        delete next.actions;
        if (!/\bno longer in this journal\b/i.test(String(next.content || ''))) {
          next.content =
            String(next.content || '').replace(/\s+$/, '') +
            '\n\n(That draft referred to a plant that’s no longer in this journal — it was cleared.)';
        }
        changed = true;
      } else {
        next.actions = kept;
        if (JSON.stringify(kept) !== before) changed = true;
      }
      return next;
    });

    // Rehydrate confirmable actions after reload/reopen (pendingActions is memory-only).
    pendingActions = [];
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] && Array.isArray(history[i].actions) && history[i].actions.length) {
        pendingActions = history[i].actions.slice();
        break;
      }
    }
    if (changed) saveHistory();
  }

  function setCoachTab(tabId) {
    const id = tabId === 'settings' || tabId === 'log' || tabId === 'perms' ? 'settings' : 'chat';
    const root = document.getElementById('ai-coach-root');
    if (!root) return;
    root.querySelectorAll('[data-coach-tab]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-coach-tab') === id);
    });
    root.querySelectorAll('[data-coach-panel]').forEach(function (panel) {
      const on = panel.getAttribute('data-coach-panel') === id;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
    const composer = root.querySelector('.ai-coach-composer');
    if (composer) composer.hidden = id !== 'chat';
    if (id === 'settings') {
      const settingsPanel = document.getElementById('ai-coach-settings-panel');
      if (settingsPanel && window.CoachCore) {
        settingsPanel.innerHTML =
          typeof CoachCore.settingsScreenHtml === 'function'
            ? CoachCore.settingsScreenHtml()
            : CoachCore.permissionsPanelHtml();
      }
    }
  }

  function ensureDom() {
    if (document.getElementById('ai-coach-root')) return;
    const root = document.createElement('div');
    root.id = 'ai-coach-root';
    root.className = 'ai-coach-root grower-only';
    root.innerHTML =
      '<button type="button" class="ai-coach-fab" id="ai-coach-fab" aria-expanded="false" aria-controls="ai-coach-panel">' +
      '<span class="ai-coach-fab-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 21v-8"/><path d="M12 14c-3.2 0-5-2-5-5 3.2 0 5 2 5 5z"/><path d="M12 12c0-3 1.8-5 5-5 0 3-1.8 5-5 5z"/><circle cx="12" cy="6" r="2"/>' +
      '</svg></span>' +
      '<span class="ai-coach-fab-label">Coach</span>' +
      '</button>' +
      '<button type="button" class="ai-coach-backdrop" id="ai-coach-backdrop" aria-label="Close coach" hidden></button>' +
      '<aside class="ai-coach-panel" id="ai-coach-panel" hidden role="dialog" aria-modal="true" aria-labelledby="ai-coach-title">' +
      '<div class="ai-coach-sheet-handle" aria-hidden="true"></div>' +
      '<header class="ai-coach-head">' +
      '<div class="ai-coach-brand">' +
      '<span class="ai-coach-avatar" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 21v-8"/><path d="M12 14c-3.2 0-5-2-5-5 3.2 0 5 2 5 5z"/><path d="M12 12c0-3 1.8-5 5-5 0 3-1.8 5-5 5z"/><circle cx="12" cy="6" r="2"/>' +
      '</svg></span>' +
      '<div class="ai-coach-brand-copy">' +
      '<strong id="ai-coach-title">Grow coach</strong>' +
      '<span class="ai-coach-status" id="ai-coach-status">Ready when you are</span>' +
      '</div></div>' +
      '<div class="ai-coach-head-actions">' +
      '<button type="button" class="ai-coach-icon-btn" id="ai-coach-clear" title="Clear conversation" aria-label="Clear conversation">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 12h10l1-12"/></svg>' +
      '</button>' +
      '<button type="button" class="ai-coach-icon-btn" id="ai-coach-close" aria-label="Close coach">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>' +
      '</div></header>' +
      '<nav class="ai-coach-tabs" aria-label="Coach sections">' +
      '<button type="button" class="ai-coach-tab is-active" data-coach-tab="chat">Chat</button>' +
      '<button type="button" class="ai-coach-tab" data-coach-tab="settings">Settings</button>' +
      '</nav>' +
      '<div class="ai-coach-tab-panels">' +
      '<div class="ai-coach-tab-panel is-active" data-coach-panel="chat">' +
      '<div class="ai-coach-messages" id="ai-coach-messages" role="log" aria-live="polite"></div>' +
      '</div>' +
      '<div class="ai-coach-tab-panel" data-coach-panel="settings" id="ai-coach-settings-panel" hidden></div>' +
      '</div>' +
      '<div class="ai-coach-composer">' +
      '<div class="ai-coach-attach-preview" id="ai-coach-attach-preview" hidden>' +
      '<img id="ai-coach-attach-thumb" class="ai-coach-attach-thumb" alt="Attached plant photo" />' +
      '<button type="button" class="ai-coach-attach-remove" id="ai-coach-attach-remove" aria-label="Remove photo">Remove</button>' +
      '</div>' +
      '<form class="ai-coach-form" id="ai-coach-form">' +
      '<input type="file" id="ai-coach-file" class="ai-coach-file" accept="image/*" hidden />' +
      '<label class="ai-coach-field">' +
      '<span class="visually-hidden">Message</span>' +
      '<textarea id="ai-coach-input" rows="1" maxlength="2000" placeholder="Ask your coach…" autocomplete="off"></textarea>' +
      '</label>' +
      '<div class="ai-coach-form-actions">' +
      '<button type="button" class="ai-coach-icon-btn ai-coach-attach" id="ai-coach-attach" title="Add photo" aria-label="Add plant photo" aria-pressed="false">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M12 5v14M5 12h14"/>' +
      '</svg></button>' +
      '<button type="button" class="ai-coach-icon-btn ai-coach-mic" id="ai-coach-mic" title="Speak" aria-pressed="false" aria-label="Voice input">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/>' +
      '</svg></button>' +
      '<button type="submit" class="ai-coach-send" id="ai-coach-send" aria-label="Send">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 12h12"/><path d="M13 6l6 6-6 6"/>' +
      '</svg></button>' +
      '</div></form>' +
      '<div class="ai-coach-capabilities" id="ai-coach-capabilities" role="group" aria-label="What the coach can do">' +
      COACH_CAPABILITIES.map(function (c) {
        return (
          '<button type="button" class="ai-coach-cap" data-prompt="' +
          esc(c.text) +
          '" title="' +
          esc(c.text) +
          '">' +
          c.icon +
          '<span>' +
          esc(c.label) +
          '</span></button>'
        );
      }).join('') +
      '</div>' +
      '<p class="ai-coach-foot">Routine nudges can run quietly. Journal drafts need your tap. Minting and plant-health calls stay with you.</p>' +
      '</div></aside>';
    document.body.appendChild(root);


    document.getElementById('ai-coach-fab').addEventListener('click', toggle);
    document.getElementById('ai-coach-close').addEventListener('click', close);
    document.getElementById('ai-coach-clear').addEventListener('click', clearChat);

    // The grabber is only shown when the panel is a bottom sheet (mobile);
    // SheetDrag itself no-ops on the desktop popover layout.
    const coachHandle = root.querySelector('.ai-coach-sheet-handle');
    const coachPanel = document.getElementById('ai-coach-panel');
    if (coachHandle && coachPanel && window.SheetDrag) {
      SheetDrag.attach(coachHandle, coachPanel, { onDismiss: close });
    }
    document.getElementById('ai-coach-backdrop').addEventListener('click', function (e) {
      // Only the dimmed overlay closes — never a bubbled composer/panel tap.
      if (e.target === e.currentTarget) close();
    });
    document.getElementById('ai-coach-form').addEventListener('submit', onSubmit);
    document.getElementById('ai-coach-mic').addEventListener('click', toggleVoice);
    const attachBtn = document.getElementById('ai-coach-attach');
    const fileInput = document.getElementById('ai-coach-file');
    const removeAttach = document.getElementById('ai-coach-attach-remove');
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        const file = fileInput.files && fileInput.files[0];
        onCoachFileSelected(file);
      });
    }
    if (removeAttach) {
      removeAttach.addEventListener('click', function () {
        clearPendingImage();
        setStatus('Photo removed');
      });
    }
    document.getElementById('ai-coach-capabilities').addEventListener('click', function (e) {
      const chip = e.target.closest('.ai-coach-cap');
      if (!chip) return;
      const text = chip.getAttribute('data-prompt');
      if (text) ask(text);
    });

    root.querySelector('.ai-coach-tabs').addEventListener('click', function (e) {
      const tab = e.target.closest('[data-coach-tab]');
      if (!tab) return;
      setCoachTab(tab.getAttribute('data-coach-tab'));
    });
    root.addEventListener('change', function (e) {
      const toggle = e.target && e.target.getAttribute && e.target.getAttribute('data-coach-perm');
      if (!toggle || !window.CoachCore) return;
      const patch = {};
      patch[toggle] = !!e.target.checked;
      CoachCore.setPermissions(patch);
      setStatus('Settings saved');
      // Refresh activity + toggles so state stays honest
      setCoachTab('settings');
    });

    const input = document.getElementById('ai-coach-input');
    if (input) {
      input.addEventListener('input', function () {
        autoResizeInput();
        saveComposerDraft();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSubmit(e);
        }
      });
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncCoachKeyboardInset);
      window.visualViewport.addEventListener('scroll', syncCoachKeyboardInset);
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) close();
    });

    document.getElementById('ai-coach-messages').addEventListener('click', function (e) {
      const draftBtn = e.target.closest('[data-coach-draft]');
      if (draftBtn) {
        proposeDraftFromReminder(draftBtn.getAttribute('data-coach-draft'));
        return;
      }
      const promptBtn = e.target.closest('[data-coach-prompt]');
      if (promptBtn) {
        const text = promptBtn.getAttribute('data-coach-prompt');
        if (text) ask(text);
        return;
      }
      const dismissBtn = e.target.closest('[data-reminder-dismiss]');
      if (dismissBtn) {
        dismissReminder(dismissBtn.getAttribute('data-reminder-dismiss'));
        return;
      }
      if (e.target.closest('[data-coach-run]')) {
        runPendingActions();
        return;
      }
      if (e.target.closest('[data-coach-cancel]')) {
        cancelPendingActions();
        return;
      }
      if (e.target.closest('[data-coach-resend-verify]')) {
        resendCoachVerification(e.target.closest('[data-coach-resend-verify]'));
        return;
      }
      if (e.target.closest('[data-coach-refresh-verify]')) {
        refreshCoachVerification(e.target.closest('[data-coach-refresh-verify]'));
      }
    });
  }

  async function resendCoachVerification(btn) {
    if (!window.GrowtooEmailVerify || typeof GrowtooEmailVerify.resend !== 'function') {
      setStatus('Resend unavailable — open Account and try there.');
      return;
    }
    if (btn) btn.disabled = true;
    setStatus('Sending verification email…');
    try {
      const result = await GrowtooEmailVerify.resend();
      if (result && result.already) {
        setStatus('Already verified — live coach unlocked.');
        clearVerifyFlags();
        return;
      }
      setStatus(
        'Verification sent' +
          (result && result.email ? ' to ' + result.email : '') +
          ' — check inbox & Spam.'
      );
    } catch (err) {
      const code = err && err.code;
      if (code === 'auth/too-many-requests') {
        setStatus('Too many sends — wait a few minutes.');
      } else {
        setStatus((err && err.message) || 'Could not resend verification.');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function refreshCoachVerification(btn) {
    if (!window.GrowtooEmailVerify || typeof GrowtooEmailVerify.refresh !== 'function') {
      setStatus('Refresh unavailable — reopen the app after verifying.');
      return;
    }
    if (btn) btn.disabled = true;
    setStatus('Checking verification…');
    try {
      const ok = await GrowtooEmailVerify.refresh();
      if (ok) {
        setStatus('Email verified — try the coach again.');
        clearVerifyFlags();
      } else {
        setStatus('Still unverified — open the email link, then tap again.');
      }
    } catch (err) {
      setStatus((err && err.message) || 'Could not refresh verification.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function clearVerifyFlags() {
    let changed = false;
    history.forEach(function (m) {
      if (m && m.needsVerify) {
        m.needsVerify = false;
        changed = true;
      }
    });
    if (changed) {
      saveHistory();
      renderMessages();
    }
  }

  function syncCoachKeyboardInset() {
    if (!open || !window.visualViewport) {
      document.documentElement.style.setProperty('--coach-kbd-inset', '0px');
      return;
    }
    const vv = window.visualViewport;
    const raw = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    // Cap so a tall keyboard cannot collapse the sheet to a sliver.
    const maxInset = Math.round(window.innerHeight * 0.52);
    const inset = Math.min(raw, maxInset);
    document.documentElement.style.setProperty('--coach-kbd-inset', inset + 'px');
  }


  function autoResizeInput() {
    const input = document.getElementById('ai-coach-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(120, Math.max(44, input.scrollHeight)) + 'px';
  }

  function setStatus(text) {
    const el = document.getElementById('ai-coach-status');
    if (el) el.textContent = text || 'Ready to help';
  }

  function clearChat() {
    if (busy) return;
    history = [];
    pendingActions = [];
    typing = false;
    saveHistory();
    clearComposerDraft();
    clearPendingImage();
    renderMessages();
    setStatus('Fresh chat');
    const input = document.getElementById('ai-coach-input');
    if (input) {
      input.value = '';
      autoResizeInput();
      // No focus here either — clearing the chat is not the same as wanting to
      // type, and on mobile it would throw the keyboard up over the fresh panel.
    }
  }

  function draftActionFromReminder(reminder) {
    if (!reminder || !reminder.plantId) return null;
    const id = String(reminder.id || '');
    const plant = resolvePlant(reminder.plantId);
    if (!plant || !plant.name) return null;
    const name = plant.name;
    if (id.indexOf('watering:') === 0 || id.indexOf('predict-heat-water:') === 0) {
      return {
        type: 'add_entry',
        plantId: reminder.plantId,
        plantName: name,
        entryType: 'zalijevanje',
        note:
          reminder.kind === 'predictive'
            ? 'Watered — coach draft after heat/pace check for ' + name
            : 'Watered — coach draft for ' + name,
        draftFrom: id,
      };
    }
    if (id.indexOf('feeding:') === 0) {
      return {
        type: 'add_entry',
        plantId: reminder.plantId,
        plantName: name,
        entryType: 'gnojidba',
        note: 'Fed — coach draft for ' + name,
        draftFrom: id,
      };
    }
    return null;
  }

  function proposeDraftFromReminder(reminderOrId) {
    ensureDom();
    let reminder = reminderOrId;
    if (typeof reminderOrId === 'string') {
      const list = buildReminders(getPlants(), getEntries(), getToolbox());
      reminder = list.find(function (r) {
        return r && String(r.id) === String(reminderOrId);
      });
    }
    if (!reminder) return false;
    const action = draftActionFromReminder(reminder);
    if (!action) {
      if (reminder.prompt) ask(reminder.prompt);
      return false;
    }
    const mode =
      window.CoachCore && typeof CoachCore.resolveActionMode === 'function'
        ? CoachCore.resolveActionMode(action.type)
        : 'draft';
    if (mode === 'advise') {
      ask(reminder.prompt || 'What should I check before logging care?');
      return false;
    }
    const readyAction = enrichAction(action);
    pendingActions = [readyAction];
    const plantName = plantLabel(readyAction.plantId, readyAction);
    history.push({
      role: 'assistant',
      content:
        'Draft ready for “' +
        plantName +
        '”.\n\n' +
        humanizeCoachText(reminder.message) +
        '\n\nNothing is saved until you confirm — one tap applies it to the journal trail.',
      at: Date.now(),
      source: 'local',
      actions: [readyAction],
    });
    if (window.CoachCore && typeof CoachCore.logActivity === 'function') {
      CoachCore.logActivity({
        kind: 'draft',
        actionType: readyAction.type,
        tier: 'draft',
        title: 'Drafted entry — ' + plantName,
        body: 'Waiting on your approval — ' + actionLabel(readyAction),
        plantId: readyAction.plantId,
        status: 'pending',
      });
    }
    saveHistory();
    openPanel();
    setCoachTab('chat');
    renderMessages();
    setStatus('Confirm draft below');
    return true;
  }

  function reminderCardsHtml(reminders) {
    const list = Array.isArray(reminders) ? reminders : [];
    if (!list.length) return '';
    return (
      '<div class="ai-coach-reminders">' +
      '<div class="ai-coach-reminders-head">' +
      '<strong>Smart reminders</strong>' +
      '<span>Care logs + weather when available</span>' +
      '</div>' +
      '<div class="ai-coach-reminder-list">' +
      list
        .slice(0, 4)
        .map(function (r) {
          const sev = r.severity === 'urgent' ? 'urgent' : 'info';
          const canDraft = (function () {
            if (!draftActionFromReminder(r)) return false;
            if (!window.CoachCore || typeof CoachCore.resolveActionMode !== 'function') return true;
            return CoachCore.resolveActionMode('add_entry') === 'draft';
          })();
          return (
            '<article class="ai-coach-reminder ai-coach-reminder--' +
            sev +
            (r.kind === 'predictive' ? ' ai-coach-reminder--predictive' : '') +
            '">' +
            '<div class="ai-coach-reminder-top">' +
            '<h4>' +
            esc(r.title) +
            '</h4>' +
            '<button type="button" class="ai-coach-reminder-dismiss" data-reminder-dismiss="' +
            esc(r.id) +
            '" aria-label="Dismiss reminder">×</button>' +
            '</div>' +
            '<p>' +
            esc(r.message) +
            '</p>' +
            '<div class="ai-coach-reminder-actions">' +
            (canDraft
              ? '<button type="button" class="btn btn-primary btn-sm" data-coach-draft="' +
                esc(r.id) +
                '">Draft log</button>'
              : '') +
            '<button type="button" class="btn btn-ghost btn-sm ai-coach-reminder-action" data-coach-prompt="' +
            esc(r.prompt) +
            '">' +
            (canDraft ? 'Ask first' : 'Plan this now') +
            '</button>' +
            '</div>' +
            '</article>'
          );
        })
        .join('') +
      '</div></div>'
    );
  }

  function emptyStateHtml(context) {
    const reminders = (context && context.reminders) || [];
    const trustSeen =
      typeof localStorage !== 'undefined' && localStorage.getItem('dnevnik-live-coach-trust-seen') === '1';
    const trustHtml = trustSeen
      ? ''
      : '<div class="ai-coach-trust" id="ai-coach-trust">' +
        '<strong>Graduated help</strong>' +
        'Routine nudges can surface on their own. Drafts wait for your tap. Minting and plant-health calls stay with you.' +
        '</div>';
    if (!trustSeen && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('dnevnik-live-coach-trust-seen', '1');
      } catch (e) {}
    }
    return (
      '<div class="ai-coach-empty">' +
      '<div class="ai-coach-empty-hero">' +
      '<p class="ai-coach-empty-kicker">Grow coach</p>' +
      '<h3>What needs attention?</h3>' +
      '<p>A low-key grow buddy — care pace, weather, and plain-language next steps. Not a feature pitch.</p>' +
      '</div>' +
      trustHtml +
      reminderCardsHtml(reminders) +
      '</div>'
    );
  }

  function typingHtml() {
    return (
      '<div class="ai-coach-bubble ai-coach-bubble--assistant ai-coach-bubble--typing" aria-label="Coach is thinking">' +
      '<span class="ai-coach-typing"><i></i><i></i><i></i></span>' +
      '<span>Thinking…</span>' +
      '</div>'
    );
  }

  function renderMessages() {
    const el = document.getElementById('ai-coach-messages');
    if (!el) return;
    if (!history.length && !typing) {
      el.innerHTML = emptyStateHtml(buildContext());
      return;
    }

    let html = history
      .map(function (m) {
        const cls =
          'ai-coach-row ai-coach-row--' + (m.role === 'user' ? 'user' : 'assistant');
        let body =
          '<div class="ai-coach-bubble ai-coach-bubble--' +
          (m.role === 'user' ? 'user' : 'assistant') +
          '">';
        if (m.role === 'user' && m.image) {
          body +=
            '<img class="ai-coach-bubble-photo" src="' +
            esc(m.image) +
            '" alt="Attached plant photo" />';
        } else if (m.role === 'user' && m.hasImage) {
          body += '<p class="ai-coach-bubble-photo-note">Photo attached</p>';
        }
        body +=
          '<p>' +
          esc(humanizeCoachText(m.content)).replace(/\n/g, '<br/>') +
          '</p>';
        if (m.actions && m.actions.length) {
          const tiers = m.actions.map(function (a) {
            return window.CoachCore && typeof CoachCore.actionClassLabel === 'function'
              ? CoachCore.actionClassLabel(a.type)
              : 'Draft & confirm';
          });
          const uniqueTier = tiers.filter(function (t, i) {
            return tiers.indexOf(t) === i;
          });
          const highStakes = m.actions.some(function (a) {
            return (
              a.type === 'import_seed' ||
              a.type === 'mint_growth' ||
              a.type === 'link_plant' ||
              a.type === 'market_list'
            );
          });
          body +=
            '<div class="ai-coach-confirm' +
            (highStakes ? ' ai-coach-confirm--high' : '') +
            '">' +
            '<p class="ai-coach-confirm-title">' +
            (highStakes ? 'Confirm required — this touches the trail / chain' : 'Draft ready — confirm to save') +
            '</p>' +
            '<p class="ai-coach-confirm-tier">' +
            esc(uniqueTier.join(' · ')) +
            '</p>' +
            '<ul class="ai-coach-actions">' +
            m.actions
              .map(function (a) {
                return '<li>' + esc(actionLabel(a)) + '</li>';
              })
              .join('') +
            '</ul>' +
            '<div class="ai-coach-action-bar">' +
            '<button type="button" class="btn btn-primary btn-sm" data-coach-run>' +
            (highStakes ? 'Yes, confirm' : 'Save to journal') +
            '</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-coach-cancel>Not now</button>' +
            '</div></div>';
        }
        body += '</div>';
        if (m.role === 'assistant' && m.source) {
          body +=
            '<span class="ai-coach-meta">' +
            (m.source === 'gemini' ? 'Live coach' : 'Local helper') +
            '</span>';
        }
        if (m.role === 'assistant' && m.needsVerify) {
          body +=
            '<div class="ai-coach-verify-bar">' +
            '<button type="button" class="btn btn-primary btn-sm" data-coach-resend-verify>Resend verification email</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-coach-refresh-verify>I already verified</button>' +
            '</div>';
        }
        return '<div class="' + cls + '">' + body + '</div>';
      })
      .join('');

    if (typing) html += '<div class="ai-coach-row ai-coach-row--assistant">' + typingHtml() + '</div>';

    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function syncCoachNavState(isOpen) {
    document.querySelectorAll('.nav-item-coach, #more-nav-coach').forEach(function (btn) {
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      btn.classList.toggle('active', !!isOpen);
    });
  }

  function setOpen(next) {
    open = !!next;
    const panel = document.getElementById('ai-coach-panel');
    const fab = document.getElementById('ai-coach-fab');
    const backdrop = document.getElementById('ai-coach-backdrop');
    if (!panel) return;
    panel.hidden = !open;
    if (backdrop) backdrop.hidden = !open;
    if (fab) {
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      fab.classList.toggle('is-open', open);
      fab.hidden = true;
    }
    document.body.classList.toggle('ai-coach-open', open);
    syncCoachNavState(open);
    syncCoachKeyboardInset();
    if (open) {
      // Reload from storage so a closed panel still shows the last chat.
      if (!busy) loadHistory();
      else sanitizeChatState();
      renderMessages();
      restoreComposerDraft();
      setStatus(
        busy
          ? 'Thinking…'
          : listening
            ? 'Listening…'
            : pendingActions.length
              ? 'Confirm actions below'
              : 'Ready to help'
      );
      // Deliberately not focusing the input: on mobile that throws the
      // keyboard up over the capability row and the conversation. The user
      // taps the field when they actually want to type.
      autoResizeInput();
    } else {
      saveComposerDraft();
      stopVoice();
      document.documentElement.style.setProperty('--coach-kbd-inset', '0px');
    }
  }

  function toggle() {
    setOpen(!open);
  }

  function close() {
    setOpen(false);
  }

  function openPanel() {
    setOpen(true);
    setCoachTab('chat');
  }

  function getSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return SR || null;
  }

  function stopVoice() {
    listening = false;
    const mic = document.getElementById('ai-coach-mic');
    if (mic) {
      mic.classList.remove('is-listening');
      mic.setAttribute('aria-pressed', 'false');
    }
    if (!busy) setStatus('Ready to help');
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    }
  }

  function toggleVoice() {
    const SR = getSpeechRecognition();
    if (!SR) {
      history.push({
        role: 'assistant',
        content: 'Voice input is not supported in this browser. Try Chrome/Edge, or type your request.',
        at: Date.now(),
      });
      renderMessages();
      return;
    }
    if (listening) {
      stopVoice();
      return;
    }
    if (!recognition) {
      recognition = new SR();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = function (event) {
        const transcript = event.results[0] && event.results[0][0] && event.results[0][0].transcript;
        stopVoice();
        if (transcript) {
          const input = document.getElementById('ai-coach-input');
          if (input) input.value = transcript;
          ask(transcript);
        }
      };
      recognition.onerror = function () {
        stopVoice();
      };
      recognition.onend = function () {
        listening = false;
        const mic = document.getElementById('ai-coach-mic');
        if (mic) {
          mic.classList.remove('is-listening');
          mic.setAttribute('aria-pressed', 'false');
        }
      };
    }
    listening = true;
    setStatus('Listening… speak now');
    const mic = document.getElementById('ai-coach-mic');
    if (mic) {
      mic.classList.add('is-listening');
      mic.setAttribute('aria-pressed', 'true');
    }
    try {
      recognition.start();
    } catch (err) {
      stopVoice();
    }
  }

  async function getIdToken() {
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return await firebase.auth().currentUser.getIdToken();
      }
    } catch {
      // ignore
    }
    return null;
  }

  async function askRemote(message, context, imageDataUrl) {
    const token = await getIdToken();
    if (!token) {
      const err = new Error('Sign in required for live coach');
      err.code = 'auth';
      throw err;
    }
    if (imageDataUrl && String(imageDataUrl).length > MAX_COACH_IMAGE_CHARS + 64) {
      const err = new Error('Photo is too large to send. Try a smaller image.');
      err.code = 'image_too_large';
      throw err;
    }
    // Exclude the just-pushed user turn — it is sent as `message` (+ image).
    const prior = history.slice(0, -1).slice(-8).map(function (h) {
      return { role: h.role, content: h.content };
    });
    const payload = {
      message: message,
      history: prior,
      context: context,
      locale: detectCoachLocale(message),
    };
    if (imageDataUrl) payload.image = imageDataUrl;
    const res = await fetch(COACH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      const err = new Error(data.error || 'Coach request failed');
      err.status = res.status;
      err.serverCode = data.code || '';
      throw err;
    }
    return {
      reply: String(data.reply || '').trim(),
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 5) : [],
    };
  }

  async function ask(message) {
    const text = String(message || '').trim();
    const image = pendingImage;
    if ((!text && !image) || busy) return;
    const sendText =
      text ||
      (image
        ? 'Please look at this plant photo and help me diagnose what you see.'
        : '');
    const input = document.getElementById('ai-coach-input');
    // Captured before the field is disabled below — disabling drops focus, so
    // this cannot be read back afterwards.
    const wasTyping = !!input && document.activeElement === input;
    if (input) {
      input.value = '';
      autoResizeInput();
    }
    clearComposerDraft();
    clearPendingImage();

    const userTurn = {
      role: 'user',
      content: humanizeCoachText(sendText),
      at: Date.now(),
    };
    if (image) userTurn.image = image;
    history.push(userTurn);
    typing = true;
    busy = true;
    setStatus(image ? 'Looking at your photo…' : 'Thinking…');
    renderMessages();
    saveHistory();

    const sendBtn = document.getElementById('ai-coach-send');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.classList.add('is-pending');
      sendBtn.setAttribute('aria-busy', 'true');
    }
    if (input) input.disabled = true;

    const context = buildContext();
    let reply = '';
    let actions = [];
    let source = 'local';
    let needsVerify = false;
    try {
      const remote = await askRemote(sendText, context, image || null);
      reply = remote.reply;
      actions = remote.actions || [];
      source = 'gemini';
      // If model returned advice-only but user clearly asked to act, merge local intents
      if (!actions.length) {
        const local = parseLocalIntents(sendText, context);
        if (local.actions && local.actions.length) {
          actions = local.actions;
          if (!reply) reply = local.reply;
          else reply += '\n\n' + local.reply;
        }
      }
    } catch (err) {
      console.warn('AI coach remote failed, using local knowledge', err);
      const local = localReply(sendText, context);
      reply = local.reply;
      actions = local.actions || [];
      if (err && err.code === 'auth') {
        reply += '\n\n(Sign in to use the live coach. Using local helpers for now.)';
      } else if (err && err.code === 'image_too_large') {
        reply += '\n\n(' + err.message + ')';
      } else if (err && err.serverCode === 'email_unverified') {
        needsVerify = true;
        reply +=
          '\n\n(' +
          err.message +
          ' Also check Spam / Promotions for “Verify your email · growtoo”. Using local helpers until then.)';
      } else if (err && err.serverCode === 'quota_exceeded') {
        reply += '\n\n(' + err.message + ' Using local helpers until then.)';
      }
      if (image) {
        reply +=
          '\n\n(Photo diagnosis needs the live coach — your picture wasn’t analyzed offline. Try again when the live coach is available.)';
      }
      source = 'local';
    }

    typing = false;
    actions = (actions || []).map(enrichAction).filter(actionPlantAvailable);
    reply = humanizeCoachText(reply || 'Ready when you are — try a suggestion below.');
    pendingActions = actions.slice();
    history.push({
      role: 'assistant',
      content: reply,
      at: Date.now(),
      source: source,
      actions: actions.length ? actions : undefined,
      needsVerify: needsVerify,
    });
    saveHistory();
    renderMessages();
    busy = false;
    setStatus(actions.length ? 'Confirm actions below' : 'Ready to help');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.classList.remove('is-pending');
      sendBtn.removeAttribute('aria-busy');
    }
    if (input) {
      input.disabled = false;
      // Return focus only to someone who was typing. A capability-chip tap
      // should not summon a keyboard the user never asked for.
      if (wasTyping) input.focus();
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('ai-coach-input');
    ask(input ? input.value : '');
  }

  function currentAppViewId() {
    const active = document.querySelector('.view.active');
    if (!active || !active.id || active.id.indexOf('view-') !== 0) return '';
    return active.id.slice(5);
  }

  let boundChatUid = null;

  function syncAccountChatScope() {
    const uid = currentAuthUid();
    if (boundChatUid === uid) return;
    boundChatUid = uid;
    if (!busy) loadHistory();
    else sanitizeChatState();
    if (open) {
      renderMessages();
      restoreComposerDraft();
    }
  }

  function applyVisibility() {
    ensureDom();
    const root = document.getElementById('ai-coach-root');
    if (!root) return;
    // Panel-only: care Log lives in the tab bar — no overlapping FAB.
    const show = isGrower();
    root.hidden = !show;
    root.setAttribute('aria-hidden', show ? 'false' : 'true');
    root.classList.add('ai-coach-root--panel-only');
    const fab = document.getElementById('ai-coach-fab');
    if (fab) fab.hidden = true;
    document.body.classList.remove('coach-fab-visible');
    if (!show) close();
    else syncAccountChatScope();
  }

  function init() {
    ensureDom();
    loadHistory();
    boundChatUid = currentAuthUid();
    applyVisibility();
    renderMessages();
    try {
      if (window.firebase && firebase.auth) {
        firebase.auth().onAuthStateChanged(function () {
          syncAccountChatScope();
        });
      }
    } catch {
      // ignore
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AICoach = {
    open: openPanel,
    close: close,
    toggle: toggle,
    ask: ask,
    applyVisibility: applyVisibility,
    buildContext: buildContext,
    getReminders: function () {
      return (buildContext().reminders || []).slice();
    },
    proposeDraftFromReminder: proposeDraftFromReminder,
    draftActionFromReminder: draftActionFromReminder,
    runPendingActions: runPendingActions,
    narrateAfterEntry: function (entry, plant) {
      if (window.CoachCore && typeof CoachCore.narrateAfterEntry === 'function') {
        return CoachCore.narrateAfterEntry(entry, plant);
      }
      return null;
    },
    dashboardBriefing: function (plants, entries) {
      if (window.CoachCore && typeof CoachCore.dashboardBriefing === 'function') {
        return CoachCore.dashboardBriefing(plants, entries);
      }
      return '';
    },
    todayHeadline: function (plants, entries) {
      if (window.CoachCore && typeof CoachCore.todayHeadline === 'function') {
        return CoachCore.todayHeadline(plants, entries);
      }
      if (window.CoachCore && typeof CoachCore.dashboardBriefing === 'function') {
        return CoachCore.dashboardBriefing(plants, entries);
      }
      return '';
    },
    getEntryNote: function (entryId) {
      if (window.CoachCore && typeof CoachCore.getEntryNote === 'function') {
        return CoachCore.getEntryNote(entryId);
      }
      return '';
    },
    openLog: function () {
      openPanel();
      setCoachTab('settings');
    },
    openPermissions: function () {
      openPanel();
      setCoachTab('settings');
    },
    STAGE_PLAYBOOK: STAGE_PLAYBOOK,
    STAGE_ORDER: STAGE_ORDER,
  };
})();
