/*
 * Grower AI Coach — knowledge assistant for journal steps + tokenisation.
 * Calls Cloud Function `coachChat` when signed in; falls back to local KB.
 */
(function () {
  'use strict';

  const STORAGE_PLANTS = 'dnevnik-live-plants';
  const STORAGE_ENTRIES = 'dnevnik-live-entries';
  const STORAGE_TOOLBOX = 'dnevnik-live-toolbox';
  const STORAGE_CHAT = 'dnevnik-live-coach-chat';

  const COACH_URL =
    'https://europe-west1-balpha-9dab9.cloudfunctions.net/coachChat';

  const STAGE_LABELS = {
    klijanje: 'Germination',
    sadnica: 'Seedling',
    vegetativna: 'Vegetative',
    cvjetanje: 'Flowering',
    susenje: 'Drying',
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
    { id: 'water', label: 'Watering', text: 'How should I water at my current stage?' },
    { id: 'feed', label: 'Feeding', text: 'What feeding schedule fits my stage?' },
    { id: 'mint', label: 'Unlock mint', text: 'What journal logs do I still need to unlock the next growth mint?' },
    { id: 'token', label: 'Tokenise', text: 'How do I get more value from tokenisation with my journal?' },
  ];

  let open = false;
  let busy = false;
  let history = [];

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
    const list = readJson(STORAGE_PLANTS, []);
    return Array.isArray(list) ? list : [];
  }

  function getEntries() {
    const list = readJson(STORAGE_ENTRIES, []);
    return Array.isArray(list) ? list : [];
  }

  function getToolbox() {
    const box = readJson(STORAGE_TOOLBOX, {});
    return box && typeof box === 'object' ? box : {};
  }

  function currentGrowlogPlantId() {
    if (window.DnevnikJournal && typeof DnevnikJournal.getCurrentGrowlogPlantId === 'function') {
      return DnevnikJournal.getCurrentGrowlogPlantId();
    }
    const view = document.getElementById('view-growlog');
    if (view && view.classList.contains('active')) {
      const title = document.querySelector('.view-title');
      if (title) {
        const plant = getPlants().find((p) => p && p.name === title.textContent);
        if (plant) return plant.id;
      }
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

    let questHint = null;
    if (focus && window.GrowerQuests && window.PlantToken) {
      try {
        const wallet = PlantToken.getWallet && PlantToken.getWallet();
        const token =
          wallet &&
          Array.isArray(wallet.tokens) &&
          wallet.tokens.find((t) => t && String(t.plantId) === String(focus.id));
        if (token && token.stageIndex < 5) {
          const stages = PlantToken.GROWTH_STAGES || [];
          const next = stages[token.stageIndex + 1];
          if (next) {
            const quest = GrowerQuests.evaluateGrowthQuest(token, next.key);
            questHint = {
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
      recentEntries: recentEntries,
      toolboxCounts: {
        watering: Array.isArray(toolbox.watering) ? toolbox.watering.length : 0,
        feeding: Array.isArray(toolbox.feeding) ? toolbox.feeding.length : 0,
        environment: Array.isArray(toolbox.environment) ? toolbox.environment.length : 0,
      },
      mintQuest: questHint,
      profileType: 'grower',
    };
  }

  function localReply(message, context) {
    const q = String(message || '').toLowerCase();
    const focus = context.focusPlant;
    const stageKey = focus && focus.stage ? focus.stage : null;
    const playbook = stageKey && STAGE_PLAYBOOK[stageKey] ? STAGE_PLAYBOOK[stageKey] : null;

    if (/mint|token|\$grow|rwa|nft|quest|unlock/.test(q)) {
      const lines = [
        'Tokenisation on dnevnik.live is unlocked by journal proof:',
        '1. Link a journal plant to your Seed NFT',
        '2. Log the matching growth stage (faza / plant stage)',
        '3. Log watering for the current stage window',
        '4. Log feeding from seedling onward',
        '',
        'Then open Tokenise and mint the next stage for $GROW.',
      ];
      if (context.mintQuest) {
        lines.push('');
        lines.push(
          context.mintQuest.ready
            ? 'Your linked token looks ready for the next mint (' + context.mintQuest.nextStage + ').'
            : 'Still missing for mint: ' + (context.mintQuest.missing || []).join(', ')
        );
      }
      return lines.join('\n');
    }

    if (/water|zalij|feed|gnoj|nutrient/.test(q) && playbook) {
      return (
        'For ' +
        (focus.name || 'your plant') +
        ' in ' +
        playbook.title +
        ':\n• ' +
        playbook.steps.slice(0, 3).join('\n• ')
      );
    }

    if (playbook) {
      return (
        'Next tailored steps for ' +
        (focus.name || 'your plant') +
        ' (' +
        playbook.title +
        '):\n• ' +
        playbook.steps.join('\n• ') +
        '\n\nAsk me about watering, feeding, or how to unlock the next mint.'
      );
    }

    if (context.plants && context.plants.length) {
      const list = context.plants
        .slice(0, 5)
        .map((p) => '• ' + p.name + ' — ' + (p.stageLabel || p.stage || 'no stage'))
        .join('\n');
      return (
        'Here is your garden snapshot:\n' +
        list +
        '\n\nOpen a plant’s grow log for stage-specific steps, or ask: “What should I do next?” / “How do I unlock the next mint?”'
      );
    }

    return (
      'Add a plant in Plants & journal, then ask me for stage-by-stage steps.\n\n' +
      'I can help with:\n• Growth checklists per stage\n• Watering & feeding know-how\n• Unlocking Seed / growth mints with journal proof'
    );
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
      '<p>Growth steps · know-how · tokenisation</p>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="ai-coach-close" aria-label="Close">Close</button>' +
      '</header>' +
      '<div class="ai-coach-quick" id="ai-coach-quick"></div>' +
      '<div class="ai-coach-messages" id="ai-coach-messages" role="log" aria-live="polite"></div>' +
      '<form class="ai-coach-form" id="ai-coach-form">' +
      '<input type="text" id="ai-coach-input" maxlength="2000" placeholder="Ask about stages, watering, or minting…" autocomplete="off" />' +
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
    quick.addEventListener('click', function (e) {
      const chip = e.target.closest('.ai-coach-chip');
      if (!chip) return;
      const text = chip.getAttribute('data-prompt');
      if (text) ask(text);
    });
  }

  function renderMessages() {
    const el = document.getElementById('ai-coach-messages');
    if (!el) return;
    if (!history.length) {
      el.innerHTML =
        '<div class="ai-coach-bubble ai-coach-bubble--assistant">' +
        '<p>Hi — I am your Grower Coach. I use your journal context to tailor the next growth steps and explain how logs unlock Seed / $GROW mints.</p>' +
        '</div>';
      return;
    }
    el.innerHTML = history
      .map(function (m) {
        const cls =
          'ai-coach-bubble ai-coach-bubble--' + (m.role === 'user' ? 'user' : 'assistant');
        return '<div class="' + cls + '"><p>' + esc(m.content).replace(/\n/g, '<br/>') + '</p></div>';
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
    return String(data.reply || '').trim();
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
    let source = 'local';
    try {
      reply = await askRemote(text, context);
      source = 'gemini';
    } catch (err) {
      console.warn('AI coach remote failed, using local knowledge', err);
      reply = localReply(text, context);
      if (err && err.code === 'auth') {
        reply +=
          '\n\n(Live Gemini coach needs you signed in. Showing local knowledge for now.)';
      } else if (err && (err.status === 503 || err.status === 404)) {
        reply +=
          '\n\n(Live coach API is not deployed yet — using built-in grower knowledge.)';
      }
      source = 'local';
    }

    history.push({ role: 'assistant', content: reply, at: Date.now(), source: source });
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
    STAGE_PLAYBOOK: STAGE_PLAYBOOK,
    STAGE_ORDER: STAGE_ORDER,
  };
})();
