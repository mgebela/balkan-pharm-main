/**
 * Plain-language glossary tips for Tokenise / Market (growers & adopters).
 */
(function () {
  'use strict';

  /* term → [dictionary key, English]. Resolved in lookup() rather than
     here: this object is built while the page parses, before the dictionary
     has loaded, so translating at this point would freeze in English. */
  var TERMS = {
    escrow: ['app.plainLang.escrow',
      'A temporary hold: your plant token sits safely with the market until someone invests or you cancel — like a middle shelf, not a permanent transfer.'],
    settlement: ['app.plainLang.settlement',
      'When the deal finishes: payment is confirmed and the plant token moves to the adopter (or returns to you if you cancel).'],
    settle: ['app.plainLang.settlement',
      'When the deal finishes: payment is confirmed and the plant token moves to the adopter (or returns to you if you cancel).'],
    rwa: ['app.plainLang.rwa',
      '“Real-world asset” token — here it just means a plant token linked to a real journal trail on the test network. Not a stock or cash.'],
    'plant token': ['app.plainLang.plantToken',
      'A digital certificate on Solana’s test network linked to one journal plant. Optional — your journal works without it.'],
    'adopt stake': ['app.plainLang.adoptStake',
      'Half now, half unlocks as the grower keeps logging care through harvest.'],
    'instant sale': ['app.plainLang.instantSale',
      'Full price to the grower at purchase. Done — no care lock.'],
    redemption: ['app.plainLang.redemption',
      'Turning a harvest-stage token into a real harvest share. Coming later — not available on Devnet. Claim locked stake only unlocks escrowed $GROWTOO.'],
    'bonding curve': ['app.plainLang.bondingCurve',
      'An automatic price formula some crypto projects use. growtoo does not use one — growers set their own ask price.'],
    'collection authority': ['app.plainLang.collectionAuthority',
      'The operator key that currently updates token metadata and settles Devnet deals. A centralized MVP trust point — see Risks.'],
    '$growtoo': ['app.plainLang.growtoo',
      'Test-network reward tokens with no monetary value. Used to practice investing and stage rewards on Devnet.'],
    growtoo: ['app.plainLang.growtoo',
      'Test-network reward tokens with no monetary value. Used to practice investing and stage rewards on Devnet.'],
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
    var row = TERMS[key];
    return row ? T(row[0], row[1]) : '';
  }

  function tipHtml(term, label) {
    var text = lookup(term);
    if (!text) return esc(label || term);
    var shown = label || term;
    return (
      '<span class="plain-tip">' +
      esc(shown) +
      '<button type="button" class="plain-tip-btn" aria-label="' +
      esc(T('app.plainLang.whatDoes', 'What does {term} mean?', { term: shown })) +
      '" data-plain-tip="' +
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
          esc(o.ctaLabel || T('app.cryptoMode.continue', 'Continue')) +
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
    });
  } else {
    bindTips(document.body);
  }

  window.GrowtooPlain = {
    TERMS: TERMS,
    tipHtml: tipHtml,
    lookup: lookup,
    bindTips: bindTips,
    emptyStateHtml: emptyStateHtml,
    totalGrowRewards: totalGrowRewards,
    remainingGrowRewards: remainingGrowRewards,
  };
})();
