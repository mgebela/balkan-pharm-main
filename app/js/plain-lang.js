/**
 * Plain-language glossary tips for Tokenise / Market (growers & adopters).
 */
(function () {
  'use strict';

  var TERMS = {
    escrow:
      'A temporary hold: your plant token sits safely with the market until someone invests or you cancel — like a middle shelf, not a permanent transfer.',
    settlement:
      'When the deal finishes: payment is confirmed and the plant token moves to the adopter (or returns to you if you cancel).',
    settle:
      'When the deal finishes: payment is confirmed and the plant token moves to the adopter (or returns to you if you cancel).',
    rwa:
      '“Real-world asset” token — here it just means a plant token linked to a real journal trail on the test network. Not a stock or cash.',
    'plant token':
      'A digital certificate on Solana’s test network linked to one journal plant. Optional — your journal works without it.',
    'adopt stake':
      'Half now, half unlocks as the grower keeps logging care through harvest.',
    'instant sale':
      'Full price to the grower at purchase. Done — no care lock.',
    redemption:
      'Turning a harvest-stage token into a real harvest share. Coming later — not available on Devnet. Claim locked stake only unlocks escrowed $GROWTOO.',
    'bonding curve':
      'An automatic price formula some crypto projects use. growtoo does not use one — growers set their own ask price.',
    'collection authority':
      'The operator key that currently updates token metadata and settles Devnet deals. A centralized MVP trust point — see Risks.',
    '$growtoo':
      'Test-network reward tokens with no monetary value. Used to practice investing and stage rewards on Devnet.',
    growtoo:
      'Test-network reward tokens with no monetary value. Used to practice investing and stage rewards on Devnet.',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function lookup(term) {
    var key = String(term || '')
      .trim()
      .toLowerCase();
    return TERMS[key] || '';
  }

  function tipHtml(term, label) {
    var text = lookup(term);
    if (!text) return esc(label || term);
    var shown = label || term;
    return (
      '<span class="plain-tip">' +
      esc(shown) +
      '<button type="button" class="plain-tip-btn" aria-label="What does ' +
      esc(shown) +
      ' mean?" data-plain-tip="' +
      esc(term) +
      '">?</button>' +
      '<span class="plain-tip-bubble" role="tooltip" hidden>' +
      esc(text) +
      '</span>' +
      '</span>'
    );
  }

  function bindTips(root) {
    var scope = root || document;
    if (scope.dataset && scope.dataset.plainTipsBound === '1') return;
    if (scope.dataset) scope.dataset.plainTipsBound = '1';
    scope.addEventListener('click', function (e) {
      var btn = e.target.closest('.plain-tip-btn');
      if (!btn) {
        scope.querySelectorAll('.plain-tip-bubble:not([hidden])').forEach(function (b) {
          b.hidden = true;
        });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      var tip = btn.parentElement && btn.parentElement.querySelector('.plain-tip-bubble');
      if (!tip) return;
      var open = tip.hidden;
      scope.querySelectorAll('.plain-tip-bubble').forEach(function (b) {
        b.hidden = true;
      });
      tip.hidden = !open;
    });
  }

  /** Single Advanced/Simple setting for Market, Tokenise, and Profile — do not fork. */
  var MODE_KEY = 'growtoo-crypto-mode';

  function getMode() {
    try {
      var m = localStorage.getItem(MODE_KEY);
      if (m === 'advanced') return 'advanced';
    } catch (e) {
      // ignore
    }
    return 'simple';
  }

  function setMode(mode) {
    var next = mode === 'advanced' ? 'advanced' : 'simple';
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch (e) {
      // ignore
    }
    applyMode();
    return next;
  }

  function applyMode() {
    var mode = getMode();
    document.body.classList.toggle('crypto-simple', mode === 'simple');
    document.body.classList.toggle('crypto-advanced', mode === 'advanced');
    document.querySelectorAll('[data-crypto-mode-label]').forEach(function (el) {
      el.textContent = mode === 'simple' ? 'Simple' : 'Advanced';
    });
    document.querySelectorAll('[data-crypto-mode-segmented]').forEach(function (group) {
      group.setAttribute('data-active', mode);
    });
    document.querySelectorAll('[data-crypto-mode-btn]').forEach(function (btn) {
      var value = btn.getAttribute('data-crypto-mode-btn');
      if (value === 'simple' || value === 'advanced') {
        // Segmented control: both options stay visible, one is checked.
        btn.setAttribute('aria-checked', value === mode ? 'true' : 'false');
        return;
      }
      // Legacy single toggle button (label swaps to name the other mode).
      btn.setAttribute('aria-pressed', mode === 'advanced' ? 'true' : 'false');
      btn.textContent = mode === 'simple' ? 'Show advanced details' : 'Use simple view';
    });
    // Refresh cards so Chain details match mode (hidden in Simple, open in Advanced).
    try {
      if (window.Market && typeof Market.render === 'function') Market.render();
    } catch (e) {
      /* ignore */
    }
    try {
      if (window.AdoptPlant && typeof AdoptPlant.render === 'function') AdoptPlant.render();
    } catch (e2) {
      /* ignore */
    }
    try {
      if (typeof window.renderAccountProfile === 'function') window.renderAccountProfile();
      else {
        var overlay = document.getElementById('more-nav-overlay');
        if (overlay && !overlay.hidden && window.DnevnikProfile) {
          /* profile re-renders on next open */
        }
      }
    } catch (e3) {
      /* ignore */
    }
  }

  function bindModeToggle() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-crypto-mode-btn]');
      if (!btn) return;
      e.preventDefault();
      var value = btn.getAttribute('data-crypto-mode-btn');
      if (value === 'simple' || value === 'advanced') {
        if (value !== getMode()) setMode(value);
        return;
      }
      setMode(getMode() === 'simple' ? 'advanced' : 'simple');
    });
    applyMode();
  }

  /** Thin-stroke empty-state glyphs, matching the nav/grouped-row icon language. */
  var EMPTY_ICONS = {
    plant:
      '<svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="M12 15c-1.5-3-4-4-7-3.5 0 3.5 3 5.5 7 3.5z"/><path d="M12 12c1.5-3 4-4 7-3.5 0 3.5-3 5.5-7 3.5z"/></svg>',
    journal:
      '<svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8a2 2 0 012 2v14l-6-3-6 3V6a2 2 0 012-2z"/><path d="M10 9h4M10 13h4"/></svg>',
    market:
      '<svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l1.5-3h13L20 7"/><path d="M4 7h16v3a2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0V7z"/><path d="M5.5 12.5V20h13v-7.5"/></svg>',
    coach:
      '<svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-8"/><path d="M12 14c-3.2 0-5-2-5-5 3.2 0 5 2 5 5z"/><path d="M12 12c0-3 1.8-5 5-5 0 3-1.8 5-5 5z"/><circle cx="12" cy="6" r="2"/></svg>',
  };

  /**
   * Shared first-run empty state: soft icon, headline, one-line body, single CTA.
   * `ctaId`/`ctaLabel` are optional — omit them for states with no next action.
   */
  function emptyStateHtml(opts) {
    var o = opts || {};
    var icon = EMPTY_ICONS[o.icon] || '';
    return (
      '<div class="empty-state empty-state--next' +
      (o.adopter ? ' adopt-empty-adopter' : '') +
      '">' +
      (icon ? '<span class="empty-state-icon" aria-hidden="true">' + icon + '</span>' : '') +
      '<p class="adopt-empty-lead">' +
      esc(o.lead || '') +
      '</p>' +
      '<p class="adopt-empty-body">' +
      esc(o.body || '') +
      '</p>' +
      (o.ctaId
        ? '<button type="button" class="btn btn-sm ' +
          (o.ghost ? 'btn-ghost' : 'btn-primary') +
          '" id="' +
          esc(o.ctaId) +
          '">' +
          esc(o.ctaLabel || 'Continue') +
          '</button>'
        : '') +
      '</div>'
    );
  }

  function totalGrowRewards() {
    // Germination…Harvest from PlantToken stages (0+10+20+35+60+100)
    return 225;
  }

  function remainingGrowRewards(stageIndex) {
    var stages = (window.PlantToken && PlantToken.GROWTH_STAGES) || [];
    if (!stages.length) return totalGrowRewards();
    var idx = Math.max(0, Number(stageIndex) || 0);
    var left = 0;
    for (var i = idx + 1; i < stages.length; i++) {
      left += Number(stages[i].reward || 0);
    }
    return left;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindTips(document.body);
      bindModeToggle();
    });
  } else {
    bindTips(document.body);
    bindModeToggle();
  }

  window.GrowtooPlain = {
    TERMS: TERMS,
    tipHtml: tipHtml,
    lookup: lookup,
    bindTips: bindTips,
    getMode: getMode,
    setMode: setMode,
    applyMode: applyMode,
    emptyStateHtml: emptyStateHtml,
    totalGrowRewards: totalGrowRewards,
    remainingGrowRewards: remainingGrowRewards,
  };
})();
