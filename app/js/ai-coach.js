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
        'Token tip: harvest stage is the last $GROW milestone on the growth path.',
      ],
    },
  };

  const QUICK_PROMPTS = [
    { id: 'next', label: 'Next steps', text: 'What should I do next for my current plants?' },
    { id: 'create', label: 'New plant', text: 'Create a new indoor plant named CBD Auto starting at germination.' },
    { id: 'water', label: 'Log water', text: 'Log watering for my current plant.' },
    { id: 'feed', label: 'Log feed', text: 'Log feeding for my current plant.' },
    { id: 'mint', label: 'Mint seed', text: 'Mint a seed token for my current plant.' },
    { id: 'grow', label: 'Mint growth', text: 'Mint the next growth stage for my linked token if journal proof is ready.' },
  ];

  let open = false;
  let busy = false;
  let history = [];
  let pendingActions = [];
  let recognition = null;
  let listening = false;

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
      mintQuest: questHint,
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
        (result && result.reward != null ? ' (+' + result.reward + ' $GROW)' : '') +
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
      content: 'Actions finished:\n' + results.join('\n'),
      at: Date.now(),
      source: 'actions',
    });
    saveHistory();
    renderMessages();
    busy = false;
  }

  function cancelPendingActions() {
    pendingActions = [];
    history.push({
      role: 'assistant',
      content: 'Cancelled — no changes were made.',
      at: Date.now(),
      source: 'actions',
    });
    saveHistory();
    renderMessages();
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
      '<span class="ai-coach-fab-icon" aria-hidden="true">✦</span>' +
      '<span class="ai-coach-fab-label">Coach</span>' +
      '</button>' +
      '<aside class="ai-coach-panel" id="ai-coach-panel" hidden>' +
      '<header class="ai-coach-head">' +
      '<div>' +
      '<strong>Grower Coach</strong>' +
      '<p>Ask in text or voice — I can create plants, log care, and mint</p>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="ai-coach-close" aria-label="Close">Close</button>' +
      '</header>' +
      '<div class="ai-coach-quick" id="ai-coach-quick"></div>' +
      '<div class="ai-coach-messages" id="ai-coach-messages" role="log" aria-live="polite"></div>' +
      '<form class="ai-coach-form" id="ai-coach-form">' +
      '<button type="button" class="btn btn-ghost btn-sm ai-coach-mic" id="ai-coach-mic" title="Voice input" aria-pressed="false">🎙</button>' +
      '<input type="text" id="ai-coach-input" maxlength="2000" placeholder="Say or type: create plant…, log watering…" autocomplete="off" />' +
      '<button type="submit" class="btn btn-primary btn-sm" id="ai-coach-send">Send</button>' +
      '</form>' +
      '</aside>';
    document.body.appendChild(root);

    const quick = document.getElementById('ai-coach-quick');
    if (quick) {
      quick.innerHTML = QUICK_PROMPTS.map(function (p) {
        return (
          '<button type="button" class="ai-coach-chip" data-prompt="' +
          esc(p.text) +
          '">' +
          esc(p.label) +
          '</button>'
        );
      }).join('');
    }

    document.getElementById('ai-coach-fab').addEventListener('click', toggle);
    document.getElementById('ai-coach-close').addEventListener('click', close);
    document.getElementById('ai-coach-form').addEventListener('submit', onSubmit);
    document.getElementById('ai-coach-mic').addEventListener('click', toggleVoice);
    quick.addEventListener('click', function (e) {
      const chip = e.target.closest('.ai-coach-chip');
      if (!chip) return;
      const text = chip.getAttribute('data-prompt');
      if (text) ask(text);
    });

    document.getElementById('ai-coach-messages').addEventListener('click', function (e) {
      if (e.target.closest('[data-coach-run]')) {
        runPendingActions();
        return;
      }
      if (e.target.closest('[data-coach-cancel]')) {
        cancelPendingActions();
      }
    });
  }

  function renderMessages() {
    const el = document.getElementById('ai-coach-messages');
    if (!el) return;
    if (!history.length) {
      el.innerHTML =
        '<div class="ai-coach-bubble ai-coach-bubble--assistant">' +
        '<p>Hi — I am your Grower Coach. Ask in text or voice and I can <strong>create plants</strong>, <strong>log watering/feeding</strong>, <strong>change stages</strong>, and <strong>mint seed/growth tokens</strong> (with your confirmation).</p>' +
        '</div>';
      return;
    }
    el.innerHTML = history
      .map(function (m) {
        const cls =
          'ai-coach-bubble ai-coach-bubble--' + (m.role === 'user' ? 'user' : 'assistant');
        let body = '<p>' + esc(m.content).replace(/\n/g, '<br/>') + '</p>';
        if (m.actions && m.actions.length) {
          body +=
            '<ul class="ai-coach-actions">' +
            m.actions
              .map(function (a) {
                return '<li>' + esc(actionLabel(a)) + '</li>';
              })
              .join('') +
            '</ul>' +
            '<div class="ai-coach-action-bar">' +
            '<button type="button" class="btn btn-primary btn-sm" data-coach-run>Run actions</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-coach-cancel>Cancel</button>' +
            '</div>';
        }
        return '<div class="' + cls + '">' + body + '</div>';
      })
      .join('');
    el.scrollTop = el.scrollHeight;
  }

  function setOpen(next) {
    open = !!next;
    const panel = document.getElementById('ai-coach-panel');
    const fab = document.getElementById('ai-coach-fab');
    if (!panel || !fab) return;
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('ai-coach-open', open);
    if (open) {
      renderMessages();
      const input = document.getElementById('ai-coach-input');
      if (input) input.focus();
    } else {
      stopVoice();
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
    if (input) input.value = '';

    history.push({ role: 'user', content: text, at: Date.now() });
    renderMessages();
    saveHistory();

    busy = true;
    const sendBtn = document.getElementById('ai-coach-send');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = '…';
    }

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
        reply += '\n\n(Live Gemini coach needs you signed in. Using local actions/knowledge.)';
      }
      source = 'local';
    }

    pendingActions = actions.slice();
    history.push({
      role: 'assistant',
      content: reply || 'Ready when you are.',
      at: Date.now(),
      source: source,
      actions: actions.length ? actions : undefined,
    });
    saveHistory();
    renderMessages();
    busy = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
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
    runPendingActions: runPendingActions,
    STAGE_PLAYBOOK: STAGE_PLAYBOOK,
    STAGE_ORDER: STAGE_ORDER,
  };
})();
