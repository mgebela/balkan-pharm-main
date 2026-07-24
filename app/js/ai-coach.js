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
  const STORAGE_REMINDER_DISMISS = 'dnevnik-live-coach-reminder-dismiss';

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
        'Log the stage change to klijanje in the plant profile.',
        'Add a zalijevanje entry when you first water.',
        'For tokenisation: link the plant, then mint germination (feeding optional at this stage).',
      ],
    },
    sadnica: {
      title: 'Seedling',
      steps: [
        'Gentle light, steady moisture, avoid overfeeding.',
        'Log watering and start a light nutrient schedule (gnojidba).',
        'Update stage to sadnica so growth mint proof can pass.',
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
        'Update stage to cvjetanje before requesting the flowering mint.',
        'Token tip: flowering stage also upgrades the on-chain asset type.',
      ],
    },
    susenje: {
      title: 'Drying / harvest prep',
      steps: [
        'Slow dry in controlled humidity; log harvest and drying notes.',
        'Complete final watering/feeding history for the cycle.',
        'Set stage to susenje to unlock the harvest mint.',
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

  let open = false;
  let busy = false;
  let history = [];
  let pendingActions = [];
  let recognition = null;
  let listening = false;
  let typing = false;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
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
          title: 'Nutrient cadence check',
          message:
            plantName +
            ' is in ' +
            stageLabel +
            ' with no recent feeding log' +
            (sinceFeeding == null ? '' : ' for ' + sinceFeeding + ' days') +
            '.',
          prompt:
            'Review feeding plan for "' +
            plantName +
            '" in ' +
            stageLabel +
            " and suggest today's nutrients.",
        });
      }
    });
    return list.slice(0, 8);
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

  function buildContext() {
    const plants = getPlants();
    const entries = getEntries();
    const toolbox = getToolbox();
    const focusId = currentGrowlogPlantId();
    const focus = focusId ? plants.find((p) => p && String(p.id) === String(focusId)) : null;

    const plantSummaries = plants.slice(0, 12).map((p) => ({
      id: p.id,
      name: p.name,
      strain: p.strain || null,
      stage: p.stage || null,
      stageLabel: STAGE_LABELS[p.stage] || p.stage || null,
      environmentType: p.environmentType || null,
      startDate: p.startDate || null,
    }));

    const recentEntries = entries
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 12)
      .map((e) => ({
        type: e.type,
        plantId: e.plantId,
        date: e.date || null,
        note: e.note ? String(e.note).slice(0, 120) : null,
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
        ? {
            id: focus.id,
            name: focus.name,
            strain: focus.strain || null,
            stage: focus.stage || null,
            stageLabel: STAGE_LABELS[focus.stage] || focus.stage || null,
          }
        : null,
      plants: plantSummaries,
      tokens: tokens,
      recentEntries: recentEntries,
      toolboxCounts: {
        watering: Array.isArray(toolbox.watering) ? toolbox.watering.length : 0,
        feeding: Array.isArray(toolbox.feeding) ? toolbox.feeding.length : 0,
        environment: Array.isArray(toolbox.environment) ? toolbox.environment.length : 0,
      },
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
    switch (action.type) {
      case 'create_plant':
        return 'Create plant “' + (action.name || 'Untitled') + '”';
      case 'add_entry':
        return 'Log ' + (action.entryType || action.type || 'entry') + ' for ' + (action.plantId || 'plant');
      case 'set_stage':
        return 'Set stage → ' + (STAGE_LABELS[action.stage] || action.stage || '?');
      case 'import_seed':
        return 'Mint seed token for ' + (action.plantId || action.name || 'plant');
      case 'mint_growth':
        return 'Mint next growth stage';
      case 'link_plant':
        return 'Link token to plant ' + (action.plantId || '');
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
        actions.push({ type: 'set_stage', plantId: plant.id, stage: stage, note: 'Updated via Grower Coach' });
        reply = (reply ? reply + '\n' : '') + 'I can move “' + plant.name + '” to ' + (STAGE_LABELS[stage] || stage) + '.';
      }
    }

    if (/(?:mint\s+(?:a\s+)?seed|tokenise|tokenize)/i.test(lower)) {
      const plant = resolvePlant(context.focusPlant && context.focusPlant.id);
      if (plant) {
        actions.push({ type: 'import_seed', plantId: plant.id, name: plant.name, strain: plant.strain || plant.name });
        reply = (reply ? reply + '\n' : '') + 'I can mint a Seed NFT for “' + plant.name + '” (wallet must be connected).';
      }
    }

    if (/(?:mint\s+(?:next\s+)?growth|advance\s+(?:the\s+)?(?:token|stage)|grow\s+mint)/i.test(lower)) {
      const plant = resolvePlant(context.focusPlant && context.focusPlant.id);
      const token = plant ? findTokenForPlant(plant.id) : null;
      if (token) {
        actions.push({ type: 'mint_growth', tokenId: token.id, plantId: plant.id });
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

    if (type === 'create_plant') {
      if (!DJ || typeof DJ.createPlant !== 'function') throw new Error('Journal API unavailable');
      const plant = DJ.createPlant({
        name: action.name,
        strain: action.strain,
        stage: resolveStage(action.stage) || action.stage || 'klijanje',
        environmentType: action.environmentType,
        notes: action.notes,
      });
      return 'Created plant “' + plant.name + '” (' + (STAGE_LABELS[plant.stage] || plant.stage) + ').';
    }

    if (type === 'add_entry') {
      if (!DJ || typeof DJ.addEntry !== 'function') throw new Error('Journal API unavailable');
      const plant = resolvePlant(action.plantId);
      if (!plant) throw new Error('Plant not found for entry');
      const entry = DJ.addEntry({
        plantId: plant.id,
        type: action.entryType || action.type || 'opcenito',
        note: action.note,
        date: action.date,
      });
      return 'Logged ' + entry.type + ' for “' + plant.name + '”.';
    }

    if (type === 'set_stage') {
      if (!DJ || typeof DJ.setPlantStage !== 'function') throw new Error('Journal API unavailable');
      const plant = resolvePlant(action.plantId);
      if (!plant) throw new Error('Plant not found for stage change');
      const stage = resolveStage(action.stage) || action.stage;
      const updated = DJ.setPlantStage(plant.id, stage, action.note);
      return 'Updated “' + updated.name + '” → ' + (STAGE_LABELS[updated.stage] || updated.stage) + '.';
    }

    if (type === 'import_seed') {
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
      return 'Seed token minted for “' + (result.token && result.token.name) + '”.';
    }

    if (type === 'mint_growth') {
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
      return (
        'Growth minted' +
        (result && result.reward != null ? ' (+' + result.reward + ' $GROWTOO)' : '') +
        '.'
      );
    }

    if (type === 'link_plant') {
      if (!PT || typeof PT.linkPlant !== 'function') throw new Error('Token API unavailable');
      const plant = resolvePlant(action.plantId);
      if (!plant || !action.tokenId) throw new Error('tokenId and plant required');
      await PT.linkPlant(action.tokenId, plant.id);
      if (window.AdoptPlant && typeof AdoptPlant.render === 'function') AdoptPlant.render();
      return 'Linked token to “' + plant.name + '”.';
    }

    throw new Error('Unsupported action: ' + type);
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
        const msg = await executeAction(pendingActions[i]);
        results.push('✓ ' + msg);
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
    const saved = readJson(STORAGE_CHAT, []);
    history = Array.isArray(saved) ? saved.slice(-20) : [];
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_CHAT, JSON.stringify(history.slice(-20)));
    } catch {
      // ignore
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
      '<strong id="ai-coach-title">Grower Coach</strong>' +
      '<span class="ai-coach-status" id="ai-coach-status">Ready to help</span>' +
      '</div></div>' +
      '<div class="ai-coach-head-actions">' +
      '<button type="button" class="ai-coach-icon-btn" id="ai-coach-clear" title="New chat" aria-label="Clear chat">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 12h10l1-12"/></svg>' +
      '</button>' +
      '<button type="button" class="ai-coach-icon-btn" id="ai-coach-close" aria-label="Close coach">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>' +
      '</div></header>' +
      '<div class="ai-coach-messages" id="ai-coach-messages" role="log" aria-live="polite"></div>' +
      '<div class="ai-coach-composer">' +
      '<div class="ai-coach-quick" id="ai-coach-quick" aria-label="Suggestions"></div>' +
      '<form class="ai-coach-form" id="ai-coach-form">' +
      '<label class="ai-coach-field">' +
      '<span class="visually-hidden">Message</span>' +
      '<textarea id="ai-coach-input" rows="1" maxlength="2000" placeholder="Ask about stages, care, or minting…" autocomplete="off"></textarea>' +
      '</label>' +
      '<div class="ai-coach-form-actions">' +
      '<button type="button" class="ai-coach-icon-btn ai-coach-mic" id="ai-coach-mic" title="Speak" aria-pressed="false" aria-label="Voice input">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/>' +
      '</svg></button>' +
      '<button type="submit" class="ai-coach-send" id="ai-coach-send" aria-label="Send">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 12h12"/><path d="M13 6l6 6-6 6"/>' +
      '</svg></button>' +
      '</div></form>' +
      '<p class="ai-coach-foot">Can create plants, log care, update stages, and mint — always asks first.</p>' +
      '</div></aside>';
    document.body.appendChild(root);

    renderQuickPrompts();

    document.getElementById('ai-coach-fab').addEventListener('click', toggle);
    document.getElementById('ai-coach-close').addEventListener('click', close);
    document.getElementById('ai-coach-clear').addEventListener('click', clearChat);
    document.getElementById('ai-coach-backdrop').addEventListener('click', close);
    document.getElementById('ai-coach-form').addEventListener('submit', onSubmit);
    document.getElementById('ai-coach-mic').addEventListener('click', toggleVoice);
    document.getElementById('ai-coach-quick').addEventListener('click', function (e) {
      const chip = e.target.closest('.ai-coach-chip');
      if (!chip) return;
      const text = chip.getAttribute('data-prompt');
      if (text) ask(text);
    });

    const input = document.getElementById('ai-coach-input');
    if (input) {
      input.addEventListener('input', autoResizeInput);
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
      }
    });
  }

  function syncCoachKeyboardInset() {
    if (!open || !window.visualViewport) {
      document.documentElement.style.setProperty('--coach-kbd-inset', '0px');
      return;
    }
    const vv = window.visualViewport;
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--coach-kbd-inset', inset + 'px');
  }

  function renderQuickPrompts() {
    const quick = document.getElementById('ai-coach-quick');
    if (!quick) return;
    // Empty state already shows starter cards — keep chips for mid-chat only.
    if (!history.length) {
      quick.innerHTML = '';
      quick.hidden = true;
      return;
    }
    quick.hidden = false;
    quick.classList.add('ai-coach-quick--compact');
    quick.innerHTML = QUICK_PROMPTS.map(function (p) {
      return (
        '<button type="button" class="ai-coach-chip" data-prompt="' +
        esc(p.text) +
        '">' +
        '<span class="ai-coach-chip-label">' +
        esc(p.label) +
        '</span>' +
        '</button>'
      );
    }).join('');
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
    renderMessages();
    renderQuickPrompts();
    setStatus('Fresh chat');
    const input = document.getElementById('ai-coach-input');
    if (input) {
      input.value = '';
      autoResizeInput();
      input.focus();
    }
  }

  function reminderCardsHtml(reminders) {
    const list = Array.isArray(reminders) ? reminders : [];
    if (!list.length) return '';
    return (
      '<div class="ai-coach-reminders">' +
      '<div class="ai-coach-reminders-head">' +
      '<strong>Smart reminders</strong>' +
      '<span>Based on your logs</span>' +
      '</div>' +
      '<div class="ai-coach-reminder-list">' +
      list
        .slice(0, 4)
        .map(function (r) {
          return (
            '<article class="ai-coach-reminder">' +
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
            '<button type="button" class="ai-coach-reminder-action" data-coach-prompt="' +
            esc(r.prompt) +
            '">Plan this now</button>' +
            '</article>'
          );
        })
        .join('') +
      '</div></div>'
    );
  }

  function emptyStateHtml(context) {
    const reminders = (context && context.reminders) || [];
    return (
      '<div class="ai-coach-empty">' +
      '<div class="ai-coach-empty-hero">' +
      '<p class="ai-coach-empty-kicker">Grower Coach</p>' +
      '<h3>What should we work on?</h3>' +
      '<p>Advice on stages, journal logs, and mint prep. Tap a starter or type below.</p>' +
      '</div>' +
      '<div class="ai-coach-empty-grid" role="list">' +
      QUICK_PROMPTS.slice(0, 4)
        .map(function (p) {
          return (
            '<button type="button" class="ai-coach-starter" data-coach-prompt="' +
            esc(p.text) +
            '" role="listitem">' +
            '<strong>' +
            esc(p.label) +
            '</strong>' +
            '<span>' +
            esc(p.hint || '') +
            '</span>' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
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
      renderQuickPrompts();
      return;
    }

    let html = history
      .map(function (m) {
        const cls =
          'ai-coach-row ai-coach-row--' + (m.role === 'user' ? 'user' : 'assistant');
        let body =
          '<div class="ai-coach-bubble ai-coach-bubble--' +
          (m.role === 'user' ? 'user' : 'assistant') +
          '">' +
          '<p>' +
          esc(m.content).replace(/\n/g, '<br/>') +
          '</p>';
        if (m.actions && m.actions.length) {
          body +=
            '<div class="ai-coach-confirm">' +
            '<p class="ai-coach-confirm-title">I can do this for you</p>' +
            '<ul class="ai-coach-actions">' +
            m.actions
              .map(function (a) {
                return '<li>' + esc(actionLabel(a)) + '</li>';
              })
              .join('') +
            '</ul>' +
            '<div class="ai-coach-action-bar">' +
            '<button type="button" class="btn btn-primary btn-sm" data-coach-run>Yes, run it</button>' +
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
        return '<div class="' + cls + '">' + body + '</div>';
      })
      .join('');

    if (typing) html += '<div class="ai-coach-row ai-coach-row--assistant">' + typingHtml() + '</div>';

    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
    renderQuickPrompts();
  }

  function setOpen(next) {
    open = !!next;
    const panel = document.getElementById('ai-coach-panel');
    const fab = document.getElementById('ai-coach-fab');
    const backdrop = document.getElementById('ai-coach-backdrop');
    if (!panel || !fab) return;
    panel.hidden = !open;
    if (backdrop) backdrop.hidden = !open;
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    fab.classList.toggle('is-open', open);
    fab.hidden = open;
    document.body.classList.toggle('ai-coach-open', open);
    syncCoachKeyboardInset();
    if (open) {
      renderMessages();
      renderQuickPrompts();
      setStatus(busy ? 'Thinking…' : listening ? 'Listening…' : 'Ready to help');
      const input = document.getElementById('ai-coach-input');
      if (input) {
        autoResizeInput();
        setTimeout(function () {
          input.focus();
        }, 40);
      }
    } else {
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

  async function askRemote(message, context) {
    const token = await getIdToken();
    if (!token) {
      const err = new Error('Sign in required for live coach');
      err.code = 'auth';
      throw err;
    }
    const res = await fetch(COACH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({
        message: message,
        history: history.slice(-8).map(function (h) {
          return { role: h.role, content: h.content };
        }),
        context: context,
        locale: 'en',
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      const err = new Error(data.error || 'Coach request failed');
      err.status = res.status;
      throw err;
    }
    return {
      reply: String(data.reply || '').trim(),
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 5) : [],
    };
  }

  async function ask(message) {
    const text = String(message || '').trim();
    if (!text || busy) return;
    const input = document.getElementById('ai-coach-input');
    if (input) {
      input.value = '';
      autoResizeInput();
    }

    history.push({ role: 'user', content: text, at: Date.now() });
    typing = true;
    busy = true;
    setStatus('Thinking…');
    renderMessages();
    saveHistory();

    const sendBtn = document.getElementById('ai-coach-send');
    if (sendBtn) sendBtn.disabled = true;
    if (input) input.disabled = true;

    const context = buildContext();
    let reply = '';
    let actions = [];
    let source = 'local';
    try {
      const remote = await askRemote(text, context);
      reply = remote.reply;
      actions = remote.actions || [];
      source = 'gemini';
      // If model returned advice-only but user clearly asked to act, merge local intents
      if (!actions.length) {
        const local = parseLocalIntents(text, context);
        if (local.actions && local.actions.length) {
          actions = local.actions;
          if (!reply) reply = local.reply;
          else reply += '\n\n' + local.reply;
        }
      }
    } catch (err) {
      console.warn('AI coach remote failed, using local knowledge', err);
      const local = localReply(text, context);
      reply = local.reply;
      actions = local.actions || [];
      if (err && err.code === 'auth') {
        reply += '\n\n(Sign in to use the live coach. Using local helpers for now.)';
      }
      source = 'local';
    }

    typing = false;
    pendingActions = actions.slice();
    history.push({
      role: 'assistant',
      content: reply || 'Ready when you are — try a suggestion below.',
      at: Date.now(),
      source: source,
      actions: actions.length ? actions : undefined,
    });
    saveHistory();
    renderMessages();
    busy = false;
    setStatus(actions.length ? 'Confirm actions below' : 'Ready to help');
    if (sendBtn) sendBtn.disabled = false;
    if (input) {
      input.disabled = false;
      input.focus();
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('ai-coach-input');
    ask(input ? input.value : '');
  }

  function applyVisibility() {
    ensureDom();
    const root = document.getElementById('ai-coach-root');
    if (!root) return;
    const show = isGrower();
    root.hidden = !show;
    root.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) close();
  }

  function init() {
    loadHistory();
    ensureDom();
    applyVisibility();
    renderMessages();
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
    runPendingActions: runPendingActions,
    STAGE_PLAYBOOK: STAGE_PLAYBOOK,
    STAGE_ORDER: STAGE_ORDER,
  };
})();
